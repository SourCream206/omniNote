# Tauri v2 ink lab (M0)

This is the disposable Windows pen and rendering spike for the fresh Tauri app described in [the plan](../docs/TAURI_PLAN.md). It has no notebook storage yet and does not alter the existing Electron app.

## Run

Install [Node.js](https://nodejs.org/), [Rust with the MSVC toolchain](https://rustup.rs/), and [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/). Then, from this directory:

```powershell
npm ci
npm run tauri dev
```

`npm run build` checks TypeScript and builds the web UI. `cargo check` in `src-tauri` checks the native shell.

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
- The generated PDF is 300 pages, and page 300 renders alongside dense ink. Only the selected page is mounted to a canvas.
- In one short mouse run, worker draw work was about 1.7 ms p95 with culling and 9.9 ms with a full redraw. These are diagnostic samples, not a device benchmark or a pass result.
- TypeScript/Vite build, native `cargo check`, and the existing Electron regression suite pass.

**Still required for M0:** HP Envy stylus and palm test, contact-to-visible video timing, a 20-minute stress run, and a decision on whether the worker path improves the actual pen experience.
