use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployedContract {
    pub address: String,
    pub tx: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolRecord {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub symbol0: String,
    pub symbol1: String,
    pub tx: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployments {
    pub chain_id: u64,
    pub deployed_at: String,
    pub deployer: String,
    pub init_code_hash: String,
    pub fee_bps: u32,
    pub contracts: std::collections::BTreeMap<String, DeployedContract>,
    pub pools: Vec<PoolRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevAccount {
    pub name: String,
    pub address: String,
    #[serde(rename = "privateKey")]
    pub private_key: String,
    pub role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at: String,
    pub kind: String,
    pub hash: String,
    pub detail: String,
    pub status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiweMessageRequest {
    pub address: String,
    pub chain_id: u64,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub message: String,
    pub signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub address: String,
    pub chain_id: u64,
    pub role: &'static str,
}

#[derive(Deserialize)]
pub struct FaucetRequest {
    pub address: String,
    pub asset: String,
    pub amount: String,
}
