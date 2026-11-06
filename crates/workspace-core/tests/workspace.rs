use omninote_workspace_core::{NodeKind, Workspace, WorkspaceError, WORKSPACE_VERSION};
use std::fs;
use std::io::ErrorKind;
use tempfile::tempdir_in;

#[test]
fn page_state_round_trips_ink_and_camera() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let mut workspace = Workspace::create(&temp.path().join("Workspace")).unwrap();
    let notebook = workspace.create_notebook("Class").unwrap();
    let page = workspace.create_page(notebook.id, "Lecture").unwrap();
    let stroke = serde_json::json!({"id":"stroke-1","page_id":page.id.to_string(),"type":"ink","payload":{"points":[{"x":1,"y":2}]}});
    workspace.save_page(page.id, &[stroke.clone()], 12.0, -9.0, 1.5).unwrap();
    workspace.set_page_style(page.id, "grid").unwrap();
    assert!(workspace.save_page(page.id, &[serde_json::json!({"page_id":"another-page"})], 0.0, 0.0, 1.0).is_err());
    drop(workspace);
    let reopened = Workspace::open(&temp.path().join("Workspace")).unwrap();
    let pages = reopened.list_pages().unwrap();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].objects, vec![stroke]);
    assert_eq!(pages[0].camera_x, 12.0);
    assert_eq!(pages[0].paper_style, "grid");
}

#[test]
fn creates_and_reopens_a_moved_workspace() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let original = temp.path().join("Lecture notes");
    let workspace = Workspace::create(&original).unwrap();
    let id = workspace.id();
    assert_eq!(workspace.version(), WORKSPACE_VERSION);
    assert_eq!(workspace.database_version().unwrap(), WORKSPACE_VERSION);
    assert!(original.join("workspace.json").is_file());
    assert!(original.join("notes.sqlite").is_file());
    drop(workspace);

    let moved = temp.path().join("Moved notes");
    fs::rename(&original, &moved).unwrap();
    let reopened = Workspace::open(&moved).unwrap();
    assert_eq!(reopened.id(), id);
    assert_eq!(reopened.version(), WORKSPACE_VERSION);
}

#[test]
fn notebooks_folders_and_pages_have_visible_paths_and_stable_ids() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Research").unwrap();
    let folder = workspace.create_folder(notebook.id, "Week 1").unwrap();
    let page = workspace.create_page(folder.id, "Lecture notes").unwrap();
    assert_eq!(notebook.kind, NodeKind::Notebook);
    assert_eq!(folder.relative_path, "Research/Week 1");
    assert_eq!(page.relative_path, "Research/Week 1/Lecture notes.page");
    assert!(root.join("Research/Week 1/Lecture notes.page").is_file());
    assert!(
        fs::read_to_string(root.join("Research/Week 1/Lecture notes.page"))
            .unwrap()
            .contains(&page.id.to_string())
    );
    drop(workspace);

    let reopened = Workspace::open(&root).unwrap();
    let children = reopened.list_children(Some(folder.id)).unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].id, page.id);
}

#[test]
fn hierarchy_rejects_collisions_bad_names_and_page_parents() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Research").unwrap();
    assert!(matches!(
        workspace.create_notebook("research"),
        Err(WorkspaceError::NameConflict)
    ));
    assert!(matches!(
        workspace.create_folder(notebook.id, "../escape"),
        Err(WorkspaceError::InvalidName)
    ));
    assert!(matches!(
        workspace.create_folder(notebook.id, "CON"),
        Err(WorkspaceError::InvalidName)
    ));
    let page = workspace.create_page(notebook.id, "First").unwrap();
    assert!(matches!(
        workspace.create_folder(page.id, "Not allowed"),
        Err(WorkspaceError::InvalidParent)
    ));
    assert!(!root.join("escape").exists());
}

#[test]
fn names_are_normalized_for_portable_case_insensitive_folders() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let mut workspace = Workspace::create(&temp.path().join("Workspace")).unwrap();
    let notebook = workspace.create_notebook("Research").unwrap();
    workspace.create_folder(notebook.id, "Straße").unwrap();
    assert!(matches!(
        workspace.create_folder(notebook.id, "STRASSE"),
        Err(WorkspaceError::NameConflict)
    ));
    workspace.create_folder(notebook.id, "Résumé").unwrap();
    assert!(matches!(
        workspace.create_folder(notebook.id, "Re\u{301}sume\u{301}"),
        Err(WorkspaceError::NameConflict)
    ));
}

#[test]
fn refuses_a_folder_symlink_that_leads_outside_the_workspace() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let outside = temp.path().join("Outside");
    fs::create_dir(&outside).unwrap();
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Research").unwrap();
    fs::remove_dir(root.join("Research")).unwrap();
    #[cfg(windows)]
    let link_result = std::os::windows::fs::symlink_dir(&outside, root.join("Research"));
    #[cfg(unix)]
    let link_result = std::os::unix::fs::symlink(&outside, root.join("Research"));
    if let Err(error) = link_result {
        if error.kind() == ErrorKind::PermissionDenied
            || (cfg!(windows) && error.raw_os_error() == Some(1314))
        {
            return; // Windows without Developer Mode cannot create a test symlink.
        }
        panic!("cannot create test symlink: {error}");
    }
    assert!(matches!(
        workspace.create_folder(notebook.id, "Escape"),
        Err(WorkspaceError::UnsafePath)
    ));
    assert!(!outside.join("Escape").exists());
}

#[test]
fn refuses_a_second_writer() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let first = Workspace::create(&root).unwrap();
    assert!(matches!(
        Workspace::open(&root),
        Err(WorkspaceError::Locked)
    ));
    drop(first);
    assert!(Workspace::open(&root).is_ok());
}

#[test]
fn refuses_newer_workspace_versions_and_existing_content() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let workspace = Workspace::create(&root).unwrap();
    drop(workspace);
    let manifest = root.join("workspace.json");
    let json = fs::read_to_string(&manifest)
        .unwrap()
        .replace(&format!("\"format_version\": {}", WORKSPACE_VERSION), "\"format_version\": 99");
    fs::write(&manifest, json).unwrap();
    assert!(matches!(
        Workspace::open(&root),
        Err(WorkspaceError::UnsupportedVersion(99))
    ));

    let occupied = temp.path().join("Occupied");
    fs::create_dir(&occupied).unwrap();
    fs::write(occupied.join("existing.txt"), "keep me").unwrap();
    assert!(matches!(
        Workspace::create(&occupied),
        Err(WorkspaceError::NotEmpty)
    ));
    assert_eq!(
        fs::read_to_string(occupied.join("existing.txt")).unwrap(),
        "keep me"
    );
}

#[test]
fn hierarchy_edits_keep_paths_and_order_consistent() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Class").unwrap();
    let first = workspace.create_folder(notebook.id, "Week 1").unwrap();
    let second = workspace.create_folder(notebook.id, "Week 2").unwrap();
    let page = workspace.create_page(first.id, "Lecture").unwrap();

    workspace.rename_node(first.id, "Introduction").unwrap();
    assert!(root.join("Class/Introduction/Lecture.page").exists());
    workspace.move_node(page.id, Some(second.id), None).unwrap();
    assert!(root.join("Class/Week 2/Lecture.page").exists());
    assert!(!root.join("Class/Introduction/Lecture.page").exists());
    assert!(workspace.move_node(second.id, Some(second.id), None).is_err());
    workspace.move_node(second.id, Some(notebook.id), Some(first.id)).unwrap();
    let children = workspace.list_children(Some(notebook.id)).unwrap();
    assert_eq!(children.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(), vec!["Week 2", "Introduction"]);
    workspace.set_folder_appearance(second.id, "docs", "#1188aa").unwrap();
    assert_eq!(workspace.list_children(Some(notebook.id)).unwrap()[0].folder_icon, "docs");
    workspace.delete_node(second.id).unwrap();
    assert!(!root.join("Class/Week 2").exists());
    assert!(workspace.list_pages().unwrap().is_empty());
}

#[test]
fn imported_assets_survive_reopen_and_keep_their_original_bytes() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let workspace = Workspace::create(&root).unwrap();
    let original = b"%PDF-1.7\nexample\n";
    let asset = workspace.import_asset("Lecture.pdf", "application/pdf", original).unwrap();
    assert_eq!(workspace.read_asset(asset.id).unwrap(), original);
    assert!(root.join(&asset.relative_path).exists());
    drop(workspace);
    let reopened = Workspace::open(&root).unwrap();
    assert_eq!(reopened.list_assets().unwrap()[0].id, asset.id);
    assert_eq!(reopened.read_asset(asset.id).unwrap(), original);
    assert!(reopened.asset_path(uuid::Uuid::new_v4()).is_err());
}

#[test]
fn document_pages_are_real_files_in_the_notebook_tree() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Class").unwrap();
    let asset = workspace.import_asset("Slides.pdf", "application/pdf", b"%PDF example").unwrap();
    let page = workspace.create_document_page(notebook.id, asset.id).unwrap();
    assert_eq!(fs::read(root.join("Class/Slides.pdf")).unwrap(), b"%PDF example");
    assert_eq!(workspace.list_document_pages().unwrap(), vec![(page.id, asset.id)]);
    workspace.rename_node(page.id, "Renamed.pdf").unwrap();
    assert!(root.join("Class/Renamed.pdf").exists());
    drop(workspace);
    let reopened = Workspace::open(&root).unwrap();
    assert_eq!(reopened.list_document_pages().unwrap(), vec![(page.id, asset.id)]);
}

#[test]
fn opens_an_existing_preview_workspace_without_losing_notes() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Class").unwrap();
    let page = workspace.create_page(notebook.id, "Lecture").unwrap();
    let object = serde_json::json!({"id":"text-1","page_id":page.id.to_string(),"type":"text"});
    workspace.save_page(page.id, &[object.clone()], 2.0, 3.0, 1.0).unwrap();
    drop(workspace);

    let database = rusqlite::Connection::open(root.join("notes.sqlite")).unwrap();
    database.execute_batch("ALTER TABLE nodes DROP COLUMN folder_icon; ALTER TABLE nodes DROP COLUMN folder_color; DROP TABLE document_pages; DROP TABLE assets; PRAGMA user_version=1;").unwrap();
    drop(database);
    let manifest = root.join("workspace.json");
    fs::write(&manifest, fs::read_to_string(&manifest).unwrap().replace("\"format_version\": 2", "\"format_version\": 1")).unwrap();

    let upgraded = Workspace::open(&root).unwrap();
    assert_eq!(upgraded.version(), WORKSPACE_VERSION);
    assert_eq!(upgraded.database_version().unwrap(), WORKSPACE_VERSION);
    assert_eq!(upgraded.list_pages().unwrap()[0].objects, vec![object]);
    assert_eq!(upgraded.list_children(Some(notebook.id)).unwrap()[0].folder_icon, "default");
}

#[test]
fn backup_contains_database_and_originals_but_not_temporary_files() {
    let temp = tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let root = temp.path().join("Workspace");
    let mut workspace = Workspace::create(&root).unwrap();
    let notebook = workspace.create_notebook("Class").unwrap();
    let page = workspace.create_page(notebook.id, "Lecture").unwrap();
    workspace.save_page(page.id, &[serde_json::json!({"id":"text-1","page_id":page.id.to_string()})], 0.0, 0.0, 1.0).unwrap();
    let asset = workspace.import_asset("Slides.pdf", "application/pdf", b"original PDF").unwrap();
    let destination = temp.path().join("backup.zip");
    workspace.export_archive(&destination).unwrap();

    let mut archive = zip::ZipArchive::new(fs::File::open(destination).unwrap()).unwrap();
    assert!(archive.by_name("workspace.json").is_ok());
    assert!(archive.by_name("notes.sqlite").is_ok());
    assert!(archive.by_name("Class/Lecture.page").is_ok());
    assert!(archive.by_name(".workspace.lock").is_err());
    let mut original = String::new();
    use std::io::Read;
    archive.by_name(&asset.relative_path).unwrap().read_to_string(&mut original).unwrap();
    assert_eq!(original, "original PDF");
}
