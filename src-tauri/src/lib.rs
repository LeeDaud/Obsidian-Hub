mod bridge;
mod config;
mod error;
mod launcher;
mod note_index;
mod overview;
mod vault;
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
    tauri::async_runtime::spawn_blocking(move || workspace_actions::create_note(&app, request))
        .await
        .map_err(|_| error::AppError::new("NOTE_WRITE_FAILED", "创建笔记意外中断。"))?
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
    workspace_actions::set_task_complete(
        &app,
        &vault_id,
        &relative_path,
        line_number,
        &expected_hash,
        complete,
    )
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
    workspace_state::set_reviewed(&app, &note_id, reviewed)
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
            set_echo_reviewed
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obsidian Hub");
}
