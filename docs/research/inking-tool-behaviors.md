# Chuẩn InkToolbar + bằng chứng Scrble — hành vi 5 công cụ: gôm (point/stroke/segment), thước & độ đo góc (stencil), lasso/selection, laser pointer, chế độ view (pan)

> **Ngày:** 2026-10-19 · **Loại:** tài liệu nghiên cứu chỉ-đọc (không sửa code) · **Đích:** WriteCanvas (bản Electron rewrite của Scrble Ink)
>
> **Bằng chứng sơ cấp dùng trực tiếp:** chuỗi tài nguyên `resources.pri` đã dump tại `C:\Users\Admin\AppData\Local\Temp\opencode\pri-strings.txt` và danh sách XBF carve từ cùng khối (`SelectionFlyout/SelectionToolbar/SelectionLayer/SelectionInteractionLayer/AdornerLayer/RulerButton/RulerFlyout/RulerCanvas/ViewButton`); các trang API & khái niệm trên Microsoft Learn; các trang hỗ trợ chính chủ (support.microsoft.com) cho OneNote / Whiteboard / PowerPoint.
>
> **Phương pháp:** mọi khẳng định đều kèm nguồn (URL hoặc artifact nhị phân). Chuẩn "nền tảng" = tài liệu chính thức của lớp ink UWP/WPF (đây là chuẩn Microsoft dùng cho InkToolbar — app nào xây trên nền UWP ink đều chịu cùng hợp đồng hành vi). Những chỗ không có số chính thức được đánh dấu **n/d** hoặc **(suy luận thiết kế)**.
>
> **Tài liệu liên quan:** `scrble-behavior-deep-dive.md` (page model, cử chỉ trang, Vertical Spacer, chuẩn InkToolbar tổng thể — tài liệu này **không lặp lại**), `inking-app-landscape.md`, `ui-parity-scrble.md`, `framework-comparison.md`. Bài này đi đúng vào 5 công cụ có sẵn/không có trong WriteCanvas: **eraser, ruler/protractor, selection, laser pointer, view-only pan**.

---

## 1. TL;DR

1. **Gôm có 2 hành vi chuẩn, đối nghịch nhau:** *point erase* — "the pen erases part of a stroke when the pen intersects the stroke" (nét bị cắt thành nhiều mảnh tại nơi gôm đi qua) và *stroke erase* — "the pen erases an entire stroke when the pen intersects the stroke". Chuẩn InkToolbar: eraser stroke mặc định **2×2 px** và nét bút bị gôm chạm là bị **xóa toàn bộ**; flyout có lệnh **"Erase all ink"** (chứng nhận bằng API `IsClearAllVisible`). — nguồn: https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.inkcanvaseditingmode , https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.xaml.controls.inktoolbareraserbutton
2. **Thước là stencil, không phải đường kẻ trang trí:** nó *"acts as a mask and prevents the drawing of an ink stroke within the area obscured by the stencil"* (chặn nét dưới thân thước) và *"snaps the ink stroke to the stencil **edge** if the pen tip is within a distance threshold (**gutter**)"* — snap vào **mép**, không phải trục giữa; `Length mặc định 1600 DIP, tối thiểu 300 DIP`; stencil *"also scales and translates with the InkCanvas"*. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkpresenterruler , …/inkpresenterruler.length , …/iinkpresenterstencil
3. **Lasso chuẩn chỉ chọn nét HOÀN TOÀN nằm trong polyline** (`SelectWithPolyLine`), vẽ bounding box nét đứt xanh 1 px, dash {5, 2}; selection **tự clear** khi bắt đầu nét mới hoặc khi xoá mực; hoạt động trên một lớp canvas **nằm dưới** InkCanvas; cut = `CopySelectedToClipboard → DeleteSelected → ClearSelection`; paste có điểm đích `PasteFromClipboard(Point)`. — nguồn: https://learn.microsoft.com/en-us/windows/apps/design/input/ink-toolbar
4. **Laser pointer không có API chuẩn hoá riêng** — các app tự dựng: OneNote bút "Laser Pointer" trong Draw tab, nét **tự biến mất sau vài giây, không lưu**; Whiteboard có laser trên toolbar (Alt+L); PowerPoint Ctrl + kéo chuột trái trong trình chiếu, **mặc định màu đỏ**. Màu laser **không mượn từ bút đang chọn**. — nguồn: mục 5.1
5. Scrble (binary): gôm có **"Stroke Eraser"** + **"Segment Eraser − Small/Medium/Large"**; thước là nút Ruler **gộp Protractor** (`Tooltip_RulerProtractor`, phím P); selection có **`SelectionLasso`/`SelectionRectangular`** + flyout/toolbar + các lớp riêng; laser là sprite riêng `laserpointer.png` gộp chung nút **"View and laserpointer (V)"**. — nguồn: `resources.pri` (chi tiết mục 3–6)
6. **WriteCanvas hiện lệch chuẩn ở 10 mốc chính** (mục 7): snap thước ép lên trục giữa; không mask dưới thân thước; lasso chọn nét "chạm là đủ"; laser mượn màu bút; không flyout/clipboard cho selection; selection không tự clear khi vẽ/xoá; không resize selection; xoay thước chỉ ±10° qua nút bấm; không Protractor; preview gôm sai tỉ lệ. Khuyến nghị số cụ thể ở mục 8.

## 2. Gôm — 3 hành vi chuẩn và 1 lệnh "Erase all ink"

### 2.1 Chuẩn nền tảng

- **Hai mode đối nghịch** trong enum `InkCanvasEditingMode` (WPF InkCanvas — đối chiếu trực tiếp nhất): `EraseByPoint` *"erases part of a stroke when the pen intersects the stroke"*, `EraseByStroke` *"erases an entire stroke when the pen intersects the stroke"*; ngoài ra `Ink`/`Select`/`GestureOnly`/`InkAndGesture`/`None`. — nguồn: https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.inkcanvaseditingmode?view=windowsdesktop-10.0
- **Con trỏ gôm là hình elip của chính gôm**, không phải mũi tên: ví dụ chính thức cấu hình `EditingModeInverted = EraseByPoint; inkCanvas1.EraserShape = new EllipseStylusShape(5, 5);` và mô tả *"An elliptical cursor appears on the InkCanvas when the user erases ink."* — nguồn: như trên
- **InkToolbarEraserButton**: mô tả chính thức *"button for erasing parts of an ink stroke or entire ink strokes"* (nghĩa là flyout của nó mang cả hai mode); **eraser stroke mặc định 2×2 px**; *"An ink stroke touched by the eraser stroke is deleted in its entirety, not just the portion under the erase stroke"* (mô tả mode stroke-erase); API `IsClearAllVisible` — *"Gets or sets whether the "Erase all ink" button is visible"* → flyout eraser có lệnh xóa sạch toàn mực. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.xaml.controls.inktoolbareraserbutton
- **"Erase stroke" là dạng input một-cấp** của InkCanvas UWP: *"Defines an area that receives and displays all pen input as either an ink stroke or an erase stroke (input from an eraser tip, or the pen tip when modified with an erase button)"*. — nguồn: https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.inkcanvas (bản mô tả lớp InkCanvas UWP tương đương)
- **Custom drying phải tự hit-test**: nếu app tự render mực (như WriteCanvas), các lệnh erase built-in của InkToolbar không còn tác dụng: *"you must handle all pointer events, perform hit-testing on each stroke, and override the built-in "Erase all ink" command"*. — nguồn: https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.inktoolbareraserbutton (mục "Custom drying and the InkToolbar")

### 2.2 Scrble (binary, sơ cấp)

- Chuỗi flyout gôm: **`Stroke Eraser`, `Segment Eraser`, `Segment Eraser − Small/Medium/Large`** (pri-strings L707–711) + token `EraserStroke`/`EraserSegment`/`EraserSegmentSmall/Medium/Large` (L96–100) → Scrble dùng đúng bộ từ của nền tảng: 1 mode stroke-erase + 1 mode segment bị chia 3 kích thước.
- Tooltip **"Eraser (E)"** (L598) + `EraserFlyout.xbf` (L329) → nút gôm có flyout, phím tắt E, khớp chuẩn "click lần nữa trên nút active = mở flyout" (đã ghi trong `scrble-behavior-deep-dive.md` §4).
- **"Back to Pen"**: chuỗi *"The app goes back to pen after deleting a stroke."* (L761) + toggle *"Back to pen after each erase"* (L764) + ảnh help `Erase.png` + trang `Help.BackToPen` → góc UX riêng của Scrble: **lúc mặc định sau một động tác xoá app tự chuyển về bút**. — nguồn: `resources.pri` + carve XBF (sơ cấp)
- Gôm tròn ⇔ "segment": thuật ngữ "segment eraser" đi với 3 mức kích thước (S/M/L) — tương ứng WPF `EraseByPoint` với `EraserShape` đổi được kích thước.

### 2.3 Hệ quả cho WriteCanvas

- Đặt tên mode đúng chuẩn: `point` (segment) / `stroke` / `sheet` (tương đương "Erase All Ink"), cùng 3 mức kích thước cho point-erase.
- Con trỏ gôm trên canvas phải **elip đúng bán kính thực** theo đơn vị mm→doc px, không phải công thức ad-hoc.

## 3. Thước / độ đo góc — hợp đồng stencil của nền tảng

### 3.1 Hợp đồng (tài liệu lớp chuẩn)

- `InkPresenterRuler` (UWP): *"It acts as a mask and prevents the drawing of an ink stroke within the area obscured by the stencil. **It snaps the ink stroke to the stencil edge if the pen tip is within a distance threshold (gutter)**."* — mực không vẽ được dưới thân thước, và snap chỉ xảy ra khi đầu bút nằm trong ngưỡng khoảng cách tính từ **mép** stencil. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkpresenterruler
- Stencil là khối trừu tượng chung (`IInkPresenterStencil`): Shape = Ruler/Protractor, vị trí + góc qua `Transform`. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.iinkpresenterstencil
- `InkPresenterRuler.Length` — *"length of the ruler in DIPs … default 1600, cannot be less than 300"* (kích thước dọc thân thước). — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkpresenterruler.length
- Stencil có thể *"be manipulated both programmatically and by the user. It also scales and translates with the InkCanvas"* — thước co/giãn và đi theo canvas (khi zoom/pan trang, thước giữ đúng vị trí trên nội dung). — nguồn: như trang InkPresenterRuler
- Trạng thái thị giác chuẩn (Protractor): hệ số đục **75% khi đứng yên, 50% khi đang manipulation**; các **rays** của protractor chỉ hiện *"when the stroke is snapped and the protractor is stationary"*; có readout góc trong khi manip. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkpresenterprotractor

### 3.2 Scrble (binary, sơ cấp)

- Thước–protractor là một nút gộp: token **`Protractor`** (L149), chuỗi **"Protractor"** (L637) và **"Protractor(P)"** (L594), cùng tooltip gộp **`Tooltip_RulerProtractor`** (L178) → flyout thước có lựa chọn Protractor với phím tắt P; **không có chuỗi "Ruler" đơn lẻ nào trong dump** — bản thân thước được chứng minh qua bộ XBF riêng (`RulerButton/RulerFlyout/RulerCanvas`, L340/341/358). — nguồn: `resources.pri`
- XBF riêng: `RulerButton.xbf` (L340), `RulerFlyout.xbf` (L341), **`RulerCanvas.xbf` (L358)** → thước được vẽ trên một canvas/lớp riêng, đúng mô hình stencil-layer. — nguồn: carve `resources.pri`
- `Eraser (E)`/`Protractor(P)` kiểu phím-tắt-1-chữ khớp bộ `Select (S)` (L592), `View and laserpointer (V)` (L589) — cùng hệ tooltip (L173–181: `Tooltip_Eraser…Tooltip_RulerProtractor…Tooltip_Select`).

### 3.3 Kích thước quy đổi (DIP → doc px của WriteCanvas)

- `DOC_DPI = 2500/8.5 ≈ 294.118` doc px/inch; **1 DIP = 294.118/96 ≈ 3.0637 doc px**; `docMM(mm) = round(mm × 11.5794)` (px/mm). — nguồn: `src/js/paper.js` L7–10, L29; `src/js/pen.js` L11–13 ("basic pen (4 device-independent px) is 4/96 in = 1.058 mm")
- `Length` chuẩn 1600 DIP ≈ **4902 doc px** (dài hơn cả chiều ngang trang 2500 px), tối thiểu 300 DIP ≈ **919 doc px** (~79 mm).
- Eraser stroke chuẩn 2×2 DIP ≈ **6.1×6.1 doc px ≈ 0.53 mm** — rất mảnh; hit-test stroke-erase chỉ cần "chạm".

## 4. Selection — chuẩn SelectWithPolyLine, bounding box, clipboard flow

### 4.1 Chuẩn UWP (mẫu chính thức trong tài liệu khái niệm)

- Lasso là **custom tool**: nét lasso được *"processed and rendered as a selection lasso (dashed line) instead of ink"; all ink strokes within the bounds of the selection area are set to Selected*. Icon đề xuất **"EF20"** (Segoe MLD2 Assets) + tooltip "Selection tool". — nguồn: https://learn.microsoft.com/en-us/windows/apps/design/input/ink-toolbar (mục custom tool)
- Chọn theo polyline trên pointer-released: `boundingRect = InkPresenter.StrokeContainer.SelectWithPolyLine(lasso.Points)` — **nét chỉ được chọn khi nằm trọn trong polyline**; API trả về **bounding rect** của selection. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkstrokecontainer.selectwithpolyline + mã mẫu trong ink-toolbar doc
- vẽ khung selection trên **lớp riêng vừa hạ dưới InkCanvas**: *"Using a separate layer to draw the selection stroke ensures the InkCanvas and its content remain untouched"*, *"Selection UI is drawn on a canvas under the InkCanvas"*; bounding rect mẫu: `Stroke = Blue, StrokeThickness = 1, StrokeDashArray = {5, 2}` và **chỉ vẽ khi selection không rỗng** (`boundingRect.Width == 0 || Height == 0 || IsEmpty` → bỏ qua). — nguồn: mã mẫu trong https://learn.microsoft.com/en-us/windows/apps/design/input/ink-toolbar
- **Tự clear đúng 2 kiểu sự kiện**: `StrokeInput_StrokeStarted → ClearSelection()` và `InkPresenter_StrokesErased → ClearSelection()` — bắt đầu một nét mới hoặc xoá mực là vứt selection hiện hành. — nguồn: như trên
- Flow clipboard chuẩn: **Cut = `CopySelectedToClipboard() → DeleteSelected() → ClearSelection()`**; Copy = `CopySelectedToClipboard()`; Paste = `if (CanPasteFromClipboard()) PasteFromClipboard(new Point(0, 0))`; Move = `MoveSelected(Point)`. — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkstrokecontainer.moveselected , …/pastefromclipboard + mã mẫu

### 4.2 WPF InkCanvas — selection native có move/resize

- `InkCanvas.EditingMode = Select` chọn nét/element bằng bút; các API `CopySelection/CutSelection/PasteSelection`, `GetSelectionBounds()`; **adorner selection** native: `HitTestSelection(Point)` — *"which part of the selection adorner intersects or surrounds the specified point"*; sự kiện `SelectionMoving/SelectionMoved/SelectionResizing/SelectionResized` → chuẩn nền tảng cho phép **kéo di chuyển và resize qua handle** trên bảng chọn. — nguồn: https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.inkcanvas?view=windowsdesktop-10.0

### 4.3 Input phụ của bút & cử chỉ hai ngón cho selection

- InkCanvas UWP: *"To handle pointer events with the InkPresenter object, you must set `RightDragAction` to `LeaveUnprocessed` to pass the input through as `UnprocessedInput` for custom processing by your app."* — đường dẫn chuẩn cho "input phụ" (secondary affordance, ví dụ nút bút) khi app muốn custom processing. — nguồn: https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.inkcanvas
- Scrble quảng bá chọn/move/scale bằng nhị ngón: mô tả Store *"use two fingers to enlarge or move the selection"*. — nguồn: https://appagg.com/windows/productivity/scrble-ink-31449988.html (mirror nội dung Store)

### 4.4 Scrble (binary, sơ cấp)

- Hai kiểu chọn có tên riêng: token **`SelectionLasso`** và **`SelectionRectangular`** (L160–161), chuỗi UI **"Lasso Selection"** (L618) và **"Rectangular Selection"** (L617); tooltip **"Select (S)"** (L592). — nguồn: `resources.pri`
- Lớp & UI riêng: `SelectionButton.xbf`, **`SelectionFlyout.xbf` (L345)**, **`SelectionToolbar.xbf` (L346, L376)**, **`SelectionLayer.xbf` (L366)**, **`SelectionInteractionLayer.xbf` (L365)**, `AdornerLayer.xbf` (L364) → selection là 1 hệ 4 lớp + flyout + toolbar riêng, khớp mô hình "lớp selection nằm dưới InkCanvas + bounding box + toolbar lệnh" của nền tảng. — nguồn: carve `resources.pri`
- Nút **Select của rail thumbnail là chọn TRANG** (`PageSelectionToolbar.xbf` L334, chuỗi "Select Pages" L615) — khác hẳn selection nét bút; `Clear Selection` (L749) thuộc menu rail thumbnail (đã ghi trong `scrble-behavior-deep-dive.md` §2.2). — nguồn: `resources.pri` + `scrble-behavior-deep-dive.md`

## 5. Laser pointer — hiệu ứng trình bày, không có API chuẩn

### 5.1 Các app chính chủ và cách họ làm

| App | Trigger | Hành vi | Nguồn |
|---|---|---|---|
| **OneNote** (Draw tab) | chọn bút "Laser Pointer" | nét vẽ **tự biến mất sau vài giây, không lưu vào note**; 6 màu | https://support.microsoft.com/en-US/OneNote/onenote-help-and-learning/learn-more-about-drawing-tools + https://learn.microsoft.com/en-us/answers/questions/5070835/onenote-using-pen-as-pointer ("anything you draw will disappear after a couple of seconds") |
| **Microsoft Whiteboard** | nút laser pointer trên toolbar (phím **Alt+L**) | laser là hiệu ứng tạm trên infinite canvas; pan = kéo canvas | https://support.microsoft.com/en-us/whiteboard/use-mouse-keyboard-and-pen-in-whiteboard + …/whiteboard-keyboard-shortcuts + …/unleash-ideas-on-microsoft-whiteboard-s-infinite-canvas (đã dẫn trong `scrble-behavior-deep-dive.md` §3.7) |
| **PowerPoint** (Slide Show / Reading view) | **giữ Ctrl + kéo chuột trái** để chỉ nội dung slide; đổi màu tại Slide Show → Set Up Show → **Laser pointer color** | **mặc định đỏ**; tuỳ chọn thêm xanh lá/xanh dương; có thể **record** kèm narration (checkbox "Narrations and laser pointer") | https://support.microsoft.com/en-US/PowerPoint/turn-your-mouse-into-a-laser-pointer |
| **PowerPoint** (bút vẽ trong trình chiếu) | Pen helper ở Presenter View | có **Eraser** (giữ chuột trái kéo qua chỗ cần xoá) và **Erase All Ink on Slide** | https://support.microsoft.com/en-us/powerpoint/draw-on-slides-during-a-presentation |

Thiết kế laser của WriteCanvas quy về công thức: **một lớp canvas riêng, không nằm trong lưu trữ, vệt tráng đầy opacity rồi mờ dần theo thời gian, màu cố định**.

### 5.2 Scrble (binary, sơ cấp)

- Tài nguyên kiểu sprite riêng **`laserpointer.png`** (L214) đặt sát `eraser.png`/`polygon10.png` (L213/215) + nút mode **`ViewButton.xbf`** (L355) + tooltip **"View and laserpointer (V)"** (L589) → đây là **một nút gộp hai tác năng** (view + laser), bật bằng phím V; không có hàng chuỗi flyout laser riêng nào trong dump (khác với eraser/ruler có flyout xbf) → laser hoạt động **ngay trong mode view**, không phải 1 tool độc lập có flyout. — nguồn: `resources.pri` (sơ cấp); chi tiết tương tác trong mode n/d — app không mô tả thêm.

## 6. View-only / pan — "mở khoá tương tác" theo chuẩn nền tảng

- Các đối tượng nghiệp vụ UWP dùng `InkPresenter.IsInputEnabled = false` cho chế độ **view-only** (khi trình chiếu/review, mọi input chạm-drawing bị vô hiệu hoá, canvas chỉ cuộn) — đây là precedent chuẩn cho một mode "view". — nguồn: https://learn.microsoft.com/en-us/windows/uwp/api/windows.ui.input.inking.inkpresenter.isinputenabled
- WriteCanvas gộp pan qua một điều kiện duy nhất: `S.tool === 'pan' || S.tool === 'view' || S.spaceDown || e.button === 1` — kéo scrollLeft/scrollTop. — nguồn: `src/js/editor.js` L306–310
- Whiteboard (chính chủ): pan bằng cách **kéo canvas** với chuột, hoặc Ctrl+mũi tên; zoom bằng wheel. — nguồn: https://support.microsoft.com/en-us/whiteboard/use-mouse-keyboard-and-pen-in-whiteboard

## 7. Đối chiếu hiện trạng WriteCanvas (đọc trực tiếp code)

| # | Công cụ | Hành vi WriteCanvas hiện tại (file:line) | Chuẩn/Scrble | Lệch? |
|---|---|---|---|---|
| 1 | Eraser size | chips **S=2 / M=5 / L=10 mm** (`src/index.html` L143–145, `S.eraserMM: 5` — editor.js L19); `eraseCursorR() = docMM(mode==='stroke' ? 4 : S.eraserMM)` (L360); preview flyout ad-hoc `r = 3 + S.eraserMM × 0.85` (L978) — tỉ lệ giữa S/M/L sai (1.54×) so với tỉ lệ thật (2.5×) | point-erase 3 mức S/M/L như đã map; stroke-erase chỉ cần hit-test mảnh 2×2 DIP; con trỏ = đúng size gôm | ✖ (preview) |
| 2 | Eraser undo/sheet | đã có: cắt vòng tròn chi tiết + `eraseSheet` cả trang | "Erase All Ink" là lệnh flyout của gôm | ✔ (đúng tinh thần) |
| 3 | Ruler snap | `rulerSnapPoint` chiếu **mọi** điểm bút lên **trục giữa** của thước, không kiểm tra khoảng cách, không chặn nét dưới thân (`src/js/editor.js` L740–745) | snap **mép** trong threshold gutter; ngoài gutter vẽ tự do; **mask** dưới thân stencil | ✖ |
| 4 | Ruler visual/band | band `lineWidth 56` hai phía quanh trục giữa (L759), stroke mảnh chia vạch `docMM(10)` (L767), kéo bằng grip | stencil riêng: thân thước che mực, đục 75%/50% (protractor), scale/translate theo canvas | ✖ |
| 5 | Ruler move/rotate | dịch bằng **grip** (L807+); xoay bằng **2 nút ±10°** (`rulCCW`/`rulCW`, L791–794); không xoay trực tiếp trên thân, không chốt góc | *"manipulated… by the user"* + `Transform` (vị trí + góc) | ✖ (xoay chỉ ±10°/bấm) |
| 6 | Protractor | **không có** | Scrble có mode Protractor(P) + `Tooltip_RulerProtractor`; UWP có `InkPresenterProtractor` (rays + readout + opacity 75/50) | ✖ |
| 7 | Lasso hit-test | `page.strokes.filter(st => anyPtInPoly(st.pts, pts))` — chọn nét nếu **bất kỳ** điểm nào nằm trong loop (L583) | `SelectWithPolyLine` — chọn nét **hoàn toàn** nằm trong polyline | ✖ |
| 8 | Selection UI | bounding dashed blue + **4 handle tròn cứng** (chỉ vẽ), hit của drag là `bbox ± 12` (L330) | bounding dashed 1 px `{5,2}`; WPF native có move + **resize** handles; Scrble có `SelectionInteractionLayer` | ✖ (chưa resize) |
| 9 | Selection clear | chỉ clear khi đổi tool sang laser/lasso (`setTool` L511–512); **vẽ nét bút mới hay xoá mực vẫn giữ selection** | clear khi `StrokeStarted` hoặc `StrokesErased` | ✖ |
| 10 | Selection lệnh | có move/duplicate/delete + offset `+26/+26` (L690); **không copy/paste/không flyout** | Cut = Copy→Delete→Clear; Paste có điểm đích; Scrble có `SelectionFlyout/Toolbar` | ✖ |
| 11 | Laser màu | `laserLive = { w: docMM(2.5), color: curPen().color }` — **mượn màu bút đang chọn** (L451) | PowerPoint mặc định đỏ (green/blue tuỳ chọn); OneNote có bảng màu laser riêng — màu laser là của chế độ trình chiếu, không phụ thuộc bút | ✖ |
| 12 | Laser vòng đời | trail đầy opacity < 700 ms rồi fade 600 ms, lifetime cap 1300 ms (L499–503, L484) | OneNote: biến mất sau "vài giây" (couple of seconds) → tổng đường đời ~2 s là sát cảm nhận | ✚ (nếu giữ 1.3 s hơi nhanh) |
| 13 | View mode | `S.tool === 'view'` → pan thuần | Scrble gộp **"View and laserpointer (V)"** một nút | ✚ (quyết định thiết kế — xem 8.E) |

## 8. Khuyến nghị triển khai cho WriteCanvas — số cụ thể

Quy đổi dùng chung: **1 DIP ≈ 3.0637 doc px**; `docMM(mm) ≈ 11.579 × mm` (px/mm); chips gôm hiện hành S/M/L = 2/5/10 mm → **docMM(2)/docMM(5)/docMM(10) = 23/58/116 doc px**; `docMM(2.5)` ≈ 29 doc px (laser hiện hành).

**A. Gôm — giữ đúng bộ mode/size hiện hành, thay công thức preview và con trỏ.**

1. Modes giữ nguyên `segment / stroke / sheet` + 3 mức **S = 2 / M = 5 / L = 10 mm** (khớp chuỗi Scrble "Segment Eraser − Small/Medium/Large" và chips hiện hành `src/index.html` L143–145; doc px tương ứng **23/58/116**). Không đổi `S.eraserMM` (mặc định M = 5 — đã đúng hiện trạng, editor.js L19).
2. **Stroke-erase thu nhỏ hit radius**: hiện dùng bán kính cố định 4 mm; hợp đồng chuẩn chỉ cần "chạm" (eraser stroke chuẩn mới 2×2 DIP ≈ 6 px) → đề xuất hit radius riêng cho stroke mode ~ `docMM(1.5)` ≈ 17 doc px, tách nhánh khỏi `S.eraserMM` trong `eraseCursorR`.
3. Con trỏ trên canvas trang phải là **vòng tròn/elip đúng `r = docMM(S.eraserMM)`** — khớp chuẩn "elliptical cursor" của EraserShape; preview trong flyout (`erWave`) chỉ cần **tỉ lệ đúng 2 : 5 : 10 giữa S/M/L**, bỏ công thức `3 + 0.85×S.eraserMM` (tỉ lệ 1.54× hiện nay sai so với tỉ lệ thật 2.5× giữa M/S).
4. Giữ `eraseSheet` như "Erase All Ink" của flyout gôm (đã có), và làm **"Back to pen after each erase" thành toggle trong settings** theo đúng chuỗi L764 của Scrble (hiện trong Scrble còn hiện thông báo "The app goes back to pen after deleting a stroke." — L761).

**B. Thước — chuyển từ "snap trục giữa" sang stencil đúng hợp đồng.**

1. **Snap chỉ khi trong gutter**: tính `d` = khoảng cách vuông góc từ điểm bút tới **trục** thước; đặt `halfBand = 28` doc px (thân thước ~5 mm tổng, giữ nguyên kích thước band 56 hiện đang dùng) và `gutter = docMM(2)` (≈ 23 doc px). Khi `halfBand < |d| ≤ halfBand + gutter` → điểm mới chiếu lên **mép** (theo phía bút đang đứng: `sign = Math.sign(d)`), điểm snap = `axisPoint + sign × halfBand` theo hướng vuông góc — nét bám **mép** chứ không trục giữa. Khi `|d| ≤ halfBand` → **mask: không sinh nét** (bút đi trên thân thước không vẽ).
2. **Mép ưu tiên cả hai phía** (bút viết bên nào, snap mép bên đó) — theo câu chữ "snaps the ink stroke to the stencil edge" của `InkPresenterRuler`.
3. **Di chuyển + xoay:** giữ grip = dịch và 2 nút xoay hiện hành; bổ sung **kéo trực tiếp trên thân thước** để xoay (end-cap = rotate, theo tinh thần "manipulated… by the user" của chuẩn); chốt autosnap tại **0/45/90/135 (±3°)** — chi tiết "xoay bằng con lăn" của Whiteboard là gợi ý chính-chủ (n/d số góc từng bậc — Scrble không công bố, đánh dấu suy luận thiết kế).
4. **Kích thước chuẩn hoá:** mặc định Length = `docMM(165)` (≈ 1910 doc px, rút gọn từ chuẩn 1600 DIP = 4902 doc px cho vừa trang ngang 2500 px) và **giới hạn Length tối thiểu = docMM(80)** (≈ 926 doc px, tương đương chuẩn 300 DIP min); toggle size trong `RulerFlyout`.
5. **Độc lập zoom:** đánh dấu stencil theo không gian nội dung (`fx/fy` hiện hành là đúng hướng) — khớp *"also scales and translates with the InkCanvas"*.
6. **Protractor mode** (thêm): chọn trong `RulerFlyout` 2 mục radio **Ruler / Protractor** (theo `Tooltip_RulerProtractor` + lớp chuẩn `InkPresenterProtractor`); vẽ **bán-cung** bán kính đề xuất `docMM(40)` (≈ 463 doc px); label readout góc trong khi manipulation, đục **75% đứng yên / 50% manip**, rays bật khi "nét đã snap + protractor đứng yên".

**C. Selection — lasso chuẩn + flyout cuối cùng.**

1. **Đổi hit-test lasso sang "nét nằm trọn trong loop"**: mọi điểm của stroke (`st.pts`) nằm trong poly, **và** 4 góc bbox của stroke nằm trong poly (bao cả phần vòng dày). Giữ `anyPtInPoly` với cùng tối ưu even-odd, đổi điều kiện thành `allPtInPoly` — khớp hợp đồng `SelectWithPolyLine`.
2. **Rectangular selection** cho phép chọn theo rect (chuỗi `SelectionRectangular` của Scrble): cùng điều kiện "stroke bbox nằm trọn trong rect". Có thể trụ hai mode trong một tool bằng flyout (lasso mặc định).
3. **Khung selection chuẩn nền tảng:** nét đứt xanh `1 px`·dash `{5,2}` trên lớp selection riêng nằm **dưới** lớp ink; chỉ vẽ khi selection ≠ rỗng; **handle dạng góc theo WPF**: 4 góc = resize, giữa = move (thay cho 4 handle tròn hiện nay chỉ có tác dụng vẽ).
4. **Flyout để hoàn thiện bộ lệnh:** dồn selection bar hiện có (move/duplicate/delete) thành **Cut / Copy / Paste / Delete** hoặc giữ toolbar + `SelectionFlyout` riêng, theo mẫu Cut = Copy → Delete → Clear; paste/duplicate offset **+26/+26 doc px** hiện hành giữ nguyên như mẫu `PasteFromClipboard(Point)`.
5. **Tự clear đúng 2 sự kiện** như mẫu chuẩn: bắt đầu nét bút mới → `clearSelection()`; `eraseAt`/`eraseSheet` → `clearSelection()`.
6. Gesture hai ngón khớp chuỗi Scrble: **kéo trong bbox bằng 1 ngón = move (hiện có)**; **pinch trên selection = scale** (thêm sau — dựa chuỗi Store "use two fingers to enlarge the selection").

**D. Laser pointer — tư cách màu riêng + nhịp mờ dần.**

1. **Màu cố định riêng**, không mượn `curPen().color`: hằng `LASER_COLOR = '#ff0000'` (mặc định đỏ như PowerPoint) + có thể thêm 2–3 preset (xanh lá/xanh dương như PowerPoint, cùng bảng 6 màu OneNote) đặt trong flyout nút laser.
2. **Vòng đời mờ dần hiện hành: 700 ms full + 600 ms fade (cap 1300 ms)** — theo "will disappear after a couple of seconds" (OneNote) đề xuất **1200 ms full + 800 ms fade (cap 2000 ms)**; giữ `w = docMM(2.5)` (~2.5 mm) và `laserC` riêng không tham gia lưu (đúng — đã có).
3. **Khoảng cách điểm tối thiểu** 9 px² (hiện `distSq < 9`) giữ nguyên như "rate smoothing".
4. Laser **không bao giờ** vào `page.strokes`/recorder/autosave (đã đúng hiện trạng), và clear khi `setTool` (đã đúng).

**E. View-only pan — giữ nguyên, chỉ quyết định gộp/nhánh theo parity Scrble.**

1. Giữ `S.tool === 'view'` = pan (drag scroll) + **laser gộp trong mode view** để khớp tooltip "View and laserpointer (V)": nếu muốn đúng 1:1 chuỗi — một nút V duy nhất, đầu bút/đầu trỏ nhấn-giữ để vẽ laser, pan bằng **space/middle-button** hoặc 2 ngón vẫn hoạt động; cách khác giữ 2 nút riêng (hành vi "view = pan thuần") — cả hai đều củng cố được bằng chuỗi hiện có, ghi rõ đây là quyết định thiết kế (Scrble không công bố chi tiết tương tác, n/d).
2. Pan thuần giữ mọi đường dẫn: pan tool / space held / middle-button (đã đúng hiện trạng).
3. Nếu làm "chỉ-xem hoàn chỉnh" (khoá cả gôm/lasso): `setTool('view')` đồng thời khoá các tool theo precedent `IsInputEnabled = false` — bộ phím tắt giữ nguyên.

**Gói gọn một dòng:** gôm S/M/L = 2/5/10 mm (`docMM` = 23/58/116 doc px) + hit-stroke `docMM(1.5)`; thước `halfBand = 28`, `gutter = docMM(2)`, snap mép + mask; laser `'#ff0000'`, `1200 ms + 800 ms fade`, `docMM(2.5)`; lasso chọn **nét nằm trọn** trong poly; selection clear on stroke-start/erase; flyout Cut/Copy/Paste/Delete; Protractor bán kính `docMM(40)`, đục 75/50.

## 9. Giới hạn tài liệu

- **Gutter của stencil** không có con số chính thức trong tài liệu Microsoft; mọi giá trị đề xuất ở mục 8.B là suy luận thiết kế từ câu chữ "distance threshold (gutter)" — đánh dấu rõ.
- **Cách tương tác trong mode "View and laserpointer (V)" của Scrble** (laser dùng ngón nào, nút gì) không được mô tả trong nguồn sơ cấp nào — chỉ biết được nút và tooltip; chi tiết ở 8.E là lựa chọn thiết kế (n/d).
- **"Clear Selection"** trong pri-strings (L749) được `scrble-behavior-deep-dive.md` xác định thuộc menu rail thumbnail (Select Pages) — không dùng làm bằng chứng cho selection nét bút.
- GitHub code search cho sample "ink ribbon/laser pointer" của Microsoft không cấp được query hợp lệ (422) — laser được chứng minh qua 3 trang chính-chủ tương ứng 3 app (OneNote/Whiteboard/PowerPoint) thay thế.
- Kích thước các rays của protractor / độ dày band chuẩn: Microsoft không công bố số đơn vị; mọi cụm "đề xuất docMM(...)" là lựa chọn thiết kế.

---

*Tài liệu write-only của nghiên cứu; không sửa code, không commit.*
