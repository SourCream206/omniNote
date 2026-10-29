# Review after v18

omniNote is a working name. This review uses the Impeccable, frontend UI, code review, and Ponytail skill guidance. Evidence: source inspection, TypeScript/Vite build, SQLite backup round trip, PDF/DOCX link fixtures, and protocol path checks. The desktop automation layer identified the omniNote window but returned an unrelated browser screenshot, so visual and hardware judgments below are provisional.

## Fixed in v18

- Save pending canvas changes before creating a backup and synchronously flush them on window close. Keep the database open until after the window closes, so the final save can run. A failed close-time save keeps the window open and reports the error.
- Reject custom app URLs outside the built UI and named ink-lab assets, including encoded traversal paths.
- Discard incomplete ink and restore moved, resized, or erased objects when a pointer gesture is cancelled or lost. A second touch cancels the first gesture before pinch zoom begins.
- Show explorer action buttons when a tree item has keyboard focus and on touch devices.

## What remains before a dependable daily-use release

1. **P1 — Stylus and touch validation.** The M0 hardware gate is still open. Measure latency, pressure, eraser button, palm rejection, pinch interruption, and ink over document edges on the owner's actual device. The build cannot establish ink feel.
2. **P1 — End-to-end persistence checks.** Automate or manually verify rapid type → close → reopen and type → backup → restore with the desktop window. The storage tests cover database logic, while the new renderer-to-main close path has only a compile check.
3. **P1 — Installer and recovery flow.** The app still runs from source. Add a signed or clearly identified installer and an in-app, validated restore flow so a backup is usable without hand-editing the workspace folder.
4. **P2 — Canvas scale.** Benchmark a few hundred mixed objects on target hardware, then profile pan, zoom, and typing. The renderer currently culls by bounding box but has no spatial index; the main renderer bundle is about 1.59 MB before compression, with document code contributing heavily. Split viewers only if measurements justify it.
5. **P2 — Document compatibility.** Test real user PDF, DOCX, PPTX, and XLSX samples for links, large files, and preview limits. PPTX remains a text-and-link preview, and DOCX pagination can differ from Word.
6. **P2 — Search and navigation.** Full-text search over notes and embedded document text is still absent. SQLite FTS5 is reserved in the plan; OCR can remain an extension.
7. **P2 — Accessibility and layout pass.** Confirm contrast, text size, focus visibility, menu keyboard behavior, and narrow-window overflow in the rendered app. Several legacy CSS rules use 9–11 px text; tune these from a real screenshot and keyboard pass rather than changing sizes blindly.
8. **P2 — Code structure.** `Canvas.tsx` handles gestures, persistence, clipboard, document placement, and rich text in one file. Split by responsibility when adding the next feature, preserving tests for the extracted behavior. The stylesheet also has an older dense base layer plus theme overrides that should be consolidated when visual checks are available.

The existing hierarchy, vector ink model, original asset storage, PDF/DOCX link fixtures, extensions sidebar, paper styles, themes, and context menus are a solid core. The next checkpoint should focus on the hardware and persistence gates before broadening features.
