mod bridge;
mod config;
mod error;
mod launcher;
mod note_index;
mod overview;
mod vault;
mod workflow_events;
mod workflow_links;
mod workspace_actions;
mod workspace_index;
mod workspace_state;

use launcher::LaunchTarget;
use tauri::Manager;

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<config::AppConfig, error::AppError> {
    config::load_config(&app)
}

#[tauri::command]
async fn save_config(
    app: tauri::AppHandle,
    config: config::AppConfig,
) -> Result<config::AppConfig, error::AppError> {
    let previous = config::load_config(&app)?;
    let registry_changed = registration_changed(&previous.vaults, &config.vaults);
    let saved = config::save_config(&app, config)?;
    if registry_changed {
        if let Some(state) = app.try_state::<bridge::BridgeState>() {
            bridge::rebuild(&state, &saved.vaults).await;
        }
    }
    Ok(saved)
}

fn registration_changed(before: &[config::VaultEntry], after: &[config::VaultEntry]) -> bool {
    let registry = |vaults: &[config::VaultEntry]| {
        let mut items: Vec<_> = vaults
            .iter()
            .map(|vault| (vault.id.clone(), vault.name.clone(), vault.path.clone()))
            .collect();
        items.sort_unstable();
        items
    };
    registry(before) != registry(after)
}

#[tauri::command]
fn install_bridge_plugin(
    app: tauri::AppHandle,
    vault_path: String,
    vault_id: String,
) -> Result<String, error::AppError> {
    bridge::install_bridge(&app, &vault_path, &vault_id)
}

#[tauri::command]
async fn get_bridge_status(
    app: tauri::AppHandle,
    vault_path: String,
    vault_id: String,
) -> Result<bridge::BridgeStatus, error::AppError> {
    let state = app.state::<bridge::BridgeState>();
    bridge::bridge_status(&state, &vault_path, &vault_id).await
}

#[tauri::command]
fn validate_vault_directory(path: String) -> Result<vault::VaultValidationResult, error::AppError> {
    vault::validate_vault_directory(&path)
}

#[tauri::command]
fn list_obsidian_vaults() -> Result<Vec<vault::ObsidianVaultEntry>, error::AppError> {
    vault::list_obsidian_vaults()
}

#[tauri::command]
fn launch_obsidian_vault(
    app: tauri::AppHandle,
    target: LaunchTarget,
) -> Result<String, error::AppError> {
    launcher::launch_obsidian_vault(&app, target)
}

#[tauri::command]
fn load_overview_cache(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Option<overview::VaultOverview>, error::AppError> {
    overview::load_cache(&app, &paths)
}

#[tauri::command]
async fn scan_vault_overview(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<overview::VaultOverview, error::AppError> {
    tauri::async_runtime::spawn_blocking(move || overview::scan(&app, &paths))
        .await
        .map_err(|_| error::AppError::new("OVERVIEW_SCAN_FAILED", "库概览后台扫描意外中断。"))?
}

#[tauri::command]
async fn scan_workspace(
    app: tauri::AppHandle,
) -> Result<workspace_index::WorkspaceSnapshot, error::AppError> {
    tauri::async_runtime::spawn_blocking(move || workspace_index::scan(&app))
        .await
        .map_err(|_| error::AppError::new("WORKSPACE_SCAN_FAILED", "工作空间扫描意外中断。"))?
}

#[tauri::command]
fn load_workspace_cache(
    app: tauri::AppHandle,
) -> Result<Option<workspace_index::WorkspaceSnapshot>, error::AppError> {
    workspace_index::load_cache(&app)
}

#[tauri::command]
async fn create_workspace_note(
    app: tauri::AppHandle,
    request: workspace_actions::CreateNoteRequest,
) -> Result<workspace_actions::FileResult, error::AppError> {
    let event_app = app.clone();
    let source = workflow_events::EventNoteRef {
        vault_id: request.source.vault_id.clone(),
        relative_path: request.source.relative_path.clone(),
    };
    let note_kind = request.kind.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || workspace_actions::create_note(&app, request))
            .await
            .map_err(|_| error::AppError::new("NOTE_WRITE_FAILED", "创建笔记意外中断。"))?;
    match result {
        Ok(mut file) => {
            let event = workflow_events::NewEvent {
                kind: "noteCreated",
                outcome: "succeeded",
                source: Some(source),
                target: Some(workflow_events::EventNoteRef {
                    vault_id: file.vault_id.clone(),
                    relative_path: file.relative_path.clone(),
                }),
                detail: Some(workflow_events::EventDetail {
                    note_kind: Some(note_kind),
                    complete: None,
                    reviewed: None,
                }),
                error_code: None,
            };
            if workflow_events::record(&event_app, event).is_err() {
                file.event_warning = Some("操作已完成，但未能记录到活动日志。".into());
            }
            Ok(file)
        }
        Err(error) => {
            let _ = workflow_events::record(
                &event_app,
                workflow_events::NewEvent {
                    kind: "noteCreated",
                    outcome: "failed",
                    source: Some(source),
                    target: None,
                    detail: Some(workflow_events::EventDetail {
                        note_kind: Some(note_kind),
                        complete: None,
                        reviewed: None,
                    }),
                    error_code: Some(error.code.to_owned()),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
fn set_workspace_task_complete(
    app: tauri::AppHandle,
    vault_id: String,
    relative_path: String,
    line_number: usize,
    expected_hash: String,
    complete: bool,
) -> Result<workspace_actions::FileResult, error::AppError> {
    let source = workflow_events::EventNoteRef {
        vault_id: vault_id.clone(),
        relative_path: relative_path.clone(),
    };
    let result = workspace_actions::set_task_complete(
        &app,
        &vault_id,
        &relative_path,
        line_number,
        &expected_hash,
        complete,
    );
    match result {
        Ok(mut file) => {
            if workflow_events::record(
                &app,
                workflow_events::NewEvent {
                    kind: "taskUpdated",
                    outcome: "succeeded",
                    source: Some(source),
                    target: None,
                    detail: Some(workflow_events::EventDetail {
                        note_kind: None,
                        complete: Some(complete),
                        reviewed: None,
                    }),
                    error_code: None,
                },
            )
            .is_err()
            {
                file.event_warning = Some("任务已更新，但未能记录到活动日志。".into());
            }
            Ok(file)
        }
        Err(error) => {
            let _ = workflow_events::record(
                &app,
                workflow_events::NewEvent {
                    kind: "taskUpdated",
                    outcome: "failed",
                    source: Some(source),
                    target: None,
                    detail: Some(workflow_events::EventDetail {
                        note_kind: None,
                        complete: Some(complete),
                        reviewed: None,
                    }),
                    error_code: Some(error.code.to_owned()),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
fn open_workspace_note(
    app: tauri::AppHandle,
    vault_id: String,
    relative_path: String,
) -> Result<String, error::AppError> {
    workspace_actions::open_note(&app, &vault_id, &relative_path)
}

#[tauri::command]
fn read_workspace_note(
    app: tauri::AppHandle,
    vault_id: String,
    relative_path: String,
    expected_hash: Option<String>,
) -> Result<workspace_actions::NotePreview, error::AppError> {
    workspace_actions::read_preview(&app, &vault_id, &relative_path, expected_hash.as_deref())
}

#[tauri::command]
fn load_workspace_state(
    app: tauri::AppHandle,
) -> Result<workspace_state::WorkspaceState, error::AppError> {
    workspace_state::load(&app)
}

#[tauri::command]
fn set_today_task(
    app: tauri::AppHandle,
    date: String,
    task_id: String,
    selected: bool,
) -> Result<workspace_state::WorkspaceState, error::AppError> {
    workspace_state::set_today_task(&app, &date, &task_id, selected)
}

#[tauri::command]
fn set_echo_reviewed(
    app: tauri::AppHandle,
    note_id: String,
    reviewed: bool,
) -> Result<workspace_state::WorkspaceState, error::AppError> {
    let source =
        note_id
            .split_once(':')
            .map(|(vault_id, relative_path)| workflow_events::EventNoteRef {
                vault_id: vault_id.to_owned(),
                relative_path: relative_path.to_owned(),
            });
    let result = workspace_state::set_reviewed(&app, &note_id, reviewed);
    match result {
        Ok(mut state) => {
            if workflow_events::record(
                &app,
                workflow_events::NewEvent {
                    kind: "echoReviewUpdated",
                    outcome: "succeeded",
                    source,
                    target: None,
                    detail: Some(workflow_events::EventDetail {
                        note_kind: None,
                        complete: None,
                        reviewed: Some(reviewed),
                    }),
                    error_code: None,
                },
            )
            .is_err()
            {
                state.event_warning = Some("已阅状态已更新，但未能记录到活动日志。".into());
            }
            Ok(state)
        }
        Err(error) => {
            let _ = workflow_events::record(
                &app,
                workflow_events::NewEvent {
                    kind: "echoReviewUpdated",
                    outcome: "failed",
                    source,
                    target: None,
                    detail: Some(workflow_events::EventDetail {
                        note_kind: None,
                        complete: None,
                        reviewed: Some(reviewed),
                    }),
                    error_code: Some(error.code.to_owned()),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
fn load_workflow_events(
    app: tauri::AppHandle,
) -> Result<workflow_events::WorkflowEventQuery, error::AppError> {
    workflow_events::load(&app)
}

#[tauri::command]
fn clear_workflow_events(
    app: tauri::AppHandle,
) -> Result<workflow_events::WorkflowEventQuery, error::AppError> {
    workflow_events::clear(&app)
}

#[tauri::command]
fn load_workflow_links(
    app: tauri::AppHandle,
) -> Result<workflow_links::LinkStore, error::AppError> {
    workflow_links::load(&app)
}
#[tauri::command]
fn set_workflow_link(
    app: tauri::AppHandle,
    request: workflow_links::LinkRequest,
) -> Result<workflow_links::LinkStore, error::AppError> {
    workflow_links::update(&app, request)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let state = bridge::start(app.handle().clone())
                .map_err(|error| std::io::Error::other(error.message))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            validate_vault_directory,
            list_obsidian_vaults,
            launch_obsidian_vault,
            load_overview_cache,
            scan_vault_overview,
            install_bridge_plugin,
            get_bridge_status,
            scan_workspace,
            load_workspace_cache,
            create_workspace_note,
            set_workspace_task_complete,
            open_workspace_note,
            read_workspace_note,
            load_workspace_state,
            set_today_task,
            set_echo_reviewed,
            load_workflow_events,
            clear_workflow_events,
            load_workflow_links,
            set_workflow_link
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obsidian Hub");
}
