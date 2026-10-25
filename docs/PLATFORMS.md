# Platform support

Windows, macOS and Linux are first-class targets: all three run from source, all
three are covered by CI, and all three have a packaging target. There is no
"primary" platform in the code, and platform behaviour is written as a list of
three rather than as a special case plus a fallback.

| | Windows | macOS | Linux |
|---|---|---|---|
| Run from source | yes | yes | yes |
| Installer | NSIS x64 | DMG x64 + arm64 | AppImage + deb, x64 + arm64 |
| Interface modifier | `Ctrl` | `⌘` | `Ctrl` |
| Redo chord | `Ctrl+Y` | `⇧⌘Z` | `Ctrl+Y` |
| Page navigation | `Ctrl+PageUp/Down` | `⌃PageUp/Down` (`⌘` also works) | `Ctrl+PageUp/Down` |

Build them with `npm run dist`; `npm run pack` produces an unpacked directory for
the current OS only. `electron-builder` needs no extra toolchain for the targets
above.

## Keyboard

The chord shown in the app is the chord for the platform it is running on. The
help sheet (press `?`, or `Ctrl`/`⌘` + `/`) prints one table, for your OS only —
no other platform's chord is ever advertised.

| Action | Windows | macOS | Linux |
|---|---|---|---|
| New note | `Ctrl+N` | `⌘N` | `Ctrl+N` |
| Save all changed pages | `Ctrl+S` | `⌘S` | `Ctrl+S` |
| Save options and export | `Ctrl+E` | `⌘E` | `Ctrl+E` |
| Open library menu | `Ctrl+O` | `⌘O` | `Ctrl+O` |
| Undo | `Ctrl+Z` | `⌘Z` | `Ctrl+Z` |
| Redo | `Ctrl+Y` | `⇧⌘Z` | `Ctrl+Y` |
| Previous page | `Ctrl+PageUp` | `⌃PageUp` | `Ctrl+PageUp` |
| Next page | `Ctrl+PageDown` | `⌃PageDown` | `Ctrl+PageDown` |
| Zoom in | `Ctrl+=` | `⌘=` | `Ctrl+=` |
| Zoom out | `Ctrl+-` | `⌘-` | `Ctrl+-` |
| Reset zoom | `Ctrl+0` | `⌘0` | `Ctrl+0` |
| Keyboard shortcuts | `?` or `Ctrl+/` | `?` or `⌘/` | `?` or `Ctrl+/` |
| Laser pointer | `V` | `V` | `V` |
| Eraser | `E` | `E` | `E` |
| Ruler | `R` | `R` | `R` |
| Shapes and text | `G` | `G` | `G` |
| Text box | `T` | `T` | `T` |
| Pan while held | `Space` | `Space` | `Space` |
| Close panel / cancel | `Esc` | `Esc` | `Esc` |

Two details that are easy to get wrong when touching input code:

- **Page navigation is on Control everywhere, including macOS.** `⌃PageUp` is
  what the help sheet shows on a Mac; `⌘PageUp` happens to work as well because
  the handler accepts either modifier.
- **Chords a single key can express stay modifier-free.** `V`, `E`, `R`, `G` and
  `T` are bare keys, and they are ignored while a text box has focus, so typing a
  word does not switch tools.

The application menu owns `New`, `Save`, `Export`, `Zoom` and `Keyboard
Shortcuts` accelerators; the renderer owns the tool keys, undo/redo, page turns
and `Esc`. Both paths are listed above and both are covered by
`tests/shortcuts.test.mjs` for the labels.

## Ink input

| Device | Behaviour |
|---|---|
| Pen / stylus | Pressure shapes the stamp when the device reports it; a device that does not report pressure uses a neutral value. |
| Mouse | Draws with the same engine; the pointer is the pen. |
| Touch | Draws. Inking surfaces set `touch-action: none`, so a finger drag is ink rather than a scroll. |
| Trackpad | Draws on the canvas; scrolling pans the page view. |

Multi-pointer input is ignored after the first pointer is captured, so a palm
resting on a tablet does not draw a second stroke.

## Behaviour that differs per OS, and why

| Platform | Detail | Where |
|---|---|---|
| Windows (and macOS, in practice) | The compositor stops producing frames when the window is fully covered, which stalls screenshot and automation sessions. The app disables the native occlusion heuristic and keeps frame production on. | `main/main.js` |
| Windows, synced folders | OneDrive and antivirus can hold a lock for a moment, so `rename()` fails with `EPERM`/`EBUSY` inside a synced Documents folder. Renames retry with backoff and fall back to copying. | `main/library.js` |
| macOS | Interface chords use `⌘`; the shortcut sheet, tooltips and `aria-keyshortcuts` all follow the platform rather than hard-coding `Ctrl`. | `src/js/shortcuts.js` |
| Linux | The AppImage needs FUSE available on the host; where `libfuse2` is not installed, use the deb package instead. | packaging |

## Document scale and displays

Page canvases are sized in document pixels at `DOC_DPI ≈ 294.12` (a Letter page is
2500×3235 px), and the whole stack is scaled by the zoom transform rather than
re-rendered at each zoom level. On a HiDPI display the canvas is therefore
upscaled above 100% zoom, and text boxes are drawn in the ink layer with a
system-font stack that starts at Segoe UI and falls back to the platform sans
serif.

If you work on rendering, check both a 100% zoom and a fit-to-window zoom on a
scaled display, because that is where a width expressed in document pixels and a
width expressed in CSS pixels diverge.