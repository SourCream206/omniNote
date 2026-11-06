//! Portable workspace storage shared by desktop and future mobile clients.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const WORKSPACE_VERSION: u32 = 1;
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
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
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
               sort_order INTEGER NOT NULL
             );
             CREATE UNIQUE INDEX nodes_sibling_title ON nodes(COALESCE(parent_id, ''), title_key);
             CREATE INDEX nodes_parent_order ON nodes(parent_id, sort_order);
             PRAGMA user_version = 1;",
        )?;
        connection.execute(
            "INSERT INTO workspace_meta (key, value) VALUES ('workspace_id', ?1)",
            [manifest.workspace_id.to_string()],
        )?;
        fs::create_dir(root.join("extensions"))?;
        fs::create_dir(root.join("cache"))?;
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
        let manifest: Manifest = serde_json::from_slice(&fs::read(manifest_path)?)?;
        if manifest.format_version != WORKSPACE_VERSION {
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
        if version != WORKSPACE_VERSION {
            return Err(WorkspaceError::UnsupportedVersion(version));
        }
        let database_id: String = connection.query_row(
            "SELECT value FROM workspace_meta WHERE key = 'workspace_id'",
            (),
            |row| row.get(0),
        )?;
        if database_id != manifest.workspace_id.to_string() {
            return Err(WorkspaceError::InvalidManifest);
        }
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

    pub fn list_children(&self, parent_id: Option<Uuid>) -> Result<Vec<Node>, WorkspaceError> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_id, kind, title, relative_path, sort_order
             FROM nodes WHERE parent_id IS ?1 ORDER BY sort_order, id",
        )?;
        let rows = statement.query_map([parent_id.map(|id| id.to_string())], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        rows.map(|row| {
            let (id, parent, kind, title, relative_path, sort_order) = row?;
            Ok(Node {
                id: Uuid::parse_str(&id).map_err(|_| WorkspaceError::InvalidManifest)?,
                parent_id: parent
                    .map(|id| Uuid::parse_str(&id))
                    .transpose()
                    .map_err(|_| WorkspaceError::InvalidManifest)?,
                kind: NodeKind::parse(&kind)?,
                title,
                relative_path,
                sort_order,
            })
        })
        .collect()
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
        })
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
