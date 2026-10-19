# WriteCanvas — REA Investigation Report: ScrbleInk (Scrble Ink)

> Method: [REA (morluto/rea)](https://github.com/morluto/rea) `rea@6.7.0` CLI — "Reverse Engineer Anything".
> Target: **Scrble Ink** v6.8.6.0 (`10511ClaudiaWey.inknotespro`, publisher CN=240FC1EC…, "Claudia Wey"), UWP / .NET Native 2.2.
> Analyzed from two artifacts:
> 1. Repackaged `.appx` at `D:\The Vault\ScrbleInk\3.Scrible thanhnguyxn.appx` (same identity/version, re-signed by `thanhnguyxn`) — extracted to temp, SHA-256 `a3a1a87bbdab718ac…`.
> 2. Installed package data at `C:\Users\Admin\AppData\Local\Packages\10511ClaudiaWey.inknotespro_9n0kwq747cbjy\`.
>
> REA status on this host: healthy Node 26.3.0/win32-x64. Deep-native providers (Ghidra/Hopper/IDA/Kuna) not configured; analysis ran through REA's deterministic lanes (`rea analyze`, `rea providers`, `rea doctor`) plus PE/asset inspection and local evidence gathering. The `sINK` structure conclusions below are grounded in byte-level observation of real saved files, not decompilation — marked accordingly.

---

## 1. What the app is (from `AppxManifest.xml`, directly observed)

- UWP app, `Windows.Universal` min 10.0.16299, .NET Native 2.2 framework, x64.
- Executable `InkNotes.exe` (bootstrap, 19,968 B) + `InkNotes.dll` (31,494,656 B — all app logic, AOT-compiled).
- 3rd-party controls: `Microsoft.Graphics.Canvas` (Win2D), `TreeViewControl` (ANN tree), `Robmikh.CompositionSurfaceFactory`, `Microsoft.Toolkit.Uwp.UI.Controls`.
- **Capabilities:** `internetClient`, `webcam`.
- **File associations:** `.png`, `.pdf` (opens/annotates images & PDF imports).
- Multiple instances allowed (`desktop4:SupportsMultipleInstances`).

## 2. Feature map (evidence: app's own help assets + `resources.pri` XAML class names)

Help overlay assets enumerate the toolset: pen colors writing area, pan, zoom + zoom toggle, eraser, shapes (`line, arrow, ellipse, rectangle, star, polygons 3–10` + fill variants), **laser pointer**, PDF, pictures, printing, save, settings, paper types (Landscape/Portrait/Square, black paper, math paper), colors, NoAdds.

`resources.pri` XAML namespaces reveal the code architecture (`InkNotes.*`):

| Area | Classes observed |
|---|---|
| Shell / help | `MainPage`, `Help.WritingArea`, `Help.SettingUp`, `Help.HelpOverlay`, `Help.HelpGesture`, `Help.FullFeatures`, `Help.CurrentTip`, `Help.BackToPen` |
| Gallery (library) | `Gallery.GalleryDictionary`, `RenameProjectDialog`, `RenameNoteDialog`, `MoveNoteDialog`, `NoteMergeDialog`, `AdsForScrbleInk` |
| Editor core | `Editor.Editor`, `Editor.Sheet`, `Editor.SheetManager`, `Editor.PagesPreviewList`, `Editor.SelectionLayer`, `Editor.AdornerLayer`, `Editor.Paper`, `Editor.WritingArea` |
| Toolbars | `Editor.Controls.PenToolbar`, `PenButtonGrid`, `EraserFlyout/EraserButton`, `TuneFlyout`, `RulerFlyout/RulerButton`, `TextAndShapeFlyout/Button`, `SelectionToolbar/Button`, `RecognizerToolbar`, `PageSelectionToolbar`, `SaveFlyout`, `CameraDialog`, `ActionMenu`, `Title` |
| Data / services | `Data.Models`, `Editor.Storage`, `Services.Storage.PDFPassword`, `Services.Print.ContinuationPage` |

Default settings recovered from `Settings\settings.dat` (observed strings):
- Paper: `Letter`, background `#FFFFFF`, template `/Assets/Paper/Square/HighRes/ruled.png`, ink `#000000`
- Save location: `Local App Folder` → `…\LocalState\Scribble`
- Default **pen palette** (BGRA): `#000000` + gray ramp `D3D3D4 A7A9AC 828283 58595B` + `B31564` + red/orange/amber/yellow `FF0000 FF5500 FFAA00 FFCE00 FF E6` chain + greens `A2E61B 26E600 008055 00AACC 004DE6 3D00B8 6600CC 600080` + skin/browns `F7D7C4 BB9167 8E562E 613D30` + lights `FFFF80 FFC680 FFFB0A 32FF5C 2EF0FF`
- **Handwriting recognition**: `Microsoft English (US) Handwriting Recognizer`
- Notes state: `Untitled`

## 3. Save format — the big finding (byte-level evidence, real note files)

A saved note (`LocalState\Scribble\Untitled#01.png`, 214,162 B, **2500×3235 px**, pHYs 3779 ppm = 96 dpi ⇒ Letter at **3× 96 dpi render scale**, matching the `HighRes` paper asset path) is a **standard PNG with private ancillary chunks**:

```
IHDR, sRGB, gAMA, pHYs, IDAT×3,
sVER, sINK, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC, sBRL, IEND
```

All 9 chunk names exist exactly once as UTF-16LE literals inside `InkNotes.dll` (serializer lives there; not found as ASCII, not in `resources.pri`).

Decoded chunk semantics (observed in the real file):

| Chunk | Bytes observed | Decoded value |
|---|---|---|
| `sVER` | `00 00 00 03` | format version = **3** (BE u32) |
| `sINK` | 68,861 B | **a complete `GIF89a` animation (676×1853)** — the ink *replay recording* embedded in the note |
| `sLYT` | `00` | layout/orientation byte (0 = portrait, hypothesized) |
| `sBKG` | `01` | has-paper-template flag |
| `sCRP` | `01` | (flag, exact meaning per chunk name: crop-related) |
| `sSTD` | `00 00 00 06 "Letter"` | length-prefixed string: **paper size** |
| `sPNA` | `00 00 00 26 "/Assets/Paper/Square/HighRes/ruled.png"` | length-prefixed string: **paper template asset path** |
| `sBKC` | `00 00 00 09 "#FFFFFFFF"` | length-prefixed string: **background color (ARGB)** |
| `sBRL` | `01` | (flag) |

Corroborating artifacts:
- `TempState\65505368.gif` (68,871 B) is a sibling GIF of the same drawing session (same `GIF89a` tail; sINK is the finalized 68,861-B variant) — temp staging for the animated replay.
- `TempState\*.gif` (216–355 KB, some中央电视台 duplicated sizes) = per-session replay recordings.
- Two identical 2.9 MB PNGs in `TempState` = flattened autosave staging.

**Conclusion (WriteCanvas compat contract):** notes are PNG + `s*` chunks; ink replay = GIF inside `sINK`; the IDAT raster is the flattened page. This means:
- Windows/any photo app shows the flattened note normally (unknown ancillary chunks are ignored by spec-compliant readers).
- WriteCanvas can **open original Scrble Ink notes** (read `sPNA/sSTD/sBKC/sLYT` to rebuild the paper, show the raster, replay `sINK` GIF) and **save notes Scrble Ink can read back** (write the same chunk set).
- `sINK` GIF divergence in the middle vs temp GIF (same header/tail, 43,936 differing bytes, same 20-B tail) indicates temp file was a mid-session recording — replay GIFs are finalized at save time.

Open question (not needed for MVP, requires a deep-native provider like Ghidra to answer precisely): exact binary meaning of the 1-byte flags `sLYT/sBKG/sCRP/sBRL` beyond the hypothesized orientation/template mapping, and whether `sINK` can ever carry raw-vector stroke data instead of a GIF (only one real note sample available). If a second note type surfaces, extend analysis with `rea inspect-with-objdump` / Ghidra lane.

## 4. User-visible look (evidence)

- Note paper: pale blue ruled lines + pink margin line on near-white background (`ruled.png` square-highres), red ink at pressure-varying width (observed in the actual note image).
- Accent color: `#125687` (AppxManifest tile/splash background).

## 5. Rewrite decisions (WriteCanvas)

1. **Electron** (Windows/macOS/Linux from one codebase). Canvas inking with Pointer Events + pressure.
2. **File-format compatible notes**: PNG + `sVER3/sINK/sLYT/sBKG/sCRP/sSTD/sPNA/sBKC/sBRL`, GIF replay in `sINK`, 3× render scale, library layout `Scribble/Name#NN.png` mirroring `LocalState\Scribble`.
3. **Paper templates generated procedurally** (ruled/grid/dotted/graph/blank, sizes Letter/A4/A5/Square, portrait/landscape) — original asset PNGs are *not* copied (licensing); `sPNA` is written with an original-style path (`/Assets/Paper/Square/HighRes/…`) so notes round-trip into Scrble Ink with the right template.
4. MVP scope: pen (palette + width + opacity, pressure), stroke eraser, pan/zoom, multi-page, paper settings, undo/redo, autosave, gallery tree (folders/notes, rename/move/delete), PNG/JPG/PDF export, replay playback, import of original notes.
5. Roadmap (matches original feature map): lasso selection layer, shapes & text flyouts, ruler, camera insert, handwriting recognition, PDF password, print continuation pages, laser pointer.

Evidence file sources: `D:\The Vault\ScrbleInk\` (repo), temp extraction, installed package data. No copy of the app's assets or binaries is included in WriteCanvas; only the byte-level format contract above.
