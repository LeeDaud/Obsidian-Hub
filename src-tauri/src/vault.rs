use std::{fs, path::Path};

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultValidationResult {
    pub canonical_path: String,
    pub suggested_name: String,
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
