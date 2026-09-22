mod bridge;
mod config;
mod error;
mod launcher;
mod note_index;
mod overview;
mod vault;

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
    let saved = config::save_config(&app, config)?;
    if let Some(state) = app.try_state::<bridge::BridgeState>() {
        bridge::rebuild(&state, &saved.vaults).await;
    }
    Ok(saved)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            get_bridge_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obsidian Hub");
}
