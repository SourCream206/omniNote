# Canvas performance notes

Measured on Windows with Node 24, 8,000 synthetic ink objects with 32 points each (2026-11-01). These are local synthetic timings, not stylus latency measurements.

| Operation | Before | After |
| --- | ---: | ---: |
| 20 gesture snapshots | 3,398 ms (deep copies) | 0.02 ms (immutable references) |
| 20 unchanged-page checks | 1,603 ms (JSON comparison) | 2.2 ms (reference comparison) |
| Repeated full-page save | 165–181 ms | 98–109 ms (changed rows only) |
| 20 camera-only saves | Full-page save on each debounce | 71 ms total |

The editor also caches completed ink paths and schedules live ink rendering once per animation frame. An isolated Electron workspace with 2,500 strokes was opened and panned; the camera persisted and the object count remained 2,500. Drawing and Undo were checked visually on that page.

The canvas still loads all page objects into renderer memory, and a very dense viewport still creates one SVG per visible stroke. The store currently limits pages to 10,000 objects and 128 million serialized payload characters. Before raising either limit, measure startup, dense-view interaction, and save latency with representative documents.
