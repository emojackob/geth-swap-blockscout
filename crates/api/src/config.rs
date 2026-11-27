use std::{env, fs, net::SocketAddr, path::PathBuf};

use crate::error::ApiError;

pub const STATEMENT: &str =
    "Sign in to the local Geth / PancakeSwap / Blockscout admin console.";

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub chain_id: u64,
    pub chain_name: String,
    pub rpc_url: String,
    pub public_rpc_url: String,
    pub public_ws_url: String,
    pub blockscout_public_url: String,
    pub blockscout_internal_url: String,
    pub siwe_scheme: String,
    pub siwe_domain: String,
    pub siwe_uri: String,
    pub cookie_secure: bool,
    pub session_secret: String,
    pub faucet_key: String,
    pub admin_addresses: Vec<String>,
    pub dev_allow_open_admin: bool,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub static_dir: PathBuf,
    pub artifacts_path: PathBuf,
    pub dev_accounts_path: PathBuf,
    pub allowlist_path: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self, ApiError> {
        let chain_id = env_u64("CHAIN_ID", 56056);
        let siwe_scheme = env_string("SIWE_SCHEME", "http");
        let siwe_domain = env_string("SIWE_DOMAIN", "localhost:8080");
        let siwe_uri = env_string("SIWE_URI", "http://localhost:8080");
        let session_secret = env::var("SESSION_SECRET").map_err(|_| {
            ApiError::BadRequest(
                "SESSION_SECRET is required and must be at least 32 bytes".into(),
            )
        })?;
        if session_secret.len() < 32 {
            return Err(ApiError::BadRequest(
                "SESSION_SECRET must be at least 32 bytes".into(),
            ));
        }
        let data_dir = PathBuf::from(env_string("DATA_DIR", "/data"));
        let admin_addresses = env::var("ADMIN_ADDRESSES")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .collect::<Vec<_>>();
        Ok(Self {
            bind: env_string("BIND", "0.0.0.0:8080").parse().map_err(|_| {
                ApiError::BadRequest("BIND must be host:port".into())
            })?,
            chain_id,
            chain_name: env_string("CHAIN_NAME", "BSC Lab"),
            rpc_url: env_string("RPC_URL", "http://127.0.0.1:8545"),
            public_rpc_url: env_string("PUBLIC_RPC_URL", "http://localhost:8545"),
            public_ws_url: env_string("PUBLIC_WS_URL", "ws://localhost:8546"),
            blockscout_public_url: env_string("BLOCKSCOUT_PUBLIC_URL", "http://localhost:4000"),
            blockscout_internal_url: env_string(
                "BLOCKSCOUT_INTERNAL_URL",
                "http://blockscout-proxy",
            ),
            siwe_scheme,
            siwe_domain,
            siwe_uri,
            cookie_secure: env_bool("COOKIE_SECURE", false),
            session_secret,
            faucet_key: env_string(
                "FAUCET_PRIVATE_KEY",
                "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            ),
            admin_addresses,
            dev_allow_open_admin: env_bool("DEV_ALLOW_OPEN_ADMIN", false),
            allowlist_path: data_dir.join("admin-allowlist.json"),
            data_dir,
            log_dir: PathBuf::from(env_string("LOG_DIR", "/logs")),
            static_dir: PathBuf::from(env_string("STATIC_DIR", "console/dist")),
            artifacts_path: PathBuf::from(env_string(
                "ARTIFACTS_PATH",
                "deploy/artifacts/pancake-v2.json",
            )),
            dev_accounts_path: PathBuf::from(env_string(
                "DEV_ACCOUNTS_PATH",
                "chain/dev-accounts.json",
            )),
        })
    }

    pub fn load_open_allowlist(&self) -> Vec<String> {
        let Ok(text) = fs::read_to_string(&self.allowlist_path) else {
            return Vec::new();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }
}

fn env_string(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(v) => matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"),
        Err(_) => default,
    }
}
