# Scrble Ink — toolbar surfaces vs. hidden actions (v6.8.6.0)

**Date:** 2026-10-22 · **Target:** installed UWP `10511ClaudiaWey.inknotespro` v6.8.6.0 · **Read-only; no notes changed.**

**Evidence:** four research docs, screenshots/UIA in `%TEMP%\opencode\scrble-shots`, carved XBF from `resources.pri`, scrble.com. Binary = 6.8.6.0; web notes through 7.3.6 labelled.

## Verdict

Scrble uses **“direct tool, hidden variant.”** Major tools have permanent buttons; variants live in flyouts. File actions break the pattern: **Save** opens a naming/project flyout, while **Export/Print/Share** live in **hamburger → Actions** plus shortcuts. Page management is in the rail menu.

WriteCanvas puts Export behind **Save → Options** — neither Scrble parity nor discoverable: Scrble’s “Options” is the *save-options* expander. That is the bug.

## 1. Evidence table

| # | Claim | Surface | Source |
|---|---|---|---|
| 1 | Save opens a flyout; it is not a silent one-click save | Flyout | `scrble-shots/06-save.png`; `xbf86.bin` (`SaveFlyout`); `scrble-feature-inventory.md:109` |
| 2 | Save flyout = Title, Project, Options, Save | Flyout | `xbf86.bin` (`_noteTitleTextBox`, `_projectComboBox`, `_optionsLabel`, `OptionsButton`, `SaveButton`); `06-save.png` |
| 3 | “Options” expands Full Page / Paper Background save options — not export | Flyout sub-panel | `xbf86.bin` (`_optionsStack`, `_optionsLabel`, `_fullPageToggle`, `_paperBackgroundToggle`); collapsed in screenshot. **Inference** |
| 4 | Export/Print/Share live in hamburger → **Actions**, not toolbar; direct `Ctrl+E`/`Ctrl+Shift+E`/`Ctrl+P` shortcuts exist | Menu + keyboard | `13-hamburger-uia.txt:65-67` (only top-level `Actions`); `xbf106.bin`; https://www.scrble.com/faq-items/what-are-scrble-keyboard-shorcuts/ |
| 5 | Multi-page selection exposes ExportPDF / Share / Email / Print | Contextual toolbar | `xbf95.bin` (`PageSelectionToolbar`); releases 6.3.1, 6.4.0 |
| 6 | Eraser always visible; variants Stroke + Segment S/M/L in `EraserFlyout` | Toolbar + flyout | `99-uia-dump.txt:45-49`; `xbf100.bin`; `scrble-feature-inventory.md:154` |
| 7 | Select always visible; variants Lasso + Rectangular in `SelectionFlyout` | Toolbar + flyout | `xbf84.bin`, `xbf85.bin`; `scrble-behavior-deep-dive.md:153` |
| 8 | `MoreArrow` at the bottom of each tool button is **decorative**, not a separate hit target: left-click anywhere on the button toggles the tool. **Right-click** opens the tool flyout (verified for Ruler; the shared `MoreToggleButtonStyle` suggests the same pattern elsewhere) | Toolbar | `xbf89.bin` (`MoreToggleButtonStyle`, `MoreArrow`); UIA of Ruler button; `ruler-rightclick.png`; `scrble-ruler-page-logic-2026-10-23.md` §2.4 |
| 9 | Ruler always visible; `RulerFlyout` (right-click) offers Ruler/Protractor; the ruler is a viewport-level overlay, not a page guide | Toolbar + flyout | `xbf88.bin`, `xbf89.bin`; `ruler-rightclick.png`; `ruler-live.png`; `scrble-ruler-page-logic-2026-10-23.md` §2 |
| 10 | Page nav: thumbnail rail + tap-to-jump; rail menu Insert/Duplicate/Delete/Refresh/Select Pages; `PageUp`/`PageDown`; scroll-past-end auto-appends; no visible `+` | Rail / canvas / keyboard | `xbf71.bin`; `scrble-pages-ux-2026-10-20.md:11,21,23-25`; official shortcuts |
| 11 | Title + page count visible; title-tap rename and page-counter flyout are 5.2.0/7.x, not verified in 6.8.6 | Toolbar + flyout (drift) | `99-uia-dump.txt:16-17` (both `TextBlock`); releases 5.2.0, 7.2.0 |
| 12 | WriteCanvas’s Save flyout has the same shape, but **Options opens export**; autosave runs 1.4 s after edits | Flyout | `src/index.html:129-141`; `src/js/editor.js:1770-1775,2726,2732-2733,2551-2560` |

## 2. Observed Save / Export flow

1. Click floppy (`_SaveButton`, `99-uia-dump.txt:10`) → flyout with **Title / Project / Options / Save** (`06-save.png`).
2. This is a naming/project dialog, not the save mechanism. Autosave is default (disable in Settings, releases 1.3.8/1.3.9); progress bar + disabled Save during autosave (1.3.1). In `06-save.png` the inner **Save** is greyed because the note is already saved.
3. Export is not here. Path: **hamburger → Actions → Export PDF / Export folder / Email / Share / Print / Explore save location**. UIA shows only the top-level `Actions` row; commands are in `xbf106.bin`. **Inference:** secondary menu.
4. Shortcuts: `Ctrl+E` PDF, `Ctrl+Shift+E` folder, `Ctrl+P` print. Multi-page: rail → **Select Pages** → toolbar with ExportPDF/Share/Email/Print (`xbf95.bin`).

**Conclusion:** save is background autosave; the floppy is “name/project/save options.” Export is a menu command with a direct shortcut, not inside Save.

## 3. Observed Eraser / Selection surfaces

- **Always visible:** eraser and select icons, each with a small `MoreArrow` chevron at the bottom edge; **no text label, no current-mode label** (`99-uia-dump.txt:45-49`; `01-main.png`).
- **Direct click:** activates the tool with its last-used mode (standard UWP InkToolbar; observed activation).
- **Hidden variants:** `EraserFlyout` = Stroke + Segment Small/Medium/Large (`xbf100.bin`); `SelectionFlyout` = Lasso + Rectangular (`xbf84/85.bin`).
- **Affordance problem:** left-clicking the active tool or its `MoreArrow` **toggles** the tool; it does not open the flyout. The 2026-10-23 check found the gesture: **right-click** opens `RulerFlyout`. Variants are still undiscoverable by left-click alone. **Open:** whether right-click opens `EraserFlyout` / `SelectionFlyout` too.
- **WriteCanvas contrast:** shows `Eraser · Stroke` / `Select · Lasso` sublabels plus a 14 px chevron (`src/index.html:73-80`) — more discoverable, but still 3 clicks to change mode.

## 4. Page navigation surfaces

- **Always visible:** left thumbnail rail (current page highlighted), title-bar page counter, scrollbar. Rail opens by default; tap-to-jump documented (6.2.21.2).
- **Direct:** tap thumbnail, `PageUp`/`PageDown`, arrows/wheel, `Ctrl+wheel` zoom; scroll past bottom auto-appends one blank page (`scrble-pages-ux-2026-10-20.md:11,27`).
- **Hidden:** Insert/Duplicate/Delete/Refresh/Select Pages/Clear Selection in rail menu (`xbf71.bin`); multi-page actions in `PageSelectionToolbar`; page-counter tap flyout (5.2.0/7.2.0, not verified in 6.8.6).
- **Absent:** no always-visible `+`, no page-turn swipe, no pull-to-add (`scrble-pages-ux-2026-10-20.md:11,28`).

## 5. Recommendations (defaults intact: Lasso, Stroke eraser, Ruler guide)

| Priority | Control | Today | Pull out to | Why |
|---|---|---|---|---|
| **P0** | Save | Toolbar → flyout → Save | **One-click silent save** for a named note; chevron for “Note details” (title/project) + save options | Autosave already writes after 1.4 s (`editor.js:1770-1775`); the flyout is metadata, not saving. |
| **P0** | Export | Save → **Options** → menu | **Visible “Export” split button**: default **PDF**, chevron = PNG/JPEG/GIF/project; Print/Share in overflow | Terminal action; should not live inside a save dialog. Matches Scrble’s `Ctrl+E`/`Ctrl+P`. |
| **P0** | Eraser mode | `Eraser · Stroke` + tiny chevron → flyout | **Segmented control** when active: `Stroke │ Segment`; `S M L` inline for Segment; Sheet/Drag in overflow | High-frequency action; current mode is visible but switching is 3 clicks. Keep Stroke default. |
| **P1** | Select mode | `Select · Lasso` + tiny chevron → flyout | **Segmented control** when active: `Lasso │ Rect`; keep Lasso default | Same hidden-state problem; a two-state toggle is enough. |
| **P1** | Rename / project | Title click; Project only in Save flyout | **Project chip** next to title (click → picker); title click stays rename | Metadata should not be coupled to Save; mirrors Scrble’s fields without the trap. |
| **P1** | Page navigation | Thumbnails + `‹ + ›` already visible | Add clickable **page chip “3/12”** for jump-to-page; keep insert/duplicate/delete in thumbnail menu | Makes the counter affordance explicit (7.x adds this). Do not add a permanent toolbar `+`. |
| **P2** | Save options | Inside Save flyout | Keep in a **“Save options”** flyout under Save’s chevron: Full page / Paper background | Low frequency; exactly Scrble’s `Options` role. |
| **P2** | Pen / paper / help | Flyouts / menu | **Keep as-is** | Correct progressive disclosure. |
| **P2** | Print / Share | Not implemented in WriteCanvas UI (`main.js:333-380` PDF only) | If added, put in Export overflow | Keep the main row for creation tools. |

**Target row (left → right):** Menu · **Save** (one-click) · Save-details chevron · Undo · Redo · New · Title + **Project chip** + **Page chip** · pens · quick colors · **Eraser split (Stroke/Segment)** · **Select split (Lasso/Rect)** · Ruler · Shapes · Pan · **Export split**. Keeps Scrble’s tool order and visual language.

## 6. Observations vs. inferences vs. unknowns

**Observed:** toolbar inventory/rects (`99-uia-dump.txt`); Save flyout layout (`06-save.png`); no flyout on chevron/active-tool click (`final-report.md:39,63,109`; 2026-10-22 check); page rail and auto-append (prior live test); WriteCanvas source wiring.

**Inferred:** `OptionsButton` expands `_optionsStack` (field names + collapsed screenshot); `Actions` contains export/print/share (top-level UIA + `xbf106.bin`); eraser/selection flyout invocation by re-clicking the active tool (standard InkToolbar, not reliably observed).

**Unknown:** exact 6.8.6 title-tap/page-counter behaviour (UIA exposes `TextBlock`s); whether right-click opens `EraserFlyout` / `SelectionFlyout` (verified for Ruler only); whether 7.x changed the toolbar; Share/Print support on every Windows build.

**Version drift:** binary/live checks are **6.8.6.0 (2021)**; web release notes run to **7.3.6 (2023)**. `ui-parity-scrble.md:18-31` describes an older/partial toolbar (no right-side S/ruler/object/eraser/select/eye); live 6.8.6 UIA includes them. WriteCanvas is an Electron reimplementation, not the UWP binary.

## Sources

Inline citations above give exact files/lines. Main artifacts: `docs/research/*`; `%TEMP%\opencode\scrble-shots` (`06-save.png`, `99-uia-dump.txt`, `13-hamburger-uia.txt`, `final-report.md`); `appx-x\resources.pri` + carved `xbf71/84/85/86/88/89/95/100/106.bin`; WriteCanvas `src/index.html`, `src/js/editor.js`, `main/main.js`. Official: https://www.scrble.com/faq/ · https://www.scrble.com/faq-items/what-are-scrble-keyboard-shorcuts/ · https://www.scrble.com/release-notes/ · https://www.scrble.com/6-2-21-2/ · https://www.scrble.com/7-2-0/

---

## Addendum — 2026-10-23: right-click is the flyout gesture

**Status:** corrects rows 8–9 and the “Unknown: long-press/right-click” line. Live, read-only check on the same 6.8.6.0 install (HWND `657034`); no note content changed.

### What was observed

| Input | Result |
|---|---|
| Left-click Ruler button body (1616, 74) | Ruler band **on**; button checked |
| Left-click the `MoreArrow` strip at the bottom of the same button (1645, 95) | Ruler band **off**; **no flyout**. The arrow is part of the same toggle hit target, not a separate chevron button |
| **Right-click** Ruler button (1616, 74) | `RulerFlyout` opens at `(1520,40,190,147)`; `_Ruler` and `_Protractor` are `ToggleButton`s |
| Click `Protractor` row (1600, 153) | Mode becomes Protractor; flyout closes |
| Click Ruler button body | Protractor stencil appears; button checked |
| `P` | Stays in Protractor mode (no visibility change observed) |
| `R` | Switches back to Ruler mode |

### What it changes

- **Row 8 was wrong in its implication.** The `MoreArrow` is not a dead affordance; it is decoration on a normal toggle button. The real hidden gesture is **right-click**.
- **Row 9 gains the interaction detail.** `RulerFlyout` is not opened by left-click. It is a context menu on the Ruler button.
- **Mode ≠ visibility.** In `ruler-rightclick.png` the band is off, yet the `Ruler` row is checked. `_currentRulerMode` persists separately from `IsChecked`/visibility.
- **XBF/DLL corroboration:** `RulerButton.xbf` has `_Button` + `MoreToggleButtonStyle` + `_Flyout`; `RulerFlyout.xbf` has `_Ruler` + `_Protractor`; DLL has `_Button_Click`, `_Button_RightTapped`, `RulerFlyout_Updated`, `_ApplyRulerMode`, `_currentRulerMode`.

### Still open

- Does right-click open `EraserFlyout` / `SelectionFlyout` / `InkModeFlyout` too? The shared `MoreToggleButtonStyle` suggests yes, but only Ruler was verified.
- Does `P` turn the stencil on when it is currently off? Not tested.
- Does the flyout open on long-press (touch/pen) as well as right-click? Not tested.

**Full evidence, XBF/DLL offsets, and WriteCanvas mapping:** `docs/research/scrble-ruler-page-logic-2026-10-23.md`.
