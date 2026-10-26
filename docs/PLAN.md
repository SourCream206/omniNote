# Phase 1 architecture decisions

Status: approved plan; M0 input spike implemented and awaiting stylus-hardware feedback. Build and report one runnable milestone at a time.

## Stack

Electron + React + TypeScript; SQLite for hierarchy, objects, and settings; original documents in a workspace `assets/` directory. The renderer is sandboxed and receives only narrow, validated IPC calls. Document viewers and extensions run in separate sandboxed frames or workers.

The final canvas uses a positioned DOM layer for rich text and document frames, a dedicated vector-ink layer, a spatial index for viewport culling, and an animation-frame camera transform. Re-lay out editable text at the effective zoom level rather than indefinitely scaling a low-resolution raster; inspect high-zoom text clarity during M2. A 60 fps target is measured on pages with hundreds of mixed objects rather than assumed.

## Data and migration

`nodes(id, parent_id, kind, title, order_key, created_at, updated_at)` represent notebooks, nested folders, sections, and pages. `pages(id, camera_x, camera_y, camera_zoom)` stores page view state. `objects(id, page_id, type, x, y, width, height, rotation, z_index, group_id, payload_version, payload_json)` stores positioned content. `assets(id, relative_path, original_name, mime_type, sha256, size, updated_at)` references byte-for-byte original files. `extension_settings`, `extension_grants`, and `schema_migrations` have their own tables.

Reserve an `object_text` indexing projection for SQLite FTS5, including extracted PDF/DOCX text in a later search milestone. It remains derived data, so it can be rebuilt without touching originals. Preserve source page/object IDs in search rows for navigation.

Use SQLite transactions, WAL, forward-only migrations (current schema version 2), and consistent backups. Import an asset to a temporary path, calculate its hash, atomically rename it into `assets/`, then commit its metadata. Keep previews as disposable caches; never replace an original with a rendered derivative.

Add notebook export as a ZIP containing SQLite data, original assets, and a format manifest. Add page-to-PDF export as a separate read-only render path. Export and restore need a round-trip test once persistence and documents exist; these are planned alongside backups, not silently substituted for backup.

## Canvas and document input ownership

Each embedded document has a selection shell and an interaction state. In selection state, a transparent canvas-owned shield covers the frame so selection, moving, resizing, lasso, and ink strokes over it reach the page. In interaction state, the shield is removed so the document can scroll, select text, and receive clicks. Exiting interaction returns capture to the canvas. M4 tests drawing across frame edges as well as clickable links.

External links go through the system browser after URL validation. Internal PDF destinations, DOCX bookmarks, and spreadsheet sheet/cell links are handled by their viewers when supported. Every document retains an **Open original** action.

## Extension API v1 sketch

The manifest declares `id`, `name`, `version`, `apiVersion`, `activationEvents`, `permissions`, and contributions for commands, toolbar/sidebar items, canvas object types, document viewers, import/export handlers, and settings. Extensions load from a local folder and can be enabled or disabled. Commands and transforms run in workers; visual contributions run in sandboxed iframes; all calls pass through a permission-checking capability broker. The example extension inserts today's date.

## Milestones and gates

| Milestone | Runnable result | Gate |
| --- | --- | --- |
| M0 | Electron input lab with pen, pressure, tilt, palm filter, eraser, event modes, and timing telemetry | Test on target stylus hardware; decide renderer/input strategy. |
| M1 | App shell, nested notebook tree with pages under sections, SQLite persistence and migration | Reopen and verify hierarchy, order, and timestamps. |
| M2 | Infinite canvas, rich text, object selection/grouping/z-order, clipboard, undo/redo | Pan/zoom and text at high zoom; benchmark hundreds of objects. |
| M3 | Vector ink, pen/highlighter, stroke and partial eraser, lasso | Pressure, palm, pen-button and reopen tests. |
| M4 | Embedded PDF and DOCX with verified links; honest previews for other formats; originals | PDF and DOCX external/internal-link fixtures, original-byte verification, frame-edge ink. |
| M5 | Versioned extension host and example date command | Load from disk, enable/disable, permission test. |

Search indexing and user-facing search can follow in phase 2. ZIP notebook export and page PDF export can be added after the underlying objects and viewers exist; they are explicit tasks rather than part of M0.
