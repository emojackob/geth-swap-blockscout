use std::{fs, path::PathBuf, sync::Arc};

use alloy::primitives::Address;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{auth::address_key, error::ApiError, units::parse_units};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabSettings {
    pub admins: Vec<String>,
    pub faucet_presets: Vec<String>,
    pub faucet_max: String,
    pub faucet_confirm_above: String,
}

impl Default for LabSettings {
    fn default() -> Self {
        Self {
            admins: crate::config::DEFAULT_ADMINS
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            faucet_presets: vec!["100".into(), "1000".into(), "10000".into()],
            faucet_max: "1000000".into(),
            faucet_confirm_above: "10000".into(),
        }
    }
}

pub struct Settings {
    path: PathBuf,
    inner: Mutex<LabSettings>,
}

impl Settings {
    pub fn load(data_dir: &std::path::Path) -> Arc<Self> {
        let path = data_dir.join("settings.json");
        let inner = if let Ok(text) = fs::read_to_string(&path) {
            serde_json::from_str(&text).unwrap_or_else(|_| LabSettings::default())
        } else {
            let fresh = LabSettings::default();
            let _ = fs::write(&path, serde_json::to_vec_pretty(&fresh).unwrap_or_default());
            fresh
        };
        Arc::new(Self {
            path,
            inner: Mutex::new(inner),
        })
    }

    pub async fn snapshot(&self) -> LabSettings {
        self.inner.lock().await.clone()
    }

    pub async fn is_admin(&self, address: &Address) -> bool {
        let key = address_key(address);
        self.inner
            .lock()
            .await
            .admins
            .iter()
            .filter_map(|item| item.parse::<Address>().ok())
            .any(|item| address_key(&item) == key)
    }

    pub async fn update_faucet(
        &self,
        presets: Vec<String>,
        max: String,
        confirm_above: String,
    ) -> Result<LabSettings, ApiError> {
        let max_wei = parse_units(max.trim(), 18).map_err(ApiError::BadRequest)?;
        let confirm_wei = parse_units_or_zero(confirm_above.trim())?;
        if presets.is_empty() {
            return Err(ApiError::BadRequest("Add at least one faucet preset.".into()));
        }
        let mut clean = Vec::new();
        for preset in presets {
            let trimmed = preset.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let wei = parse_units(&trimmed, 18).map_err(ApiError::BadRequest)?;
            if wei > max_wei {
                return Err(ApiError::BadRequest(format!(
                    "Preset {trimmed} is larger than the maximum send."
                )));
            }
            clean.push(trimmed);
        }
        if clean.is_empty() {
            return Err(ApiError::BadRequest("Add at least one faucet preset.".into()));
        }
        let _ = confirm_wei;
        let mut guard = self.inner.lock().await;
        guard.faucet_presets = clean;
        guard.faucet_max = max.trim().to_string();
        guard.faucet_confirm_above = if confirm_above.trim().is_empty() {
            "0".into()
        } else {
            confirm_above.trim().to_string()
        };
        self.persist(&guard)?;
        Ok(guard.clone())
    }

    pub async fn add_admin(&self, address: Address) -> Result<LabSettings, ApiError> {
        let shown = format!("{address}");
        let mut guard = self.inner.lock().await;
        if !guard
            .admins
            .iter()
            .filter_map(|item| item.parse::<Address>().ok())
            .any(|item| address_key(&item) == address_key(&address))
        {
            guard.admins.push(shown);
        }
        self.persist(&guard)?;
        Ok(guard.clone())
    }

    pub async fn remove_admin(&self, address: Address) -> Result<LabSettings, ApiError> {
        let mut guard = self.inner.lock().await;
        let remaining: Vec<String> = guard
            .admins
            .iter()
            .filter(|item| {
                item.parse::<Address>()
                    .map(|parsed| address_key(&parsed) != address_key(&address))
                    .unwrap_or(true)
            })
            .cloned()
            .collect();
        if remaining.len() == guard.admins.len() {
            return Err(ApiError::BadRequest("That address is not an admin.".into()));
        }
        if remaining.is_empty() {
            return Err(ApiError::BadRequest(
                "Keep at least one admin address.".into(),
            ));
        }
        guard.admins = remaining;
        self.persist(&guard)?;
        Ok(guard.clone())
    }

    fn persist(&self, settings: &LabSettings) -> Result<(), ApiError> {
        let body = serde_json::to_vec_pretty(settings)
            .map_err(|e| ApiError::Upstream(e.to_string()))?;
        fs::write(&self.path, body).map_err(|e| ApiError::Upstream(e.to_string()))
    }
}

fn parse_units_or_zero(input: &str) -> Result<alloy::primitives::U256, ApiError> {
    if input.is_empty() || input == "0" {
        return Ok(alloy::primitives::U256::ZERO);
    }
    parse_units(input, 18).map_err(ApiError::BadRequest)
}
