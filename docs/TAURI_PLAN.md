# Proposed phase 1 plan: Tauri v2

**Status: Tauri desktop integration built; release verification in progress.** This is a fresh Tauri app with no Electron user-data migration requirement. Reuse React, TypeScript, tests, document fixtures, and proven interaction patterns from the Electron app. Windows and the owner's touchscreen HP Envy pen are first. Keep macOS/Linux possible and the data format usable by later Android/iOS apps; do not promise identical desktop/mobile file pickers.

## Scope and architecture

Keep nested notebook/folder/section/page organization, infinite canvas, vector ink, embedded documents with live links where the viewer supports them, byte-for-byte originals, and a first-class extension API. No accounts or built-in sync in phase 1. Use React + TypeScript in the webview and Tauri v2 + Rust for typed commands, SQLite, workspace locks, file operations, backups, and the extension permission broker. Do not expose arbitrary filesystem or shell calls to the frontend.

Start at a welcome screen with **Open Folder**, **New Workspace**, and recent workspaces. Reopen the last workspace if available. If moved, missing, locked, or read-only, offer relocation, read-only viewing when safe, or another folder. Suggest the OS Documents directory via Tauri path APIs for new workspaces, but never force it. App-local settings contain only recent paths and window state; workspace settings live with the workspace.

One build-time product metadata file supplies display name, bundle ID, default workspace extension, and URL protocol to all build configs. A rename should edit that file once, but changing an already shipped bundle ID or protocol still needs an installer/updater transition. Keep `omniNote` as a temporary identity in the current Electron product only; do not hardcode it in the fresh app's business logic.

## Portable workspace

```text
Chosen folder/
  workspace.json       # format version and workspace UUID
  notes.sqlite         # hierarchy, pages, objects, asset refs, grants, migrations
  settings.json        # workspace preferences
  Notebook name/       # human-readable notebook root
    Folder name/
      Lecture.page      # small page pointer; suffix from product config
      Slides.pdf        # unchanged imported original
  extensions/           # installed packages and manifests
  cache/                # disposable previews and search index
  backups/              # optional snapshots
```

SQLite uses stable UUIDs, relative paths, parent/order data, page camera/style, versioned objects, asset hashes, and forward-only schema migrations. Preserve original bytes on import with temporary copy, hash, atomic rename, then metadata commit. Original documents live in the visible notebook tree; previews never replace them. A page pointer gives File Explorer a useful target while SQLite is the source of truth. Keep vector ink as world-coordinate points plus pressure, tilt, timestamps, pointer metadata, and brush style; renderers and image caches are replaceable. FTS5 and extracted document text are rebuildable projections. ZIP backup/restore includes a format manifest and originals.

Persist only `/`-separated relative paths. Rust resolves them beneath the workspace root, rejects traversal and symlink escapes, and validates all moves. Use UUIDs for identity and preserve human display names; normalize Unicode and compare case-folded collision keys so a workspace from a case-sensitive disk can open on Windows. Assign collision-safe disk names without changing document contents. Hold an OS advisory lock per workspace for the process lifetime, plus Tauri single-instance routing for duplicate launches. Handle external-drive removal by suspending writes and retaining dirty state.

Choose SQLite rollback journal (`DELETE`) with durable commits and one writer, avoiding persistent WAL sidecars. This makes closed-workspace copies simpler, but **does not make live cloud-folder sync safe**. Detect common OneDrive/Dropbox/iCloud/Syncthing roots where possible and warn; require the app to be closed before folder copies/sync. Simultaneous editing on two devices needs a future sync protocol. Stable IDs and versioned records keep that possible. [SQLite explains why WAL is unsuitable for network filesystems](https://www.sqlite.org/wal.html).

## Canvas and webview compatibility

Use world coordinates, DOM text and document viewers, a separate ink overlay, viewport culling, tiled stroke caches, and lazy document pages. Re-layout text at high zoom rather than scaling a low-resolution layer. A selection/ink shield owns pointer input above document frames; interaction mode removes the shield for scrolling, text selection, bookmarks, and hyperlinks. Test strokes across frame edges. PDF.js and format-specific viewers have fidelity limits; unsupported documents show a file tile and every import has **Open Original**.

| Area | Risk across WebView2 / WKWebView / WebKitGTK | Mitigation |
| --- | --- | --- |
| Pointer Events, pressure, tilt | **High:** device and runtime differences affect sampling | Probe fields; test actual pen; store neutral values when missing. |
| Pen buttons, eraser, palm | **High:** driver/OS mappings vary | Record `button`/`buttons`; allow remapping and explicit eraser; arbitrate pen/touch. |
| Coalesced/predicted events | **Medium:** availability/cadence vary | Use ordinary pointer events as baseline; prediction affects preview only, never saved points. |
| PDF.js, fonts, workers | **Medium/high:** WebKit and large documents may differ | Bundle tested build; lazy pages and bounded cache; link fixtures per OS; native-original fallback. |
| OffscreenCanvas | **Medium:** worker transfer/context differs | Feature-detect and retain main-thread Canvas 2D fallback. |
| WebGL/WebGPU | **Medium/high:** GPU/driver/context loss; WebGPU is not universal | Recover context loss; never require WebGPU for phase 1. |
| External file drop | **Medium:** Tauri's native Windows drop handler conflicts with HTML5 drop | Use Tauri native drop events for files and internal app drag logic for tabs/tree; map physical to logical coordinates. |

Tauri uses system WebView2 on Windows and WebKit variants on macOS/Linux, so platform parity is a test gate, not an assumption. [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/) and [drag/drop configuration](https://v2.tauri.app/reference/config/) document these differences. Tauri's [dialog plugin](https://v2.tauri.app/plugin/dialog/) does not support mobile folder picking; mobile uses its own URI/document-access flow against the same schema.

### Ink renderer comparison

| Option | Latency / large canvases | Cross-webview risk | Effort, debugging, DOM integration |
| --- | --- | --- | --- |
| **A. Canvas 2D + Pointer Events**, perfect-freehand, coalesced samples, optional prediction/desynchronized hint/Offscreen worker | Shortest input path; needs culling and cache for large pages | Low baseline, medium optional APIs | Low/medium; easy browser profiling; overlay works with HTML objects. |
| **B. WebGL** with the same vector records | Can batch completed strokes; input still enters JS | Medium, including driver/context loss | Medium/high; harder GPU debugging; remains separate from text/frames. |
| **C. Rust + wgpu → WASM + OffscreenCanvas** | Can process large scenes but does not inherently improve pen latency | High; WASM still depends on webview GPU/Offscreen APIs | Highest build, shader, GPU debugging, and compositing cost. |
| **D. Hybrid 2D (recommendation)**: main-thread live stroke plus culled/tiled completed ink; worker rasterization where supported | Immediate preview with bounded redraw | Low baseline, medium worker path | Medium; keeps HTML and PDF viewers separate. |

D is an optimized implementation of A. Put rendering behind `InkRenderer` (`beginStroke`, `appendSamples`, `endStroke`, `setViewport`, `renderVisible`, `hitTest`, `dispose`). Store points and undo/erase logic outside it. Re-rasterize tiles at the active zoom and device-pixel ratio so ink stays sharp. `getCoalescedEvents`, predicted events, and OffscreenCanvas are feature probes, not requirements. [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent), [OffscreenCanvas transfer](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen), and [WebGPU availability](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) inform this risk. **Rust/wgpu WASM is overkill for phase 1 unless simpler renderers fail a measured gate.** Rust still has a clear role in native storage and security.

## Extensions and marketplace

Keep manifest ID/version/API version, activation events, declared permissions, and contributions for commands, toolbar/sidebar, canvas objects, document viewers, import/export, and settings. Command/transform logic runs in dedicated Web Workers; visual/viewer contributions run in sandboxed separate-origin iframes. Optional WASM runs inside those containers with resource/time limits. No extension gets `@tauri-apps/api`, a raw workspace path, shell access, or direct Rust commands. A typed broker checks extension identity, user grant, workspace, resource IDs, sizes, and rate limits; unresponsive extensions can be terminated. CSP blocks unapproved remote scripts.

Tauri capabilities are **static grants to a trusted webview**, not dynamic per-extension permissions. Grant the main webview only narrow app/dialog/drop commands; the Rust broker enforces runtime extension grants stored in the workspace. A worker/iframe has no direct Tauri IPC capability. Native Rust plugins and arbitrary sidecars are outside the phase-1 extension API. [Tauri capability model](https://v2.tauri.app/reference/acl/capability/) and [security model](https://v2.tauri.app/security/) support this boundary.

Add a dedicated `/extensions/` page to the existing GitHub Pages download site. It displays searchable catalog entries, versions, permissions, changelogs, and install instructions. The in-app sidebar searches the same owner-maintained catalog, downloads and verifies a package signature/digest, installs locally disabled, then requests permission on enable. Anyone may submit an extension; the owner reviews publication. Signing keys stay off Pages and out of CI logs. Installed extensions work offline. Review reduces risk but does not certify safety.

## Milestones and decision gate

**M0 — throwaway Tauri ink spike:** On the actual HP Envy pen, compare D/A main-thread 2D and optional Offscreen worker. If that fails after culling/tiling, prototype B. Test blank canvas, 2,000 mixed objects with dense ink, and a nearby 300-page lazily rendered PDF. Log WebView2/driver, pointer samples, pressure/tilt/buttons, frame times, memory, and screen video. At 60 Hz, pass with p95 contact-to-visible ink **≤50 ms**, p95 active-ink frame time **≤16.7 ms**, no lost stroke samples, and no crash in a 20-minute stress run. Use high-frame-rate video for input-to-photon; JS timing alone is a proxy. Adapt frame budget to actual refresh rate. Only prototype/adopt C if A/D and B fail after profiling and C passes the same test. Thresholds are proposed gates, not existing results.

| Milestone | Runnable result | Acceptance gate |
| --- | --- | --- |
| **M1 Workspace** | Welcome, recent/last, picker, versioned layout, lock, tree | Move a closed workspace; reopen; test missing/read-only/locked paths. |
| **M2 Canvas** | Infinite scene, text, transforms, clipboard, undo/redo, culling, renderer interface | 2,000-object stress, high-zoom text, restart without loss. |
| **M3 Ink** | Vector pen/highlighter/eraser/lasso | HP Envy pressure, tilt, buttons, palm, frame edges; retain M0 latency. |
| **M4 Documents** | Original import, PDF/DOCX preview and links, printouts, backup/export | Link fixtures, original hash equality, 300-page lazy PDF, backup/restore round trip. |
| **M5 Extensions** | Broker, worker/iframe host, example, searchable in-app and Pages catalog | Denied grant/malformed package tests, offline use, catalog publication test. |
| **M6 Release** | Windows installer/updater; macOS/Linux smoke builds when available | Fresh install, update, workspace reopen, platform-specific ink/viewer checklist. |

Each milestone is built only after the previous gate passes and is handed off with run instructions, a test checklist, results, and known limits.

## Remaining risks and naming

- The HP Envy pen may map buttons/palm input differently from Electron. M0 decides based on measurements.
- Two thousand objects plus textbooks require virtualization and cache eviction; memory and PDF fidelity are separate gates.
- Live cloud-folder sync can race even with rollback journaling. Phase 1 supports closed-workspace movement and backups.
- Extensions can abuse granted access or exhaust resources; broker limits and owner review reduce but do not remove risk.
- **Folio** is used by multiple note/PDF apps and an [npm package](https://www.npmjs.com/package/folio); **Ream** is used by [a research/writing app](https://useream.com/) and other products. Neither is a clear brand choice. Do a domain, package, and trademark check before release.
