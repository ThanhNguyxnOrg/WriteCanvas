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
returns the Electron bridge when `WriteCanvasHost` exists and keeps a
forward-looking Tauri adapter with the same call names for a future shell. Only
the Electron bridge is shipped today.

## Canvas stack

The whole note is one continuous run of sheets. `#canvasStack` lays every page
out vertically (`layoutStack`, a 16 screen-px seam between sheets), and
`#pagesLayer` holds a rendered still of each inactive page, so scrolling across
a boundary shows the previous page's tail while the next page's head comes up.
`#stackInner` floats the editable layers over the active sheet; `afterScroll`
picks the active page from whichever sheet holds the viewport centre. Stills
are drawn one per frame (`pumpStills`) and dropped outside a small window
around the active page, so a long note never accumulates bitmaps. Rail
thumbnails work the same way: a paper-only tile appears at once and the ink is
queued after it, one page per frame (`pumpThumbs`).

Each page is rendered into a stack of full-page canvases inside `#stackInner`,
which is scaled by `S.zoom` (`0.08` to `8`). A document pixel is `S.zoom` CSS
pixels.

| Layer, bottom to top | Holds | Saved? |
|---|---|---|
| `paperC` | Paper size, template/pattern and board colour. | yes, composited |
| `rasterC` | An imported or legacy raster base — the pixels of a page we did not draw. | yes, as `sRST` |
| `inkC` | Committed strokes, text boxes and pasted pictures. | yes, into `IDAT` and `sVec` |
| `liveC` | The stroke in progress — the same pixels the scratch mask holds, so committing is a copy and not a re-render — plus previews (selection box, marching ants, shape drag). | no |
| `laserC` | The laser pointer session. | no |
| `rulerC` | The ruler overlay. | no |

The split is deliberate: the three bottom layers are what a page *is*, the top
three are interface that happens to be drawn on the page. Nothing in `liveC`,
`laserC` or `rulerC` can reach a file.

## Modules

| Module | Role |
|---|---|
| `src/js/app.js` | Bootstrap: wires the editor, library tree and bridge together, forwards main-process pushes, reopens the last note, and exposes the `window.__wc` test hook. |
| `src/js/bridge.js` | The renderer-side host contract; picks the Electron bridge or the Tauri adapter. |
| `src/js/editor.js` | The editor. Page state (`S`), the six canvases, tool dispatch, gestures, undo/redo, the save pipeline, selection (move and corner-handle resize), text boxes, the laser session. |
| `src/js/paper.js` | Paper engine. Document scale (`DOC_DPI = 294.12`, sampled from the original asset: a Letter raster is 2500×3235 px for 8.5×11 in), the page-size table, template paths and `docMM()`. |
| `src/js/pen.js` | Pen engine. The five pen types, the factory 29-colour palette, `makeStroke` and `addPoint`. Each stroke is stamped into an offscreen coverage mask (a union, so a stroke never darkens itself) and composited once with the pen's alpha. `createStrokeStamper` splits stamps into permanent ones (the settled spine, the pencil grain anchored to it, the opening cap) and a provisional tail that the editor wipes and repaints in its own region and clip; the mask at pen-up is therefore exactly the canonical build and the commit is a blit of it. |
| `src/js/png-toolkit.js` | The one codec for the private `s*` chunks. Browser-safe, no `fs`, no `Buffer`; used by the renderer, by the Node facade and by the tests. |
| `src/js/clipboard.js` | The clipboard contract: the copy payload (v3 adds pictures), the rules for a pasted picture object, fitting a picture onto a page and wrapping pasted text. Also the paste-in reader — the order its sources are tried in and the guards on what it accepts — written against an injected `host`, so main passes the real clipboard calls and the unit suite passes fakes. Pure — no DOM, no Electron — so the unit suite drives it. |
| `src/js/transform.js` | Resizing a selection: the corner handles of the selection box, the anchor a drag grows from, and the uniform factor with which strokes, text boxes and pasted pictures are scaled around it. Pure maths, checked in `tests/transform.test.mjs`. |
| `src/js/replay.js` | `Recorder`: captures composited frames after committed changes so the main process can encode the ink replay GIF. |
| `src/js/ruler.js` | Ruler geometry (line/rectangle clipping, projection and distance for edge snapping, the angle maths) and the two stencil overlay painters (`paintRulerStencil`, `paintProtractorStencil`) the editor calls. |
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
4. A page whose `sVec` parses becomes editable strokes, texts and pasted
   pictures on top of the raster base. A page without `sVec` — one written by
   Scrble Ink itself, or an imported image — becomes a raster base only and is
   still editable on top.
5. The raster base and any pasted pictures decode asynchronously; the page
   repaints (and its thumbnail cache is dropped) when each decode lands, so a
   picture appears a frame or two after its sheet.

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

## Data flow: the clipboard

The renderer never touches the OS clipboard: `preload.js` exposes
`clipboardWrite`, `clipboardReadText` and `clipboardReadImage`, and the main
process owns the flavours and both clipboard shapes in the field — the
synchronous one older Electron builds expose (`clipboard.readImage()`,
`clipboard.write({ text, image })`) and the promise-based one newer builds moved
to (`clipboard.write([new ClipboardItem(...)])`, `clipboard.read()`). Whichever
the runtime has is used, and nothing throws when the other one is missing.

Copying a selection writes two flavours at once. The text flavour is the
`writecanvas-objects` payload (`src/js/clipboard.js`), which survives a restart,
a note switch or a second window and restores the exact objects; the picture
flavour is the selection rendered on a transparent canvas at document
resolution, so Word, Paint or a chat window pastes what was drawn. A copy that
is a whole page (*This page as a picture on the clipboard*) writes the picture
with no text flavour, so a payload can never land in another app's text field.

Pasting takes whatever the person copied last, wherever they copied it: the
payload if the clipboard holds one, then a picture some other app copied — a
screenshot bitmap, which both clipboard shapes hand over as PNG, or a picture
file copied in the file manager, which arrives as a file list (`FileNameW` in
the classic shape, `text/uri-list` in the item shape, so every platform is
covered) — and finally plain text, which arrives as a text box. That order and
every guard on what is accepted live in `src/js/clipboard.js` as
`readClipboardPicture(host)`: main supplies the clipboard and `nativeImage`
calls, and `tests/clipboard.test.mjs` supplies fakes, so the paste-in path is
tested without a window. Only when the
clipboard holds nothing usable does the copy made earlier in this session stand
in, so a screenshot taken after some ink still pastes. A pasted picture is
scaled to fit the page, normalised to the size it will occupy and stored as a
page object in `sVec`; one the page has no room for, or one that cannot be
decoded, is refused with a reason instead of pasting an invisible box.

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
- **A paste is one undo step that owns its objects.** Everything the clipboard
  delivers lands as a single `add` entry and becomes the selection, so a
  mistaken paste is one `Del` or one Undo away. Pasted pictures are page objects
  in `sVec` (v3), never the raster base: `sRST` is the imported page's pixels and
  must stay exactly as it was read.

## Input notes in code

- **A pen stroke keeps every raw sample.** `onPointerMove` reads
  `getCoalescedEvents()` so the points Chromium folds into one event still join
  the stroke; drawing a fast flick from a couple of chords per frame used to
  kink visibly. Synthetic events and hosts without the API fall back to the
  event itself.
- **Live ink paints once per frame.** The mask fill + composite for the newest
  slice is queued on `requestAnimationFrame` (`scheduleLivePaint`), never run
  per pointer event; the commit path still repaints the exact stroke on lift.
- **A stencil takes a stroke only when it starts on its edge** (34 doc px of
  the line or arc). Strokes begun away from it stay free-hand; the far handle
  rotates the stencil, the centre grip moves it. The Ruler card's picker
  switches between the straight ruler and the protractor and remembers the
  pick; Select and the Eraser open their pickers the same way and keep their
  last pick too.

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