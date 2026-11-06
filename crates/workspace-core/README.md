# Workspace storage core

Portable Rust foundation for the fresh Tauri app. This crate is not wired into the Ink Lab yet.

`Workspace::create` makes a movable workspace folder with a versioned `workspace.json`, `notes.sqlite`, and settings/cache directories. Notebook and folder nodes are visible directories. A canvas page has a small `.page` pointer file with a stable page ID; SQLite remains the source of truth for its contents. Document import and page content storage are later milestones.

The crate uses one writer lock, relative paths, Unicode-normalized title collision keys, and rejects traversal and Windows-invalid names. The format version is 1. There are no users yet, so incompatible development versions can be recreated rather than migrated.

Run the focused tests with `cargo test --manifest-path crates/workspace-core/Cargo.toml` from the repository root. Keep the app closed before moving or copying a workspace.
