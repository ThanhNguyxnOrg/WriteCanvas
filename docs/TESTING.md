# Testing

Two kinds of checking, with a clear rule between them: **logic is tested in
`tests/`, behaviour is checked against the running app.**

## The unit suite

```bash
npm test
```

`npm test` runs `node:test` over an explicit file list (it is not a glob, so a new
file has to be added to the `test` script in `package.json`). It never loads
Electron, needs no display, and finishes in well under a second, which is why CI
can afford to run it on Windows, macOS and Linux for every push.

| File | Covers |
|---|---|
| `tests/pen-paper.test.mjs` | Pen and paper pure logic, and the ruler's line/rectangle clipping. |
| `tests/png-toolkit.test.mjs` | The note codec: chunk round trip, agreement with the main-process facade on template paths and orientations, legacy repair, the legacy raster fallback, read options, and malformed input (a truncated chunk must be rejected, not silently accepted). |
| `tests/shortcuts.test.mjs` | The platform chord labels: all three targets named, `⌘` on macOS versus `Ctrl` elsewhere, the platform redo chord, page navigation on Control everywhere, and ARIA modifier names instead of glyphs. |
| `tests/library-pages.test.mjs` | Library page operations: duplicating, deleting and the resulting index and page files. |
| `tests/auto-merge.test.mjs` | The auto-merge policy: which pull requests merge, which are handed to a human, and which are skipped. |
| `tests/release-notes.test.mjs` | Release subject parsing, changelog section extraction, and a release-readiness check that `CHANGELOG.md` has a section for the version in `package.json`. |

Current size, for orientation: 49 tests in 10 suites.

## Adding a unit test

1. Put the logic in a module that can be imported without Electron. This is the
   reason `src/js/paper.js`, `src/js/pen.js`, `src/js/ruler.js`,
   `src/js/png-toolkit.js` and `.github/scripts/*.mjs` keep their pure functions
   separate from anything that touches a canvas or a window.
2. Add `tests/<name>.test.mjs` using `node:test` and `node:assert/strict`.
3. Append the file to the `test` script in `package.json`.

Two conventions worth copying from the existing files:

- Test the boundary, not the happy path twice. `png-toolkit.test.mjs` spends as
  much effort on truncated and malformed input as on round trips, because that
  code parses files that may come from anywhere.
- Assert on a value a reader can check. The shortcut tests assert the ARIA form
  (`Meta+Shift+Z`) as well as the glyph form, so an accessibility regression
  fails loudly instead of subtly.

## Checking the running app

Anything that depends on layout, pointer input or the compositor is checked
against a live instance. Start it with the DevTools protocol enabled, then use
the scripts in `scripts/` — see the table in
[DEVELOPMENT.md](DEVELOPMENT.md#developer-scripts):

```bash
npm run start:debug            # terminal 1
node scripts/smoke-cdp.mjs     # terminal 2
node scripts/audit-ui.mjs
```

Practical notes, learned the hard way:

- **Prefer synthesized pointer events for timing.** CDP mouse input on a
  compositor with no GPU can queue and drift, which makes a two-second fade look
  wrong. Dispatching `PointerEvent`s inside the page with controlled timestamps,
  then sampling canvas alpha, gives a deterministic answer.
- **Screenshots go through the app.** `scripts/snap-cdp.mjs` uses the
  `debug:captureWindow` IPC because CDP's own screenshot capture stalls on this
  compositor. The main window also disables native occlusion throttling so frames
  keep flowing while the window is covered.
- **A busy main thread eats your measurement.** A pending autosave or a large GIF
  encode can starve a frame; if a fade or an animation looks wrong, check that
  nothing is being written first.

## Never test against a real library

The app writes to note files, so an automated run must not point at a library
that matters. Copy it first, then hand the copy to the app through `WC_QA_LIBRARY`
(see [DEVELOPMENT.md](DEVELOPMENT.md#test-hooks-in-the-main-process)), and use a
throwaway `--user-data-dir` profile so the app's own `config.json` and
`localStorage` cannot collide with a live install.

A test that asserts on a note file should read the copy, and should not assume the
file was untouched by the run.

## Release readiness

`tests/release-notes.test.mjs` ties the version in `package.json` to the changelog:
if you bump the version without writing the section, `npm test` fails. That guard
exists because the publish workflow reads the same section and will refuse to
release without it — better to find out locally. See
[RELEASING.md](RELEASING.md).