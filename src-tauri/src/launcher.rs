use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::error::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchTarget {
    name: String,
    obsidian_vault_id: Option<String>,
}

pub fn build_obsidian_uri(target: &LaunchTarget) -> Result<Url, AppError> {
    let value = match target.obsidian_vault_id.as_deref().map(str::trim) {
        Some(id) if !id.is_empty() => {
            if id.len() != 16 || !id.chars().all(|character| character.is_ascii_hexdigit()) {
                return Err(AppError::new(
                    "VAULT_ID_INVALID",
                    "Vault ID 应为 16 位十六进制字符。",
                ));
            }
            id
        }
        _ => {
            let name = target.name.trim();
            if name.is_empty() {
                return Err(AppError::new("VAULT_NAME_INVALID", "仓库名称不能为空。"));
            }
            name
        }
    };

    let mut uri = Url::parse("obsidian://open").expect("static Obsidian URI must be valid");
    uri.query_pairs_mut().append_pair("vault", value);
    Ok(uri)
}

pub fn launch_obsidian_vault(app: &AppHandle, target: LaunchTarget) -> Result<String, AppError> {
    let uri = build_obsidian_uri(&target)?;
    app.opener()
        .open_url(uri.as_str(), None::<&str>)
        .map_err(|_| {
            AppError::new(
                "OBSIDIAN_LAUNCH_FAILED",
                "系统未能打开 Obsidian URI。请确认已安装并至少运行过一次 Obsidian。",
            )
        })?;
    Ok(uri.into())
}

#[cfg(test)]
mod tests {
    use super::{LaunchTarget, build_obsidian_uri};

    #[test]
    fn encodes_vault_name() {
        let uri = build_obsidian_uri(&LaunchTarget {
            name: "项目 #1 & 资料".into(),
            obsidian_vault_id: None,
        })
        .expect("valid uri");

        assert_eq!(
            uri.as_str(),
            "obsidian://open?vault=%E9%A1%B9%E7%9B%AE+%231+%26+%E8%B5%84%E6%96%99"
        );
    }

    #[test]
    fn prefers_valid_vault_id() {
        let uri = build_obsidian_uri(&LaunchTarget {
            name: "Ignored".into(),
            obsidian_vault_id: Some("ef6ca3e3b524d22f".into()),
        })
        .expect("valid uri");

        assert_eq!(uri.as_str(), "obsidian://open?vault=ef6ca3e3b524d22f");
    }

    #[test]
    fn rejects_invalid_vault_id() {
        let error = build_obsidian_uri(&LaunchTarget {
            name: "Fallback is not allowed".into(),
            obsidian_vault_id: Some("not-an-id".into()),
        })
        .expect_err("invalid id");

        assert_eq!(error.code, "VAULT_ID_INVALID");
    }
}
