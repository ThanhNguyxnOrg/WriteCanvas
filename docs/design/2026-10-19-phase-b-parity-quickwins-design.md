# WriteCanvas — Phase B design: strict parity + invisible quick wins

> **Date:** 2026-10-19 · **Status:** approved in chat (user picked "Parity 100% Scrble trước" + approach A)
> **Context:** after Phase A steps 4–5 (flyouts, shapes/text/lasso/object/images). Companion research:
> `docs/research/inking-app-landscape.md` (primary-source survey), `docs/research/scrble-feature-inventory.md` (binary evidence).

## 0. Decision record

* **Goal order:** mirror Scrble Ink's surface 100% before any visible deviation (user decision).
* **Approach A (chosen):** parity-first sequencing; interleave three *invisible* quick wins that change no UI chrome (Q1–Q3 below) right after Phase A step 5.
* **Deferred (non-goals):** dark mode, own cloud-sync backend (sync = the notes folder pointed at OneDrive/Dropbox, like Scrble's FAQ-documented model), iOS.

## 1. Quick wins (no UI change) — install immediately after step 5

### Q1 Two-finger tap undo
* Detect: two active touch pointers, tap duration < 250 ms, move < 12 px → `undo()`.
* Must not fire when an inking pointer is down; cancel on palm rejection paths (Q2).

### Q2 Pen-first input pipeline
* Pointer policy: a `pen` pointer suppresses `touch` pointers for inking while it is active (`penActive` window); palm contact over the canvas never generates strokes.
* Use `event.pressure`, `tiltX/tiltY` in the pen engine's stamp geometry (pencil/calligraphy respond to tilt, marker ignores it) — rendering already alpha/mask based (pen.js v2).
* Smooth via `getCoalescedEvents()` on move.
* Setting toggle "Palm Guard" in the Settings page (default ON), mirroring Scrble's `BottomPalmGuard`.

### Q3 Per-page paper exposure
* `sLYT` already stores paper per page; the paper panel applies to the current page only (verify against original 04-tune behavior before adding any scope note — do NOT invent a "whole note" toggle).

## 2. Parity features ordered by the original surface

| # | Feature | Key facts from evidence | Implementation notes |
|---|---------|------------------------|----------------------|
| P1 | Ruler, laser, eye, object insert | `RulerFlyout`/`RulerCanvas`, laser in release 4.0.5, `_ObjectButton` in UIA dump | Ruler = guide overlay constraining stroke projection; laser = timed fade strokes on liveC; object insert = image/photo dialogs (step-5 primitives reused) |
| P2 | Recognizer stack (staged) | `RecognizerToolbar`, shape auto-recognize 6.3.1, "ink-to-line" 6.10.0 | (a) shapes gallery insert → (b) auto shape recognize → (c) ink-to-text with OneNote-style preview-then-replace → (d) math last. Windows HWR is not exposed to Chromium — stages (c)/(d) need a native module or WASM recognizer; do not block P1–P5 on it |
| P3 | Planner templates ×32 | 32 planner assets (inventory §3) | Same renderer as pattern templates; rail gets date logic for planner notes |
| P4 | Gallery home grid + search | `Gallery.*` classes; "gallery search" on homepage | Home screen grid of note PNGs (thumbnails are the files themselves), filename + title search |
| P5 | Hamburger menu real actions | UIA dump item list | Browse → gallery screen; Import File → PDF/PNG/image dialogs; Capture Photo → camera dialog; Actions flyout; Full Screen = F11 toggle; Settings/Help pages |
| P6 | PDF import/annotate (pdf.js) | Largest item; PDF starts >50% of MS Journal pages per research; Scrble has a documented "empty.pdf replace" pain | Raster PDF pages as page backgrounds at DOC_DPI; keep the source PDF associated for re-render/export; export already watermarked-PDF ready |
| P7 | Scrble 6.x–7.x extras | eyedropper + protractor + fills + side-by-side pages + zoom flyout + F11 (release notes) | Order after P5, before/after P6 as effort allows |

## 3. UX polish (applies throughout, parity-safe)

* `:focus-visible` on every interactive element (2px black, -2px offset — current toolbar pattern).
* Hover/active transitions 150–300 ms.
* Touch spacing ≥ 8 px inside flyouts (toolbar gap 4 px is parity-locked — do not change).
* Contrast ≥ 4.5:1 for text; ≥ 3:1 for control boundaries.
* `prefers-reduced-motion`: disable flyout/undo/pop animations.
* Icons: SVG symbol sprites only (already in place); no emoji.

## 4. QA per item (every feature = 1 commit)

* Smoke harness green before every commit (`scripts/smoke-cdp.mjs`).
* Engine features get an in-app measurement script like `pen-engine-check.mjs`.
* Visual features get a `snap-cdp.mjs` shot compared against the matching original screenshot in `scrble-shots/`.

## 5. Sequencing snapshot

```
Phase A (now): step 4 flyouts → step 5 shapes/text/lasso/object/images
After step 5:  Q1 + Q2 + Q3 (invisible)
Phase B:       P1 → P3 → P4 → P5 → P7 → P6(PDF) → P2(c)/(d)
```
Rationale: recognition services (high effort, Chromium-limited) go last; file/gallery/menu surfaces fill the app before them.
