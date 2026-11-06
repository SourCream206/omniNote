//! Portable workspace storage shared by desktop and future mobile clients.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
mod extensions;
pub use extensions::{valid_extension_file, valid_extension_id};

pub const WORKSPACE_VERSION: u32 = 2;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("workspace is in use by another process")]
    Locked,
    #[error("workspace folder must be empty")]
    NotEmpty,
    #[error("workspace format version {0} is not supported")]
    UnsupportedVersion(u32),
    #[error("workspace manifest is invalid or does not match its database")]
    InvalidManifest,
    #[error("workspace root cannot be a symlink")]
    SymlinkRoot,
    #[error("node title is invalid on a supported filesystem")]
    InvalidName,
    #[error("a sibling already has this title")]
    NameConflict,
    #[error("a notebook or folder parent is required")]
    InvalidParent,
    #[error("node path escapes the workspace")]
    UnsafePath,
    #[error("extension package or permission is invalid")]
    InvalidExtension,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    format_version: u32,
    workspace_id: Uuid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Notebook,
    Folder,
    Page,
}

impl NodeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Notebook => "notebook",
            Self::Folder => "folder",
            Self::Page => "page",
        }
    }
    fn parse(value: &str) -> Result<Self, WorkspaceError> {
        match value {
            "notebook" => Ok(Self::Notebook),
            "folder" => Ok(Self::Folder),
            "page" => Ok(Self::Page),
            _ => Err(WorkspaceError::InvalidManifest),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub kind: NodeKind,
    pub title: String,
    pub relative_path: String,
    pub sort_order: i64,
    pub folder_icon: String,
    pub folder_color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PageState {
    pub id: Uuid,
    pub camera_x: f64,
    pub camera_y: f64,
    pub camera_zoom: f64,
    pub paper_style: String,
    pub objects: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Asset {
    pub id: Uuid,
    pub relative_path: String,
    pub original_name: String,
    pub mime_type: String,
    pub sha256: String,
    pub size: i64,
    pub updated_at: String,
}

pub struct Workspace {
    root: PathBuf,
    manifest: Manifest,
    connection: Connection,
    _lock: File,
}

impl Workspace {
    pub fn create(path: &Path) -> Result<Self, WorkspaceError> {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(WorkspaceError::SymlinkRoot);
                }
                if !metadata.is_dir() || fs::read_dir(path)?.next().is_some() {
                    return Err(WorkspaceError::NotEmpty);
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => fs::create_dir_all(path)?,
            Err(error) => return Err(error.into()),
        }
        let root = path.canonicalize()?;
        let lock = acquire_lock(&root)?;
        let manifest = Manifest {
            format_version: WORKSPACE_VERSION,
            workspace_id: Uuid::new_v4(),
        };
        let connection = Connection::open(root.join("notes.sqlite"))?;
        configure_database(&connection)?;
        connection.execute_batch(
            "CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE nodes (
               id TEXT PRIMARY KEY,
               parent_id TEXT REFERENCES nodes(id) ON DELETE RESTRICT,
               kind TEXT NOT NULL CHECK(kind IN ('notebook', 'folder', 'page')),
               title TEXT NOT NULL,
               title_key TEXT NOT NULL,
               relative_path TEXT NOT NULL UNIQUE,
               sort_order INTEGER NOT NULL,
               folder_icon TEXT NOT NULL DEFAULT 'default',
               folder_color TEXT NOT NULL DEFAULT '#89929e'
             );
             CREATE UNIQUE INDEX nodes_sibling_title ON nodes(COALESCE(parent_id, ''), title_key);
             CREATE INDEX nodes_parent_order ON nodes(parent_id, sort_order);
             CREATE TABLE page_state (
               id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
               camera_x REAL NOT NULL DEFAULT 0,
               camera_y REAL NOT NULL DEFAULT 0,
               camera_zoom REAL NOT NULL DEFAULT 1,
               paper_style TEXT NOT NULL DEFAULT 'blank',
               objects_json TEXT NOT NULL DEFAULT '[]'
             );
             CREATE TABLE assets (
               id TEXT PRIMARY KEY,
               relative_path TEXT NOT NULL UNIQUE,
               original_name TEXT NOT NULL,
               mime_type TEXT NOT NULL,
               sha256 TEXT NOT NULL,
               size INTEGER NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE document_pages (
               page_id TEXT PRIMARY KEY REFERENCES page_state(id) ON DELETE CASCADE,
               asset_id TEXT NOT NULL REFERENCES assets(id)
             );
             CREATE TABLE extension_state (extension_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(extension_id, key));
             CREATE TABLE extension_grants (extension_id TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(extension_id, permission));
             PRAGMA user_version = 2;",
        )?;
        connection.execute(
            "INSERT INTO workspace_meta (key, value) VALUES ('workspace_id', ?1)",
            [manifest.workspace_id.to_string()],
        )?;
        fs::create_dir(root.join("extensions"))?;
        fs::create_dir(root.join("cache"))?;
        fs::create_dir(root.join("assets"))?;
        fs::create_dir(root.join(".trash"))?;
        fs::write(root.join("settings.json"), b"{}\n")?;
        let bytes = serde_json::to_vec_pretty(&manifest)?;
        let temp = root.join("workspace.json.tmp");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temp, root.join("workspace.json"))?;
        Ok(Self {
            root,
            manifest,
            connection,
            _lock: lock,
        })
    }

    pub fn open(path: &Path) -> Result<Self, WorkspaceError> {
        if fs::symlink_metadata(path)?.file_type().is_symlink() {
            return Err(WorkspaceError::SymlinkRoot);
        }
        let root = path.canonicalize()?;
        let manifest_path = root.join("workspace.json");
        let manifest_metadata = fs::symlink_metadata(&manifest_path)?;
        if !manifest_metadata.is_file()
            || manifest_metadata.file_type().is_symlink()
            || manifest_metadata.len() > MAX_MANIFEST_BYTES
        {
            return Err(WorkspaceError::InvalidManifest);
        }
        let mut manifest: Manifest = serde_json::from_slice(&fs::read(&manifest_path)?)?;
        if manifest.format_version > WORKSPACE_VERSION || manifest.format_version == 0 {
            return Err(WorkspaceError::UnsupportedVersion(manifest.format_version));
        }
        let database_path = root.join("notes.sqlite");
        let database_metadata = fs::symlink_metadata(&database_path)?;
        if !database_metadata.is_file() || database_metadata.file_type().is_symlink() {
            return Err(WorkspaceError::UnsafePath);
        }
        let lock = acquire_lock(&root)?;
        let connection = Connection::open_with_flags(
            database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        configure_database(&connection)?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let database_id: String = connection.query_row(
            "SELECT value FROM workspace_meta WHERE key = 'workspace_id'",
            (),
            |row| row.get(0),
        )?;
        if database_id != manifest.workspace_id.to_string() {
            return Err(WorkspaceError::InvalidManifest);
        }
        if manifest.format_version == 1 && version == 1 {
            connection.execute_batch(
                "BEGIN IMMEDIATE;
                 ALTER TABLE nodes ADD COLUMN folder_icon TEXT NOT NULL DEFAULT 'default';
                 ALTER TABLE nodes ADD COLUMN folder_color TEXT NOT NULL DEFAULT '#89929e';
                 CREATE TABLE assets (
                   id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
                   original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
                   sha256 TEXT NOT NULL, size INTEGER NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE document_pages (
                   page_id TEXT PRIMARY KEY REFERENCES page_state(id) ON DELETE CASCADE,
                   asset_id TEXT NOT NULL REFERENCES assets(id)
                 );
                 PRAGMA user_version = 2;
                 COMMIT;",
            )?;
        } else if version != WORKSPACE_VERSION {
            return Err(WorkspaceError::UnsupportedVersion(version));
        }
        if manifest.format_version == 1 {
            manifest.format_version = WORKSPACE_VERSION;
            let temporary = root.join("workspace.json.tmp");
            fs::write(&temporary, serde_json::to_vec_pretty(&manifest)?)?;
            fs::rename(temporary, manifest_path)?;
        }
        fs::create_dir_all(root.join("assets"))?;
        fs::create_dir_all(root.join(".trash"))?;
        connection.execute_batch("CREATE TABLE IF NOT EXISTS extension_state (extension_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(extension_id, key)); CREATE TABLE IF NOT EXISTS extension_grants (extension_id TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(extension_id, permission));")?;
        Ok(Self {
            root,
            manifest,
            connection,
            _lock: lock,
        })
    }

    pub fn id(&self) -> Uuid {
        self.manifest.workspace_id
    }
    pub fn version(&self) -> u32 {
        self.manifest.format_version
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn export_archive(&self, destination: &Path) -> Result<(), WorkspaceError> {
        let parent = destination.parent().ok_or(WorkspaceError::UnsafePath)?.canonicalize()?;
        if parent.starts_with(&self.root) || destination.exists() {
            return Err(WorkspaceError::UnsafePath);
        }
        self.connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        let temporary = parent.join(format!(".omninote-export-{}.tmp", Uuid::new_v4()));
        let result = (|| -> Result<(), WorkspaceError> {
            let output = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
            let mut archive = zip::ZipWriter::new(output);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            let mut directories = vec![self.root.clone()];
            while let Some(directory) = directories.pop() {
                for entry in fs::read_dir(directory)? {
                    let entry = entry?;
                    let path = entry.path();
                    let relative = path.strip_prefix(&self.root).map_err(|_| WorkspaceError::UnsafePath)?;
                    if relative.components().count() == 1 && matches!(entry.file_name().to_str(), Some("cache" | ".trash" | ".workspace.lock")) {
                        continue;
                    }
                    let metadata = fs::symlink_metadata(&path)?;
                    if metadata.file_type().is_symlink() { return Err(WorkspaceError::UnsafePath); }
                    if metadata.is_dir() { directories.push(path); }
                    else if metadata.is_file() {
                        let name = relative.to_str().ok_or(WorkspaceError::UnsafePath)?.replace('\\', "/");
                        archive.start_file(name, options)?;
                        std::io::copy(&mut File::open(path)?, &mut archive)?;
                    }
                }
            }
            archive.finish()?.sync_all()?;
            fs::rename(&temporary, destination)?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(&temporary); }
        result
    }
    pub fn database_version(&self) -> Result<u32, WorkspaceError> {
        Ok(self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    pub fn create_notebook(&mut self, title: &str) -> Result<Node, WorkspaceError> {
        self.create_node(None, NodeKind::Notebook, title)
    }

    pub fn create_folder(&mut self, parent_id: Uuid, title: &str) -> Result<Node, WorkspaceError> {
        self.create_node(Some(parent_id), NodeKind::Folder, title)
    }

    pub fn create_page(&mut self, parent_id: Uuid, title: &str) -> Result<Node, WorkspaceError> {
        self.create_node(Some(parent_id), NodeKind::Page, title)
    }

    pub fn create_document_page(&mut self, parent_id: Uuid, asset_id: Uuid) -> Result<Node, WorkspaceError> {
        let title: String = self.connection.query_row(
            "SELECT original_name FROM assets WHERE id = ?1", [asset_id.to_string()], |row| row.get(0)
        ).optional()?.ok_or(WorkspaceError::InvalidParent)?;
        let title = validate_title(&title)?;
        let parent = self.node(parent_id)?;
        if parent.kind == NodeKind::Page { return Err(WorkspaceError::InvalidParent); }
        let parent_path = resolve_directory(&self.root, &parent.relative_path)?;
        let document_path = parent_path.join(&title);
        if fs::symlink_metadata(&document_path).is_ok() { return Err(WorkspaceError::NameConflict); }
        let source = self.asset_path(asset_id)?;
        let page = self.create_page(parent_id, &title)?;
        let pointer = self.node_path(page.id)?;
        let relative_path = format!("{}/{}", parent.relative_path, title);
        let result = (|| -> Result<(), WorkspaceError> {
            let mut original = File::open(source)?;
            let mut output = OpenOptions::new().write(true).create_new(true).open(&document_path)?;
            std::io::copy(&mut original, &mut output)?;
            output.sync_all()?;
            let transaction = self.connection.transaction()?;
            transaction.execute("UPDATE nodes SET relative_path = ?2 WHERE id = ?1", params![page.id.to_string(), relative_path])?;
            transaction.execute("INSERT INTO document_pages (page_id, asset_id) VALUES (?1, ?2)", params![page.id.to_string(), asset_id.to_string()])?;
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(document_path);
            let _ = self.delete_node(page.id);
            return Err(error);
        }
        fs::remove_file(pointer)?;
        Ok(Node { relative_path, ..page })
    }

    pub fn list_document_pages(&self) -> Result<Vec<(Uuid, Uuid)>, WorkspaceError> {
        let mut statement = self.connection.prepare("SELECT page_id, asset_id FROM document_pages")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        rows.map(|row| {
            let (page, asset) = row?;
            Ok((Uuid::parse_str(&page).map_err(|_| WorkspaceError::InvalidManifest)?,
                Uuid::parse_str(&asset).map_err(|_| WorkspaceError::InvalidManifest)?))
        }).collect()
    }

    pub fn list_children(&self, parent_id: Option<Uuid>) -> Result<Vec<Node>, WorkspaceError> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_id, kind, title, relative_path, sort_order, folder_icon, folder_color
             FROM nodes WHERE parent_id IS ?1 ORDER BY sort_order, id",
        )?;
        collect_node_rows(&mut statement, [parent_id.map(|id| id.to_string())])
    }

    pub fn list_all_nodes(&self) -> Result<Vec<Node>, WorkspaceError> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_id, kind, title, relative_path, sort_order, folder_icon, folder_color
             FROM nodes ORDER BY parent_id, sort_order, id",
        )?;
        collect_node_rows(&mut statement, [])
    }

    pub fn list_pages(&self) -> Result<Vec<PageState>, WorkspaceError> {
        let mut statement = self.connection.prepare(
            "SELECT id, camera_x, camera_y, camera_zoom, paper_style, objects_json FROM page_state",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get::<_, String>(5)?))
        })?;
        rows.map(|row| {
            let (id, camera_x, camera_y, camera_zoom, paper_style, objects_json) = row?;
            Ok(PageState {
                id: Uuid::parse_str(&id).map_err(|_| WorkspaceError::InvalidManifest)?,
                camera_x, camera_y, camera_zoom, paper_style,
                objects: serde_json::from_str(&objects_json)?,
            })
        }).collect()
    }

    pub fn save_page(&self, page_id: Uuid, objects: &[serde_json::Value], x: f64, y: f64, zoom: f64) -> Result<(), WorkspaceError> {
        validate_camera(x, y, zoom)?;
        if objects.len() > 100_000 || objects.iter().any(|object| object.get("page_id").and_then(|value| value.as_str()) != Some(page_id.to_string().as_str())) {
            return Err(WorkspaceError::InvalidManifest);
        }
        let json = serde_json::to_string(objects)?;
        if json.len() > 100_000_000 { return Err(WorkspaceError::InvalidManifest); }
        let changed = self.connection.execute(
            "UPDATE page_state SET objects_json = ?2, camera_x = ?3, camera_y = ?4, camera_zoom = ?5 WHERE id = ?1",
            params![page_id.to_string(), json, x, y, zoom],
        )?;
        if changed == 0 { return Err(WorkspaceError::InvalidParent); }
        Ok(())
    }

    pub fn save_camera(&self, page_id: Uuid, x: f64, y: f64, zoom: f64) -> Result<(), WorkspaceError> {
        validate_camera(x, y, zoom)?;
        let changed = self.connection.execute(
            "UPDATE page_state SET camera_x = ?2, camera_y = ?3, camera_zoom = ?4 WHERE id = ?1",
            params![page_id.to_string(), x, y, zoom],
        )?;
        if changed == 0 { return Err(WorkspaceError::InvalidParent); }
        Ok(())
    }

    pub fn set_page_style(&self, page_id: Uuid, style: &str) -> Result<(), WorkspaceError> {
        if !matches!(style, "blank" | "dots" | "grid" | "lines") { return Err(WorkspaceError::InvalidManifest); }
        let changed = self.connection.execute("UPDATE page_state SET paper_style = ?2 WHERE id = ?1", params![page_id.to_string(), style])?;
        if changed == 0 { return Err(WorkspaceError::InvalidParent); }
        Ok(())
    }

    pub fn node(&self, id: Uuid) -> Result<Node, WorkspaceError> {
        let parent: Option<Option<String>> = self.connection.query_row(
            "SELECT parent_id FROM nodes WHERE id = ?1", [id.to_string()], |row| row.get(0),
        ).optional()?;
        let parent_id = parent.ok_or(WorkspaceError::InvalidParent)?
            .map(|value| Uuid::parse_str(&value).map_err(|_| WorkspaceError::InvalidManifest))
            .transpose()?;
        self.list_children(parent_id)?.into_iter().find(|node| node.id == id)
            .ok_or(WorkspaceError::InvalidParent)
    }

    pub fn node_path(&self, id: Uuid) -> Result<PathBuf, WorkspaceError> {
        let node = self.node(id)?;
        resolve_node_path(&self.root, &node.relative_path)
    }

    pub fn list_assets(&self) -> Result<Vec<Asset>, WorkspaceError> {
        let mut statement = self.connection.prepare(
            "SELECT id, relative_path, original_name, mime_type, sha256, size, updated_at FROM assets ORDER BY rowid"
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get::<_, i64>(5)?, row.get(6)?))
        })?;
        rows.map(|row| {
            let (id, relative_path, original_name, mime_type, sha256, size, updated_at) = row?;
            Ok(Asset { id: Uuid::parse_str(&id).map_err(|_| WorkspaceError::InvalidManifest)?, relative_path, original_name, mime_type, sha256, size, updated_at })
        }).collect()
    }

    pub fn asset_path(&self, id: Uuid) -> Result<PathBuf, WorkspaceError> {
        let relative_path: String = self.connection.query_row(
            "SELECT relative_path FROM assets WHERE id = ?1", [id.to_string()], |row| row.get(0)
        ).optional()?.ok_or(WorkspaceError::InvalidParent)?;
        if !relative_path.starts_with("assets/") { return Err(WorkspaceError::UnsafePath); }
        resolve_node_path(&self.root, &relative_path)
    }

    pub fn read_asset(&self, id: Uuid) -> Result<Vec<u8>, WorkspaceError> {
        let path = self.asset_path(id)?;
        if fs::metadata(&path)?.len() > 512 * 1024 * 1024 { return Err(WorkspaceError::InvalidManifest); }
        Ok(fs::read(path)?)
    }

    pub fn import_asset(&self, name: &str, mime_type: &str, bytes: &[u8]) -> Result<Asset, WorkspaceError> {
        if bytes.len() > 512 * 1024 * 1024 { return Err(WorkspaceError::InvalidManifest); }
        self.import_reader(name, mime_type, bytes)
    }

    pub fn import_file(&self, path: &Path) -> Result<Asset, WorkspaceError> {
        let name = path.file_name().and_then(|value| value.to_str()).ok_or(WorkspaceError::InvalidName)?;
        let file = File::open(path)?;
        if file.metadata()?.len() > 1024 * 1024 * 1024 { return Err(WorkspaceError::InvalidManifest); }
        let mime = mime_for_name(name);
        self.import_reader(name, mime, file)
    }

    fn import_reader(&self, name: &str, mime_type: &str, mut reader: impl Read) -> Result<Asset, WorkspaceError> {
        let name = Path::new(name).file_name().and_then(|value| value.to_str()).ok_or(WorkspaceError::InvalidName)?;
        if name.is_empty() || name.chars().any(char::is_control) || name.len() > 255 || mime_type.len() > 128 {
            return Err(WorkspaceError::InvalidName);
        }
        let extension = Path::new(name).extension().and_then(|value| value.to_str())
            .filter(|value| !value.is_empty() && value.len() <= 12 && value.bytes().all(|byte| byte.is_ascii_alphanumeric()))
            .unwrap_or("bin").to_ascii_lowercase();
        let id = Uuid::new_v4();
        let relative_path = format!("assets/{id}.{extension}");
        let destination = self.root.join(&relative_path);
        resolve_directory(&self.root, "assets")?;
        let mut output = OpenOptions::new().write(true).create_new(true).open(&destination)?;
        let result = (|| -> Result<Asset, WorkspaceError> {
            let mut hasher = Sha256::new();
            let mut size = 0u64;
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let count = reader.read(&mut buffer)?;
                if count == 0 { break; }
                size += count as u64;
                if size > 1024 * 1024 * 1024 { return Err(WorkspaceError::InvalidManifest); }
                hasher.update(&buffer[..count]);
                output.write_all(&buffer[..count])?;
            }
            output.sync_all()?;
            let asset = Asset {
                id, relative_path, original_name: name.to_owned(), mime_type: mime_type.to_owned(),
                sha256: format!("{:x}", hasher.finalize()), size: size as i64,
                updated_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default().as_secs().to_string(),
            };
            self.connection.execute(
                "INSERT INTO assets (id, relative_path, original_name, mime_type, sha256, size, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![asset.id.to_string(), asset.relative_path, asset.original_name, asset.mime_type, asset.sha256, asset.size, asset.updated_at],
            )?;
            Ok(asset)
        })();
        drop(output);
        if result.is_err() { let _ = fs::remove_file(destination); }
        result
    }

    pub fn rename_node(&mut self, id: Uuid, title: &str) -> Result<(), WorkspaceError> {
        let parent = self.node(id)?.parent_id;
        self.relocate_node(id, parent, title, None, false)
    }

    pub fn move_node(&mut self, id: Uuid, parent_id: Option<Uuid>, before_id: Option<Uuid>) -> Result<(), WorkspaceError> {
        let title = self.node(id)?.title;
        self.relocate_node(id, parent_id, &title, before_id, true)
    }

    pub fn set_folder_appearance(&self, id: Uuid, icon: &str, color: &str) -> Result<(), WorkspaceError> {
        let node = self.node(id)?;
        if node.kind == NodeKind::Page || !matches!(icon, "default" | "docs" | "download")
            || color.len() != 7 || !color.starts_with('#') || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(WorkspaceError::InvalidParent);
        }
        self.connection.execute("UPDATE nodes SET folder_icon = ?2, folder_color = ?3 WHERE id = ?1",
            params![id.to_string(), icon, color.to_ascii_lowercase()])?;
        Ok(())
    }

    pub fn delete_node(&mut self, id: Uuid) -> Result<(), WorkspaceError> {
        let source = self.node_path(id)?;
        let staging = self.root.join(".trash").join(Uuid::new_v4().to_string());
        resolve_directory(&self.root, ".trash")?;
        fs::rename(&source, &staging)?;
        let result = (|| -> Result<(), WorkspaceError> {
            let transaction = self.connection.transaction()?;
            let descendants = {
                let mut statement = transaction.prepare(
                    "WITH RECURSIVE subtree(id, depth) AS (
                       SELECT id, 0 FROM nodes WHERE id = ?1
                       UNION ALL SELECT nodes.id, subtree.depth + 1 FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
                     ) SELECT id FROM subtree ORDER BY depth DESC"
                )?;
                let rows = statement.query_map([id.to_string()], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            for child in descendants {
                transaction.execute("DELETE FROM nodes WHERE id = ?1", [child])?;
            }
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::rename(&staging, &source);
            return Err(error);
        }
        if staging.is_dir() { fs::remove_dir_all(staging)?; } else { fs::remove_file(staging)?; }
        Ok(())
    }

    fn relocate_node(&mut self, id: Uuid, parent_id: Option<Uuid>, title: &str, before_id: Option<Uuid>, reorder: bool) -> Result<(), WorkspaceError> {
        let source = self.node(id)?;
        let title = validate_title(title)?;
        if source.kind == NodeKind::Notebook && parent_id.is_some() || source.kind != NodeKind::Notebook && parent_id.is_none() {
            return Err(WorkspaceError::InvalidParent);
        }
        let parent_path = if let Some(parent) = parent_id {
            let parent_node = self.node(parent)?;
            if parent_node.kind == NodeKind::Page { return Err(WorkspaceError::InvalidParent); }
            let mut cursor = Some(parent);
            while let Some(current) = cursor {
                if current == id { return Err(WorkspaceError::InvalidParent); }
                cursor = self.node(current)?.parent_id;
            }
            parent_node.relative_path
        } else { String::new() };
        if let Some(before) = before_id {
            if before == id { return Ok(()); }
            if self.node(before)?.parent_id != parent_id { return Err(WorkspaceError::InvalidParent); }
        }
        let is_document: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM document_pages WHERE page_id = ?1)", [id.to_string()], |row| row.get(0)
        )?;
        let filename = if source.kind == NodeKind::Page && !is_document { format!("{title}.page") } else { title.clone() };
        let relative_path = if parent_path.is_empty() { filename } else { format!("{parent_path}/{filename}") };
        let old_path = self.node_path(id)?;
        let new_parent_path = resolve_directory(&self.root, &parent_path)?;
        let new_path = new_parent_path.join(relative_path.rsplit('/').next().ok_or(WorkspaceError::UnsafePath)?);
        let title_key = title.as_str().case_fold().collect::<String>().nfc().collect::<String>();
        let conflict: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE parent_id IS ?1 AND title_key = ?2 AND id != ?3)",
            params![parent_id.map(|id| id.to_string()), title_key, id.to_string()], |row| row.get(0)
        )?;
        if conflict { return Err(WorkspaceError::NameConflict); }
        let moved_file = source.relative_path != relative_path;
        if moved_file {
            match fs::symlink_metadata(&new_path) {
                Ok(_) => return Err(WorkspaceError::NameConflict),
                Err(error) if error.kind() == ErrorKind::NotFound => {},
                Err(error) => return Err(error.into()),
            }
            fs::rename(&old_path, &new_path)?;
        }
        let result = (|| -> Result<(), WorkspaceError> {
            let transaction = self.connection.transaction()?;
            if moved_file {
                transaction.execute(
                    "UPDATE nodes SET relative_path = ?2 || substr(relative_path, length(?1) + 1)
                     WHERE substr(relative_path, 1, length(?1) + 1) = ?1 || '/'",
                    params![source.relative_path, relative_path],
                )?;
            }
            transaction.execute(
                "UPDATE nodes SET parent_id = ?2, title = ?3, title_key = ?4, relative_path = ?5 WHERE id = ?1",
                params![id.to_string(), parent_id.map(|id| id.to_string()), title, title_key, relative_path],
            )?;
            if reorder {
                for parent in [source.parent_id, parent_id].into_iter().collect::<std::collections::HashSet<_>>() {
                    let ids = {
                        let mut statement = transaction.prepare("SELECT id FROM nodes WHERE parent_id IS ?1 ORDER BY sort_order, id")?;
                        let rows = statement.query_map([parent.map(|id| id.to_string())], |row| row.get::<_, String>(0))?
                            .collect::<Result<Vec<_>, _>>()?;
                        rows
                    };
                    let mut ids: Vec<String> = ids.into_iter().filter(|candidate| candidate != &id.to_string()).collect();
                    if parent == parent_id {
                        let index = before_id.and_then(|before| ids.iter().position(|candidate| candidate == &before.to_string())).unwrap_or(ids.len());
                        ids.insert(index.min(ids.len()), id.to_string());
                    }
                    for (index, node_id) in ids.iter().enumerate() {
                        transaction.execute("UPDATE nodes SET sort_order = ?2 WHERE id = ?1", params![node_id, index as i64])?;
                    }
                }
            }
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            if moved_file { let _ = fs::rename(&new_path, &old_path); }
            return Err(error);
        }
        Ok(())
    }

    fn create_node(
        &mut self,
        parent_id: Option<Uuid>,
        kind: NodeKind,
        title: &str,
    ) -> Result<Node, WorkspaceError> {
        let title = validate_title(title)?;
        let title_key = title
            .as_str()
            .case_fold()
            .collect::<String>()
            .nfc()
            .collect::<String>();
        let parent = parent_id.map(|id| id.to_string());
        let parent_path = if kind == NodeKind::Notebook && parent_id.is_none() {
            String::new()
        } else {
            let Some(parent) = &parent else {
                return Err(WorkspaceError::InvalidParent);
            };
            let found: Option<(String, String)> = self
                .connection
                .query_row(
                    "SELECT kind, relative_path FROM nodes WHERE id = ?1",
                    [parent],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let Some((parent_kind, relative_path)) = found else {
                return Err(WorkspaceError::InvalidParent);
            };
            if parent_kind != "notebook" && parent_kind != "folder" {
                return Err(WorkspaceError::InvalidParent);
            }
            relative_path
        };
        if kind == NodeKind::Notebook && parent_id.is_some() {
            return Err(WorkspaceError::InvalidParent);
        }
        let parent_directory = resolve_directory(&self.root, &parent_path)?;
        let filename = if kind == NodeKind::Page {
            format!("{title}.page")
        } else {
            title.clone()
        };
        let relative_path = if parent_path.is_empty() {
            filename.clone()
        } else {
            format!("{parent_path}/{filename}")
        };
        let target = parent_directory.join(&filename);
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE parent_id IS ?1 AND title_key = ?2)",
            params![parent, title_key],
            |row| row.get(0),
        )?;
        let target_occupied = match fs::symlink_metadata(&target) {
            Ok(_) => true,
            Err(error) if error.kind() == ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        if exists || target_occupied {
            return Err(WorkspaceError::NameConflict);
        }
        let sort_order: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM nodes WHERE parent_id IS ?1",
            [parent.clone()],
            |row| row.get(0),
        )?;
        let id = Uuid::new_v4();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO nodes (id, parent_id, kind, title, title_key, relative_path, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id.to_string(),
                parent,
                kind.as_str(),
                title,
                title_key,
                relative_path,
                sort_order
            ],
        )?;
        if kind == NodeKind::Page {
            transaction.execute("INSERT INTO page_state (id) VALUES (?1)", [id.to_string()])?;
        }
        if kind == NodeKind::Page {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)?;
            file.write_all(format!("{{\"page_id\":\"{id}\"}}\n").as_bytes())?;
            file.sync_all()?;
        } else {
            fs::create_dir(&target)?;
        }
        if let Err(error) = transaction.commit() {
            if kind == NodeKind::Page {
                let _ = fs::remove_file(&target);
            } else {
                let _ = fs::remove_dir(&target);
            }
            return Err(error.into());
        }
        Ok(Node {
            id,
            parent_id,
            kind,
            title,
            relative_path,
            sort_order,
            folder_icon: "default".to_owned(),
            folder_color: "#89929e".to_owned(),
        })
    }
}

fn collect_node_rows<P: rusqlite::Params>(statement: &mut rusqlite::Statement<'_>, params: P) -> Result<Vec<Node>, WorkspaceError> {
    let rows = statement.query_map(params, |row| {
        Ok((
            row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?, row.get::<_, String>(3)?,
            row.get::<_, String>(4)?, row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?, row.get::<_, String>(7)?,
        ))
    })?;
    rows.map(|row| {
        let (id, parent, kind, title, relative_path, sort_order, folder_icon, folder_color) = row?;
        Ok(Node {
            id: Uuid::parse_str(&id).map_err(|_| WorkspaceError::InvalidManifest)?,
            parent_id: parent.map(|id| Uuid::parse_str(&id)).transpose().map_err(|_| WorkspaceError::InvalidManifest)?,
            kind: NodeKind::parse(&kind)?, title, relative_path, sort_order, folder_icon, folder_color,
        })
    }).collect()
}

fn validate_camera(x: f64, y: f64, zoom: f64) -> Result<(), WorkspaceError> {
    if !x.is_finite() || !y.is_finite() || !zoom.is_finite() || !(0.05..=64.0).contains(&zoom) {
        return Err(WorkspaceError::InvalidManifest);
    }
    Ok(())
}

fn mime_for_name(name: &str) -> &'static str {
    match Path::new(name).extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp",
        "svg" => "image/svg+xml", "mp3" => "audio/mpeg", "wav" => "audio/wav", "ogg" => "audio/ogg",
        "mp4" => "video/mp4", "webm" => "video/webm", "txt" => "text/plain", "md" => "text/markdown",
        "html" | "htm" => "text/html", "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

fn validate_title(input: &str) -> Result<String, WorkspaceError> {
    let title = input.nfc().collect::<String>();
    if title.is_empty()
        || title.trim() != title
        || title.ends_with('.')
        || title.chars().count() > 120
        || title
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err(WorkspaceError::InvalidName);
    }
    let stem = title
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
    {
        return Err(WorkspaceError::InvalidName);
    }
    Ok(title)
}

fn resolve_directory(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let path = Path::new(relative);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
        && !relative.is_empty()
    {
        return Err(WorkspaceError::UnsafePath);
    }
    let mut current = root.to_path_buf();
    for component in path.components() {
        current.push(component);
        if fs::symlink_metadata(&current)?.file_type().is_symlink() {
            return Err(WorkspaceError::UnsafePath);
        }
    }
    let resolved = current.canonicalize()?;
    if !resolved.starts_with(root) || !resolved.is_dir() {
        return Err(WorkspaceError::UnsafePath);
    }
    Ok(resolved)
}

fn resolve_node_path(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let relative = Path::new(relative);
    let parent = relative.parent().ok_or(WorkspaceError::UnsafePath)?;
    let directory = resolve_directory(root, parent.to_str().ok_or(WorkspaceError::UnsafePath)?)?;
    let name = relative.file_name().ok_or(WorkspaceError::UnsafePath)?;
    let target = directory.join(name);
    if fs::symlink_metadata(&target)?.file_type().is_symlink() { return Err(WorkspaceError::UnsafePath); }
    let canonical = target.canonicalize()?;
    if !canonical.starts_with(root) { return Err(WorkspaceError::UnsafePath); }
    Ok(canonical)
}

fn acquire_lock(root: &Path) -> Result<File, WorkspaceError> {
    let path = root.join(".workspace.lock");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(WorkspaceError::UnsafePath);
        }
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(path)?;
    file.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => WorkspaceError::Locked,
        TryLockError::Error(error) => WorkspaceError::Io(error),
    })?;
    Ok(file)
}

fn configure_database(connection: &Connection) -> Result<(), WorkspaceError> {
    connection.execute_batch(
        "PRAGMA journal_mode = DELETE;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(())
}
