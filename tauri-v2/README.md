# Tauri v2 desktop app

This is the Tauri desktop shell for the omniNote workspace. It reuses the existing React interface and stores notebooks, pages, ink, assets, and extensions through the Rust workspace core. The earlier pen experiment remains available as a separate Ink Lab build.

## Run

Install [Node.js](https://nodejs.org/), [Rust with the MSVC toolchain](https://rustup.rs/), and [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/). Then, from this directory:

```powershell
npm ci
npm run tauri -- dev
```

Install root dependencies with `npm ci` from the repository root first. `npm test` here checks the Ink Lab geometry; `npm run build` checks the desktop renderer. `cargo test --manifest-path src-tauri/Cargo.toml --lib` checks native commands. See [distribution instructions](../docs/DISTRIBUTION.md) for installers and signed updates.

## Ink Lab

Run `npm run start:ink-lab` for the original pen and rendering experiment. The device checklist below applies to that experiment.

## Device test

1. On the HP Envy, record Windows display refresh rate, WebView2 version, pen model, and whether pen buttons map to eraser.
2. Draw light/heavy and tilted strokes, fast loops, and across the canvas edge. Rest a palm while drawing. Repeat with both event streams if raw updates are offered.
3. Press **Load 2,000 strokes**. Draw and pan with **Draw visible strokes only** on, then off, and switch **Completed ink** between main thread and Offscreen worker. Record p95 frame interval and draw work in each case. Try zoom levels from 25% to 400%.
4. Open the generated 300-page PDF beside the canvas. Jump to page 300 and keep drawing with the dense scene loaded.
5. Record a high frame rate video of pen tip and display to measure contact-to-visible ink. The on-screen event-to-animation number is only a software proxy; it excludes composition and display scanout.
6. Run for 20 minutes and note lost samples, missing stroke segments, crashes, memory growth, and pen/touch conflicts.

The proposed 60 Hz gate is p95 contact-to-visible ink ≤50 ms, p95 active-ink frame interval ≤16.7 ms, no lost samples, and no crash. The physical pen/video gate cannot be established by build tests or mouse input alone.

## Current checks

- Windows Tauri shell opens in WebView2 (Chromium 156 reported by the lab).
- A 2,000-stroke, 48,000-point scene renders in main and worker modes. Mouse drawing adds a stroke in both.
- Strokes retain vector input points and render as continuous pressure-sensitive outlines. The live tip is smoothed before the final outline reaches the last sample. Touch cannot start ink while the default filter is on, even if it arrives before the pen; touch can pan with the Hand tool.
- Completed ink is painted on a separate canvas; active ink repaints only its overlay. Pan and zoom use a temporary composited transform, then repaint the vectors when movement settles. The worker path appends a new stroke without copying the entire scene on each pen lift.
- The generated PDF is 300 pages, and page 300 renders alongside dense ink. Only the selected page is mounted to a canvas.
- Live metrics compare main and worker draw cost. The short mouse runs so far are functional checks, not a repeatable pen benchmark or a pass result.
- TypeScript/Vite build and native `cargo check` pass; run the repository tests for editor and distribution checks.

**Still required for M0:** HP Envy stylus and palm test, contact-to-visible video timing, a 20-minute stress run, and a decision on whether the worker path improves the actual pen experience.
