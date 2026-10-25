# Development

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 22 or 24 | 22 matches the Node embedded in the pinned Electron major; 24 matches what CI also tests against. |
| npm 10 or newer | Uses the committed `package-lock.json`. |
| Windows, macOS or Linux | All three are supported for development, not just for running. |

Electron 38 and `electron-builder` are dev dependencies, so `npm ci` is the only
install step. There is no bundler, no transpiler and no build step for the
renderer: `src/index.html` loads the ES modules in `src/js/` directly.

```bash
git clone https://github.com/ThanhNguyxnOrg/WriteCanvas.git
cd WriteCanvas
npm ci
npm start
```

## npm scripts

| Command | What it does |
|---|---|
| `npm start` | Run the app from source. |
| `npm run start:debug` | Run with the DevTools protocol on port 9222, which every CDP script below expects. |
| `npm test` | The unit suite (`node:test`). It never loads Electron — see [TESTING.md](TESTING.md). |
| `npm run pack` | Build an unpacked app directory for the current OS. |
| `npm run dist` | Build installers: NSIS, DMG, AppImage and deb. |

## Developer scripts

`scripts/` holds the tools that are worth keeping. Each one is run with plain
`node`; none of them needs a build step. Those marked CDP need the app already
running with `npm run start:debug`.

| Script | Needs | What it does |
|---|---|---|
| `scripts/smoke-cdp.mjs` | CDP | Smoke test over the DevTools protocol: opens a note, draws, saves, and reports what broke. The fastest "is the app alive" check. |
| `scripts/audit-ui.mjs` | CDP | Clicks every control with real mouse events, so hit-testing is included, and reports state changes plus uncaught exceptions. |
| `scripts/snap-cdp.mjs` | CDP | Captures the window to a PNG through the app's `debug:captureWindow` IPC. Needed because CDP screenshots stall on this compositor, and it is the reference for visual parity work. |
| `scripts/render-paper-check.mjs` | CDP | Renders every paper template through the real renderer and writes the canvases out for measuring against the original asset specs. |
| `scripts/pen-engine-check.mjs` | CDP | Strokes each pen type through the live engine, then checks single-composite alpha (no self-overlap darkening) and that the flatten path matches the live path. |
| `scripts/qa-wcanvas.mjs` | CDP | End-to-end for the `.wcanvas` container: create, draw, save, export, inspect the file, re-import. |
| `scripts/measure-paper.mjs` | — | Measures paper template geometry from PNG assets. Also exports `decodePNG`, which the other image-inspecting scripts use. |
| `scripts/verify-note.mjs` | — | Byte-level Scrble Ink compatibility check on a saved note: PNG structure, expected chunk set, `sINK` header, and a round trip through `main/scrble-format.js`. |

The one-off probes that were used while reverse-engineering the original
application's format have been removed once their findings were folded into
[docs/FORMAT.md](FORMAT.md) and the test suite. Add a script when a check needs
the real app; add a unit test when it does not.

## Test hooks in the main process

Automated runs cannot click file dialogs, so the main process accepts
environment variables that answer them directly. They are inert unless set, and
they exist so a script never has to guess a path.

| Variable | Replaces |
|---|---|
| `WC_QA_LIBRARY` | The library folder picker. |
| `WC_QA_PDF` | The PDF save dialog. |
| `WC_QA_EXPORT` | The `.wcanvas` export dialog. |
| `WC_QA_IMPORT` | The `.wcanvas` import dialog. |

## Keep your real library out of harm's way

WriteCanvas edits note files, so a careless dev run can damage notes you care
about. Two habits prevent that.

1. **Work on a copy.** Copy a library to a scratch folder and start the app with
   `WC_QA_LIBRARY` pointing at that copy, or pick the copy interactively.
2. **Isolate the profile.** Point Electron at a throwaway profile so the app's
   `config.json` and localStorage cannot collide with your live install:

```bash
# Windows (Git Bash) / macOS / Linux
npx electron . --user-data-dir="$TMPDIR/wc-dev-profile" --remote-debugging-port=9222
WC_QA_LIBRARY="$TMPDIR/wc-copy" npx electron . --user-data-dir="$TMPDIR/wc-dev-profile"
```

Never point the app at a library that has unsaved work in another instance, and
do not close a window you did not open.

## Code layout and conventions

| Rule | Why |
|---|---|
| `main/` is CommonJS with `'use strict'` | It is loaded by Electron's main process, which is not an ESM host here. |
| `src/js/` is ES modules | Loaded directly by the browser context; no bundler exists. |
| No new runtime dependency without a reason | The app ships `gifenc` only. A dependency is a supply-chain and packaging cost on three platforms. |
| Pure logic lives in its own module | So it can be tested in `tests/` without Electron. `release-notes.mjs` and `auto-merge.mjs` in `.github/scripts/` follow the same rule. |
| One codec, one conversion | Chunk framing belongs to `src/js/png-toolkit.js`; millimetres to `src/js/paper.js`'s `docMM()`. Duplicate either and the two will drift. |
| Comments explain why | A comment that restates the code is deleted in review. Hidden constraints, platform workarounds and invariants are the ones worth writing. |
| Linux is never the fallback branch | Platform behaviour is a list of three, not "Windows and anything else". |
| Endings are LF | Enforced by `.gitattributes`; `*.png` and `*.wcanvas` are marked binary. |

## Commits and branches

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(editor): keep the ruler on the page while panning
fix(pages): commit the text box to the page it was placed on
docs(format): describe the sRST chunk
chore(ci): bump the checkout action
```

Scopes in use: `editor`, `ink`, `paper`, `pages`, `library`, `save`, `export`,
`laser`, `ruler`, `shortcuts`, `ci`, `docs`, `deps`.

- Branch from `master` and open a pull request; `master` is the only long-lived
  branch.
- CI has to pass before anything merges. See [AUTOMATION.md](AUTOMATION.md) for
  which pull requests merge without a human and which always wait.
- Add a `CHANGELOG.md` entry under `## [Unreleased]` when a change is
  user-visible. The release process reads that file, and `npm test` fails if the
  current version has no section.