# Changelog

Every release of WriteCanvas is described here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the file layout of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The publish workflow reads this file: a push to `master` whose subject is
`release: vX.Y.Z` publishes the section `## [X.Y.Z]` below, so an entry has to be
written before the release commit — see
[docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

## [1.2.0] - 2026-11-15

### Added

- **Selection clipboard** — copy, cut and paste strokes and shapes from the
  selection toolbar or the Edit menu (`Ctrl+C`/`Ctrl+X`/`Ctrl+V`, `⌘` on
  macOS). Copies ride the OS clipboard as a `writecanvas-objects` payload, so
  they survive switching notes or windows and can be pasted after a restart;
  text fields keep native editing. Pasting shows a hint when the clipboard
  holds nothing that belongs to the app.
- **Continuous page stack** — every page of a note now sits in one scrolling
  run with stills for the inactive sheets, so the end of page 1 stays visible
  while page 2 comes up, the way the original app scrolls. Only the bottom of
  the last sheet still arms the pull hint that appends a new page.

- **Text in the selection** — text boxes now behave like ink in the Select
  tool: click or lasso them, drag to move, copy/cut/paste them together with
  strokes, duplicate and delete them (button or `Del`), and edit in place by
  double-clicking or tapping with the Text tool. A Text button on the toolbar
  places boxes without opening the Shapes menu first.
- **Tap to place a shape** — after picking a shape, a tap on the page places it
  at a readable default size; dragging still sizes it by hand. The shape
  gallery is grouped into Lines & arrows, Basics and Polygons.
- **A protractor stencil, picked like a shape** — the Ruler card opens a
  picker with the straight ruler or a degree-banded protractor, and the Select
  card opens the same way for its Lasso and Click modes. Picking applies it at
  once and the card marks the pick you used last; both survive a restart, like
  the pen slots. A stroke that starts on the protractor's arc rides the
  circle, the centre grip moves it and the far handle turns it.

### Changed

- **Lighter live inking** — a stroke in progress stamps only the slice its
  newest samples added and composites that slice, instead of rebuilding and
  repainting the whole stroke on every pointer sample; long strokes keep up
  with the pen. The only part that is ever repainted is the short provisional
  tail at the pen tip, wiped and restamped inside its own region and clip.
- **Steadier fast strokes** — the pen reads the coalesced pointer samples
  Chromium folds into a single event and paints the live slice at most once per
  animation frame, so a quick flick keeps its true curve instead of collapsing
  to a couple of chords per frame.
- **A ruler that behaves like a stencil** — with the ruler on, only strokes
  that start on its band snap to the line (the band glows while they do);
  drawing away from it stays free-hand. A handle near the far end rotates the
  stencil by dragging, every fifth division is drawn longer, and the ±10°
  buttons still step.
- **A stencil that looks like a tool** — the straight ruler and the protractor
  are drawn as frosted acrylic: a soft shadow and a glassy body, graduations
  running from the writing edge inward (millimetre marks appear as the page
  zooms in; centimetres are numbered from the grip in both directions and stay
  upright when the stencil is turned around) and a machined grip puck with a
  move glyph next to a matching rotate ring. The floating angle control beside
  the grip is one pill now instead of three loose circles. Snapping and the
  handles' positions behave exactly as before.
- **Select and Ruler open their pickers** — clicking either card pops its
  chooser open the way the Shapes gallery already did, with the last pick
  already marked: Select offers Lasso and Click, Ruler offers a straightedge
  and a protractor. Choosing one applies it and closes the card, the pick is
  remembered after a restart, and Esc puts the stencil away. The protractor is
  a movable, turnable semicircle with its degree band; a stroke that starts on
  its arc stays on the curve while it draws, like the ruler keeps one on its
  edge.
- **Eraser opens its picker** — clicking the Eraser card pops its chooser open
  the way Select, Ruler and Shapes already did, with the mode you used last
  already marked: Stroke, a Segment eraser (S/M/L) or Sheet for the whole page.
  Picking a mode applies it, turns the eraser on and closes the card; the mode
  and the segment size are remembered after a restart. The corner chevron is
  gone, leaving the same caret the other picker cards carry.
- **Pickers say less** — the helper paragraphs under the Select, Ruler and
  Shapes pickers are gone; each card shows its title and its choices, with the
  pick you used last already marked on the tile, like the original's flyouts,
  which carry option labels and no prose.
- **Toolbar in working order** — the tools run erase → select, text → shapes,
  ruler → laser, pan, separated by thin cluster rules, with a dedicated Text
  button. The mode caption that used to sit on a second row under Eraser and
  Select is gone — on screen it read as a half-drawn second button, and it said
  the same thing as the menu behind it; the eraser and select cards open their
  own choosers, and the pick you used last stays marked inside. The Shapes menu
  carries shapes alone, so text is not offered in two places, and the eraser
  keeps the factory modes (stroke, segment sizes, sheet) instead of a fourth
  "Drag" option that only duplicated stroke erasing with a movement threshold.
- **Pens that read as five tools** — the picker shows a live sample of each
  type beside its name (Pen — Smooth, Pencil — Grain, Calligraphy — Chisel 45°,
  Highlighter — Translucent, Hi-Square — Solid block), and at everyday widths
  each type inks a visibly different line: smooth and opaque, a lighter thin
  stroke with graphite riding its rough edge, a strong thick/thin chisel, a
  pale wide band, and a broad squared block. The differences were tuned up
  (a lighter, narrower, grainier pencil; a wider, harder 45° nib; a squared
  highlighter that is broad and near-opaque) because at one width setting the
  five used to read as the same line at different shades.
- **Pen-up changes nothing** — the line you see while drawing is the line that
  stays, pixel for pixel: the mask liveC shows is the mask that is committed,
  the pencil's grain is anchored to permanent stamps only, and the
  highlighter's closing cap is already on screen in the last live frame. The
  commit copies that mask onto the ink layer instead of rebuilding the stroke,
  and the replay frame is taken on the next animation frame, so lifting the pen
  paints and returns in about a millisecond instead of hitching for 20–50 ms.

### Fixed

- **Filled shapes respond everywhere** — the eraser and click-select now hit a
  filled shape anywhere inside it, not only on the outline it was built from,
  and the segment eraser removes a filled shape whole instead of leaving a
  hollow outline fragment behind.
- **The selection bar's duplicate action** shows the duplicate icon instead of
  the "DC4" control glyph that a wrong entity produced, and all five actions
  use the app's icon set rather than a mix of emoji, text characters and SVG.

## [1.1.1] - 2026-11-10

### Fixed

- **Release publishing** — the shared publisher can read the build artifacts it
  attaches, so a release no longer fails while collecting the installers.

## [1.1.0] - 2026-10-25

### Added

- **Microsoft Store package** — WriteCanvas is listed for Windows as an AppX
  package built from the same source as the installer. Store submissions need no
  purchased certificate: Microsoft re-signs the package during publishing. The
  package identity is reserved in Partner Center and stored in
  `store/identity.json`.
- **More architectures** — a macOS DMG for Intel Macs and a Linux arm64 AppImage
  are built on runners of those architectures, and each release build launches the
  packaged app on its own platform before the files are attached.

### Changed

- Linux arm64 ships the AppImage only. The deb target is produced with fpm, whose
  bundled toolchain is x86-only and cannot run on an arm64 runner.
- Re-publishing a version replaces only that version's files; earlier releases
  keep theirs.

## [1.0.0] - 2026-10-25

First stable release. It replaces the 0.1.x development builds, including 0.1.2,
whose installers were the first ones that ran; those builds have been withdrawn.

### Added

- **Installer** — a build for every desktop target is attached to the release: an
  assisted NSIS setup on Windows that asks where to install, a DMG for Intel and
  Apple silicon, and an AppImage plus a deb for x64 and arm64 Linux. They are
  built only when a release is published, so an ordinary commit never spends
  three operating systems' worth of packaging time.
- **Library** — folders and notes in a chosen folder, stored as
  `Scribble/<Name>#<NN>.png` beside an `index.json`, mirroring the Scrble Ink
  layout so a library can be shared between the two apps. Create, rename, move,
  duplicate and delete from the tree or a context menu.
- **Scrble Ink note format** — reads and writes the private ancillary chunks
  (`sVER`, `sINK`, `sLYT`, `sBKG`, `sCRP`, `sSTD`, `sPNA`, `sBKC`, `sBRL`) after
  the IDAT, and stores editable content in two extensions of our own: `sVec` for
  vector strokes and text, `sRST` for the raster base the strokes sit on.
  Importing a library keeps already-drawn pages intact, including notes written
  by Scrble Ink itself with ink only and no vector data.
- **Ink replay** — an animated GIF of how a page was drawn, embedded in the note
  as the `sINK` chunk does in the original app.
- **Pen engine** — five pen types, the factory 29-colour palette, per-pen colour
  and width, a custom hex field and a colour picker. Translucent pens composite
  once per stroke, so a highlighter never darkens itself where it crosses.
- **Paper engine** — Letter, Legal, Tabloid and A0 to A6, with blank, pattern and
  planner templates rendered at the document scale of the original assets.
- **Board colour** — applied to the current page by default, or to every page in
  the note from the flyout. The interface theme is a separate setting and never
  changes a board.
- **Pages** — add, duplicate, delete and navigate, with thumbnails, context
  actions, and a page turn that keeps the next sheet visible while scrolling.
- **Tools** — laser pointer (a temporary annotated trail that is never saved),
  ruler with snap and rotation, shapes and text boxes, an eraser with stroke,
  segment and sheet modes, and a selection tool with click and lasso modes that
  can move, duplicate and delete strokes.
- **Saving** — autosave with a debounce, an explicit save for every changed page,
  and an export menu offering a PDF of the current page or of the whole note,
  PNG, and the portable `.wcanvas` container that packs a note and its pages into
  one zip.
- **Keyboard** — shortcuts resolved per platform, with a help sheet that shows
  Windows, macOS or Linux chords depending on where the app is running.

### Fixed

- **Packaged app had no bridge** — `preload.js` was missing from `build.files`, so
  the renderer could not reach the main process and the window showed "No host
  bridge found". The file is now shipped, a test fails if a root-level file the
  main process opens is left out of the bundle, and every release build verifies
  its own `app.asar` before uploading.
- **App icon** — the installers and the window now carry the WriteCanvas icon
  instead of Electron's default.
- **Linux packaging** — the deb target failed with "Please specify author
  'email' in the application package.json"; the package now declares an author.

### Changed

- Re-publishing a version replaces only that version's installer files; earlier
  releases keep theirs.

### Security

- The renderer is context isolated and reaches the file system only through the
  `WriteCanvasHost` bridge in `preload.js`; every library path from the renderer
  is resolved and validated in the main process before it is used.

[Unreleased]: https://github.com/ThanhNguyxnOrg/WriteCanvas/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.2.0
[1.1.1]: https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.1.1
[1.1.0]: https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.1.0
[1.0.0]: https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.0.0
