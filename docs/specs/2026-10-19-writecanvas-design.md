# WriteCanvas — Design Spec (2026-10-19)

Goal: cross-platform (Win/mac/Linux) note-taking & inking rewrite of **Scrble Ink**, built by reverse-engineering the original with REA (see `docs/ANALYSIS.md`). Priority (user-approved): (a) inking fidelity on all 3 OS **+** (b) small bundle / low RAM. User directive: "làm luôn, tối ưu nhất".

## Chosen architecture — Strategy A (Tauri target) with framework-agnostic core

The renderer (ink engine, UI, format layer) is written as **framework-agnostic ES modules** that talk to the host through a thin `bridge` interface. Two hosts implement the same bridge:

| Host | Status | Why |
|---|---|---|
| **Electron** (main/ — Node backend) | first runnable host (toolchain ready today) | guaranteed-fidelity fallback, fastest to verify the ink engine |
| **Tauri v2** (Rust commands) | target shell; needs rustup+MSVC (installing) | satisfies (b): <15MB bundle, low RAM |

**Decision gate:** research report (`docs/research/framework-comparison.md`) on WebKitGTK Pointer-Events/pressure/canvas must not show a hard blocker; if it does, fall back to Electron shell for release while keeping all renderer code unchanged.

## Bridge contract (renderer ⇄ host)

```ts
bridge.library(): Promise<{root, items}>
bridge.pickLibraryFolder(): Promise<null>
bridge.importNotes(): Promise<null>            // native file picker → copies PNGs into library
bridge.createNote(name, parentId): Promise<Item>
bridge.createFolder(name, parentId): Promise<Item>
bridge.renameItem(id, newName): Promise<Item>
bridge.moveItem(id, parentId): Promise<Item>
bridge.destroyItem(id): Promise<null>          // notes also delete their page files
bridge.loadNote(id): Promise<{note, pages:[{file, exists, bytes?}]}>
bridge.savePage(id, pageIndex, page): Promise<null>
// page = { pngBytes: Uint8Array, frames: [{delay, width, height, data: Uint8Array}], meta }
bridge.exportAs(bytes, defaultName, kind): Promise<null>   // kind: png|jpg|pdf|gif
bridge.exportPDF(pagesBytes, paperMM, orientation): Promise<null>
bridge.revealLibraryFolder(): Promise<null>
bridge.onLibraryChanged(cb)                    // host pushes index updates
```

## Note file format (100% Scrble-Ink-compatible; evidence in docs/ANALYSIS.md)

PNG (flattened page render at 3× 96dpi scale) + ancillary chunks after last IDAT:

- `sVER` u32BE = 3
- `sINK` full GIF89a ink-replay animation (omitted until first replay frame exists)
- `sLYT` 1 B (orientation), `sBKG` 1 B has-template, `sCRP` 1 B =1, `sBRL` 1 B =1
- `sSTD` LP-string paper size ("Letter"/"A4"/"A5"/"Square")
- `sPNA` LP-string template path (original-style `/Assets/Paper/<Orientation>/HighRes/…` so the original app renders our notes correctly)
- `sBKC` LP-string `#AARRGGBB` background

Library on disk mirrors original layout: `<root>/Scribble/<NoteName>#<NN>.png`, index in `<root>/index.json` (our addition; original keeps naming info in chunks/filenames).

## Renderer module map (src/js, ES modules)

- `bridge.js` — host detection + adapter (Electron preload API or Tauri invoke)
- `palette.js` — 26-color default palette recovered from settings.dat evidence
- `paper.js` — sizes (Letter 216×279mm, A4, A5, Square 200×200mm), orientations, procedural templates (ruled/grid/dotted/graph/black/blank) drawn at 3× scale; template→sPNA mapping
- `ink.js` — stroke engine: Pointer Events + pressure, variable-width smoothing (midpoint quadratic, per-point width = f(pressure)), stroke-eraser, vector command model (undo/redo = command replay — no snapshot memory bloat)
- `editor.js` — canvas stack (paper / imported raster / vector / live overlay), pan-zoom, pages, flatten+export, autosave, replay playback
- `replay.js` — frame recorder (throttled, downscaled ≤1280px) + playback
- `library.js` — sidebar tree UI (folders/notes, context menu rename/move/delete)
- `pdf.js` — export via host printToPDF (Electron now; Tauri: print via new window or a sys print plugin — host-side detail)

## MVP scope (this build)

Pen (palette+width+opacity+pressure), stroke eraser, pan/zoom, multi-page, paper settings, undo/redo, autosave, library tree CRUD, PNG/JPG/PDF export, ink replay (record+play), import original Scrble Ink notes (chunk-preserved), open original library folder.

Roadmap (matches original's map, not in MVP): lasso selection layer, shapes/text flyouts, ruler, camera insert, handwriting recognition, PDF password, print continuation pages, laser pointer.

## Testing

- Manual: draw/erase/undo/zoom on Win; open original note `Untitled#01.png`; save; re-open.
- Byte check: saved note → `node` script asserts chunk set + sINK GIF89a marker (mirrors the REA evidence checks).
- Launch matrix: `npx electron .` today; `tauri dev` after toolchain install completes.
