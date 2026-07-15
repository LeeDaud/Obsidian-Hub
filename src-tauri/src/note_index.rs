use std::{fs, path::Path, time::UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config::VaultEntry;

const IGNORED: &[&str] = &[
    ".obsidian",
    ".git",
    ".trash",
    "node_modules",
    "target",
    "dist",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedNote {
    pub id: String,
    pub vault_id: String,
    pub vault_name: String,
    pub relative_path: String,
    pub file_name: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub modified_at: u64,
    pub size: u64,
}

fn frontmatter_values(contents: &str, key: &str) -> Vec<String> {
    if !contents.starts_with("---\n") {
        return Vec::new();
    }
    let Some(end) = contents[4..].find("\n---") else {
        return Vec::new();
    };
    let frontmatter = &contents[4..end + 4];
    let Some(line) = frontmatter
        .lines()
        .find(|line| line.trim_start().starts_with(&format!("{key}:")))
    else {
        return Vec::new();
    };
    line.split_once(':')
        .map(|(_, value)| {
            value
                .trim()
                .trim_matches(['[', ']'])
                .split(',')
                .map(|item| item.trim().trim_matches(['"', '\'']).to_owned())
                .filter(|item| !item.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn scan_directory(root: &Path, directory: &Path, vault: &VaultEntry, notes: &mut Vec<IndexedNote>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let hidden = entry.file_name().to_string_lossy().starts_with('.');
            if hidden
                || IGNORED.iter().any(|name| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(name)
                })
            {
                continue;
            }
            scan_directory(root, &path, vault, notes);
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("md"))
        {
            let Ok(relative) = path.strip_prefix(root) else {
                continue;
            };
            let relative_path = relative.to_string_lossy().replace('\\', "/");
            let file_name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let metadata = entry.metadata().ok();
            let contents = fs::read_to_string(&path).unwrap_or_default();
            let title = contents
                .lines()
                .find_map(|line| line.strip_prefix("# ").map(str::trim))
                .filter(|title| !title.is_empty())
                .unwrap_or_else(|| file_name.trim_end_matches(".md"))
                .to_owned();
            notes.push(IndexedNote {
                id: format!("{}:{}", vault.id, relative_path.to_lowercase()),
                vault_id: vault.id.clone(),
                vault_name: vault.name.clone(),
                relative_path,
                file_name,
                title,
                aliases: frontmatter_values(&contents, "aliases"),
                tags: frontmatter_values(&contents, "tags"),
                modified_at: metadata
                    .as_ref()
                    .and_then(|value| value.modified().ok())
                    .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                    .map(|value| value.as_millis() as u64)
                    .unwrap_or_default(),
                size: metadata.map(|value| value.len()).unwrap_or_default(),
            });
        }
    }
}

pub fn build(vaults: &[VaultEntry]) -> Vec<IndexedNote> {
    let mut notes = Vec::new();
    for vault in vaults {
        let root = Path::new(&vault.path);
        if root.is_dir() {
            scan_directory(root, root, vault, &mut notes);
        }
    }
    notes
}

pub fn search(
    notes: &[IndexedNote],
    query: &str,
    exclude: Option<&str>,
    vault_id: Option<&str>,
    limit: usize,
) -> Vec<IndexedNote> {
    let terms: Vec<_> = query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let mut ranked: Vec<_> = notes
        .iter()
        .filter(|note| exclude != Some(note.vault_id.as_str()))
        .filter(|note| vault_id.is_none_or(|vault_id| note.vault_id == vault_id))
        .filter_map(|note| {
            let title = note.title.to_lowercase();
            let path = note.relative_path.to_lowercase();
            let aliases = note.aliases.join(" ").to_lowercase();
            if !terms
                .iter()
                .all(|term| title.contains(term) || path.contains(term) || aliases.contains(term))
            {
                return None;
            }
            let score: usize = terms
                .iter()
                .map(|term| {
                    if title == *term {
                        100
                    } else if title.starts_with(term) {
                        50
                    } else if title.contains(term) {
                        25
                    } else if aliases.contains(term) {
                        15
                    } else {
                        5
                    }
                })
                .sum();
            Some((score, note.clone()))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.title.cmp(&b.1.title)));
    ranked
        .into_iter()
        .take(limit.min(50))
        .map(|(_, note)| note)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{IndexedNote, search};
    #[test]
    fn title_match_ranks_before_path_match() {
        let note = |title: &str, path: &str| IndexedNote {
            id: path.into(),
            vault_id: "v".into(),
            vault_name: "V".into(),
            relative_path: path.into(),
            file_name: "x.md".into(),
            title: title.into(),
            aliases: vec![],
            tags: vec![],
            modified_at: 0,
            size: 0,
        };
        let result = search(
            &[note("Other", "tcp/other.md"), note("TCP", "network/tcp.md")],
            "tcp",
            None,
            None,
            20,
        );
        assert_eq!(result[0].title, "TCP");
    }
}
