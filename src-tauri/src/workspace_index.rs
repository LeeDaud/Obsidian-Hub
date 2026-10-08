use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::{
    config,
    error::AppError,
    note_index::{self, IndexedNote},
    workspace_actions::{content_hash, task_marker},
};

const MAX_TASK_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
const CACHE_FILE_NAME: &str = "workspace-cache.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    pub vault_id: String,
    pub vault_name: String,
    pub relative_path: String,
    pub line_number: usize,
    pub text: String,
    pub complete: bool,
    pub content_hash: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultScanStatus {
    pub vault_id: String,
    pub online: bool,
    pub read_errors: usize,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub notes: Vec<IndexedNote>,
    #[serde(default)]
    pub relations: Vec<crate::workflow_links::Link>,
    #[serde(default)]
    pub link_candidates: Vec<crate::link_candidates::Candidates>,
    pub tasks: Vec<TaskItem>,
    pub vault_statuses: Vec<VaultScanStatus>,
    pub scanned_at: u64,
    pub from_cache: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCache {
    schema_version: u32,
    registry: Vec<(String, String)>,
    snapshot: WorkspaceSnapshot,
}

fn registry_key(vaults: &[config::VaultEntry]) -> Vec<(String, String)> {
    let mut registry: Vec<_> = vaults
        .iter()
        .map(|vault| (vault.id.clone(), vault.path.to_lowercase()))
        .collect();
    registry.sort_unstable();
    registry
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(CACHE_FILE_NAME))
        .map_err(|_| AppError::new("WORKSPACE_CACHE_PATH_FAILED", "无法定位工作台缓存目录。"))
}

pub fn load_cache(app: &AppHandle) -> Result<Option<WorkspaceSnapshot>, AppError> {
    let path = cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)
        .map_err(|_| AppError::new("WORKSPACE_CACHE_READ_FAILED", "无法读取工作台缓存。"))?;
    let cache: WorkspaceCache = serde_json::from_str(&contents)
        .map_err(|_| AppError::new("WORKSPACE_CACHE_INVALID", "工作台缓存已损坏。"))?;
    if cache.schema_version != 1
        || cache.registry != registry_key(&config::load_config(app)?.vaults)
    {
        return Ok(None);
    }
    Ok(Some(cache.snapshot))
}

fn save_cache(
    app: &AppHandle,
    vaults: &[config::VaultEntry],
    snapshot: &WorkspaceSnapshot,
) -> Result<(), AppError> {
    let path = cache_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("WORKSPACE_CACHE_PATH_FAILED", "工作台缓存路径无效。"))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("WORKSPACE_CACHE_WRITE_FAILED", "无法创建工作台缓存目录。"))?;
    let cache = WorkspaceCache {
        schema_version: 1,
        registry: registry_key(vaults),
        snapshot: WorkspaceSnapshot {
            notes: snapshot.notes.clone(),
            relations: Vec::new(),
            link_candidates: Vec::new(),
            tasks: Vec::new(),
            vault_statuses: snapshot.vault_statuses.clone(),
            scanned_at: snapshot.scanned_at,
            from_cache: true,
        },
    };
    let mut temporary = NamedTempFile::new_in(parent).map_err(|_| {
        AppError::new(
            "WORKSPACE_CACHE_WRITE_FAILED",
            "无法创建工作台缓存临时文件。",
        )
    })?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), &cache)
        .map_err(|_| AppError::new("WORKSPACE_CACHE_WRITE_FAILED", "无法写入工作台缓存。"))?;
    temporary
        .as_file_mut()
        .write_all(b"\n")
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|_| AppError::new("WORKSPACE_CACHE_WRITE_FAILED", "无法保存工作台缓存。"))?;
    temporary
        .persist(path)
        .map_err(|_| AppError::new("WORKSPACE_CACHE_WRITE_FAILED", "无法替换工作台缓存。"))?;
    Ok(())
}

pub(crate) fn tasks_in_note(note: &IndexedNote, contents: &[u8]) -> Vec<TaskItem> {
    let Ok(text) = std::str::from_utf8(contents) else {
        return Vec::new();
    };
    let hash = content_hash(contents);
    let mut fenced = false;
    let mut frontmatter = text.starts_with("---\n");
    let mut tasks = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim_start();
        if frontmatter {
            if index > 0 && trimmed == "---" {
                frontmatter = false;
            }
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let Some(marker) = task_marker(line) else {
            continue;
        };
        let item = line[marker + 2..].trim();
        tasks.push(TaskItem {
            id: format!("{}:{}:{}", note.vault_id, note.relative_path, index + 1),
            vault_id: note.vault_id.clone(),
            vault_name: note.vault_name.clone(),
            relative_path: note.relative_path.clone(),
            line_number: index + 1,
            text: item.to_owned(),
            complete: line.as_bytes()[marker] != b' ',
            content_hash: hash.clone(),
        });
    }
    tasks
}

pub fn scan(app: &AppHandle) -> Result<WorkspaceSnapshot, AppError> {
    let config = config::load_config(app)?;
    let mut vault_statuses: Vec<_> = config
        .vaults
        .iter()
        .map(|vault| VaultScanStatus {
            vault_id: vault.id.clone(),
            online: Path::new(&vault.path).join(".obsidian").is_dir(),
            read_errors: 0,
        })
        .collect();
    let notes = note_index::build(&config.vaults);
    let mut tasks = Vec::new();
    let mut relations = Vec::new();
    let mut link_candidates = Vec::new();
    let mut read_errors: HashMap<String, usize> = HashMap::new();
    for note in &notes {
        let Some(vault) = config.vaults.iter().find(|vault| vault.id == note.vault_id) else {
            continue;
        };
        if note.size > MAX_TASK_SOURCE_BYTES {
            *read_errors.entry(note.vault_id.clone()).or_default() += 1;
            continue;
        }
        let Ok(root) = fs::canonicalize(&vault.path) else {
            *read_errors.entry(note.vault_id.clone()).or_default() += 1;
            continue;
        };
        let Ok(target) = fs::canonicalize(root.join(&note.relative_path)) else {
            *read_errors.entry(note.vault_id.clone()).or_default() += 1;
            continue;
        };
        if !target.starts_with(&root) || !target.is_file() {
            *read_errors.entry(note.vault_id.clone()).or_default() += 1;
            continue;
        }
        match fs::read(target) {
            Ok(contents) if std::str::from_utf8(&contents).is_ok() => {
                tasks.extend(tasks_in_note(note, &contents));
                link_candidates.push(crate::link_candidates::extract(
                    std::str::from_utf8(&contents).unwrap_or_default(),
                    crate::workflow_links::NoteRef {
                        vault_id: note.vault_id.clone(),
                        relative_path: note.relative_path.clone(),
                    },
                ));
                relations.extend(crate::workflow_links::parse(
                    std::str::from_utf8(&contents).unwrap_or_default(),
                    crate::workflow_links::NoteRef {
                        vault_id: note.vault_id.clone(),
                        relative_path: note.relative_path.clone(),
                    },
                ));
            }
            _ => *read_errors.entry(note.vault_id.clone()).or_default() += 1,
        }
    }
    for status in &mut vault_statuses {
        status.read_errors = read_errors
            .get(&status.vault_id)
            .copied()
            .unwrap_or_default();
    }
    tasks.sort_by(|a, b| {
        a.complete
            .cmp(&b.complete)
            .then_with(|| a.vault_name.cmp(&b.vault_name))
            .then_with(|| a.relative_path.cmp(&b.relative_path))
            .then_with(|| a.line_number.cmp(&b.line_number))
    });
    let snapshot = WorkspaceSnapshot {
        notes,
        relations,
        link_candidates,
        tasks,
        vault_statuses,
        scanned_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        from_cache: false,
    };
    let _ = save_cache(app, &config.vaults, &snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::tasks_in_note;
    use crate::note_index::IndexedNote;

    #[test]
    fn scans_tasks_outside_code_blocks_with_stable_lines() {
        let note = IndexedNote {
            id: "v:note.md".into(),
            vault_id: "v".into(),
            vault_name: "Vault".into(),
            relative_path: "note.md".into(),
            file_name: "note.md".into(),
            title: "note".into(),
            aliases: vec![],
            tags: vec![],
            modified_at: 0,
            size: 0,
            content_hash: String::new(),
        };
        let items = tasks_in_note(
            &note,
            b"- [ ] first\n```md\n- [ ] code\n```\n  - [x] done\n",
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].line_number, 1);
        assert_eq!(items[1].line_number, 5);
        assert!(items[1].complete);
        let with_frontmatter =
            tasks_in_note(&note, b"---\nlist:\n- [ ] metadata\n---\n- [ ] real\n");
        assert_eq!(with_frontmatter.len(), 1);
        assert_eq!(with_frontmatter[0].line_number, 5);
    }
}
