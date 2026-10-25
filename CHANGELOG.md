# Changelog

Every release of WriteCanvas is described here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the file layout of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The publish workflow reads this file: a push to `master` whose subject is
`release: vX.Y.Z` publishes the section `## [X.Y.Z]` below, so an entry has to be
written before the release commit — see
[docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

## [1.1.0] - 2026-10-25

### Added

- **Microsoft Store package** — WriteCanvas is listed for Windows as an AppX
  package built from the same source as the installer. Store submissions need no
  purchased certificate: Microsoft re-signs the package during publishing. The
  package identity is reserved in Partner Center and recorded in
  [docs/STORE.md](docs/STORE.md), together with the listing copy and the
  submission steps.
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

[Unreleased]: https://github.com/ThanhNguyxnOrg/WriteCanvas/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.1.0
[1.0.0]: https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.0.0