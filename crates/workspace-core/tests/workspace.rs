use omninote_workspace_core::{NodeKind, Workspace, WorkspaceError, WORKSPACE_VERSION};
use std::fs;
use std::io::ErrorKind;
use tempfile::tempdir_in;

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
        .replace("\"format_version\": 1", "\"format_version\": 99");
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
