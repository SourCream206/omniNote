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
