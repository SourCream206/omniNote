use serde_json::{json, Value};

#[cfg(target_os = "linux")]
const ARCH_UPDATE_TARGET: &str = "linux-x86_64-arch";

// The Arch package is repacked from a .deb, so Tauri's embedded bundle marker
// says "deb". Check the package owner instead of trusting that marker.
#[cfg(target_os = "linux")]
fn is_arch_package_install() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false; };
    let Ok(output) = std::process::Command::new("/usr/bin/pacman")
        .arg("-Qqo").arg("--").arg(exe).output() else { return false; };
    output.status.success() && output.stdout.as_slice() == b"omninote-bin\n"
}

#[cfg(desktop)]
async fn latest_update(app: &tauri::AppHandle) -> tauri_plugin_updater::Result<Option<tauri_plugin_updater::Update>> {
    use tauri_plugin_updater::UpdaterExt;
    #[cfg(target_os = "linux")]
    if is_arch_package_install() {
        return app.updater_builder().target(ARCH_UPDATE_TARGET).build()?.check().await;
    }
    app.updater()?.check().await
}

#[cfg(target_os = "linux")]
fn install_arch_package(bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    if !is_arch_package_install() { return Err("The Arch package is no longer installed. Check for updates again.".into()); }
    if !std::path::Path::new("/usr/bin/pkexec").is_file() {
        return Err("PolicyKit (pkexec) is required for an in-app Arch update. Install it, or download the Arch package and run sudo pacman -U on it.".into());
    }
    let path = std::env::temp_dir().join(format!("omninote-update-{}.pkg.tar.zst", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true)
            .open(&path).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        let exit = std::process::Command::new("/usr/bin/pkexec")
            .arg("/usr/bin/pacman").args(["-U", "--noconfirm", "--"])
            .arg(&path).status().map_err(|error| error.to_string())?;
        if exit.success() { Ok(()) }
        else { Err(format!("Arch package installation was cancelled or failed (exit {exit}). Try sudo pacman -U with the latest Arch package from the download page.")) }
    })();
    let _ = std::fs::remove_file(path);
    result
}

fn status(state: &str, message: impl AsRef<str>, version: Option<&str>) -> Value {
    let mut result = json!({ "state": state, "message": message.as_ref() });
    if let Some(version) = version { result["version"] = json!(version); }
    result
}

#[cfg(desktop)]
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle, ignored_version: Option<String>) -> Result<Value, String> {
    let update = latest_update(&app).await;
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

    let Some(update) = latest_update(&app).await.map_err(|error| error.to_string())? else {
        return Ok(status("up-to-date", "You have the latest version.", None));
    };
    if update.version != version { return Err("The available update changed. Check again before installing.".into()); }
    let answer = app.dialog().message(format!("Install omniNote {version}? Your local notebooks will stay on this computer."))
        .title("omniNote update")
        .buttons(MessageDialogButtons::YesNoCancelCustom("Install".into(), "Ignore".into(), "Cancel".into()))
        .blocking_show_with_result();
    match answer {
        MessageDialogResult::Custom(ref label) if label == "Install" => {
            #[cfg(target_os = "linux")]
            if is_arch_package_install() {
                let bytes = update.download(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
                tauri::async_runtime::spawn_blocking(move || install_arch_package(&bytes))
                    .await.map_err(|error| error.to_string())??;
                app.restart();
            }
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
