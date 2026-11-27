use alloy::{
    network::EthereumWallet,
    primitives::{Address, U256},
    providers::{Provider, ProviderBuilder},
    rpc::types::TransactionRequest,
    signers::local::PrivateKeySigner,
    sol,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{
    error::ApiError,
    models::{Activity, Deployments},
};

sol! {
    #[sol(rpc)]
    interface ILab {
        function mint(address to, uint256 amount) external;
        function balanceOf(address account) external view returns (uint256);
        function symbol() external view returns (string);
    }
    #[sol(rpc)]
    interface IPair {
        function token0() external view returns (address);
        function token1() external view returns (address);
        function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    }
    #[sol(rpc)]
    interface IFactory {
        function allPairsLength() external view returns (uint256);
        function allPairs(uint256 index) external view returns (address);
    }
    #[sol(rpc)]
    interface IRouter {
        function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[] amounts);
    }
}

pub struct Chain {
    rpc_url: String,
    pub faucet: Address,
    signer: PrivateKeySigner,
    send_lock: Mutex<()>,
}

impl Chain {
    pub fn new(rpc_url: String, faucet_key: &str) -> Result<Self, ApiError> {
        let key = if faucet_key.starts_with("0x") {
            faucet_key.to_string()
        } else {
            format!("0x{faucet_key}")
        };
        let signer: PrivateKeySigner = key
            .parse()
            .map_err(|_| ApiError::BadRequest("FAUCET_PRIVATE_KEY is not a valid key".into()))?;
        let faucet = signer.address();
        Ok(Self {
            rpc_url,
            faucet,
            signer,
            send_lock: Mutex::new(()),
        })
    }

    async fn reader(&self) -> Result<impl Provider + Clone, ApiError> {
        ProviderBuilder::new()
            .connect(&self.rpc_url)
            .await
            .map_err(|e| ApiError::Upstream(e.to_string()))
    }

    async fn sender(&self) -> Result<impl Provider + Clone, ApiError> {
        let wallet = EthereumWallet::from(self.signer.clone());
        ProviderBuilder::new()
            .wallet(wallet)
            .connect(&self.rpc_url)
            .await
            .map_err(|e| ApiError::Upstream(e.to_string()))
    }

    pub async fn status(&self) -> Result<ChainStatus, ApiError> {
        let p = self.reader().await?;
        let block = p
            .get_block_number()
            .await
            .map_err(|e| ApiError::Upstream(format!("The node did not answer eth_blockNumber. {e}")))?;
        let chain_id = p.get_chain_id().await.map_err(|e| ApiError::Upstream(e.to_string()))?;
        let gas = U256::from(p.get_gas_price().await.unwrap_or(0));
        let client: String = p
            .raw_request("web3_clientVersion".into(), ())
            .await
            .unwrap_or_else(|_| "unknown".into());
        let peers: String = p
            .raw_request("net_peerCount".into(), ())
            .await
            .unwrap_or_else(|_| "0x0".into());
        let syncing: Value = p
            .raw_request("eth_syncing".into(), ())
            .await
            .unwrap_or(Value::Bool(false));
        let peer_count = u64::from_str_radix(peers.trim_start_matches("0x"), 16).unwrap_or(0);
        Ok(ChainStatus {
            chain_id,
            block_number: block,
            gas_price: gas,
            client_version: client,
            peer_count,
            syncing: syncing != Value::Bool(false),
        })
    }

    pub async fn balance(&self, address: Address) -> Result<U256, ApiError> {
        self.reader()
            .await?
            .get_balance(address)
            .await
            .map_err(|e| ApiError::Upstream(e.to_string()))
    }

    pub async fn token_balance(&self, token: Address, account: Address) -> Result<U256, ApiError> {
        let p = self.reader().await?;
        ILab::new(token, p)
            .balanceOf(account)
            .call()
            .await
            .map_err(|e| ApiError::Upstream(e.to_string()))
    }

    pub async fn send_native(&self, to: Address, amount: U256) -> Result<String, ApiError> {
        let _guard = self.send_lock.lock().await;
        let p = self.sender().await?;
        let tx = TransactionRequest::default()
            .from(self.faucet)
            .to(to)
            .value(amount)
            .gas_limit(21_000)
            .max_fee_per_gas(5_000_000_000)
            .max_priority_fee_per_gas(1_000_000_000);
        let pending = p
            .send_transaction(tx)
            .await
            .map_err(|e| ApiError::Upstream(format!("The node rejected the transfer. {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| ApiError::Upstream(format!("The transfer was sent but not mined. {e}")))?;
        if !receipt.status() {
            return Err(ApiError::Upstream(
                "The transfer was mined and reverted. Check the faucet balance and try a smaller amount.".into(),
            ));
        }
        Ok(format!("{:#x}", receipt.transaction_hash))
    }

    pub async fn mint_lab(&self, token: Address, to: Address, amount: U256) -> Result<String, ApiError> {
        let _guard = self.send_lock.lock().await;
        let p = self.sender().await?;
        let pending = ILab::new(token, p)
            .mint(to, amount)
            .max_fee_per_gas(5_000_000_000)
            .max_priority_fee_per_gas(1_000_000_000)
            .send()
            .await
            .map_err(|e| ApiError::Upstream(format!("LAB mint was rejected. {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| ApiError::Upstream(format!("LAB mint was sent but not mined. {e}")))?;
        if !receipt.status() {
            return Err(ApiError::Upstream(
                "LAB mint reverted. The faucet key must be the token owner.".into(),
            ));
        }
        Ok(format!("{:#x}", receipt.transaction_hash))
    }

    pub async fn pools(&self, deployments: &Deployments) -> Result<Vec<PoolView>, ApiError> {
        let p = self.reader().await?;
        let mut out = Vec::new();
        for pool in &deployments.pools {
            let address: Address = pool
                .address
                .parse()
                .map_err(|_| ApiError::Upstream("pool address in deployments.json is invalid".into()))?;
            let pair = IPair::new(address, &p);
            let reserves = pair
                .getReserves()
                .call()
                .await
                .map_err(|e| ApiError::Upstream(e.to_string()))?;
            out.push(PoolView {
                address: pool.address.clone(),
                token0: pool.token0.clone(),
                token1: pool.token1.clone(),
                symbol0: pool.symbol0.clone(),
                symbol1: pool.symbol1.clone(),
                reserve0: reserves.reserve0.to_string(),
                reserve1: reserves.reserve1.to_string(),
                fee_bps: deployments.fee_bps,
                tx: pool.tx.clone(),
            });
        }
        Ok(out)
    }

    pub async fn quote(
        &self,
        router: Address,
        amount_in: U256,
        path: Vec<Address>,
    ) -> Result<Vec<String>, ApiError> {
        let amounts = IRouter::new(router, self.reader().await?)
            .getAmountsOut(amount_in, path)
            .call()
            .await
            .map_err(|e| {
                ApiError::Upstream(format!(
                    "The router could not quote this path. The pool may be empty. {e}"
                ))
            })?;
        Ok(amounts.into_iter().map(|a| a.to_string()).collect())
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainStatus {
    pub chain_id: u64,
    pub block_number: u64,
    pub gas_price: U256,
    pub client_version: String,
    pub peer_count: u64,
    pub syncing: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolView {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub symbol0: String,
    pub symbol1: String,
    pub reserve0: String,
    pub reserve1: String,
    pub fee_bps: u32,
    pub tx: String,
}

pub fn load_deployments(path: &std::path::Path) -> Option<Deployments> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn load_activity(path: &std::path::Path) -> Vec<Activity> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<Activity>(line).ok())
        .collect()
}

pub fn append_activity(path: &std::path::Path, item: &Activity) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(file, "{}", serde_json::to_string(item).unwrap_or_default());
    }
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct Unused(Value);

