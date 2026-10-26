# omniNote

A local-first desktop notebook with nested folders and sections, an infinite canvas, vector ink, embedded original documents, and a local extension host. Phase 1 uses Electron, React, TypeScript, and SQLite. No account or sync service is involved.

## Run

Install Node.js 22.12 or later and npm. On Windows, run:

```powershell
npm ci
npm start
```

`npm start` builds the renderer and opens the desktop app. The workspace is stored in Electron's `userData/workspace` directory. Set `WHITEBOARD_WORKSPACE` to an absolute directory to use an isolated test workspace. Run `npm run ink-lab` to open the original stylus input experiment, `npm run typecheck` for the TypeScript projects, or `npm test` for storage, backup, and document-link fixture checks.

## Use

- Create notebooks, nested folders, sections, and pages in the left sidebars. Drag items to reorder or move them. Double-click a title to rename it.
- Choose **Text**, then click the canvas to place a rich text note. **Select** picks or deselects existing objects without creating a note. Drag object headers to move; drag the lower-right handle to resize.
- Use Pen or Highlight for pressure-aware vector strokes. Erase whole strokes or check **Partial** to split them. Lasso selects objects. Wheel zooms at the pointer; Space plus drag pans. Pen drawing ignores touch shortly after pen input.
- Insert files with the page button or drag files onto the canvas. PDF, DOCX, XLSX, PPTX, text, Markdown, and HTML have in-canvas previews. Click **Interact** on a document to use its links and scroll, and **Open original** to launch the unchanged source file in its default app.
- Use Ctrl+C/V for canvas objects, Ctrl+Z/Y for canvas undo/redo, Shift-click for multiple selection, and the toolbar for grouping and order. Rich text has its own editor undo while focused.
- **Backup ZIP** exports the SQLite database and original assets. **PDF** exports the current app page view. Test restores by extracting the ZIP into an empty workspace directory with the app closed.

## Extensions

Local extensions live in the workspace's `extensions/` directory. The bundled `whiteboard.date-insert` example is copied there on first launch. Its toolbar button runs in a worker and inserts today's date through the restricted `canvas.write` bridge. The Extensions panel enables or disables installed extensions. The manifest format reserves commands, toolbar/sidebar contributions, canvas object types, document viewers, import/export handlers, and settings; phase 1 executes commands and toolbar contributions. Other declared contribution points still need host implementations before extension authors can rely on them.

## Current limits and testing

This is a source-run test version, not an installer. PDF previews display the first 50 pages; XLSX previews show up to 200 rows and 30 cells per sheet; PPTX shows text and links rather than the full slide design. Link support depends on each previewer and should be checked against real documents; **Open original** is the fidelity fallback. Pages and assets are local and originals are stored byte-for-byte. Search, OCR, sync, and account support are outside phase 1.

The M0 ink lab needs feedback on your actual stylus and device. Check pressure, tilt, palm rejection, eraser button, and perceived latency. See [docs/PLAN.md](docs/PLAN.md) for architecture and milestone gates and [docs/VERSIONS.md](docs/VERSIONS.md) for runnable version checks.
