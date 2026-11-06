use omninote_workspace_core::{valid_extension_file, valid_extension_id};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::time::Duration;
use url::Url;

const MAX_CATALOG: usize = 512 * 1024;
const MAX_PACKAGE: usize = 10 * 1024 * 1024;
const MAX_UNPACKED: usize = 20 * 1024 * 1024;

struct Entry {
    id: String,
    version: String,
    api_version: String,
    name: String,
    summary: String,
    permissions: Vec<String>,
    package_url: Url,
    sha256: String,
}

fn catalog_url() -> Result<Url, String> {
    let distribution: Value = serde_json::from_str(include_str!("../../../distribution.json")).map_err(|error| error.to_string())?;
    let url = Url::parse(distribution["marketplaceUrl"].as_str().ok_or("Marketplace URL is missing")?).map_err(|error| error.to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("Marketplace URL must use HTTPS".into());
    }
    Ok(url)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15)).build().map_err(|error| error.to_string())
}

async fn fetch_limited(client: &reqwest::Client, url: Url, maximum: usize) -> Result<Vec<u8>, String> {
    let mut response = client.get(url).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() { return Err(format!("Marketplace request failed ({})", response.status())); }
    if response.content_length().is_some_and(|length| length > maximum as u64) { return Err("Marketplace response is too large".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len() + chunk.len() > maximum { return Err("Marketplace response is too large".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn valid_version(value: &str) -> bool {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    core.split('.').count() == 3 && core.split('.').all(|piece| !piece.is_empty() && piece.bytes().all(|byte| byte.is_ascii_digit()))
        && value.len() <= 80 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

fn parse_catalog(bytes: &[u8], catalog_url: &Url) -> Result<Vec<Entry>, String> {
    let catalog: Value = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    let extensions = catalog["extensions"].as_array().ok_or("Invalid marketplace catalog")?;
    if catalog["schemaVersion"] != 1 || extensions.len() > 500 { return Err("Invalid marketplace catalog".into()); }
    extensions.iter().map(|item| {
        let text = |key| item[key].as_str().ok_or_else(|| "Invalid marketplace entry".to_owned());
        let id = text("id")?;
        let version = text("version")?;
        let api_version = text("apiVersion")?;
        let name = text("name")?;
        let summary = text("summary")?;
        let hash = text("sha256")?;
        let permissions = item["permissions"].as_array().ok_or("Invalid marketplace entry")?
            .iter().map(|permission| permission.as_str().map(str::to_owned).ok_or("Invalid marketplace entry".to_owned())).collect::<Result<Vec<_>, _>>()?;
        let package_url = catalog_url.join(text("package")?).map_err(|_| "Invalid marketplace package URL")?;
        if !valid_extension_id(id) || !valid_version(version) || !api_version.starts_with("1.")
            || name.len() > 100 || summary.len() > 300 || permissions.iter().any(|permission| permission.len() > 80)
            || hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || package_url.origin() != catalog_url.origin() || !package_url.path().ends_with(".zip")
            || !package_url.username().is_empty() || package_url.password().is_some() {
            return Err("Invalid marketplace entry".into());
        }
        Ok(Entry { id: id.into(), version: version.into(), api_version: api_version.into(), name: name.into(), summary: summary.into(), permissions, package_url, sha256: hash.to_ascii_lowercase() })
    }).collect()
}

async fn catalog() -> Result<(reqwest::Client, Vec<Entry>), String> {
    let url = catalog_url()?;
    let client = client()?;
    let bytes = fetch_limited(&client, url.clone(), MAX_CATALOG).await?;
    Ok((client, parse_catalog(&bytes, &url)?))
}

pub async fn search(query: &str) -> Result<Value, String> {
    if query.len() > 100 { return Err("Invalid marketplace search".into()); }
    let (_, entries) = catalog().await?;
    let needle = query.trim().to_lowercase();
    let entries: Vec<_> = entries.into_iter().filter(|entry| format!("{} {} {}", entry.id, entry.name, entry.summary).to_lowercase().contains(&needle))
        .map(|entry| json!({"id":entry.id,"name":entry.name,"summary":entry.summary,"version":entry.version,"apiVersion":entry.api_version,"permissions":entry.permissions})).collect();
    Ok(json!({"configured":true,"entries":entries}))
}

fn unpack_package(bytes: Vec<u8>, entry: &Entry) -> Result<Vec<(String, Vec<u8>)>, String> {
    if format!("{:x}", Sha256::digest(&bytes)) != entry.sha256 { return Err("Extension package checksum mismatch".into()); }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    let mut total = 0usize;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        if file.is_dir() { continue; }
        let name = file.name().to_owned();
        let symlink = file.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000);
        let file_size = usize::try_from(file.size()).map_err(|_| "Extension package is too large")?;
        total = total.checked_add(file_size).ok_or("Extension package is too large")?;
        if !valid_extension_file(&name) || symlink || total > MAX_UNPACKED || files.len() >= 30 {
            return Err("Invalid extension package contents".into());
        }
        let mut content = Vec::new();
        file.take((MAX_UNPACKED - (total - file_size) + 1) as u64).read_to_end(&mut content).map_err(|error| error.to_string())?;
        if content.len() != file_size { return Err("Extension package is too large or incomplete".into()); }
        files.push((name, content));
    }
    let manifest_bytes = files.iter().find(|(name, _)| name == "extension.json").ok_or("Extension manifest missing")?.1.as_slice();
    let manifest: Value = serde_json::from_slice(manifest_bytes).map_err(|error| error.to_string())?;
    let mut permissions = manifest["permissions"].as_array().ok_or("Invalid extension permissions")?
        .iter().map(|value| value.as_str().map(str::to_owned).ok_or("Invalid extension permissions".to_owned())).collect::<Result<Vec<_>, _>>()?;
    let mut listed = entry.permissions.clone();
    permissions.sort();
    listed.sort();
    if manifest["id"] != entry.id || manifest["version"] != entry.version || manifest["apiVersion"] != entry.api_version
        || permissions != listed || !manifest["main"].as_str().is_some_and(|name| name.ends_with(".js") && files.iter().any(|(file, _)| file == name))
        || !manifest["contributes"].is_object() {
        return Err("Extension manifest differs from marketplace listing".into());
    }
    Ok(files)
}

pub async fn download(id: &str, version: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !valid_extension_id(id) || !valid_version(version) { return Err("Invalid extension selection".into()); }
    let (client, entries) = catalog().await?;
    let entry = entries.into_iter().find(|entry| entry.id == id && entry.version == version)
        .ok_or("Extension version is not in the marketplace")?;
    let bytes = fetch_limited(&client, entry.package_url.clone(), MAX_PACKAGE).await?;
    unpack_package(bytes, &entry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn rejects_cross_origin_packages_and_mismatched_hashes() {
        let catalog = Url::parse("https://example.com/catalog.json").unwrap();
        let data = br#"{"schemaVersion":1,"extensions":[{"id":"one.demo","name":"Demo","summary":"Test","version":"1.0.0","apiVersion":"1.0.0","permissions":[],"package":"https://evil.example/demo.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}"#;
        assert!(parse_catalog(data, &catalog).is_err());
        let data = String::from_utf8(data.to_vec()).unwrap().replace("https://evil.example/demo.zip", "demo.zip");
        let entry = parse_catalog(data.as_bytes(), &catalog).unwrap().remove(0);
        assert!(unpack_package(b"not a zip".to_vec(), &entry).is_err());
    }
    #[test]
    fn rejects_zip_entries_that_escape_the_extension_folder() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("../escape.js", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"bad").unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let entry = Entry {
            id: "one.demo".into(), version: "1.0.0".into(), api_version: "1.0.0".into(),
            name: "Demo".into(), summary: "Test".into(), permissions: Vec::new(),
            package_url: Url::parse("https://example.com/demo.zip").unwrap(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        assert!(unpack_package(bytes, &entry).is_err());
    }
}
