# So sánh framework desktop cho WriteCanvas — Electron vs Tauri v2 vs NW.js vs Flutter Desktop vs Qt/PySide

> **Ngày nghiên cứu:** 2026-10-19 · **Phạm vi:** ứng dụng ghi chú + digital inking (canvas với pointer-pressure), định dạng file PNG kèm custom chunks, GIF replay nhúng, xuất PDF, đóng gói NSIS/DMG/AppImage/deb.
>
> **Phương pháp:** chỉ dùng **nguồn sơ cấp** (tài liệu chính thức, repos/release notes chính thức, issue tracker chính thức). Mỗi mệnh đề mang URL. Số liệu **không** nằm trong nguồn sơ cấp được ghi rõ là "không có dữ liệu chính thức" — không tự suy ra. **Điểm số và nhận định nỗ lực là đánh giá của tác giả** (đánh dấu rõ ở từng bảng).
>
> Tài liệu này chỉ ghi nhận kết quả nghiên cứu; không thay đổi file nào khác trong repo.

---

## 1. Tóm tắt điều hành (Executive summary)

### 1.1 Trạng thái phiên bản tại 2026-10-19

| Framework | Bản ổn định mới nhất | Engine render | Nguồn |
|---|---|---|---|
| **Electron** | **44.9.0** (17-10-2026); chuỗi v44 = Chromium 152 + Node 24.18.1; **v45 (Chromium 156) dự kiến 20-10-2026** | Chromium (Blink) — **một engine duy nhất trên cả 3 OS** | [GitHub API – release mới nhất](https://api.github.com/repos/electron/electron/releases/latest) · [Lịch phát hành](https://releases.electronjs.org/schedule) · [Chính sách hỗ trợ](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) |
| **NW.js** | **0.118.0** (10-10-2026) = **Chromium 155** | Chromium trên cả 3 OS | [Blog 0.118.0](https://nwjs.io/blog/v0.118.0/) · [Trang chủ](https://nwjs.io/) |
| **Tauri v2** | **2.12.4** stable (14-10-2026); 3.0.0-alpha.5 | **Windows: WebView2 · macOS: WKWebView · Linux: webkit2gtk** (mỗi OS một engine) | [crates.io/tauri](https://crates.io/api/v1/crates/tauri) · [WebView versions](https://v2.tauri.app/reference/webview-versions/) |
| **Flutter Desktop** | **3.47** stable | Engine render riêng của Flutter, **không dùng webview hệ điều hành** | [Release notes](https://docs.flutter.dev/release/release-notes) · [Desktop](https://docs.flutter.dev/platform-integration/desktop) |
| **Qt / PySide** | Qt 6 (tài liệu hiện tại 6.12) | Pipeline render của Qt (không dùng webview hệ điều hành) | [Qt 6 docs](https://doc.qt.io/qt-6/) |

### 1.2 Ma trận kết luận (điểm là đánh giá của tác giả — luận cứ ở mục 2–4)

| Tiêu chí (trọng số) | Electron | NW.js | Tauri v2 | Flutter | Qt/PySide |
|---|---|---|---|---|---|
| Fidelity nét vẽ / pressure — 40% | **4.5/5** — 1 engine duy nhất; stylus OK trên Win/mac | **4.5/5** — Chromium 155, mới hơn Electron | **2.5/5** — Linux hỏng `pointerType`/`pressure`; macOS webview chỉ mô phỏng chuột | **2.0/5** — macOS chưa có stylus | **4.5/5** — `QTabletEvent` gốc |
| Backend file format — 25% | **5.0/5** — Node.js đầy đủ trong main process | **5.0/5** — Node truy cập trực tiếp từ DOM | **4.5/5** — crate Rust `png`/`gif` | **2.5/5** — Dart chưa kiểm chứng | **3.5/5** — Python stdlib |
| Kích thước / RAM — 20% | **1.5/5** (định tính, không có số chính thức) | **1.5/5** (định tính) | **4.5/5** (định tính) | **3.5/5** (định tính) | **3.0/5** (định tính) |
| Tốc độ phát triển — 15% | **4.5/5** | **3.0/5** | **3.0/5** | **3.0/5** | **1.5/5** |
| **Điểm tổng có trọng số** | **4.03** | **3.80** | **3.48** | **2.58** | **3.50** |

**Khuyến nghị:** giữ **Electron** cho WriteCanvas dưới bộ trọng số hiện hành. **NW.js** là hedge dự phòng cùng dòng engine (Chromium 155 mới hơn Electron 152). **Tauri** chỉ thắng trong kịch bản ngược (size/RAM/Rust-core — xem §4.3). Flutter thua vì thiếu stylus trên macOS. Qt mạnh nhất về tablet-event nguyên bản nhưng chậm phát triển và có ràng buộc giấy phép.

---

## 2. So sánh theo tiêu chí (mỗi mệnh đề kèm nguồn sơ cấp)

### 2.1 Engine render và chu kỳ phát hành

- **Electron = một engine (Chromium/Blink) trên cả 3 hệ điều hành.** Cadence phát hành **8 tuần/lần**, mỗi bản stable chính là một bản nâng cấp phiên bản Chrome; chính sách hỗ trợ chỉ giữ **3 bản stable mới nhất** — [Electron Timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) và [Release Schedule](https://releases.electronjs.org/schedule) (bản v44.9.0 phát 17-10-2026 — [GitHub API](https://api.github.com/repos/electron/electron/releases/latest); v45 = Chromium 156 do 20-10-2026 — [Schedule](https://releases.electronjs.org/schedule)).
- **Tauri = engine khác nhau theo từng OS** — Windows dùng **WebView2 Evergreen** (dòng Chromium); macOS dùng **WKWebView** (WebKit chỉ cập nhật theo system update; macOS không được Apple hỗ trợ thì không nhận WebKit mới); Linux dùng **webkit2gtk** (`libwebkit2gtk-4.1-dev`; theo trang prerequisites, Ubuntu 22.04 chỉ có webkit2gtk **2.36**) — [WebView versions](https://v2.tauri.app/reference/webview-versions/) · [Prerequisites](https://v2.tauri.app/start/prerequisites/). Tauri 2.12.4 stable (14-10-2026), prerelease mới nhất 3.0.0-alpha.5 — [crates.io API](https://crates.io/api/v1/crates/tauri).
- **NW.js = Chromium trên cả 3 OS, track phát hành với Chromium mới hơn cả stable Electron:** 0.118.0 ngày 10-10-2026 = **Chromium 155** — [Blog 0.118.0](https://nwjs.io/blog/v0.118.0/). Phân phối binaries qua **dl.nwjs.io, không dùng GitHub Releases**; win-x64 / osx-arm64 / linux-x64 — [nwjs.io](https://nwjs.io/) · [Blog](https://nwjs.io/blog/).
- **Flutter = engine render riêng, không phải webview của OS**, hỗ trợ cả Windows/macOS/Linux desktop — [Desktop docs](https://docs.flutter.dev/platform-integration/desktop); stable 3.47 — [Release notes](https://docs.flutter.dev/release/release-notes).
- **Qt:** pipeline render của Qt, tài liệu Qt 6 hiện tại — [doc.qt.io/qt-6](https://doc.qt.io/qt-6/).

### 2.2 Backend & tác nghiệp file format (PNG custom chunks, zlib, GIF)

> Định dạng file của WriteCanvas = PNG + custom chunks (đặc thù dự án), kèm GIF replay nhúng. Câu hỏi của tiêu chí này: các tác vụ binary đó được cài ở backend nào, chi phí bao nhiêu.

- **Electron:** **main process và utility process chạy Node.js đầy đủ**; renderer bị sandbox và chỉ giao tiếp qua preload/contextBridge — [Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model). Node tích hợp sẵn `zlib` với `zlib.crc32(data[, value])`, `deflateSync` v.v. — [Node.js zlib docs](https://nodejs.org/api/zlib.html). Xuất PDF có sẵn API `webContents.printToPDF()` — [webContents docs](https://www.electronjs.org/docs/latest/api/web-contents).
  *Đánh giá tác giả:* chuỗi "đọc PNG → thêm custom chunks (CRC32) → zlib nén → ghi file" cài được bằng Node builtin, không cần thêm dependency.
- **NW.js:** cho phép "call all Node.js modules directly from DOM" — giảm vòng IPC so với Electron (mô tả chính thức trên trang chủ: [nwjs.io](https://nwjs.io/)). Cùng lớp khả năng binary của Node như trên — [Node.js zlib docs](https://nodejs.org/api/zlib.html).
- **Tauri:** core là Rust (không chạy Node); hai crate sơ cấp phù hợp cho file format:
  - `png` **0.18.1** — có module `chunk` và `text_metadata` cho custom chunks — [docs.rs/png](https://docs.rs/png/latest/png/);
  - `gif` **0.14.2** — `Encoder` + `Frame::from_rgb` (quantization ≤256 màu) để encode GIF replay — [docs.rs/gif](https://docs.rs/gif/latest/gif/).
  *Đánh giá tác giả:* bộ công cụ Rust rất "đúng bài" cho chuẩn hoá file format; nhưng ngặt điểm là hầu hết tác vụ này nằm ở phía Rust, phải đi qua IPC từ UI (xem §2.6).
- **Flutter/Dart:** **chưa kiểm chứng** được tài liệu sơ cấp nào về một thư viện Dart cho **PNG custom chunks** trong phạm vi nghiên cứu này (khoảng trống dữ liệu — §4.4).
- **Qt/PySide:** Python stdlib có `zlib.crc32`/deflate — [docs.python.org zlib](https://docs.python.org/3/library/zlib.html); PDF export của Qt **chưa kiểm chứng trang docs cụ thể trong nghiên cứu này** (trang `QPdfWriter` trả 404 khi tra cứu 2026-10-19).

### 2.3 Inking: pointer-pressure, pointerType, coalesced events

Căn cứ chuẩn web (áp dụng cho Electron/NW/Tauri):

- Nghĩa chuẩn của `PointerEvent.pressure`: **0** khi không có thiết bị hỗ trợ pressure; **0.5** khi **chuột** có nút đang bấm — [MDN pressure](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure).
- **`getCoalescedEvents`** được MDN khuyến nghị cho app vẽ (bắt trọn điểm giữa 2 frame) — [MDN getCoalescedEvents](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents) — với banner **"Limited availability"** (bảng tương thích đầy đủ không truy xuất được trong nghiên cứu này — §4.4).
- Bảng thực nghiệm cross-browser về `pressure` tại `pointerup` (W3C Pointer Events #146): **Mac Chrome với stylus Wacom hoạt động; Windows Chrome/Edge với stylus hoạt động; bảng không có dòng Linux** — [W3C #146](https://github.com/w3c/pointerevents/issues/146).
- Chromium hỗ trợ mở rộng `altitudeAngle`/`azimuthAngle` trên PointerEvent từ **Chrome/Chromium 86** (Intent blink-dev, năm 2020) — [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/ZRI-7X_4GwM).

Trạng thái từng framework/công cụ:

- **Electron (Blink):** issue **"Stylus input not working at all on Wayland"** — [electron#43821](https://github.com/electron/electron/issues/43821) — **đã đóng (closed)**. Bên cạnh đó, bảng W3C ở trên xác nhận stylus hoạt động trên Mac Chrome và Windows Chrome/Edge. *Hạn chế:* bảng W3C không có dòng Linux → cần test thật trên Linux/Wayland trước khi cam kết.
- **NW.js (Blink):** cùng engine với Electron nhưng Chromium **155** (mới hơn stable Electron = 152) — [Blog 0.118.0](https://nwjs.io/blog/v0.118.0/). *Hạn chế:* không tìm thấy issue inking riêng của NW.js được theo dõi trong nghiên cứu này (khoảng trống — §4.4).
- **Tauri – Linux (WebKitGTK):** issue **mở** — [tauri#10636](https://github.com/tauri-apps/tauri/issues/10636): `pointerType` luôn `"mouse"`, `pressure` luôn `0.5` (Arch/Wayland, webkit2gtk 2.44.2). Gốc rễ theo chuỗi bug/trang chính thức:
  - Pointer Events trên WebKitGTK **từ 2019 chỉ mô phỏng chuột, "no pressure report"** — [WebKit bug 202789](https://bugs.webkit.org/show_bug.cgi?id=202789);
  - bug về `pointerType` = `pen`/`touch` **vẫn mở (NEW)** — [WebKit bug 204115](https://bugs.webkit.org/show_bug.cgi?id=204115);
  - Pointer Events cho **touch chỉ vừa được bật trong nhánh dev 2.51.3 (09-12-2025)** — [WebKitGTK 2.51.3 release](https://webkitgtk.org/2025/12/09/webkitgtk2.51.3-released.html);
  - WebKitGTK từng **revert về mô phỏng chuột năm 2021** (r279944) — [trac.webkit.org](https://trac.webkit.org/changeset/279944/webkit);
  - về **graphics/canvas**: "Use Skia instead of cairo… GPU rendering by default" chỉ từ **2.46.0 (17-09-2024)**, kèm cài đặt 2d-canvas-acceleration và honor `willReadFrequently` — [WebKitGTK 2.46.0 release](https://webkitgtk.org/2024/09/17/webkitgtk2.46.0-released.html) + [blog Igalia](https://blogs.igalia.com/carlosgc/2024/09/27/graphics-improvements-in-webkitgtk-and-wpewebkit-2-46/); GPU process (thử nghiệm, WebGL) từ 2.48 — [WebKitGTK 2.48](https://webkitgtk.org/2025/04/08/webkitgtk-2.48.html); stable mới nhất **2.54.1 (02-10-2026)** — [webkitgtk.org/releases](https://webkitgtk.org/releases/);
  - còn **Ubuntu 24.04 chỉ có webkit2gtk 2.44** (trước cột mốc 2.46 của Skia-GPU và trước mọi bản có pen/touch PE) — theo danh sách phiên bản webkit2gtk liệt kê ở [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/); Ubuntu 22.04 = 2.36 (cùng nguồn).
- **Tauri – macOS (WKWebView):** Pointer Events trên **macOS chỉ mô phỏng chuột** — [WebKit bug 195008](https://bugs.webkit.org/show_bug.cgi?id=195008); events `pen` (Apple Pencil) chỉ tồn tại trên **iOS**, không phải macOS — [WebKit bug 193945](https://bugs.webkit.org/show_bug.cgi?id=193945) + [r240632](https://trac.webkit.org/changeset/240632). Các API vẽ nâng cao `getCoalescedEvents`/`getPredictedEvents` + altitude/azimuth chỉ có trong **Safari 18.2 (12-2024), macOS Ventura+** — [WebKit blog](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/) + [Apple release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_2-release-notes).
- **Flutter:** `PointerEvent.pressure` của **chuột trả về 1.0** (≠ 0.5 như chuẩn web) — [Flutter API](https://api.flutter.dev/flutter/gestures/PointerEvent/pressure.html) — *(cẩn trọng khi chuyển heuristic pressure từ code web sang Dart)*. Stylus trên **macOS desktop chưa hỗ trợ** — [flutter#146387 (mở)](https://github.com/flutter/flutter/issues/146387). Linux pen pressure: [flutter#63209 (đã đóng)](https://github.com/flutter/flutter/issues/63209) kèm [PR flutter#186831](https://github.com/flutter/flutter/pull/186831); nhưng **3.47 có regression về touch** — [flutter#192991](https://github.com/flutter/flutter/issues/192991).
- **Qt:** `QTabletEvent` có sẵn `pressure()`, `tiltX/tiltY`, `tangentialPressure()`, `rotation()` — [Qt QTabletEvent](https://doc.qt.io/qt-6/qtabletevent.html). Hai caveat trong chính trang docs: trên **Windows cần driver Wintab (`wintab32.dll`)**; trên **X11, evdev không phân biệt stylus/eraser** — cùng nguồn.

### 2.4 Kích thước & RAM — phần lớn là khoảng trống dữ liệu

- **Không framework nào công bố số liệu chính thức** về kích thước bundle hay RAM tối thiểu trong các trang docs đã kiểm tra (2026-10-19):
  - Electron: trang performance chỉ có **hướng dẫn định tính** về bộ nhớ — [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance); không có con số RAM/bundle chính thức trên docs.
  - Tauri: **trang docs về bundle-size không truy cập được (404)** trong nghiên cứu này (không ghi nhận được URL thay thế).
  - Flutter / Qt: không tìm thấy trang thông số tương đương trong tài liệu chính thức.
- Kết luận: **mọi so sánh con số phải là benchmark riêng** (ngoài phạm vi nghiên cứu này). Điểm của Tauri ở §1.2 (4.5/5) là **định tính**: Tauri không đóng gói engine trên Windows/macOS mà dùng webview hệ điều hành — [WebView versions](https://v2.tauri.app/reference/webview-versions/), trong khi Electron/NW.js đóng gói Chromium riêng theo mô hình đã dẫn ở §2.2.

### 2.5 Đóng gói (packaging) và cập nhật

- **electron-builder:** đóng gói 3 OS trong một lệnh — NSIS trên Windows, dmg trên macOS, **AppImage/deb** trên Linux; kèm **electron-updater** (auto-update) và signing/notarization — [electron.build](https://www.electron.build/) · [docs targets](https://www.electron.build/docs/targets).
- **Tauri:** NSIS/MSI trên Windows; app + dmg trên macOS; trên Linux: **deb / rpm / snap / appimage / AUR / Flathub** — [v2.tauri.app/distribute](https://v2.tauri.app/distribute/).
- **Flutter:** `flutter build windows|macos|linux` — [desktop docs](https://docs.flutter.dev/platform-integration/desktop); hướng dẫn deploy Linux chính thống là **Snap** (snapcraft + LXD), dẫn thêm Flatpak và Fastforge — [Deployment Linux](https://docs.flutter.dev/deployment/linux).
- **NW.js:** binaries qua [dl.nwjs.io](https://nwjs.io/) (không GitHub Releases — [nguồn blog](https://nwjs.io/blog/)); công cụ đóng gói distributable không được kiểm chứng trong nghiên cứu này.
- **Qt/PySide:** công cụ đóng gói cụ thể chưa được kiểm chứng; **giấy phép dual-licensing Commercial + Community (GPL/LGPL) — không được trộn, việc chuyển từ này sang kia có điều kiện** — [qt.io/licensing](https://www.qt.io/licensing/).

### 2.6 Tốc độ development *(đánh giá của tác giả)*

- **Electron/NW.js:** tái dùng toàn bộ stack web (canvas 2D + pointer events) cho cả code inking hiện có của dự án — tốc độ cao (giả định dự án đang có art web-canvas; nếu sai giả định này thì phải cân nhắc lại).
- **Tauri:** front-end giữ nguyên, nhưng phải thêm một lớp **Rust/IPC** nếu chưa có; và mặt phẳng debug **rộng hơn** do có 3 engine riêng theo hệ điều hành + phiên bản webkit2gtk không đồng nhất giữa các distro (dẫn từ §2.1, §2.3).
- **Flutter:** 1 ngôn ngữ (Dart) nhưng phải thay cả engine vẽ và các dependency inking (dẫn từ §2.3); tài liệu deploy Linux qua Snap là con đường chính (§2.5).
- **Qt/PySide:** viết lại gần như toàn bộ UI + inking theo Qt; cộng thêm chi phí xử lý giấy phép (§2.5); tốc độ chậm nhất trong nhóm.

---

## 3. Rủi ro fidelity nét vẽ theo từng hệ điều hành (inking)

> Chú giải: ✅ tốt / ⚠️ có vấn đề cần test thật / ❌ hỏng hoặc chưa hỗ trợ / ❓ chưa kiểm chứng. Bảng W3C là thực nghiệm của cộng đồng phát triển; các issue GitHub/WebKit phản ánh trạng thái tại thời điểm 2026-10-19.

| Hệ điều hành | Electron / NW.js (Chromium) | Tauri | Flutter Desktop | Qt/PySide |
|---|---|---|---|---|
| **Windows** | ✅ Stylus hoạt động trên Chrome/Edge theo bảng thực nghiệm W3C — [W3C #146](https://github.com/w3c/pointerevents/issues/146) | ❓ Dự kiến tốt vì WebView2 là dòng Chromium Evergreen — [webview-versions](https://v2.tauri.app/reference/webview-versions/); nhưng **không có xác nhận độc lập riêng cho WebView2** trong bảng W3C → phải test trên thiết bị | ❓ Chưa kiểm chứng riêng cho Windows trong nghiên cứu này | ⚠️ `QTabletEvent` đầy đủ (pressure/tilt/rotation) nhưng **Windows yêu cầu driver Wintab (`wintab32.dll`)** — [Qt docs](https://doc.qt.io/qt-6/qtabletevent.html) |
| **macOS** | ✅ Mac Chrome + stylus Wacom hoạt động theo bảng W3C — [W3C #146](https://github.com/w3c/pointerevents/issues/146) | ❌ WKWebView: Pointer Events trên macOS **chỉ mô phỏng chuột** — [bug 195008](https://bugs.webkit.org/show_bug.cgi?id=195008); events `pen` chỉ có trên **iOS** — [r240632](https://trac.webkit.org/changeset/240632) + [bug 193945](https://bugs.webkit.org/show_bug.cgi?id=193945) | ❌ Stylus/pressure **chưa hỗ trợ** trên macOS desktop — [flutter#146387 (mở)](https://github.com/flutter/flutter/issues/146387) | ✅ `QTabletEvent` pressure/tilt/tangentialPressure/rotation — [Qt docs](https://doc.qt.io/qt-6/qtabletevent.html) |
| **Linux** | ⚠️ Stylus trên Wayland từng hỏng — [electron#43821 (đã đóng)](https://github.com/electron/electron/issues/43821); bảng W3C **không có dòng Linux** → cần test thật trên thiết bị | ❌ `pointerType` luôn `"mouse"`, `pressure` luôn `0.5` — [tauri#10636 (mở)](https://github.com/tauri-apps/tauri/issues/10636); gốc: [bug 202789](https://bugs.webkit.org/show_bug.cgi?id=202789) + [bug 204115 (mở)](https://bugs.webkit.org/show_bug.cgi?id=204115); touch PE chỉ vào [2.51.3 (dev)](https://webkitgtk.org/2025/12/09/webkitgtk2.51.3-released.html); canvas GPU (Skia) chỉ từ [2.46.0](https://webkitgtk.org/2024/09/17/webkitgtk2.46.0-released.html), bản stable mới nhất [2.54.1](https://webkitgtk.org/releases/) | ⚠️ Pen pressure đã được nhắm đến — [#63209 (đóng)](https://github.com/flutter/flutter/issues/63209) + [PR #186831](https://github.com/flutter/flutter/pull/186831) — nhưng **3.47 có regression touch** — [#192991](https://github.com/flutter/flutter/issues/192991) | ✅ `QTabletEvent`; X11: **evdev không phân biệt stylus/eraser** — [Qt docs](https://doc.qt.io/qt-6/qtabletevent.html) |

Ghi chú thêm: hai ô "❓" (Tauri/Windows, Flutter/Windows) không có nghĩa là chắc chắn không hỗ trợ, mà là vì **chưa có nguồn sơ cấp xác nhận trong nghiên cứu này** nói riêng cho từng trường hợp đó.

---

## 4. Quyết định theo trọng số

### 4.1 Trọng số *(đánh giá của tác giả)*

Thứ tự ưu tiên đề bài: **fidelity nét vẽ > back-end file format (công việc) > size/memory > tốc độ phát triển**. Ánh xạ thành số, giảm dần theo thứ tự:

| Tiêu chí | Trọng số |
|---|---|
| Fidelity nét vẽ (pressure, `pointerType`, coalesced events, canvas GPU) | **40%** |
| Backend file format (PNG custom chunks, zlib, GIF) | **25%** |
| Kích thước / RAM | **20%** |
| Tốc độ phát triển | **15%** |

### 4.2 Bảng điểm & tổng có trọng số *(toàn bộ điểm 0–5 là đánh giá của tác giả)*

| Tiêu chí (w) | Electron | NW.js | Tauri | Flutter | Qt/PySide |
|---|---|---|---|---|---|
| Fidelity (0.40) | 4.5 | 4.5 | 2.5 | 2.0 | 4.5 |
| File format (0.25) | 5.0 | 5.0 | 4.5 | 2.5 | 3.5 |
| Size/RAM (0.20) | 1.5 | 1.5 | 4.5 | 3.5 | 3.0 |
| Dev speed (0.15) | 4.5 | 3.0 | 3.0 | 3.0 | 1.5 |
| **Tổng có trọng số** | **4.03** | **3.80** | **3.48** | **2.58** | **3.50** |

- Xếp hạng: **1. Electron (4.03) → 2. NW.js (3.80) → 3. Qt/PySide (3.50) → 4. Tauri (3.48) → 5. Flutter (2.58).**
- Khoảng cách Qt–Tauri (3.50 vs 3.48) **nằm trong sai số ước lượng** của điểm định tính — không nên đọc như một xếp hạng chắc chắn.
- **Phân tích nhạy cảm** *(tác giả)*: với bộ trọng số "size-heavy" (fidelity 30%, size 30%, format 25%, speed 15%), tổng trở thành: Electron **3.73** > Tauri **3.68** > NW.js **3.50** > Qt/PySide **3.35** > Flutter **2.73** — **Electron vẫn đứng đầu**; Tauri vượt NW.js/Qt nhưng vẫn chưa vượt Electron. Tauri chỉ vượt Electron nếu benchmark riêng chấm điểm size/RAM rất cao cho Tauri (hoặc rất thấp cho Electron) — dữ liệu hiện chưa có (§4.4).

### 4.3 Kịch bản ngược — khi nào **Tauri** thắng

Chọn Tauri khi tất cả (hoặc phần lớn) điều kiện sau xảy ra (mỗi điều kiện có nguồn riêng bên dưới):

1. **Kích thước/RAM là ràng buộc cứng** mà Electron đã tối ưu vẫn không đạt — hỗ trợ chính thức về size/RAM cho cả hai phía đều **không tồn tại** (§2.4) → quyết định phải dựa trên benchmark riêng.
2. **Phạm vi thực tế chỉ là Windows/macOS** (WebView2 Evergreen + WKWebView, không đóng gói engine) — [webview-versions](https://v2.tauri.app/reference/webview-versions/) — và không có kế hoạch nhắm Linux trong thời gian sớm.
3. **Linux chỉ nhắm đến distro có WebKitGTK ≥ 2.46** (canvas Skia + GPU mặc định) — [WebKitGTK 2.46.0](https://webkitgtk.org/2024/09/17/webkitgtk2.46.0-released.html) — và chấp nhận **chờ WebKitGTK hoàn thiện pen/touch pointerType** — [bug 204115 (mở)](https://bugs.webkit.org/show_bug.cgi?id=204115); touch PE đã được bật trong nhánh dev 2.51.3 — [release 2.51.3](https://webkitgtk.org/2025/12/09/webkitgtk2.51.3-released.html). Lưu ý: `pen` vẫn chưa — bug 204115 là chốt chặn chính, kèm [tauri#10636](https://github.com/tauri-apps/tauri/issues/10636).
4. **Team nắm Rust** và muốn kéo phần lõi file format sang Rust: crate [`png` 0.18.1](https://docs.rs/png/latest/png/) (module `chunk`/`text_metadata`) và [`gif` 0.14.2](https://docs.rs/gif/latest/gif/) (`Encoder`, quantize ≤256 màu).
5. **Chiến lược "browser engine của OS"**: WebView2 Evergreen tự nâng cấp, không ship engine theo app — [webview-versions](https://v2.tauri.app/reference/webview-versions/).

Ghi chú ràng buộc nếu chọn Tauri: là **nhóm webview yếu nhất về stylus trên cả Linux + macOS WebKit** (§3) → khối kiểm thử stylus trên cả 3 OS phải nằm ở sprint đầu tiên, hoặc cần một nghiên cứu/kiểm thử riêng về stylus trên WebKitGTK (không nằm trong phạm vi nghiên cứu này).

### 4.4 Khoảng trống dữ liệu / không xác minh được (cần nhận thức rõ)

1. **Không framework nào công bố số bundle size/RAM chính thức**: Electron chỉ có hướng dẫn định tính — [performance docs](https://www.electronjs.org/docs/latest/tutorial/performance); trang docs bundle-size của **Tauri trả 404** khi truy cập 2026-10-19; Flutter/Qt không tìm thấy trang tương đương → so sánh size **phải benchmark riêng**.
2. **Bảng tương thích đầy đủ của MDN về `getCoalescedEvents`** không render được; fetch raw BCD không thành công trong nghiên cứu này — chỉ còn banner "Limited availability" trên [trang MDN](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents).
3. **Bảng pressure của W3C (#146) không có dòng Linux** — [W3C #146](https://github.com/w3c/pointerevents/issues/146) — vì vậy các ô Linux trong bảng §3 là suy luận từ issue tracker, không phải thực nghiệm bảng W3C.
4. **NW.js không có trang chính sách hỗ trợ công khai** (OS/bản tối thiểu hỗ trợ) — quan sát từ [trang chủ](https://nwjs.io/) và [blog](https://nwjs.io/blog/).
5. **Thư viện Dart cho PNG custom chunks** chưa được kiểm chứng; **công cụ đóng gói cho PySide** chưa được kiểm chứng; **PDF export của Qt** — trang docs `QPdfWriter` trả 404 khi tra cứu trong nghiên cứu này.
6. Chưa benchmark hiệu năng canvas thật (FPS, trễ bút) cho bất kỳ framework nào — ngoài phạm vi nghiên cứu này.

### 4.5 Khuyến nghị tóm gọn

- **Giữ Electron** cho WriteCanvas dưới bộ trọng số hiện hành: một engine Blink đồng nhất trên 3 OS (§2.1, §3), Node.js sẵn trong main process cho toàn bộ file format + `printToPDF` cho export PDF (§2.2), electron-builder 1 lệnh cho NSIS/DMG/AppImage/deb + electron-updater (§2.5), cadence/updates rõ ràng 8 tuần (§2.1).
- **NW.js** giữ như hedge cùng dòng engine — Chromium 155 mới hơn Electron 152 — [blog](https://nwjs.io/blog/v0.118.0/); điểm trừ: policy hỗ trợ không công bố (§4.4).
- **Tauri** là lựa chọn chiến lược dài hạn khi project chuyển hướng size/RAM/Rust-core; theo dõi [tauri#10636](https://github.com/tauri-apps/tauri/issues/10636), [WebKit bug 204115](https://bugs.webkit.org/show_bug.cgi?id=204115) và alpha 3.0 — [crates.io](https://crates.io/api/v1/crates/tauri).
- **Flutter/Qt** chỉ khi có yêu cầu đặc thù: Flutter khi cần 1 codebase cho cả mobile/desktop **và chấp nhận thiếu stylus trên macOS** ([#146387](https://github.com/flutter/flutter/issues/146387)); Qt khi cần tiếp cận `QTabletEvent` nguyên bản (pressure/tilt/rotation, §2.3) và có capacity chịu đựng rollout chậm + giấy phép dual-licensing (§2.5).

---

> Tài liệu biên soạn bởi subagent nghiên cứu — 2026-10-19. Chỉ tạo file này; không sửa đổi file nào khác trong repo.
