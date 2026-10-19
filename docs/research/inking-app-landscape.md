# Inking / Handwriting App Landscape — desktop research for WriteCanvas

> **Date:** 2026-10-19 · **Type:** read-only research deliverable · **Target:** WriteCanvas (Electron rewrite of Scrble Ink)
>
> **Companion file:** `docs/research/scrble-feature-inventory.md` covers the *binary* evidence (pen system internals, 29/11/6-color palettes, paper sizes @294.117 dpi, 19 pattern + 32 planner template assets, save/export format chunks, UI class map). **This file deliberately does not repeat that content** — it fills in the public, source-able landscape: competitor features, UX interaction patterns validated by Microsoft's own docs, and a gap list for WriteCanvas. Cross-references below point into the inventory.
>
> **Method:** primary sources only (official product sites, Microsoft Store listings, GitHub README/docs, Microsoft Learn, vendor support pages). Every claim carries an inline URL. Where an official source consulted on 2026-10-19 does not mention a feature, the cell is marked **n/d** (not documented) instead of guessed.
>
> **Table legend:** ✔ documented · √ partial / platform-gated / conditional · ✖ absent or impossible by design · **n/d** not documented in the consulted source (absence of evidence ≠ evidence of absence — verify hands-on before treating it as a decisive gap).

---

## 1. TL;DR feature matrix

| # | App | Paper templates | Planner layouts | PDF import/annotate | Image insert | Photo capture | Shapes (insert) | Shape recognizer | Ink-to-text | Lasso select | Laser pointer | Ruler | Gallery/library | PDF export | Cloud sync | Pressure/palm/tilt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Scrble Ink | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | √ | ✔ |
| 2 | Inkodo | n/d | ✔ (calendar) | ✔ (raster/book) | n/d | n/d | n/d | n/d | ✔ (OCR) | ✔ | n/d | n/d | ✔ | n/d | n/d | n/d |
| 3 | Squid | ✔ | ✔ | ✔ | ✔ | n/d | n/d | n/d | n/d | √ | n/d | n/d | n/d | ✔ | n/d | ✔ |
| 4 | Goodnotes (Win) | ✔ | n/d | n/d | n/d | n/d | n/d | n/d | √ (search) | n/d | n/d | n/d | ✔ | n/d | ✔ | n/d |
| 5 | OneNote | n/d | n/d | n/d | n/d | n/d | ✔ | ✔ | ✔ | ✔ | n/d | n/d | n/d | n/d | √ | n/d |
| 6 | MS Journal | n/d | n/d | ✔ | n/d | n/d | n/d | n/d | n/d | ✔ | n/d | n/d | n/d | n/d | n/d | n/d |
| 7 | Xournal++ | √ | ✖ | ✔ | ✔ | n/d | √ | √ | ✖ | ✔ | ✖ | √ | ✖ | ✔ | ✖ | ✔ |
| 8 | Rnote | n/d | n/d | ✔ | ✔ | n/d | ✔ | n/d | ✖ | ✔ | ✖ | n/d | √ | ✔ | ✖ | n/d |
| 9 | Flexcil | n/d | n/d | ✔ | n/d | n/d | n/d | n/d | n/d | n/d | n/d | n/d | n/d | √ | ✔ | n/d |
| 10 | Drawboard PDF | ✔ | √ (student) | ✔ | n/d | n/d | n/d | n/d | n/d | n/d | n/d | √ (measure) | n/d | n/d | n/d | ✔ |
| 11 | MyScript Notes/Nebo | n/d | n/d | ✔ | n/d | n/d | ✔ | ✔ | ✔ (66 lang.) | ✔ | √ (iOS only) | √ (iOS only) | n/d | n/d | ✔ | n/d |
| 12 | CollaNote | ✔ | ✔ | n/d | n/d | n/d | ✔ | ✔ | n/d | n/d | n/d | n/d | n/d | n/d | ✔ | n/d |
| 13 | Bamboo Paper (EOL) | n/d | n/d | ✖ | n/d | n/d | n/d | n/d | n/d | n/d | n/d | n/d | ✔ | ✔ | n/d | n/d |

Footnotes:

1. Scrble row: feature presence is cross-evidenced by the public site + release notes here and the binary evidence in `scrble-feature-inventory.md` (`CameraDialog`/`PictureLayer` = photo/image, `RulerFlyout`/`RulerCanvas` = ruler, `RecognizerToolbar` = ink-to-text, `SelectionFlyout` = lasso, `Gallery.*` + page rail = gallery — inventory §5). Paper/planner counts and pixel measurements live in inventory §3 (19 pattern + 32 planner templates, 12 standard sizes @294.117 dpi).
2. Scrble PDF specifics: watermark + password-protected PDF export per release notes [scrble.com/release-notes]; PDF import per homepage [https://www.scrble.com/] with the FAQ/tutorials-documented replace limitation (§3.3 below).
3. Scrble sync: √ because it is not a server sync at all — it is the notes folder pointed at OneDrive/Dropbox/Google Drive (FAQ) and gated to the full version. [https://www.scrble.com/faq/]
4. Inkodo row is sourced from the Store listing metadata [https://apps.microsoft.com/detail/9nblggh4s50q]; PDF "as images/book" implies raster flatten on import. Anything the listing snippet doesn't state is n/d.
5. Goodnotes: ink-to-text √ = handwriting *search* is documented on the Windows page; on-canvas conversion is not asserted there. Sync: Windows/Android/Web live, iOS "coming soon"; free tier = watermark + 3-notebook limit. [https://www.goodnotes.com/windows] [https://www.goodnotes.com/pricing]
6. OneNote cloud sync √: notebook sync to a Microsoft account is intrinsic to the product but the consulted support articles don't re-state it. [support.microsoft.com OneNote help, §6 sources]
7. Xournal++: PDF annotate requires keeping the original PDF around next to the .xopp (tour). No library (single document model), no cloud, no ink recognition, no laser. [https://xournalpp.github.io/guide/whirlwind-tour/]
8. Rnote √ gallery = workspaces/tabs + draggable pages, not a file library; `.rnote = gzipped JSON` with a documented unstable-format warning. [https://github.com/flxzt/rnote]
9. Nebo: laser pointer + ruler are listed for the iOS build; the Windows "Nebo" page does not offer them → √ platform-gated. [https://www.myscript.com/nebo]
10. Bamboo Paper: ✖ for PDF *annotate* because at retirement Wacom documents notebook→PDF export only (no import/annotate). Retired from all stores 2025-12-18. [Wacom support article 36070902398231, §6]

Note on the matrix: features marked n/d were checked against the app's primary-source pages only; apps like Squid/Flexcil document features mainly in-app or in FAQ pages not scraped here. Use n/d for "unverified", never as a competitive claim.

## 2. Shortlist notes per app

### 2.1 Scrble Ink (UWP) — the app being rewritten
- Store: paid UWP app [https://www.microsoft.com/store/apps/9N5CF2MN39LV]; free tier sibling "Scrble Lite" [https://apps.microsoft.com/detail/9wzdncrd9xr] with an in-app full-version unlock (the Lite Store location is restricted to the app folder — FAQ/tutorial migration notes cover Lite→Ink moves).
- Homepage pitch (public features): auto-scroll handwriting, shape gallery + auto shape recognizer, protractor & eyedropper, PDF/image import, gallery search, automatic note naming. [https://www.scrble.com/]
- Release-history highlights: laser pointer + rectangular selection 4.0.5, shape auto-recognize 6.3.1, vertical spacer 6.8.0, eyedropper + "ink-to-line" 6.10.0, fills + side-by-side pages + zoom flyout 7.2.0, F11 fullscreen, pen 2nd-button select, max 10 pen slots, watermark/password PDF export. [https://www.scrble.com/release-notes/]
- Depth detail (internals) is in `scrble-feature-inventory.md`; full deep dive below in §3.

### 2.2 Inkodo (UWP)
- Outcome-oriented Windows note app; Store copy says: text/shape/ink selection, PDF pages imported "as images" or "as a book" for long documents, OCR, dynamic calendar pages, audio record while drawing, toast notifications + Pin to Start, slideshow mode. [https://apps.microsoft.com/detail/9nblggh4s50q]
- Pro unlock gates: custom page templates, custom book cover, saved ink containers, saved color pickers, save modified ink — i.e. even page templates are a paid feature there. [same listing]
- "PDF as images" implies raster flatten of PDFs on import; no vector-ink claim found → treat Inkodo's PDF pipeline as the raster-first competitor model.
- n/d cells on the matrix = the consulted listing text doesn't mention them, not that they don't exist.

### 2.3 Squid (Android/Chromebook-first)
- Vector ink engine at any zoom; stroke eraser (erase whole letters/words); move/resize/copy/paste; retro-editable stroke color and thickness. [https://www.squidnotes.com/]
- Paper: blank/lined/math/music/sports/planners…; sizes Letter/Legal/A4/4x6…; pages infinite by default. [same]
- Active-pen contract: pressure sensitivity, pen side button quick actions, "write with the pen and erase with your finger" — an explicit dual-input policy (i.e., structured palm handling by design). [same]
- PDF/images: import any PDF or image, combine PDFs, insert pages in between, fill out forms, sign, grade. [same]
- Share/present: export PDF/PNG/JPEG, cast to Chromecast/Miracast/HDMI, virtual whiteboard + present-on-slides. [same]
- No ink-to-text / laser / ruler / library claims on the site → n/d in the matrix.

### 2.4 Goodnotes for Windows
- Cross-platform notebook app (iPad heritage); the Windows page documents 50+ templates (incl. Cornell) and handwriting search. [https://www.goodnotes.com/windows]
- Sync: Windows/Android/Web partnerships live today; iOS cross-device sync "coming soon"; iCloud for notebooks. [same + https://www.goodnotes.com/pricing]
- Free tier: watermark on exports + 3-notebook limit. [https://www.goodnotes.com/pricing]
- PDF import/markup, laser, ruler, lasso are not asserted on the Windows page (n/d), even though GoodNotes ships most of them on iPad.

### 2.5 OneNote (Windows desktop)
- Draw tab with Lasso Select → "Ink to Text"; conversion follows proofing language for multi-language notes. [https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/take-handwritten-notes-in-onenote]
- Draw-and-Hold gesture converts ink to 11 shapes: arrow, circle, ellipse, hexagon, line, pentagon, rectangle, rhombus, square, trapezoid, triangle; while holding you can drag to resize/rotate; scratch-out erases ink (toggle in Options). [https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/ink-faster-with-gestures-for-creating-shapes-deleting-ink-and-more]
- Treated here as the UX baseline rather than a feature rival: its gesture set and text-conversion flow are the best-documented ones from Microsoft itself.

### 2.6 Microsoft Journal (Garage; Store 9N318R854RHH)
- Modeless editing is the thesis: erase via scratch-out and select via instant lasso without ever switching tools; all gestures on-device AI. [https://www.microsoft.com/en-us/garage/blog/2022/04/garage-project-journal-becomes-microsoft-journal/]
- PDF-centric reality: >50% of pages users create start life as imported PDFs. [same]
- Smart semantic ink: index of user marks (underlines, stars…) enabling faceted search; M365 calendar meeting notes; on-device AI. [same]
- Store listing still updated (12/16/2025) → alive, not retired; tracked deliberately. [https://apps.microsoft.com/detail/9n318r854rhh]

### 2.7 Xournal++ (open source; Linux/Windows/macOS)
- Journal files (.xopp) contain pages "of different formats and sizes"; annotating a PDF = PDF used as page background, and the original PDF must be kept alongside the .xopp. [https://xournalpp.github.io/guide/whirlwind-tour/]
- Tools: Pen/Highlighter/Eraser/Text/LaTeX + Select Object & Select Rectangle (8-handle scale, duplicate, delete; exactly one active selection); sidebar previews pages *and layers*. [same]
- Input model: per-device class override (mouse/stylus/touch), pressure arrives by classing a device as Stylus, temporary tool bindings on device buttons (right = eraser, middle = hand by default), touch pans by default with an opt-in "Touch Drawing" mode. [same]
- Export PDF/SVG/PNG incl. page-range options. [same]
- The guide documents dedicated geometry tools + snapping; no ink-to-text anywhere → ✖ in the matrix. [https://xournalpp.github.io/guide/]

### 2.8 Rnote (GTK4, open source; Linux/Windows)
- Vector sketchnoting; imports PDFs/images; shape tool + selection; draggable pages; workspaces; pen sounds; CLI for automation. [https://github.com/flxzt/rnote]
- File format `.rnote` = gzipped JSON and is officially documented as **unstable** across versions — a public cautionary tale for WriteCanvas's own format versioning commitment. [same]
- Export SVG/PDF/Xournal++(.xopp) — explicit interop with the Xournal++ ecosystem. [same]
- By design: no cloud sync, no file library, no ink recognition → ✖ cells in the matrix. [same]

### 2.9 Flexcil ("study" app; iPad/Android/Windows)
- PDF-first study flow: pen-gesture marks, vector ink, masking pen, stickers, reference links between documents, 1/2/4-page views, PDF edit/combine. [https://www.flexcil.com/]
- Stands out for audio: recording synced to the handwritten timeline; cloud sync across devices. [same]
- Templates/ruler/laser/ink-to-text not asserted on the site → n/d.

### 2.10 Drawboard PDF (Windows)
- PDF-first annotate tool: pressure-sensitive handwriting on PDFs and slide decks; template library incl. graph/ruled/Cornell/music, aimed at students. [https://www.drawboard.com/]
- Pro tier adds measurement/takeoff tooling (the "ruler" in its world is a measuring tool, not a drawing guide). [same]
- No notebook-gallery/HWR/laser claims on the site → n/d.

### 2.11 MyScript Notes (Nebo rebrand)
- Branding split: iOS/Android renamed "MyScript Notes"; the Windows build still ships as "Nebo". [https://www.myscript.com/nebo] [https://www.myscript.com/notes]
- Four document types: Notebook, Board (infinite canvas), Document (handwriting convert-to-text), PDF annotation. [https://www.myscript.com/nebo]
- Gestures: scratch-out to delete, hold-to-perfect shapes, lasso; laser pointer and ruler are listed on the iOS build only (√ platform-gated in the matrix). [same]
- HWR moat: 66 languages for handwriting recognition; Word/PPT imports converted as PDFs; global handwritten search; sync iCloud/Drive/Dropbox. [same + https://www.myscript.com/notes]

### 2.12 CollaNote (iPad/iPhone/Mac)
- Feature-dense free tier: 50+ pens, shape recognition, audio + handwriting sync, math solver, planner library, flashcards. [https://www.collanote.com/]
- iPad-family only; not a direct Windows competitor but a feature-velocity benchmark (its planner library + audio sync are what Scrble's wishlist asks for).
- Primary source is the vendor site; no official public repo found.

### 2.13 Bamboo Paper (Wacom — retired)
- Wacom retired Bamboo Paper (plus Wacom Notes/Inkspace items) from **all stores on 2025-12-18**. [Wacom support, retirement article 36070902398231 — https://support.wacom.com/]
- At retirement the documented capabilities are notebooks + export to PDF/PNG/JPG (the notice's export paths are the cited feature evidence; no PDF import). [same]
- Kept in the shortlist for one reason: its whole Windows user base is a migration pool for WriteCanvas.

## 3. Scrble Ink deep dive (public sources only)

### 3.1 Plans and product split
- Two Store SKUs: Scrble Ink (paid app, 9N5CF2MN39LV) and Scrble Lite (free with in-app unlock, 9WZDNCRDF9XR). Exact price points were not on the scraped listing text; the wishlist page references the "full version" for gated features. [https://www.microsoft.com/store/apps/9N5CF2MN39LV] [https://apps.microsoft.com/detail/9wzdncrd9xr] [https://www.scrble.com/wishlist/]
- Known gating from public sources: cloud-folder sync is full-version-only (FAQ), Lite's save root is restricted and Lite→Ink migration is documented as a manual folder copy of `LocalState\Scribble` (tutorial). [https://www.scrble.com/faq/] [https://www.scrble.com/tutorials/]
- Fully offline-capable per FAQ. [same FAQ]

### 3.2 Data and file model
- Public model (FAQ): each note = **one PNG per page**, named `Title#1` style; projects = **folders** under the notes root (`Scribble`). [https://www.scrble.com/faq/]
- Binary-confirmed reality (do not re-derive here): a real user note is `Untitled#01.png` at 2500×3235 (= Letter @294.117 dpi); templates/palettes/format chunks and settings keys are documented in `scrble-feature-inventory.md` §3–§5.
- Why it matters for WriteCanvas: the PNG-per-page choice is the reason Scrble gets a Windows-Explorer-native gallery for free (thumbnails, backup, drag-out a page) — that is a format decision, not just a UI decision.

### 3.3 Import / export
- PDF and image import (homepage); PDF import quality is a settings key (inventory §5). [https://www.scrble.com/] + inventory
- Export PNG/JPEG/BMP/PDF with save toggles "full page vs crop" and "with/without paper background" (inventory §4 grounds this); PDF export supports watermark + password (release notes). [https://www.scrble.com/release-notes/] + inventory §4
- Documented limitation: replacing/hot-swapping the PDF behind an imported-PDF note is clunky — the tutorial documents the "empty.pdf" workaround. [https://www.scrble.com/tutorials/]
- Custom paper = load image assets; scrble.com publishes a downloadable custom-paper page reachable from the picker's `custom.png` entry (inventory §3.4). [https://www.scrble.com/custom-paper] + inventory
- Print with continuation pages (inventory §4 `ContinuationPage`).

### 3.4 Sync model
- No proprietary cloud: point the notes folder at OneDrive/Dropbox/Google Drive and let the storage sync; FAQ explicitly warns about sync conflicts with the PNG-per-page scheme. [https://www.scrble.com/faq/]
- Gated to the full version (FAQ). [same]
- Consequence for WriteCanvas: a folder-format that survives naive cloud sync (small per-page files, no temp-file churn) is the correct niche; this is also what Xournal++ (plain files) and Rnote (files) share — only Server-style sync (GoodNotes/Journal-style accounts) diverges from it.

### 3.5 Tools and feature timeline (public + release notes)
- Pens: 5 types (marker/pencil/calligraphy/highlighter/squared-highlighter) with multi-slot pen storage (binary inventory §1), max 10 pens (release notes). [inventory §1] + [https://www.scrble.com/release-notes/]
- Modes: ink, remove, pan, text, gallery, eraser, select, view — the keyboard shortcut letters I/R/P/T/G/E/S/V in the tutorial map 1:1 to those modes. [https://www.scrble.com/tutorials/]
- Selection: lasso + rectangular selection since 4.0.5; pen barrel/2nd button triggers select; selection ops Ctrl+B/I/U (bold/italic/underline on text) and Ctrl+R = select region per tutorial table. [https://www.scrble.com/tutorials/] + [https://www.scrble.com/release-notes/]
- Shapes: gallery insert + auto recognizer (6.3.1) + fills (7.2.0). [same]
- Ink helpers: ink-to-text with preview (tutorial), ink-to-line, eyedropper (6.10.0), auto-scroll writing, writing pane, vertical spacer (6.8.0). [tutorials + release notes + homepage]
- Misc: protractor, ruler, F11 fullscreen, side-by-side pages (7.2.0), zoom flyout, gallery search, auto note naming. [homepage + release notes]

### 3.6 Settings and shortcuts (public)
- Full keyboard shortcut table: File (Ctrl+N/O/S…), Undo/Redo, nav (PgUp/PgDn), modes I/R/P/T/G/E/S/V, selection Ctrl+R/Ctrl+A/Ctrl+B/I/U, F11 fullscreen, reset layout Ctrl+Shift+R. [https://www.scrble.com/tutorials/]
- Settings keys relevant publicly: SaveLocation/folder options, export quality, autosave, PDF import quality, BackToPen/double-tap, writing-area modes (Full/Vertical/Bottom + palm guard) — grounded in inventory §5 (settings.dat keys). [inventory §5]

### 3.7 Community wishlist = a free, user-prioritized roadmap
- Top items with votes (as scraped): math/formula recognition (322), calligraphy tilt angle, text tables, per-page paper type, Android port, vector PDF export, toolbar customization, LaTeX, ink-note search (152), PDF page rotate, audio recording, layers, two-finger tap undo, PPT/Word import, drag-drop import. [https://www.scrble.com/wishlist/]
- Reading: users are voting for **recognition, structure, and layers** — not for more pens/colors. WriteCanvas can beat Scrble by shipping from day 1: two-finger tap undo, layers, per-page paper, and a searchable ink index (see §5).

### 3.8 Scrble source list
- https://www.scrble.com/ — homepage features
- https://www.scrble.com/faq/ — offline use, note/project model, sync warnings, languages
- https://www.scrble.com/tutorials/ — shortcuts table, ink-to-text flow, save location, custom templates, PDF-replace limitation, Lite→Ink migration
- https://www.scrble.com/release-notes/ — versioned feature history
- https://www.scrble.com/wishlist/ — voted gaps
- https://www.scrble.com/custom-paper — custom paper downloads
- https://apps.microsoft.com/detail/9wzdncrd9xr — Scrble Lite listing
- https://www.microsoft.com/store/apps/9N5CF2MN39LV — Scrble Ink listing

## 4. UX patterns locked down by Microsoft's own docs

These are the interaction rules WriteCanvas should honor because Windows native ink apps (and Scrble internally, per inventory §1's InkToolbar usage) are built on them.

### 4.1 Toolbar structure — InkToolbar semantics
- Default buttons in order: BallpointPen, Pencil, Highlighter, Eraser, Ruler; "tool buttons" (mutually exclusive, one active) are separated at unload points from "toggle buttons" (independent states). Second click on the *active* pen opens its flyout (colors/sizes). [https://learn.microsoft.com/en-us/windows/uwp/ui-input/ink-toolbar]
- Custom pen flyout content = InkToolbarPenConfigurationControl + a palette flyout; custom tool glyphs exist for selection (EF20) and touch-writing (ED5F); CE56 is the documented top-level "Inking" command icon. [same + https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls]
- **→ WriteCanvas:** adopt the same mental model — one active toolbar tool at a time, toggle group (ruler etc.) independent, second-click opens flyout. Scrble's own `InkToolbarCustomToolButton`/`InkModeFlyout` usage (inventory §1) proves the pattern the rewrite should keep.

### 4.2 Flyouts over dialogs (modeless by rule)
- Flyouts are light-dismiss and non-blocking; they auto-dismiss when the user picks a color/size (they don't stay open); eraser's flyout carries the destructive "Erase All Ink" command exactly once. [https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls]
- Dialogs are for blocking decisions only; everything else is a flyout. [https://learn.microsoft.com/en-us/windows/uwp/design/controls-and-patterns/dialogs-and-flyouts]
- **→ WriteCanvas:** never block the canvas behind modal color/width pickups; palette/size/eraser flyouts light-dismiss. Matches Scrble's `ColoSizeFlyout`/`TuneFlyout`/`EraserFlyout` (inventory §5).

### 4.3 Ink rendering — wet vs dry
- Windows' model: ink is "wet" (still editable) until "dried" onto the canvas layer; custom drying via IInkD2DRenderer lets an app keep rendering wet ink directly. Input device mixing (pen/touch/mouse) is opt-in on InkPresenter. [https://learn.microsoft.com/en-us/windows/uwp/design/input/pen-and-stylus-interactions]
- **→ WriteCanvas (Electron):** the same idea is trivially implementable in Chromium: a wet-stroke buffer (current stroke, rendered at pointermove with coalesced events) grabbed off the page as a "dry" stroke object appended to the page's stroke store. Keep wet rendering on its own canvas layer so the page re-restack never touches the live stroke.

### 4.4 Pointer semantics — barrel button and hit-testing
- To implement custom selection/erase, apps must handle pointer events + geometric hit-testing themselves; the same doc specifies how to override the built-in "Erase all ink" command. [https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls]
- Barrel-button selection is a **pass-through** of the system right-drag behavior (LeaveUnprocessed) so the app receives raw pointer streams for lasso geometry — exactly what Scrble maps to "pen 2nd button = select". [https://learn.microsoft.com/en-us/windows/uwp/design/input/pen-and-stylus-interactions] + [https://www.scrble.com/release-notes/]
- **→ WriteCanvas:** in Chromium the equivalent is `pointerdown` filtered by `pointerType==='pen'` + `buttons===32` (barrel/eraser-side) driving lasso; disable context menu on canvas; use `getCoalescedEvents()` for smooth stroke geometry.

### 4.5 Gestures worth copying (documented sets)
- OneNote: draw-and-hold → 11 shape conversions; drag-while-holding to resize/rotate; scratch-out erase. [https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/ink-faster-with-gestures-for-creating-shapes-deleting-ink-and-more]
- Journal: modeless scratch-out + instant lasso (no tool switch), all on-device AI. [https://www.microsoft.com/en-us/garage/blog/2022/04/garage-project-journal-becomes-microsoft-journal/]
- Xournal++: touch pans by default, opt-in touch-drawing; device-button temporary tool bindings (right = eraser, middle = pan). [https://xournalpp.github.io/guide/whirlwind-tour/]
- General touch contract: tap/drag/rotate/press-and-hold for context menus; 44×44 effective-pixel minimum hit targets; keep motion at 60 fps. [https://learn.microsoft.com/en-us/windows/uwp/design/input/touch-interactions]
- **→ WriteCanvas:** the modeless trio (scratch-out, instant lasso, draw-and-hold shapes) plus Xournal++'s per-device input classes cover the full modern gesture expectations; Scrble's two-finger-undo wishlist item slots into the same handler.

### 4.6 Documents and pages
- Xournal++ keeps pages **and** layers visible in a sidebar-first structure — the best documented structural pattern in the free/open field. [https://xournalpp.github.io/guide/whirlwind-tour/]
- Journal's data analysis (>50% pages from imported PDFs) is the flagship proof that **PDF annotation is the dominant entry prism** for Windows inking. [garage blog]

## 5. WriteCanvas gap list → Electron/Canvas implementation notes

Reading the matrix + the Scrble wishlist: WriteCanvas inherits Scrble's depth (paper system, templates, modes) but should close the gap in three bands. "Closest pattern" = the app whose documented behavior we copy.

### P0 — parity gaps that block adoption
| Gap | Why it matters (evidence) | Closest pattern to copy | Electron/Canvas note |
|---|---|---|---|
| PDF import/annotate | >50% of Journal pages start as PDFs; Drawboard/Flexcil/GoodNotes/Nebo all center on it; Scrble's own import exists but the replace flow is a documented pain (empty.pdf trick). | Xournal++ (PDF as page background, source kept side-loaded) | pdf.js renders each page to an offscreen canvas used as the page background layer; store the PDF + page index in the note manifest; support swapping the source PDF (fix Scrble's pain). |
| Lasso + move/resize/paste | OneNote/Nebo/Journal/Squid all ship it; inventory §5 confirms Scrble has `SelectionFlyout` | Journal modeless (instant lasso) + OneNote semantics | polyline segment hit-test over stroke geometry (§4.4); selection rect with 8 handles + live move (Xournal++ rules); keep exactly one active selection. |
| Shape recognizer + shape gallery | Scrble does both (6.3.1 + gallery); OneNote's draw-and-hold is the reference gesture; users won't re-draw amorphous shapes. | OneNote draw-and-hold (11 shapes) | post-stroke analysis: corner detection + circle/ellipse fit → replace stroke path with vector primitive; preview-accept UI like OneNote; separate gallery insert path for pre-built shapes. |
| Laser pointer | trivial demo value; Scrble 4.0.5, Nebo has it (iOS). | Scrble | dedicated overlay canvas; strokes drawn there decay after ~1.5 s (per-segment TTL); never persisted. |
| Ink-to-text | Scrble/OneNote/Nebo/Inkodo all have it; Scrble even routes the converter through a preview step (tutorial). | OneNote "Ink to Text" preview-then-replace | start cheap: text boxes + typed text integrated with the same selection flow (Scrble parity); real HWR later — see P2 note on engines (Windows HWR isn't exposed to Chromium; options are bundled engine or online API). |
| Palm/palm-rejection + pressure/tilt | pressure documented for Scrble (inventory §1 get_Pressure/IgnorePressure) and Squid; palm handling = pen-first input policy. | Squid's explicit write-with-pen/erase-with-finger contract | pointer events: on first pen contact, ignore all `touch` pointers until pen leaves; `event.pressure`/`tiltX`/`tiltY` are native on PointerEvent; scrub system palm rejection needs the pen-only mode toggle (Scrble's BottomPalmGuard setting in inventory §5 is the same contract). |
| Keyboard shortcuts parity | Scrble users have muscle memory (tutorial table). | Scrble full table (I/R/P/T/G/E/S/V mode letters, F11, Ctrl+Shift+R) | pure Electron accelerators; no conflict with Chromium defaults (prevent via keydown before default). |
| Cloud-folder sync | Scrble FAQ model is the right niche today; GoodNotes account sync hurts offline trust. | Scrble FAQ + journal files (Xournal++/Rnote) | one small file per page = merge-friendliness; don't create lock/read-only whole-note junk; emit atomic write + rename per save so OneDrive conflicts stay rare. |

### P1 — differentiators Scrble users are already voting for
| Gap | Evidence | Closest pattern | Electron note |
|---|---|---|---|
| Two-finger tap undo | Scrble wishlist; iPad-standard pattern (all iPad-class apps incl. CollaNote ship it) | iPad-standard two-finger tap undo | touch pointer pair that taps within 150 ms and <30 px → undo stack pop; no pen involved. |
| Layers | Scrble wishlist (absent today); Xournal++ sidebar ships it; Rnote stores vector docs | Xournal++ sidebar (pages + layers) | page model = ordered stroke array per layer; z-index reorder is then free; the imported PDF stays as a dedicated background layer. |
| Per-page paper type | Scrble wishlist; Squid ships per-page paper+size; Xournal++ pages have independent format. | Squid (variety of paper types/sizes per page) | page object holds its own template id + background color + size in manifest; templates must be procedural (see inventory §3) so per-page mixes don't multiply assets. |
| Ink-note search | Scrble wishlist (152 votes); Journal's smart semantic ink is the showcase | Journal faceted search of user marks | phase 1: index typed text + recognized text; phase 2: index shape primitives; real semantic ink (stars/underlines) can ride the same JSON model — store mark *class* on strokes. |
| Audio recording synced to writing | Flexcil/CollaNote/Inkodo all ship it; Scrble wishlist wants it | CollaNote/Flexcil sync model | record via WebAudio → save alongside page + timestamp markers aligned to stroke timestamps (stroke objects already need timestamps for undo/replay). |
| Toolbar customization | Scrble wishlist (`PenButtonGrid` is hard-coded in binary) | UWP InkToolbar editable layout / Xournal++ configurable toolbar | toolbar = persisted JSON layout (tool list, order, pinned states); resets via Ctrl+Shift+R-equivalent. |
| Vector PDF export | Scrble wishlist; Scrble's export is raster-only today; SVG export becomes free if strokes are stored as vectors. | Xournal++ export (PDF/SVG/PNG page ranges) | with a vector-first page store (see the format note below), SVG export is native and SVG→PDF export rides the existing Chromium print pipeline. |
| LaTeX / math input | Scrble top wishlist item (322 votes for math recognition); Xournal++ ships a LaTeX tool | Xournal++ LaTeX tool (formula → image element) | KaTeX render to an element snapshot; recognition comes later (P2). |
| PPT/Word import; drag-drop import | Scrble wishlist; Nebo converts Word/PPT as PDF | Nebo (convert as PDF path) | implement at manifest level: file→pdf.js→page background stream; drag-and-drop shares the same entry. |

### P2 — long-shot / later
| Gap | Note |
|---|---|
| Real math/HWR recognition | The heavy item: Windows HWR is not exposed in Chromium. Realistic ladder: typed text → bundled recognizer (MyScript-class license or on-device ONNX model) → math later. Don't block P0 on it. |
| E-book format (Nebo's "Document") | Full-document handwriting conversion is a whole separate product; keep it out of v1. |
| Presentation mode (Inkodo slideshow / Squid cast) | Electron supports display casting cheaply; niche. |

### Format recommendation (the decision that gates everything above)
- **Vector-first stroke JSON per page** (Rnote's `gzipped‑JSON` model, but with a *committed, versioned* schema — Rnote itself warns its format is unstable, and Scrble's PNG-per-page shows the opposite trade: zero tooling for search/layers/editing).
- Keep **PNG thumbnails per page** generated at save (Scrble's intensity: the Explorer-native gallery is a feature, and it doubles as cheap cloud-sync thumbnails + universal export fallback).
- One folder per project (Scrble FAQ projects = folders) so cloud-folder sync continues to work the Scrble way.
- [https://github.com/flxzt/rnote] + [https://www.scrble.com/faq/] + inventory §3–§4 for the format background.

## 6. Primary-source index

Scrble: [https://www.scrble.com/](https://www.scrble.com/) · [https://www.scrble.com/faq/](https://www.scrble.com/faq/) · [https://www.scrble.com/tutorials/](https://www.scrble.com/tutorials/) · [https://www.scrble.com/release-notes/](https://www.scrble.com/release-notes/) · [https://www.scrble.com/wishlist/](https://www.scrble.com/wishlist/) · [https://www.scrble.com/custom-paper](https://www.scrble.com/custom-paper) · [https://www.microsoft.com/store/apps/9N5CF2MN39LV](https://www.microsoft.com/store/apps/9N5CF2MN39LV) · [https://apps.microsoft.com/detail/9wzdncrd9xr](https://apps.microsoft.com/detail/9wzdncrd9xr)

Competitors: [https://apps.microsoft.com/detail/9nblggh4s50q](https://apps.microsoft.com/detail/9nblggh4s50q) (Inkodo) · [https://www.squidnotes.com/](https://www.squidnotes.com/) · [https://www.goodnotes.com/windows](https://www.goodnotes.com/windows) · [https://www.goodnotes.com/pricing](https://https://www.goodnotes.com/pricing) · [https://www.flexcil.com/](https://www.flexcil.com/) · [https://www.drawboard.com/](https://www.drawboard.com/) · [https://www.myscript.com/nebo](https://www.myscript.com/nebo) · [https://www.myscript.com/notes](https://www.myscript.com/notes) · [https://www.collanote.com/](https://www.collanote.com/) · [https://xournalpp.github.io/](https://xournalpp.github.io/) · [https://xournalpp.github.io/guide/whirlwind-tour/](https://xournalpp.github.io/guide/whirlwind-tour/) · [https://github.com/flxzt/rnote](https://github.com/flxzt/rnote) · [https://www.microsoft.com/en-us/garage/blog/2022/04/garage-project-journal-becomes-microsoft-journal/](https://www.microsoft.com/en-us/garage/blog/2022/04/garage-project-journal-becomes-microsoft-journal/) · [https://apps.microsoft.com/detail/9n318r854rhh](https://apps.microsoft.com/detail/9n318r854rhh) (Journal) · Wacom support retirement article 36070902398231 ([https://support.wacom.com/](https://support.wacom.com/))

OneNote: [https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/take-handwritten-notes-in-onenote](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/take-handwritten-notes-in-onenote) · [https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/ink-faster-with-gestures-for-creating-shapes-deleting-ink-and-more](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/ink-faster-with-gestures-for-creating-shapes-deleting-ink-and-more)

Microsoft Learn: [https://learn.microsoft.com/en-us/windows/uwp/ui-input/ink-toolbar](https://learn.microsoft.com/en-us/windows/uwp/ui-input/ink-toolbar) · [https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls](https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls) · [https://learn.microsoft.com/en-us/windows/uwp/design/input/pen-and-stylus-interactions](https://learn.microsoft.com/en-us/windows/uwp/design/input/pen-and-stylus-interactions) · [https://learn.microsoft.com/en-us/windows/uwp/design/input/touch-interactions](https://learn.microsoft.com/en-us/windows/uwp/design/input/touch-interactions) · [https://learn.microsoft.com/en-us/windows/uwp/design/controls-and-patterns/dialogs-and-flyouts](https://learn.microsoft.com/en-us/windows/uwp/design/controls-and-patterns/dialogs-and-flyouts)

Local: `docs/research/scrble-feature-inventory.md` (binary-verified internals — pen system, palettes, paper asset metrics, save/export formats, UI class map).
