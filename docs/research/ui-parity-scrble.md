# UI parity evidence — Scrble Ink (extracted via PrintWindow capture of the installed app)

Source of truth: window capture `scrble-ui.png` (PrintWindow / PW_RENDERFULLCONTENT,
HWND of the running UWP app, 15/10/2026) + assets from the extracted `.appx`
(`C:\Users\Admin\AppData\Local\Temp\opencode\scrbleink-extract`). Pixel values were
sampled with `System.Drawing.GetPixel`. Screenshots contain only the test note
("BA CD" practice lettering) — nothing personal.

## 1. Chrome

| Region | Value (sampled) | Notes |
|---|---|---|
| Title bar | caption text "Untitled (1/2) - Scrble Ink", small, dark gray on white | standard UWP title bar, page counter format `name (cur/total)` |
| Toolbar row | bg `#F3F3F3` | plain flat icon row, no separators |
| App canvas viewport | `#FFFFFF` (full bleed, no dark surround) | the paper is essentially the app background |
| Sidebar (page rail) | bg `#F2F2F2`, selected page block `#01579B` | thumbnails + page number, selected = navy card |

## 2. Toolbar inventory (left → right)

1. hamburger ☰ (menu, black outline focus box in capture)
2. floppy / Save glyph (Segoe MDL2 `E74E` shape)
3. Undo (E7A7 shape), Redo (E7A6 shape)
4. clipboard-with-document glyph (E8C8-ish shape)
5. single-document glyph (new page, E7C3-ish shape)
6. vertical sliders glyph (settings, E713 shape)
7. **center**: note title "Untitled (1/2)" as plain text
8. **right side**: black filled circle button (current-tool indicator) then the
   quick color dots, then a large filled black circle (current ink color) and a
   tiny accent dot at the far right edge

Icons rendered flat, solid black on the light row, ~20px, no containers.

## 3. Quick color row (pixel-verified)

| # | Hex |
|---|---|
| 1 | `#FF0000` |
| 2 | `#004DE6` |
| 3 | `#26E600` |
| 4 | `#FFFB0A` |
| 5 | `#32FF5C` |
| 6 | `#2EF0FF` |
| 7 | `#000000` |

`#FFFB0A`, `#32FF5C`, `#2EF0FF` match the BGRA entries decoded from the app's
`settings.dat` earlier (docs/ANALYSIS.md §4) — the quick row is the first 7 of the
32-color palette (first visible 7; the full palette opens in a flyout).

## 4. Paper geometry (portrait Letter on screen)

| Item | Measured | Conversion (page ≈1232 screen px for 216 mm ⇒ 1.987 doc/screen, 11.34 doc px/mm) |
|---|---|---|
| Ruled line color | `#B3DCFE` (2px antialiased run) | doc line ≈ 2.8 doc px ≈ 0.25 mm |
| Ruled step | 36.0 screen px line-to-line | ≈ **6.35 mm (1/4 inch)** |
| Margin line color | `#C87B94` (blended, 1px core; antialiased pink-red) | margin x ≈ 76 screen px from paper edge ⇒ ≈ **12.7–13.3 mm** |
| Paper top gap | 13 screen px below toolbar | small breathing room, page drop shadow barely visible |
| Title strip | dashed rectangle `TITLE` label, top of page, in-page | editing overlay, not part of ruled template asset |

Ruled spacing = 1/4" and margin ≈ 0.5" — classic school notebook layout.

## 5. Assets inventory (from .appx)

- `Assets/Help/*.png` — tiny illustrations (Colors.png = 7 quick colors as circles;
  Button.png = hand-drawn green rounded rect; near-white on purpose).
- `Assets/Images/*` — flat glyphs: eraser (light gray rounded rect), laserpointer
  (red glow dot), `return` (solid Microsoft-blue return arrow), shapes/lines/
  polygon/stars, left/right arrows — the shape-tools icon family.
- `Assets/Paper/{Portrait,Landscape,Square}/…` — **no ruled/grid/black templates**
  in the shipped appx (only planner sheets: daily/monthly/yearly/fitness/…), so
  the basic shipped templates must be drawn procedurally (our approach already).
- `Assets/scrble.ttf` — bundled font (handwritten-style display font, used in
  marketing/empty states, not the UI font).
- UI font is the system font stack (Segoe UI light theme, per UWP defaults).

## 6. Layout conclusions for WriteCanvas

- Whole-chrome light theme; NO dark sidebar, NO bottom page strip.
- Page rail lives on the LEFT (thumbnails w/ numbers); hamburger opens the
  library flyout (folders/notes) — the tree panel is transient, not docked.
- Toolbar: left icon cluster (menu/save/undo/redo/clipboard/new page/settings),
  centered title, right cluster = tool indicator + quick palette + big current
  color circle.
- Canvas = white viewport, paper nearly full-bleed, dashed title overlay on top.
