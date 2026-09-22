use std::{fs, path::Path};

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultValidationResult {
    pub canonical_path: String,
    pub suggested_name: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVaultEntry {
    pub id: String,
    pub name: String,
    pub path: String,
}

pub fn validate_vault_directory(path: &str) -> Result<VaultValidationResult, AppError> {
    let input = Path::new(path);
    if !input.exists() {
        return Err(AppError::new(
            "VAULT_PATH_NOT_FOUND",
            "所选目录不存在，请重新选择。",
        ));
    }
    if !input.is_dir() {
        return Err(AppError::new(
            "VAULT_PATH_NOT_FOUND",
            "所选路径不是文件夹。",
        ));
    }

    let canonical = fs::canonicalize(input)
        .map_err(|_| AppError::new("VAULT_PATH_FORBIDDEN", "无法访问所选目录，请检查权限。"))?;
    if !canonical.join(".obsidian").is_dir() {
        return Err(AppError::new(
            "VAULT_MARKER_NOT_FOUND",
            "所选目录不包含 .obsidian 文件夹，不是已初始化的 Obsidian 仓库。",
        ));
    }

    let suggested_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| AppError::new("VAULT_NAME_INVALID", "无法从路径中识别仓库名称。"))?;

    Ok(VaultValidationResult {
        canonical_path: canonical.to_string_lossy().into_owned(),
        suggested_name: suggested_name.to_owned(),
    })
}

pub fn list_obsidian_vaults() -> Result<Vec<ObsidianVaultEntry>, AppError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| AppError::new("OBSIDIAN_CONFIG_NOT_FOUND", "无法定位 Obsidian 配置目录。"))?;
    let config_path = Path::new(&appdata).join("obsidian").join("obsidian.json");
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(&config_path)
        .map_err(|_| AppError::new("OBSIDIAN_CONFIG_READ_FAILED", "无法读取 Obsidian 配置。"))?;
    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|_| AppError::new("OBSIDIAN_CONFIG_INVALID", "Obsidian 配置无法解析。"))?;
    let mut result = Vec::new();
    if let Some(vaults) = parsed.get("vaults").and_then(serde_json::Value::as_object) {
        for (id, value) in vaults {
            let Some(path) = value.get("path").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let name = Path::new(path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_owned());
            result.push(ObsidianVaultEntry {
                id: id.clone(),
                name,
                path: path.to_owned(),
            });
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::validate_vault_directory;

    #[test]
    fn accepts_directory_with_obsidian_marker() {
        let root = tempdir().expect("create temp directory");
        fs::create_dir(root.path().join(".obsidian")).expect("create marker");

        let result = validate_vault_directory(root.path().to_str().expect("utf8 path"))
            .expect("valid vault");

        assert_eq!(
            result.suggested_name,
            root.path().file_name().unwrap().to_string_lossy()
        );
    }

    #[test]
    fn rejects_directory_without_obsidian_marker() {
        let root = tempdir().expect("create temp directory");

        let error = validate_vault_directory(root.path().to_str().expect("utf8 path"))
            .expect_err("invalid vault");

        assert_eq!(error.code, "VAULT_MARKER_NOT_FOUND");
    }
}
