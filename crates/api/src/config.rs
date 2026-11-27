use std::{env, fs, net::SocketAddr, path::PathBuf};

use sha2::{Digest, Sha512};

/// Documented Anvil/Hardhat account 0. Test only. Signs faucet transfers.
pub const FAUCET_KEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
pub const CHAIN_ID: u64 = 56056;
pub const CHAIN_NAME: &str = "BSC Lab";
pub const STATEMENT: &str =
    "Sign in to the local Geth / PancakeSwap / Blockscout admin console.";

/// Seed admins: faucet key, Hardhat account 1, and the published BSC dev validator.
pub const DEFAULT_ADMINS: &[&str] = &[
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x9fB29AAc15b9A4B7F17c3385939b007540f4d791",
];

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub chain_id: u64,
    pub chain_name: String,
    pub rpc_url: String,
    pub public_rpc_url: String,
    pub public_ws_url: String,
    pub blockscout_public_url: String,
    pub siwe_scheme: String,
    pub siwe_domain: String,
    pub siwe_uri: String,
    pub cookie_secure: bool,
    pub session_secret: String,
    pub faucet_key: String,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub static_dir: PathBuf,
    pub artifacts_path: PathBuf,
    pub dev_accounts_path: PathBuf,
}

impl Config {
    /// `LISTEN` is the only environment variable this process reads.
    /// Example: `0.0.0.0:18080`.
    pub async fn load() -> Self {
        let bind = listen_addr();
        let (siwe_scheme, siwe_domain, siwe_uri) = public_origin(bind);
        let data_dir = existing_dir("/data").unwrap_or_else(|| PathBuf::from("data"));
        let log_dir = existing_dir("/logs").unwrap_or_else(|| PathBuf::from("logs"));
        fs::create_dir_all(&data_dir).expect("create data dir");
        fs::create_dir_all(&log_dir).expect("create log dir");
        let rpc_url = resolve_rpc().await;
        Self {
            bind,
            chain_id: CHAIN_ID,
            chain_name: CHAIN_NAME.into(),
            rpc_url,
            public_rpc_url: "http://localhost:8545".into(),
            public_ws_url: "ws://localhost:8546".into(),
            blockscout_public_url: "http://localhost:4000".into(),
            siwe_scheme,
            siwe_domain,
            siwe_uri,
            cookie_secure: false,
            session_secret: session_secret(&data_dir),
            faucet_key: FAUCET_KEY.into(),
            static_dir: existing_dir("/app/console").unwrap_or_else(|| PathBuf::from("console/dist")),
            artifacts_path: first_file(&[
                "/app/artifacts/pancake-v2.json",
                "deploy/artifacts/pancake-v2.json",
            ]),
            dev_accounts_path: first_file(&["/app/dev-accounts.json", "chain/dev-accounts.json"]),
            data_dir,
            log_dir,
        }
    }

    pub fn session_key(&self) -> [u8; 64] {
        let digest = Sha512::digest(self.session_secret.as_bytes());
        let mut out = [0u8; 64];
        out.copy_from_slice(&digest);
        out
    }
}

fn listen_addr() -> SocketAddr {
    let raw = env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:18080".into());
    raw.parse().unwrap_or_else(|_| {
        panic!("LISTEN must be a single host:port value, for example 0.0.0.0:18080 (got {raw})")
    })
}

fn public_origin(bind: SocketAddr) -> (String, String, String) {
    let host = if bind.ip().is_unspecified() || bind.ip().is_loopback() {
        "localhost".to_string()
    } else {
        bind.ip().to_string()
    };
    let domain = if bind.port() == 80 {
        host
    } else {
        format!("{host}:{}", bind.port())
    };
    let uri = format!("http://{domain}");
    ("http".into(), domain, uri)
}

fn existing_dir(path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(path);
    path.is_dir().then_some(path)
}

fn first_file(candidates: &[&str]) -> PathBuf {
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(candidates[0]))
}

fn session_secret(data_dir: &std::path::Path) -> String {
    let path = data_dir.join("session-secret");
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if trimmed.len() >= 32 {
            return trimmed;
        }
    }
    let secret = hex::encode(random_bytes());
    fs::write(&path, &secret).expect("write session secret");
    secret
}

fn random_bytes() -> [u8; 32] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut out = [0u8; 32];
    let ticks = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Mix a clock with addresses of stack data. Good enough for a local lab
    // secret that never leaves the data volume. Not a CSPRNG.
    let extra = &ticks as *const u128 as usize;
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = ((ticks >> ((i % 16) * 8)) as u8) ^ ((extra >> ((i % 8) * 8)) as u8) ^ (i as u8);
    }
    // Prefer the OS random source when it is available.
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = file.read_exact(&mut out);
    }
    out
}

async fn resolve_rpc() -> String {
    for url in ["http://127.0.0.1:8545", "http://host.docker.internal:8545"] {
        if rpc_up(url).await {
            tracing::info!(%url, "using chain rpc");
            return url.to_string();
        }
    }
    tracing::warn!("chain rpc is not up yet; will keep trying 127.0.0.1:8545");
    "http://127.0.0.1:8545".into()
}

async fn rpc_up(url: &str) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(std::time::Duration::from_secs(2)).build() else {
        return false;
    };
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}"#;
    client
        .post(url)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map(|resp| resp.status().is_success())
        .unwrap_or(false)
}

pub async fn blockscout_status() -> &'static str {
    for base in ["http://127.0.0.1:4000", "http://host.docker.internal:4000"] {
        match probe(base).await {
            Some(true) => return "up",
            Some(false) => return "starting",
            None => {}
        }
    }
    "down"
}

async fn probe(base: &str) -> Option<bool> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;
    let resp = client
        .get(format!("{}/api/v2/stats", base.trim_end_matches('/')))
        .send()
        .await
        .ok()?;
    Some(resp.status().is_success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unspecified_bind_uses_localhost_origin() {
        let bind: SocketAddr = "0.0.0.0:18080".parse().unwrap();
        let (scheme, domain, uri) = public_origin(bind);
        assert_eq!(scheme, "http");
        assert_eq!(domain, "localhost:18080");
        assert_eq!(uri, "http://localhost:18080");
    }
}
