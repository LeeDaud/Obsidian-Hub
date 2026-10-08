//! Hub-only change notifications and scoped, read-only workspace parsing.
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{
    config::{self, VaultEntry},
    error::AppError,
    note_index::{self, IndexedNote},
    workflow_links::{self, Link},
    workspace_index::{self, TaskItem, VaultScanStatus},
};

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_CHANGES: usize = 512;
const TICK: Duration = Duration::from_millis(100);
const QUIET: Duration = Duration::from_millis(250);
const MAX_WAIT: Duration = Duration::from_secs(1);
const HEALTH_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub vault_id: String,
    pub relative_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub session_id: String,
    pub changes: Vec<Change>,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSession {
    pub session_id: String,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeUpdate {
    pub scope: Change,
    pub notes: Vec<IndexedNote>,
    pub tasks: Vec<TaskItem>,
    pub relations: Vec<Link>,
    pub link_candidates: Vec<crate::link_candidates::Candidates>,
    // A transient read failure must not look like a deletion.
    pub failed_paths: Vec<String>,
    pub status: VaultScanStatus,
}

#[derive(Default)]
pub struct WatchState(Mutex<Option<Session>>);

struct Session {
    id: String,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn fail(code: &'static str, message: &str) -> AppError {
    AppError::new(code, message)
}

fn valid_scope(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    path.len() <= 4096
        && !path.contains(['\\', ':', '\0'])
        && (path.is_empty()
            || parts.iter().enumerate().all(|(index, &part)| {
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && (!part.starts_with('.')
                        || (index + 1 == parts.len() && part.to_lowercase().ends_with(".md")))
                    && !note_index::IGNORED_DIRECTORIES
                        .iter()
                        .any(|name| part.eq_ignore_ascii_case(name))
            }))
}

fn key(change: &Change) -> (String, String) {
    (change.vault_id.clone(), change.relative_path.to_lowercase())
}

fn covers(parent: &str, child: &str) -> bool {
    parent.is_empty() || child == parent || child.starts_with(&format!("{parent}/"))
}

fn compact(changes: impl IntoIterator<Item = Change>) -> Vec<Change> {
    let mut unique = BTreeMap::new();
    for change in changes {
        unique.insert(key(&change), change);
    }
    unique
        .iter()
        .filter(|((vault, path), _)| {
            !unique.keys().any(|(other_vault, other_path)| {
                vault == other_vault && path != other_path && covers(other_path, path)
            })
        })
        .map(|(_, change)| change.clone())
        .collect()
}

fn event_changes(event: &Event, roots: &[(VaultEntry, PathBuf)]) -> Vec<Change> {
    if matches!(event.kind, EventKind::Access(_)) {
        return Vec::new();
    }
    let mut changes = Vec::new();
    for path in &event.paths {
        for (vault, root) in roots {
            // notify paths are lexical: removed files cannot be canonicalized.
            let Some(relative) = relative_event_path(root, path) else {
                continue;
            };
            if relative.eq_ignore_ascii_case(".obsidian") {
                changes.push(Change {
                    vault_id: vault.id.clone(),
                    relative_path: String::new(),
                });
            } else if valid_scope(&relative) {
                let extension = Path::new(&relative).extension().and_then(|s| s.to_str());
                // Removed/renamed folders have no metadata. A scope can safely be a subtree.
                if extension.is_none()
                    || extension.is_some_and(|s| s.eq_ignore_ascii_case("md"))
                    || matches!(
                        event.kind,
                        EventKind::Remove(_)
                            | EventKind::Modify(notify::event::ModifyKind::Name(_))
                    )
                    || path.is_dir()
                {
                    changes.push(Change {
                        vault_id: vault.id.clone(),
                        relative_path: relative,
                    });
                }
            }
        }
    }
    compact(changes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RenameMode};

    fn fixture(root: &Path) -> VaultEntry {
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        VaultEntry {
            id: "v".into(),
            name: "Vault".into(),
            path: root.to_string_lossy().into(),
            description: String::new(),
            tags: Vec::new(),
            obsidian_vault_id: None,
            favorite: false,
            favorite_order: None,
            created_at: String::new(),
            updated_at: String::new(),
            last_opened_at: None,
            role: None,
        }
    }
    fn change(path: &str) -> Change {
        Change {
            vault_id: "v".into(),
            relative_path: path.into(),
        }
    }

    #[test]
    fn scoped_read_parses_only_requested_note_with_tasks_and_relations() {
        let dir = tempfile::tempdir().unwrap();
        let vault = fixture(dir.path());
        fs::write(dir.path().join("a.md"), "---\naliases: [Alias]\ntags: [tag]\norigin: {\"vault_id\":\"echo\",\"path\":\"idea.md\"}\n---\n# New title\n- [ ] Task\n```\n- [ ] Skip\n```\n").unwrap();
        fs::write(dir.path().join("unrelated.md"), b"\xff").unwrap();
        let updates = refresh_with_vaults(&[vault], vec![change("a.md")]).unwrap();
        let update = &updates[0];
        assert_eq!(update.notes.len(), 1);
        assert_eq!(update.notes[0].title, "New title");
        assert_eq!(update.notes[0].aliases, ["Alias"]);
        assert_eq!(update.notes[0].tags, ["tag"]);
        assert_eq!(update.tasks.len(), 1);
        assert_eq!(update.tasks[0].text, "Task");
        assert_eq!(update.tasks[0].content_hash, update.notes[0].content_hash);
        assert_eq!(update.relations.len(), 1);
        assert!(update.failed_paths.is_empty());
    }

    #[test]
    fn directory_rename_refreshes_old_and_new_subtrees() {
        let dir = tempfile::tempdir().unwrap();
        let vault = fixture(dir.path());
        fs::create_dir(dir.path().join("Old.v1")).unwrap();
        fs::write(dir.path().join("Old.v1/a.md"), "# A").unwrap();
        fs::rename(dir.path().join("Old.v1"), dir.path().join("New.v1")).unwrap();
        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(dir.path().join("Old.v1"))
            .add_path(dir.path().join("New.v1"));
        let roots = vec![(vault.clone(), dir.path().to_path_buf())];
        let changes = event_changes(&event, &roots);
        assert_eq!(changes.len(), 2);
        let updates = refresh_with_vaults(&[vault], changes).unwrap();
        assert_eq!(updates.iter().flat_map(|u| &u.notes).count(), 1);
        assert_eq!(
            updates
                .iter()
                .flat_map(|u| &u.notes)
                .next()
                .unwrap()
                .relative_path,
            "New.v1/a.md"
        );
        assert!(
            updates
                .iter()
                .find(|u| u.scope.relative_path == "Old.v1")
                .unwrap()
                .notes
                .is_empty()
        );
    }

    #[test]
    fn missing_files_are_deletions_but_invalid_encoding_and_size_are_failures() {
        let dir = tempfile::tempdir().unwrap();
        let vault = fixture(dir.path());
        fs::write(dir.path().join("invalid.md"), b"\xff").unwrap();
        fs::File::create(dir.path().join("large.md"))
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        let updates = refresh_with_vaults(
            &[vault],
            vec![
                change("missing.md"),
                change("invalid.md"),
                change("large.md"),
            ],
        )
        .unwrap();
        assert_eq!(updates.iter().flat_map(|u| &u.failed_paths).count(), 2);
        assert!(
            updates
                .iter()
                .find(|u| u.scope.relative_path == "missing.md")
                .unwrap()
                .failed_paths
                .is_empty()
        );
    }

    #[test]
    fn validates_scopes_and_ignores_private_directories() {
        let dir = tempfile::tempdir().unwrap();
        let vault = fixture(dir.path());
        fs::create_dir(dir.path().join(".private")).unwrap();
        fs::write(dir.path().join(".private/secret.md"), "# Secret").unwrap();
        fs::write(dir.path().join("visible.md"), "# Visible").unwrap();
        for invalid in [
            "../secret.md",
            "C:/secret.md",
            "folder\\secret.md",
            ".private/secret.md",
            "node_modules/a.md",
        ] {
            assert!(
                refresh_with_vaults(std::slice::from_ref(&vault), vec![change(invalid)]).is_err()
            );
        }
        let updates = refresh_with_vaults(&[vault.clone()], vec![change("")]).unwrap();
        assert_eq!(updates[0].notes.len(), 1);
        let mut foreign = change("visible.md");
        foreign.vault_id = "unknown".into();
        assert!(refresh_with_vaults(&[vault], vec![foreign]).is_err());
    }

    #[test]
    fn coalesces_case_variants_and_children_without_matching_siblings() {
        let mut changes: Vec<_> = (0..1000).map(|_| change("Folder/a.md")).collect();
        changes.extend([change("folder"), change("folder-other/a.md")]);
        assert_eq!(compact(changes).len(), 2);
        assert_eq!(
            relative_event_path(Path::new("C:/Vault"), Path::new("c:/VAULT/a.md")),
            Some("a.md".into())
        );
        assert_eq!(
            relative_event_path(Path::new("C:/Vault"), Path::new("C:/Vault-other/a.md")),
            None
        );
    }

    #[test]
    fn native_watcher_observes_created_markdown_and_releases_resources() {
        let dir = tempfile::tempdir().unwrap();
        let vault = fixture(dir.path());
        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(tx).unwrap();
        watcher.watch(dir.path(), RecursiveMode::Recursive).unwrap();
        fs::write(dir.path().join("new.md"), "# New").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let roots = vec![(vault, dir.path().to_path_buf())];
        let mut observed = false;
        while Instant::now() < deadline {
            if let Ok(Ok(event)) = rx.recv_timeout(Duration::from_millis(100))
                && event_changes(&event, &roots)
                    .iter()
                    .any(|c| c.relative_path == "new.md")
            {
                observed = true;
                break;
            }
        }
        assert!(observed, "native watcher did not observe the fixture write");
        watcher.unwatch(dir.path()).unwrap();
        drop(watcher);
    }

    #[cfg(windows)]
    #[test]
    fn rejects_junction_escape_and_reports_offline_vault() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let vault = fixture(dir.path());
        fs::write(outside.path().join("secret.md"), "# Secret").unwrap();
        // Test-only fixture: junctions do not require symbolic-link privileges.
        let junction = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(dir.path().join("escape"))
            .arg(outside.path())
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(junction.status.success(), "could not create test junction");
        let updates = refresh_with_vaults(
            std::slice::from_ref(&vault),
            vec![change("escape/secret.md")],
        )
        .unwrap();
        assert!(updates[0].notes.is_empty());
        let offline = VaultEntry {
            path: dir.path().join("missing").to_string_lossy().into(),
            ..vault
        };
        let updates = refresh_with_vaults(&[offline], vec![change("")]).unwrap();
        assert!(!updates[0].status.online);
    }

    #[test]
    fn access_events_do_not_loop_when_scoped_reads_open_files() {
        let event = Event::new(EventKind::Access(notify::event::AccessKind::Any))
            .add_path(PathBuf::from("C:/Vault/a.md"));
        assert!(event_changes(&event, &[]).is_empty());
        let event = Event::new(EventKind::Create(CreateKind::File))
            .add_path(PathBuf::from("C:/Vault/.obsidian/a.md"));
        assert!(event_changes(&event, &[]).is_empty());
    }

    #[test]
    fn stop_releases_worker_and_old_cleanup_cannot_stop_new_session() {
        let signal = Arc::new(AtomicBool::new(false));
        let worker_signal = signal.clone();
        let (tx, rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            while !worker_signal.load(Ordering::Acquire) {
                thread::yield_now();
            }
            tx.send(()).unwrap();
        });
        let state = WatchState(Mutex::new(Some(Session {
            id: "new".into(),
            stop: signal.clone(),
            worker: Some(worker),
        })));
        stop(&state, "old");
        assert!(!signal.load(Ordering::Acquire));
        assert!(state.0.lock().unwrap().is_some());
        stop(&state, "new");
        assert!(signal.load(Ordering::Acquire));
        assert!(rx.try_recv().is_ok());
        assert!(state.0.lock().unwrap().is_none());
    }

    #[test]
    fn extended_paths_and_hidden_markdown_match_existing_index_rules() {
        assert_eq!(
            relative_event_path(Path::new(r"\\?\C:\Vault"), Path::new("C:/Vault/a.md")),
            Some("a.md".into())
        );
        assert_eq!(
            relative_event_path(
                Path::new(r"\\?\UNC\server\share"),
                Path::new("//server/share/a.md")
            ),
            Some("a.md".into())
        );
        assert!(valid_scope(".note.md"));
        assert!(!valid_scope(".hidden/a.md"));
    }
}

fn relative_event_path(root: &Path, path: &Path) -> Option<String> {
    // Windows event casing may differ from the registered path.
    let root = root.to_string_lossy().replace('\\', "/");
    let path = path.to_string_lossy().replace('\\', "/");
    let normalize = |value: String| {
        if value.starts_with("//?/UNC/") {
            format!("//{}", &value[8..])
        } else {
            value.strip_prefix("//?/").unwrap_or(&value).to_owned()
        }
    };
    let root = normalize(root);
    let path = normalize(path);
    let root = root.trim_end_matches('/');
    if path.eq_ignore_ascii_case(root) {
        return Some(String::new());
    }
    let prefix = format!("{root}/");
    if path
        .get(..prefix.len())
        .is_some_and(|p| p.eq_ignore_ascii_case(&prefix))
    {
        Some(path[prefix.len()..].to_owned())
    } else {
        None
    }
}

pub fn start(app: AppHandle, state: &WatchState) -> Result<WatchSession, AppError> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| fail("WORKSPACE_WATCH_FAILED", "无法启动文件监听。"))?;
    // Stop the previous session before installing a new registry snapshot.
    *slot = None;
    let vaults = config::load_config(&app)?.vaults;
    let id = format!("{:016x}", rand::random::<u64>());
    let stop = Arc::new(AtomicBool::new(false));
    let overflow = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::sync_channel(1024);
    let callback_overflow = overflow.clone();
    let mut watcher = notify::RecommendedWatcher::new(
        move |event| {
            if let Err(mpsc::TrySendError::Full(_)) = tx.try_send(event) {
                callback_overflow.store(true, Ordering::Release);
            }
        },
        notify::Config::default().with_follow_symlinks(false),
    )
    .map_err(|_| fail("WORKSPACE_WATCH_FAILED", "文件监听不可用，请手动刷新。"))?;
    let mut roots = Vec::new();
    let mut warnings = Vec::new();
    for vault in vaults {
        if vault.path.starts_with("\\\\") || vault.path.starts_with("//") {
            warnings.push("WORKSPACE_WATCH_NETWORK".to_owned());
        }
        // Keep offline roots for health checks; no unregistered parent is watched.
        let root = fs::canonicalize(&vault.path).unwrap_or_else(|_| PathBuf::from(&vault.path));
        if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
            warnings.push("WORKSPACE_WATCH_PARTIAL".to_owned());
        }
        roots.push((vault, root));
    }
    warnings.sort();
    warnings.dedup();
    let session = WatchSession {
        session_id: id.clone(),
        warning_codes: warnings,
    };
    let worker_stop = stop.clone();
    let worker = thread::Builder::new()
        .name("hub-workspace-watch".into())
        .spawn(move || {
            let mut pending: BTreeMap<(String, String), Change> = BTreeMap::new();
            let mut warning_codes = Vec::new();
            let mut first = None;
            let mut last = Instant::now();
            let mut health_at = Instant::now();
            let mut health: Vec<_> = roots
                .iter()
                .map(|(_, root)| root.join(".obsidian").is_dir())
                .collect();
            while !worker_stop.load(Ordering::Acquire) {
                match rx.recv_timeout(TICK) {
                    Ok(Ok(event)) => {
                        if event.need_rescan() {
                            warning_codes.push("WORKSPACE_WATCH_OVERFLOW".to_owned());
                        }
                        for change in event_changes(&event, &roots) {
                            pending.insert(key(&change), change);
                        }
                        if !pending.is_empty() {
                            first.get_or_insert_with(Instant::now);
                            last = Instant::now();
                        }
                    }
                    Ok(Err(_)) => warning_codes.push("WORKSPACE_WATCH_PARTIAL".to_owned()),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                if overflow.swap(false, Ordering::AcqRel) || pending.len() > MAX_CHANGES {
                    warning_codes.push("WORKSPACE_WATCH_OVERFLOW".to_owned());
                    pending.clear();
                    first = None;
                }
                if health_at.elapsed() >= HEALTH_INTERVAL {
                    for (index, (vault, root)) in roots.iter().enumerate() {
                        let online = root.join(".obsidian").is_dir();
                        if online != health[index] {
                            let change = Change {
                                vault_id: vault.id.clone(),
                                relative_path: String::new(),
                            };
                            pending.insert(key(&change), change);
                            first.get_or_insert_with(Instant::now);
                            if online {
                                let _ = watcher.unwatch(root);
                                if watcher.watch(root, RecursiveMode::Recursive).is_err() {
                                    warning_codes.push("WORKSPACE_WATCH_PARTIAL".to_owned());
                                }
                            }
                            health[index] = online;
                        }
                    }
                    health_at = Instant::now();
                }
                let due =
                    first.is_some_and(|time| time.elapsed() >= MAX_WAIT || last.elapsed() >= QUIET);
                if due || !warning_codes.is_empty() {
                    warning_codes.sort();
                    warning_codes.dedup();
                    let changes = compact(std::mem::take(&mut pending).into_values());
                    let notice = Notice {
                        session_id: id.clone(),
                        changes,
                        warning_codes: std::mem::take(&mut warning_codes),
                    };
                    if app.emit("workspace-changed", notice).is_err() {
                        break;
                    }
                    first = None;
                }
            }
            drop(watcher);
        })
        .map_err(|_| fail("WORKSPACE_WATCH_FAILED", "无法启动文件监听，请手动刷新。"))?;
    *slot = Some(Session {
        id: session.session_id.clone(),
        stop,
        worker: Some(worker),
    });
    Ok(session)
}

pub fn stop(state: &WatchState, session_id: &str) {
    if let Ok(mut slot) = state.0.lock()
        && slot
            .as_ref()
            .is_some_and(|session| session.id == session_id)
    {
        *slot = None;
    }
}

pub fn shutdown(state: &WatchState) {
    if let Ok(mut slot) = state.0.lock() {
        *slot = None;
    }
}

pub fn refresh(app: &AppHandle, changes: Vec<Change>) -> Result<Vec<ScopeUpdate>, AppError> {
    refresh_with_vaults(&config::load_config(app)?.vaults, changes)
}

fn refresh_with_vaults(
    vaults: &[VaultEntry],
    changes: Vec<Change>,
) -> Result<Vec<ScopeUpdate>, AppError> {
    if changes.len() > MAX_CHANGES || changes.iter().any(|c| !valid_scope(&c.relative_path)) {
        return Err(fail(
            "WORKSPACE_CHANGE_INVALID",
            "文件变化范围无效，请手动刷新。",
        ));
    }
    let mut updates = Vec::new();
    for scope in compact(changes) {
        let vault = vaults
            .iter()
            .find(|v| v.id == scope.vault_id)
            .ok_or_else(|| fail("VAULT_NOT_FOUND", "仓库未登记或已被移除。"))?;
        let root = fs::canonicalize(&vault.path).ok();
        let online = root.as_ref().is_some_and(|p| p.join(".obsidian").is_dir());
        let mut update = ScopeUpdate {
            scope,
            notes: Vec::new(),
            tasks: Vec::new(),
            relations: Vec::new(),
            link_candidates: Vec::new(),
            failed_paths: Vec::new(),
            status: VaultScanStatus {
                vault_id: vault.id.clone(),
                online,
                read_errors: 0,
            },
        };
        if online && let Some(root) = root {
            let path = root.join(&update.scope.relative_path);
            collect(vault, &root, &path, &mut update);
        }
        update.status.read_errors = update.failed_paths.len();
        updates.push(update);
    }
    Ok(updates)
}

fn collect(vault: &VaultEntry, root: &Path, path: &Path, update: &mut ScopeUpdate) {
    let Ok(relative) = path.strip_prefix(root) else {
        return;
    };
    let relative = relative.to_string_lossy().replace('\\', "/");
    if !valid_scope(&relative) {
        return;
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(_) => {
            update.failed_paths.push(relative);
            return;
        }
    };
    if metadata.file_type().is_symlink() {
        return;
    }
    let Ok(real) = fs::canonicalize(path) else {
        update.failed_paths.push(relative);
        return;
    };
    if !real.starts_with(root) {
        return;
    }
    if metadata.is_dir() {
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => {
                update.failed_paths.push(relative);
                return;
            }
        };
        for entry in entries {
            match entry {
                Ok(entry) => collect(vault, root, &entry.path(), update),
                Err(_) => {
                    update.failed_paths.push(relative.clone());
                }
            }
        }
    } else if metadata.is_file()
        && path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("md"))
    {
        let contents = (|| -> io::Result<String> {
            if metadata.len() > MAX_BYTES {
                return Err(io::ErrorKind::InvalidData.into());
            }
            let mut contents = String::new();
            fs::File::open(&real)?
                .take(MAX_BYTES + 1)
                .read_to_string(&mut contents)?;
            if contents.len() as u64 > MAX_BYTES {
                return Err(io::ErrorKind::InvalidData.into());
            }
            Ok(contents)
        })();
        match contents {
            Ok(contents) => {
                let note = note_index::from_contents(vault, relative, &contents, Some(metadata));
                update
                    .tasks
                    .extend(workspace_index::tasks_in_note(&note, contents.as_bytes()));
                update.relations.extend(workflow_links::parse(
                    &contents,
                    workflow_links::NoteRef {
                        vault_id: note.vault_id.clone(),
                        relative_path: note.relative_path.clone(),
                    },
                ));
                update.link_candidates.push(crate::link_candidates::extract(
                    &contents,
                    workflow_links::NoteRef {
                        vault_id: note.vault_id.clone(),
                        relative_path: note.relative_path.clone(),
                    },
                ));
                update.notes.push(note);
            }
            Err(_) => update.failed_paths.push(relative),
        }
    }
}
