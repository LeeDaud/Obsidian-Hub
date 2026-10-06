use std::{collections::BTreeMap, fs, io::Write, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;

const FILE_NAME: &str = "workspace-state.json";

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub schema_version: u32,
    pub today_plan: BTreeMap<String, Vec<String>>,
    pub reviewed: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_warning: Option<String>,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(FILE_NAME))
        .map_err(|_| AppError::new("WORKSPACE_STATE_PATH_FAILED", "无法定位工作流状态目录。"))
}

pub fn load(app: &AppHandle) -> Result<WorkspaceState, AppError> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(WorkspaceState {
            schema_version: 1,
            ..WorkspaceState::default()
        });
    }
    let contents = fs::read_to_string(path)
        .map_err(|_| AppError::new("WORKSPACE_STATE_READ_FAILED", "无法读取工作流状态。"))?;
    let state: WorkspaceState = serde_json::from_str(&contents)
        .map_err(|_| AppError::new("WORKSPACE_STATE_INVALID", "工作流状态已损坏。"))?;
    if state.schema_version != 1 {
        return Err(AppError::new(
            "WORKSPACE_STATE_UNSUPPORTED",
            "工作流状态版本暂不受支持。",
        ));
    }
    Ok(state)
}

fn save(app: &AppHandle, state: &WorkspaceState) -> Result<(), AppError> {
    let path = state_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("WORKSPACE_STATE_PATH_FAILED", "工作流状态路径无效。"))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("WORKSPACE_STATE_WRITE_FAILED", "无法创建工作流状态目录。"))?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|_| {
        AppError::new(
            "WORKSPACE_STATE_WRITE_FAILED",
            "无法创建工作流状态临时文件。",
        )
    })?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), state)
        .map_err(|_| AppError::new("WORKSPACE_STATE_WRITE_FAILED", "无法写入工作流状态。"))?;
    temporary
        .as_file_mut()
        .write_all(b"\n")
        .and_then(|_| temporary.as_file_mut().sync_all())
        .map_err(|_| AppError::new("WORKSPACE_STATE_WRITE_FAILED", "无法保存工作流状态。"))?;
    temporary
        .persist(path)
        .map_err(|_| AppError::new("WORKSPACE_STATE_WRITE_FAILED", "无法替换工作流状态。"))?;
    Ok(())
}

pub fn set_today_task(
    app: &AppHandle,
    date: &str,
    task_id: &str,
    selected: bool,
) -> Result<WorkspaceState, AppError> {
    if date.len() != 10
        || !date.chars().enumerate().all(|(index, character)| {
            if index == 4 || index == 7 {
                character == '-'
            } else {
                character.is_ascii_digit()
            }
        })
        || task_id.is_empty()
    {
        return Err(AppError::new(
            "WORKSPACE_STATE_INPUT_INVALID",
            "日期或任务引用无效。",
        ));
    }
    let mut state = load(app)?;
    state.event_warning = None;
    let tasks = state.today_plan.entry(date.to_owned()).or_default();
    tasks.retain(|candidate| candidate != task_id);
    if selected {
        tasks.push(task_id.to_owned());
    }
    save(app, &state)?;
    Ok(state)
}

pub fn set_reviewed(
    app: &AppHandle,
    note_id: &str,
    reviewed: bool,
) -> Result<WorkspaceState, AppError> {
    if note_id.is_empty() || note_id.len() > 1024 {
        return Err(AppError::new(
            "WORKSPACE_STATE_INPUT_INVALID",
            "笔记引用无效。",
        ));
    }
    let mut state = load(app)?;
    state.event_warning = None;
    state.reviewed.retain(|candidate| candidate != note_id);
    if reviewed {
        state.reviewed.push(note_id.to_owned());
    }
    save(app, &state)?;
    Ok(state)
}
