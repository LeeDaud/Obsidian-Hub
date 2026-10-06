use crate::{
    config::{self, AppConfig, VaultRole},
    error::AppError,
    workspace_actions,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

static LOCK: Mutex<()> = Mutex::new(());
const MAX_LINKS: usize = 5000;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub vault_id: String,
    pub relative_path: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub source: NoteRef,
    pub target: NoteRef,
    pub kind: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStore {
    pub schema_version: u32,
    pub links: Vec<Link>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRequest {
    pub link: Link,
    pub source_hash: String,
    pub target_hash: String,
    pub linked: bool,
}
fn fail(code: &'static str, message: &str) -> AppError {
    AppError::new(code, message)
}
fn valid_ref(value: &NoteRef) -> bool {
    !value.vault_id.is_empty()
        && value.vault_id.len() <= 256
        && value.relative_path.len() <= 1024
        && !value.relative_path.contains(['\\', ':', '\0'])
        && value.relative_path.to_lowercase().ends_with(".md")
        && value
            .relative_path
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..")
}
fn valid_link(link: &Link) -> bool {
    valid_ref(&link.source)
        && valid_ref(&link.target)
        && link.source != link.target
        && matches!(link.kind.as_str(), "origin" | "reference")
}
fn path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("workflow-links-v1.json"))
        .map_err(|_| fail("WORKFLOW_LINKS_PATH_FAILED", "无法定位关联存储。"))
}
fn load_path(path: &Path) -> Result<LinkStore, AppError> {
    if !path.exists() {
        return Ok(LinkStore {
            schema_version: 1,
            links: vec![],
        });
    }
    if fs::metadata(path)
        .map_err(|_| fail("WORKFLOW_LINKS_READ_FAILED", "无法读取关联。"))?
        .len()
        > 16 * 1024 * 1024
    {
        return Err(fail(
            "WORKFLOW_LINKS_INVALID",
            "关联文件过大，请保留文件并检查。",
        ));
    }
    let value: LinkStore = serde_json::from_slice(
        &fs::read(path).map_err(|_| fail("WORKFLOW_LINKS_READ_FAILED", "无法读取关联。"))?,
    )
    .map_err(|_| fail("WORKFLOW_LINKS_INVALID", "关联存储损坏，未覆盖原文件。"))?;
    if value.schema_version != 1
        || value.links.len() > MAX_LINKS
        || value.links.iter().any(|l| !valid_link(l))
    {
        return Err(fail("WORKFLOW_LINKS_INVALID", "关联存储版本或内容无效。"));
    }
    Ok(value)
}
fn save_path(path: &Path, store: &LinkStore) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| fail("WORKFLOW_LINKS_PATH_FAILED", "关联存储路径无效。"))?;
    fs::create_dir_all(parent)
        .map_err(|_| fail("WORKFLOW_LINKS_WRITE_FAILED", "无法创建关联目录。"))?;
    let mut tmp = NamedTempFile::new_in(parent)
        .map_err(|_| fail("WORKFLOW_LINKS_WRITE_FAILED", "无法保存关联。"))?;
    serde_json::to_writer(tmp.as_file_mut(), store)
        .map_err(|_| fail("WORKFLOW_LINKS_WRITE_FAILED", "无法保存关联。"))?;
    tmp.write_all(b"\n")
        .and_then(|_| tmp.as_file_mut().sync_all())
        .map_err(|_| fail("WORKFLOW_LINKS_WRITE_FAILED", "无法保存关联。"))?;
    tmp.persist(path)
        .map_err(|_| fail("WORKFLOW_LINKS_WRITE_FAILED", "无法替换关联存储。"))?;
    Ok(())
}
pub fn load(app: &AppHandle) -> Result<LinkStore, AppError> {
    let _guard = LOCK
        .lock()
        .map_err(|_| fail("WORKFLOW_LINKS_BUSY", "关联存储忙，请重试。"))?;
    load_path(&path(app)?)
}
fn validate(config: &AppConfig, request: &LinkRequest) -> Result<(), AppError> {
    let link = &request.link;
    if !valid_link(link) {
        return Err(fail("WORKFLOW_LINK_INVALID", "关联路径或类型无效。"));
    }
    let role = |id: &str| {
        config
            .vaults
            .iter()
            .find(|v| v.id == id)
            .and_then(|v| v.role.clone())
    };
    let allowed = match (
        role(&link.source.vault_id),
        role(&link.target.vault_id),
        link.kind.as_str(),
    ) {
        (Some(VaultRole::Echo), Some(VaultRole::Main), "origin")
        | (Some(VaultRole::Main), Some(VaultRole::Output), "origin")
        | (Some(VaultRole::Knowledge), Some(VaultRole::Output), "reference") => true,
        _ => false,
    };
    if !allowed {
        return Err(fail(
            "WORKFLOW_LINK_ROLE_INVALID",
            "关联必须为 Echo→Main、Main→Output 或 Knowledge→Output。",
        ));
    }
    for (note, hash) in [
        (&link.source, &request.source_hash),
        (&link.target, &request.target_hash),
    ] {
        let preview = workspace_actions::read_preview_with_config(
            config,
            &note.vault_id,
            &note.relative_path,
            Some(hash),
        )?;
        if hash.is_empty() || preview.changed {
            return Err(fail("WORKSPACE_CONFLICT", "关联笔记已变化，请刷新后重试。"));
        }
    }
    Ok(())
}
fn update_path(path: &Path, request: &LinkRequest) -> Result<LinkStore, AppError> {
    let mut store = load_path(path)?;
    store.links.retain(|l| l != &request.link);
    if request.linked {
        if store.links.len() >= MAX_LINKS {
            return Err(fail("WORKFLOW_LINKS_LIMIT", "手动关联已达上限。"));
        }
        store.links.push(request.link.clone());
    }
    save_path(path, &store)?;
    Ok(store)
}
pub fn update(app: &AppHandle, request: LinkRequest) -> Result<LinkStore, AppError> {
    let _guard = LOCK
        .lock()
        .map_err(|_| fail("WORKFLOW_LINKS_BUSY", "关联存储忙，请重试。"))?;
    if request.linked {
        validate(&config::load_config(app)?, &request)?;
    } else if !valid_link(&request.link) {
        return Err(fail("WORKFLOW_LINK_INVALID", "关联无效。"));
    }
    update_path(&path(app)?, &request)
}
// Only Hub's generated JSON frontmatter is recognized. Body links never imply a workflow edge.
pub fn parse(contents: &str, target: NoteRef) -> Vec<Link> {
    let mut lines = contents.trim_start_matches('\u{feff}').lines();
    if lines.next() != Some("---") {
        return vec![];
    }
    let mut fields = Vec::new();
    let mut closed = false;
    for line in lines.take(256) {
        if line == "---" {
            closed = true;
            break;
        }
        fields.push(line);
    }
    if !closed {
        return vec![];
    }
    let decode = |value: &serde_json::Value| -> Option<NoteRef> {
        let note = NoteRef {
            vault_id: value.get("vault_id")?.as_str()?.to_owned(),
            relative_path: value.get("path")?.as_str()?.to_owned(),
        };
        valid_ref(&note).then_some(note)
    };
    let mut result = Vec::new();
    for line in fields {
        let Some((key, raw)) = line.split_once(':') else {
            continue;
        };
        if !matches!(key, "origin" | "references") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(raw.trim()) else {
            continue;
        };
        let values = if key == "origin" {
            vec![&value]
        } else {
            value
                .as_array()
                .map(|a| a.iter().take(50).collect())
                .unwrap_or_default()
        };
        for value in values {
            if let Some(source) = decode(value) {
                let link = Link {
                    source,
                    target: target.clone(),
                    kind: if key == "origin" {
                        "origin"
                    } else {
                        "reference"
                    }
                    .into(),
                };
                if valid_link(&link) && !result.contains(&link) {
                    result.push(link);
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(id: &str) -> NoteRef {
        NoteRef {
            vault_id: id.into(),
            relative_path: "a.md".into(),
        }
    }
    fn request(linked: bool) -> LinkRequest {
        LinkRequest {
            link: Link {
                source: note("echo"),
                target: note("main"),
                kind: "origin".into(),
            },
            source_hash: "h".into(),
            target_hash: "h".into(),
            linked,
        }
    }
    fn fixture(root: &Path) -> AppConfig {
        let mut config = AppConfig::default();
        for (id, role) in [
            ("echo", VaultRole::Echo),
            ("main", VaultRole::Main),
            ("knowledge", VaultRole::Knowledge),
            ("output", VaultRole::Output),
        ] {
            let folder = root.join(id);
            fs::create_dir_all(folder.join(".obsidian")).unwrap();
            fs::write(folder.join("a.md"), "# private body").unwrap();
            config.vaults.push(config::VaultEntry {
                id: id.into(),
                name: id.into(),
                path: folder.to_string_lossy().into(),
                description: String::new(),
                tags: vec![],
                obsidian_vault_id: None,
                favorite: false,
                favorite_order: None,
                created_at: String::new(),
                updated_at: String::new(),
                last_opened_at: None,
                role: Some(role),
            });
        }
        config
    }
    #[test]
    fn validates_roles_hashes_paths_and_preserves_notes() {
        let dir = tempfile::tempdir().unwrap();
        let config = fixture(dir.path());
        let mut req = request(true);
        let hash = workspace_actions::content_hash(b"# private body");
        req.source_hash = hash.clone();
        req.target_hash = hash.clone();
        validate(&config, &req).unwrap();
        req.source_hash = "outdated".into();
        assert_eq!(
            validate(&config, &req).unwrap_err().code,
            "WORKSPACE_CONFLICT"
        );
        req.source_hash = hash;
        req.link.target.relative_path = "../a.md".into();
        assert!(validate(&config, &req).is_err());
        req.link.target.relative_path = "a.md".into();
        req.link.source.vault_id = "knowledge".into();
        assert_eq!(
            validate(&config, &req).unwrap_err().code,
            "WORKFLOW_LINK_ROLE_INVALID"
        );
        req.link.source.vault_id = "echo".into();
        req.link.target.relative_path = "missing.md".into();
        assert!(validate(&config, &req).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("echo/a.md")).unwrap(),
            "# private body"
        );
    }
    #[test]
    fn parses_references_and_ignores_malformed_fields() {
        let links = parse(
            "---\norigin: broken\nreferences: [{\"vault_id\":\"knowledge\",\"path\":\"a.md\"},{\"vault_id\":\"knowledge\",\"path\":\"a.md\"}]\n---\n# Body",
            note("output"),
        );
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].kind, "reference");
    }
    #[test]
    fn concurrent_updates_keep_every_distinct_link() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("links.json");
        std::thread::scope(|scope| {
            for n in 0..12 {
                let path = &path;
                scope.spawn(move || {
                    let _guard = LOCK.lock().unwrap();
                    let mut req = request(true);
                    req.link.target.relative_path = format!("{n}.md");
                    update_path(path, &req).unwrap();
                });
            }
        });
        assert_eq!(load_path(&path).unwrap().links.len(), 12);
    }
    #[test]
    fn parses_generated_crlf_and_rejects_body_and_traversal() {
        let links = parse(
            "---\r\norigin: {\"vault_id\":\"echo\",\"path\":\"a.md\"}\r\nreferences: [{\"vault_id\":\"k\",\"path\":\"../bad.md\"}]\r\n---\r\n",
            note("main"),
        );
        assert_eq!(links, vec![request(true).link]);
        assert!(parse("# Body\norigin: {}", note("main")).is_empty());
        assert!(
            parse(
                "---\norigin: {\"vault_id\":\"echo\",\"path\":\"a.md\"}",
                note("main")
            )
            .is_empty()
        );
    }
    #[test]
    fn persistent_links_are_idempotent_and_removable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("links.json");
        update_path(&path, &request(true)).unwrap();
        update_path(&path, &request(true)).unwrap();
        assert_eq!(load_path(&path).unwrap().links.len(), 1);
        update_path(&path, &request(false)).unwrap();
        assert!(load_path(&path).unwrap().links.is_empty());
    }
    #[test]
    fn corrupt_and_future_files_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("links.json");
        for content in ["broken", "{\"schemaVersion\":2,\"links\":[]}"] {
            fs::write(&path, content).unwrap();
            assert!(update_path(&path, &request(true)).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
    }
}
