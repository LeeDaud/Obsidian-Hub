use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;

const CACHE_FILE_NAME: &str = "overview-cache.json";
const IGNORED_DIRECTORIES: &[&str] = &[
    ".obsidian",
    ".git",
    "node_modules",
    ".trash",
    "$recycle.bin",
    "recycler",
    "target",
    "dist",
    ".cache",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultOverview {
    pub vault_count: usize,
    pub scanned_vault_count: usize,
    pub note_count: usize,
    pub folder_count: usize,
    pub scanned_at: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverviewCache {
    paths: Vec<String>,
    overview: VaultOverview,
}

fn normalized_paths(paths: &[String]) -> Vec<String> {
    let mut normalized: Vec<_> = paths
        .iter()
        .map(|path| path.trim_end_matches(['\\', '/']).to_lowercase())
        .collect();
    normalized.sort_unstable();
    normalized
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(CACHE_FILE_NAME))
        .map_err(|_| AppError::new("OVERVIEW_CACHE_PATH_FAILED", "无法定位概览缓存目录。"))
}

pub fn load_cache(app: &AppHandle, paths: &[String]) -> Result<Option<VaultOverview>, AppError> {
    let path = cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)
        .map_err(|_| AppError::new("OVERVIEW_CACHE_READ_FAILED", "无法读取库概览缓存。"))?;
    let cache: OverviewCache = serde_json::from_str(&contents)
        .map_err(|_| AppError::new("OVERVIEW_CACHE_INVALID", "库概览缓存已损坏。"))?;
    if cache.paths != normalized_paths(paths) {
        return Ok(None);
    }
    Ok(Some(cache.overview))
}

fn save_cache(app: &AppHandle, paths: &[String], overview: &VaultOverview) -> Result<(), AppError> {
    let path = cache_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| AppError::new("OVERVIEW_CACHE_PATH_FAILED", "概览缓存路径无效。"))?;
    fs::create_dir_all(directory)
        .map_err(|_| AppError::new("OVERVIEW_CACHE_WRITE_FAILED", "无法创建概览缓存目录。"))?;
    let cache = OverviewCache {
        paths: normalized_paths(paths),
        overview: overview.clone(),
    };
    let mut temporary = NamedTempFile::new_in(directory)
        .map_err(|_| AppError::new("OVERVIEW_CACHE_WRITE_FAILED", "无法创建概览缓存文件。"))?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), &cache)
        .map_err(|_| AppError::new("OVERVIEW_CACHE_WRITE_FAILED", "无法写入概览缓存。"))?;
    temporary
        .as_file_mut()
        .write_all(b"\n")
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|_| AppError::new("OVERVIEW_CACHE_WRITE_FAILED", "无法保存概览缓存。"))?;
    temporary
        .persist(path)
        .map_err(|_| AppError::new("OVERVIEW_CACHE_WRITE_FAILED", "无法替换概览缓存。"))?;
    Ok(())
}

fn should_ignore(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| IGNORED_DIRECTORIES.iter().any(|ignored| name.eq_ignore_ascii_case(ignored)))
}

fn scan_directory(path: &Path, overview: &mut VaultOverview) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if should_ignore(&entry_path) {
                continue;
            }
            overview.folder_count += 1;
            scan_directory(&entry_path, overview);
        } else if file_type.is_file()
            && entry_path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            overview.note_count += 1;
        }
    }
}

pub fn scan(app: &AppHandle, paths: &[String]) -> Result<VaultOverview, AppError> {
    let mut overview = VaultOverview {
        vault_count: paths.len(),
        scanned_vault_count: 0,
        note_count: 0,
        folder_count: 0,
        scanned_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };
    for path in paths {
        let root = Path::new(path);
        if root.is_dir() {
            overview.scanned_vault_count += 1;
            scan_directory(root, &mut overview);
        }
    }
    save_cache(app, paths, &overview)?;
    Ok(overview)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{scan_directory, VaultOverview};

    #[test]
    fn counts_markdown_and_folders_while_ignoring_internal_directories() {
        let root = tempdir().expect("create root");
        fs::create_dir_all(root.path().join("Notes/Topic")).expect("create note folders");
        fs::create_dir_all(root.path().join(".obsidian/plugins/demo")).expect("create config");
        fs::write(root.path().join("Home.md"), "# Home").expect("write home");
        fs::write(root.path().join("Notes/Topic/Idea.MD"), "# Idea").expect("write idea");
        fs::write(root.path().join(".obsidian/plugins/demo/readme.md"), "ignored")
            .expect("write ignored note");

        let mut overview = VaultOverview {
            vault_count: 1,
            scanned_vault_count: 1,
            note_count: 0,
            folder_count: 0,
            scanned_at: 0,
        };
        scan_directory(root.path(), &mut overview);

        assert_eq!(overview.note_count, 2);
        assert_eq!(overview.folder_count, 2);
    }
}
