# Runnable versions

Each `vN:` commit on `main` is a source-run checkpoint. Use Node.js 22.12+, `npm ci`, then `npm start` at that commit. The workspace schema is versioned separately from these test versions.

| Version | Checkpoint | Tested |
| --- | --- | --- |
| v0 | Stylus input lab | TypeScript build and Electron launch. Pressure, tilt, palm rejection, and feel still need the owner's stylus hardware. |
| v1 | Integrated local notebook, canvas, documents, and date extension | Build, SQLite reopen, desktop smoke test, extension command. |
| v2 | Page print layout and backup ZIP restore | Build; SQLite and original-asset archive round trip. |
| v3 | Document link fixtures and editor/input fixes | Build; `npm test`; PDF external and internal annotation rendering; DOCX external and bookmark link rendering; byte-identical imported originals; Select/Text behavior, text persistence, in-app create-page dialog, text undo/redo, and date extension in the desktop window. |
| v4 | Extension contribution host, unified explorer, and page paper styles | Build; `npm test`; local extension manifest, grant, settings, resource, schema migration, and paper-style checks; desktop check of the nested page tree, resizable and collapsible explorer, single Export menu, and blank/grid/ruled paper. Enabling the broader demo extension through the UI still requires an explicit permission grant test. |
| v5 | Duplicate-action cleanup and accurate renderer notes | Build and `npm test`; the demo toolbar command appears once, and the architecture notes distinguish measured behavior from targets. |
| v6 | Paper menu fix, searchable Extensions sidebar, fullscreen canvas, direct text and note appearance | Build and `npm test`; desktop checks of maximized launch, paper menu over live canvas, grid change, extension search, direct text and colored note box, fullscreen enter/tools/exit. |
| v7 | Direct note interaction without the title strip | Build and `npm test`; desktop checks that clicks in empty text regions resume editing, clicking between overlapping notes edits the chosen note, and the compact move handle repositions it. |
| v8 | Contextual formatting without canvas movement | Build and `npm test`; the text formatting row is positioned over the canvas instead of participating in its layout, including the normal, touch, and full-screen toolbar positions. |
| v9 | Text size control | Build with Tiptap's font-size extension; storage and document fixture tests on Node 24; desktop check that selecting a note shows the size list in place of the heading button. |
| v10 | Clipboard, media, document printouts, and compact attachment menus | Build; storage and document fixture tests on Node 24; isolated desktop checks of text and image copy/paste, PDF and DOCX printouts, MP4 and WAV playback controls, ink over a PDF, and the attachment and Insert menus. Dropping files and stylus feel still need a device check. |
| v11 | Frameless attachments and click-to-show controls | Build; isolated desktop check that existing images fit their own bounds without white margins, attachment controls appear after selection and disappear after deselection, and media and printouts retain their content. |
| v12 | Remove misleading interaction hint | Build; desktop check that document previews no longer expose the double-click hover label. Use the attachment menu's Interact with content action to enter a document or extension. |
| v13 | Compact in-player audio drag grip | Build; isolated desktop check that the grip sits inside the audio pill and moves an audio attachment in the default Text mode. Older audio blocks are reduced to the player's height once. |
| v14 | Compact fallback file attachments | Build; isolated desktop imports of an unsupported file and a corrupt PDF both show a file icon and name. An existing STL attachment shrinks from a preview-sized block, while the original remains available from its menu. |
| v15 | Context menu for canvas items | Build; storage and document fixture tests. Right-click actions cover copy, cut, duplicate, paste at the pointer, grouping, order, and delete; blank canvas keeps note creation and gains paste. Desktop UI inspection was unavailable because the window automation helper returned the Codex window for the omniNote handle. |
| v16 | Local workspace color themes | Build; storage and document fixture tests. Settings opens from the bottom of the activity rail with four keyboard-accessible themes. The selected theme is saved locally and the paper stays light for existing ink and document previews. |
| v17 | Settings sidebar overflow polish | Build; desktop check of the theme picker and Midnight workspace. The theme list no longer creates a horizontal scrollbar in the resizable Settings sidebar. |
| v18 | Review fixes for saving, gestures, protocol paths, and explorer access | Build; storage and document fixtures; app protocol path test. Backup waits for the current page save, close flushes pending changes, cancelled gestures no longer commit, and explorer item actions appear on keyboard focus or touch. Rendered UI and stylus checks remain outstanding because the window automation layer returned an unrelated browser image for the omniNote window. |
| v19 | Marketplace catalog and verified local install scaffold | Build; storage, document, protocol, and marketplace tests. The Extensions sidebar searches a configured catalog; installs verify the ZIP digest and manifest, then start disabled. Generated example catalog/package can be hosted on a static site. No public host or extension update channel is configured. |
| v20 | Windows launcher and GitHub Release updater scaffold | Build, tests, and local Windows installer generation. The packaged feed points to the public `SourCream206/omniNote` releases; `latest.yml` names the generated installer. A new release adds an Install update button above Settings; Yes downloads and installs, Ignore remembers that version, and Cancel leaves it available. A live version-to-version update still needs two published releases. |
| v21 | Cleaner text, menus, and export layering | Build and desktop checks in an isolated workspace. Export menu renders over page actions; explorer menus close outside and switch between items, with right-click access. Plain text has no idle box and grows with content; Sticky Note keeps its colored square. The duplicate object-actions toolbar button is removed, and right-click actions work with Pen and Text active. |
| v22 | Custom window chrome and page tabs | Build, tests, and desktop checks. Frameless themed title bar with document icon and window controls; pages open as movable tabs with side-by-side split panes. Export, Paper, and Insert file moved into the canvas toolbar. |
| v23 | Shared toolbar, draggable editor groups, and document tabs | Build and tests; isolated desktop checks of PDF, DOCX, and TXT imports into Explorer; full-document links; tab reordering and moving between groups, including a drop over an iframe; pane-specific toolbar; and ink over a PDF printout. SQLite migration preserves existing pages and adds document-page mappings. External File Explorer drag and stylus hardware still need a device check. |
| v24 | Clearer tab and Explorer drag states | Build and tests; isolated desktop checks of Sage active and inactive split tabs, moving a page into a section, and reordering tabs. Internal Explorer drag uses pointer events instead of native HTML drag, with insertion lines and a small drag preview. File imports still use native drop. |

## v3 hands-on checks

1. Open the app. Use **Select** to click empty canvas; object count should stay unchanged. Use **Text** and click to add a note.
2. Create a notebook, nested folder, section, and page. Rename and drag them; close and reopen the app to verify order and text.
3. Run `npm test`. Import `workspace/fixtures/link-test.pdf` and `link-test.docx`. Click **Interact** on each. The PDF's link to page two should scroll there. Both files expose an `example.com` link; the DOCX also exposes a bookmark jump. Use **Open original** to compare with the native viewer.
4. Draw a pen stroke and a highlighter stroke on a stylus device; check pressure, erasers, lasso, touch rejection, and reopen. Compare with `npm run ink-lab` if the main editor feels delayed.
5. Add 200 mixed objects, pan and zoom, and record whether the app maintains the 60 fps target on the target device.

The PDF/DOCX fixtures prove that their link structures reach the built-in viewers; they are small validation files, not a full document compatibility suite. Office previews have format-specific limits described in the README.

## v4 hands-on checks

1. Create a section and multiple pages. The pages should appear nested under that section in the explorer. Collapse a section, resize the explorer from its right edge, then collapse the whole explorer from the activity rail. The page canvas should expand.
2. Open **Export** and confirm the only export entry point lists **Page as PDF** and **Workspace backup ZIP**. Save and inspect both files.
3. Choose Blank, Dots, Grid, and Lines from **Paper**. Pan and zoom, then reopen the app to confirm each page retains its choice. Select a text object to reveal the formatting row; use its toggle to hide and show that row. Open **More object actions** for grouping, order, copy, and delete.
4. Follow [EXTENSIONS.md](EXTENSIONS.md) to test the broader demo in an isolated workspace. Review its requested capabilities before enabling it.
