# Architecture

WriteCanvas is an Electron application with a hand-written Canvas 2D inking
stack. There is no UI framework, no bundler and no build step for the renderer:
`src/index.html` loads ES modules directly, and the only runtime dependency is
`gifenc`, which encodes the ink replay GIF.

## Processes and the trust boundary

| Process | Code | Responsibility |
|---|---|---|
| Main | `main/main.js`, `main/library.js`, `main/scrble-format.js`, `main/png-chunks.js`, `main/wcanvas-export.js` | Window and menu, dialogs, the library on disk, all PNG work, GIF encoding, PDF export. |
| Preload | `preload.js` | The only bridge: publishes `WriteCanvasHost` with `contextBridge`. |
| Renderer | `src/js/*` | Editor, library tree, tools, rendering, autosave scheduling. No file system, no Node. |

The window is created with `contextIsolation: true`, `nodeIntegration: false` and
`sandbox: true` (`main/main.js`). The renderer therefore cannot touch the disk;
every operation goes through `window.WriteCanvasHost`, which is a fixed list of
`ipcRenderer.invoke` calls. Anything a renderer sends — a note id, a folder name,
a page index, a save payload — is treated as untrusted and re-validated in the
main process, including path resolution inside the library root.

`src/js/bridge.js` wraps the host so the renderer does not care where it runs: it
returns the Electron bridge when `WriteCanvasHost` exists and a Tauri adapter
with the same call names otherwise.

## Canvas stack

Each page is rendered into a stack of full-page canvases inside `#stackInner`,
which is scaled by `S.zoom` (`0.08` to `8`). A document pixel is `S.zoom` CSS
pixels.

| Layer, bottom to top | Holds | Saved? |
|---|---|---|
| `paperC` | Paper size, template/pattern and board colour. | yes, composited |
| `rasterC` | An imported or legacy raster base — the pixels of a page we did not draw. | yes, as `sRST` |
| `inkC` | Committed strokes and text boxes. | yes, into `IDAT` and `sVec` |
| `liveC` | The stroke in progress, plus previews (selection box, marching ants, shape drag). | no |
| `laserC` | The laser pointer session. | no |
| `rulerC` | The ruler overlay. | no |

The split is deliberate: the three bottom layers are what a page *is*, the top
three are interface that happens to be drawn on the page. Nothing in `liveC`,
`laserC` or `rulerC` can reach a file.

## Modules

| Module | Role |
|---|---|
| `src/js/editor.js` | The editor. Page state (`S`), the six canvases, tool dispatch, gestures, undo/redo, the save pipeline, selection, text boxes, the laser session. |
| `src/js/paper.js` | Paper engine. Document scale (`DOC_DPI = 294.12`, sampled from the original asset: a Letter raster is 2500×3235 px for 8.5×11 in), the page-size table, template paths and `docMM()`. |
| `src/js/pen.js` | Pen engine. The five pen types, the factory 29-colour palette, `makeStroke` and `addPoint`. Each stroke is stamped into an offscreen coverage mask (a union, so a stroke never darkens itself) and composited once with the pen's alpha. |
| `src/js/png-toolkit.js` | The one codec for the private `s*` chunks. Browser-safe, no `fs`, no `Buffer`; used by the renderer, by the Node facade and by the tests. |
| `src/js/replay.js` | `Recorder`: captures composited frames after committed changes so the main process can encode the ink replay GIF. |
| `src/js/ruler.js` | Ruler geometry: line/rectangle clipping and the angle maths. |
| `src/js/library.js` | Library tree UI: folders, notes, selection, drag-move, context actions. |
| `src/js/ctx.js` | Floating context menu and modal prompt helpers. |
| `src/js/shortcuts.js` | Per-platform chords, the `aria-keyshortcuts` values, and the help sheet. |
| `main/library.js` | The library index: the `Scribble/<Name>#NN.png` layout, `index.json`, name sanitising, and `renameRetry` for the Windows/OneDrive `EPERM`/`EBUSY` rename flake. |
| `main/png-chunks.js` | Minimal PNG chunk toolkit: CRC32, parse, and insert/replace ancillary chunks. Never rewrites `IDAT`. |
| `main/scrble-format.js` | Node facade over `png-toolkit.js`: Buffer in/out, plus the legacy repair helpers. |
| `main/wcanvas-export.js` | The `.wcanvas` zip container: writer and reader, no third-party dependency. |

## Data flow: opening a note

1. `note:load` returns the note's page metadata from `index.json`.
2. `note:loadPage` returns the page PNG bytes.
3. The renderer runs `readNotePng`, which hands back the paper metadata, the
   replay GIF, the `sVec` JSON and the `sRST` raster base.
4. A page whose `sVec` parses becomes editable strokes and texts on top of the
   raster base. A page without `sVec` — one written by Scrble Ink itself, or an
   imported image — becomes a raster base only and is still editable on top.

## Data flow: saving

Editing marks the page dirty and schedules a debounced autosave. When it fires,
only dirty pages are written:

1. `snapshotPage` composites `paperC + rasterC + inkC` into one image.
2. The recorder's frames are handed to the main process.
3. `savePage` writes the PNG, with `sVec` carrying the editable strokes and
   `sRST` the raster base, and updates the page row in `index.json`.
4. The thumbnail is refreshed from the same composite.

Page turns flush the page being left, and the window's close handler flushes
everything before the app exits, so a page turn or a quit never loses ink.

## Invariants

Keep these true; each one exists because breaking it caused a real bug.

- **One codec.** `src/js/png-toolkit.js` is the only implementation of the chunk
  format. The Node facade and the tests call it; nothing re-implements framing or
  CRC32.
- **`IDAT` is only rewritten when a page is flattened.** Imported and legacy
  pages keep their original pixels in `sRST` so re-saving does not degrade them.
- **Overlay layers never persist.** Laser, ruler and live previews are cleared on
  page change, note change, tool change and window blur.
- **Every path is validated in main.** The renderer may propose a name; main
  decides where it lands inside the library.
- **A gesture commits to the page it started on.** Text boxes and strokes record
  their owning page, so switching sheets mid-gesture cannot write into the new
  page.
- **Cancel means cancel.** `pointercancel` abandons the in-flight gesture rather
  than committing a partial mark.

## Platform notes in code

- `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`
  and `backgroundThrottling: false` keep frame production alive while the window
  is covered, so screenshots and CDP sessions do not stall (Windows occlusion
  heuristics otherwise stop the compositor).
- PDF export renders a hidden `BrowserWindow` and calls `printToPDF`, so the PDF
  path is the same layout engine as the page canvas rather than a second
  renderer.
- `renameRetry` in `main/library.js` retries `rename()` with backoff, then falls
  back to copying, because OneDrive/AV can hold a file lock for a moment inside a
  synced Documents folder.