# Scrble Ink — ruler & page logic (REA deep dive, 2026-10-23)

> **Ngày:** 2026-10-23 · **Loại:** reverse-engineering + research · **Đối tượng:** Scrble Ink UWP `10511ClaudiaWey.inknotespro` v6.8.6.0
> **Trạng thái:** read-only. Không sửa note, không đổi app. WriteCanvas chỉ nhận đề xuất **additive**; default hiện tại (Lasso / Stroke eraser / Ruler **Guide**) không đổi.
> **Câu hỏi:** Scrble làm ruler/protractor và logic page như thế nào ở mức kiến trúc, state machine và runtime — để WriteCanvas đóng khoảng cách mà không phá default hiện tại?

---

## 0. TL;DR

1. **Ruler của Scrble là overlay cấp viewport**, không phải guide cấp trang. `_RulerCanvas` là **sibling** của `_SheetsScrollViewer` trong `SheetManager.xaml`; UIA cho thấy hai phần tử cùng parent và **cùng rect** `(300,108,1620,1032)` khi rail mở, `(0,108,1920,1032)` khi rail đóng.
2. **Ruler/protractor là stencil native của `InkPresenter`**, không phải XAML tự vẽ. `RulerCanvas.xbf` chỉ chứa `_RulerCanvas`; DLL tham chiếu `InkPresenterRuler`, `InkPresenterProtractor`, `IInkPresenterStencil`, `InkPresenterStencilKind`.
3. **`RulerButton` là toggle button có `MoreArrow` ở đáy** (style `MoreToggleButtonStyle`), không phải split button có hit target riêng: left-click thân hoặc vùng arrow đều toggle visibility; **right-click** mở `RulerFlyout`. Flyout có hai `ToggleButton`: `_Ruler` và `_Protractor`.
4. **Mode và visibility là hai trạng thái độc lập.** `_currentRulerMode` nhớ Ruler/Protractor; `ToggleRuler` bật/tắt hiển thị. Flyout có thể đang check “Ruler” trong khi band đang tắt.
5. **Band ruler trải hết chiều ngang viewport**, vượt ra ngoài mép giấy, có tick ở **hai cạnh**, và một **compass readout `0°`** ở tâm. Protractor là vòng tròn đầy đủ có tick, center dot và handle ở cạnh.
6. **Page model là stack dọc các trang rời, cố định kích thước, trong một `ScrollViewer`.** `_PagesVerticalStack` nằm trong `_SheetsScrollViewer`; `_SpacerLayer` và `_CustomCursor` là các lớp phủ cùng scope.
7. **Auto-append chạy trên `ViewChanged`**: `_SheetsScrollViewer_ViewChanged` (`d__54`) gọi `_AddPagesIfScrolledToTheEnd` (`d__55`), dùng `IsScrolledToEnd`, `GetNextSheet`, rồi `InsertNewSheetAndNotify` (`d__80`).
8. **Live test xác nhận**: 30 notch wheel từ trang 1 của note 2 trang → `(3/3)`, trang 3 trắng được append, rail có thêm trang 3. Không có nút `+`.
9. **Scrble có thêm spacer dọc** (`OnePageSpacing` / `TwoPagesSpacing`), **writing-area autoscroll** (timer + palm guard + reverse + scroll ruler) và **rail context menu** (Insert/Duplicate/Delete/Refresh/Select). WriteCanvas chưa có ba nhóm này.
10. **Không thể decompile**: `InkNotes.dll` là NativeAOT, không có CLI metadata/CIL; `inspect_binary_layout` chỉ hỗ trợ Linux x64 ELF; Ghidra chưa cấu hình. Kết luận dưới đây là **artifact evidence + UIA + live input**, không phải pseudocode.

---

## 1. Phương pháp & độ tin cậy

### 1.1 Nguồn

| Nguồn | Dùng để | Mức |
|---|---|---|
| REA artifact inventory trên `scrble.zip` | xác nhận package, entry, occurrence | **observed** |
| REA managed-artifact trên `InkNotes.dll` | xác nhận NativeAOT, không có metadata CLI | **observed** |
| REA PE resources trên `InkNotes.dll` | digest, PE32+, `NETNATIVEBUILDINFO` | **observed** |
| Carve XBF từ `resources.pri` | cây control, tên field, visual states | **observed** (raw bytes) |
| String/metadata table của DLL | tên type/method/field còn sống trong .NET Native | **observed** (raw bytes) |
| UIA dump + screenshot | rect, sibling order, trạng thái live | **observed** |
| CDP/UIA input thật | click, right-click, wheel, phím `P`/`R` | **observed** |
| Microsoft WinRT docs | ngữ nghĩa `InkPresenterRuler`/`InkPresenterProtractor` | **official** |
| Suy luận từ tên method + hành vi | control flow, threshold, thứ tự gọi | **derived/inferred** — ghi rõ |

### 1.2 Giới hạn công cụ

- `InkNotes.dll` (31,494,656 bytes, SHA-256 `560a080cbda9921ee209c0aa896e35299920b7e3280a8149f70f33512401220d`) là **NativeAOT / .NET Native**. REA managed-artifact trả về không có CLI metadata; không có CIL để decompile.
- `inspect_binary_layout` từ chối: `"The initial real-verified pwntools artifact profile supports Linux x64 only."` — không áp dụng cho PE Windows.
- Ghidra không cấu hình (`GHIDRA_INSTALL_DIR` unset), nên không có native pseudocode.
- Vì vậy: **tên type/method/field** trong bài này là bằng chứng thật (bảng string/metadata của .NET Native giữ tên), nhưng **thân hàm và control flow** là suy luận từ tên + hành vi live. Mọi chỗ như vậy được đánh dấu **[DERIVED]**.
- UIA chỉ cho cây control và rect, không cho internal state. Các kết luận “mode vs visibility” dựa trên tổ hợp XBF + DLL + quan sát flyout.

### 1.3 Môi trường live

- Scrble Ink v6.8.6.0, cửa sổ 1938×1158 (client 1920×1100), rail mở 300 px.
- Note đang mở là **`Untitled`** — note scratch do test tạo, không phải note người dùng. Không có stroke nào được viết thêm trong các test ruler/page.
- AUMID: `10511ClaudiaWey.inknotespro_9n0kwq747cbjy!App`; `ApplicationFrameHost` PID `8764`, HWND `657034`; `InkNotes` PID `8072`.

---

## 2. Ruler — kiến trúc

### 2.1 Cây XAML: overlay nằm ngoài scroll viewer

`SheetManager.xbf` (carve `xbf58.bin`, 1.952 bytes, SHA-256 prefix `4F60125425E6FE48`) chứa các tên:

```
_DocumentRootGrid
  _SheetsScrollViewer
    _PagesVerticalStack
      Sheet...
  RulerCanvas
    _RulerCanvas          <- InkCanvas, full viewport
  Spacer
    _SpacerLayer
  _CustomCursor
```

Điểm quan trọng: `RulerCanvas` **không** nằm trong `_PagesVerticalStack` và **không** nằm trong `_SheetsScrollViewer`. Nó là sibling, cùng cấp với scroll viewer. Vì vậy ruler **không scroll theo trang** và **không bị clip theo trang**.

UIA xác nhận:

```
[Pane] _SheetsScrollViewer  Class=ScrollViewer  Rect=(300,108,1620,1032)
  [Image] _Image ...
  [Pane]  InkCanvas ...
[Pane] _RulerCanvas         Class=InkCanvas    Rect=(300,108,1620,1032)
```

Hai phần tử là sibling dưới `CoreWindow`; rect trùng khít. Khi rail đóng, cả hai cùng `(0,108,1920,1032)`.

`RulerCanvas.xbf` (carve `xbf70.bin`, 876 bytes, SHA-256 prefix `88AA21BC08686838`) chỉ có:

```
using:InkNotes.Editor
_RulerCanvas
InkNotes.Editor.RulerCanvas
```

Không có child control, không có `Path`/`Line`/`Canvas` con. Đây là bằng chứng mạnh rằng ruler **không được vẽ bằng XAML**; nó là một `InkCanvas` host cho stencil native.

### 2.2 Stencil native của InkPresenter

DLL tham chiếu trực tiếp:

| Chuỗi | Offset | Ý nghĩa |
|---|---|---|
| `InkPresenterRuler` | `0x6e83e8`, `0x87844f` | type native |
| `InkPresenterProtractor` | `0x6e83e8`, `0x878514` | type native |
| `InkPresenterStencilKind` | `0x87847a` | enum kind |
| `IInkPresenterStencil` | `0x8784bf` | interface chung |
| `__Factory_Windows_UI_Input_Inking__IInkPresenterRulerFactory_Create` | `0x6a3882` | factory create |
| `__Factory_Windows_UI_Input_Inking__IInkPresenterProtractorFactory_Create` | `0x6a38de` | factory create |

Vì app dùng native stencil, các thuộc tính sau là do OS cung cấp (không phải app tự implement):

- `InkPresenterRuler`: `Length`, `Width`, `Transform`, `AreTickMarksVisible`, `IsCompassVisible`.
- `InkPresenterProtractor`: `Radius`, `AreTickMarksVisible`, `AreRaysVisible`, `IsAngleReadoutVisible`, `IsCenterMarkerVisible`, `IsResizable`.
- `IInkPresenterStencil`: `Kind`, `Transform`, `IsVisible`, `ForegroundColor`, `BackgroundColor`.

Nguồn chính thức:
- https://learn.microsoft.com/uwp/api/windows.ui.input.inking.inkpresenterruler
- https://learn.microsoft.com/uwp/api/windows.ui.input.inking.inkpresenterprotractor
- https://learn.microsoft.com/uwp/api/windows.ui.input.inking.inkpresenterstencil
- https://learn.microsoft.com/uwp/api/windows.ui.input.inking.inkpresenterstencil

### 2.3 `RulerCanvas` class — field & method

Cụm string trong DLL tại `0x7ecf80`–`0x7ed1d3`:

| Tên | Loại (suy ra) | Vai trò |
|---|---|---|
| `_globalOffset` | field | offset viewport ↔ page |
| `_CreateRulers` (`d__29`) | async/iterator | tạo `_ruler` + `_protractor` |
| `_ruler` | field | instance `InkPresenterRuler` |
| `_protractor` | field | instance `InkPresenterProtractor` |
| `_ResetPosition` | method | đưa stencil về vị trí mặc định |
| `_PointerEntered` / `_PointerExited` | method | hover/visibility affordance |
| `_DoubleTapped` | method | reset/scale nhanh |
| `_ScaleAttributes` | method | scale `Length`/`Width`/`Radius` theo zoom |
| `_ignoreStroke` | field | chặn stroke do chính stencil tạo ra |
| `EraserPointerPressed` | event | báo SheetManager khi eraser chạm stencil |
| `GetCanvas` / `SetContainer` | method | gắn InkCanvas vào host |
| `SetInkInputMode` | method | chuyển input mode của InkCanvas |
| `ScalePen` | method | scale pen attributes theo zoom |
| `UpdateSize` | method | cập nhật kích thước theo viewport |
| `_RegisterCallbacks` | method | đăng ký event |

**[DERIVED]** `_CreateRulers` tạo cả hai stencil một lần; `SetRulerOn`/`SetRulerMode` chỉ đổi `IsVisible`/`Kind` hoặc swap instance. `_ResetPosition` + `_globalOffset` giải thích vì sao ruler giữ vị trí tương đối khi scroll/zoom nhưng vẫn là overlay.

### 2.4 `RulerButton` — toggle + MoreArrow + right-click flyout

`RulerButton.xbf` (carve `xbf89.bin`, 1.264 bytes, SHA-256 prefix `05BB79A58D61DE7D`):

```
_Button
MoreToggleButtonStyle
FullVisible
Tooltip_RulerProtractor
_Flyout
RulerFlyout
_RulerFlyout
InkNotes.Editor.Controls.RulerButton
```

`RulerFlyout.xbf` (carve `xbf88.bin`, 1.092 bytes, SHA-256 prefix `0BECCE85D738396C`):

```
RulerC
_Ruler
Protractor
_Protractor
HamburgerMenuToggleButtonStyle
InkNotes.Editor.Controls.RulerFlyout
```

DLL method/field của `RulerButton` tại `0x882031`–`0x882119`:

```
ToggleRuler
IsRulerMode
_ApplyRulerMode
_Button_Click
_Button_RightTapped
RulerFlyout_Updated
_RulerMode
Glyph
_currentRulerMode
_RulerFlyout
IsChecked
SelectedGlyph
_Ruler
_Protractor
GetMode
SetModeFromType
```

Live UIA của flyout:

```
[Pane] _Flyout Class=Flyout Rect=(1520,40,190,147)
  [Button] Name='Ruler'      AutoId='_Ruler'      Class=ToggleButton Rect=(1536,55,158,59)
    [Text] Name='v' AutoId='_iconText'
    [Text] Name='Ruler' AutoId='_labelText'
  [Button] Name='Protractor' AutoId='_Protractor' Class=ToggleButton Rect=(1549,126,133,46)
    [Text] Name='w' AutoId='_iconText'
    [Text] Name='Protractor' AutoId='_labelText'
```

Trạng thái quan sát được:

| Input | Visibility | Mode | Flyout |
|---|---|---|---|
| Left-click thân khi đang tắt | **ON** | mode nhớ trước đó (mặc định Ruler) | đóng |
| Left-click thân khi đang bật | **OFF** | giữ nguyên | đóng |
| Left-click vùng `MoreArrow` ở đáy (cùng một button) | **OFF** | giữ nguyên | **không mở** |
| Right-click button | giữ nguyên | giữ nguyên | **mở**; row của mode hiện tại đang checked |
| Click row `Ruler` | giữ nguyên | **Ruler** | đóng |
| Click row `Protractor` | giữ nguyên | **Protractor** | đóng |
| `P` (khi protractor đang bật) | giữ nguyên | **Protractor** | — |
| `R` (khi protractor đang bật) | giữ nguyên | **Ruler** | — |

**Quan trọng:** trong screenshot `ruler-rightclick.png`, band đang **tắt** nhưng row **Ruler** vẫn xanh/checked. Nghĩa là `IsChecked` của row phản ánh **mode**, không phải visibility; còn `IsChecked` của button toolbar phản ánh **visibility** (bind `RulerButton_IsChecked` trong XAML binding table). Đây là hai trạng thái độc lập.

`P` khi chưa có stencil nào bật: **chưa xác định** — test chỉ chạy khi protractor đang bật. Không kết luận.

### 2.5 `SheetManager` bridge

DLL:

```
GetCurrentPen
SetRulerOn
SetRulerMode
GetRulerVisibility
GetRulerMode
_RulerCanvas
_RulerCanvas_StrokesCollected
_RulerCanvas_EraserPointerPressed
```

**[DERIVED]** Luồng:

```
RulerButton._Button_Click / _Button_RightTapped
  -> _ApplyRulerMode
     -> SheetManager.SetRulerMode(mode)
     -> SheetManager.SetRulerOn(visible)
        -> RulerCanvas: _ruler.IsVisible / _protractor.IsVisible
        -> RulerCanvas: Kind = Ruler | Protractor
  -> _currentRulerMode = mode
  -> Glyph / SelectedGlyph cập nhật icon
```

`_RulerCanvas_StrokesCollected` được nối vào `_MayOpenPanel` và `_sheetList_PageUpdated` (cụm `0x7ec485`). Nghĩa là stroke đi qua stencil vẫn được coi là stroke thật của trang: nó đánh dấu page dirty, cập nhật thumbnail, và có thể mở panel. `_ignoreStroke` ngăn stencil tự sinh stroke rác.

### 2.6 Hình học & hiển thị (live)

`ruler-live.png` (SHA-256 prefix `5F46B83BF75A8B6C`):

- Band ngang, **trải hết chiều ngang vùng sheet** (từ mép trái viewport tới mép phải), **vượt qua mép giấy** cả hai bên. Đây là khác biệt trực tiếp với WriteCanvas, nơi band bị `clipLineToRect` cắt đúng trong trang.
- Tick ở **cả cạnh trên và cạnh dưới** của band.
- Ở giữa band có **compass tròn** với các tia và readout `0°`.
- Không thấy handle ở hai đầu band trong trạng thái mặc định; band dài bằng viewport.
- Không thấy label đơn vị (cm/inch) trong screenshot; có thể phụ thuộc setting hoặc bị ẩn ở zoom này.

`protractor-mode-on.png` (SHA-256 prefix `ABC8D7D821F432CB`):

- Vòng tròn đầy đủ, tick quanh chu vi, **center dot** ở tâm.
- Một **handle nhỏ ở cạnh phải** (điểm kéo/rotate).
- Đường kính lớn hơn chiều cao band ruler; có thể kéo/scale bằng handle.
- Hai button toolbar cùng sáng: InkMode (S) và RulerButton (đang hiển thị glyph protractor).

### 2.7 Ruler — những gì chưa biết

- Tick spacing chính xác (mm? 1/16 inch? theo DPI?) — không đo được từ screenshot đủ tin cậy.
- Snap tolerance và snap increment của native stencil — Microsoft docs không nêu con số; cần đo bằng stroke thật.
- `Length`/`Width`/`Radius` mặc định — phụ thuộc OS/DPI, không có trong app code.
- Ruler position có persist qua page switch / app restart không — `_ResetPosition` gợi ý có reset, nhưng chưa test.
- `P` khi stencil đang tắt — chưa xác định.
- Band có thực sự **không** clip theo page không, hay chỉ tràn ra ngoài do `InkCanvas` rộng hơn page? Về mặt render, nó là overlay full viewport; về mặt snap, chưa đo.

---

## 3. Page — kiến trúc

### 3.1 Mô hình: stack dọc các trang rời trong một ScrollViewer

`SheetManager.xbf`:

```
_DocumentRootGrid
  _SheetsScrollViewer          <- ScrollViewer duy nhất
    _PagesVerticalStack        <- StackPanel dọc
      Sheet (Paper + InkCanvas + Text/Shape/Picture layers)
  _RulerCanvas                 <- overlay
  _SpacerLayer                 <- overlay kéo spacer
  _CustomCursor                <- overlay cursor
```

DLL field của `SheetManager` tại `0x7ec9f6`–`0x7ecabc`:

```
_currentPen
_writingArea
_currentSheet
_paperFiles
_scrollViewer
_spacingManager
_paperThumbnail
_DocumentRootGrid
_SheetsScrollViewer
_RulerCanvas
_SpacerLayer
_CustomCursor
_PagesVerticalStack
```

Đây **không phải infinite canvas**. Mỗi `Sheet` có paper cố định; stack chỉ nối các sheet theo chiều dọc.

### 3.2 Auto-append: chuỗi method

| Tên | Offset | Vai trò |
|---|---|---|
| `_SheetsScrollViewer_ViewChanged` (`d__54`) | `0x7ebcc9` | handler mỗi khi scroll/zoom thay đổi |
| `_AddPagesIfScrolledToTheEnd` (`d__55`) | `0x7ebd0c`, `0x7ec42e` | async appender |
| `IsScrolledToEnd` | `0x7ecf06` | kiểm tra đáy |
| `GetNextSheet` (`d__51`) | `0x7ebc85` | lấy sheet kế tiếp |
| `InsertNewSheetAndNotify` (`d__80`) | `0x7ebdcc`, `0x7ec5e0` | insert + raise `PageAdded` |
| `_AddMinNumPages` | `0x7ec851` | đảm bảo số trang tối thiểu |
| `_InsertSheet` / `_NewSheet` | `0x7ec7a5`, `0x7ec7e2` | tạo sheet |
| `_RemoveSheet` / `RemoveSheets` | `0x7ec677`, `0x7ec623` | xoá |
| `ReorderPage` / `_ReorderPages` / `MoveSheet` | `0x7ebe2d`, `0x7ec694`, `0x7ec6a2` | đổi thứ tự |
| `AllEmptySheets` | `0x7ec630` | dọn sheet rỗng |
| `_GetSheetOnScreen` | `0x7ec802` | sheet đang hiển thị |

**[DERIVED]** Flow:

```
SheetsScrollViewer.ViewChanged
  -> _SheetsScrollViewer_ViewChanged (d__54)
     -> if IsScrolledToEnd():
          _AddPagesIfScrolledToTheEnd (d__55)
            -> GetNextSheet()
            -> InsertNewSheetAndNotify (d__80)
               -> _InsertSheet / _NewSheet
               -> PageAdded event
               -> _sheetList_PageUpdated
                  -> _UpdateImage (d__34)   // rail thumbnail
```

`_AddMinNumPages` chạy khi load/new note để đảm bảo không mở ra note 0 trang. Không rõ giá trị tối thiểu là 1, 2 hay 3.

### 3.3 Điều hướng & hằng số

| Tên | Offset | Vai trò |
|---|---|---|
| `ScrollToPage` | `0x7ece1d` | nhảy tới page index |
| `ScrollPageUp` / `ScrollPageDown` | `0x7ece2a`, `0x7ece37` | page up/down |
| `ScrollLeft` / `ScrollRight` | `0x7ece4d`, `0x7ece5f` | autoscroll ngang |
| `NewLine` | `0x7ece6b` | xuống dòng trong writing area |
| `Pan` | `0x7ece7f` | pan |
| `MouseWheen` | `0x7ecea1` | typo trong app; wheel handler |
| `FindPageIndex` | `0x7ececf` | index từ sheet |
| `GetCurrentIndex` | `0x7ecef6` | index hiện tại |
| `IsScrolledToEnd` | `0x7ecf06` | đáy |
| `PAGEHEIGHT` | `0x7ecde1`, `0x7ecfbc` | chiều cao trang |
| `SCROLLAMOUNT` | `0x7ecde1`, `0x7ecfcb` | bước scroll |
| `ZoomToFit` / `UpdateMinZoom` / `ZoomFactor` | `0x7ecf23`, `0x7ece0f`, `0x7ecdc9` | zoom |
| `FitWidth` / `DelayFitWidth` / `FitWidthDelay` | `0x7ec582`, `0x7ec536`, `0x7ec56b` | fit-width |

`PAGEHEIGHT` và `SCROLLAMOUNT` là hằng số dùng cho `ScrollPageUp/Down` và autoscroll. **[DERIVED]** `ScrollPageDown` nhảy đúng một page height; `SCROLLAMOUNT` là bước nhỏ hơn cho autoscroll.

### 3.4 Spacer dọc

`Spacer.xaml` là một control riêng (`InkNotes.Editor.Spacer`). DLL:

```
_SpacerLayer_OnStart
_SpacerLayer_OnMove
_SpacerLayer_OnEnd
_SpacerLayer_OnWheel
_spacerPoint
_origin
_globalOffset
_UpatePageTwoZIndex     // typo của Update
_SetSpacertPoint        // typo của SetSpacerPoint
```

PRI strings:

```
One Page Spacer
Two Pages Spacer
Add or remove space in the current page or across two consecutive pages
Do you want to continue and allow the overlap or insert a blank page to prevent it?
```

**[DERIVED]** Người dùng kéo một đường kẻ lên/xuống để **chèn hoặc bớt khoảng trắng dọc** trong trang hiện tại, hoặc xuyên qua hai trang liền nhau. Khi vùng chèn chồng lên nội dung trang kế, app hỏi có cho overlap hay chèn blank page. `_UpatePageTwoZIndex` chỉnh z-index khi spacer bắc qua hai trang.

Đây là **không phải** page creation bằng kéo; nó là content spacing. Cần phân biệt rõ khi nói “Scrble có kéo để thêm trang” — thực ra là auto-append khi scroll + spacer để thêm khoảng trắng.

### 3.5 Writing area autoscroll

`WritingArea.xaml` (PRI: `WritingArea.xbf`, `Assets\Help\WritingArea.png`) và DLL tại `0x7ecc1b`–`0x7ecd65`:

```
StopScroll
_UpdateButtonIcon
_ScrollLeftButton_Click
_ScrollRightButton_Click
_UpdatePosition (local func setHeight)
_writingareaposition
PalmGuard
_reverse
_redLineOffset
_lineHeight
_ScrollViewer
SCROLLTIMER
_WritingAreaGrid
_WritingPaneGrid
_PalmGuard
_ScrollLeftButton
_ScrollRightButton
_ScrollRightButtonImage
_ScrollRuler
WRITINGAREAPOSITION
_zoomPosition
Reverse
```

PRI:

```
Autoscroll
Auto-scroll left to right
Auto-scroll right to left
Right-to-left writing
The page will autoscroll when reaching this area
Writing Area
Writing Pane On / Off
```

**[DERIVED]** Đây là chế độ viết liên tục: khi ngòi bút đi vào vùng cuối trang, một `SCROLLTIMER` tự cuộn ngang (hoặc dọc) để mở trang kế; `_PalmGuard` chặn lòng bàn tay; `_reverse` đảo chiều; `_redLineOffset`/`_lineHeight` tính vị trí đường đỏ và dòng; `_ScrollRuler` là thước ngang hiển thị vị trí cuộn.

### 3.6 Rail & page actions

`PagesPreviewList.xbf` (carve `xbf71.bin`):

```
PageListDataTemplate
_ListView
_PageListMenuFlyout
InsertPage
DuplicatePage
DeletePage
Refresh
SelectPages
ClearSelection
```

DLL:

```
_UpdateImage (d__34)
_StartMultiSelect (d__38)
_StopMultiSelect (d__40)
IsMultiSelection
GetSelectedPageIndexes
GetSelectedPages
add_PageAction / remove_PageAction
add_PageReorder / remove_PageReorder
add_CurrentPageChanged / remove_CurrentPageChanged
add_SelectionModeChanged / remove_SelectionModeChanged
```

PRI:

```
Insert Page
Insert Blank Page
Duplicate Page
Delete Page
Select Pages
Clear Selection
Are you sure you want to delete this page?
Are you sure you want to delete these pages?
```

**[DERIVED]** Rail là `ListView` các `PageImage`; right-click hoặc menu mở `_PageListMenuFlyout`; multi-select chuyển sang `PageSelectionToolbar` với ExportPDF/Share/Email/Print.

### 3.7 Live page behavior

- Trước test: note `Untitled` có 2 trang; `_CurrentPageDisplay` = `(1/2)`.
- 30 notch wheel xuống từ trang 1 → `(3/3)`, trang 3 trắng, rail thêm item 3 (screenshot `scrble-page2.png`, SHA-256 prefix `5992810974CD62D9`).
- UIA của `_SheetsScrollViewer` cho thấy cặp `Image` + `InkCanvas` của trang hiện tại có rect thật; các trang còn lại có `Rect=(empty)` và `Offscreen=True`. **[DERIVED]** Stack có virtualization: chỉ trang gần viewport được realize.
- `_CurrentPageDisplay` nằm cạnh `_CurrentNameDisplay`; title window là `Untitled (3/3) — Scrble Ink`.
- Không có nút `+` trên toolbar hay rail; page creation là auto-append + menu.

---

## 4. Đối chiếu WriteCanvas

### 4.1 Ruler

| Hành vi Scrble | WriteCanvas hiện tại | Khoảng cách | Đề xuất additive |
|---|---|---|---|
| Overlay full viewport, band tràn ngoài page | Band bị `clipLineToRect` cắt trong page (`src/js/editor.js:1162-1208`, `src/js/ruler.js`) | Band dừng ở mép giấy | **P1**: thêm option render “extend past page” (chỉ visual; snap math vẫn clip) |
| Hai mode Ruler/Protractor, mode nhớ độc lập visibility | Một guide line + `rulerOn` boolean (`editor.js:1109`, `1136-1147`) | Không có mode/protractor | **P1**: thêm `rulerMode: 'guide' \| 'protractor'`, tách khỏi `rulerOn` |
| Toggle + `MoreArrow` + right-click flyout | Một button toggle + cụm `−10° / +10°` (`editor.js:1211-1231`, `index.html:74`) | Không có flyout/mode picker | **P0**: right-click + caret mở menu `Ruler options`; giữ Guide default |
| Tick hai cạnh + compass readout | Tick hai cạnh + grip + readout góc (`drawRulerLayer`) | Gần parity; thiếu compass style | **P2**: đổi readout thành compass tròn khi ở chế độ Protractor |
| Kéo grip để di chuyển; handle để scale/rotate | Kéo grip; rotate bằng nút ±10° | Thiếu drag-rotate và resize | **P2**: thêm rotate handle + endpoint resize; lưu `length`/`width` |
| Snap theo đường | Snap theo đường (`rulerSnapPoint`) | Parity | Giữ nguyên |
| Eraser tương tác stencil | Eraser không xoá guide | Khác biệt nhỏ | Không cần đổi |

**Default phải giữ:** `Guide`. Protractor chỉ là mode thứ hai, không auto-bật, không thay đổi hành vi snap hiện tại.

### 4.2 Page

| Hành vi Scrble | WriteCanvas hiện tại | Khoảng cách | Đề xuất additive |
|---|---|---|---|
| Stack dọc nhiều trang trong một ScrollViewer | Một trang render tại một thời điểm (`renderPage`, `setPage`) | Không có continuity | **P2** (cần duyệt): continuous stack; giữ page model rời |
| Auto-append khi scroll past end | Pull/wheel ở đáy: trang kế nếu có, ngược lại append (`editor.js:720-741`, `1609-1631`, `2807-2851`) | Đã parity ở boundary; khác ở chỗ Scrble append ngay cả khi còn trang sau? Không — live test cho thấy chỉ append khi hết trang | **P0 done**; **P1**: peek sliver của trang kế |
| `_AddMinNumPages` đảm bảo tối thiểu | Bắt đầu 1 trang | Khác biệt nhỏ | **P2**: option “start with 2 pages” |
| Rail context menu Insert/Duplicate/Delete/Refresh/Select | Rail có page list + prev/add/next (`index.html:92-96`) | Thiếu context menu | **P1**: thêm context menu, confirm trước delete |
| Spacer dọc (One/Two Page Spacer) | Không có | Thiếu | **P2**: deferred — cần thay đổi page content model |
| Writing-area autoscroll (timer, palm guard, reverse) | Không có | Thiếu | **P2**: deferred — chỉ hữu ích với continuous writing |
| Double-tap zoom / fit width | Fit width + Ctrl+wheel (`editor.js:260-283`) | Gần parity | Không cần đổi |
| Page counter `(n/N)` | Có (`updateTitle`, `src/js/editor.js`) | Parity | Giữ nguyên |

### 4.3 Những gì WriteCanvas đã làm đúng (không nên revert)

- Page boundary **direction-aware**: `setPage` phát `page-enter-next` / `page-enter-prev`, 200 ms, 16 px, tôn trọng `prefers-reduced-motion` (`editor.js:424-433`, `style.css:322-323,712`).
- Hint phân biệt `next` vs `add` (`updatePullHint`, `editor.js:223-241`).
- Wheel tại đáy: chuyển trang kế nếu có, ngược lại append; `wheelAddLock` 900 ms chống double-append (`editor.js:2833-2850`).
- Scroll memory theo từng trang (`rememberPageScroll` / `restorePageScroll`, `editor.js:407-421`).
- QA thật: `scripts/qa-5b.mjs` có block “pull page 1 → page 2, no accidental append” và “wheel page 1 → page 2, no append”.

---

## 5. Đề xuất theo priority

### P0 — làm ngay, rủi ro thấp, không đổi default

1. **Ruler split surface**: thêm caret/right-click mở menu nhỏ:
   - `Ruler (Guide)` — default, đang bật.
   - `Protractor` — chỉ enable khi implement xong; không để item chết.
   - `Reset position`, `Horizontal`, `Vertical`.
   - Giữ left-click = toggle như hiện tại.
2. **Ruler mode state tách khỏi visibility**: `S.rulerMode = 'guide'` + `S.rulerOn`. Khi chuyển mode, không tự bật; khi bật, dùng mode đã nhớ. Đây là parity với `_currentRulerMode`.
3. **Phím tắt**: `R` = Guide (đã có), `P` = Protractor (chỉ khi implement). Không đổi `R` hiện tại.
4. **Page boundary**: giữ nguyên fix vừa làm; thêm test hồi quy cho “page cuối + wheel append” và “page giữa + wheel next”.

### P1 — trung bình, cần QA kỹ

5. **Protractor overlay**:
   - Vẽ vòng tròn + tick + center dot + angle readout trên layer riêng.
   - Snap theo góc (1° hoặc 5°) khi vẽ; không thay đổi stroke model.
   - Radius resize bằng handle; lưu `radius`.
   - Không auto-bật; chỉ dùng khi user chọn.
6. **Viewport-level ruler render**:
   - Vẽ band vượt mép page như Scrble; snap vẫn dùng `clipLineToRect` để không tạo stroke ngoài page.
   - Đây là thay đổi visual, không ảnh hưởng dữ liệu.
7. **Peek next page**:
   - Ở đáy page, hiện một sliver của page kế (nếu có) trước khi commit; giữ nguyên one-page model.
   - Khi không có page kế, hiện hint “Pull to add a page”.
8. **Rail context menu**:
   - Insert blank, Duplicate, Delete, Select pages.
   - Confirm trước delete; không BAO GIỜ tự xoá note người dùng.
9. **Ruler persistence**: lưu `angle`, `fx`, `fy`, `mode` theo session; không ghi vào note nếu không cần.

### P2 — lớn, cần duyệt rõ ràng

10. **Continuous page stack**: chỉ làm khi user duyệt. Cần:
    - Virtualized stack + per-page scroll.
    - Hit-testing/selection across pages.
    - Zoom transform cho cả stack.
    - Save/undo isolation theo page.
    - Không phá note format hiện tại.
11. **Vertical spacer**: cần page content model thay đổi (chiều cao page variable). Defer.
12. **Writing-area autoscroll**: timer + palm guard + reverse. Defer đến khi có continuous writing.
13. **Native-like stencil gestures**: endpoint resize, rotate handle, double-tap reset. P2 vì phụ thuộc P1 Protractor.

---

## 6. Bảng bằng chứng

### 6.1 REA evidence

| Evidence ID | Nội dung | Dùng cho |
|---|---|---|
| `ev_9bdc08031c8ed9167a32c33dce7f2fbb081115b376feb45e8f31b27f373216a7` | `scrble.zip` inventory: 580 entries / 196 occurrences / 189 nodes | xác nhận package v6.8.6.0 |
| `ev_56ffadfd9d45939eba020a579cc235a9cc7386526ca0a1cdc2da2af50bc66732` | `InkNotes.dll` managed artifact: NativeAOT, không CLI metadata | giới hạn decompile |
| `ev_722b545361c6b39c5620aa9f779b9518d3de72c4ffd4897dbf3dbcde84f6526b` | PE resources: PE32+, x86_64, `NETNATIVEBUILDINFO` | toolchain/version |

`NETNATIVEBUILDINFO`:

```
Build Type: ret
ilc.exe         : 2.2.29722.00
nutc_driver.exe : 2.2.29722.00
rhbind.exe      : 2.2.29722.0
sg.exe          : 2.2.29722.00
Framework       : 4.6.28529.05
Microsoft.Graphics.Canvas        : 1.23.0
Microsoft.Toolkit.Uwp.UI.Controls: 5.1.1.183
Syncfusion.Pdf.UWP               : 18.3460.0.35
```

### 6.2 XBF carve

| File | Bytes | SHA-256 prefix | Nội dung chính |
|---|---:|---|---|
| `xbf70.bin` (RulerCanvas) | 876 | `88AA21BC08686838` | `_RulerCanvas` only |
| `xbf58.bin` (SheetManager) | 1.952 | `4F60125425E6FE48` | `_SheetsScrollViewer`, `_PagesVerticalStack`, `_RulerCanvas`, `_SpacerLayer`, `_CustomCursor` |
| `xbf88.bin` (RulerFlyout) | 1.092 | `0BECCE85D738396C` | `_Ruler`, `_Protractor`, `RulerC` |
| `xbf89.bin` (RulerButton) | 1.264 | `05BB79A58D61DE7D` | `_Button`, `MoreToggleButtonStyle`, `_Flyout` |
| `xbf92.bin` (PenToolbar) | 3.552 | `DD2C8F60AFB5FBAC` | `RulerButton`, `_RulerButton`, tool order |
| `xbf71.bin` (PagesPreviewList) | — | — | `_ListView`, `_PageListMenuFlyout`, page actions |
| `xbf56.bin` (WritingArea) | — | — | `_ScrollRuler`, `_ScrollLeftButton`, `_ScrollRightButton` |

Thư mục carve: `C:\Users\Admin\AppData\Local\Temp\opencode\xbf-carve`.

### 6.3 Live UIA / screenshot

| File | SHA-256 prefix | Nội dung |
|---|---|---|
| `ruler-live.png` | `5F46B83BF75A8B6C` | band ruler full viewport, tick hai cạnh, `0°` compass |
| `ruler-rightclick.png` | `41F360392FA1D84A` | flyout Ruler/Protractor, Ruler row checked dù band tắt |
| `protractor-mode-on.png` | `ABC8D7D821F432CB` | protractor tròn, center dot, handle phải |
| `scrble-page2.png` | `5992810974CD62D9` | `(3/3)`, trang 3 trắng, rail 3 item |

Thư mục: `C:\Users\Admin\AppData\Local\Temp\opencode`.

### 6.4 `resources.pri` strings

```
RulerButton.xbf
RulerFlyout.xbf
RulerCanvas.xbf
SheetManager.xbf
PagesPreviewList.xbf
WritingArea.xbf
Protractor
Protractor(P)
Tooltip_RulerProtractor
One Page Spacer
Two Pages Spacer
Insert Page
Insert Blank Page
Duplicate Page
Delete Page
Select Pages
Clear Selection
Autoscroll
Auto-scroll left to right
Auto-scroll right to left
Right-to-left writing
Page settings
The page will autoscroll when reaching this area
Do you want to continue and allow the overlap or insert a blank page to prevent it?
```

---

## 7. Kết luận

- Scrble tách **ruler khỏi page**: ruler là overlay viewport dùng stencil native; page là stack dọc trong ScrollViewer. Hai hệ gần như độc lập, giao nhau qua `SheetManager` và `_RulerCanvas_StrokesCollected`.
- **Ruler button** là split button thật: thân toggle, caret toggle-off, right-click flyout chọn mode. Mode và visibility độc lập.
- **Page auto-append** là hệ quả của `ViewChanged` + `IsScrolledToEnd` + `InsertNewSheetAndNotify`, không phải nút “add page”. Live test xác nhận `(1/2) → (3/3)`.
- WriteCanvas đã có boundary behavior đúng hướng và transition direction-aware; phần còn thiếu là **Protractor/mode**, **viewport-level render**, **rail context menu**, và các tính năng lớn hơn (continuous stack, spacer, autoscroll) chỉ nên làm khi được duyệt.
- Mọi đề xuất trong bài giữ nguyên default: **Lasso**, **Stroke eraser**, **Ruler Guide**.

---

## 8. Open questions

1. `_AddPagesIfScrolledToTheEnd` append **một** page hay **đủ lấp viewport**? Live chỉ thấy một page cho 30 notch.
2. `_AddMinNumPages` tối thiểu là bao nhiêu?
3. `P` có bật stencil khi đang tắt không?
4. Ruler position/mode có persist qua page switch hoặc restart không?
5. Native ruler snap increment là bao nhiêu? Có snap theo angle không?
6. Protractor có snap theo angle không, hay chỉ là công cụ đo?
7. Stack có virtualize thật không, hay chỉ collapse offscreen? UIA cho thấy `Rect=(empty)` + `Offscreen=True`.
8. `OnePageSpacing` / `TwoPagesSpacing` là scope của spacer hay là view mode? PRI nghiêng về spacer scope.

---

## 9. Phụ lục — lệnh/tệp tái lập

```powershell
# 1. Carve XBF từ resources.pri (đã có trong temp)
Get-ChildItem "$env:TEMP\opencode\xbf-carve" -Filter "xbf*.bin"

# 2. Xem UIA live (Scrble đang mở)
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\opencode\click-uia-shot.ps1" `
  -Hwnd 657034 -OutPng "$env:TEMP\opencode\check.png" -OutTxt "$env:TEMP\opencode\check.txt" -Escape -NoClick

# 3. Right-click mở RulerFlyout
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\opencode\right-click-uia-shot.ps1" `
  -Hwnd 657034 -X 1616 -Y 74 -OutPng "$env:TEMP\opencode\rc.png" -OutTxt "$env:TEMP\opencode\rc.txt"

# 4. Scroll past end (30 notch)
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\opencode\scroll-page-uia.ps1" -Hwnd 657034
```

**Không chạy các lệnh trên lên note người dùng.** Chỉ dùng note scratch; dọn note scratch sau test.
