# Scrble Ink — nghiên cứu sâu: mô hình trang, cử chỉ kéo và "thả để thêm trang mới"

> **Ngày:** 2026-10-19 · **Loại:** tài liệu nghiên cứu chỉ-đọc (không sửa code) · **Đích:** WriteCanvas (bản Electron rewrite của Scrble Ink)
>
> **Bằng chứng sơ cấp dùng trực tiếp:** bản .appx đã giải nén tại `C:\Users\Admin\AppData\Local\Temp\opencode\appx-x` (manifest `10511ClaudiaWey.inknotespro` v6.8.6.0, `PublisherDisplayName: Claudia Wey`), 21 ảnh Help (mục 5), chuỗi tài nguyên trong `resources.pri` (đã trích chuỗi + carve 111 khối XBF nhúng) và `InkNotes.xr.xml`. Không chạy app, không mở `.pfx`, không đụng `D:\The Vault\ScrbleInk\` ngoài bản appx đã giải nén.
>
> **Phương pháp:** chỉ dùng nguồn sơ cấp — trang chính chủ scrble.com, Microsoft Learn / support.microsoft.com, tài liệu hỗ trợ chính chủ của từng app, và các trang cộng đồng (Samsung Community, Reddit) được đánh dấu rõ là **cộng đồng**. Mọi khẳng định đều kèm URL. Sơ đồ trợ giúp in-app (mục 5) được mô tả trực tiếp từ ảnh gốc — coi là bằng chứng từ chính app.
>
> **Tài liệu liên quan:** `scrble-feature-inventory.md` (bằng chứng nhị phân: bút, màu, giấy, save/export), `inking-app-landscape.md` (bối cảnh app cạnh tranh tổng thể), `ui-parity-scrble.md` (UI đã khớp 1:1). Tài liệu này **không lặp lại** nội dung đó; nó đi sâu đúng vào page model + cử chỉ kéo + chuẩn InkToolbar.

---

## 1. TL;DR

1. **Scrble Ink KHÔNG có cử chỉ "kéo xuống để tạo trang mới".** Tạo/xoá/sắp xếp trang trong Scrble làm bằng **nút/menu**: menu trên rail thumbnail bên trái (`Insert/Duplicate/Delete/Refresh/Select Pages`), flyout khi tap vào chỉ số trang; việc viết vượt đáy trang được xử lý bằng **auto-scroll** và trang mới được sinh trong runtime (theo câu chữ trong release notes). — nguồn binary: `resources.pri`, XBF `PagesPreviewList` / `PageSelectionToolbar`; web: https://www.scrble.com/release-notes/
2. Cử chỉ "kéo" duy nhất được tài liệu hoá của Scrble là **Vertical Spacer** (6.8.0): *kéo một đường kẻ lên/xuống để thêm/giảm khoảng trắng dọc trong trang hiện tại hoặc xuyên qua hai trang liên tiếp*. — nguồn: https://www.scrble.com/ , https://www.scrble.com/6-8-0/ , ảnh `Assets\Help\CurrentTip.png`
3. Bộ cử chỉ chính thức app tự dạy (help "Gesture"): **double-tap = bật/tắt zoom ×2**, **pinch = zoom**, **hai ngón kéo = pan**. — nguồn binary: XBF `HelpGesture` + ảnh `Assets\Help\{ZoomToggle,Zoom,Pan}.png` (mục 5)
4. **Samsung Notes** là app duy nhất trong phạm vi khảo sát có cử chỉ kéo–thả-để-tạo-trang được mô tả trong câu trả lời chính thức trên Samsung Community: kéo trang sang trái (cuộn ngang) hoặc kéo lên (cuộn dọc) đến khi hiện *"release to add page"*, rồi thả để tạo trang. — nguồn: https://us.community.samsung.com/t5/Galaxy-Note-Phones/Page-Break-on-Samsung-Notes/td-p/3420763 (cộng đồng)
5. Chuẩn UWP InkToolbar (Microsoft Learn): **click = kích hoạt tool; click lần nữa trên nút đang hoạt động (nút có "extension glyph") = mở flyout**; eraser flyout có lệnh *Erase All Ink*; ruler/protractor là stencil: nét bút được **snap vào mép** trong khoảng "gutter", mực không vẽ được dưới stencil; laser pointer vẽ vệt tự tắt và **không được lưu**. — nguồn: https://learn.microsoft.com/en-us/windows/apps/design/input/ink-toolbar , https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls
6. Khuyến nghị (mục 6): giữ đúng linh hồn Scrble (auto-scroll + spacer) và **thêm** cử chỉ "kéo vượt đáy ~96 px → placeholder trang mới → thả để commit" theo mô hình Samsung; spacer làm công cụ riêng theo kiểu đường kẻ kéo. Chi tiết ngưỡng ở mục 6.

## 2. Scrble Ink — cụ thể hoá app

### 2.1 Bản thể và phiên bản

- Store ID `9N5CF2MN39LV`; phát hành 2018-04-28; giá hiện hành $9.99 (từng ở mức $16.99); rating 4.5 (319 đánh giá); mô tả Store: *"Scrble Ink is an extremely simple app for freehand writing on Windows tablets… use two fingers to enlarge or move the selection."* — nguồn (mirror nội dung Store): https://appagg.com/windows/productivity/scrble-ink-31449988.html
- Bản appx đang xét: identity `10511ClaudiaWey.inknotespro` v6.8.6.0 (4/2021), hiển thị "Scrble Ink", tác giả "Claudia Wey". — nguồn: `C:\Users\Admin\AppData\Local\Temp\opencode\appx-x\AppxManifest.xml` (sơ cấp)
- Trang chủ chia công năng thành 3 cụm: **Writing** (auto-scroll, format text, chọn giấy + border line, nền bảng đen, spacer dọc), **Drawing** (bút/nhiều màu, shape gallery + nhận dạng hình vẽ tay, xoay/resize selection, eyedropper, ruler/protractor), **Work on anything** (PDF/ảnh import + annotate, trace ảnh, chụp ảnh, recognizer, auto-naming, tìm note trong gallery). — nguồn: https://www.scrble.com/
- Video chính thức "Introduction To Scrble Ink (3:30)" nhúng tại trang hỗ trợ; FAQ dẫn video 3 phút cấu hình save location: https://youtu.be/Ngff5BjWnp0 — nguồn: https://www.scrble.com/tutorials/ , https://www.scrble.com/faq/
- Cảm nhận cộng đồng (r/Surface 2018–2021): app được đón như *"exactly like GoodNotes… There is pagination… when you print to PDF nothing is cut off"*. — nguồn: https://www.reddit.com/r/Surface/comments/m6i43k/notability_and_goodnotes_alternative_for_windows/ (cộng đồng); review chi tiết: https://www.reddit.com/r/Surface/comments/9pu14u/ (cộng đồng)

### 2.2 Mô hình trang & điều hướng

**Mô hình lưu trữ:** note = thư mục, mỗi trang = một file PNG đặt tên `Tiêu đề#1, #2, …`; dự án = thư mục con trong thư mục gốc `Scribble`. — nguồn: https://www.scrble.com/faq/ ("Notes are saved as one file per page. The files are named using the title and then appending #1, #2, etc.") — khớp bằng chứng nhị phân đã ghi trong `scrble-feature-inventory.md` (trang 2500×3235 px @294.117 dpi).

**Khung editor (XBF, sơ cấp):** thanh dưới có `PageSelectionToolbar` (Delete, Duplicate, TwoPage, ExportPDF, Share, Email, Mail, Print + `SelectionCounter`); vùng nội dung gồm `PagesPreviewList` (rail bên trái) + `SheetManager` (`_PagesVerticalStack` bên trong `_SheetsScrollViewer`). — nguồn: carve XBF từ `resources.pri`

Cách chuyển/nhảy trang trong Scrble:

| Cách | Bằng chứng |
|---|---|
| **Rail thumbnail bên trái** — menu flyout: `Insert`, `Duplicate`, `Delete`, `Refresh`, `Select Pages`, `Clear Selection`; tap thumbnail = nhảy trang; drag để sắp xếp lại (states `ReorderHintStates`, `ReorderedPlaceholder`, `DraggedPlaceholder`) | XBF `PagesPreviewList` (sơ cấp); khớp ảnh demo "display-page-preview" và mô tả "The side panel with the list of all pages is opened by default when loading a document to provide an overview of the document and to jump to a specific page quickly" — nguồn: https://www.scrble.com/6-2-21-2/ |
| **Tap chỉ số trang hiện tại** — "Tapping on the current page indicator shows a fly-out to edit the current page" (7.2.0) | https://www.scrble.com/release-notes/ |
| **Bàn phím** — `Page Up`/`Page Down` = trang trước/sau; mũi tên = cuộn; wheel = cuộn; Ctrl+wheel = zoom | https://www.scrble.com/faq-items/what-are-scrble-keyboard-shorcuts/ |
| **Zoom out đủ xa** — "Zoom out to view full page and page navigation panel" (1.0.0, 2018) | https://www.scrble.com/1-0-0-released-as-inknotes/ |
| **Select Pages → thanh đa trang** Delete/Duplicate/TwoPage/ExportPDF/Share/Email/Print — "select multiple pages, then delete or move them all at once" (6.3.1) | XBF `PageSelectionToolbar` + https://www.scrble.com/6-3-1/ |

### 2.3 Tạo trang mới trong Scrble — hiện trạng theo bằng chứng

- **Bằng nút/menu:** `Insert Page` / `Duplicate Page` / `Delete Page` nằm trong flyout của rail + thanh đa trang; năng lực "Insert, delete and reorder pages" có từ bản đầu (1.0.0, 2018). — nguồn: https://www.scrble.com/1-0-0-released-as-inknotes/
- **Sinh trang trong runtime:** release notes nhiều lần mộc mạc nhắc đến trang mới sinh ra trong quá trình dùng: *"Saving was failing when new pages were created while saving was in progress"* (1.3.5/1.3.6) và *"Avoid generating empty pages when appending imported files"* (7.3.0–7.3.6) → app tự sinh trang khi cần (chi tiết quy tắc runtime: **n/d**, nguồn sơ cấp không công bố). — nguồn: https://www.scrble.com/1-3-5-and-1-3-6/ , https://www.scrble.com/7-3-0/
- **Vấn đề ranh giới khi dán/chuyển selection:** hộp thoại nội bộ *"The selection is overlapping with existing content. Do you want to continue and allow the overlap or insert a blank page to prevent it?"* + tài nguyên `InsertBlankPage` — một con đường "chèn trang trắng" tồn tại trong flow select/dán. — nguồn: `resources.pri` (sơ cấp, chuỗi `OverlapMessage`, `InsertBlankPage`)
- **Cử chỉ kéo–thả-để-tạo-trang:** **chưa thấy trong bất kỳ nguồn sơ cấp nào.** Tất cả hành vi kéo-dọc được tài liệu hoá thuộc Vertical Spacer (2.4). Đánh dấu: **✖ chưa có bằng chứng**.

### 2.4 Vertical Spacer — cơ chế "kéo" thật sự của Scrble (6.8.0, 2021-03-02)

- Phát hành chính chủ: *"This release is implementing the vertical spacer to allow adding and removing vertical space among elements. You can add or reduce vertical space in the current page. You can add or reduce vertical space across two consecutive pages."* kèm 2 GIF demo (`OnePageSpacer.gif`, `TwoPages_trimmed.gif`). — nguồn: https://www.scrble.com/6-8-0/
- Trang chủ: *"You can add or reduce vertical space on the current page or across two consecutive pages."* — nguồn: https://www.scrble.com/
- Bằng chứng UI sơ cấp trong appx: lớp `InkNotes.Editor.Spacer` được đặt lên các trang (`_SpacerLayer`, `_Spacer`, `_PageSpacerSelection`, `_DocumentSpacerSelection` trong XBF `SheetManager`), cùng chuỗi UI `One Page Spacer` / `Two Pages Spacer` và tooltip **"Vertical Spacer — Add or remove space in the current page or across two consecutive pages"**. — nguồn: `resources.pri` (sơ cấp)
- Ảnh trợ giúp **`Assets\Help\CurrentTip.png`** (mục 5) là "tip bản phát hành mới" (`TipNewInThisRelease` + XBF `Help.CurrentTip`): vẽ 2 icon chọn lựa (rect+, lasso+) và **2 icon spacer — đường kẻ ngang chấm với mũi tên lên/xuống quanh nó**, khớp hai chế độ spacer. Nhu cầu này từng được người dùng Reddit mô tả trước khi có: *"the vertical space maker, where you can push everything down".* — nguồn: https://www.reddit.com/r/Surface/comments/9pnxdu/great_new_note_taking_app/ (cộng đồng)

### 2.5 Cử chỉ cầm bút/chạm app tự dạy (help in-app)

- **`HelpGesture`** gồm 3 mục: `ZoomToggle.png` (`Zoom toggle`), `Zoom.png` (`Zoom in and out`), `Pan.png` (`Pan`) → double-tap zoom toggle, pinch zoom, two-finger pan. Chuỗi đi kèm: "Double tap", "Double Tap to Start Writing", "Double Tap Again to Zoom Out". — nguồn: carve XBF + `resources.pri` (sơ cấp)
- **`Help.WritingArea`** = `ZoomToggle.png` + `Arrow1.png` + chuỗi `ThePageWillAutoscroll` + `Arrow2.png` + `WritingArea.png` → trang "Writing Area" dạy **vùng cuộn tự động**: *"The page will autoscroll when reaching this area"*. Settings tương ứng: `WritingArea` (Full/Vertical/Bottom), `TopPalmGuard`, `BottomPalmGuard`, `WritingPaneOn/Off`, "Auto-scroll right to left"/"left to right", "Top with Palm Guard"/"Bottom with Palm Guard". — nguồn: carve XBF + `resources.pri` (sơ cấp)
- **FAQ:** hai mode Writing/Drawing; *"Write is the default… By selecting draw, the app will zoom in on the area where you double tap and not shoot the writing overlay pane for auto-scrolling."* — nguồn: https://www.scrble.com/faq/
- Trang chủ: *"If you don't have a pen, the scrolling area is placed on the bottom so you can write with your finger while resting your palm on the table. If Scrble detects that you have a pen, it shows the full-screen scrolling area so you can write anywhere."* — nguồn: https://www.scrble.com/

### 2.6 Save/Export (tóm lược; chi tiết binary tại `scrble-feature-inventory.md` §4)

- Mỗi trang = 1 PNG (2.1); định dạng xuất: PNG/JPEG/BMP/PDF; SaveFlyout có 2 toggle `SAVEFULLPAGE` và `SAVEBACKGROUND`; export PDF có ô password; export từ gallery/nhiều trang. — nguồn: https://www.scrble.com/faq/ + binary `resources.pri` (sơ cấp)

## 3. Các app khác — tạo trang, điều hướng, cử chỉ kéo

### 3.1 Samsung Notes — kéo–thả-để-tạo-trang ĐƯỢC MÔ TẢ CHÍNH THỨC (mẫu chuẩn)

- Trả lời chính thức trên Samsung Community US (3/12/2025): Samsung Notes có 2 style — "Infinite scrolling" hoặc "Individual pages"; thêm trang thủ công qua **page sorter** (`+`), hoặc: *"if you have a note open in the 'Individual pages' or 'Horizontal scroll' view, you can drag the current page left until you see 'release to add page'"* — kéo canvas vượt mép (cuộn ngang) hiện hint "release to add page", thả để tạo trang. — nguồn: https://us.community.samsung.com/t5/Galaxy-Note-Phones/Page-Break-on-Samsung-Notes/td-p/3420763 (cộng đồng chính thức Samsung)
- Cùng cơ chế theo chiều dọc, do hai thread cộng đồng độc lập ghi nhận (2021, sau một bản update chuyển từ auto sang manual): *"I have to manually add a new page by swiping up the current page a few centimeters, hold it there for maybe a second and then let go"*; *"On mine, scrolling up gets to a point where release will add the page"*; *"You can also add pages in right instead of the down"*. — nguồn: https://www.reddit.com/r/GalaxyTab/comments/qkqqeq/ , https://www.reddit.com/r/GalaxyTab/comments/q6bjif/ (cộng đồng)
- Ở "Infinite scrolling" không có Insert Space — người dùng phải lasso kéo nội dung để mở vùng trống. — nguồn: https://www.reddit.com/r/GalaxyTab/comments/1d334ea/ (cộng đồng)
- **Đây là đối chiếu "mẫu chuẩn" duy nhất có cử chỉ kéo–thả-để-tạo-trang.**

### 3.2 OneNote — infinite canvas + Insert Space (kéo đường kẻ để chèn khoảng trắng)

- Canvas vô hạn: ghi note "anywhere on the page" qua Draw tab; note container di chuyển tự do trong trang. — nguồn: https://support.microsoft.com/en-us/onenote/take-and-format-notes
- **Insert Space** trên ribbon Insert và Draw tab: *"Click Insert > Insert Space. Move the mouse… The mouse pointer will turn into an arrow… Click and drag the arrow until you've created the space you need."* Có thể tạo space ở lề trái hoặc giữa trang; kéo **lên** để remove space (pointer thành double-sided arrow ở mép dưới vùng trống) — nguồn: https://support.microsoft.com/en-us/onenote/insert-extra-writing-space-in-onenote
- Hướng dẫn chi tiết mô tả biểu tượng pointer là **"a horizontal line with a downward-pointing arrow"**; nội dung dưới đường kẻ dịch xuống theo tay kéo; kéo ở mép trên/dưới vùng nội dung sẽ chèn space tại đó; kéo ngang để dịch trái/phải. — nguồn: https://www.teachucomp.com/add-or-remove-note-space-in-onenote-instructions/ ; OneNote for web không có lệnh này ("Try moving notes around to make room, or start a new page") — nguồn: https://support.microsoft.com/en-us/onenote/onenote-for-web-help-and-learning/differences-between-using-a-notebook-in-the-browser-and-in-onenote
- Đây **không phải** cử chỉ tạo trang mới — nó chèn khoảng trống trong canvas vô hạn; nếu quy về giới hạn trang như Scrble thì "Insert Space" của OneNote gần nhất với Spacer chế độ một trang.
- Laser pointer: pen "Laser Pointer" trong Draw tab (OneNote Microsoft 365, chỉ Windows), 6 màu; nét vẽ **biến mất sau vài giây**, không lưu vào note. — nguồn: https://support.microsoft.com/en-US/OneNote/onenote-help-and-learning/learn-more-about-drawing-tools + https://learn.microsoft.com/en-us/answers/questions/5070835/onenote-using-pen-as-pointer ("anything you draw will disappear after a couple of seconds, so you won't permanently mess up your notes")

### 3.3 GoodNotes (iPad/Windows) — trang cố định, không pull-gesture

- Điều hướng: swipe theo hướng cuộn đã cấu hình (Vertical/Horizontal), drag thumbnail/scrollbar; pan = one-finger drag; zoom = pinch, double-tap, Ctrl/cmd+wheel, nút +/−. — nguồn: https://support.goodnotes.com/hc/en-us/articles/6554036735631-Zoom-pan-and-scroll-through-pages-in-Goodnotes
- Zoom Window + "Auto Advance" (chỉ iOS): khi viết qua giữa cửa sổ, vùng ghi tự dịch chuyển; *"When you reach the end of the page, the Zoom Window will move you down to the next line"* — không tự tạo trang mới. — nguồn: https://support.goodnotes.com/hc/en-us/articles/7353756826383-Write-with-the-Zoom-Window
- Cộng đồng phàn nàn auto-"jump to center of next page" khi cuộn là lỗi/phiền (2025) — cho thấy ranh giới cảm nhận của auto-scroll trên trang cố định. — nguồn: https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes-apple/suggestions/49483778 (cộng đồng)
- Không cử chỉ kéo-để-thêm-trang; thêm trang = nút `+`/page overview. — nguồn các bài support trên

### 3.4 Notability — Content Manager, không pull-gesture

- Page Manager/Content Manager: "Add Page to add a page after the one you've selected"; **reorder bằng nhấn giữ + kéo thumbnail**; Cut/Copy/Duplicate/Clear/Delete theo từng trang. — nguồn chính chủ: https://support.gingerlabs.com/hc/en-us/articles/206059167-Content-Manager-and-Bulk-Actions ; bản mới: https://support.gingerlabs.com/en-us/articles/16300226-content-manager-and-bulk-actions
- Trải nghiệm desktop từ cộng đồng: mở page navigator, chọn trang, tuỳ chọn đầu tiên là "add page". — nguồn: https://www.reddit.com/r/notabilityapp/comments/1iq786e/ (cộng đồng)

### 3.5 Xournal++ — trang qua toolbar/menu, không pull-gesture

- Journal = tập các trang cố định; tạo trang mới = **Insert Page Button trên toolbar** hoặc `Journal > New Page`; touch mặc định = pan/scroll; chuột giữa = tạm "Hand", chuột phải = tạm "Eraser". — nguồn: https://xournalpp.github.io/guide/whirlwind-tour/
- App theo mô hình trang của rnote cũng yêu cầu nút riêng để insert giữa các trang (issue #1054) — chưa app nào nhóm này dùng pull-gesture. — nguồn: https://github.com/flxzt/rnote/issues/1054

### 3.6 Nebo / MyScript Notes — đường kẻ xanh "add or remove space"; trang cố định

- 4 định dạng: Notebook (trang kích thước cố định), Board (canvas mở rộng tự do), Document (bố cục tự chọn), PDF (sidebar thumbnail để add/move/delete, tap để nhảy trang). — nguồn: https://www.myscript.com/notes/
- **Add/remove space bằng đường kẻ xanh:** *"Rearrange content by adding or removing vertical space: Use your finger to drag the blue line up or down to adjust the vertical space. Select Adjust space. A horizontal blue line displays."* — nguồn: https://app-support.myscript.com/en/support/solutions/articles/16000113057-freeform-section
- Không có pull-gesture tạo trang; tạo/quản lý trang qua `+`/DMS/thumbnail sidebar. — nguồn các bài trên

### 3.7 Microsoft Whiteboard & Concepts — canvas vô hạn, không trang

- Whiteboard: infinite canvas chính chủ; pan = kéo canvas (chuột) hoặc Ctrl+mũi tên; zoom = wheel / Ctrl+Plus/Minus; laser pointer trên toolbar (Alt+L) là hiệu ứng tạm; xuất PNG. — nguồn: https://support.microsoft.com/en-us/whiteboard/use-mouse-keyboard-and-pen-in-whiteboard , https://support.microsoft.com/en-us/whiteboard/whiteboard-keyboard-shortcuts , https://support.microsoft.com/en-us/whiteboard/unleash-ideas-on-microsoft-whiteboard-s-infinite-canvas
- Concepts: infinite canvas là bản thể (mặc định "Infinite"); paper/artboard chỉ là khung để xuất/exp; pan 2 ngón, zoom 2 ngón. — nguồn: https://concepts.app/en/manual/infinite-canvas , https://concepts.app/downloads/concepts-manual-3.2.pdf , https://concepts.app/en/manual/settings

### 3.8 Windows Journal / Microsoft Journal — trạng thái và gesture

- Windows Journal (định dạng JNT) bị **loại khỏi Windows từ Anniversary Update 1607 / update KB3161102 (9/8/2016)** vì rủi ro bảo mật định dạng; Microsoft hướng tới OneNote và cung cấp converter JNT→ONE (beta). — nguồn: https://support.microsoft.com/en-au/topic/update-for-windows-journal-to-microsoft-onenote-converter-beta-322b01ff-e4ac-8364-174b-7ebea5347d22
- "Microsoft Journal" (Microsoft Garage, 2021) là kế nhiệm hiện đại — editing mode-less: scratch-out để xoá, lasso tức thời để select mà không cần đổi tool, gesture AI trên thiết bị. — nguồn: https://www.microsoft.com/en-us/garage/blog/2022/04/garage-project-journal-becomes-microsoft-journal/ (đã dẫn trong `inking-app-landscape.md` §2.6)

### 3.9 Bảng khái quát: cử chỉ tạo trang

| App | Tạo trang | Điều hướng trang | Pull/drag-gesture tạo trang? |
|---|---|---|---|
| Scrble Ink | Insert/Duplicate/Delete qua rail menu + flyout chỉ số trang; sinh trang trong runtime (n/d chi tiết) | rail trái, PageUp/Down, tap counter, zoom-out navigation | ✖ (chỉ có Spacer drag) |
| Samsung Notes | `+` trong page sorter; **"release to add page"** | swipe theo hướng cuộn, page sorter | ✔ (kéo vượt mép → hint → thả) |
| OneNote | (không có trang) | canvas vô hạn + page list | ✖ (Insert Space = chèn khoảng trống trong canvas) |
| GoodNotes | `+`/page overview | swipe/scrollbar/full-page view | ✖ |
| Notability | Content Manager "Add Page" | Content Manager thumbnails | ✖ |
| Xournal++ | Insert Page Button / Journal menu | sidebar page list | ✖ |
| Nebo | `+`/DMS | notebook page nav; PDF thumbnail sidebar | ✖ (drag blue line = add/remove space trong section) |
| Whiteboard / Concepts | (không có trang) | pan/zoom canvas | ✖ |
| Windows Journal | (đã ngừng 2016) | — | — |

## 4. Chuẩn UWP InkToolbar — hành vi canonical (Microsoft Learn)

- **Cấu trúc & nhóm nút:** InkToolbar có 2 nhóm: **"tool" (mutually exclusive)** gồm built-in pen/pencil/highlighter/eraser + CustomPen/CustomTool, và **"toggle" (không mutually exclusive, chạy cùng active tool)** gồm ruler/stencil + CustomToggle. Thứ tự mặc định cố định: BallpointPen, Pencil, Highlighter, Eraser, Ruler; custom tool chen giữa pen cuối và eraser; custom toggle nằm sau ruler. — nguồn: https://learn.microsoft.com/en-us/windows/apps/design/input/ink-toolbar
- **`ActiveTool`** = nút đang chọn trong nhóm tool (mặc định là nút đầu tiên). — nguồn: https://learn.microsoft.com/en-us/uwp/api/windows.ui.xaml.controls.inktoolbar.activetool
- **Flyout & extension glyph:** *"All built-in pen and tool buttons include a flyout menu where ink properties and pen tip shape and size can be set. An 'extension glyph' is displayed on the button to indicate the existence of the flyout. **The flyout is shown when the button of an active tool is selected again.** When the color or size is changed, the flyout is automatically dismissed and inking can be resumed."* Eraser flyout có lệnh **Erase All Ink**. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/ui-input/inking-controls
- **Custom tool (ví dụ lasso select):** `InkToolbarCustomToolButton` + Click handler; cấu hình `InkPresenter.InputProcessingConfiguration` để input có secondary affordance (pen barrel button / right mouse) đi qua cho custom processing. Gợi ý UX của MS: icon "EF20" + tooltip "Selection tool" cho stroke selection. — nguồn: https://learn.microsoft.com/en-us/windows/apps/design/input/ink-toolbar + https://learn.microsoft.com/en-us/uwp/api/windows.ui.xaml.controls.inktoolbarcustomtoolbutton
- **InkToolbarFlyoutItem** = item trên flyout (basic / radio / radio-toggle / checkbox). — nguồn: https://learn.microsoft.com/en-us/uwp/api/windows.ui.xaml.controls.inktoolbarflyoutitem
- **Stencil ruler/protractor — ràng buộc nét:** `InkPresenterRuler`: *"It acts as a mask and prevents the drawing of an ink stroke within the area obscured by the stencil. **It snaps the ink stroke to the stencil edge if the pen tip is within a distance threshold (gutter)**."* Vị trí + góc quay qua `Transform`; ruler có tick marks + compass; protractor có **rays** (hiện khi nét được snap và protractor đứng yên), angle readout; opacity 75% đứng yên, 50% khi manipulation; scale/translate theo InkCanvas. — nguồn: https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkpresenterruler , https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.iinkpresenterstencil , https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkpresenterprotractor
- **Default toolbar:** pen/pencil/highlighter/eraser + stencil, flyout chọn màu & stroke size; walkthrough step 4. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/ui-input/ink-walkthrough
- **Laser pointer phía Windows:** OneNote Draw tab (chỉ Windows); vệt tự tắt sau vài giây, không lưu; không có API "laser" trong InkToolbar — các app tự dựng; Scrble chứa sprite riêng `Assets\Images\laserpointer.png` + `ViewButton` (mode V). — nguồn: https://support.microsoft.com/en-US/OneNote/onenote-help-and-learning/learn-more-about-drawing-tools + https://learn.microsoft.com/en-us/answers/questions/5070835/onenote-using-pen-as-pointer + binary `resources.pri` (sơ cấp)

**Đối chiếu Scrble ↔ chuẩn** (binary, sơ cấp):

| Chuẩn InkToolbar | Scrble (binary) |
|---|---|
| nhóm tool mutually exclusive | `PenToolbar`/`PenButtonGrid` — khối bút có slot; tối đa 10 bút (release 5.0.0: "Increased the maximum number of pens from 5 to 10") |
| flyout mở khi click lần thứ 2 trên active tool (extension glyph) | các nút có caret mở `PenFlyout`, `RulerFlyout`, `EraserFlyout`, `TuneFlyout`, `SelectionFlyout` |
| EraserFlyout có "Erase All Ink" | `EraserFlyout` với Point/Segment eraser Small/Medium/Large + Stroke eraser (chuỗi "Stroke Eraser", "Segment Eraser - Small/Medium/Large") |
| snap gutter của stencil | `RulerCanvas`/`RulerFlyout` + mode Protractor (phím P) |
| laser pointer không có API chuẩn | sprite `laserpointer.png` riêng + mode View (V) |

Nguồn binary cho danh sách UI trên: toàn bộ trong `resources.pri`/`InkNotes.xr.xml` (các XBF đã carve: `PenButtonGrid.xbf`, `EraserFlyout.xbf`, `RulerFlyout.xbf`, `SelectionFlyout.xbf`, `TuneFlyout.xbf`, …).

## 5. Ảnh Help đã đọc (mô tả + đường dẫn sơ cấp)

Tất cả tại `C:\Users\Admin\AppData\Local\Temp\opencode\appx-x\Assets\Help\` (thư mục `Assets\Help` trong appx v6.8.6). Đặc điểm chung: glyph **màu trắng trên nền trong-suốt** (trang Help dùng nền tối). Mô tả dưới đây dựa trên việc đọc trực tiếp từng ảnh.

| Ảnh | Dùng ở Help page (từ carve XBF) | Mô tả trực tiếp |
|---|---|---|
| `Pan.png` | `HelpGesture` | **Hai vòng tròn (biểu tượng điểm chạm) + một mũi tên chỉ xuống dưới mỗi vòng** = sơ đồ cử chỉ pan: hai điểm chạm kéo xuống để cuộn trang. Cùng trang với Zoom và ZoomToggle. |
| `Zoom.png` | `HelpGesture` | Hai vòng tròn, **hai mũi tên đi lệch ngược chiều theo hướng chéo** (mở ra hai phía) = kẹp/rải hai ngón để zoom. |
| `ZoomToggle.png` | `HelpGesture`, `Help.WritingArea` | Một vòng tròn (vùng chạm) kèm ký hiệu **"×2"** = double-tap bật/tắt zoom ×2; khớp hint "Double Tap to Start Writing / Double Tap Again to Zoom Out". |
| `WritingArea.png` | `Help.WritingArea` | **Đường viền trên lượn sóng** (ranh giới vùng viết) + **đường chấm đứng bên phải** (mốc ranh giới) = sơ đồ writing area/auto-scroll. |
| `Arrow1.png` | `Help.WritingArea` | **Mũi tên cong chỉ xuống** — đi cùng chuỗi "The page will autoscroll when reaching this area", trỏ vào vùng auto-scroll ở mép trên. |
| `Arrow2.png` | `Help.WritingArea` | Mũi tên cong dài hướng ngang–xuống, trỏ vùng auto-scroll/ranh giới mép. |
| `CurrentTip.png` | `Help.CurrentTip` | Bảng "tip bản phát hành mới" có 4 hàng: **hàng 1 = hình chữ nhật nét chấm với `+` (Rectangular Selection)**; **hàng 2 = hình tròn nét chấm với `+` (Lasso Selection)**; đường kẻ phân cách; **hàng 3 = icon "One Page Spacer"** (đường ngang chấm + mũi tên lên/xuống quanh nó); **hàng 4 = icon "Two Pages Spacer"** — khớp trực tiếp release 6.8.0 và tooltip "Vertical Spacer". |
| `Button.png` | `HelpOverlay` | Khung nút bo tròn **viền xanh lá** = style `HelpButtonStyle` cho nút Back/Next của Help overlay. |
| `ButtonWide.png` | `HelpOverlay` | Như trên nhưng rộng hơn (`HelpButtonWideStyle`). |
| `Erase.png` | `Help.BackToPen` | **Khối gôm nghiêng trên một vạch ngang** = icon eraser minh hoạ flow "quay lại bút sau khi xoá". |
| `Shape.png` | `Help.BackToPen` | Vòng tròn có **vạch chéo bên trong** = icon "line/shape" — khớp hint "Tap on the line button to insert a Text region, or a geometric shape". |
| `Settings.png` | `Help.BackToPen`, `Help.FullFeatures` | Bánh răng = mở Settings (BackToPen/DoubleTap…). |
| `Colors.png` | `Help.FullFeatures` | **7 chấm màu** (xanh ngọc, xanh đậm, xanh lá, xám, hồng đậm, vàng, đỏ) = mục "Lots of Colors" (tính năng full version). |
| `Shapes.png` | `Help.FullFeatures` | Ngôi sao viền trắng trên nền xám = shape mẫu của shape gallery (full version). |
| `Pictures.png` | `Help.FullFeatures` | Icon ảnh (núi + mặt trời) = mục "Images" — chèn/chụp ảnh (full version). |
| `MathPaper.png` | `Help.FullFeatures` | Giấy lưới "Math Paper", **một ô sáng ở góc trên phải** = template giấy toán. |
| `BlackPaper.png` | `Help.FullFeatures` | Hình trang **đen với góc gấp** = "Black Paper"/blackboard mode. |
| `NoAdds.png` | `Help.FullFeatures` | Nhãn "ADS" trong **vòng cấm đỏ** = "No Ads" (full version). |
| `Printing.png` | `Help.FullFeatures` | Icon máy in = chức năng Print (full version). |
| `PDF.png` | `Help.FullFeatures` | Icon tập tin PDF góc gấp kèm vạch = "PDF Import and Export" (full version). |
| `Save.png` | (không thấy trong 8 XBF Help đã carve) | Icon đĩa mềm vẽ tay = Save. Trang help gắn: **n/d**. |

Ánh xạ trang help → ảnh (carve XBF): `BackToPen` (Shape, Erase, Settings), `CurrentTip` (currentTip.png), `FullFeatures` (Colors, Shapes, Pictures, MathPaper, BlackPaper, NoAdds, Printing, PDF, Settings), `HelpGesture` (ZoomToggle, Zoom, Pan), `HelpOverlay` (Button, ButtonWide), `SettingUp` (không ảnh), `Help.WritingArea` (ZoomToggle, Arrow1, Arrow2, WritingArea). — nguồn: carve `resources.pri` (sơ cấp)

## 6. Khuyến nghị triển khai — "pull down → new page" cho WriteCanvas

Bối cảnh WriteCanvas: canvas **tập trung một trang + rail thumbnail bên trái** (chung topology với `PagesPreviewList` của Scrble), kéo để pan; chưa có trang vô hạn. Đối chiếu bằng chứng:

- **Scrble** (chính chủ): cử chỉ kéo duy nhất là **Spacer** (kéo đường kẻ lên/xuống, thêm/giảm khoảng trắng trong trang hoặc xuyên hai trang); tạo trang bằng nút/menu; viết vượt đáy được xử lý bằng auto-scroll + sinh trang runtime. — nguồn: https://www.scrble.com/6-8-0/ + strings appx
- **Samsung Notes:** "kéo vượt mép → hint 'release to add page' → thả để tạo" — mẫu duy nhất có văn bản mô tả (kéo vài cm, giữ ~1 giây, thả). — nguồn mục 3.1
- **OneNote:** "Insert Space" — khó giữ đường kẻ ngang để chèn khoảng trắng (chính là tinh thần Spacer). — nguồn mục 3.2
- **GoodNotes / Notability / Xournal++ / Nebo / Whiteboard / Concepts:** không có cử chỉ kéo tạo trang; trang +/page manager hoặc canvas vô hạn.

Khuyến nghị theo thứ tự ưu tiên:

**A. Kéo vượt mép đáy → placeholder trang mới (mô hình Samsung), có ngưỡng + hysteresis — chỉ áp dụng khi đang ở trang cuối.**

1. **Điều kiện kích hoạt:** chỉ khi scroll offset ở đáy (`scrollY >= maxScroll - 1`) **và** trang hiện tại là trang cuối. Nếu không, chỉ rubber-band thuần (tránh "auto-jump" mà cộng đồng GoodNotes phàn nàn — nguồn 3.3).
2. **Lực cản (rubber band):** delta thực = delta người dùng × **0.35** (trải nghiệm chuẩn pull-to-refresh; không chiếm cử chỉ của spacer).
3. **Ngưỡng đề xuất:**
   - **Armed (24 px):** vượt 24 px từ đáy → bắt đầu hiện **placeholder trang kế** (trang mờ cùng template/kích thước) + **hint "Thả để thêm trang mới"** (nghĩa sát "release to add page").
   - **Commit (96 px):** vượt tổng cộng ~**96 px** (≈ 2 dòng giấy @zoom 100%; hoặc 12% chiều cao viewport, lấy giá trị lớn hơn; cấu hình được 64–128 px).
   - **Thả:** nếu vượt ngưỡng commit → tạo trang `N+1` (file PNG mới theo đúng mẫu "Tiêu đề#N+1" — tương ứng `Insert Blank Page` của Scrble) và snap tới mép trên của trang mới ("Zoom to top of the page when creating new document" — nguồn: https://www.scrble.com/1-3-7/). Chưa vượt → snap bounce về đáy trang cũ.
   - **Huỷ:** kéo ngược trong lúc đang kéo → placeholder co lại; dưới ngưỡng armed → tắt.
4. **Đơn vị tiệm cận Scrble:** nếu muốn hình học giống hệt, có thể đặt ngưỡng theo **chiều cao một dòng template** (ruled math 10/…) của giấy hiện tại — vì Spacer của Scrble làm việc theo không gian nội dung, không phải pixel màn hình (n/d — Scrble không công bố số; đây là suy luận thiết kế, đánh dấu rõ).

**B. Giữ Vertical Spacer như một công cụ riêng (parity 1:1 với Scrble).**

- Mở chế độ spacer qua flyout (Scrble dùng `_PageSpacerSelection`/`_DocumentSpacerSelection` với 2 tùy chọn One/Two Pages). Khi active: **đường kẻ ngang nét chấm + mũi tên lên/xuống quanh nó** (đúng icon trong `CurrentTip.png`), đi theo con trỏ; kéo lên/xuống để thêm/giảm khoảng trắng, nội dung dịch theo; hoạt động trong trang (One Page) hoặc xuyên ranh giới hai trang liền kề (Two Pages).
- Không gộp spacer vào cử chỉ pull-to-add-page: hai ý nghĩa (kéo đáy = dãn trang vs. kéo đáy = thêm trang) dễ xung đột thao tác; Scrble cũng tách bạch hai khái niệm (nút Insert Page vs. Spacer).

**C. Điều hướng giữ nguyên chuẩn Scrble (đã có trong `ui-parity-scrble.md`).**

- Rail trái với menu Insert/Duplicate/Delete/Refresh/Select pages; `PageUp`/`PageDown`; tap chỉ số trang → flyout chỉnh sửa trang; zoom-out hiện navigation panel; hint `'release to add page'` chỉ là bổ sung, không thay thế.

**D. Sinh trang khi viết (tùy chọn, "faithful" hơn Scrble hiện trạng).**

- Khi nút bút đang giữ và toạ độ vượt đáy trang hiện tại, tự sinh trang kế **sau khi stroke kết thúc** (không cắt stroke giữa chừng) — tránh kiểu lỗi "saving was failing when new pages were created while saving was in progress" (release 1.3.5/1.3.6). Vì quy tắc runtime Scrble là n/d, đây là suy luận an toàn từ câu chữ release notes, đánh dấu rõ.

**Ngưỡng gói gọn một dòng:** `bottomOverflowThresholdPx = max(96, 0.12 × viewportHeight)`; `hintAtPx = 24`; `rubberCoefficient = 0.35`; chỉ kích hoạt khi `isLastPage && atBottom`.

**Điều nên tránh:**
- Không gắn "pull to new page" ở các trang giữa — mọi app khảo sát chỉ tạo trang theo trình tự cuối (Notability: "Add Page … after the one you've selected"; Samsung: kéo ở mép ngoài; Scrble: Insert sau trang đang chọn). Chèn trang giữa trang khác vẫn để trong rail context menu.
- Không để cử chỉ tạo trang đụng độ với pan/zoom khi dùng chung thao tác: hai ngón = pan (HelpGesture của Scrble), một ngón kéo ở đáy (trang cuối) = pull-to-add; Ctrl+wheel = zoom (FAQ Scrble).

---

*Giới hạn tài liệu: (i) "sinh trang runtime khi vượt đáy" chỉ suy từ câu chữ release notes + resource strings — Scrble không công bố quy tắc chính xác (n/d); (ii) ngưỡng px cử chỉ Samsung Notes chỉ được mô tả bằng lời trong nguồn cộng đồng, không có số liệu chính thức; (iii) `Save.png` chưa tìm thấy trang help gắn trong số XBF đã carve. Mọi khẳng định khác đều có URL hoặc artifact nhị phân trực tiếp.*

— *Tài liệu write-only của subagent nghiên cứu; không sửa code, không commit.*
