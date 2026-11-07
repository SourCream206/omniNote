use serde_json::{json, Value};

fn status(state: &str, message: impl AsRef<str>, version: Option<&str>) -> Value {
    let mut result = json!({ "state": state, "message": message.as_ref() });
    if let Some(version) = version { result["version"] = json!(version); }
    result
}

#[cfg(desktop)]
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle, ignored_version: Option<String>) -> Result<Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|error| error.to_string())?.check().await;
    Ok(match update {
        Ok(Some(update)) if ignored_version.as_deref() == Some(&update.version) =>
            status("ignored", format!("Version {} was ignored.", update.version), Some(&update.version)),
        Ok(Some(update)) => status("available", format!("Version {} is available.", update.version), Some(&update.version)),
        Ok(None) => status("up-to-date", "You have the latest version.", None),
        Err(tauri_plugin_updater::Error::ReleaseNotFound) =>
            status("error", "No signed Tauri update release is available yet. Check again later.", None),
        Err(_) => status("error", "Could not check for updates. Check your connection and try again.", None),
    })
}

#[cfg(desktop)]
#[tauri::command]
pub async fn prompt_to_install_update(app: tauri::AppHandle, version: String) -> Result<Value, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
    use tauri_plugin_updater::UpdaterExt;

    let Some(update) = app.updater().map_err(|error| error.to_string())?.check().await.map_err(|error| error.to_string())? else {
        return Ok(status("up-to-date", "You have the latest version.", None));
    };
    if update.version != version { return Err("The available update changed. Check again before installing.".into()); }
    let answer = app.dialog().message(format!("Install omniNote {version}? Your local notebooks will stay on this computer."))
        .title("omniNote update")
        .buttons(MessageDialogButtons::YesNoCancelCustom("Install".into(), "Ignore".into(), "Cancel".into()))
        .blocking_show_with_result();
    match answer {
        MessageDialogResult::Custom(ref label) if label == "Install" => {
            update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
            app.restart()
        }
        MessageDialogResult::Custom(ref label) if label == "Ignore" => Ok(status("ignored", format!("Version {version} was ignored."), Some(&version))),
        _ => Ok(status("available", format!("Version {version} is available."), Some(&version))),
    }
}

#[cfg(mobile)]
#[tauri::command]
pub async fn check_for_updates(_app: tauri::AppHandle, _ignored_version: Option<String>) -> Result<Value, String> {
    Ok(status("unavailable", "Updates are provided by the app store on this device.", None))
}

#[cfg(mobile)]
#[tauri::command]
pub async fn prompt_to_install_update(_app: tauri::AppHandle, _version: String) -> Result<Value, String> {
    Ok(status("unavailable", "Updates are provided by the app store on this device.", None))
}
