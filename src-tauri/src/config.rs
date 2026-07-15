use std::{collections::HashSet, fs, io::Write, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;

const SCHEMA_VERSION: u32 = 1;
const CONFIG_FILE_NAME: &str = "config.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub preferences: Preferences,
    pub vaults: Vec<VaultEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: String,
    pub sort_mode: String,
    pub close_after_launch: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: String,
    pub tags: Vec<String>,
    pub obsidian_vault_id: Option<String>,
    pub favorite: bool,
    pub favorite_order: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            preferences: Preferences {
                theme: "system".into(),
                sort_mode: "favoriteThenRecent".into(),
                close_after_launch: false,
            },
            vaults: Vec::new(),
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|_| AppError::new("CONFIG_PATH_FAILED", "无法定位应用配置目录。"))
}

fn validate_config(config: &AppConfig) -> Result<(), AppError> {
    if config.schema_version != SCHEMA_VERSION {
        return Err(AppError::new(
            "CONFIG_UNSUPPORTED_VERSION",
            format!("配置版本 {} 暂不受支持。", config.schema_version),
        ));
    }

    let mut paths = HashSet::new();
    for vault in &config.vaults {
        if vault.id.trim().is_empty()
            || vault.name.trim().is_empty()
            || vault.path.trim().is_empty()
        {
            return Err(AppError::new(
                "CONFIG_INVALID",
                "配置中存在缺少必要字段的仓库。",
            ));
        }

        let normalized = vault.path.trim_end_matches(['\\', '/']).to_lowercase();
        if !paths.insert(normalized) {
            return Err(AppError::new(
                "VAULT_DUPLICATE_PATH",
                "配置中存在重复的仓库路径。",
            ));
        }
    }
    Ok(())
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, AppError> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|_| AppError::new("CONFIG_READ_FAILED", "无法读取启动器配置。"))?;
    let config: AppConfig = serde_json::from_str(&contents)
        .map_err(|_| AppError::new("CONFIG_INVALID", "启动器配置已损坏，无法解析。"))?;
    validate_config(&config)?;
    Ok(config)
}

pub fn save_config(app: &AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    validate_config(&config)?;
    let path = config_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| AppError::new("CONFIG_PATH_FAILED", "配置路径无效。"))?;
    fs::create_dir_all(directory)
        .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法创建应用配置目录。"))?;

    let mut temporary = NamedTempFile::new_in(directory)
        .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法创建临时配置文件。"))?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), &config)
        .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法序列化启动器配置。"))?;
    temporary
        .as_file_mut()
        .write_all(b"\n")
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法写入启动器配置。"))?;
    temporary
        .persist(&path)
        .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法替换启动器配置。"))?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, VaultEntry, validate_config};

    fn vault(id: &str, path: &str) -> VaultEntry {
        VaultEntry {
            id: id.into(),
            name: id.into(),
            path: path.into(),
            description: String::new(),
            tags: Vec::new(),
            obsidian_vault_id: None,
            favorite: false,
            favorite_order: None,
            created_at: "2026-07-14T00:00:00.000Z".into(),
            updated_at: "2026-07-14T00:00:00.000Z".into(),
            last_opened_at: None,
        }
    }

    #[test]
    fn accepts_default_config() {
        validate_config(&AppConfig::default()).expect("default config is valid");
    }

    #[test]
    fn rejects_case_insensitive_duplicate_windows_paths() {
        let mut config = AppConfig::default();
        config.vaults = vec![
            vault("one", "D:\\Notes\\Main"),
            vault("two", "d:\\notes\\main\\"),
        ];

        let error = validate_config(&config).expect_err("duplicate paths must fail");

        assert_eq!(error.code, "VAULT_DUPLICATE_PATH");
    }
}
