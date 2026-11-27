mod auth;
mod chain;
mod config;
mod error;
mod models;
mod settings;
mod units;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use alloy::primitives::{Address, U256};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use time::OffsetDateTime;
use tokio::net::TcpListener;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tower_sessions::{
    cookie::{Key, SameSite},
    Expiry, MemoryStore, Session, SessionManagerLayer,
};
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tracing_subscriber::EnvFilter;

use crate::{
    auth::{
        build_siwe_message, current_identity, issue_nonce, parse_address, require_origin,
        require_origin_if_mutating, verify_login,
    },
    chain::{append_activity, load_activity, load_deployments, Chain},
    config::Config,
    error::ApiError,
    models::{Activity, DevAccount, FaucetRequest, SiweMessageRequest, VerifyRequest},
    settings::Settings,
    units::{format_units, parse_units},
};

struct AppState {
    cfg: Config,
    chain: Chain,
    settings: Arc<Settings>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("lab_api=info".parse().unwrap()))
        .init();
    let cfg = Config::load().await;
    let chain = Chain::new(cfg.rpc_url.clone(), &cfg.faucet_key).expect("faucet key");
    let settings = Settings::load(&cfg.data_dir);
    let state = Arc::new(AppState {
        cfg: cfg.clone(),
        chain,
        settings,
    });

    let key = Key::try_from(cfg.session_key().as_slice()).expect("session key");
    let session_layer = SessionManagerLayer::new(MemoryStore::default())
        .with_name("id")
        .with_secure(cfg.cookie_secure)
        .with_same_site(SameSite::Strict)
        .with_http_only(true)
        .with_expiry(Expiry::OnInactivity(time::Duration::hours(12)))
        .with_signed(key);

    let auth_limit = GovernorConfigBuilder::default()
        .per_second(2)
        .burst_size(30)
        .finish()
        .expect("auth rate limit");
    {
        let limiter = auth_limit.limiter().clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            limiter.retain_recent();
        });
    }
    let faucet_limit = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(60)
        .finish()
        .expect("faucet rate limit");
    {
        let limiter = faucet_limit.limiter().clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            limiter.retain_recent();
        });
    }

    let auth = Router::new()
        .route("/api/auth/nonce", get(nonce))
        .route("/api/auth/siwe-message", post(siwe_message))
        .route("/api/auth/verify", post(verify))
        .route("/api/auth/me", get(me))
        .route("/api/auth/logout", post(logout))
        .layer(GovernorLayer::new(auth_limit));

    let faucet = Router::new()
        .route("/api/faucet", get(faucet_info).post(faucet_send))
        .layer(GovernorLayer::new(faucet_limit));

    let admin = Router::new()
        .route("/api/admin/overview", get(overview))
        .route("/api/admin/activity", get(activity))
        .route("/api/admin/pools", get(pools))
        .route("/api/admin/quote", get(quote))
        .route("/api/admin/contracts", get(contracts))
        .route("/api/admin/accounts", get(accounts))
        .route("/api/admin/logs", get(logs))
        .route("/api/admin/settings", get(get_settings).put(put_settings))
        .route("/api/admin/admins", post(add_admin).delete(remove_admin))
        .route_layer(from_fn_with_state(state.clone(), require_admin));

    let public = Router::new()
        .route("/api/health", get(health))
        .route("/api/config", get(public_config))
        .route("/api/status", get(status))
        .route("/api/deployments", get(deployments_public));

    let mut app = Router::new()
        .merge(public)
        .merge(auth)
        .merge(faucet)
        .merge(admin)
        .with_state(state.clone())
        .layer(cors_layer(&cfg))
        .layer(session_layer)
        .layer(TraceLayer::new_for_http());

    if cfg.static_dir.join("index.html").exists() {
        let index = cfg.static_dir.join("index.html");
        let spa = ServeDir::new(&cfg.static_dir).not_found_service(ServeFile::new(index));
        app = app.fallback_service(spa);
    }

    let listener = TcpListener::bind(cfg.bind).await.expect("bind");
    tracing::info!(addr = %cfg.bind, "lab api listening");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("server");
}

fn cors_layer(cfg: &Config) -> CorsLayer {
    let origin = cfg.siwe_uri.parse::<HeaderValue>().expect("SIWE_URI header");
    CorsLayer::new()
        .allow_origin(AllowOrigin::exact(origin))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([axum::http::header::CONTENT_TYPE])
}

async fn health() -> &'static str {
    "ok"
}

async fn public_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    let cfg = &state.cfg;
    Json(json!({
        "chainId": cfg.chain_id,
        "chainName": cfg.chain_name,
        "nativeSymbol": "BNB",
        "rpcUrl": cfg.public_rpc_url,
        "wsUrl": cfg.public_ws_url,
        "blockscoutUrl": cfg.blockscout_public_url,
        "faucetPath": "/faucet",
        "siweDomain": cfg.siwe_domain,
        "siweStatement": config::STATEMENT,
    }))
}

async fn status(State(state): State<Arc<AppState>>) -> Json<Value> {
    match state.chain.status().await {
        Ok(s) => {
            let native = state.chain.balance(state.chain.faucet).await.ok();
            let lab = lab_balance(&state).await.ok();
            Json(json!({
                "reachable": true,
                "chainId": s.chain_id,
                "blockNumber": s.block_number.to_string(),
                "gasPrice": s.gas_price.to_string(),
                "clientVersion": s.client_version,
                "peerCount": s.peer_count,
                "syncing": s.syncing,
                "faucetNative": native.map(|v| format_units(v, 18)),
                "faucetLab": lab.map(|v| format_units(v, 18)),
                "blockscout": config::blockscout_status().await,
            }))
        }
        Err(err) => Json(json!({
            "reachable": false,
            "error": err.to_string(),
            "chainId": state.cfg.chain_id,
            "blockscout": config::blockscout_status().await,
        })),
    }
}

async fn deployments_public(State(state): State<Arc<AppState>>) -> Json<Value> {
    match load_deployments(&state.cfg.data_dir.join("deployments.json")) {
        Some(doc) => Json(serde_json::to_value(doc).unwrap_or(json!(null))),
        None => Json(json!(null)),
    }
}

async fn nonce(session: Session) -> Result<String, ApiError> {
    issue_nonce(&session).await
}

async fn siwe_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    session: Session,
    Json(body): Json<SiweMessageRequest>,
) -> Result<Json<Value>, ApiError> {
    require_origin(&headers, &state.cfg)?;
    let message = build_siwe_message(&state.cfg, &session, &body).await?;
    Ok(Json(json!({ "message": message })))
}

async fn verify(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    session: Session,
    Json(body): Json<VerifyRequest>,
) -> Result<Json<crate::models::Identity>, ApiError> {
    require_origin(&headers, &state.cfg)?;
    let result = verify_login(
        &state.cfg,
        &state.settings,
        &session,
        &body.message,
        &body.signature,
    )
    .await;
    result.map(Json)
}

async fn me(session: Session) -> Result<Json<crate::models::Identity>, ApiError> {
    current_identity(&session).await.map(Json)
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    session: Session,
) -> Result<StatusCode, ApiError> {
    require_origin(&headers, &state.cfg)?;
    session.flush().await.map_err(|e| ApiError::Upstream(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn faucet_info(State(state): State<Arc<AppState>>) -> Json<Value> {
    let deployments = load_deployments(&state.cfg.data_dir.join("deployments.json"));
    let lab_address = deployments.as_ref().and_then(|d| d.contracts.get("LabToken")).map(|c| c.address.clone());
    let native = state.chain.balance(state.chain.faucet).await.ok();
    let lab = lab_balance(&state).await.ok();
    let recent = recent_faucet(&state);
    let settings = state.settings.snapshot().await;
    Json(json!({
        "nativeSymbol": "BNB",
        "labSymbol": "LAB",
        "labAddress": lab_address,
        "faucetAddress": format!("{}", state.chain.faucet),
        "nativeBalance": native.map(|v| format_units(v, 18)),
        "labBalance": lab.map(|v| format_units(v, 18)),
        "presets": settings.faucet_presets,
        "maxPerRequest": settings.faucet_max,
        "confirmAbove": settings.faucet_confirm_above,
        "recent": recent,
    }))
}

async fn faucet_send(
    State(state): State<Arc<AppState>>,
    Json(body): Json<FaucetRequest>,
) -> Result<Json<Value>, ApiError> {
    let to = parse_address(&body.address)?;
    let amount = parse_units(&body.amount, 18).map_err(ApiError::BadRequest)?;
    let settings = state.settings.snapshot().await;
    let max = parse_units(&settings.faucet_max, 18).map_err(ApiError::BadRequest)?;
    if amount > max {
        return Err(ApiError::BadRequest(format!(
            "The largest single send is {}. An admin can raise it in Settings.",
            settings.faucet_max
        )));
    }
    let asset = body.asset.to_ascii_lowercase();
    let hash = match asset.as_str() {
        "bnb" | "native" => state.chain.send_native(to, amount).await?,
        "lab" => {
            let deployments = load_deployments(&state.cfg.data_dir.join("deployments.json"))
                .ok_or_else(|| ApiError::Upstream("PancakeSwap deploy has not written deployments.json yet.".into()))?;
            let token = deployments
                .contracts
                .get("LabToken")
                .ok_or_else(|| ApiError::Upstream("LabToken is not in deployments.json.".into()))?;
            let token_addr: Address = token.address.parse().map_err(|_| {
                ApiError::Upstream("LabToken address is invalid".into())
            })?;
            state.chain.mint_lab(token_addr, to, amount).await?
        }
        _ => {
            return Err(ApiError::BadRequest(
                "Asset must be bnb or lab.".into(),
            ))
        }
    };
    let item = Activity {
        at: OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        kind: "faucet".into(),
        hash: hash.clone(),
        detail: format!("Sent {} {asset} to {to}", body.amount.trim()),
        status: "success".into(),
    };
    append_activity(&state.cfg.data_dir.join("activity.jsonl"), &item);
    Ok(Json(json!({
        "txHash": hash,
        "asset": asset,
        "amount": body.amount.trim(),
        "address": format!("{to}"),
    })))
}

async fn require_admin(
    State(state): State<Arc<AppState>>,
    session: Session,
    req: axum::extract::Request,
    next: Next,
) -> Result<Response, ApiError> {
    require_origin_if_mutating(req.method(), req.headers(), &state.cfg)?;
    let _identity = current_identity(&session).await?;
    Ok(next.run(req).await)
}

async fn overview(State(state): State<Arc<AppState>>) -> Json<Value> {
    let body = status(State(state.clone())).await.0;
    let deployments = load_deployments(&state.cfg.data_dir.join("deployments.json"));
    let mut value = body.as_object().cloned().unwrap_or_default();
    value.insert(
        "poolCount".into(),
        json!(deployments.as_ref().map(|d| d.pools.len()).unwrap_or(0)),
    );
    value.insert(
        "deployed".into(),
        json!(deployments.is_some()),
    );
    Json(Value::Object(value))
}

async fn activity(State(state): State<Arc<AppState>>) -> Json<Vec<Activity>> {
    let mut items = load_activity(&state.cfg.data_dir.join("activity.jsonl"));
    items.reverse();
    items.truncate(40);
    Json(items)
}

async fn pools(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let Some(deployments) = load_deployments(&state.cfg.data_dir.join("deployments.json")) else {
        return Ok(Json(json!({ "pools": [], "deployed": false })));
    };
    let pools = state.chain.pools(&deployments).await?;
    Ok(Json(json!({
        "deployed": true,
        "feeBps": deployments.fee_bps,
        "factory": deployments.contracts.get("PancakeFactory").map(|c| &c.address),
        "router": deployments.contracts.get("PancakeRouter").map(|c| &c.address),
        "wbnb": deployments.contracts.get("WBNB").map(|c| &c.address),
        "lab": deployments.contracts.get("LabToken").map(|c| &c.address),
        "pools": pools,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuoteQuery {
    amount: String,
    token_in: String,
    token_out: String,
}

async fn quote(
    State(state): State<Arc<AppState>>,
    Query(q): Query<QuoteQuery>,
) -> Result<Json<Value>, ApiError> {
    let deployments = load_deployments(&state.cfg.data_dir.join("deployments.json")).ok_or_else(|| {
        ApiError::Upstream("Contracts are not deployed yet. Wait for the deploy service, or check its log.".into())
    })?;
    let router: Address = deployments
        .contracts
        .get("PancakeRouter")
        .ok_or_else(|| ApiError::Upstream("PancakeRouter missing".into()))?
        .address
        .parse()
        .map_err(|_| ApiError::Upstream("router address invalid".into()))?;
    let token_in = parse_address(&q.token_in)?;
    let token_out = parse_address(&q.token_out)?;
    let amount = parse_units(&q.amount, 18).map_err(ApiError::BadRequest)?;
    let amounts = state
        .chain
        .quote(router, amount, vec![token_in, token_out])
        .await?;
    Ok(Json(json!({
        "amountIn": amounts.first(),
        "amountOut": amounts.last(),
        "feeBps": deployments.fee_bps,
    })))
}

async fn contracts(State(state): State<Arc<AppState>>) -> Json<Value> {
    let deployments = load_deployments(&state.cfg.data_dir.join("deployments.json"));
    let artifacts = std::fs::read_to_string(&state.cfg.artifacts_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    Json(json!({
        "deployments": deployments,
        "artifacts": artifacts,
    }))
}

async fn accounts(State(state): State<Arc<AppState>>) -> Json<Value> {
    let text = std::fs::read_to_string(&state.cfg.dev_accounts_path).unwrap_or_else(|_| "[]".into());
    let parsed: Vec<DevAccount> = serde_json::from_str(&text).unwrap_or_default();
    let mut rows = Vec::new();
    let lab = lab_token(&state);
    for account in parsed {
        let address = parse_address(&account.address).ok();
        let native = match address {
            Some(addr) => state.chain.balance(addr).await.ok().map(|v| format_units(v, 18)),
            None => None,
        };
        let lab_balance = match (address, lab) {
            (Some(addr), Some(token)) => state.chain.token_balance(token, addr).await.ok().map(|v| format_units(v, 18)),
            _ => None,
        };
        rows.push(json!({
            "name": account.name,
            "address": account.address,
            "privateKey": account.private_key,
            "role": account.role,
            "nativeBalance": native,
            "labBalance": lab_balance,
        }));
    }
    Json(json!(rows))
}

#[derive(Deserialize)]
struct LogQuery {
    service: Option<String>,
    q: Option<String>,
    lines: Option<usize>,
}

async fn logs(State(state): State<Arc<AppState>>, Query(q): Query<LogQuery>) -> Json<Value> {
    let service = q.service.unwrap_or_else(|| "geth".into());
    let file = match service.as_str() {
        "geth" => "geth.log",
        "deploy" => "deploy.log",
        "api" => "api.log",
        "faucet" => "faucet.log",
        "blockscout" => "blockscout.log",
        _ => "geth.log",
    };
    let path = state.cfg.log_dir.join(file);
    let lines = q.lines.unwrap_or(200).clamp(20, 1000);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut kept: Vec<&str> = text.lines().collect();
    if let Some(query) = q.q.as_ref().filter(|s| !s.is_empty()) {
        kept.retain(|line| line.to_ascii_lowercase().contains(&query.to_ascii_lowercase()));
    }
    let start = kept.len().saturating_sub(lines);
    Json(json!({
        "service": service,
        "path": path,
        "present": path.exists(),
        "lines": kept[start..].join("\n"),
    }))
}

async fn lab_balance(state: &AppState) -> Result<U256, ApiError> {
    let token = lab_token(state).ok_or_else(|| ApiError::Upstream("no lab token".into()))?;
    state.chain.token_balance(token, state.chain.faucet).await
}

fn lab_token(state: &AppState) -> Option<Address> {
    let doc = load_deployments(&state.cfg.data_dir.join("deployments.json"))?;
    doc.contracts.get("LabToken")?.address.parse().ok()
}

fn recent_faucet(state: &AppState) -> Vec<Activity> {
    let mut items: Vec<Activity> = load_activity(&state.cfg.data_dir.join("activity.jsonl"))
        .into_iter()
        .filter(|item| item.kind == "faucet")
        .collect();
    items.reverse();
    items.truncate(12);
    items
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsBody {
    faucet_presets: Vec<String>,
    faucet_max: String,
    faucet_confirm_above: String,
}

#[derive(Deserialize)]
struct AddressBody {
    address: String,
}

async fn get_settings(State(state): State<Arc<AppState>>) -> Json<crate::settings::LabSettings> {
    Json(state.settings.snapshot().await)
}

async fn put_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SettingsBody>,
) -> Result<Json<crate::settings::LabSettings>, ApiError> {
    state
        .settings
        .update_faucet(body.faucet_presets, body.faucet_max, body.faucet_confirm_above)
        .await
        .map(Json)
}

async fn add_admin(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AddressBody>,
) -> Result<Json<crate::settings::LabSettings>, ApiError> {
    let address = parse_address(&body.address)?;
    state.settings.add_admin(address).await.map(Json)
}

async fn remove_admin(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AddressBody>,
) -> Result<Json<crate::settings::LabSettings>, ApiError> {
    let address = parse_address(&body.address)?;
    state.settings.remove_admin(address).await.map(Json)
}
