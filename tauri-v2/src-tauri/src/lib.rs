//! Tauri shell for the existing omniNote workspace UI.

use omninote_workspace_core::Workspace;
use serde_json::{json, Value};
use std::fs;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
mod marketplace;
mod updates;

struct WorkspaceState(Mutex<Workspace>);

fn parse_id(id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(id).map_err(|_| "Invalid node ID".to_owned())
}

#[tauri::command(async)]
fn load_workspace(state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let workspace = state.0.lock().map_err(|_| "Workspace lock failed")?;
    let all_nodes = workspace.list_all_nodes().map_err(|error| error.to_string())?;
    let nodes: Vec<_> = all_nodes.iter().map(|node| json!({
        "id": node.id, "parent_id": node.parent_id, "kind": node.kind,
        "title": node.title, "order_index": node.sort_order,
        "created_at": "", "updated_at": "", "folder_icon": node.folder_icon, "folder_color": node.folder_color
    })).collect();
    let page_data = workspace.list_pages().map_err(|error| error.to_string())?;
    let pages: Vec<_> = page_data.iter().map(|page| json!({
        "id": page.id, "camera_x": page.camera_x, "camera_y": page.camera_y,
        "camera_zoom": page.camera_zoom, "paper_style": page.paper_style
    })).collect();
    let objects: Vec<_> = page_data.into_iter().flat_map(|page| page.objects).collect();
    let document_pages: Vec<_> = workspace.list_document_pages().map_err(|error| error.to_string())?
        .into_iter().map(|(page_id, asset_id)| json!({ "page_id": page_id, "asset_id": asset_id })).collect();
    Ok(json!({
        "schemaVersion": workspace.version(),
        "directory": workspace.root().to_string_lossy(),
        "nodes": nodes, "pages": pages, "objects": objects,
        "documentPages": document_pages, "assets": workspace.list_assets().map_err(|error| error.to_string())?
    }))
}

#[tauri::command]
fn create_node(state: State<'_, WorkspaceState>, parent_id: Option<String>, kind: String, title: String) -> Result<String, String> {
    let mut workspace = state.0.lock().map_err(|_| "Workspace lock failed")?;
    let parent = parent_id.as_deref().map(parse_id).transpose()?;
    let node = match (kind.as_str(), parent) {
        ("notebook", None) => workspace.create_notebook(&title),
        ("folder" | "section", Some(id)) => workspace.create_folder(id, &title),
        ("page", Some(id)) => workspace.create_page(id, &title),
        _ => return Err("Invalid node parent or kind".to_owned()),
    }.map_err(|error| error.to_string())?;
    Ok(node.id.to_string())
}

#[tauri::command]
fn create_document_page(state: State<'_, WorkspaceState>, section_id: String, asset_id: String) -> Result<String, String> {
    let page = state.0.lock().map_err(|_| "Workspace lock failed")?
        .create_document_page(parse_id(&section_id)?, parse_id(&asset_id)?)
        .map_err(|error| error.to_string())?;
    Ok(page.id.to_string())
}

#[tauri::command]
fn rename_node(state: State<'_, WorkspaceState>, node_id: String, title: String) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .rename_node(parse_id(&node_id)?, &title).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_folder_appearance(state: State<'_, WorkspaceState>, node_id: String, icon: String, color: String) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .set_folder_appearance(parse_id(&node_id)?, &icon, &color).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_node(state: State<'_, WorkspaceState>, node_id: String) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .delete_node(parse_id(&node_id)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn move_node(state: State<'_, WorkspaceState>, node_id: String, parent_id: Option<String>, before_id: Option<String>) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .move_node(parse_id(&node_id)?, parent_id.as_deref().map(parse_id).transpose()?, before_id.as_deref().map(parse_id).transpose()?)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
fn import_asset_raw(state: State<'_, WorkspaceState>, request: Request<'_>) -> Result<omninote_workspace_core::Asset, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Expected file bytes".to_owned()) };
    if bytes.is_empty() || bytes.len() > 512 * 1024 * 1024 { return Err("File size is unsupported".to_owned()); }
    let encoded_name = request.headers().get("x-file-name").and_then(|header| header.to_str().ok()).ok_or("Missing file name")?;
    let name = url::form_urlencoded::parse(format!("name={encoded_name}").as_bytes())
        .find(|(key, _)| key == "name").map(|(_, value)| value.into_owned()).ok_or("Invalid file name")?;
    let mime_type = request.headers().get("x-mime-type").and_then(|header| header.to_str().ok()).unwrap_or("application/octet-stream");
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .import_asset(&name, mime_type, bytes).map_err(|error| error.to_string())
}

#[tauri::command(async)]
fn read_asset(state: State<'_, WorkspaceState>, asset_id: String) -> Result<Response, String> {
    let bytes = state.0.lock().map_err(|_| "Workspace lock failed")?
        .read_asset(parse_id(&asset_id)?).map_err(|error| error.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command(async)]
fn pick_assets(app: tauri::AppHandle, state: State<'_, WorkspaceState>) -> Result<Vec<omninote_workspace_core::Asset>, String> {
    let selected = app.dialog().file().blocking_pick_files().unwrap_or_default();
    if selected.len() > 50 { return Err("Select up to 50 files at a time".to_owned()); }
    let workspace = state.0.lock().map_err(|_| "Workspace lock failed")?;
    selected.iter().map(|selected| {
        let path = selected.as_path().ok_or("This file source is not supported on this platform yet")?;
        workspace.import_file(path).map_err(|error| error.to_string())
    }).collect()
}

#[tauri::command(async)]
fn export_workspace(app: tauri::AppHandle, state: State<'_, WorkspaceState>) -> Result<bool, String> {
    let Some(selected) = app.dialog().file()
        .add_filter("ZIP archive", &["zip"])
        .set_file_name("omninote-backup.zip")
        .blocking_save_file() else { return Ok(false) };
    let path = selected.as_path().ok_or("This destination is not supported on this platform yet")?;
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .export_archive(path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn list_extensions(state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let workspace = state.0.lock().map_err(|_| "Workspace lock failed")?;
    Ok(json!(workspace.list_extensions().map_err(|error| error.to_string())?))
}

#[tauri::command]
async fn search_marketplace(query: String) -> Result<Value, String> {
    marketplace::search(&query).await
}

#[tauri::command]
async fn install_marketplace_extension(app: tauri::AppHandle, extension_id: String, version: String) -> Result<Value, String> {
    let files = marketplace::download(&extension_id, &version).await?;
    app.state::<WorkspaceState>().0.lock().map_err(|_| "Workspace lock failed")?
        .install_extension(&extension_id, &files).map_err(|error| error.to_string())?;
    Ok(json!({ "id": extension_id, "version": version }))
}

#[tauri::command]
fn extension_source(state: State<'_, WorkspaceState>, extension_id: String) -> Result<String, String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .extension_source(&extension_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn extension_resource(state: State<'_, WorkspaceState>, extension_id: String, file_name: String) -> Result<String, String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .extension_resource(&extension_id, &file_name).map_err(|error| error.to_string())
}

#[tauri::command]
fn enable_extension(state: State<'_, WorkspaceState>, extension_id: String, enabled: bool, permissions: Vec<String>) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .set_extension_enabled(&extension_id, enabled, &permissions).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_extension_setting(state: State<'_, WorkspaceState>, extension_id: String, key: String, value: Value) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .set_extension_setting(&extension_id, &key, &value).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_extension_export(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if name.is_empty() || name.len() > 120 || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || bytes.is_empty() || bytes.len() > 100 * 1024 * 1024 { return Err("Invalid extension export".into()); }
    let Some(selected) = app.dialog().file().set_file_name(&name).blocking_save_file() else { return Ok(false) };
    let path = selected.as_path().ok_or("This destination is not supported on this platform yet")?;
    fs::write(path, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn open_workspace_folder(app: tauri::AppHandle, state: State<'_, WorkspaceState>) -> Result<(), String> {
    let path = state.0.lock().map_err(|_| "Workspace lock failed")?.root().to_path_buf();
    app.opener().open_path(path.to_str().ok_or("Workspace path is not Unicode")?, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn reveal_node(app: tauri::AppHandle, state: State<'_, WorkspaceState>, node_id: String) -> Result<(), String> {
    let path = state.0.lock().map_err(|_| "Workspace lock failed")?
        .node_path(parse_id(&node_id)?).map_err(|error| error.to_string())?;
    app.opener().reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_original(app: tauri::AppHandle, state: State<'_, WorkspaceState>, asset_id: String) -> Result<(), String> {
    let path = state.0.lock().map_err(|_| "Workspace lock failed")?
        .asset_path(parse_id(&asset_id)?).map_err(|error| error.to_string())?;
    app.opener().open_path(path.to_str().ok_or("Asset path is not Unicode")?, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, address: String) -> Result<(), String> {
    let parsed = url::Url::parse(&address).map_err(|_| "Invalid link")?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") { return Err("Unsupported link type".to_owned()); }
    app.opener().open_url(address, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command(async)]
fn save_page(state: State<'_, WorkspaceState>, page_id: String, objects: Vec<Value>, camera: Value) -> Result<(), String> {
    let workspace = state.0.lock().map_err(|_| "Workspace lock failed")?;
    let (x, y, zoom) = camera_values(&camera)?;
    workspace.save_page(parse_id(&page_id)?, &objects, x, y, zoom).map_err(|error| error.to_string())
}

#[tauri::command(async)]
fn save_camera(state: State<'_, WorkspaceState>, page_id: String, camera: Value) -> Result<(), String> {
    let workspace = state.0.lock().map_err(|_| "Workspace lock failed")?;
    let (x, y, zoom) = camera_values(&camera)?;
    workspace.save_camera(parse_id(&page_id)?, x, y, zoom).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_page_style(state: State<'_, WorkspaceState>, page_id: String, style: String) -> Result<(), String> {
    state.0.lock().map_err(|_| "Workspace lock failed")?
        .set_page_style(parse_id(&page_id)?, &style).map_err(|error| error.to_string())
}

fn camera_values(camera: &Value) -> Result<(f64, f64, f64), String> {
    let number = |key| camera.get(key).and_then(Value::as_f64).ok_or_else(|| format!("Invalid camera {key}"));
    Ok((number("x")?, number("y")?, number("zoom")?))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let documents = app.path().document_dir()?;
            let parent = documents.join("omniNote").join("workspaces");
            fs::create_dir_all(&parent)?;
            let path = parent.join("Default");
            let workspace = if path.join("workspace.json").exists() {
                Workspace::open(&path)?
            } else {
                Workspace::create(&path)?
            };
            app.manage(WorkspaceState(Mutex::new(workspace)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_workspace, create_node, create_document_page, rename_node, set_folder_appearance, delete_node, move_node, save_page, save_camera, set_page_style, import_asset_raw, read_asset, pick_assets, export_workspace, list_extensions, search_marketplace, install_marketplace_extension, extension_source, extension_resource, enable_extension, set_extension_setting, save_extension_export, open_workspace_folder, reveal_node, open_original, open_external, updates::check_for_updates, updates::prompt_to_install_update])
        .run(tauri::generate_context!())
        .expect("failed to run omniNote");
}
