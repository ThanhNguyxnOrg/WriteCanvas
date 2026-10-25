# Page-to-page scroll continuity — nghiên cứu & đặc tả đề xuất (2026-10-22)

> **Ngày:** 2026-10-22 • **Loại:** research + proposal • **Đích:** WriteCanvas (Electron + HTML/CSS/Canvas)
>
> **Trạng thái:** **read-only**. Không sửa code, không commit, không tạo note nháp. Note 71 (`Untitled 10`) đang mở trong app chạy thật; mọi phép đo chỉ đọc, không vẽ, không xoá, không lưu.
>
> **Câu hỏi:** Vì sao lướt từ trang này sang trang kế tiếp bị cảm giác “tách nhau”, và cần thay đổi gì để việc đọc/viết qua nhiều trang liền mạch mà không phá hành vi hiện có?
>
> **Phương pháp:** đọc 5 tài liệu nội bộ trước; audit trực tiếp `src/js/editor.js`, `src/style.css`, `src/index.html`; đo DOM/scroll live qua CDP trên app đang mở; đối chiếu tài liệu chính thức của Scrble, Microsoft, GoodNotes, Notability, Samsung, Apple, Xournal; đối chiếu WCAG 2.2, MDN và Apple HIG.
>
> **Quy ước bằng chứng:**
> - **[CODE]** — hành vi đọc được trong repo WriteCanvas, kèm file:dòng.
> - **[SCRBLE]** — artifact/bản build hoặc website chính thức của Scrble Ink.
> - **[OFFICIAL]** — tài liệu chính thức của hãng.
> - **[SPEC]** — spec/chuẩn web (W3C, MDN, WCAG).
> - **[COMMUNITY]** — thảo luận/người dùng; không dùng làm chuẩn duy nhất.
> - **[PROPOSAL]** / **[INFERENCE]** — quyết định hoặc suy luận của tài liệu này, không phải số liệu của hãng.
>
> **Baseline:** HEAD `22256bd5552a5cd1f3337c3e340d799bf92b4c06` — `docs(research): defer ruler length resizing to P1`. Trước khi tạo tài liệu này, `git status --short` chỉ có `?? writecanvas.zip`; không có thay đổi code nào khác.

---

## TL;DR / Verdict

**Đây không phải lỗi “thiếu CSS gap”. Đây là mô hình một trang đơn (single-page) được điều khiển bằng cách thay nội dung, cộng với reset `scrollTop = 0`, cộng với việc chỉ có một sheet trong DOM.** Người dùng không thấy tờ giấy kế tiếp, không có không gian để cuộn tiếp, và khi bấm rail thì trang mới hiện ra ở đầu trang — cảm giác “tách” là hệ quả trực tiếp của kiến trúc.

Năm điểm quyết định:

1. **Luồng hiện tại:** `setPage(i)` gọi `sanitizePage()`, `renderPage()`, có thể `fitZoom()`, rồi đặt `scrollTop = 0; scrollLeft = 0` (`src/js/editor.js:363–381`). Đổi trang = thay nội dung + nhảy về đầu trang, không phải cuộn sang tờ kế tiếp.
2. **Điểm chết ở trang 1/2:** wheel handler chỉ xử lý khi `S.currentPage === S.pages.length - 1` (`editor.js:2638–2641`). Đang ở đáy trang 1 của note 2 trang, lăn chuột xuống không làm gì. Đo live: `scrollTop = 858.4`, max `859`, gửi wheel `deltaY = 120` → `scrollTop` vẫn `858.4`, không đổi trang.
3. **Không có “tờ kế tiếp” để thấy:** DOM chỉ có `#canvasHost > #canvasStack > #stackInner` với đúng một bộ sáu canvas (`src/index.html:87–100`). `#canvasStack` cao đúng bằng trang hiện tại, không gap, không padding dọc; shadow ở đáy bị `overflow: auto` cắt (`src/style.css:229–238`).
4. **Điều hướng chủ yếu là rail:** `refreshPages()` rebuild toàn bộ rail và `drawThumb()` flatten từng trang + `toDataURL()` mỗi lần `setPage()` (`editor.js:392–424`). Với note nhiều trang, đây là nguồn jank khi đổi trang.
5. **Không có bàn phím, không có scroll anchoring, không có snap:** keydown toàn cục không xử lý PageUp/PageDown (`editor.js:2665–2696`); `overflow-anchor: auto`, `scroll-snap-type: none`, `overscroll-behavior: auto` theo computed style live. Các cơ chế này sẽ phải thiết kế có chủ đích, không thể thêm một dòng CSS là xong.

**Khuyến nghị kiến trúc:** continuous vertical stack gồm các page slot cố định, gap **16 CSS px** ở 100% zoom (đề xuất), border/shadow nhẹ, **không scroll snap**, native wheel/trackpad, active page suy ra từ scroll, rail chỉ sync class (không rebuild), PageUp/PageDown cuộn viewport và Ctrl+PageUp/Down đổi trang. Chỉ render đầy đủ trang active; hai trang lân cận dùng preview — **không eager render toàn bộ**.

**Default hay opt-in:** nghiêng về **continuous làm default** vì đây là parity fix với Scrble/Xournal/Journal/Notability Seamless, và vì dead-end hiện tại là lỗi trải nghiệm; nhưng đây là thay đổi hành vi, cần user duyệt. Nếu chưa duyệt, làm continuous như **opt-in** và vẫn phải sửa dead-end của chế độ single-page.

---

## 1. Phạm vi, phương pháp, trạng thái read-only

### 1.1 Trong phạm vi

- Đọc/viết liên tục qua nhiều trang theo chiều dọc.
- Điều hướng: wheel, trackpad, touch, pen, rail, keyboard, auto-scroll khi kéo selection.
- Đồng bộ rail/current page, scroll anchoring khi thêm/xoá trang, reduced motion, focus/screen reader.
- Hiệu năng render nhiều trang và bộ nhớ canvas.

### 1.2 Ngoài phạm vi

- Định dạng lưu note, import PDF, export, sync/cloud.
- Thay đổi công cụ vẽ (Select/Eraser/Ruler/pen). Các thay đổi công cụ phải additive và giữ default cũ; tài liệu này không đề xuất đổi default công cụ.
- Viết code hoặc sửa file. Tài liệu chỉ là đặc tả để user quyết định.

### 1.3 Read-only

- Không sửa `src/**`, không sửa `main/**`, không tạo note mới.
- Note 71 đang mở được đo bằng CDP; không gửi lệnh vẽ, không gọi save, không đổi page.
- Phép thử wheel trước đó chỉ gửi **một** sự kiện wheel ở đáy trang 1; vì `currentPage !== last`, handler return sớm, không tạo trang, không đổi dữ liệu.
- Không chạy test tự động trên note 71. Khi triển khai, test phải dùng fixture hoặc bản copy do test tạo, không dùng note của user.

### 1.4 Nguồn nội bộ đã đọc

- `docs/research/scrble-pages-ux-2026-10-20.md` — mô hình continuous stack, auto-append, rail, PageUp/PageDown của Scrble.
- `docs/research/scrble-behavior-deep-dive.md` — hành vi trang, pull/vertical spacer, page model.
- `docs/research/ui-polish-patterns-2026-10-20.md` — pull-to-add, page navigation, accessibility, motion.
- `docs/research/inking-app-landscape.md` — landscape app, page structure, input conventions.
- `docs/research/ruler-ux-2026-10-22.md` — quy ước evidence tag và cách viết đặc tả.

Tài liệu này **không lặp lại** các kết luận đã có; nó tập trung vào cơ chế scroll liên trang và các quyết định kỹ thuật còn thiếu.

---

## 2. Hiện tượng và cách tái hiện

### 2.1 Hiện tượng người dùng mô tả

> “Khi lướt xuống sang trang tiếp nó như tách nhau, không có sự mượt mà.”

Cụ thể hơn:

- Đang đọc ở cuối trang 1; lăn chuột xuống → không có gì xảy ra.
- Phải rời tay khỏi vùng giấy, bấm thumbnail trang 2 ở rail.
- Trang 2 hiện ra **ở đầu trang**, mất vị trí đang đọc; không có chuyển động không gian từ tờ 1 sang tờ 2.
- Nếu đang ở trang cuối và lăn tiếp, app mới thêm trang — nhưng cũng nhảy về đầu trang mới.

### 2.2 Tái hiện tối thiểu

1. Mở note có ≥2 trang (note 71 hiện có 2 trang).
2. Ở trang 1, cuộn xuống hết.
3. Lăn chuột xuống thêm.
4. Kỳ vọng: tiếp tục đi vào trang 2.
5. Thực tế: không đổi `scrollTop`, không đổi trang; chỉ rail mới đi tiếp.

### 2.3 Đo live (2026-10-22)

| Thuộc tính | Giá trị |
|---|---|
| Target | `Untitled 10 (1/2)` — WriteCanvas, `file:///D:/Code/WriteCanvas/src/index.html` |
| Viewport | 1536 × 912 CSS px, DPR 1.25 |
| `#canvasHost` | x=210, y=121, w=1313, h=778; `scrollTop=858.4`; `scrollHeight=1637`; max scroll=859 |
| `#canvasStack` | 1265 × 1636.9 CSS px; transform `none`; shadow 2 lớp |
| `#stackInner` | style 2500 × 3235; transform `translateY(0px) scale(0.506)`; rect 1265 × 1636.91 |
| Canvas layers | 6 canvas, mỗi canvas backing store 2500 × 3235 |
| Rail | 2 item, current index 0; `scrollHeight=754`, `clientHeight=754` |
| Page counter | `(1/2)` |
| Computed scroll | `overflow:auto`, `overflow-anchor:auto`, `scroll-snap-type:none`, `overscroll-behavior:auto` |
| Scrollbar | `#canvasHost::-webkit-scrollbar { width:0; height:0 }` → không thấy |
| Wheel test | `deltaY=120` tại đáy trang 1 → `scrollTop` trước/sau đều `858.4`, delta `0` |

Điểm quan trọng: trang cao **1636.9 CSS px**, viewport chỉ **778 CSS px**. Một trang chiếm ~2.1 viewport. Vì vậy người dùng không chỉ “lật trang” ở cuối tài liệu; họ thường xuyên đi qua ranh giới trang khi đọc/viết. Continuous không phải hiệu ứng trang trí, mà là cách duy nhất để ranh giới trang không cắt mạch đọc.

---

## 3. Audit code và DOM/scroll

### 3.1 DOM hiện tại

```text
#viewport  (workspace #e9edf2; overflow:hidden)
└─ #canvasHost  (inset 13px 13px 13px 0; overflow:auto; scrollbar ẩn)
   └─ #canvasStack  (một sheet; margin:0 auto; border-radius:2px; shadow)
      └─ #stackInner  (2500×3235; transform: translateY(-pullPx) scale(zoom))
         ├─ #paperC
         ├─ #rasterC
         ├─ #inkC
         ├─ #liveC
         ├─ #laserC
         ├─ #rulerC
         └─ #titleStrip
```

Chỉ có **một** page stack và **một** bộ canvas. Không có sibling page nào để scroll tới. `#titleStrip` cũng nằm trong `#stackInner`, nên khi tách page slot phải quyết định title strip thuộc trang 1 hay mỗi trang — đây là regression risk cần test.

### 3.2 Vòng đời trang hiện tại

| Bước | Code | Tác động |
|---|---|---|
| Đổi trang | `setPage(i)` — `editor.js:363–381` | `sanitizePage()` trang cũ; `clearSelection()`; gán `S.currentPage`; `renderPage()`; `fitZoom()` nếu chưa từng zoom; `applyTransform()`; **`scrollTop=0`**; `refreshPages()`; `updateTitle()`; `syncUndoRedo()` |
| Thêm trang | `addPage()` — `editor.js:383–388` | Lấy paper trang hiện tại, push page mới, gọi `setPage(last)` → lại reset scroll |
| Render trang | `renderPage()` — `editor.js:267–276` | `sizeLayers()` resize 6 canvas; render paper; raster; toàn bộ ink; clear live/laser; ruler |
| Resize layer | `sizeLayers()` — `editor.js:259–264` | Mỗi canvas được set `width/height = docSize` nếu khác |
| Transform | `applyTransform()` — `editor.js:158–170` | `#stackInner` = doc size; transform `translateY(-pullPx) scale(zoom)`; `#canvasStack` = doc size × zoom |
| Fit zoom | `fitZoom()` — `editor.js:250–256` | Fit-width theo `host.clientWidth - 48`; gọi khi mở note và khi `setPage` nếu `!S.hadZoom` |
| Toạ độ bút | `pageCoords()` — `editor.js:241–246` | Lấy rect của **một** `#stackInner`; chia scale; không có page-local mapping |
| Wheel | `editor.js:2621–2663` | Ctrl/Cmd+wheel = zoom; wheel thường để native; chỉ khi **trang cuối** và đã ở đáy mới tích luỹ `wheelOverscroll` để `addPage()` |
| Pan | `onPointerMove()` — `editor.js:585–604` | Kéo pan set `scrollTop`; nếu vượt đáy và đang ở trang cuối thì pull; không có page kế tiếp |
| Pointer up | `onPointerUp()` — `editor.js:1472–1492` | Pull đủ ngưỡng → `addPage()`; `host.scrollTop = 0` |
| Rail | `refreshPages()` — `editor.js:392–408` | `bar.innerHTML=''`; tạo lại từng item; gán `onclick = setPage(i)` |
| Thumbnail | `drawThumb()` — `editor.js:411–424` | `flattenToCanvas(page)` + canvas 176px + `toDataURL()` **đồng bộ** |
| Save | `saveCurrentPage()` — `editor.js:1657–1713` | `flattenBytes()` gọi `flattenToCanvas()` đồng bộ trước `toBlob()` |
| Keyboard | `keydown` — `editor.js:2665–2696` | Không có PageUp/PageDown/Home/End cho page scroll |

### 3.3 Sơ đồ scroll hiện tại

```text
scrollTop = 0
┌──────────────────────────────┐  ← #canvasHost top
│  page 1                      │
│                              │
│  ... nội dung trang 1 ...    │
│                              │
│                              │  scrollTop = 858.4
├──────────────────────────────┤  ← viewport bottom (max scroll 859)
│  (không có page 2 trong DOM) │
└──────────────────────────────┘
   scrollHeight = 1637 = đúng 1 sheet
```

Khi ở trang cuối:

```text
scrollTop = max
┌──────────────────────────────┐
│  page N (đáy)                │
├──────────────────────────────┤  ← wheel vượt ngưỡng
│  addPage()                   │
│  → setPage(N+1)              │
│  → scrollTop = 0             │  ← nhảy về đầu trang mới
└──────────────────────────────┘
```

### 3.4 Sơ đồ đề xuất

```text
#canvasHost (overflow:auto; overscroll-behavior:contain)
└─ #pageStack (height = tổng slot + gap; position:relative)
   ├─ .pageSlot[data-page="0"]  (top: padTop)
   │  ├─ .pagePreview (bitmap/low-res, luôn có)
   │  └─ #canvasStack (chỉ active; 6 layer; transform scale(zoom))
   ├─ gap 16 CSS px (không nằm trong transform)
   ├─ .pageSlot[data-page="1"]
   │  ├─ .pagePreview
   │  └─ (canvasStack được move sang khi active)
   ├─ ...
   └─ .pageSlot[data-page="N-1"] / ghost sentinel
```

`#canvasStack` **move giữa các slot**, không nhân bản 6 canvas cho mọi trang. Preview của trang không active là bitmap (hoặc canvas nhỏ), không phải 6 layer đầy đủ.

---

## 4. Nguyên nhân cảm giác “tách”

| # | Nguyên nhân | Bằng chứng | Hiệu ứng người dùng | Mức |
|---|---|---|---|---|
| 1 | Chỉ một trang tồn tại trong DOM | `index.html:87–100`; `#canvasStack` đơn; không sibling page | Không có gì để cuộn tới; ranh giới trang là “bức tường” | Gốc |
| 2 | Đổi trang reset scroll | `setPage()` đặt `scrollTop=0` (`editor.js:376`) | Trang mới luôn mở ở đầu; mất vị trí đọc | Cao |
| 3 | Wheel dead-end ở trang không phải cuối | `editor.js:2638–2641` return nếu `currentPage !== last` | Ở đáy trang 1/2, lăn chuột không có phản hồi | Cao |
| 4 | Không có preview tờ kế tiếp | Không có page slot/gap; `#canvasStack` cao đúng trang hiện tại | Không có tín hiệu “còn giấy ở dưới”; cảm giác hết nội dung | Cao |
| 5 | Không gap/padding, shadow bị cắt | `style.css:229–238`; host `overflow:auto`; stack không có margin dọc | Đáy trang bị cắt phẳng, shadow không hiện, giống “màn hình chứ không phải giấy” | Trung bình |
| 6 | Rail là đường điều hướng chính; scrollbar ẩn | `style.css:233`; `refreshPages()` `editor.js:392–408` | Người dùng phải rời vùng đọc để bấm thumbnail; không thấy tiến độ | Trung bình |
| 7 | Rebuild toàn rail + flatten thumb mỗi lần đổi trang | `refreshPages()` `innerHTML=''`; `drawThumb()` `flattenToCanvas` + `toDataURL` | Giật khi đổi trang, tệ hơn khi nhiều trang/nhiều nét | Cao (performance) |
| 8 | Fit zoom có thể đổi khi qua trang | `setPage()` gọi `fitZoom()` nếu `!S.hadZoom` (`editor.js:370`) | Nếu paper size/orientation khác, trang đột ngột đổi tỉ lệ | Trung bình |
| 9 | Flatten full page trước khi save khi đổi trang | `sanitizePage()` → `saveCurrentPage()`; `flattenBytes()` gọi `flattenToCanvas()` đồng bộ (`editor.js:151–154, 357–360, 1657–1669`) | Khựng frame ngay lúc chuyển trang, đặc biệt trang nhiều nét | Cao |
| 10 | Toạ độ bút giả định một sheet | `pageCoords()` dùng một `#stackInner` rect (`editor.js:241–246`) | Nếu chỉ thêm page slot mà không sửa mapping, bút vẽ lệch/xuống sai trang | Cao (engineering) |
| 11 | Memory buộc phải windowed | 6 canvas 2500×3235 mỗi trang ≈ 194 MB/trang (xem §7.1) | Không thể eager render nhiều trang; nếu làm ẩu sẽ OOM/giật | Cao |
| 12 | Không có keyboard page scroll | `keydown` không có PageUp/PageDown/Home/End (`editor.js:2665–2696`) | Người dùng bàn phím không thể đọc tuần tự; phải dùng chuột/rail | Trung bình |
| 13 | Chưa có scroll anchoring | Computed `overflow-anchor:auto` nhưng chưa có logic cho insert/delete page | Khi thêm/xoá trang phía trên, viewport có thể nhảy | Trung bình (P1) |

**Kết luận nguyên nhân:** cảm giác “tách” không đến từ một animation thiếu; nó đến từ **không gian bị đứt** (không có tờ kế tiếp), **vị trí bị reset** (`scrollTop=0`), và **điều hướng bị đổi modality** (scroll → click rail). Sửa CSS gap đơn thuần sẽ không giải quyết được.

---

## 5. Đối chiếu app

Bảng dưới chỉ mô tả hành vi **có nguồn**. Cột “Default” chỉ ghi khi nguồn nói rõ; nếu không, ghi “không tài liệu hoá”.

| App | Mô hình trang | Cách đi qua trang | Default / ghi chú | Nguồn |
|---|---|---|---|---|
| **Scrble Ink** | Continuous vertical stack of fixed pages; một `ScrollViewer`, mỗi page là sheet riêng | Wheel/scroll, PageUp/PageDown, click thumbnail; scroll past bottom tự thêm trang | Continuous; auto-append ở cuối; không có page-turn swipe | [SCRBLE] `docs/research/scrble-pages-ux-2026-10-20.md:11, 17–32, 46–51`; [OFFICIAL] FAQ `https://www.scrble.com/faq/` và shortcuts `https://www.scrble.com/faq-items/what-are-scrble-keyboard-shorcuts/` (truy cập 2026-10-22) |
| **Microsoft Journal** | Page-based journal; các trang nối tiếp trong một journal | “Use your finger to scroll between pages”; new page at end as you scroll; ghosted page nếu trang trên trống | Scroll để thêm; có Add a Page / Insert Page Above | [OFFICIAL] `https://support.microsoft.com/en-us/journal/working-with-pages` (truy cập 2026-10-22) |
| **Xournal** | Journal = nhiều page; continuous mode xếp tất cả page dưới nhau; one-page mode xem một page | Scroll xuống page mong muốn; forward ở page cuối tạo page mới; toolbar/menu page nav | **Default là continuous**, “best adapted to note-taking on multiple pages”; one-page cho scrapbook/page khác kích thước | [OFFICIAL] `https://xournal.sourceforge.net/manual.html` — mục “Navigating the journal” (truy cập 2026-10-22) |
| **Notability** | Note page-based; hai view mode | **Seamless**: scroll dọc; **Single Page**: swipe ngang từng trang | Không tài liệu hoá default; Single Page dùng với Presentation Mode | [OFFICIAL] `https://support.gingerlabs.com/en-us/articles/16300185-note-view-settings` (truy cập 2026-10-22) |
| **GoodNotes** | Notebook page-based | Swipe theo scroll direction đã cấu hình; có scrollbar ở mép phải khi horizontal | Không tài liệu hoá default vertical/horizontal; cho chọn Vertical/Horizontal | [OFFICIAL] `https://support.goodnotes.com/hc/en-us/articles/6554036735631-Zoom-pan-and-scroll-through-pages-in-Goodnotes` (truy cập 2026-10-22) |
| **Samsung Notes** | Hai note style: Individual pages (separator cố định) hoặc Infinite scrolling (một page dài) | Scroll trong style đã chọn | Default note style chọn trong Settings; không tài liệu hoá gap px | [OFFICIAL] `https://www.samsung.com/us/support/answer/ANS10004548` (truy cập 2026-10-22) |
| **OneNote** | Page list + một page canvas; page không xếp continuous trong một cột | PageUp/PageDown cuộn **trong page**; Ctrl+PageDown/PageUp chuyển page kế/trước; Alt+PageUp/Down first/last page | Page-based, không phải continuous stack; có Add Page/Ctrl+N | [OFFICIAL] `https://support.microsoft.com/en-us/accessibility/onenote/keyboard-shortcuts-in-onenote`; `https://support.microsoft.com/en-us/onenote/create-or-customize-page-templates` (truy cập 2026-10-22) |
| **Microsoft Whiteboard** | Infinite canvas, không có page model | Pan/zoom tự do | Không phải page-based; không dùng làm parity cho page scroll | [OFFICIAL] `https://support.microsoft.com/en-us/whiteboard/unleash-ideas-on-microsoft-whiteboard-s-infinite-canvas` (truy cập 2026-10-22) |
| **Apple Notes** | Không có page model/page break trong User Guide; note là một document liên tục | Scroll trong note | Không có page nav; [COMMUNITY] mô tả “one long, continuous note” | [OFFICIAL] `https://support.apple.com/guide/notes/welcome/mac` (truy cập 2026-10-22); [COMMUNITY] `https://discussions.apple.com/thread/252116929` |
| **Xournal++** | Journal = collection of pages; sidebar page preview; insert page | Touch pan/scroll mặc định; “Touch Drawing” là mode riêng; Insert Page button/menu | Page-based; touch pan mặc định | [OFFICIAL] `https://xournalpp.github.io/guide/whirlwind-tour/` (truy cập 2026-10-22) |

### 5.1 Đọc bảng này thế nào

- **Continuous vertical stack là mẫu trội** trong các app page-based có nguồn rõ: Scrble, Xournal, Journal, Notability Seamless. GoodNotes và Samsung cũng cho phép scroll/page style; OneNote là ngoại lệ page-list.
- **Single-page/swipe là chế độ trình bày hoặc lựa chọn**, không phải cách duy nhất để đọc nhiều trang. Notability Single Page được gắn với Presentation Mode; Xournal one-page dành cho scrapbook/page khác kích thước.
- **Không hãng nào công bố gap px, shadow, hay scroll-snap**. Vì vậy mọi con số 0/8/16/24 dưới đây là **đề xuất thiết kế**, không phải “parity số liệu”. Đây là lý do tài liệu ghi rõ [PROPOSAL]/[INFERENCE].
- **Scrble auto-append không có nghĩa là WriteCanvas nên bắt chước y nguyên.** Scrble append cả trang trống và có thể làm phình page count; WriteCanvas nên giữ “paper never runs out” nhưng dùng ghost sentinel/guard để tránh blank inflation (xem §6.12).

---

## 6. Đề xuất UX

### 6.1 Mô hình không gian: một cột page slot cố định

- Một cột dọc, page xếp trên/dưới, căn giữa theo chiều ngang.
- Mỗi page là một **slot** có kích thước `docSize(page) × zoom`; canvas bên trong vẫn giữ backing store `docSize` và `transform: scale(zoom)`.
- **Gap nằm ngoài transform**, là CSS px trên `#pageStack`, không phải doc px bên trong `#stackInner`. Vì vậy gap 16 px vẫn là 16 px trên màn hình ở mọi zoom; nếu đặt gap bên trong transform, ở fit zoom 0.506 nó chỉ còn ~8.1 px — quá mảnh.
- Padding dọc trên/dưới `#pageStack` tối thiểu 24 px để shadow của trang đầu/cuối không bị cắt.
- Công thức layout:

```text
slotW(i) = docW(i) * zoom
slotH(i) = docH(i) * zoom
gap      = 16            // CSS px, screen-space
top(0)   = padTop
top(i)   = top(i-1) + slotH(i-1) + gap
stackH   = padTop + Σ slotH(i) + gap*(n-1) + padBottom
```

- Active page xác định theo **viewport center** (`scrollTop + clientHeight/2`), không theo mép trên. Nếu center rơi vào gap, chọn page có diện tích nhìn thấy lớn hơn; thêm hysteresis ~8 px để không nhấp nháy khi center nằm đúng ranh giới.
- Page có paper size/orientation khác nhau: vẫn xếp một cột; `fitZoom` nên fit theo **page rộng nhất** để không đổi zoom khi qua trang. Page hẹp hơn căn giữa; page rộng hơn có thể cần horizontal scroll nhưng không được tự đổi zoom.
- `#titleStrip` hiện là overlay trong `#stackInner`. Phải quyết định: chỉ trang 1 có title strip, hay mỗi page có title strip riêng. Đề xuất [PROPOSAL]: chỉ trang 1 (giống “title” của note), các page sau không có; nếu giữ mỗi page thì phải render theo slot, không move theo active canvas.

### 6.2 Gap 0 / 8 / 16 / 24 CSS px

| Gap | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **0** | Không thêm chiều cao; tối đa mật độ | Shadow hai trang dính nhau; không có “khe giấy”; đáy trang bị cắt; không thấy tờ kế tiếp; đây chính là hiện trạng | **Không** |
| **8** | Gọn; đủ tách nếu có border 1px; ít dead space | Shadow 8–24 px vẫn tràn qua khe; ở dark mode dễ thành một khối; cảm giác “hai tờ sát nhau” | Chấp nhận được nếu user thích compact; **không phải default đề xuất** |
| **16** | Tách rõ mà không thành “card”; đủ chỗ cho shadow nhẹ; tương đương một nhịp spacing phổ biến; ở 100 trang chỉ thêm ~1.584 px (≈1 page height ở fit zoom) | Vẫn là con số cảm tính, không có nguồn hãng | **Đề xuất default** |
| **24** | Tách mạnh, rõ “từng tờ”; tốt nếu page rất lớn/zoom cao | Bắt đầu giống carousel/card; 100 trang thêm ~2.376 px; nhiều dead space khi đọc nhanh | Chỉ dùng nếu user muốn phân tách mạnh; **không default** |

**Khuyến nghị:** `gap = 16 CSS px`, screen-space, không scale theo zoom. Nếu later thấy quá rộng ở zoom thấp, dùng token `--page-gap` để user chỉnh 8/16/24 mà không đổi layout engine.

**Vì sao không 0/8:** với 0, shadow và paper edge hòa vào nhau, không có tín hiệu “còn trang”. Với 8, shadow hiện tại (`0 16px 44px`) vẫn có thể tràn qua khe và làm khe bị tối; 16 cho shadow “thở” mà vẫn tiết kiệm.

### 6.3 Shadow và background

- Giữ workspace `#e9edf2` (light) và token workspace hiện tại cho dark mode; không đổi sang nền tối/đen để “làm nổi” page.
- Chuyển border/shadow từ `#canvasStack` sang `.pageSlot`:
  - Light: `border: 1px solid rgba(19,28,45,.10)`, `box-shadow: 0 1px 3px rgba(19,28,45,.10), 0 8px 24px rgba(19,28,45,.08)`.
  - Dark: `border: 1px solid rgba(255,255,255,.10)`, `box-shadow: 0 1px 4px rgba(0,0,0,.55), 0 12px 32px rgba(0,0,0,.35)`.
- Shadow chỉ để tách sheet khỏi workspace, **không** dùng shadow để bù cho gap 0. Nếu gap 16, shadow nhẹ là đủ; shadow quá đậm sẽ làm khe giữa hai trang thành “hố đen”.
- Không dùng shadow/scale/parallax khi scroll. Trang không di chuyển khác tốc độ nền; không có hiệu ứng “3D page flip”.
- Ở forced-colors/high-contrast, border có thể bị bỏ; thêm `outline` hoặc `border-color: CanvasText` theo `@media (forced-colors: active)`.

### 6.4 Scroll snapping

**Không dùng `scroll-snap-type` trong continuous mode.** Lý do:

- Ở fit-width hiện tại, page cao 1636.9 px, viewport 778 px; `mandatory` sẽ kéo người dùng về đầu page và không cho đọc phần giữa page.
- `proximity` vẫn có thể “bắt” trackpad/pen khi người dùng chỉ muốn dừng giữa trang; gây cảm giác khựng.
- MDN ghi rõ: nếu content trong scroll port thay đổi (thêm/xoá/resize), container sẽ **re-snap** vào snap target cũ nếu còn — đây là nguồn jump khi insert/delete page (`https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-snap-type`, truy cập 2026-10-22).
- Native wheel/trackpad đã đủ mượt; snap là “thêm một cơ chế điều khiển” chồng lên cơ chế có sẵn.

**Khi nào được dùng snap:** chỉ trong **Single Page mode** (nếu làm), nơi mỗi page được fit vào viewport và `scroll-snap-align: start`; hoặc một “presentation mode” riêng. Không trộn snap với continuous.

**Scroll behavior:** mặc định `auto` cho native scroll. Chỉ dùng `smooth` cho **explicit jump** (rail click, Go to page), và tắt smooth khi `prefers-reduced-motion: reduce`. Không dùng `scroll-behavior: smooth` toàn cục vì nó can thiệp cả wheel/keyboard.

### 6.5 Scroll anchoring khi insert/delete page

Browser có `overflow-anchor: auto` mặc định, tự điều chỉnh `scrollTop` để giảm content shift (`https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor`, truy cập 2026-10-22). Nhưng với page insert/delete, không nên để browser tự đoán:

**Thuật toán đề xuất [PROPOSAL]:**

1. Trước khi mutate, capture anchor:
   ```text
   anchor = {
     pageId: page đang chứa viewport top (hoặc page gần nhất),
     offsetPx: scrollTop - pageTop(pageId)
   }
   ```
2. Tạm đặt `#canvasHost { overflow-anchor: none }` trong lúc mutate để browser không tự sửa lần hai.
3. Cập nhật model + layout + `#pageStack` height.
4. Restore:
   ```text
   scrollTop = newPageTop(anchor.pageId) + anchor.offsetPx
   ```
5. Nếu anchor page bị xoá: chọn page kế tiếp (hoặc trước đó), `offsetPx = 0`; không để `scrollTop` vượt max.
6. Trả `overflow-anchor: auto` sau khi layout ổn định (hoặc giữ `none` nếu app đã tự quản lý hoàn toàn; test cả hai).

**Các case:**

| Case | Hành vi |
|---|---|
| Insert page **trên** viewport | Giữ nguyên nội dung đang nhìn; `scrollTop` tăng đúng bằng slot height + gap |
| Insert page **dưới** viewport | Không đổi `scrollTop`; chỉ tăng `scrollHeight` |
| Delete page **trên** viewport | `scrollTop` giảm đúng phần bị xoá; không nhảy |
| Delete page đang xem | Chọn page gần nhất; đưa page đó vào viewport với offset 0 |
| Đổi paper size/orientation của page trên viewport | Capture anchor theo page + offset; restore sau khi layout |
| Zoom | Giữ điểm dưới con trỏ (như `zoomAt` hiện tại) hoặc page-local anchor; không để viewport nhảy |

**Không dựa vào `overflow-anchor` một mình** vì hành vi có thể khác giữa Chromium/Electron version và có thể xung đột với `scrollTop` do app set. Test là bắt buộc.

### 6.6 Rail sync và current-page indicator

**Nguyên tắc:** rail là **kết quả** của scroll, không phải nguồn điều khiển duy nhất.

- Build rail **một lần** khi page count thay đổi; không `innerHTML=''` mỗi lần active page đổi.
- Khi scroll, chỉ cập nhật:
  - class `.cur` trên item tương ứng;
  - `aria-current="page"`;
  - counter `(current/total)`;
  - undo/redo buttons.
- Dùng `IntersectionObserver` với `root: #canvasHost` để biết page nào đang lộ; hoặc rAF + layout cache. Không gọi `getBoundingClientRect()` cho mọi page mỗi frame.
- Active page = page có diện tích nhìn thấy lớn nhất hoặc page chứa viewport center; hysteresis 8 px. Khi center nằm trong gap, giữ page cũ đến khi page mới vượt ngưỡng.
- Click rail: **scroll tới page** (`scrollToPage(i)`), không gọi `setPage(i)` nếu `setPage` reset scroll. Focus ở lại item vừa click; `aria-current` cập nhật.
- Thumbnail:
  - Chỉ regenerate trang dirty, không regenerate tất cả khi đổi active.
  - Generate async/idle (`requestIdleCallback`, `OffscreenCanvas` nếu có) và cache.
  - Khi page mới được thêm, tạo placeholder trước, thumbnail sau.
- Counter `(1/2)` giữ nguyên; có thể thêm `aria-live="polite"` **chỉ khi điều hướng chủ động** (rail/keyboard), không announce mỗi lần scroll.
- Nếu vẫn muốn ẩn scrollbar: thêm một **overlay progress bar** hoặc “Page 1 of 2” pill ở góc; nhưng không hiển thị page dots + scrollbar cùng trục (Apple HIG khuyến nghị tránh trùng lặp control cùng axis — `https://developer.apple.com/design/human-interface-guidelines/scroll-views`, truy cập 2026-10-22).

**Không rebuild rail trong scroll handler.** Đây là điều kiện hiệu năng, không chỉ thẩm mỹ.

### 6.7 Keyboard

Đề xuất map:

| Phím | Hành động | Ghi chú |
|---|---|---|
| `PageDown` | Cuộn xuống ~87.5% viewport | Giữ overlap ~12.5% để không mất dòng; đi qua page boundary tự nhiên |
| `PageUp` | Cuộn lên ~87.5% viewport | Đối xứng |
| `Ctrl+PageDown` / `Cmd+PageDown` | Trang kế tiếp | Giống OneNote “next page”; align page top + 12 px |
| `Ctrl+PageUp` / `Cmd+PageUp` | Trang trước | Giống OneNote |
| `Home` | Đầu page hiện tại | Không dùng khi đang edit text |
| `End` | Cuối page hiện tại | Không dùng khi đang edit text |
| `Ctrl+Home` / `Cmd+Home` | Page đầu tiên | Tùy chọn |
| `Ctrl+End` / `Cmd+End` | Page cuối cùng | Tùy chọn |
| `Arrow Up/Down` | Cuộn 40–60 px | Chỉ khi host có focus, không edit text |
| `Shift+Arrow` | Cuộn ngang khi zoom > fit | Không cần nếu fit-width |

- `#canvasHost` phải `tabindex="0"` và có `role="region"` + `aria-label`, nếu không browser không nhận keyboard scroll.
- Không hijack khi `isTextEditing()` hoặc focus đang ở input/textarea/contenteditable.
- **Khác Scrble có chủ đích:** Scrble dùng PageUp/PageDown để nhảy page vì một page thường fill viewport; WriteCanvas fit-width nên page cao hơn viewport, PageDown phải cuộn trong page. Ctrl+PageUp/Down giữ page jump — đúng mô hình OneNote.
- Khi chuyển page bằng keyboard, không cướp focus khỏi host; chỉ scroll. Screen reader chỉ announce khi explicit page jump.

### 6.8 Wheel / trackpad / touch / pen

| Input | Kỳ vọng | Cách làm |
|---|---|---|
| **Mouse wheel** | Native scroll; đi qua page boundary mượt; dừng đúng chỗ | Không `preventDefault` cho wheel thường; chỉ Ctrl/Cmd+wheel zoom. Bỏ điều kiện “chỉ trang cuối” khỏi đường scroll thường |
| **Trackpad 2 ngón** | Native scroll + momentum; không bị snap/kéo | Để browser xử lý; `overscroll-behavior: contain` để không chain ra ngoài; không tự cộng `deltaY` thành page flip |
| **Wheel ở cuối tài liệu** | Sau khi đã ở đáy page cuối, scroll thêm → append/ghost page; **không reset scroll** | Giữ `wheelOverscroll` threshold hiện tại (250 px hoặc 28% viewport) nhưng bỏ `scrollTop=0`; page mới xuất hiện dưới, user cuộn tiếp |
| **Touch 1 ngón** | Tùy policy: hiện tại vẽ; nếu “Touch drawing” off thì scroll | Đề xuất P1: giữ default hiện tại (vẽ) để additive; thêm two-finger scroll + pinch; thêm toggle “Touch drawing” như Xournal++ |
| **Touch 2 ngón** | Scroll/pan; pinch zoom | Không capture làm ink; nhận gesture ở host; `touch-action` phải nhất quán |
| **Pen** | Vẽ; không scroll; barrel/middle button pan; eraser end erase | Pen input không kích hoạt page scroll; pen ở gap không vẽ; stroke clip tại page edge |
| **Pen ở page boundary** | Không tự chảy sang page kế | Page là discrete; stroke dừng/clip ở mép page; không kéo dài sang tờ dưới |

**Về `touch-action`:** mặc định browser xử lý pan/pinch; nếu app dùng Pointer Events và muốn tự xử lý, phải set `touch-action` rõ ràng, nếu không browser sẽ gửi `pointercancel` khi bắt đầu gesture (`https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action`, truy cập 2026-10-22). Không nên đặt `touch-action:none` toàn bộ host nếu muốn native two-finger scroll.

**Về wheel:** MDN lưu ý `wheel` không nhất thiết tạo `scroll`, và `deltaY` không nhất thiết phản ánh hướng scroll; nên đọc `scrollTop` thay vì suy diễn từ delta (`https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event`, truy cập 2026-10-22). Đây là lý do không nên làm page flip bằng cách cộng `deltaY` cho tất cả wheel.

**Touch/pen policy đề xuất (P1, cần user duyệt):**

- Giữ nguyên default hiện tại: một ngón tay vẽ khi tool là pen (additive, không phá thói quen).
- Luôn có **two-finger pan/scroll** và pinch zoom.
- Thêm setting “Touch drawing” (mặc định theo hành vi hiện tại); khi tắt, one-finger scroll như Xournal++.
- Khi phát hiện pen (`pointerType === 'pen'`), bỏ qua touch pointer cho đến khi pen lên (palm rejection); không vẽ bằng lòng bàn tay.

### 6.9 Auto-scroll gần mép

- **Selection/lasso/text drag:** khi pointer vào vùng 24 px sát mép trên/dưới của `#canvasHost`, scroll bằng `requestAnimationFrame`; tốc độ tăng dần theo khoảng cách, tối đa ~600–800 px/s; dừng ngay khi pointerup/pointercancel. Không scroll nếu pointer không ở trạng thái drag.
- **Pen đang viết:** **không auto-scroll giữa nét** ở P0. Scroll dưới ngòi bút sẽ làm nét bị kéo giãn và mất kiểm soát. Nếu muốn parity Scrble “writing auto-scroll”, chỉ scroll **sau khi stroke kết thúc**, khi ngòi bút nằm trong vùng 10–15% cuối page quá ~250 ms; mỗi bước nhỏ 24–40 px, có thể dừng.
- **Không auto-scroll khi đang ở gap:** nếu pointer ở gap, không chọn page nào; dừng auto-scroll để tránh nhảy page.
- **Cross-page selection:** không hỗ trợ ở P0. Selection là page-local; khi vượt mép page, dừng ở mép. Cross-page selection là feature riêng, không cần cho scroll continuity.
- Apple HIG cũng mô tả đúng case này: khi pointer vượt mép view trong lúc selection, scroll theo hướng pointer (`https://developer.apple.com/design/human-interface-guidelines/scroll-views`, truy cập 2026-10-22).
- Scrble quảng bá “Scrolls the page automatically for uninterrupted and super-fast writing” (`https://www.scrble.com/`, truy cập 2026-10-22) — đây là parity cue cho P1, không phải lý do để làm ẩu ở P0.

### 6.10 Reduced motion

- Continuous scroll bản thân là **user-controlled essential movement**; không tắt scroll. WCAG 2.3.3 chỉ yêu cầu có thể tắt **non-essential motion animation**; Understanding giải thích scrolling làm content mới vào viewport là essential, nhưng “extra animation” khi scroll (parallax, page flip, scale) có thể gây vestibular discomfort (`https://w3c.github.io/wcag/understanding/animation-from-interactions.html`, truy cập 2026-10-22).
- Khi `prefers-reduced-motion: reduce`:
  - Rail click / Go to page: `scrollBehavior = 'auto'` (instant), không smooth.
  - Không bounce/pull animation; không fade/slide khi page materialize; ghost page hiện ngay.
  - Không scale/translate animation khi page add.
  - Nếu có overlay scrollbar, không animate opacity quá lâu; hiện/ẩn tức thì hoặc rất ngắn.
- JS: `matchMedia('(prefers-reduced-motion: reduce)')`; lắng nghe `change` để cập nhật setting runtime.
- CSS: `@media (prefers-reduced-motion: reduce) { ... animation: none; transition: none; scroll-behavior: auto; }`.
- Không dùng “reduced motion” để biến continuous thành single-page; chỉ bỏ animation, giữ nguyên không gian.

### 6.11 Focus, keyboard focus, screen reader

- `#canvasHost`:
  - `tabindex="0"`, `role="region"`, `aria-label="Note pages"`, `aria-describedby="pageScrollHelp"`.
  - `#pageScrollHelp` là text ẩn: “Use Page Up and Page Down to scroll. Press Control plus Page Down for the next page.”
  - Focus ring 2 px accent, offset 2 px; không bị topbar che.
- Rail:
  - Mỗi item là `<button>` (hoặc `role="button"` + `tabindex="0"`), `aria-label="Page 1 of 2"`, `aria-current="page"` cho item active.
  - `#pagesBar` có `role="list"`/`listitem` hoặc `nav aria-label="Pages"`.
  - `Enter`/`Space` kích hoạt jump; focus giữ trên item.
  - `:focus-visible` đã có trong CSS (`style.css:610–615`) nhưng `.pageItem` hiện là `div` không focusable — phải sửa semantics.
- Announce:
  - Chỉ announce khi **explicit navigation** (rail click, Ctrl+PageDown, Add Page): “Page 2 of 5”.
  - Không announce mỗi lần scroll; tránh spam screen reader.
  - `aria-live="polite"` trên một vùng nhỏ, không dùng `role="alert"`.
- Canvas:
  - Các layer `aria-hidden="true"`; canvas không thể truyền nội dung ink cho screen reader.
  - Page rail + page counter là representation cho navigation; không tuyên bố ink accessible.
  - Nếu có page title/text, expose thành text list (future).
- Focus not obscured: `scroll-padding-top: calc(var(--tb-h) + 12px)` trên host; khi focus vào rail item hoặc host, không bị topbar che (WCAG 2.4.11).
- Target size: rail item hiện `min-height:40px`, rộng ~210px; Add Page 38px — đạt WCAG 2.5.8 AA 24×24, nhưng nên nâng Add Page lên 44px nếu muốn AAA/HIG 44×44 (`https://developer.apple.com/design/human-interface-guidelines/buttons`, truy cập 2026-10-22).
- High contrast: border page + focus ring dùng `currentColor`/system color trong `forced-colors`.

### 6.12 Cuối tài liệu: auto-append, ghost page, Add Page

- **Không reset scroll khi append.** Page mới xuất hiện **dưới** page cuối; `scrollTop` giữ nguyên; user cuộn tiếp vào page mới.
- **Auto-append chỉ ở cuối tài liệu**, không phải khi đang ở page 1/2. Điều kiện: `currentPage === last` và `scrollTop >= maxScroll - 2` và page cuối có ink (hoặc user explicit).
- **Ghost sentinel thay vì real blank page:**
  - Nếu page cuối trống, hiển thị một ghost page mờ ở dưới (Journal pattern), không tạo page thật.
  - Khi user scroll vào ghost / tap / bắt đầu viết → materialize thành page thật (một page duy nhất, không append dây chuyền).
  - Nếu page cuối có ink, có thể append real blank page khi scroll past end; vẫn giữ tối đa một blank page ahead.
- **Add Page button** (`#btnAddPage`) và `Ctrl+N`/menu vẫn là đường thay thế không-kéo (WCAG 2.5.7); button append và scroll tới page mới.
- **Pull-to-add** hiện tại: không nên là primary affordance trong continuous mode; có thể giữ như shortcut ẩn, hoặc bỏ ở P1 sau khi user duyệt. Lý do: pull translate cả page, tạo cảm giác “cao su” không cần thiết, và cạnh tranh với native scroll. Nếu giữ, phải có button alternative và hint rõ; không được là đường duy nhất.
- **Không tạo nhiều blank pages** khi wheel lặp; guard “last page blank” và “one blank ahead”. Đây là divergence có chủ đích so với Scrble: hành vi append cả trang trống được ghi ở `scrble-pages-ux-2026-10-20.md:11, 32, 48`; khuyến nghị guard “chỉ append khi trang cuối có ink / tối đa một blank ahead” ở cùng tài liệu `:57–61`.
- **Page number trong gap:** optional. Có thể đặt “Page 2” nhỏ ở gutter trái cạnh page; không đặt trong page vì sẽ ảnh hưởng ink/export. Nếu làm, chỉ là UI overlay, không thuộc document.

### 6.13 Visual cue và scrollbar

- Hiển thị **một phần page kế tiếp** ở đáy viewport khi còn page: đây là cue mạnh nhất, đúng Apple HIG “displaying partial content at the edge… indicates that there’s more content” (`https://developer.apple.com/design/human-interface-guidelines/scroll-views`, truy cập 2026-10-22).
- Gap + border + shadow đủ để phân biệt page; không cần đường kẻ ngang đậm.
- Scrollbar: hiện đang ẩn hoàn toàn. Đề xuất P1: overlay scrollbar 4–6 px, tự ẩn, hoặc progress rail ở mép phải. Không hiển thị page dots + scrollbar cùng trục.
- Counter `(1/2)` giữ; cập nhật theo active page; click counter có thể mở “Go to page” (P2).
- Không dùng animation page flip; không dùng parallax; không dùng scale page khi scroll.

---

## 7. Engineering options

### 7.1 Bài toán bộ nhớ: không thể eager render nhiều trang

Mỗi page hiện có 6 canvas backing store `2500 × 3235`:

```text
2500 × 3235 = 8,087,500 px
× 4 bytes/px = 32,350,000 B ≈ 32.35 MB ≈ 30.85 MiB / canvas
× 6 canvas = 194.1 MB ≈ 185.1 MiB / page
```

| Số page eager | Canvas memory (chỉ backing store) |
|---|---|
| 1 | ~194 MB |
| 2 | ~388 MB |
| 5 | ~970 MB |
| 10 | ~1.94 GB |

Đây là lý do **không** thể chỉ thêm `div` cho từng page rồi render tất cả. Phải windowed.

Preview nhỏ hơn:

- 1/4 linear (625 × 809): `625×809×4 ≈ 2.02 MB`/page.
- 1/2 linear (1250 × 1618): `≈ 8.1 MB`/page.
- Thumbnail 176 × 228: `≈ 160 KB`/page.

### 7.2 Các chiến lược render

| Option | Cách làm | Memory | Complexity | Continuity | Kết luận |
|---|---|---|---|---|---|
| **A. Eager all pages** | Mỗi page có đủ 6 canvas | 194 MB × n | Thấp | Tốt về visual | **Reject** cho note >2–3 trang |
| **B. Active + neighbor preview** | Active page có 6 canvas; ±1 page có preview 1/4 hoặc 1/2; page xa chỉ thumbnail | ~194 MB + 4–16 MB | Trung bình | Tốt; có thể hơi blur ở preview | **Đề xuất** |
| **C. Active only + thumbnail** | Chỉ active có 6 canvas; page khác thumbnail 176px | ~194 MB + 0.16 MB/page | Thấp nhất | Kém: page mới blur/trắng cho tới khi active | Fallback nếu P0 cần cực gấp; không đủ mượt |
| **D. Một canvas khổng lồ** | Một canvas cao bằng tổng tất cả page | O(total height) — 10 page ≈ 323 MB (một canvas), tăng tuyến tính; không có layer riêng | Trung bình | Tốt | **Reject** vì khó layer/undo và vẫn tăng theo số page |
| **E. `content-visibility:auto`** | Mỗi page là DOM/canvas riêng, browser skip render offscreen | Canvas backing vẫn cấp phát | Thấp | Trung bình | Không đủ một mình; có thể kết hợp B |
| **F. Tile rendering** | Chia page thành tile, chỉ render tile trong viewport | Thấp, phức tạp | Cao | Tốt | P2; không cần cho P0 |

**Đề xuất:** Option B. Active page dùng đúng 6 layer hiện tại; hai page lân cận dùng preview bitmap 1/4–1/2; page xa dùng thumbnail. Khi active page đổi, **move** `#canvasStack` vào slot mới, render full; preview của slot cũ được cập nhật từ thumbnail/cache. Không tạo 6 canvas mới cho mỗi page.

### 7.3 P0 — bản tối thiểu để hết “tách”

Mục tiêu: scroll liên tục qua page, không reset, có page kế tiếp thấy được, rail sync, keyboard cơ bản, không phá save/ink.

1. **DOM/layout**
   - Thêm `#pageStack` bên trong `#canvasHost`.
   - Mỗi page có `.pageSlot` định vị theo `top` từ layout cache; slot width/height = doc size × zoom; gap 16 CSS px.
   - `#canvasStack` (6 layer) là con của active slot; `#stackInner` vẫn transform scale(zoom).
   - `.pagePreview` (bitmap) cho mọi slot; active slot ẩn preview khi canvas đã render.
   - `#pageStack` height = tổng slot + gap + padding; `#canvasHost` vẫn là scroll container duy nhất.

2. **Layout model**
   - `S.pageLayout = [{ id, top, width, height }]`.
   - Recompute on: open note, add/delete page, zoom, resize, paper/orientation change.
   - `fitZoom` dùng max doc width của note, không dùng page hiện tại; không gọi lại khi chỉ đổi page.

3. **Active page từ scroll**
   - `scroll` listener passive, coalesce bằng `requestAnimationFrame`.
   - Tính `centerY = scrollTop + clientHeight/2`; tìm page chứa center; hysteresis 8 px.
   - Nếu active đổi: `activatePage(i, { fromScroll: true })` — **không** scroll, chỉ move canvas/render/update rail/title/undo.
   - Prefetch page ±1 khi gần viewport (IntersectionObserver hoặc layout threshold).

4. **`setPage` / `activatePage`**
   - Tách “mở note” (reset về page 0/top) khỏi “đổi page khi đang đọc” (giữ scroll).
   - `activatePage(i, { reveal })`: nếu `reveal` thì scroll tới slot top; nếu từ scroll thì không.
   - Bỏ `scrollTop=0` khỏi page switch.
   - `clearSelection()` chỉ khi active page thực sự đổi; không clear khi scroll trong cùng page.

5. **Wheel**
   - Bỏ điều kiện `currentPage !== last` khỏi đường scroll thường; native scroll tự đi qua page.
   - Giữ nhánh “ở đáy page cuối” để append/ghost; bỏ `scrollTop=0` sau `addPage()`.
   - Không `preventDefault` cho wheel thường; chỉ Ctrl/Cmd+wheel zoom.
   - Không dùng `deltaY` để suy ra hướng page; đọc `scrollTop`.

6. **CSS**
   - `#pageStack { padding: 24px 0; }`
   - `.pageSlot { position:absolute; left:50%; transform:translateX(-50%); border:1px solid ...; border-radius:2px; box-shadow:...; background:...; }`
   - Gap 16 px; `#canvasHost { overscroll-behavior: contain; }`
   - `scroll-padding-top: calc(var(--tb-h) + 12px);`
   - Bỏ shadow khỏi `#canvasStack` (chuyển sang slot) để shadow không bị clip khi active canvas move.
   - `#canvasHost::-webkit-scrollbar` giữ ẩn ở P0; P1 thêm overlay.

7. **Rail**
   - `buildRail()` khi page count đổi; `syncRail()` khi active đổi.
   - `drawThumb` async/idle; cache; chỉ update page dirty.
   - Click rail → `scrollToPage(i)`, không `setPage` reset.

8. **Keyboard**
   - `#canvasHost tabindex=0`; PageUp/PageDown; Ctrl/Cmd+PageUp/Down; Home/End; arrow.
   - Không xử lý khi `isTextEditing()`.

9. **Save/thumbnail không chặn scroll**
   - `sanitizePage()` chỉ start async save; không chờ flatten trước khi đổi active.
   - `saveCurrentPage()` snapshot page/idx như hiện tại; defer `flattenBytes` ra sau frame hoặc idle nếu có thể.
   - Không gọi `refreshPages()` trong scroll handler.

10. **Test tối thiểu**
    - Unit: layout top/height, pageAtY, anchor compensation.
    - Integration: fixture 2 page + 10 page; wheel boundary; rail; keyboard; insert/delete.
    - Manual: wheel/trackpad/touch/pen; dark mode; zoom; reduced motion.

### 7.4 P1 — mượt và đầy đủ

- Preview 1/2 hoặc 1/4 cho ±1 page; cache bitmap; release khi xa.
- Async thumbnail generation (`OffscreenCanvas`/idle) và thumbnail cache; không flatten full page mỗi lần active.
- Overlay scrollbar/progress rail; page number trong gutter.
- Auto-scroll selection/text; writing auto-scroll sau stroke.
- Touch policy: two-finger scroll/pinch, “Touch drawing” toggle, palm rejection.
- `aria-live` cho explicit page jump; focus management; `scroll-padding`; target 44px.
- Single Page mode (opt-in) dùng snap; Presentation Mode.
- Giảm layer: gộp paper/raster nếu có thể; tile rendering nếu note lớn.
- Performance instrumentation: `PerformanceObserver` long tasks, FPS, memory.

### 7.5 P2 — tối ưu / mở rộng

- Tile-based rendering + GPU cache cho note rất dài.
- Minimap/page overview; “Go to page” input.
- Two-page spread (ngang) như Scrble 7.2; chỉ khi user cần.
- Cross-page selection/lasso (feature riêng, không cần cho scroll).
- Infinite journal style (Samsung “Infinite scrolling”) — **không** đề xuất; khác page model, phá export/page-based.
- Scroll-linked page transitions/3D — **không** đề xuất; vi phạm reduced-motion và không cần.

### 7.6 Mapping code hiện tại → thay đổi

| Hiện tại | Đề xuất |
|---|---|
| `#canvasStack` là scroll content | `#pageStack` là scroll content; `#canvasStack` là active layer trong slot |
| `applyTransform()` size `#canvasStack` theo current page | `applyTransform()` size active `#canvasStack`; layout size từng slot |
| `pageCoords()` dùng một `#stackInner` rect | `pageCoords(e, page)` dùng rect của active slot; pointer ngoài page/gap → ignore |
| `setPage()` reset scroll | `activatePage()` giữ scroll; `openNote()` reset |
| `refreshPages()` rebuild + draw all | `buildRail()` + `syncRail()` + `refreshThumb(i)` |
| `addPage()` → `setPage(last)` | append slot/layout; nếu explicit thì scroll tới; nếu auto thì giữ scroll |
| wheel chỉ last page | native scroll mọi page; last-page overscroll append |
| `fitZoom()` theo current page | fit theo max width; không đổi khi page switch |
| `sanitizePage()` save sync trước switch | start async save; không block frame |

---

## 8. Accessibility

### 8.1 WCAG 2.2 mapping

Nguồn chung: `https://w3c.github.io/wcag/guidelines/22/` (truy cập 2026-10-22). Các Understanding page dùng mirror `w3c.github.io` vì `www.w3.org/WAI/...` trả 403 khi fetch trực tiếp.

| Tiêu chí | Yêu cầu | Áp dụng cho page scroll |
|---|---|---|
| **2.1.1 Keyboard (A)** | Mọi chức năng operable qua keyboard, trừ input path-dependent | Host focusable; PageUp/Down, Ctrl+PageUp/Down, Home/End, rail Enter/Space |
| **2.2.2 Pause, Stop, Hide (A)** | Moving/scrolling information tự động >5 s phải có pause/stop/hide, trừ essential | Native user scroll không tự chạy; nếu thêm auto-scroll/auto-advance, phải có cách dừng; không auto-advance page |
| **2.3.3 Animation from Interactions (AAA)** | Motion animation do interaction phải disable được, trừ essential | Bỏ smooth/bounce/fade khi reduced motion; không page-flip/parallax |
| **2.4.7 Focus Visible (AA)** | Keyboard focus indicator visible | Host + rail + Add Page có `:focus-visible` 2 px, contrast ≥3:1 |
| **2.4.11 Focus Not Obscured (Minimum) (AA)** | Focused component không bị author content che hoàn toàn | `scroll-padding-top` bằng topbar; rail item focus không bị che |
| **2.5.7 Dragging Movements (AA)** | Mọi chức năng drag có alternative single-pointer không drag | Pull-to-add phải có Add Page button; scroll là UA gesture (exception), nhưng custom overscroll vẫn nên có button |
| **2.5.8 Target Size (Minimum) (AA)** | ≥24×24 CSS px | Rail item 40px; Add Page 38px → đạt AA; nên nâng 44px |
| **2.5.5 Target Size (Enhanced) (AAA)** | ≥44×44 CSS px | Khuyến nghị cho Add Page/rail nếu muốn AAA/HIG |
| **1.4.10 Reflow (AA)** | Không scroll 2 chiều ở 320px width, trừ ngoại lệ 2D | Page canvas là 2D exception; chrome/rail phải reflow; không đặt control ngoài viewport |

**Trích dẫn chính:**

- 2.1.1: “All functionality of the content is operable through a keyboard interface without requiring specific timings for individual keystrokes…” (`https://w3c.github.io/wcag/guidelines/22/#keyboard`).
- 2.3.3: “Motion animation triggered by interaction can be disabled, unless the animation is essential to the functionality or the information being conveyed.” (`https://w3c.github.io/wcag/understanding/animation-from-interactions.html`).
- 2.5.7: “All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging…” (`https://w3c.github.io/wcag/guidelines/22/#dragging-movements`).
- 2.4.11: “When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content.” (`https://w3c.github.io/wcag/guidelines/22/#focus-not-obscured-minimum`).

### 8.2 Screen reader semantics

- Canvas ink không có text alternative; không thể nói “screen reader đọc được nét vẽ”. Phải expose **page navigation** như một list/region có label.
- `#canvasHost` là `region` có label; `#pagesBar` là `nav`/`list` các button page.
- Mỗi page item: `aria-label="Page 1 of 2"`, `aria-current="page"` khi active.
- Live region chỉ announce explicit jump; text ngắn “Page 2 of 2”.
- Khi page add: announce “Page 3 added” (polite), không announce mỗi lần scroll.
- Focus order: topbar → rail → canvas host → rail? Không để canvas host “nuốt” Tab; host chỉ một tab stop.
- Nếu có text box/page title, expose text; ink vẫn là visual-only.

### 8.3 Focus not obscured

- Topbar cao `--tb-h`; `scroll-padding-top: calc(var(--tb-h) + 12px)`.
- Khi Tab tới rail item, browser scroll rail (không phải canvas) để item visible; rail có `overflow-y:auto`.
- Khi Ctrl+PageDown, host vẫn focus; page top align dưới topbar, không bị che.
- Nếu page number chip nằm trong gutter, không đặt nó trong vùng focus của host.

### 8.4 Reduced motion + zoom

- `prefers-reduced-motion` xử lý như §6.10.
- Browser zoom 200%/400%: page canvas có thể phải horizontal scroll (2D exception), nhưng toolbar/rail không được tràn; gap 16 px vẫn 16 CSS px.
- Không dùng `transform: scale()` cho text UI; chỉ canvas page.
- High contrast: border page dùng system color; focus ring không phụ thuộc shadow.

---

## 9. Acceptance criteria và test plan

### 9.1 Functional acceptance

| ID | Tiêu chí | Cách đo / pass |
|---|---|---|
| **F1** | Ở đáy page 1/2, wheel xuống đi vào page 2 | `scrollTop` tăng > 0; active page đổi; không cần rail |
| **F2** | Không reset scroll khi đổi page | `scrollTop` trước/sau khi active đổi không nhảy về 0; page 2 top nằm đúng vị trí |
| **F3** | Scroll ngược từ page 2 lên page 1 mượt | Wheel lên qua boundary; không nhảy; page 1 đáy hiện ra |
| **F4** | Rail click nhảy đúng page | `scrollToPage(i)`; page top align; `aria-current` đúng; focus giữ rail |
| **F5** | Active page sync khi scroll | Trong 100 ms sau khi center đổi, rail/counter/undo cập nhật; không rebuild rail |
| **F6** | Keyboard | PageDown cuộn ~87.5% viewport; Ctrl+PageDown next page; Home/End page; focus ring visible |
| **F7** | Append ở cuối tài liệu | Ở đáy page cuối, scroll thêm tạo đúng một page/ghost; `scrollTop` không reset; page mới ở dưới |
| **F8** | Ghost/blank guard | Page cuối trống → ghost, không tạo real blank; scroll lặp không inflate page count |
| **F9** | Insert/delete above anchor | Insert page trên viewport: nội dung đang xem giữ nguyên (sai lệch ≤1 px); delete above: không nhảy |
| **F10** | Gap/zoom | Gap = 16 CSS px ở 50%, 100%, 200%; page slot căn giữa; không horizontal overflow khi fit |
| **F11** | Input | Wheel/trackpad đi qua boundary; pen không scroll; stroke clip ở page edge; two-finger touch scroll |
| **F12** | Reduced motion | Rail jump instant; không bounce/fade/smooth khi `reduce` |
| **F13** | A11y | Host tabindex; rail button; aria-current; live announce explicit jump; focus không bị topbar che |
| **F14** | Visual | Page kế tiếp lộ ra ở đáy; gap/border/shadow; không cắt shadow trang đầu/cuối; dark mode |
| **F15** | Regression | Save/export từng page; undo/redo theo page; ruler page-local; selection page-local; title/counter đúng |
| **F16** | Note 71 untouched | Không có thay đổi file note/file save trong quá trình test research |

### 9.2 Performance acceptance

| ID | Tiêu chí | Cách đo |
|---|---|---|
| **P1** | 60 fps khi scroll 2 page | Frame budget trung bình <16.7 ms; không long task >50 ms trên máy test hiện tại |
| **P2** | Không eager 6 canvas/page | Số full canvas layer ≤1 bộ; preview ≤2; kiểm tra DOM/canvas count |
| **P3** | Rail không rebuild khi scroll | `#pagesBar.children.length` không đổi; chỉ class/aria-current đổi |
| **P4** | Thumbnail không flatten mỗi scroll | Không gọi `flattenToCanvas`/`toDataURL` trong scroll handler; chỉ khi save/idle |
| **P5** | Save không chặn page switch | Page switch hoàn tất trước khi flatten/encode xong; không frame >50 ms do save |
| **P6** | Memory bounded | 10-page fixture: không tăng ~194 MB/page; active + preview trong ngưỡng đã chọn |

### 9.3 Test plan

**Unit tests (Node, `tests/*.test.mjs`):**

- `pageLayout`: 0/1/3 page; mixed heights; gap; padTop/padBottom.
- `pageAtY`: center in page; center in gap; hysteresis.
- `anchor`: insert above, delete above, delete anchor page; scrollTop restore.
- `clampScroll`: không vượt max; empty note.

**Integration (Playwright/Electron hoặc CDP):**

- Fixture 2 page: mở, scroll đáy page 1, wheel, assert `scrollTop` và active page.
- Fixture 10 page: rail click page 10, assert scroll; scroll ngược; rail class.
- Keyboard: focus host, PageDown ×N, Ctrl+PageDown, Home/End.
- Insert/delete above: assert anchor.
- Zoom: 50/100/200; assert gap 16 và page alignment.
- Reduced motion: emulate media; assert no smooth/bounce.
- A11y: axe hoặc DOM assertions cho `tabindex`, `aria-current`, labels.

**Manual:**

- Mouse wheel, trackpad (momentum), touch (two-finger), pen (draw, barrel, eraser).
- Dark mode; high contrast; 200%/400% zoom.
- Screen reader: NVDA (Windows), VoiceOver (macOS) — navigation, page announce, focus.
- Long note 50–100 pages: scroll nhanh, memory, rail.
- Save/export/undo/ruler/selection regression.

**Không dùng note 71.** Fixture phải được tạo trong test hoặc copy ra temp; note 71 chỉ dùng để đo read-only trước khi triển khai.

### 9.4 Pass/fail gate

- P0 chỉ được coi là “done” khi F1–F10, F15, F16 và P1–P3 pass.
- P1 done khi F11–F14, P4–P6 pass.
- Không chấp nhận “gap đẹp nhưng wheel vẫn dead-end”; F1 là gate cứng.

---

## 10. Risks và open questions

### 10.1 Risks

| Risk | Khả năng | Tác động | Mitigation |
|---|---|---|---|
| Multi-page pointer mapping sai (vẽ lệch/xuyên trang) | Cao | Cao | `pageCoords(e, page)` theo slot; test pen ở mép/gap; clip stroke |
| Memory tăng do eager canvas | Cao | Cao | Option B windowed; preview nhỏ; không render 6 layer/page |
| Jank do rail rebuild/thumbnail | Cao | Trung bình | Build một lần; async thumb; cache; không flatten trong scroll |
| Auto-append tạo nhiều blank page | Trung bình | Trung bình | Ghost sentinel + guard last blank + one blank ahead |
| Scroll anchoring sai khi insert/delete | Trung bình | Cao | Capture/restore anchor; `overflow-anchor:none` khi mutate; test |
| Touch/pen policy phá thói quen vẽ bằng ngón tay | Trung bình | Cao | Giữ default hiện tại; toggle “Touch drawing”; two-finger scroll |
| Focus/screen reader regression | Trung bình | Cao | Host tabindex, rail button, aria-current, live region; test NVDA/VoiceOver |
| Save race khi scroll nhanh qua nhiều page | Trung bình | Cao | Snapshot page/idx; async queue; flush trước note switch/close; test |
| Gap 16 không hợp gu | Thấp | Thấp | Token `--page-gap`; user chọn 8/16/24 |
| Test làm bẩn note 71 | Thấp | Cao | Không test trên note 71; fixture/copy; read-only CDP |

### 10.2 Open questions

1. **Default hay opt-in?** — câu hỏi quyết định chính; xem §11.
2. **Gap 16 px có đúng gu không?** — 8/16/24 đều hợp lý; 16 là default đề xuất, có thể đổi token.
3. **Có giữ Single Page mode không?** — nếu continuous default, Single Page nên là opt-in cho presentation; nếu user muốn giữ hành vi cũ, có thể làmview mode.
4. **Touch drawing default?** — hiện tại một ngón tay vẽ; có nên đổi sang one-finger scroll khi không có pen? Đề xuất giữ default, thêm toggle.
5. **Auto-append hay ghost?** — đề xuất ghost sentinel; cần user duyệt vì khác Scrble.
6. **Scrollbar ẩn hay overlay?** — ẩn giữ sạch; overlay giúp định vị. Đề xuất overlay P1.
7. **Page number trong gutter?** — optional; có thể gây clutter.
8. **Mixed paper size/orientation?** — fit theo max width; cần test note có A4/Letter/landscape.
9. **Restore last page/scroll khi mở note?** — hiện mở page 0/top; continuous có thể restore; ngoài scope P0.
10. **Cross-page selection?** — đề xuất không; nếu user cần, feature riêng.
11. **Hiệu năng trên note 100+ trang?** — cần fixture; P1/P2.
12. **Electron/Chromium version ảnh hưởng `overflow-anchor`?** — test thực tế; không dựa vào spec.

---

## 11. Quyết định cần user duyệt

### D1 — Continuous scroll là **default** hay **opt-in**?

**Phương án A (khuyến nghị): Continuous là default; Single Page là opt-in.**

- Ưu: sửa đúng dead-end hiện tại; parity với Scrble/Xournal/Journal/Notability Seamless; một trải nghiệm đọc/viết liền mạch; ít modal.
- Nhược: thay đổi hành vi; cần đầu tư P0 (page slot, windowed render, input mapping, rail sync, a11y); cần test kỹ.
- Điều kiện: P0 pass F1–F10/F15/F16; Single Page mode (nếu cần) làm sau như opt-in.

**Phương án B: Continuous là opt-in, giữ single-page default.**

- Ưu: an toàn, không phá thói quen hiện tại; dễ rollback.
- Nhược: dead-end vẫn là trải nghiệm mặc định; hai code path; discoverability kém; vẫn phải sửa wheel/page navigation cho single-page.
- Nếu chọn B, P0 tối thiểu vẫn phải: wheel ở đáy page 1/2 đi page 2 (hoặc PageDown/Ctrl+PageDown), không reset scroll khi chỉ đổi page; continuous là setting.

**Khuyến nghị:** **A**, vì đây là parity fix cho page scroll (không phải thay đổi công cụ), và vì hiện trạng là lỗi trải nghiệm rõ ràng. Tuy nhiên, tài liệu này **không tự quyết định**; cần user duyệt trước khi code.

**Gap default đi kèm:** 16 CSS px; nếu user muốn 8/24, chỉ đổi token, không đổi kiến trúc.

---

## 12. References

### 12.1 Nội bộ / code / live

| Nguồn | Loại | Đường dẫn / giá trị | Ngày |
|---|---|---|---|
| Scrble pages UX | [SCRBLE] | `docs/research/scrble-pages-ux-2026-10-20.md` | 2026-10-20 |
| Scrble behavior deep dive | [SCRBLE] | `docs/research/scrble-behavior-deep-dive.md` | 2026-10-19 |
| UI polish patterns | [SPEC]/[OFFICIAL] | `docs/research/ui-polish-patterns-2026-10-20.md` | 2026-10-20 |
| Inking app landscape | [OFFICIAL]/[COMMUNITY] | `docs/research/inking-app-landscape.md` | 2026-10-19 |
| Ruler UX conventions | [SPEC]/[CODE] | `docs/research/ruler-ux-2026-10-22.md` | 2026-10-22 |
| Editor code | [CODE] | `src/js/editor.js:151–154, 158–170, 241–276, 357–408, 411–424, 449–462, 585–604, 1472–1492, 1657–1713, 2621–2696` | HEAD `22256bd` |
| CSS | [CODE] | `src/style.css:228–241, 610–619, 725–729` | HEAD `22256bd` |
| DOM | [CODE] | `src/index.html:81–100` | HEAD `22256bd` |
| Live app | [CODE] | CDP `http://127.0.0.1:9222`; target `Untitled 10 (1/2)`; viewport 1536×912 DPR 1.25; host 1313×778; scrollTop 858.4/859; wheel 120 → 0 | 2026-10-22 |

### 12.2 Vendor official

| Nguồn | Loại | URL | Ngày truy cập |
|---|---|---|---|
| Scrble FAQ | [OFFICIAL] | `https://www.scrble.com/faq/` | 2026-10-22 |
| Scrble keyboard shortcuts | [OFFICIAL] | `https://www.scrble.com/faq-items/what-are-scrble-keyboard-shorcuts/` | 2026-10-22 |
| Scrble homepage (auto-scroll) | [OFFICIAL] | `https://www.scrble.com/` | 2026-10-22 |
| GoodNotes zoom/pan/scroll | [OFFICIAL] | `https://support.goodnotes.com/hc/en-us/articles/6554036735631-Zoom-pan-and-scroll-through-pages-in-Goodnotes` | 2026-10-22 |
| Notability note view settings | [OFFICIAL] | `https://support.gingerlabs.com/en-us/articles/16300185-note-view-settings` | 2026-10-22 |
| Microsoft Journal pages | [OFFICIAL] | `https://support.microsoft.com/en-us/journal/working-with-pages` | 2026-10-22 |
| OneNote keyboard shortcuts | [OFFICIAL] | `https://support.microsoft.com/en-us/accessibility/onenote/keyboard-shortcuts-in-onenote` | 2026-10-22 |
| OneNote page templates | [OFFICIAL] | `https://support.microsoft.com/en-us/onenote/create-or-customize-page-templates` | 2026-10-22 |
| Microsoft Whiteboard infinite canvas | [OFFICIAL] | `https://support.microsoft.com/en-us/whiteboard/unleash-ideas-on-microsoft-whiteboard-s-infinite-canvas` | 2026-10-22 |
| Samsung Notes note styles | [OFFICIAL] | `https://www.samsung.com/us/support/answer/ANS10004548` | 2026-10-22 |
| Xournal manual | [OFFICIAL] | `https://xournal.sourceforge.net/manual.html` | 2026-10-22 |
| Xournal++ guide | [OFFICIAL] | `https://xournalpp.github.io/guide/whirlwind-tour/` | 2026-10-22 |
| Apple Notes User Guide | [OFFICIAL] | `https://support.apple.com/guide/notes/welcome/mac` | 2026-10-22 |
| Apple Freeform User Guide | [OFFICIAL] | `https://support.apple.com/guide/freeform/welcome/mac` | 2026-10-22 |
| Apple HIG Scroll views | [OFFICIAL] | `https://developer.apple.com/design/human-interface-guidelines/scroll-views` | 2026-10-22 |
| Apple HIG Motion | [OFFICIAL] | `https://developer.apple.com/design/human-interface-guidelines/motion` | 2026-10-22 |

### 12.3 Spec / standards

| Nguồn | Loại | URL | Ngày truy cập |
|---|---|---|---|
| WCAG 2.2 spec | [SPEC] | `https://w3c.github.io/wcag/guidelines/22/` | 2026-10-22 |
| WCAG 2.2.2 Understanding | [SPEC] | `https://w3c.github.io/wcag/understanding/pause-stop-hide.html` | 2026-10-22 |
| WCAG 2.3.3 Understanding | [SPEC] | `https://w3c.github.io/wcag/understanding/animation-from-interactions.html` | 2026-10-22 |
| WCAG 2.5.7 Understanding | [SPEC] | `https://w3c.github.io/wcag/understanding/dragging-movements.html` | 2026-10-22 |
| MDN overflow-anchor | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor` | 2026-10-22 |
| MDN scroll-snap-type | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-snap-type` | 2026-10-22 |
| MDN overscroll-behavior | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior` | 2026-10-22 |
| MDN scroll-behavior | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-behavior` | 2026-10-22 |
| MDN prefers-reduced-motion | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion` | 2026-10-22 |
| MDN wheel event | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event` | 2026-10-22 |
| MDN touch-action | [SPEC] | `https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action` | 2026-10-22 |

### 12.4 Community / chưa xác minh

| Nguồn | Loại | URL / ghi chú | Ngày |
|---|---|---|---|
| Apple Discussions “one long continuous note” | [COMMUNITY] | `https://discussions.apple.com/thread/252116929` | 2026-10-22 |
| Xournal++ continuous/one-page discussion | [COMMUNITY] | `https://github.com/xournalpp/xournalpp/discussions/6766` — trích lại Xournal manual; không phải tài liệu chính thức của Xournal++ | 2026-10-22 |
| Scrble exact page gap/snap | n/d | Không có tài liệu chính thức; không đo được từ screenshot | 2026-10-22 |
| Notability default view | n/d | Trang official không nói default Seamless hay Single Page | 2026-10-22 |
| Samsung exact separator/gap px | n/d | Trang official chỉ nói “fixed separators”, không có số đo | 2026-10-22 |
| GoodNotes exact page gap/snap | n/d | Trang official chỉ nói scroll direction/gesture | 2026-10-22 |

### 12.5 Nguồn fetch fail / cách xử lý

- `https://www.w3.org/WAI/WCAG22/Understanding/...` trả **403** khi fetch trực tiếp (Cloudflare). Đã dùng mirror `https://w3c.github.io/wcag/understanding/...` và `https://w3c.github.io/wcag/guidelines/22/` — cùng nội dung editor’s draft.
- GoodNotes support trả **403** qua PowerShell; đã đọc qua reader và trích đúng đoạn “Swipe in the direction configured for the document”.
- Không tìm thấy nguồn chính thức cho gap px/shadow/snap của các app; mọi con số 0/8/16/24 là **đề xuất**, không phải parity claim.

---

## 13. Trạng thái tài liệu

- **Đây là research + proposal, chưa triển khai.**
- Không sửa `src/**`, `main/**`, tests, hay note 71.
- Baseline `22256bd`; ngoài file tài liệu này, `git status` chỉ có `writecanvas.zip` untracked.
- Kết luận mạnh nhất: **single-page model + scroll reset + wheel dead-end** là nguyên nhân chính; continuous stack + native scroll + active-page-from-scroll là hướng sửa.
- Đề xuất cụ thể: gap 16 CSS px; không snap; windowed render; rail sync; keyboard; reduced motion; a11y.
- **Cần user duyệt D1** (continuous default vs opt-in) trước khi viết code.

---

## 14. Addendum 2026-10-24 — phần đã ship (additive, chưa phải continuous stack)

Để trả lời phản hồi “2 trang chả liên quan, kéo xuống không kéo lên được”, đã ship một bản sửa **nhỏ, cộng thêm** thay vì đổi kiến trúc:

- **Biên đối xứng:** kéo/chạm ở đáy trang sẽ sang trang kế (hoặc thêm trang nếu là trang cuối); kéo ở đỉnh trang sẽ về trang trước và dừng ở **đáy** trang đó. Trang đầu không wrap, không hiện hint.
- **Neighbour peek:** trong lúc kéo, một dải giấy của trang kề (kèm nhãn `Page N` / `New page` và seam 10 px) được vẽ vào đúng khoảng trống mà thao tác kéo mở ra. Trang hiện tại và trang kề cùng dịch chuyển nên phép kéo đọc như một chồng giấy liên tục, không còn là “đổi màn hình”.
- **Entry animation theo hướng:** trang kế trượt lên 26 px/220 ms, trang trước hạ xuống cùng biên độ; tôn trọng `prefers-reduced-motion`.
- **Scroll memory theo trang:** quay lại trang cũ giữ vị trí đọc; trang mới mở ở đầu trang.
- QA: `scripts/qa-5b.mjs` phủ cả hai biên, peek, nhãn, vị trí hạ cánh và trường hợp trang đầu.

**Chưa ship:** continuous stack thật (nhiều `InkCanvas` trong một `ScrollViewer`, active-page-from-scroll, windowed render). Đề xuất D1 ở mục 11 vẫn cần user duyệt; peek hiện tại chỉ là lớp illusion một trang.

