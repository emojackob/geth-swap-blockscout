use alloy::primitives::Address;
use axum::http::{HeaderMap, Method};
use signinwithethereum::{generate_nonce, Message, VerificationOpts, Version};
use time::{Duration, OffsetDateTime};
use tower_sessions::Session;

use crate::{
    config::{Config, STATEMENT},
    error::ApiError,
    models::{Identity, SiweMessageRequest},
    settings::Settings,
};

const NONCE_KEY: &str = "nonce";
const NONCE_EXP_KEY: &str = "nonce_exp";
const ADDRESS_KEY: &str = "address";
const CHAIN_KEY: &str = "chain_id";
const ROLE_KEY: &str = "role";
const AUTH_AT_KEY: &str = "authenticated_at";

pub fn origin_allowed(headers: &HeaderMap, expected_origin: &str) -> bool {
    if let Some(origin) = headers.get(axum::http::header::ORIGIN).and_then(|v| v.to_str().ok()) {
        return origin == expected_origin;
    }
    if let Some(referer) = headers.get(axum::http::header::REFERER).and_then(|v| v.to_str().ok()) {
        return referer == expected_origin
            || referer.starts_with(&format!("{expected_origin}/"));
    }
    false
}

pub fn require_origin(headers: &HeaderMap, cfg: &Config) -> Result<(), ApiError> {
    if origin_allowed(headers, &cfg.siwe_uri) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "This request was rejected because its Origin does not match the lab console.".into(),
        ))
    }
}

pub fn require_origin_if_mutating(method: &Method, headers: &HeaderMap, cfg: &Config) -> Result<(), ApiError> {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        Ok(())
    } else {
        require_origin(headers, cfg)
    }
}

/// Accept EIP-55 checksums and uniform-case addresses. Reject a bad mixed-case checksum.
pub fn parse_address(input: &str) -> Result<Address, ApiError> {
    let trimmed = input.trim();
    trimmed.parse::<Address>().map_err(|_| {
        ApiError::BadRequest(
            "That address is not a valid EIP-55 checksum. Paste the checksummed address or use all lowercase.".into(),
        )
    })
}

pub fn address_key(address: &Address) -> String {
    format!("{address:x}")
}

pub async fn issue_nonce(session: &Session) -> Result<String, ApiError> {
    let nonce = generate_nonce();
    let exp = OffsetDateTime::now_utc() + Duration::minutes(10);
    session
        .insert(NONCE_KEY, &nonce)
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    session
        .insert(NONCE_EXP_KEY, exp.unix_timestamp())
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    Ok(nonce)
}

pub async fn build_siwe_message(
    cfg: &Config,
    session: &Session,
    body: &SiweMessageRequest,
) -> Result<String, ApiError> {
    if body.chain_id != cfg.chain_id {
        return Err(ApiError::BadRequest(format!(
            "Switch the wallet to chain id {} before signing in.",
            cfg.chain_id
        )));
    }
    let address = parse_address(&body.address)?;
    let nonce = issue_nonce(session).await?;
    let now = OffsetDateTime::now_utc();
    let message = Message {
        scheme: Some(cfg.siwe_scheme.clone()),
        domain: cfg.siwe_domain.parse().map_err(|_| {
            ApiError::BadRequest("SIWE_DOMAIN is not a valid authority".into())
        })?,
        address: address.into_array(),
        address_raw: None,
        statement: Some(STATEMENT.to_string()),
        uri: cfg.siwe_uri.parse().map_err(|_| {
            ApiError::BadRequest("SIWE_URI is not a valid URI".into())
        })?,
        version: Version::V1,
        chain_id: cfg.chain_id,
        nonce,
        issued_at: now.into(),
        expiration_time: Some((now + Duration::minutes(10)).into()),
        not_before: Some((now - Duration::seconds(30)).into()),
        request_id: None,
        resources: Vec::new(),
        warnings: Vec::new(),
    };
    Ok(message.to_string())
}

pub async fn verify_login(
    cfg: &Config,
    settings: &Settings,
    session: &Session,
    raw_message: &str,
    signature_hex: &str,
) -> Result<Identity, ApiError> {
    let message: Message = raw_message.parse().map_err(|_| {
        ApiError::BadRequest("The sign-in message could not be parsed. Request a new one and try again.".into())
    })?;
    reject_bad_checksum(&message)?;
    let stored: Option<String> = session
        .get(NONCE_KEY)
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    let exp: Option<i64> = session
        .get(NONCE_EXP_KEY)
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    let Some(stored_nonce) = stored else {
        return Err(ApiError::Unauthorized);
    };
    let Some(exp) = exp else {
        return Err(ApiError::Unauthorized);
    };
    if OffsetDateTime::now_utc().unix_timestamp() > exp {
        let _ = session.remove::<String>(NONCE_KEY).await;
        return Err(ApiError::Unauthorized);
    }
    let sig = decode_signature(signature_hex)?;
    let opts = VerificationOpts {
        domain: Some(cfg.siwe_domain.parse().map_err(|_| {
            ApiError::BadRequest("SIWE_DOMAIN is not a valid authority".into())
        })?),
        nonce: Some(stored_nonce),
        uri: Some(cfg.siwe_uri.parse().map_err(|_| {
            ApiError::BadRequest("SIWE_URI is not a valid URI".into())
        })?),
        chain_id: Some(cfg.chain_id),
        scheme: Some(cfg.siwe_scheme.clone()),
        rpc_url: Some(cfg.rpc_url.clone()),
        timestamp: None,
    };
    if let Err(err) = message.verify(sig.as_slice(), &opts).await {
        tracing::info!(error = %err, "siwe verification failed");
        return Err(ApiError::Unauthorized);
    }
    // Single-use nonce, success path.
    let _ = session.remove::<String>(NONCE_KEY).await;
    let _ = session.remove::<i64>(NONCE_EXP_KEY).await;

    let address = Address::from(message.address);
    if !settings.is_admin(&address).await {
        return Err(ApiError::Forbidden(
            "This address is not on the admin allowlist. An admin can add it from Settings.".into(),
        ));
    }
    session
        .cycle_id()
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    let checksum = signinwithethereum::eip55(&message.address);
    let now = OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap_or_default();
    session
        .insert(ADDRESS_KEY, &checksum)
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    session
        .insert(CHAIN_KEY, cfg.chain_id)
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    session
        .insert(ROLE_KEY, "admin")
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    session
        .insert(AUTH_AT_KEY, &now)
        .await
        .map_err(|e| ApiError::Upstream(e.to_string()))?;
    Ok(Identity {
        address: checksum,
        chain_id: cfg.chain_id,
        role: "admin",
    })
}

pub async fn current_identity(session: &Session) -> Result<Identity, ApiError> {
    let address: Option<String> = session.get(ADDRESS_KEY).await.unwrap_or(None);
    let chain_id: Option<u64> = session.get(CHAIN_KEY).await.unwrap_or(None);
    let role: Option<String> = session.get(ROLE_KEY).await.unwrap_or(None);
    match (address, chain_id, role) {
        (Some(address), Some(chain_id), Some(role)) if role == "admin" => Ok(Identity {
            address,
            chain_id,
            role: "admin",
        }),
        _ => Err(ApiError::Unauthorized),
    }
}

fn reject_bad_checksum(message: &Message) -> Result<(), ApiError> {
    let Some(raw) = &message.address_raw else {
        return Ok(());
    };
    let lower = raw.chars().all(|c| !c.is_ascii_uppercase());
    let upper = raw.chars().all(|c| !c.is_ascii_lowercase());
    if lower || upper {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "The sign-in message used a mixed-case address with a bad EIP-55 checksum.".into(),
        ))
    }
}

fn decode_signature(input: &str) -> Result<[u8; 65], ApiError> {
    let hex_str = input.trim().trim_start_matches("0x");
    let bytes = hex::decode(hex_str).map_err(|_| {
        ApiError::BadRequest("The signature is not hex. Sign the message again.".into())
    })?;
    if bytes.len() != 65 {
        return Err(ApiError::BadRequest(
            "The signature must be 65 bytes from personal_sign.".into(),
        ));
    }
    let mut out = [0u8; 65];
    out.copy_from_slice(&bytes);
    Ok(out)
}
