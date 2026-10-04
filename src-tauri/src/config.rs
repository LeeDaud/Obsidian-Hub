use std::{collections::HashSet, fs, io::Write, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;

const SCHEMA_VERSION: u32 = 2;
const CONFIG_FILE_NAME: &str = "config.json";
const LEGACY_IDENTIFIER: &str = "io.github.obsidian-hub";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub preferences: Preferences,
    pub vaults: Vec<VaultEntry>,
    #[serde(default)]
    pub workspace: WorkspaceConfig,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub hub_vault_id: Option<String>,
    pub initialized_at: Option<String>,
    #[serde(default)]
    pub main_folder: String,
    #[serde(default)]
    pub output_folder: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VaultRole {
    Hub,
    Echo,
    Main,
    Knowledge,
    Output,
    Other,
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
    #[serde(default)]
    pub role: Option<VaultRole>,
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
            workspace: WorkspaceConfig::default(),
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|_| AppError::new("CONFIG_PATH_FAILED", "无法定位应用配置目录。"))
}

fn legacy_config_path(current: &std::path::Path) -> Option<PathBuf> {
    Some(
        current
            .parent()?
            .join(LEGACY_IDENTIFIER)
            .join(CONFIG_FILE_NAME),
    )
}

fn validate_config(config: &AppConfig) -> Result<(), AppError> {
    if config.schema_version != SCHEMA_VERSION {
        return Err(AppError::new(
            "CONFIG_UNSUPPORTED_VERSION",
            format!("配置版本 {} 暂不受支持。", config.schema_version),
        ));
    }

    let mut paths = HashSet::new();
    for folder in [
        &config.workspace.main_folder,
        &config.workspace.output_folder,
    ] {
        crate::workspace_actions::note_destination("workflow-validation", folder)?;
    }
    let mut ids = HashSet::new();
    let mut roles = HashSet::new();
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
        if !ids.insert(vault.id.as_str()) {
            return Err(AppError::new(
                "VAULT_DUPLICATE_ID",
                "配置中存在重复的仓库 ID。",
            ));
        }

        let normalized = vault.path.trim_end_matches(['\\', '/']).to_lowercase();
        if !paths.insert(normalized) {
            return Err(AppError::new(
                "VAULT_DUPLICATE_PATH",
                "配置中存在重复的仓库路径。",
            ));
        }
        if let Some(role) = vault.role {
            if role != VaultRole::Other && !roles.insert(role) {
                return Err(AppError::new(
                    "VAULT_ROLE_DUPLICATE",
                    "核心仓库角色只能分配给一个仓库。",
                ));
            }
        }
    }
    if let Some(hub_id) = &config.workspace.hub_vault_id {
        if !config
            .vaults
            .iter()
            .any(|vault| vault.id == *hub_id && vault.role == Some(VaultRole::Hub))
        {
            return Err(AppError::new(
                "HUB_VAULT_INVALID",
                "Hub Vault 必须已登记并标记为 Hub 角色。",
            ));
        }
    }
    Ok(())
}

fn parse_config(contents: &str) -> Result<(AppConfig, bool), AppError> {
    let mut config: AppConfig = serde_json::from_str(contents)
        .map_err(|_| AppError::new("CONFIG_INVALID", "启动器配置已损坏，无法解析。"))?;
    let migrated = config.schema_version == 1;
    if migrated {
        config.schema_version = SCHEMA_VERSION;
    }
    validate_config(&config)?;
    Ok((config, migrated))
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, AppError> {
    let path = config_path(app)?;
    let source = if path.exists() {
        path.clone()
    } else if let Some(legacy) = legacy_config_path(&path).filter(|candidate| candidate.exists()) {
        legacy
    } else {
        return Ok(AppConfig::default());
    };

    let contents = fs::read_to_string(&source)
        .map_err(|_| AppError::new("CONFIG_READ_FAILED", "无法读取启动器配置。"))?;
    let (config, migrated) = parse_config(&contents)?;
    if migrated || source != path {
        return save_config(app, config);
    }
    Ok(config)
}

pub fn save_config(app: &AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    validate_config(&config)?;
    crate::workspace_actions::validate_workflow_folders(&config)?;
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
    use super::{
        AppConfig, VaultEntry, VaultRole, legacy_config_path, parse_config, validate_config,
    };

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
            role: None,
        }
    }

    #[test]
    fn accepts_default_config() {
        validate_config(&AppConfig::default()).expect("default config is valid");
    }

    #[test]
    fn existing_v2_defaults_workflow_folders_without_migration() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["workspace"]
            .as_object_mut()
            .unwrap()
            .remove("mainFolder");
        value["workspace"]
            .as_object_mut()
            .unwrap()
            .remove("outputFolder");
        let (config, migrated) = parse_config(&value.to_string()).unwrap();
        assert!(!migrated);
        assert!(config.workspace.main_folder.is_empty());
        assert!(config.workspace.output_folder.is_empty());
        value["workspace"]["mainFolder"] = serde_json::json!("../escape");
        assert!(parse_config(&value.to_string()).is_err());
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

    #[test]
    fn migrates_v1_without_guessing_roles() {
        let mut legacy = serde_json::to_value(AppConfig::default()).unwrap();
        legacy["schemaVersion"] = 1.into();
        legacy.as_object_mut().unwrap().remove("workspace");
        legacy["vaults"] = serde_json::json!([{
            "id": "v", "name": "Main", "path": "D:\\Main", "description": "",
            "tags": [], "obsidianVaultId": null, "favorite": false,
            "favoriteOrder": null, "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z", "lastOpenedAt": null
        }]);
        let (config, migrated) = parse_config(&legacy.to_string()).unwrap();
        assert!(migrated);
        assert_eq!(config.schema_version, 2);
        assert_eq!(config.vaults[0].role, None);
    }

    #[test]
    fn rejects_duplicate_core_roles() {
        let mut config = AppConfig::default();
        config.vaults = vec![vault("a", "D:\\A"), vault("b", "D:\\B")];
        config.vaults[0].role = Some(VaultRole::Main);
        config.vaults[1].role = Some(VaultRole::Main);
        assert_eq!(
            validate_config(&config).unwrap_err().code,
            "VAULT_ROLE_DUPLICATE"
        );
    }

    #[test]
    fn imports_from_legacy_directory_without_targeting_legacy_file_for_write() {
        let current = std::path::Path::new(
            "C:/Users/Test/AppData/Roaming/io.github.obsidian-hub.v2preview/config.json",
        );
        let legacy = legacy_config_path(current).unwrap();
        assert_eq!(legacy.file_name().unwrap(), "config.json");
        assert_eq!(
            legacy.parent().unwrap().file_name().unwrap(),
            "io.github.obsidian-hub"
        );
        assert_ne!(legacy, current);
    }
}
