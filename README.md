# omniNote (working name)

A local-first desktop notebook with nested folders and sections, an infinite canvas, vector ink, embedded original documents, and a local extension host. Phase 1 uses Electron, React, TypeScript, and SQLite. No account or sync service is involved.

## Run

Install Node.js 22.12 or later and npm. On Windows, run:

```powershell
npm ci
npm start
```

`npm start` builds the renderer and opens the desktop app. The workspace is stored in Electron's `userData/workspace` directory. Set `WHITEBOARD_WORKSPACE` to an absolute directory to use an isolated test workspace. Run `npm run ink-lab` to open the original stylus input experiment, `npm run typecheck` for the TypeScript projects, or `npm test` for storage, backup, and document-link fixture checks.

## Use

- Create notebooks, nested folders, sections, and pages in one explorer tree. Pages sit directly under their section. Drag items to reorder or move them, double-click a title to rename it, drag the explorer's right edge to resize it, or use the notebook icon to collapse it.
- On a newly opened page, click the canvas and type directly on the paper. Text has a transparent background, so dots, grids, and lines remain visible underneath. The tool switches to **Select** after placing a note; choose **Text** again to place another. Use **Note box** in the toolbar or right-click empty canvas to add a colored box. Click anywhere inside a note to resume typing. Select text and open **Appearance** to change its color and opacity or return it to plain text. Drag the small move handle at the upper-right of a selected note to reposition it; drag the lower-right handle to resize it.
- Use Pen or Highlight for pressure-aware vector strokes. Erase whole strokes or check **Partial** to split them. Lasso selects objects. Wheel zooms at the pointer; Space plus drag pans. Pen drawing ignores touch shortly after pen input.
- Use **Insert file** to choose an embedded block or a page printout for PDF/DOCX. A printout lays the preview pages on the canvas so you can draw over them. PDF printouts render as page images; DOCX printouts use the local document renderer. Drag files onto the canvas to place them at the drop point; Shift-drop uses printout mode for PDF/DOCX. Images, audio, and video are also accepted, with local players for supported media formats. Files without an available preview appear as a compact file icon and name.
- Attachment actions live in the small arrow shown when an object is selected. Use it to open the unchanged original, enter document interaction mode for links and scrolling, or switch a PDF/DOCX between block and printout. The preview and original remain linked to the same local asset.
- Right-click a canvas item for Copy, Cut, Duplicate, Paste here, order, grouping, and Delete. Right-click empty paper to paste at that point or add text or a note box. Ctrl+C/X/V work on selected canvas objects; paste text or an image from another app to insert it. Text editing inside a note keeps its normal shortcuts. Use Ctrl+Z/Y for canvas undo/redo and Shift-click for multiple selection. Rich text has its own editor undo while focused.
- Use **Paper** on each page to choose Blank, Dots, Grid, or Lines. New pages start blank; existing workspaces keep their dotted pages when upgraded. The paper style is saved with the page and follows pan and zoom.
- The window opens maximized. Use **Canvas full screen** on the toolbar to fill the display with the canvas; **Tools** reveals the toolbar in that mode, and **Exit full screen** returns to the notebook layout.
- Open **Settings** from the gear at the bottom of the activity rail to choose Classic Light, Midnight, Warm Paper, or Sage. The choice is saved on this machine. Themes change the workspace chrome while page paper stays light for existing ink and embedded documents.
- The single **Export** menu offers a workspace backup ZIP (SQLite database and original assets) and a PDF of the current visible page view. Pending canvas edits are saved before a backup starts and when the window closes. Test restores by extracting the ZIP into an empty workspace directory with the app closed.

## Extensions

Local extensions live in the workspace's `extensions/` directory. The bundled `whiteboard.date-insert` example is copied there on first launch. Its toolbar button runs in a worker and inserts today's date through the restricted `canvas.write` bridge. The Extensions icon opens a searchable list in the resizable sidebar, with enable switches and inline settings. When a catalog URL is configured, the same search also discovers marketplace packages and installs them locally after integrity checks. No catalog host is configured yet. API 1.0 supports commands, toolbar/sidebar contributions, canvas object types, document viewers, import/export handlers, and settings. See [docs/EXTENSIONS.md](docs/EXTENSIONS.md) for the manifest, catalog, and message contracts.

## Current limits and testing

This is a source-run test version, not an installer. PDF previews and printouts display the first 50 pages; XLSX previews show up to 200 rows and 30 cells per sheet; PPTX shows text and links rather than the full slide design. DOCX printouts reflect the built-in renderer and may differ from Word pagination. Audio/video playback depends on Chromium's codec support; **Open original** uses the default local app. Link support depends on each previewer and should be checked against real documents. Pages and assets are local and originals are stored byte-for-byte. Search, OCR, sync, and account support are outside phase 1.

The M0 ink lab needs feedback on your actual stylus and device. Check pressure, tilt, palm rejection, eraser button, and perceived latency. See [docs/PLAN.md](docs/PLAN.md) for architecture and milestone gates and [docs/VERSIONS.md](docs/VERSIONS.md) for runnable version checks.
