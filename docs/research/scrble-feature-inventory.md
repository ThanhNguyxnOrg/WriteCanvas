# Scrble Ink — Feature Inventory (deep pass #2)

> Nguồn bằng chứng (primary sources, không có suy đoán trừ khi ghi chú):
> - `InkNotes.dll` (31.4 MB, .NET Native AOT) — strings UTF-16LE/ASCII, dump bằng `scripts/dump-strings.mjs`, context bằng `scripts/dump-range.mjs`
> - `resources.pri` — resource string XAML của app
> - `Assets/Paper/**` trong appx đã giải nén — đo pixel bằng `scripts/measure-paper.mjs` (PNG decoder tự viết)
> - Note thật của user: `…\LocalState\Scribble\Untitled#01.png` (2500×3235)
> - Kết quả này **sửa 3 kết luận sai** trong ANALYSIS.md/ui-parity (xem §8).

## 1. Hệ thống bút (pen system)

Từ XAML resource của flyout bút (PRI `0x45e00–0x46200`) + field names trong DLL (`0x880a09`, `0x8829dc`):

| Loại bút | Resource key | Button field | Glyph field |
|---|---|---|---|
| Marker (bút mực) | `PenPen` | `_MarkerButton` | `_MarkerGlypse` |
| Pencil (chì) | `PenPencil` | `_PencilButton` | `_PencilGlypse` |
| Calligraphy (mực lông) | `PenCalligraphy` | `_CaligraphyButton` (sic) | `_CaligraphyGlypse` |
| Highlighter (bút dạ) | `PenHighlighter` | `_HighlighterButton` | `_HighlighterGlypse` |
| Highlighter vuông | — | `_HighlighterSquaredButton` | `_HighlighterSquaredGlypse` |

- App dùng **Windows UI InkToolbar** làm nền (`InkToolbarCustomToolButton`, `InkToolbarCustomToggleButton`, `get_DrawAsHighlighter`, `get_PencilProperties`, `get_FitToCurve`, `PenTipShape`) → 5 loại bút trên là cây tool thật, không phải trang trí.
- `PenButtonGrid` + `PenButton` (`PenAttributes`, `IsSelected`, `_CurrentPen`, `_SelectedPen`, `_UnselectedPen`, `_CurrentWidth`, `_currentPenIndex`) → **nhiều slot bút** trên toolbar, mỗi slot giữ màu/width/loại riêng.
- `InkModeFlyout` (`_InkModeFlyout_Updated`, `IInkModeButton`) — flyout chọn mode ink.
- Thuộc tính bút trong code: `Opacity`, `Pressure` (`get_Pressure`, `get_IgnorePressure`), width, `PenTipShape`, `FitToCurve`.
- Laser pointer là tool riêng (`ms-appx:///Assets/Images/laserpointer.png`), eraser có flyout riêng (`EraserFlyout`, `ms-appx:///Assets/Images/eraser.png`).

## 2. Bảng màu (3 hệ độc lập)

### 2.1 Palette bút mặc định — 29 màu (DLL `0xd6a4dc`, chuỗi `"255,0,0,0,…"`, ARGB)

```
#000000 #FFFFFF #D1D3D4 #A7A9AC #808285 #58595B
#B31564 #FF0000 #FF5500 #FFAA00 #FFCE00 #FFE600
#A2E61B #26E600 #008055 #00AACC #004DE6 #3D00B8 #6600CC #600080
#F7D7C4 #BB9167 #8E562E #613D30
#FF80FF #FFC680 #FFFB0A #32FF5C #2EF0FF
```

(Lưu ý: `settings.dat` của user lệch 2 giá trị — `D3D3D4`, `828283`, `FFFF80` thay cho `D1D3D4`, `808285`, `FF80FF` — user đã tự chỉnh; chuỗi trong DLL là factory default.)

### 2.2 Màu nền giấy `papercolors` — 11 màu (DLL `0xd6a324`, ARGB)

```
#FFFFFFFF #FFF0F0F0 #FFE0E0E0 #FF363636 #FF181818 #FF000000
#FFE5E0E4 #FFF5F5DC #FFF0F6F6 #FFD4E4DA #FFDBEAFF
```

(trắng → 2 xám sáng → 2 xám đen → đen → be → be giấy → trắng xanh → mint → xanh pastel)

### 2.3 Màu text — 6 màu (DLL `0xd6a82c`)

```
#000000 #FF0000 #009600 #0000FF #FF00FF #FFFFFF
```

(dùng cho TextToolbar — `FONTCOLORHEX`, `Text Color`, `Font Size`, Bold/Italic, `CanvasTextBox`)

- Chọn màu tùy chỉnh: `CustomColorDialog` (dialog riêng, có slider R/G/B — `BlueSlider` trong XAML).
- Grid màu trong flyout: `ColorsGridView` (`ColorButtonSize`, `RoundButtonColorItemStyle`).

## 3. Hệ thống giấy

### 3.1 Page sizes chuẩn (PRI `0x3cd48` vùng `PageSize`/`paperStandard`)

```
Letter, Legal, Tabloid, A0, A1, A2, A3, A4, A5, A6, A7, A8   (12 size)
```

Class `InkNotes.Data.Models.PaperSizes.Standard`. Đo được: Letter = 2500×3235 px ⇒ **render scale = 294.12 dpi** (2500/8.5in), KHÔNG phải 3×96=288 như kết luận cũ.

### 3.2 Template papers — thư mục `Assets/Paper/Square/HighRes/` (đều 4120×4120 px)

"Square" = danh mục **giấy ô/kẻ pattern** (không phải page size — SỬA kết luận cũ). Toàn bộ vẽ **native-scale, neo top-left** lên trang (pitch 55px của asset = pitch 55px trên raster Letter thật).

| Template | Pitch (px @294.1dpi) | mm | Màu nét (RGBA trong asset) | Ghi chú |
|---|---|---|---|---|
| `ruled` | 55 | 4.75 | `rgb(65,168,253,102)` #41A8FD α0.4 | kẻ ngang, nét đầu y=55, Flatten trên trắng = #B3DCFE ✓ |
| `ruled10` | 27 | 2.33 | `rgb(121,128,134,76)` #797A86 α0.3 | flatten ≈ #D7D9DB |
| `ruled15` | 41 | 3.54 | như trên | |
| `ruled20` | 55 | 4.75 | như trên | |
| `ruled30` | 80 | 6.91 | như trên | |
| `ruled40` | 110 | 9.50 | như trên | |
| `dotted10` | 27 (lưới chấm) | 2.33 | chấm th=4px | |
| `dotted20` | 55 | 4.75 | chấm th=8px | |
| `graph` | 7 (lưới 2 chiều) | 0.60 | xám | ô cực nhỏ |
| `isometric | tam giác ~16px | 1.38 | xám | lưới iso 3 hướng |
| `math` | 55 (lưới 2 chiều) | 4.75 | **XANH** #41A8FD α0.4 | "Math paper" help topic |
| `math10/15/20/30/40` | 27/41/55/80/110 | — | xám #797A86 α0.3 | lưới 2 chiều |
| `music` | staff: 5 nét × 23px (1.99mm), cách staff 117px (10.1mm), nét đầu y=171 | — | `rgb(155,155,155)` | 19 staff |
| `todo` | hàng 110px (9.5mm) từ y=219 + cột checkbox ~50px tại x≈196 | — | xám | |
| `blank` | — (asset 24×24 trắng) | — | — | |

### 3.3 Planner papers — `Assets/Paper/{Portrait,Landscape}/HighRes/` (2500×3235, đúng shape trang)

16 template mỗi hướng: `5days, 7days, daily, dailyPlanner, fitness, habitTracker, homework, menuPlanner, monthly, phone, phoneAndNote, projectPlanner, tablet, tabletAndNote, yearly, yearlyPlanner`. Nét xám #9B9B9B/#A1A1A1, layout dạng bảng (đã đo số liệu thô trong `measure-paper` output).

### 3.4 Cơ chế giấy trong app (từ XAML + fields)

- `PaperGridDataTemplate` + `_PaperGrid` + section headers `PaperPortrait` / `PaperLandscape` + `SectionHeading "Paper"` → picker dạng grid 3 mục.
- Thumbnail picker nhanh: `Thumbnails/*.png` 98×98 (+`more.png` mở picker đầy đủ, `custom.png` = icon folder → **Custom paper = load ảnh từ thư mục**, có trang download `scrble.com/custom-paper`).
- `PaperBackgroundColor` + `_backgroundColor` + `papercolors` → chọn màu nền giấy (11 màu trên).
- **`BorderLines` / `_borderLine`** toggle → 2 đường lề đỏ dọc. Đo từ note thật: **x=120 và x=2380 (đối xứng, th=2px, `#C4728D` flatten)** = 120px @294.1dpi ≈ 0.41in. ↔ flag `sBRL` trong format file.
- `WritingPaneOn/Off` + `_SetWritingPane` + font `Assets/scrble.ttf` → vùng "writing pane" (strip nét đứt trên UI — **không nằm trong raster đã lưu**, đã kiểm tra bằng mắt trên note thật).
- SRTL: `RightToLeftWriting` setting.

## 4. Save / Export

`SaveFlyout`: toggle **`SAVEFULLPAGE`** (full page vs crop theo nội dung) + **`SAVEBACKGROUND`** (có/không nền giấy) + `OptionsButton`/`SaveButton` + `_fullPageToggle`/`_paperBackgroundToggle`. ↔ flag `sCRP` trong format file. Export: PNG/JPEG/BMP/PDF (`PDFPassword` dialog, `SaveAndExportQuality`), print (`ContinuationPage`).

Chunk phát hiện thêm: **`sPPR`** (UTF-16LE trong DLL, cạnh code print/PDF — chỉ xuất hiện ở luồng print, không có trong note thường).

## 5. Bản đồ UI (class → control)

| Class (resources.pri / DLL) | Vai trò |
|---|---|
| `PenToolbar`, `PenButtonGrid`, `PenButton` | Toolbar bút nhiều slot |
| `ColorsGridView`, `ColoSizeFlyout`, `CustomColorDialog` | Chọn màu + size + màu tùy chỉnh |
| `TuneFlyout` | Flyout tinh chỉnh (width/opacity…) |
| `EraserFlyout`, `EraserButton` | Tẩy |
| `RulerFlyout`, `RulerButton`, `RulerCanvas` | Thước kẻ |
| `TextAndShapeFlyout/Button/ToggleButton`, `TextLayer`, `ShapeLayer`, `TextToolbar` | Shape (line/arrow/ellipse/rect/star/poly3–10 + fill) + text box |
| `SelectionFlyout`, `SelectionLayer`, `AdornerLayer` | Lasso chọn |
| `RecognizerToolbar` | Handwriting recognition |
| `CameraDialog`, `PictureLayer` | Chèn ảnh/camera |
| `SaveFlyout`, `ActionMenu`, `Title` | Save/export, menu hành động, tiêu đề |
| `PagesPreviewList`, `PageSelectionToolbar` | Rail trang |
| `Gallery.*`, `RenameProjectDialog`, `RenameNoteDialog`, `MoveNoteDialog`, `NoteMergeDialog` | Thư viện |
| `Help.HelpOverlay`, `CurrentTip` | Overlay hướng dẫn |

Settings (`settings.dat` keys): SaveLocation/appFolderOption, SaveAndExportQuality, AutoSave, TitleBox, PDFImportQuality, BackToPen/DoubleTap, WritingArea (Full/Vertical/Bottom + BottomPalmGuard).

## 6. Sửa lỗi round-trip format (so với code hiện tại)

- `templatePathFor()` hiện map SAI: `grid→mathpaper`, `black→black` (file không tồn tại). Đúng phải là path asset thật: `/Assets/Paper/Square/HighRes/{ruled|ruled10|…|dotted10|dotted20|graph|isometric|math|math10…|music|todo|blank}.png`, planner → `/Assets/Paper/{Portrait|Landscape}/HighRes/<name>.png`.
- `sBRL` = BorderLines (2 lề đỏ) — hiện hard-code 1, cần theo toggle.
- `sCRP` = crop/fullpage từ SAVEFULLPAGE.
- Kích thước raster phải theo đúng dpi 294.117 (Letter 2500×3235 ✓ đã khớp vì 216mm×288dpi=2447 ≠ 2500 — hiện đang SAI dpi nhưng ra 2500 do dùng 216mm làm tròn; chuẩn hóa lại).

## 7. Việc cần làm ở WriteCanvas (tổng hợp)

1. `paper.js`: lại từ đầu theo §3 — SIZES 12 chuẩn @294.117dpi, 19 template pattern + 32 planner (procedural), colors/alpha đúng bảng, border-lines toggle, custom paper (ảnh), sPNA map đúng.
2. `editor.js` + UI: pen system 5 loại × slot grid, palette 29 màu + custom color dialog, tune flyout, eraser flyout, ruler, save flyout (fullpage/background), paper flyout (3 section + bg color + border lines + writing pane).
3. Export: PNG/JPEG/BMP/PDF với 2 toggle save.

## 8. Phủ định các kết luận cũ

| Cũ | Đúng (bằng chứng) |
|---|---|
| Kẻ dòng 6.35mm (1/4") | **55px @294.1dpi = 4.75mm** (đo asset + note thật, khớp tuyệt đối) |
| Margin 1 đường 12.7mm trái | **2 đường đối xứng x=120 & w−120 (≈10.4mm), #C4728D, th=2** |
| HighRes chỉ có planner | **Square/HighRes có 19 template pattern**; planner ở Portrait/Landscape |
| "Square" là page size | **Square = danh mục giấy pattern**; sizes = Letter/Legal/Tabloid/A0–A8 |
| DOC_DPI = 288 | **294.117** (2500/8.5) |
| Palette 7 màu quick | 29 màu factory + custom dialog; 11 màu nền giấy; 6 màu text |
