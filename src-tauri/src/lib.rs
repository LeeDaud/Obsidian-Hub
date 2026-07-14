mod config;
mod error;
mod launcher;
mod overview;
mod vault;

use launcher::LaunchTarget;

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<config::AppConfig, error::AppError> {
    config::load_config(&app)
}

#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    config: config::AppConfig,
) -> Result<config::AppConfig, error::AppError> {
    config::save_config(&app, config)
}

#[tauri::command]
fn validate_vault_directory(path: String) -> Result<vault::VaultValidationResult, error::AppError> {
    vault::validate_vault_directory(&path)
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
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            validate_vault_directory,
            launch_obsidian_vault,
            load_overview_cache,
            scan_vault_overview
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obsidian Hub");
}
