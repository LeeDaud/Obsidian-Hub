use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::RwLock;
use url::Url;

use crate::{
    config,
    error::AppError,
    note_index::{self, IndexedNote},
};

const SERVICE_FILE: &str = "bridge-service.json";
const INDEX_FILE: &str = "note-index.json";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeServiceConfig {
    pub schema_version: u32,
    pub api_base_url: String,
    pub token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub state: &'static str,
    pub installed_version: Option<String>,
    pub bundled_version: String,
}

#[derive(Deserialize)]
struct BridgeManifest {
    version: String,
}
#[derive(Clone)]
pub struct BridgeState {
    app: AppHandle,
    service: BridgeServiceConfig,
    notes: Arc<RwLock<Vec<IndexedNote>>>,
    heartbeats: Arc<RwLock<HashMap<String, u64>>>,
}
#[derive(Serialize)]
struct ApiErrorBody {
    error: ApiError,
}
#[derive(Serialize)]
struct ApiError {
    code: &'static str,
    message: &'static str,
}
fn api_error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (
        status,
        Json(ApiErrorBody {
            error: ApiError { code, message },
        }),
    )
        .into_response()
}

fn service_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SERVICE_FILE))
        .map_err(|_| AppError::new("CONFIG_PATH_FAILED", "无法定位 Bridge 服务配置。"))
}
pub fn load_or_create_service(app: &AppHandle) -> Result<BridgeServiceConfig, AppError> {
    let path = service_path(app)?;
    if path.exists() {
        return fs::read_to_string(path)
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .ok_or_else(|| AppError::new("BRIDGE_CONFIG_INVALID", "Bridge 服务配置已损坏。"));
    }
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let service = BridgeServiceConfig {
        schema_version: 1,
        api_base_url: "http://127.0.0.1:27124".into(),
        token,
    };
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("CONFIG_PATH_FAILED", "Bridge 配置路径无效。"))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法创建 Bridge 配置目录。"))?;
    fs::write(
        path,
        serde_json::to_vec_pretty(&service).unwrap_or_default(),
    )
    .map_err(|_| AppError::new("CONFIG_WRITE_FAILED", "无法写入 Bridge 服务配置。"))?;
    Ok(service)
}
async fn auth(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let expected = format!("Bearer {}", state.service.token);
    if headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        != Some(expected.as_str())
    {
        return api_error(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Invalid Bridge token.",
        );
    }
    next.run(request).await
}
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"ok"}))
}
async fn vaults(State(state): State<BridgeState>) -> Response {
    match config::load_config(&state.app) {
        Ok(value) => {
            let items: Vec<_> = value
                .vaults
                .into_iter()
                .map(|vault| serde_json::json!({"id": vault.id, "name": vault.name}))
                .collect();
            Json(serde_json::json!({"items": items})).into_response()
        }
        Err(_) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Unable to load vaults.",
        ),
    }
}
async fn search(
    State(state): State<BridgeState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let notes = state.notes.read().await;
    let items = note_index::search(
        &notes,
        query.get("q").map(String::as_str).unwrap_or(""),
        query.get("excludeVaultId").map(String::as_str),
        query.get("vaultId").map(String::as_str),
        query
            .get("limit")
            .and_then(|value| value.parse().ok())
            .unwrap_or(20),
    );
    Json(serde_json::json!({"items": items}))
}
async fn resolve(
    State(state): State<BridgeState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let notes = state.notes.read().await;
    let vault = query.get("vault").map(|value| value.to_lowercase());
    let path = query.get("path").map(|value| {
        value
            .trim_end_matches(".md")
            .replace('\\', "/")
            .to_lowercase()
    });
    match notes.iter().find(|note| {
        Some(note.vault_name.to_lowercase()) == vault
            && Some(note.relative_path.trim_end_matches(".md").to_lowercase()) == path
    }) {
        Some(note) => Json(note).into_response(),
        None => api_error(
            StatusCode::NOT_FOUND,
            "NOTE_NOT_FOUND",
            "Target note was not found.",
        ),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Heartbeat {
    vault_id: String,
}
async fn heartbeat(
    State(state): State<BridgeState>,
    Json(payload): Json<Heartbeat>,
) -> Json<serde_json::Value> {
    state
        .heartbeats
        .write()
        .await
        .insert(payload.vault_id, now());
    Json(serde_json::json!({"status":"connected"}))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    vault_id: String,
    relative_path: String,
    heading: Option<String>,
    block_id: Option<String>,
}
async fn open_note(State(state): State<BridgeState>, Json(payload): Json<OpenRequest>) -> Response {
    if Path::new(&payload.relative_path).components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_LINK",
            "Invalid note path.",
        );
    }
    let notes = state.notes.read().await;
    let Some(note) = notes.iter().find(|note| {
        note.vault_id == payload.vault_id
            && note
                .relative_path
                .eq_ignore_ascii_case(&payload.relative_path)
    }) else {
        return api_error(
            StatusCode::NOT_FOUND,
            "NOTE_NOT_FOUND",
            "Target note was not found.",
        );
    };
    let mut uri = Url::parse("obsidian://open").unwrap();
    uri.query_pairs_mut()
        .append_pair("vault", &note.vault_name)
        .append_pair("file", note.relative_path.trim_end_matches(".md"));
    if let Some(heading) = payload.heading {
        uri.query_pairs_mut().append_pair("heading", &heading);
    }
    if let Some(block) = payload.block_id {
        uri.query_pairs_mut().append_pair("block", &block);
    }
    match state.app.opener().open_url(uri.as_str(), None::<&str>) {
        Ok(()) => Json(serde_json::json!({"uri":uri.as_str()})).into_response(),
        Err(_) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Unable to open Obsidian URI.",
        ),
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn start(app: AppHandle) -> Result<BridgeState, AppError> {
    let service = load_or_create_service(&app)?;
    let config = config::load_config(&app)?;
    let index_path = app
        .path()
        .app_config_dir()
        .map(|path| path.join(INDEX_FILE))
        .map_err(|_| AppError::new("CONFIG_PATH_FAILED", "无法定位笔记索引缓存。"))?;
    let cached_notes = fs::read_to_string(&index_path)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    let notes = Arc::new(RwLock::new(cached_notes));
    let state = BridgeState {
        app,
        service,
        notes,
        heartbeats: Arc::new(RwLock::new(HashMap::new())),
    };
    let server_state = state.clone();
    let refresh_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let vaults = config.vaults;
        if let Ok(refreshed) =
            tauri::async_runtime::spawn_blocking(move || note_index::build(&vaults)).await
        {
            let _ = fs::write(
                &index_path,
                serde_json::to_vec_pretty(&refreshed).unwrap_or_default(),
            );
            *refresh_state.notes.write().await = refreshed;
        }
    });
    tauri::async_runtime::spawn(async move {
        let protected = Router::new()
            .route("/api/v1/health", get(health))
            .route("/api/v1/vaults", get(vaults))
            .route("/api/v1/search", get(search))
            .route("/api/v1/notes/resolve", get(resolve))
            .route("/api/v1/bridge/heartbeat", post(heartbeat))
            .route("/api/v1/open", post(open_note))
            .layer(DefaultBodyLimit::max(16 * 1024))
            .route_layer(middleware::from_fn_with_state(server_state.clone(), auth))
            .with_state(server_state);
        if let Ok(listener) =
            tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 27124))).await
        {
            let _ = axum::serve(listener, protected).await;
        }
    });
    Ok(state)
}
pub async fn rebuild(state: &BridgeState, vaults: &[config::VaultEntry]) {
    let refreshed = note_index::build(vaults);
    if let Ok(directory) = state.app.path().app_config_dir() {
        let _ = fs::write(
            directory.join(INDEX_FILE),
            serde_json::to_vec_pretty(&refreshed).unwrap_or_default(),
        );
    }
    *state.notes.write().await = refreshed;
}

pub fn install_bridge(
    app: &AppHandle,
    vault_path: &str,
    vault_id: &str,
) -> Result<String, AppError> {
    let root = fs::canonicalize(vault_path)
        .map_err(|_| AppError::new("VAULT_PATH_NOT_FOUND", "仓库路径不存在。"))?;
    if !root.join(".obsidian").is_dir() {
        return Err(AppError::new(
            "VAULT_MARKER_NOT_FOUND",
            "目标不是 Obsidian 仓库。",
        ));
    }
    let source = app
        .path()
        .resource_dir()
        .map_err(|_| AppError::new("BRIDGE_ASSETS_MISSING", "无法定位 Bridge 构建产物。"))?
        .join("bridge");
    let target = root.join(".obsidian/plugins/obsidian-hub-bridge");
    fs::create_dir_all(&target)
        .map_err(|_| AppError::new("BRIDGE_INSTALL_FAILED", "无法创建 Bridge 插件目录。"))?;
    for file in ["manifest.json", "main.js", "styles.css"] {
        fs::copy(source.join(file), target.join(file)).map_err(|_| {
            AppError::new(
                "BRIDGE_ASSETS_MISSING",
                "Bridge 构建产物缺失，请先构建插件。",
            )
        })?;
    }
    let service = load_or_create_service(app)?;
    fs::write(target.join("data.json"), serde_json::to_vec_pretty(&serde_json::json!({"apiBaseUrl":service.api_base_url,"token":service.token,"vaultId":vault_id,"excludeCurrentVault":true,"showCrossVaultIcon":true,"resultLimit":20,"requestTimeoutMs":1500})).unwrap_or_default()).map_err(|_| AppError::new("BRIDGE_INSTALL_FAILED", "无法写入 Bridge 配置。"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn bundled_manifest(app: &AppHandle) -> Result<BridgeManifest, AppError> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|_| AppError::new("BRIDGE_ASSETS_MISSING", "无法定位 Bridge 构建产物。"))?
        .join("bridge/manifest.json");
    let contents = fs::read_to_string(path)
        .map_err(|_| AppError::new("BRIDGE_ASSETS_MISSING", "Bridge manifest 缺失。"))?;
    serde_json::from_str(&contents)
        .map_err(|_| AppError::new("BRIDGE_ASSETS_INVALID", "Bridge manifest 无法解析。"))
}

pub async fn bridge_status(
    state: &BridgeState,
    vault_path: &str,
    vault_id: &str,
) -> Result<BridgeStatus, AppError> {
    let bundled_version = bundled_manifest(&state.app)?.version;
    let manifest_path =
        Path::new(vault_path).join(".obsidian/plugins/obsidian-hub-bridge/manifest.json");
    if !manifest_path.is_file() {
        return Ok(BridgeStatus {
            state: "not-installed",
            installed_version: None,
            bundled_version,
        });
    }
    let installed_version = fs::read_to_string(manifest_path)
        .ok()
        .and_then(|value| serde_json::from_str::<BridgeManifest>(&value).ok())
        .map(|manifest| manifest.version);
    let connected = state
        .heartbeats
        .read()
        .await
        .get(vault_id)
        .is_some_and(|last_seen| now().saturating_sub(*last_seen) <= 120);
    let state_name =
        classify_bridge_state(installed_version.as_deref(), &bundled_version, connected);
    if state_name == "outdated" {
        return Ok(BridgeStatus {
            state: state_name,
            installed_version,
            bundled_version,
        });
    }
    Ok(BridgeStatus {
        state: state_name,
        installed_version,
        bundled_version,
    })
}

fn classify_bridge_state(
    installed_version: Option<&str>,
    bundled_version: &str,
    connected: bool,
) -> &'static str {
    if installed_version != Some(bundled_version) {
        "outdated"
    } else if connected {
        "connected"
    } else {
        "installed-disabled"
    }
}

#[cfg(test)]
mod tests {
    use super::classify_bridge_state;

    #[test]
    fn classifies_installed_bridge_using_version_and_heartbeat() {
        assert_eq!(
            classify_bridge_state(Some("0.0.9"), "0.1.0", true),
            "outdated"
        );
        assert_eq!(
            classify_bridge_state(Some("0.1.0"), "0.1.0", false),
            "installed-disabled"
        );
        assert_eq!(
            classify_bridge_state(Some("0.1.0"), "0.1.0", true),
            "connected"
        );
    }
}
