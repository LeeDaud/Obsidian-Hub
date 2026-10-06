use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::{DateTime, Utc};
use rand::random;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;

const FILE_NAME: &str = "workflow-events-v1.jsonl";
const MAX_EVENTS: usize = 2_000;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 16 * 1024;
static EVENT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventNoteRef {
    pub vault_id: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDetail {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewed: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEvent {
    pub schema_version: u32,
    pub id: String,
    pub occurred_at: String,
    pub kind: String,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<EventNoteRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<EventNoteRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<EventDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEventQuery {
    pub events: Vec<WorkflowEvent>,
    pub has_warnings: bool,
    pub skipped_lines: usize,
}

pub struct NewEvent {
    pub kind: &'static str,
    pub outcome: &'static str,
    pub source: Option<EventNoteRef>,
    pub target: Option<EventNoteRef>,
    pub detail: Option<EventDetail>,
    pub error_code: Option<String>,
}

fn event_id() -> String {
    let mut value = random::<u128>();
    value = (value & !(0xf_u128 << 76)) | (4_u128 << 76);
    value = (value & !(0x3_u128 << 62)) | (0x2_u128 << 62);
    let hex = format!("{value:032x}");
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn event_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(FILE_NAME))
        .map_err(|_| AppError::new("WORKFLOW_EVENT_PATH_FAILED", "无法定位活动日志目录。"))
}

fn valid_event(event: &WorkflowEvent) -> bool {
    event.schema_version == 1
        && matches!(
            event.kind.as_str(),
            "noteCreated" | "taskUpdated" | "echoReviewUpdated"
        )
        && matches!(event.outcome.as_str(), "succeeded" | "failed")
        && !event.id.is_empty()
        && DateTime::parse_from_rfc3339(&event.occurred_at).is_ok()
}

fn parse_lines(contents: &[u8]) -> (Vec<WorkflowEvent>, usize) {
    let mut events = Vec::new();
    let mut skipped = 0;
    for line in contents.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            skipped += 1;
            continue;
        }
        match serde_json::from_slice::<WorkflowEvent>(line) {
            Ok(event) if valid_event(&event) => events.push(event),
            _ => skipped += 1,
        }
    }
    (events, skipped)
}

fn rewrite(path: &Path, events: &[WorkflowEvent]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("WORKFLOW_EVENT_PATH_FAILED", "活动日志路径无效。"))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法创建活动日志目录。"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法创建活动日志临时文件。"))?;
    for event in events {
        serde_json::to_writer(temporary.as_file_mut(), event)
            .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法写入活动日志。"))?;
        temporary
            .as_file_mut()
            .write_all(b"\n")
            .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法写入活动日志。"))?;
    }
    temporary
        .as_file_mut()
        .sync_all()
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法保存活动日志。"))?;
    temporary
        .persist(path)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法替换活动日志。"))?;
    Ok(())
}

fn append_to_path(path: &Path, event: &WorkflowEvent) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("WORKFLOW_EVENT_PATH_FAILED", "活动日志路径无效。"))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法创建活动日志目录。"))?;
    let encoded = serde_json::to_vec(event)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法编码活动日志。"))?;
    if encoded.len() > MAX_LINE_BYTES {
        return Err(AppError::new(
            "WORKFLOW_EVENT_TOO_LARGE",
            "活动日志记录超过大小限制。",
        ));
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法打开活动日志。"))?;
    file.write_all(&encoded)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_data())
        .map_err(|_| AppError::new("WORKFLOW_EVENT_WRITE_FAILED", "无法追加活动日志。"))?;
    drop(file);

    let contents = fs::read(path)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_READ_FAILED", "无法读取活动日志。"))?;
    let line_count = contents.iter().filter(|byte| **byte == b'\n').count();
    if contents.len() > MAX_BYTES || line_count > MAX_EVENTS {
        let (events, _) = parse_lines(&contents);
        let mut retained = Vec::new();
        let mut bytes = 0;
        for candidate in events.into_iter().rev().take(MAX_EVENTS) {
            let size = serde_json::to_vec(&candidate)
                .map(|value| value.len() + 1)
                .unwrap_or(0);
            if bytes + size > MAX_BYTES {
                break;
            }
            bytes += size;
            retained.push(candidate);
        }
        retained.reverse();
        rewrite(path, &retained)?;
    }
    Ok(())
}

fn append_synchronized(path: &Path, event: &WorkflowEvent) -> Result<(), AppError> {
    let _guard = EVENT_LOCK
        .lock()
        .map_err(|_| AppError::new("WORKFLOW_EVENT_LOCK_FAILED", "活动日志锁不可用。"))?;
    append_to_path(path, event)
}

fn clear_synchronized(path: &Path) -> Result<(), AppError> {
    let _guard = EVENT_LOCK
        .lock()
        .map_err(|_| AppError::new("WORKFLOW_EVENT_LOCK_FAILED", "活动日志锁不可用。"))?;
    rewrite(path, &[])
}

pub fn record(app: &AppHandle, input: NewEvent) -> Result<(), AppError> {
    append_synchronized(
        &event_path(app)?,
        &WorkflowEvent {
            schema_version: 1,
            id: event_id(),
            occurred_at: Utc::now().to_rfc3339(),
            kind: input.kind.to_owned(),
            outcome: input.outcome.to_owned(),
            source: input.source,
            target: input.target,
            detail: input.detail,
            error_code: input.error_code,
        },
    )
}

pub fn load(app: &AppHandle) -> Result<WorkflowEventQuery, AppError> {
    let _guard = EVENT_LOCK
        .lock()
        .map_err(|_| AppError::new("WORKFLOW_EVENT_LOCK_FAILED", "活动日志锁不可用。"))?;
    let path = event_path(app)?;
    if !path.exists() {
        return Ok(WorkflowEventQuery {
            events: Vec::new(),
            has_warnings: false,
            skipped_lines: 0,
        });
    }
    let contents = fs::read(path)
        .map_err(|_| AppError::new("WORKFLOW_EVENT_READ_FAILED", "无法读取活动日志。"))?;
    let (mut events, skipped_lines) = parse_lines(&contents);
    events.reverse();
    Ok(WorkflowEventQuery {
        events,
        has_warnings: skipped_lines > 0,
        skipped_lines,
    })
}

pub fn clear(app: &AppHandle) -> Result<WorkflowEventQuery, AppError> {
    clear_synchronized(&event_path(app)?)?;
    Ok(WorkflowEventQuery {
        events: Vec::new(),
        has_warnings: false,
        skipped_lines: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::tempdir;

    fn event(index: usize) -> WorkflowEvent {
        WorkflowEvent {
            schema_version: 1,
            id: format!("event-{index}"),
            occurred_at: "2026-10-04T00:00:00Z".into(),
            kind: "taskUpdated".into(),
            outcome: "succeeded".into(),
            source: Some(EventNoteRef {
                vault_id: "echo".into(),
                relative_path: format!("Note-{index}.md"),
            }),
            target: None,
            detail: None,
            error_code: None,
        }
    }

    #[test]
    fn appends_reads_and_rotates_events() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(FILE_NAME);
        for index in 0..=MAX_EVENTS {
            append_to_path(&path, &event(index)).unwrap();
        }
        let contents = fs::read(&path).unwrap();
        let (events, skipped) = parse_lines(&contents);
        assert_eq!(skipped, 0);
        assert_eq!(events.len(), MAX_EVENTS);
        assert_eq!(events.last().unwrap().id, format!("event-{MAX_EVENTS}"));
    }

    #[test]
    fn skips_truncated_invalid_and_unknown_lines() {
        let valid = serde_json::to_string(&event(1)).unwrap();
        let unknown = valid.replace("\"schemaVersion\":1", "\"schemaVersion\":2");
        let contents = format!("{valid}\n{{broken\n{unknown}\n");
        let (events, skipped) = parse_lines(contents.as_bytes());
        assert_eq!(events.len(), 1);
        assert_eq!(skipped, 2);
    }

    #[test]
    fn generated_ids_are_uuid_v4_shaped() {
        let id = event_id();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn serializes_concurrent_appends_without_corrupting_lines() {
        let directory = tempdir().unwrap();
        let path = Arc::new(directory.path().join(FILE_NAME));
        let threads = (0..8)
            .map(|worker| {
                let path = Arc::clone(&path);
                std::thread::spawn(move || {
                    for offset in 0..10 {
                        append_synchronized(&path, &event(worker * 10 + offset)).unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for thread in threads {
            thread.join().unwrap();
        }

        let (events, skipped) = parse_lines(&fs::read(path.as_ref()).unwrap());
        assert_eq!(events.len(), 80);
        assert_eq!(skipped, 0);
    }

    #[test]
    fn clears_the_log_atomically() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(FILE_NAME);
        append_synchronized(&path, &event(1)).unwrap();

        clear_synchronized(&path).unwrap();

        assert_eq!(fs::read(&path).unwrap(), Vec::<u8>::new());
    }
}
