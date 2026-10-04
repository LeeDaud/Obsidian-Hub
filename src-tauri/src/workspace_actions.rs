use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

use chrono::Utc;
use rand::random;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tempfile::NamedTempFile;
use url::Url;

use crate::{
    config::{self, AppConfig, VaultEntry, VaultRole},
    error::AppError,
};

const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    pub vault_id: String,
    pub relative_path: String,
    pub content_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePreview {
    pub vault_id: String,
    pub vault_name: String,
    pub relative_path: String,
    pub content: String,
    pub content_hash: String,
    pub changed: bool,
}

pub(crate) fn content_hash(contents: &[u8]) -> String {
    format!("{:x}", Sha256::digest(contents))
}

fn vault_with_role<'a>(
    config: &'a AppConfig,
    id: &str,
    role: VaultRole,
) -> Result<&'a VaultEntry, AppError> {
    config
        .vaults
        .iter()
        .find(|vault| vault.id == id && vault.role == Some(role))
        .ok_or_else(|| AppError::new("VAULT_ROLE_MISSING", "尚未配置所需的仓库角色。"))
}

fn vault_root(vault: &VaultEntry) -> Result<PathBuf, AppError> {
    let root = fs::canonicalize(&vault.path)
        .map_err(|_| AppError::new("VAULT_OFFLINE", "仓库路径不可访问。"))?;
    if !root.join(".obsidian").is_dir() {
        return Err(AppError::new(
            "VAULT_MARKER_NOT_FOUND",
            "目标路径不是 Obsidian 仓库。",
        ));
    }
    Ok(root)
}

fn relative_markdown(path: &str) -> Result<PathBuf, AppError> {
    let relative = Path::new(path);
    if relative.as_os_str().is_empty()
        || relative
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("md"))
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || path.contains('\\')
    {
        return Err(AppError::new(
            "NOTE_PATH_INVALID",
            "只允许仓库内的相对 Markdown 路径。",
        ));
    }
    Ok(relative.to_path_buf())
}

fn existing_note(vault: &VaultEntry, path: &str) -> Result<PathBuf, AppError> {
    let root = vault_root(vault)?;
    let relative = relative_markdown(path)?;
    let target = fs::canonicalize(root.join(relative))
        .map_err(|_| AppError::new("NOTE_NOT_FOUND", "笔记已移动或不可访问。"))?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(AppError::new(
            "NOTE_PATH_INVALID",
            "笔记真实路径不在登记仓库内。",
        ));
    }
    Ok(target)
}

fn read_note(path: &Path) -> Result<Vec<u8>, AppError> {
    let metadata =
        fs::metadata(path).map_err(|_| AppError::new("NOTE_READ_FAILED", "无法读取笔记状态。"))?;
    if metadata.len() > MAX_NOTE_BYTES {
        return Err(AppError::new(
            "NOTE_TOO_LARGE",
            "笔记超过工作流允许的大小。",
        ));
    }
    let contents =
        fs::read(path).map_err(|_| AppError::new("NOTE_READ_FAILED", "无法读取笔记。"))?;
    if contents.len() as u64 > MAX_NOTE_BYTES {
        return Err(AppError::new(
            "NOTE_TOO_LARGE",
            "笔记超过工作流允许的大小。",
        ));
    }
    Ok(contents)
}

pub fn read_preview(
    app: &AppHandle,
    vault_id: &str,
    relative_path: &str,
    expected_hash: Option<&str>,
) -> Result<NotePreview, AppError> {
    let config = config::load_config(app)?;
    read_preview_with_config(&config, vault_id, relative_path, expected_hash)
}

pub(crate) fn read_preview_with_config(
    config: &AppConfig,
    vault_id: &str,
    relative_path: &str,
    expected_hash: Option<&str>,
) -> Result<NotePreview, AppError> {
    let vault = config
        .vaults
        .iter()
        .find(|vault| vault.id == vault_id)
        .ok_or_else(|| AppError::new("VAULT_NOT_FOUND", "仓库未登记或已被移除。"))?;
    let contents = read_note(&existing_note(vault, relative_path)?)?;
    let content = String::from_utf8(contents)
        .map_err(|_| AppError::new("NOTE_ENCODING_INVALID", "笔记不是有效的 UTF-8 文本。"))?;
    let hash = content_hash(content.as_bytes());
    Ok(NotePreview {
        vault_id: vault.id.clone(),
        vault_name: vault.name.clone(),
        relative_path: relative_path.to_owned(),
        changed: expected_hash.is_some_and(|expected| !expected.is_empty() && expected != hash),
        content,
        content_hash: hash,
    })
}

fn checked_note(path: &Path, expected_hash: &str) -> Result<Vec<u8>, AppError> {
    let contents = read_note(path)?;
    if expected_hash.is_empty() || content_hash(&contents) != expected_hash {
        return Err(AppError::new(
            "NOTE_CHANGED",
            "笔记已在其他位置修改，请刷新后重试。",
        ));
    }
    Ok(contents)
}

fn safe_parent(root: &Path, relative: &Path) -> Result<PathBuf, AppError> {
    let mut parent = root.to_path_buf();
    if let Some(components) = relative.parent() {
        for component in components.components() {
            let Component::Normal(name) = component else {
                return Err(AppError::new("NOTE_PATH_INVALID", "目标路径无效。"));
            };
            parent.push(name);
            let metadata = fs::symlink_metadata(&parent).map_err(|_| {
                AppError::new(
                    "NOTE_PARENT_MISSING",
                    "目标文件夹不存在，请先在 Obsidian 中创建。",
                )
            })?;
            if metadata.file_type().is_symlink()
                || !metadata.is_dir()
                || !fs::canonicalize(&parent)
                    .map(|path| path.starts_with(root))
                    .unwrap_or(false)
            {
                return Err(AppError::new(
                    "NOTE_PATH_INVALID",
                    "目标文件夹包含链接或不是目录。",
                ));
            }
        }
    }
    Ok(parent)
}

fn safe_destination(root: &Path, relative: &Path) -> Result<PathBuf, AppError> {
    safe_parent(root, relative)?;
    let target = root.join(relative);
    if target.exists() || fs::symlink_metadata(&target).is_ok() {
        return Err(AppError::new(
            "NOTE_TARGET_EXISTS",
            "目标笔记已存在，请更名后重试。",
        ));
    }
    Ok(target)
}

fn create_new_note(target: &Path, contents: &[u8]) -> Result<(), AppError> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::new("NOTE_PATH_INVALID", "目标路径无效。"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|_| AppError::new("NOTE_WRITE_FAILED", "无法创建临时笔记。"))?;
    temporary
        .write_all(contents)
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|_| AppError::new("NOTE_WRITE_FAILED", "无法写入临时笔记。"))?;
    temporary
        .persist_noclobber(target)
        .map_err(|_| AppError::new("NOTE_TARGET_EXISTS", "目标笔记已存在或无法创建。"))?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSource {
    pub vault_id: String,
    pub relative_path: String,
    pub content_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub kind: String,
    pub title: String,
    pub source: NoteSource,
    pub references: Vec<NoteSource>,
}

fn valid_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    !name.is_empty()
        && name == name.trim()
        && !name.starts_with('.')
        && !name.ends_with('.')
        && name.encode_utf16().count() <= 180
        && !name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
        && !reserved
}

pub(crate) fn note_destination(title: &str, folder: &str) -> Result<String, AppError> {
    if !valid_name(title) || title.to_lowercase().ends_with(".md") {
        return Err(AppError::new(
            "NOTE_NAME_INVALID",
            "请输入有效的 Windows 文件名作为标题，无需填写 .md 扩展名。",
        ));
    }
    if !folder.is_empty() && !folder.split('/').all(valid_name) {
        return Err(AppError::new(
            "NOTE_PATH_INVALID",
            "目录须为仓库内已有的相对目录，用 / 分隔，不能包含隐藏目录或无效名称。",
        ));
    }
    Ok(if folder.is_empty() {
        format!("{title}.md")
    } else {
        format!("{folder}/{title}.md")
    })
}

pub fn validate_workflow_folders(config: &AppConfig) -> Result<(), AppError> {
    for (role, folder) in [
        (VaultRole::Main, &config.workspace.main_folder),
        (VaultRole::Output, &config.workspace.output_folder),
    ] {
        let path = note_destination("workflow-validation", folder)?;
        if folder.is_empty() {
            continue;
        }
        let vault = config
            .vaults
            .iter()
            .find(|vault| vault.role == Some(role))
            .ok_or_else(|| {
                AppError::new("VAULT_ROLE_MISSING", "请先配置保存目录对应的目标仓库。")
            })?;
        let root = vault_root(vault)?;
        safe_parent(&root, &relative_markdown(&path)?)?;
    }
    Ok(())
}

fn escape_link(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        if "\\|#^]".contains(ch) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn source_link(vault: &VaultEntry, path: &str) -> Result<String, AppError> {
    if vault.name.contains("[[")
        || vault.name.contains("【【")
        || vault.name.chars().any(char::is_control)
        || vault
            .id
            .chars()
            .any(|ch| ch.is_control() || ":[]【】\\".contains(ch))
        || path.chars().any(char::is_control)
    {
        return Err(AppError::new(
            "LINK_SOURCE_INVALID",
            "来源名称包含跨库链接无法表示的字符，请先在 Obsidian 或仓库设置中调整。",
        ));
    }
    Ok(format!(
        "@{}:{}[[{}]]",
        escape_link(&vault.name),
        vault.id,
        escape_link(path)
    ))
}

pub fn create_note(app: &AppHandle, request: CreateNoteRequest) -> Result<FileResult, AppError> {
    create_note_with_config(&config::load_config(app)?, &request)
}

fn create_note_with_config(
    config: &AppConfig,
    request: &CreateNoteRequest,
) -> Result<FileResult, AppError> {
    let (source_role, target_role, kind_label) = match request.kind.as_str() {
        "cognition" => (VaultRole::Echo, VaultRole::Main, "灵感"),
        "output" => (VaultRole::Main, VaultRole::Output, "认知"),
        _ => return Err(AppError::new("WORKFLOW_STAGE_INVALID", "创建类型无效。")),
    };
    if request.references.len() > 50
        || (request.kind == "cognition" && !request.references.is_empty())
    {
        return Err(AppError::new(
            "REFERENCES_INVALID",
            "认知笔记不接收资料列表；输出笔记最多选择 50 份资料。",
        ));
    }
    let folder = if target_role == VaultRole::Main {
        &config.workspace.main_folder
    } else {
        &config.workspace.output_folder
    };
    let relative_path = note_destination(&request.title, folder)?;
    let source = vault_with_role(config, &request.source.vault_id, source_role)?;
    let source_path = existing_note(source, &request.source.relative_path)?;
    checked_note(&source_path, &request.source.content_hash)?;
    let destination = config
        .vaults
        .iter()
        .find(|vault| vault.role == Some(target_role))
        .ok_or_else(|| AppError::new("VAULT_ROLE_MISSING", "请先配置目标仓库角色。"))?;
    let root = vault_root(destination)?;
    let target = safe_destination(&root, &relative_markdown(&relative_path)?)?;
    let mut links = format!(
        "- {kind_label}： {}\n",
        source_link(source, &request.source.relative_path)?
    );
    let mut seen = std::collections::HashSet::new();
    for reference in &request.references {
        if !seen.insert((&reference.vault_id, &reference.relative_path)) {
            return Err(AppError::new(
                "REFERENCES_INVALID",
                "不能重复选择同一份资料。",
            ));
        }
        let vault = vault_with_role(config, &reference.vault_id, VaultRole::Knowledge)?;
        checked_note(
            &existing_note(vault, &reference.relative_path)?,
            &reference.content_hash,
        )?;
        links.push_str(&format!(
            "- 参考： {}\n",
            source_link(vault, &reference.relative_path)?
        ));
    }
    let origin = serde_json::json!({"vault_id": source.id, "path": request.source.relative_path});
    let references: Vec<_> = request.references.iter()
        .map(|reference| serde_json::json!({"vault_id": reference.vault_id, "path": reference.relative_path}))
        .collect();
    let contents = format!(
        "---\nhub_id: \"{:032x}\"\nhub_kind: {}\nstatus: draft\ncreated_at: {}\norigin: {}\nreferences: {}\n---\n\n# {}\n\n## 来源\n\n{}\n## 正文\n\n",
        random::<u128>(),
        request.kind,
        Utc::now().to_rfc3339(),
        origin,
        serde_json::to_string(&references).expect("JSON reference values are serializable"),
        request.title,
        links
    );
    // Revalidate sources and the destination immediately before the no-clobber write.
    checked_note(
        &existing_note(source, &request.source.relative_path)?,
        &request.source.content_hash,
    )?;
    for reference in &request.references {
        let vault = vault_with_role(config, &reference.vault_id, VaultRole::Knowledge)?;
        checked_note(
            &existing_note(vault, &reference.relative_path)?,
            &reference.content_hash,
        )?;
    }
    safe_destination(&root, &relative_markdown(&relative_path)?)?;
    create_new_note(&target, contents.as_bytes())?;
    Ok(FileResult {
        vault_id: destination.id.clone(),
        relative_path,
        content_hash: content_hash(contents.as_bytes()),
    })
}

pub fn set_task_complete(
    app: &AppHandle,
    vault_id: &str,
    relative_path: &str,
    line_number: usize,
    expected_hash: &str,
    complete: bool,
) -> Result<FileResult, AppError> {
    let config = config::load_config(app)?;
    set_task_complete_with_config(
        &config,
        vault_id,
        relative_path,
        line_number,
        expected_hash,
        complete,
    )
}

fn set_task_complete_with_config(
    config: &AppConfig,
    vault_id: &str,
    relative_path: &str,
    line_number: usize,
    expected_hash: &str,
    complete: bool,
) -> Result<FileResult, AppError> {
    let vault = config
        .vaults
        .iter()
        .find(|vault| vault.id == vault_id)
        .ok_or_else(|| AppError::new("VAULT_NOT_FOUND", "任务来源仓库未登记。"))?;
    let target = existing_note(vault, relative_path)?;
    let contents = checked_note(&target, expected_hash)?;
    let mut text = String::from_utf8(contents)
        .map_err(|_| AppError::new("NOTE_ENCODING_INVALID", "任务笔记不是 UTF-8 编码。"))?;
    let mut offset = 0;
    let mut changed = false;
    let mut fenced = false;
    let mut frontmatter = text.starts_with("---\n");
    for (index, line) in text.clone().split_inclusive('\n').enumerate() {
        let trimmed = line.trim_start();
        if frontmatter {
            if index > 0 && trimmed.trim_end() == "---" {
                frontmatter = false;
            }
            if index + 1 == line_number {
                return Err(AppError::new(
                    "TASK_NOT_FOUND",
                    "Frontmatter 中的内容不是可操作任务。",
                ));
            }
            offset += line.len();
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
        }
        if index + 1 == line_number {
            if fenced {
                return Err(AppError::new(
                    "TASK_NOT_FOUND",
                    "代码块中的内容不是可操作任务。",
                ));
            }
            let marker = task_marker(line)
                .ok_or_else(|| AppError::new("TASK_NOT_FOUND", "原位置已不是 Markdown 任务。"))?;
            text.replace_range(
                offset + marker..offset + marker + 1,
                if complete { "x" } else { " " },
            );
            changed = true;
            break;
        }
        offset += line.len();
    }
    if !changed {
        return Err(AppError::new(
            "TASK_NOT_FOUND",
            "任务行已移动，请刷新后重试。",
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| AppError::new("NOTE_PATH_INVALID", "任务路径无效。"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|_| AppError::new("NOTE_WRITE_FAILED", "无法创建临时笔记。"))?;
    temporary
        .write_all(text.as_bytes())
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|_| AppError::new("NOTE_WRITE_FAILED", "无法保存任务更改。"))?;
    if content_hash(&read_note(&target)?) != expected_hash {
        return Err(AppError::new(
            "NOTE_CHANGED",
            "笔记在任务更新期间发生变化，请刷新后重试。",
        ));
    }
    temporary
        .persist(&target)
        .map_err(|_| AppError::new("NOTE_WRITE_FAILED", "无法替换原笔记。"))?;
    Ok(FileResult {
        vault_id: vault_id.to_owned(),
        relative_path: relative_path.to_owned(),
        content_hash: content_hash(text.as_bytes()),
    })
}

fn build_open_note_uri(target: &Path) -> Url {
    let path = target.to_string_lossy();
    let display_path = path
        .strip_prefix(r"\\?\UNC\")
        .map(|value| format!(r"\\{value}"))
        .or_else(|| path.strip_prefix(r"\\?\").map(str::to_owned))
        .unwrap_or_else(|| path.into_owned());
    let mut uri = Url::parse("obsidian://open").expect("static Obsidian URI must be valid");
    uri.query_pairs_mut().append_pair("path", &display_path);
    uri
}

pub fn open_note(app: &AppHandle, vault_id: &str, relative_path: &str) -> Result<String, AppError> {
    let config = config::load_config(app)?;
    let vault = config
        .vaults
        .iter()
        .find(|vault| vault.id == vault_id)
        .ok_or_else(|| AppError::new("VAULT_NOT_FOUND", "笔记来源仓库未登记。"))?;
    let target = existing_note(vault, relative_path)?;
    let uri = build_open_note_uri(&target);
    app.opener()
        .open_url(uri.as_str(), None::<&str>)
        .map_err(|_| AppError::new("OBSIDIAN_LAUNCH_FAILED", "系统未能打开目标笔记。"))?;
    Ok(uri.into())
}

pub(crate) fn task_marker(line: &str) -> Option<usize> {
    let leading = line.len() - line.trim_start_matches([' ', '\t']).len();
    let rest = &line[leading..];
    let bytes = rest.as_bytes();
    if bytes.len() >= 5
        && matches!(bytes[0], b'-' | b'*' | b'+')
        && bytes[1] == b' '
        && bytes[2] == b'['
        && matches!(bytes[3], b' ' | b'x' | b'X')
        && bytes[4] == b']'
    {
        Some(leading + 3)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn obsidian_uri_removes_windows_extended_path_prefix() {
        let drive = build_open_note_uri(Path::new(r"\\?\D:\Notes\Leedaud\Idea.md"));
        assert_eq!(
            drive
                .query_pairs()
                .find(|(key, _)| key == "path")
                .unwrap()
                .1,
            r"D:\Notes\Leedaud\Idea.md"
        );
        let unc = build_open_note_uri(Path::new(r"\\?\UNC\server\notes\Idea.md"));
        assert_eq!(
            unc.query_pairs().find(|(key, _)| key == "path").unwrap().1,
            r"\\server\notes\Idea.md"
        );
    }

    fn vault(id: &str, path: &Path, role: VaultRole) -> VaultEntry {
        fs::create_dir_all(path.join(".obsidian")).unwrap();
        VaultEntry {
            id: id.into(),
            name: id.into(),
            path: path.to_string_lossy().into_owned(),
            description: String::new(),
            tags: vec![],
            obsidian_vault_id: None,
            favorite: false,
            favorite_order: None,
            created_at: String::new(),
            updated_at: String::new(),
            last_opened_at: None,
            role: Some(role),
        }
    }
    fn fixture(root: &Path) -> AppConfig {
        let mut config = AppConfig::default();
        config.vaults = vec![
            vault("echo", &root.join("echo"), VaultRole::Echo),
            vault("main", &root.join("main"), VaultRole::Main),
            vault("knowledge", &root.join("knowledge"), VaultRole::Knowledge),
            vault("output", &root.join("output"), VaultRole::Output),
        ];
        config
    }
    fn source(root: &Path, id: &str, name: &str) -> NoteSource {
        let path = root.join(id).join(name);
        fs::write(&path, "# Original\n\nPrivate original body\n").unwrap();
        NoteSource {
            vault_id: id.into(),
            relative_path: name.into(),
            content_hash: content_hash(&fs::read(path).unwrap()),
        }
    }
    fn request(source: NoteSource) -> CreateNoteRequest {
        CreateNoteRequest {
            kind: "cognition".into(),
            title: "我的认知".into(),
            source,
            references: vec![],
        }
    }

    #[test]
    fn direct_flow_preserves_sources_and_generates_links_without_hub() {
        let root = tempdir().unwrap();
        let mut config = fixture(root.path());
        assert!(config.workspace.hub_vault_id.is_none());
        let echo = source(root.path(), "echo", "想法 #1].md");
        let first = create_note_with_config(&config, &request(echo.clone())).unwrap();
        assert_eq!(first.vault_id, "main");
        let main_text =
            fs::read_to_string(root.path().join("main").join(&first.relative_path)).unwrap();
        assert!(main_text.contains("# 我的认知\n"));
        assert!(main_text.contains(r"@echo:echo[[想法 \#1\].md]]"));
        assert!(!main_text.contains("Private original body"));
        assert_eq!(
            content_hash(&fs::read(root.path().join("echo").join(&echo.relative_path)).unwrap()),
            echo.content_hash
        );
        let reference_a = source(root.path(), "knowledge", "资料 A.md");
        let reference_b = source(root.path(), "knowledge", "资料 B.md");
        fs::create_dir(root.path().join("output/文章")).unwrap();
        config.workspace.output_folder = "文章".into();
        let second = CreateNoteRequest {
            kind: "output".into(),
            title: "完整输出".into(),
            source: NoteSource {
                vault_id: first.vault_id,
                relative_path: first.relative_path.clone(),
                content_hash: first.content_hash.clone(),
            },
            references: vec![reference_a.clone(), reference_b.clone()],
        };
        let output = create_note_with_config(&config, &second).unwrap();
        let output_text =
            fs::read_to_string(root.path().join("output").join(&output.relative_path)).unwrap();
        assert!(output_text.contains("@main:main[[我的认知.md]]"));
        assert!(output_text.contains("@knowledge:knowledge[[资料 A.md]]"));
        assert!(output_text.contains("@knowledge:knowledge[[资料 B.md]]"));
        assert!(output_text.ends_with("## 正文\n\n"));
        assert_eq!(
            content_hash(&fs::read(root.path().join("main").join(first.relative_path)).unwrap()),
            first.content_hash
        );
        for reference in [reference_a, reference_b] {
            assert_eq!(
                content_hash(
                    &fs::read(root.path().join("knowledge").join(reference.relative_path)).unwrap()
                ),
                reference.content_hash
            );
        }
        assert_eq!(
            create_note_with_config(&config, &second).unwrap_err().code,
            "NOTE_TARGET_EXISTS"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("output/文章/完整输出.md")).unwrap(),
            output_text
        );
    }

    #[test]
    fn rejects_invalid_windows_names_and_directories() {
        for title in [
            "",
            "CON",
            "nul.txt",
            "COM1",
            "LPT²",
            "a:b",
            "a/b",
            "a\\b",
            "a*",
            "a?",
            "a.",
            " a",
            "a ",
            "a\nb",
            ".obsidian",
            "note.md",
        ] {
            assert!(note_destination(title, "").is_err(), "{title}");
        }
        for folder in [
            "../",
            "../outside",
            "/abs",
            "C:/abs",
            "a//b",
            "a/../b",
            ".obsidian",
            "a\\b",
            "a/",
        ] {
            assert!(note_destination("标题", folder).is_err(), "{folder}");
        }
        assert_eq!(
            note_destination("为什么学习", "认知/学习").unwrap(),
            "认知/学习/为什么学习.md"
        );
    }

    #[test]
    fn rejects_stale_source_before_creation() {
        let root = tempdir().unwrap();
        let config = fixture(root.path());
        let echo = source(root.path(), "echo", "Idea.md");
        fs::write(root.path().join("echo/Idea.md"), "changed").unwrap();
        assert_eq!(
            create_note_with_config(&config, &request(echo))
                .unwrap_err()
                .code,
            "NOTE_CHANGED"
        );
        assert!(!root.path().join("main/我的认知.md").exists());
    }

    #[test]
    fn rejects_wrong_role_stale_reference_and_duplicate_reference() {
        let root = tempdir().unwrap();
        let config = fixture(root.path());
        let main = source(root.path(), "main", "Main.md");
        let reference = source(root.path(), "knowledge", "Reference.md");
        assert_eq!(
            create_note_with_config(&config, &request(main.clone()))
                .unwrap_err()
                .code,
            "VAULT_ROLE_MISSING"
        );
        let mut output = CreateNoteRequest {
            kind: "output".into(),
            title: "Output".into(),
            source: main.clone(),
            references: vec![main],
        };
        assert_eq!(
            create_note_with_config(&config, &output).unwrap_err().code,
            "VAULT_ROLE_MISSING"
        );
        output.references = vec![reference.clone(), reference.clone()];
        assert_eq!(
            create_note_with_config(&config, &output).unwrap_err().code,
            "REFERENCES_INVALID"
        );
        output.references = vec![reference];
        fs::write(root.path().join("knowledge/Reference.md"), "changed").unwrap();
        assert_eq!(
            create_note_with_config(&config, &output).unwrap_err().code,
            "NOTE_CHANGED"
        );
        assert!(!root.path().join("output/Output.md").exists());
    }

    #[test]
    fn output_can_be_created_without_references() {
        let root = tempdir().unwrap();
        let config = fixture(root.path());
        let mut output = request(source(root.path(), "main", "Main.md"));
        output.kind = "output".into();
        assert_eq!(
            create_note_with_config(&config, &output).unwrap().vault_id,
            "output"
        );
    }

    #[test]
    fn configured_main_folder_routes_to_next_vault_not_source() {
        let root = tempdir().unwrap();
        let mut config = fixture(root.path());
        fs::create_dir(root.path().join("main/认知")).unwrap();
        config.workspace.main_folder = "认知".into();
        validate_workflow_folders(&config).unwrap();
        let input = request(source(root.path(), "echo", "Idea.md"));
        let result = create_note_with_config(&config, &input).unwrap();
        assert_eq!(result.vault_id, "main");
        assert_eq!(result.relative_path, "认知/我的认知.md");
        assert!(!root.path().join("echo/我的认知.md").exists());
        config.workspace.main_folder = "Missing".into();
        assert_eq!(
            validate_workflow_folders(&config).unwrap_err().code,
            "NOTE_PARENT_MISSING"
        );
        config.workspace.main_folder = "../echo".into();
        assert_eq!(
            validate_workflow_folders(&config).unwrap_err().code,
            "NOTE_PATH_INVALID"
        );
        config.workspace.main_folder.clear();
        config.vaults[1].role = None;
        assert_eq!(
            create_note_with_config(&config, &input).unwrap_err().code,
            "VAULT_ROLE_MISSING"
        );
        assert!(!root.path().join("echo/我的认知.md").exists());
    }

    #[test]
    fn preview_reads_latest_utf8_and_reports_hash_changes() {
        let root = tempdir().unwrap();
        let config = fixture(root.path());
        let note = source(root.path(), "echo", "Preview.md");
        let preview =
            read_preview_with_config(&config, "echo", "Preview.md", Some("stale-hash")).unwrap();
        assert_eq!(preview.vault_id, "echo");
        assert!(preview.content.contains("Private original body"));
        assert!(preview.changed);
        assert_eq!(preview.content_hash, note.content_hash);
        assert_eq!(
            read_preview_with_config(&config, "echo", "../main/Preview.md", None)
                .unwrap_err()
                .code,
            "NOTE_PATH_INVALID"
        );
        fs::write(root.path().join("echo/Invalid.md"), [0xff, 0xfe]).unwrap();
        assert_eq!(
            read_preview_with_config(&config, "echo", "Invalid.md", None)
                .unwrap_err()
                .code,
            "NOTE_ENCODING_INVALID"
        );
    }

    #[test]
    fn rejects_missing_parent_offline_target_and_traversal() {
        let root = tempdir().unwrap();
        let mut config = fixture(root.path());
        let mut input = request(source(root.path(), "echo", "Idea.md"));
        config.workspace.main_folder = "Missing".into();
        assert_eq!(
            create_note_with_config(&config, &input).unwrap_err().code,
            "NOTE_PARENT_MISSING"
        );
        config.workspace.main_folder.clear();
        input.source.relative_path = "../main/Idea.md".into();
        assert_eq!(
            create_note_with_config(&config, &input).unwrap_err().code,
            "NOTE_PATH_INVALID"
        );
        input.source.relative_path = "Idea.md".into();
        config.vaults[1].path = root.path().join("offline").to_string_lossy().into_owned();
        assert_eq!(
            create_note_with_config(&config, &input).unwrap_err().code,
            "VAULT_OFFLINE"
        );
    }

    #[test]
    fn no_clobber_write_preserves_existing_target() {
        let root = tempdir().unwrap();
        let path = root.path().join("Note.md");
        create_new_note(&path, b"original").unwrap();
        assert!(create_new_note(&path, b"replacement").is_err());
        assert_eq!(fs::read(path).unwrap(), b"original");
    }

    #[test]
    fn task_update_rejects_stale_content() {
        let root = tempdir().unwrap();
        let config = fixture(root.path());
        fs::write(root.path().join("echo/Tasks.md"), "# Tasks\n- [ ] review\n").unwrap();
        let old_hash = content_hash(&fs::read(root.path().join("echo/Tasks.md")).unwrap());
        set_task_complete_with_config(&config, "echo", "Tasks.md", 2, &old_hash, true).unwrap();
        assert!(
            fs::read_to_string(root.path().join("echo/Tasks.md"))
                .unwrap()
                .contains("- [x] review")
        );
        assert_eq!(
            set_task_complete_with_config(&config, "echo", "Tasks.md", 2, &old_hash, false)
                .unwrap_err()
                .code,
            "NOTE_CHANGED"
        );
    }

    #[test]
    fn identifies_single_task_marker() {
        assert_eq!(task_marker("  - [ ] task"), Some(5));
        assert_eq!(task_marker("- [x] done"), Some(3));
        assert_eq!(task_marker("text - [ ] task"), None);
    }
}
