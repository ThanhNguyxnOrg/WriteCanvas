# Scrble Ink (UWP) — adding and navigating pages

**Date:** 2026-10-20 · **Scope:** original Scrble Ink UWP page UX, for WriteCanvas parity · **Read-only research; no app source changed.**

**Artifacts used:** extracted appx `10511ClaudiaWey.inknotespro` v6.8.6.0 (temp `appx-x`), `InkNotes.dll` metadata strings, `resources.pri` strings, carved XBF, in-app UIA dump/screenshots, local test note, official scrble.com pages. Binary evidence is v6.8.6.0; web release notes run to 7.3.6, so newer-only features are labelled.

**Live check:** installed Scrble Ink v6.8.6.0 on 2026-10-20, existing 2-page local note, mouse-wheel scroll and `PageDown`; screenshots in `%TEMP%\opencode\scroll-test-*.png`. No ink was written; the note folder was restored from backup afterwards.

## Verdict

Scrble is **not an infinite canvas**. It is a **continuous vertical stack of discrete, fixed-size pages** inside one `ScrollViewer`. A new blank page is appended **when the view is scrolled past the bottom of the last page**; the user does not press “add page” for the normal writing flow. A live check on v6.8.6.0 (2026-10-20) went `2/2 → 3/3 → 3/4 → 4/4 → 5/5` as the view hit the bottom repeatedly, so the stack grew on every bottom hit (2 → 5 pages) with no cap observed, and blank pages were created even when the last page was empty. `PageDown` onto the last page did **not** append; only scrolling past the end did. There is **no page-turn swipe, no pull-to-add gesture, and no always-visible `+`** in any artifact examined (official 6.2.21 screenshot, v6.8.6 XBF/UIA). Explicit page management lives in a flyout menu on the left thumbnail rail (`Insert Page`, `Duplicate Page`, `Delete Page`, `Refresh`, `Select Pages`, `Clear Selection`). Navigation is scroll / `PageUp` / `PageDown` / click a thumbnail / tap the page counter. The experience is “paper that never runs out”, not “turn to the next sheet”.

## Evidence table

| # | Claim | Evidence (file / offset / URL) |
|---|---|---|
| 1 | The editor stacks pages vertically in one scroll viewer | `resources.pri` u16 `_SheetsScrollViewer` @0x340ae, `_PagesVerticalStack` @0x34108; carved `xbf58.bin` names both; `scrble-behavior-deep-dive.md:36` |
| 2 | Pages are discrete sheets with per-page ink, not one free canvas | `InkNotes.xr.xml` `SheetManager`/`PageAdded`; UIA shows per-page `Image` + `InkCanvas`; FAQ: one PNG per page (`https://www.scrble.com/faq/`) |
| 3 | **Scrolling past the document end auto-adds one blank page** | `InkNotes.dll` UTF-8 `_AddPagesIfScrolledToTheEnd` @0x7ebd0e and @0x7ec42f (async state machine `d__55`), adjacent to `_SheetsScrollViewer`/`ViewChanged` metadata; live v6.8.6.0: `3/3 → 3/4` and `4/4 → 5/5` on bottom scrolls, while `PageDown` `3/4 → 4/4` did not append |
| 4 | There is a minimum-page helper; a new note starts with a blank page below | `InkNotes.dll` `_AddMinNumPages` @0x7ec851; local test note `Untitled#01.png` + `Untitled#02.png` created 10/19/2026 04:26:33/34, `#02` blank; screenshots show title `Untitled (1/2)` |
| 5 | Explicit add is **`Insert Page` in the rail flyout**, not a `+` button | carved `xbf71.bin`: `PageListDataTemplate`, `_ListView`, `_PageListMenuFlyout`, `InsertPage`, `DuplicatePage`, `DeletePage`, `Refresh`, `SelectPages`, `ClearSelection`; `resources.pri` `Insert Page` @0xa5b4, `_PageListMenuFlyout` @0x37614 |
| 6 | The rail is data-bound and grows when a page is added | `InkNotes.xr.xml`: `PagesPreviewList` events `PageAction`/`PageReorder`/`CurrentPageChanged`; `SheetManager` event `PageAdded`; DLL `add_PageAdded` @0x7ec1b4, `_UpdatePages` @0x7ebae4, binding strings `IPagesPreviewList_Bindings` |
| 7 | Rail opens by default; click a thumbnail to jump | Release 6.2.21.2: “The side panel with the list of all pages is opened by default when loading a document … to jump to a specific page quickly”; DLL `ScrollToPage` @0x7ece1d, `FindPageIndex` |
| 8 | Rail menu also does duplicate/delete/refresh/select/multi-select | XBF `xbf71.bin` strings above; XBF `xbf95.bin` `PageSelectionToolbar`: Delete, Duplicate, TwoPage, ExportPDF, Share, Email, Mail, Print + `_SelectionCounter`; 6.3.1: “select multiple pages, then delete or move them all at once” |
| 9 | Keyboard/wheel navigation, no page-turn gesture | Official shortcuts: Page Up/Down = previous/next page, arrows = scroll, wheel = scroll, Ctrl+wheel = zoom (`https://www.scrble.com/faq-items/what-are-scrble-keyboard-shorcuts/`); DLL `ScrollPageUp`/`ScrollPageDown` @0x7ece1d/0x7ece37 |
| 10 | Page counter opens a page flyout; zoomed-out view exposes navigation | 7.2.0: “Tapping on the current page indicator shows a fly-out to edit the current page”; 5.2.0: “Tap the counter of the page to show navigation panel”; 1.0.0: “Zoom out to view full page and page navigation panel” |
| 11 | Writing is auto-scrolled toward the same bottom trigger | Homepage: “Scrolls the page automatically for uninterrupted and super-fast writing”; `resources.pri` “The page will autoscroll when reaching this area” @0x9bd8; `InkNotes.dll` `SCROLLTIMER` @0x7eccef; bottom-scroll append confirmed live, writing-induced append not directly tested |
| 12 | No drag-to-add-page hint or gesture exists | Exhaustive search of PRI/DLL for `release to`, `drop to`, `pull to`, `swipe`, `add page`, `new page` returned **no** such UI string; only drag tool is Vertical Spacer (6.8.0); `scrble-behavior-deep-dive.md:53` |
| 13 | Page count is maintained by appending at the end on delete | 1.3.8/1.3.9: “Deleting pages keeps the same number of pages by adding duplicates at the end.” |
| 14 | Pages are generated at runtime, including during save/import | 1.3.5/1.3.6: “Saving was failing when new pages were created while saving was in progress”; 7.3.0: “Avoid generating empty pages when appending imported files” |
| 15 | Two-page side-by-side is an optional view; scrolling is still vertical | 7.2.0/7.3.0: “view two pages side by side”; 7.3.0 also adds left/right keys to move the view horizontally |
| 16 | Auto-append repeats: every bottom scroll creates another blank page | Live test, 2026-10-20, v6.8.6.0, 2-page note: `2/2 → 3/3 → 3/4` (bottom scrolls), `4/4` (PageDown), `5/5` (bottom scroll); screenshots `scroll-test-4/5/6/7e/7g.png`; no ink written |

**Release-note URLs used in rows 7–15:** `https://www.scrble.com/6-2-21-2/` · `https://www.scrble.com/7-2-0/` · `https://www.scrble.com/5-2-0-and-5-2-1/` · `https://www.scrble.com/1-0-0-released-as-inknotes/` · `https://www.scrble.com/1-3-8-and-1-3-9/` · `https://www.scrble.com/1-3-5-and-1-3-6/` · `https://www.scrble.com/7-3-0/` · `https://www.scrble.com/6-3-1/` · `https://www.scrble.com/6-8-0/`

### Relevant repo quotes

> `scrble-behavior-deep-dive.md:36` — “vùng nội dung gồm `PagesPreviewList` (rail bên trái) + `SheetManager` (`_PagesVerticalStack` bên trong `_SheetsScrollViewer`).”

> `scrble-behavior-deep-dive.md:50` — “`Insert Page` / `Duplicate Page` / `Delete Page` nằm trong flyout của rail + thanh đa trang; năng lực ‘Insert, delete and reorder pages’ có từ bản đầu (1.0.0, 2018).”

> `ui-parity-scrble.md:13` — title bar reads `"Untitled (1/2) - Scrble Ink"`; `ui-parity-scrble.md:16` — left rail is thumbnails + page number, selected page navy `#01579B`.

## What the original UX actually feels like

1. **Open a note.** The left rail slides open with numbered thumbnails; the title shows `(current/total)`. A new note already has a blank second page (observed `#01` + `#02` created together; `_AddMinNumPages`), so the user starts with paper below the first sheet.
2. **Write.** In Write mode the page auto-scrolls when the pen reaches the writing margin (`The page will autoscroll…`). At normal writing zoom one page fills the viewport; scrolling is vertical through the **same continuous stack**. Navigation is a scroll, not a page-turn, and there is no separate “page view” modal.
3. **Reach the bottom.** `_AddPagesIfScrolledToTheEnd` appends **one** blank page when the scroll view passes the end. In the live check the title moved `2/2 → 3/3` after one bottom scroll, then `3/4` after another; the rail gained a blank thumbnail each time. A `PageDown` moved into page 4 (`4/4`), and a further bottom scroll produced `5/5`. `PageDown` onto page 4 did not append — the append is tied to scroll-past-end, not page navigation. The rail itself does not create the page: `SheetManager` raises `PageAdded` and the bound `PagesPreviewList` adds the thumbnail; the user keeps writing into the new blank sheet. This is the primary “add page” flow.
4. **Add deliberately.** The rail’s flyout offers `Insert Page` (and `Duplicate Page`). There is no `+` in the rail in the official 6.2.21 screenshot, and no `Add page` button in the UIA dump. Insertion is a menu action; the exact insert index (after current vs. end) is not exposed in strings.
5. **Navigate.** Wheel/arrows scroll, `PageUp`/`PageDown` jump a page, clicking a thumbnail jumps to that page, tapping the page counter opens page settings/navigation. Zooming out far enough shows the full page + navigation panel. Two-page side-by-side is optional.
6. **At the very last page edge.** Scrolling past the bottom appends one blank page; with continued scrolling the view enters it, so the document feels endless. This happens even on a completely blank page, so repeated bottom scrolls steadily inflate the page count. A pen stroke is captured on the current page’s own `InkCanvas`; whether a stroke can continue onto the appended page was not observed (no ink was written in the live test). Dragging in view mode just pans; overscroll has no “release to add page” state.

## Recommendation for WriteCanvas

**Make auto-append the primary flow; keep an explicit, non-drag path.**

1. **Continuous vertical stack, auto-append at the end.** Keep fixed-size pages in one vertical scroller. When the viewport passes the bottom of the last page, append **one** blank page with the same paper/size and continue scrolling into it. Trigger it from scroll position (`scrollTop >= maxScroll - epsilon`), not from a gesture, and **not** from `PageDown` / thumbnail navigation. When the user is writing at the bottom, the existing auto-scroll/writing-zone should bring the viewport to that trigger; append after the current stroke ends so wet ink is never cut.
2. **Do not make pull-to-add the primary affordance.** Scrble has no such gesture and no “release to add page” hint. Keep any existing pull/rubber-band as an optional shortcut, never the only way. This also satisfies WCAG 2.5.7 (dragging movements need a single-pointer alternative).
3. **Make the non-drag path visible and boring.** Keep the existing `btnAddPage`/toolbar action, add a labeled `+ Add page` at the foot of the thumbnail rail, and a keyboard shortcut (e.g. `Ctrl+Shift+Enter`; avoid `Ctrl+N`, which conventionally means new note). Also keep `Insert Page` / `Duplicate` / `Delete` in the rail context menu and `PageUp`/`PageDown` for navigation.
4. **Rail behavior.** Append the thumbnail automatically on `PageAdded`, scroll the rail to it, and mark the current page. Click jumps; drag reorders; multi-select exposes delete/duplicate/export. Do not add an extra ghost tile beyond the last real page; a blank sentinel page is a real page and should be shown as such.
5. **Guard against blank-page inflation — a deliberate divergence.** Scrble itself inflates: repeated bottom scrolls took a 2-page test note to 5 pages in the live check. WriteCanvas should keep auto-append, but only when the last page has ink (or the user explicitly asks), and keep at most one blank page ahead. Do not append again just because that blank sentinel is at the bottom; this preserves “paper that never runs out” without letting a wheel create many empties.
6. **Model.** Keep discrete PNG-per-page / fixed paper, not an infinite canvas. “Infinite” here means “the stack grows”, not “strokes live in unbounded 2-D space”.

## Unverified / flagged

- **Exact auto-append threshold.** Behavior is confirmed (one page per scroll-past-end, not on `PageDown`), but the pixel/percentage threshold, and whether a fast fling can append more than one page, were not measured. An 8-notch batch appended only one page.
- **Maximum page count.** No cap was observed up to 5 pages; a hard limit (if any) was not tested.
- **Pen-at-edge semantics.** That writing auto-scrolls into the new page is inferred from the auto-scroll feature + scroll-driven append; no ink was written in the live test, so whether Scrble clips a stroke at the page boundary or scrolls before the pen reaches it remains unobserved.
- **`Insert Page` placement.** The menu string and `InsertNewSheetAndNotify` exist, but “after current page”, “before current page”, or “at end” is not documented.
- **Toolbar `New` button.** UIA AutoId `New`, tooltip `New (Ctrl+N)`; the shortcut is listed under **File → New**, so it is probably a new note, not a new page. Not counted as an add-page control.
- **Rail flyout invocation.** XBF defines `_PageListMenuFlyout` on the rail/`PageListDataTemplate`; whether it opens by right-click, long-press, or an overflow button is not decompiled (no visible `+` or `…` in the official screenshot).
- **Minimum page count = 2.** Inferred from `_AddMinNumPages` plus two PNGs created one second apart on a new note; no official statement. The live test note did start with 2 pages.
- **Auto-save of appended pages.** Pages 3–5 existed in memory, but no `Untitled#03.png` appeared on disk while the app was open; save-on-close/auto-save timing was not tested. The original note folder was restored from backup after the test.
- **Version drift.** Binary and live test are 6.8.6.0 (2021); 7.2.0/7.3.0 page-indicator and side-by-side descriptions are from the website and were not verified in this binary. The 7.x build itself was not inspected, so a later visible add control cannot be ruled out, though no release note through 7.3.6 announces one.
