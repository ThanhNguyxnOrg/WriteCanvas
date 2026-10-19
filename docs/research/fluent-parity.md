# Fluent Parity — Ngôn ngữ hình ảnh của Scrble Ink (WinUI 2.x / UWP Fluent, Light theme)

Mục tiêu: tài liệu hóa token màu, metrics layout, glyph và typography của Fluent Design (dòng UWP / WinUI 2.x,
light theme) để restyle chrome renderer của WriteCanvas trông "native" như Scrble Ink.

Quy tắc: mọi dữ kiện trích nguồn chính thức (learn.microsoft.com hoặc repo chính thức
`microsoft/microsoft-ui-xaml`); đây là ghi chú nghiên cứu — chưa áp dụng vào code, chờ review; file để untracked.
Ngày: 2026-10-19.

Chú giải nguồn dùng trong các bảng:

| Mã nguồn | URL |
| --- | --- |
| [G1] | https://learn.microsoft.com/en-us/windows/apps/design/iconography/segoe-fluent-icons-font |
| [G2] | https://learn.microsoft.com/en-us/typography/font-list/segoe-mdl2-assets |
| [TH] | https://learn.microsoft.com/en-us/windows/apps/design/style/xaml-theme-resources |
| [TR] | https://github.com/microsoft/microsoft-ui-xaml/blob/main/controls/dev/CommonStyles/Common_themeresources_any.xaml |
| [LV] | https://github.com/microsoft/microsoft-ui-xaml/blob/main/controls/dev/CommonStyles/ListViewItem_themeresources.xaml |
| [CB] | https://github.com/microsoft/microsoft-ui-xaml/blob/main/controls/dev/CommonStyles/CommandBar_themeresources.xaml |
| [TB] | https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design |
| [TY] | https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography |
| [CT] | https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics |
| [NV] | https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview |
| [CM] | https://learn.microsoft.com/en-us/windows/apps/design/controls/command-bar |
| [W1] | https://learn.microsoft.com/en-us/windows/apps/develop/title-bar |
| [SV1] | https://learn.microsoft.com/en-us/uwp/api/windows.ui.xaml.controls.splitview.panebackground |
| [SV2] | https://learn.microsoft.com/en-us/uwp/api/windows.ui.viewmanagement.applicationviewtitlebar |

---

## 1. Token màu — Light theme

Cấu trúc: file `Common_themeresources_any.xaml` [TR] chứa `ThemeDictionaries` với 3 dictionary:
`Default` (dark), `Light`, `HighContrast`. Các giá trị dưới đây lấy nguyên văn từ dictionary `Light`:

| Token | Light — hex | Đọc alpha từ hex | Dùng làm | Nguồn |
| --- | --- | --- | --- | --- |
| TextFillColorPrimary | #E4000000 | đen ~89% | chữ chính | [TR], [TH] |
| ControlFillColorDefault | #B3FFFFFF | trắng ~70% | nền control | [TR] |
| ControlStrokeColorDefault | #0F000000 | đen ~5.9% | viền control (rest) | [TR] |
| SubtleFillColorSecondary | #09000000 | đen ~3.5% | hover trên item danh sách | [TR], [LV] |
| CardStrokeColorDefault | #0F000000 | đen ~5.9% | viền card | [TR] |
| CardBackgroundFillColorDefault | #B3FFFFFF | trắng ~70% | nền card | [TR] |
| LayerFillColorDefault | #80FFFFFF | trắng 50% | lớp nổi trên nền gốc (pane/panel) | [TR] |
| SystemAccentColor | động | accent do user chọn trong Windows Settings | selection, highlight | [TH] |
| WindowCaptionForeground | — | resource key khi window active | màu chữ title bar | [W1] |
| WindowCaptionForegroundDisabled | — | resource key khi window deactivated | màu chữ title bar mờ | [W1] |

Trạng thái ListViewItem [LV]: viền chọn = 4px (`ListViewItemSelectedBorderThemeThickness` = 4);
hover nền = `SubtleFillColorSecondaryBrush`; pressed = `SubtleFillColorTertiaryBrush`; selected + hover =
`SubtleFillColorTertiaryBrush`; chữ giữ `TextFillColorPrimaryBrush` (chỉ nền đổi); dấu chọn =
`AccentFillColorDefaultBrush`.

Đối chiếu dark [TR, dictionary `Default`]: TextFillColorPrimary dark = #FFFFFF; LayerFillColorDefault dark = #4C3A3A3A.

UNVERIFIED (không có hex chính thức, không dùng cho tới khi xác minh):
- ApplicationPageBackgroundThemeBrush Light = #FFFFFF — brush nền app của UWP do OS cung cấp, docs không công bố hex.
- Hex mặc định của pane/sidebar (brush PaneBackground riêng theo mode — xem §2.3); docs chỉ nêu tên brush.

---

## 2. Metrics layout

### 2.1 Title bar — chuẩn 32px

| Yếu tố | Giá trị | Nguồn |
| --- | --- | --- |
| Title bar chuẩn | height 32px | [TB] |
| Title bar khi có search box / person-picture | 48px | [TB], [W1] |
| Icon cửa sổ | 16×16px, cách viền trái 16px, margin dọc 8px khi bar 32px | [TB] |
| Title | style Caption (ramp 12px — §4.2), truncate + ellipsis khi hẹp | [TB] |
| Caption buttons | glyph E921 ChromeMinimize, E922 ChromeMaximize, E923 ChromeRestore, E8BB ChromeClose | [TB] |
| Back button | glyph E830 ChromeBack, 16×16, cách trái 16px, cách element kế bên 16px | [TB] |
| API màu title bar | UWP: `ApplicationViewTitleBar` (BackgroundColor, ForegroundColor, ButtonBackgroundColor, ButtonHoverBackgroundColor, ButtonPressedBackgroundColor, InactiveBackgroundColor) [SV2]; WinAppSDK: `AppWindowTitleBar` cùng bộ props [W1] |

### 2.2 Command bar — height đóng 48px

| Yếu tố | Giá trị | Nguồn |
| --- | --- | --- |
| Command bar đóng (compact) | resource AppBarThemeCompactHeight = 48 | [CB] |
| AppBarThemeMinHeight (min height khi mở) | 64 | [CB] |
| Icon trong primary commands | 20×20 px | [CM] |
| Icon trong overflow menu | 16×16 px | [CM] |
| Số primary commands tối đa trên màn 320 epx | 4 | [CM] |
| Chế độ Minimal | resource AppBarThemeMinimalHeight (định nghĩa tại [CB]; docs không ghi số cụ thể) | [CB] |

### 2.3 Sidebar (nav pane — NavigationView / SplitView)

| Yếu tố | Giá trị | Nguồn |
| --- | --- | --- |
| Adaptive (nav pane) | expanded ≥ 1008px; LeftCompact (icon only) 641–1007px; LeftMinimal ≤ 640px | [NV] |
| Brush nền theo mode | NavigationViewExpandedPaneBackground (Left), NavigationViewDefaultPaneBackground (LeftCompact / LeftMinimal), NavigationViewTopPaneBackground (Top) | [NV] |
| Top pane (nav dạng top) | height cố định 52px | [NV] |
| Margin quanh content | 12px (Minimal) / 24px (các mode khác) | [NV] |
| SplitView (UWP) | property PaneBackground — Brush của phần pane; docs không công bố brush/hex mặc định | [SV1] |

### 2.4 List item

- Viền "selected" của ListViewItem = 4px (ListViewItemSelectedBorderThemeThickness = 4) [LV].
- UNVERIFIED: height mặc định của ListViewItem / list item thông thường; docs không công bố con số.

---

## 3. Glyph — Segoe MDL2 Assets (UWP) / Segoe Fluent Icons

- Segoe Fluent Icons (Win11) là font thay thế Segoe MDL2 Assets (Win10, file Segmdl2.ttf); MDL2 vẫn "still
  available" và tiếp tục dùng cho UWP-era apps [G1], [G2]. Icon nằm ở Private Use Area (PUA) [G1].
- Bảng dưới lấy code trực tiếp từ bảng "Icon list" chính thức [G1]; render ở 16/20/24/32/40/48/64 px [G1].

| Tên icon chuẩn | Code | Dùng cho |
| --- | --- | --- |
| GlobalNavButton | E700 | hamburger (mở sidebar) |
| Settings / Search | E713 / E721 | settings / tìm kiếm |
| Back / Refresh | E72B / E72C | back / reload |
| CheckMark | E73E | trạng thái chọn |
| BackToWindow / FullScreen | E73F / E740 | thoát fullscreen / fullscreen (E740 đúng đề xuất) |
| Delete / Save | E74D / E74E | delete / save (cả hai đúng đề xuất) |
| Print / EraseTool | E749 / E75C | print / xoá (bút xoá) |
| Play / Pause | E768 / E769 | play (đúng đề xuất) / pause |
| ChevronLeft / ChevronRight | E76B / E76C | mũi tên mở rộng |
| Paste / Color / SaveAs | E77F / E790 / E792 | paste / màu (đúng đề xuất) / save as |
| Redo / Undo | E7A6 / E7A7 | redo / undo (cả hai đúng đề xuất) |
| Page | E7C3 | icon "trang" (E9F9 không phải Page) |
| Highlight | E7E6 | highlight |
| Download | E896 | download |
| OpenFile | E8E5 | mở file |
| ChromeBack / ChromeClose | E830 / E8BB | back / close trên title bar |
| Cut / Copy | E8C6 / E8C8 | cut / copy |
| Italic / Underline / Bold | E8DB / E8DC / E8DD | italic / underline / bold |
| NewFolder | E8F4 | new folder |
| Zoom / ZoomOut / ZoomIn | E71E / E71F / E8A3 | zoom fit / zoom out (đúng đề xuất) / zoom in (đúng đề xuất) |
| ViewAll | E8A9 | view all (grid) — không phải "Add" |
| Add / Remove | E710 / E738 | add (đúng đề xuất) / remove |
| More / Cancel | E712 / E711 | menu "…" / cancel |
| ChromeMinimize / ChromeMaximize / ChromeRestore | E921 / E922 / E923 | minimize / maximize / restore (title bar) |
| SaveCopy / PageAdd | EA35 / EA1A | save copy / thêm trang |

Lỗi đề xuất của brief đã được so lại với bảng chính thức [G1]:
- `Page = E9F9` — SAI: Page chuẩn là E7C3; E9F9 = ReportDocument.
- `Add = E8A9` — SAI: Add là E710; E8A9 = ViewAll.
- `Paw` — không xuất hiện trong danh sách icon chính thức. UNVERIFIED; coi như glyph không tồn tại
  trong hai font này cho đến khi tra được nguồn khác.

---

## 4. Font + typography + spacing

### 4.1 Font stack

- Windows 11: font mặc định là Segoe UI Variable [TY]; style "strong" trong ramp XAML trỏ
  `FontFamily="Segoe UI Variable"` + `FontWeight="SemiBold"` [TH]. Title trên title bar: Segoe UI Variable
  (nếu có) hoặc Segoe UI, style Caption [TB].
- Segoe UI vẫn là "User-interface font" cho Latin + nhiều script (bảng Fonts) [TY]. Font icon riêng:
  Segoe Fluent Icons (Win11) / Segoe MDL2 Assets (Win10) [G1], [G2].
- UNVERIFIED (UWP-era): mặc định `ContentControlThemeFontFamily` = "Segoe UI" trên Win10 — docs hiện hành chỉ
  nêu Win11 dùng Segoe UI Variable, không công bố giá trị resource cho UWP [TY], [TH].

### 4.2 XAML Type ramp (kích thước chữ chuẩn)

Nguồn [TY] (bảng Type ramp) khớp với bảng "The XAML type ramp" trong [TH]:

| Style XAML | Weight | Size / line-height (epx) |
| --- | --- | --- |
| CaptionTextBlockStyle | Regular | 12 / 16 |
| BodyTextBlockStyle | Regular | 14 / 20 |
| BodyStrongTextBlockStyle | Semibold | 14 / 20 |
| BodyLargeTextBlockStyle | Regular | 18 / 24 |
| SubtitleTextBlockStyle | Semibold | 20 / 28 |
| TitleTextBlockStyle | Semibold | 28 / 36 |
| TitleLargeTextBlockStyle | Semibold | 40 / 52 |
| DisplayTextBlockStyle | Semibold | 68 / 92 |

- Weight theo bảng Weights [TY]: Regular = 400, Semibold = 600. Mức dễ đọc nhỏ nhất theo docs: 14px semibold
  hoặc 12px regular.
- Bold và Italic không thuộc ramp chuẩn; docs khuyên dùng Semibold thay Bold để nhấn mạnh [TY].

### 4.3 Spacing — nền 8px

Giá trị từ docs Content layout and spacing, đơn vị epx (effective pixel, scale-independent) [CT]:

| Khoảng cách | Giá trị |
| --- | --- |
| button ↔ button | 8 epx |
| button ↔ flyout | 8 epx |
| control ↔ header | 8 epx |
| control ↔ label | 12 epx |
| giữa các content area / card | 12 epx |
| surface ↔ edge text (gutter biên) | 16 epx |
| content bên trong expander (indent) | 48 epx |
| icon trong multi-line list | 32 epx |
| margin quanh NavigationView content | 12px (Minimal) / 24px (các mode khác) [NV] |

---

## 5. Ghi chú khác biệt cross-platform + các lựa chọn

- Font Segoe Fluent Icons / Segoe MDL2 Assets chỉ có sẵn trên Windows: Win10 có MDL2 (file Segmdl2.ttf [G2])
  nhưng KHÔNG có sẵn Fluent Icons [G1]; Mac / Linux phải download từ trang Design resources [G1].
- Glyph nằm ở PUA (E700+); nếu thiếu font, glyph PUA hiển thị dưới dạng `.notdef` (khoảng trống / ô ký tự) [G1].
- License — trích nguyên văn câu chữ chính thức [G1]: font có thể download dùng cho "design and development",
  nhưng "you may not ship it to another platform"; redistribution enterprise xem "Font redistribution FAQ
  for Windows" tại [G2].
- Các lựa chọn (chỉ mô tả cho phần chrome/icon, KHÔNG quyết định thay người dùng):
  1. Bundle font bằng CSS `@font-face` (kèm .ttf/.woff2 trong app). Ưu: dùng đúng shape glyph chính thức.
     Rủi ro: license redistribution — phải rà soát trước khi ship.
  2. Dùng SVG vector thay thế (vẽ lại shape tương tự Fluent, render bằng img/mask/background).
     Ưu: cross-platform, không ràng buộc license font. Nhược: phải design lại từng icon.
  3. Font-family stack Windows-side: "Segoe Fluent Icons", "Segoe MDL2 Assets" trong CSS. Chạy đúng trên
     Windows; cần cơ chế fallback (ví dụ SVG) cho máy không có font.
  4. Font chữ (không phải icon): nếu cần font thay thế Segoe UI ngoài Windows, có Selawik — font open-source
     metrically compatible của Microsoft [TY]. Lưu ý: Selawik chỉ thay thế phần chữ, không thay thế icon font PUA.
- Đơn vị: mọi chiều trong WinUI đều là effective pixels (epx). Ở scale 100%, 1 epx = 1 CSS px trong Electron;
  ở scale cao hơn (125% / 150%), dạng giá trị nên giữ theo "dev px" tương tự docs khuyến nghị.

## Tóm tắt nhanh cho WriteCanvas

- Nền light theme điển hình: layer #80FFFFFF trên nền trắng, chữ #E4000000, hover danh sách #09000000,
  viền control #0F000000 [TR].
- Title bar 32px / 48px interactive; command bar 48px compact; top nav pane 52px; viền chọn list 4px
  [TB] [CB] [NV] [LV].
- Type ramp: Caption 12, Body 14, Subtitle 20, Title 28 [TY].
- Spacing: 8 / 12 / 16 epx (48 epx indent expander, 32 epx icon list) [CT] [NV].
- Glyph: đã verify bảng §3; hai lỗi đề xuất trong brief được sửa (Page = E7C3, Add = E710);
  "Paw" không tồn tại trong danh sách.
