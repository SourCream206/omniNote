use super::{Workspace, WorkspaceError};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use uuid::Uuid;

pub fn valid_extension_id(id: &str) -> bool {
    id.len() <= 100 && id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-')
}

pub fn valid_extension_file(name: &str) -> bool {
    name.len() <= 120 && name.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && [".json", ".js", ".html"].iter().any(|suffix| name.ends_with(suffix))
}

fn checked_file(path: &Path, maximum: u64) -> Result<Vec<u8>, WorkspaceError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > maximum {
        return Err(WorkspaceError::InvalidExtension);
    }
    Ok(fs::read(path)?)
}

fn manifest_at(directory: &Path, id: &str) -> Result<Value, WorkspaceError> {
    if !valid_extension_id(id) || fs::symlink_metadata(directory)?.file_type().is_symlink() {
        return Err(WorkspaceError::InvalidExtension);
    }
    let manifest: Value = serde_json::from_slice(&checked_file(&directory.join("extension.json"), 64 * 1024)?)?;
    let permissions = manifest.get("permissions").and_then(Value::as_array).ok_or(WorkspaceError::InvalidExtension)?;
    if manifest.get("id").and_then(Value::as_str) != Some(id)
        || !manifest.get("apiVersion").and_then(Value::as_str).is_some_and(|version| version.starts_with("1."))
        || !manifest.get("main").and_then(Value::as_str).is_some_and(|name| valid_extension_file(name) && name.ends_with(".js"))
        || !manifest.get("contributes").is_some_and(Value::is_object)
        || permissions.iter().any(|value| !value.as_str().is_some_and(|text| text.len() <= 80)) {
        return Err(WorkspaceError::InvalidExtension);
    }
    Ok(manifest)
}

impl Workspace {
    fn extension_directory(&self, id: &str) -> Result<std::path::PathBuf, WorkspaceError> {
        if !valid_extension_id(id) { return Err(WorkspaceError::InvalidExtension); }
        Ok(self.root.join("extensions").join(id))
    }

    pub fn install_extension(&self, id: &str, files: &[(String, Vec<u8>)]) -> Result<(), WorkspaceError> {
        let destination = self.extension_directory(id)?;
        if destination.exists() || files.is_empty() || files.len() > 30 { return Err(WorkspaceError::InvalidExtension); }
        let extension_root = self.root.join("extensions");
        let staging = extension_root.join(format!(".install-{}", Uuid::new_v4()));
        fs::create_dir(&staging)?;
        let result = (|| -> Result<(), WorkspaceError> {
            let mut total = 0usize;
            for (name, bytes) in files {
                total = total.checked_add(bytes.len()).ok_or(WorkspaceError::InvalidExtension)?;
                if !valid_extension_file(name) || total > 20 * 1024 * 1024 { return Err(WorkspaceError::InvalidExtension); }
                let mut file = OpenOptions::new().write(true).create_new(true).open(staging.join(name))?;
                file.write_all(bytes)?;
            }
            let manifest = manifest_at(&staging, id)?;
            if !staging.join(manifest["main"].as_str().ok_or(WorkspaceError::InvalidExtension)?).is_file() {
                return Err(WorkspaceError::InvalidExtension);
            }
            fs::rename(&staging, destination)?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_dir_all(staging); }
        result
    }

    pub fn list_extensions(&self) -> Result<Vec<Value>, WorkspaceError> {
        let mut extensions = Vec::new();
        for entry in fs::read_dir(self.root.join("extensions"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let Some(id) = entry.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(manifest) = manifest_at(&entry.path(), &id) else { continue };
            let enabled: Option<String> = self.connection.query_row(
                "SELECT value_json FROM extension_state WHERE extension_id=?1 AND key='enabled'", [&id], |row| row.get(0)
            ).optional()?;
            let mut grants = self.connection.prepare("SELECT permission FROM extension_grants WHERE extension_id=?1")?;
            let granted: Vec<String> = grants.query_map([&id], |row| row.get(0))?.collect::<Result<_, _>>()?;
            let mut settings = serde_json::Map::new();
            if let Some(definitions) = manifest.pointer("/contributes/settings").and_then(Value::as_array) {
                for definition in definitions {
                    let Some(key) = definition.get("key").and_then(Value::as_str) else { continue };
                    let stored: Option<String> = self.connection.query_row(
                        "SELECT value_json FROM extension_state WHERE extension_id=?1 AND key=?2", params![id, key], |row| row.get(0)
                    ).optional()?;
                    settings.insert(key.to_owned(), stored.and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_else(|| definition["default"].clone()));
                }
            }
            extensions.push(json!({"manifest": manifest, "enabled": enabled.as_deref() == Some("true"), "grantedPermissions": granted, "settings": settings}));
        }
        Ok(extensions)
    }

    pub fn set_extension_enabled(&self, id: &str, enabled: bool, permissions: &[String]) -> Result<(), WorkspaceError> {
        let manifest = manifest_at(&self.extension_directory(id)?, id)?;
        let declared = manifest["permissions"].as_array().ok_or(WorkspaceError::InvalidExtension)?;
        if permissions.iter().any(|permission| !declared.iter().any(|item| item.as_str() == Some(permission))) {
            return Err(WorkspaceError::InvalidExtension);
        }
        self.connection.execute("INSERT INTO extension_state VALUES (?1, 'enabled', ?2) ON CONFLICT(extension_id, key) DO UPDATE SET value_json=excluded.value_json", params![id, if enabled { "true" } else { "false" }])?;
        if enabled {
            for permission in permissions {
                self.connection.execute("INSERT OR IGNORE INTO extension_grants VALUES (?1, ?2)", params![id, permission])?;
            }
        }
        Ok(())
    }

    pub fn set_extension_setting(&self, id: &str, key: &str, value: &Value) -> Result<(), WorkspaceError> {
        let manifest = manifest_at(&self.extension_directory(id)?, id)?;
        let definition = manifest.pointer("/contributes/settings").and_then(Value::as_array)
            .and_then(|settings| settings.iter().find(|entry| entry["key"] == key)).ok_or(WorkspaceError::InvalidExtension)?;
        if key == "enabled" || !match definition["type"].as_str() {
            Some("boolean") => value.is_boolean(),
            Some("string") => value.as_str().is_some_and(|text| text.len() <= 1000),
            _ => false,
        } { return Err(WorkspaceError::InvalidExtension); }
        self.connection.execute("INSERT INTO extension_state VALUES (?1, ?2, ?3) ON CONFLICT(extension_id, key) DO UPDATE SET value_json=excluded.value_json", params![id, key, value.to_string()])?;
        Ok(())
    }

    pub fn extension_source(&self, id: &str) -> Result<String, WorkspaceError> {
        let extension = self.list_extensions()?.into_iter().find(|entry| entry["manifest"]["id"] == id && entry["enabled"] == true).ok_or(WorkspaceError::InvalidExtension)?;
        let name = extension["manifest"]["main"].as_str().ok_or(WorkspaceError::InvalidExtension)?;
        String::from_utf8(checked_file(&self.extension_directory(id)?.join(name), 1024 * 1024)?)
            .map_err(|_| WorkspaceError::InvalidExtension)
    }

    pub fn extension_resource(&self, id: &str, name: &str) -> Result<String, WorkspaceError> {
        let extension = self.list_extensions()?.into_iter().find(|entry| entry["manifest"]["id"] == id && entry["enabled"] == true).ok_or(WorkspaceError::InvalidExtension)?;
        let contributes = &extension["manifest"]["contributes"];
        let declared = ["canvasObjectTypes", "documentViewers"].iter().any(|key| {
            contributes[*key].as_array().is_some_and(|items| items.iter().any(|item| item["entry"] == name))
        });
        if !valid_extension_file(name) || !name.ends_with(".html") || !declared { return Err(WorkspaceError::InvalidExtension); }
        String::from_utf8(checked_file(&self.extension_directory(id)?.join(name), 1024 * 1024)?)
            .map_err(|_| WorkspaceError::InvalidExtension)
    }
}
