# Runnable versions

Each `vN:` commit on `main` is a source-run checkpoint. Use Node.js 22.12+, `npm ci`, then `npm start` at that commit. The workspace schema is versioned separately from these test versions.

| Version | Checkpoint | Tested |
| --- | --- | --- |
| v0 | Stylus input lab | TypeScript build and Electron launch. Pressure, tilt, palm rejection, and feel still need the owner's stylus hardware. |
| v1 | Integrated local notebook, canvas, documents, and date extension | Build, SQLite reopen, desktop smoke test, extension command. |
| v2 | Page print layout and backup ZIP restore | Build; SQLite and original-asset archive round trip. |
| v3 | Document link fixtures and editor/input fixes | Build; `npm test`; PDF external and internal annotation rendering; DOCX external and bookmark link rendering; byte-identical imported originals; Select/Text behavior, text persistence, in-app create-page dialog, text undo/redo, and date extension in the desktop window. |

## v3 hands-on checks

1. Open the app. Use **Select** to click empty canvas; object count should stay unchanged. Use **Text** and click to add a note.
2. Create a notebook, nested folder, section, and page. Rename and drag them; close and reopen the app to verify order and text.
3. Run `npm test`. Import `workspace/fixtures/link-test.pdf` and `link-test.docx`. Click **Interact** on each. The PDF's link to page two should scroll there. Both files expose an `example.com` link; the DOCX also exposes a bookmark jump. Use **Open original** to compare with the native viewer.
4. Draw a pen stroke and a highlighter stroke on a stylus device; check pressure, erasers, lasso, touch rejection, and reopen. Compare with `npm run ink-lab` if the main editor feels delayed.
5. Add 200 mixed objects, pan and zoom, and record whether the app maintains the 60 fps target on the target device.

The PDF/DOCX fixtures prove that their link structures reach the built-in viewers; they are small validation files, not a full document compatibility suite. Office previews have format-specific limits described in the README.
