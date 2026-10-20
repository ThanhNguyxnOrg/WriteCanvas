# Scrble Ink PNG `sINK` — GIF envelope with ISF vector ink

**Date:** 2026-10-20 · **Scope:** original Scrble Ink UWP save format (binary v6.8.6.0) · **Read-only research; no app source changed.**

**Artifacts:** extracted `InkNotes.dll` (appx `10511ClaudiaWey.inknotespro` v6.8.6.0); original app `LocalState/Scribble/Untitled#01.png` and `Untitled#02.png`; `TempState/65505368.gif`; Microsoft ISF specification (49 pp.); WriteCanvas test note `Scribble/QA5b 2#01.png`. No machine-specific paths are used below.

> **Snapshot note:** the notes briefly changed to a 05:42 (10/20) state during this analysis, then were back at the 05:03 (10/19) / 04:26 (10/19) versions when re-checked. The stable 05:03 `Untitled#01` (204,896 B) is used for the byte-level layout; the transient 05:42 save (218,547 B) is cited where it proves the GIF tracks the ink bbox. Page 2 was raster-only in the stable snapshot and gained a 2-point dot in the transient one.

## Verdict

1. **`sINK` is not a GIF replay animation.** In every original save observed, it is a GIF89a container with **one static image frame** plus one `0xFE` comment extension. The comment payload is an **ISF stream** holding the editable vector strokes. The GIF frame is a preview.
2. **The ISF is the authoritative ink.** `InkStrokeContainer.LoadAsync` on the stable 52,509-byte payload returns **98 strokes / 3,188 points**; the transient 52,740-byte payload returns **99 / 3,191**. Both carry color, width, pen tip, fit-to-curve and pressure attributes. A GIF frame cannot supply editable stroke data; the ISF can.
3. **`TempState/*.gif` are saves, not recordings.** `TempState/65505368.gif` is the same single-frame GIF+ISF shape; its ISF loads as **97 strokes / 3,186 points**. The note then saved 98/3,188 and 99/3,191. It is an earlier snapshot of the drawing, not a replay.
4. **`sINK` is optional and content-driven.** The stable `Untitled#02` has no `sINK`; the transient save (a 2-point dot) has a 450-B `sINK` (393-B ISF, 1 stroke/2 points, 4×4 GIF). For an original Scrble page, no `sINK` means no vector ink; a tiny `sINK` can mean a tiny mark, not a full page.

## Evidence

### 0. Snapshot matrix

| Save | File B | sINK chunk | GIF | ISF body B | Strokes/points |
|---|---:|---:|---|---:|---|
| `TempState/65505368.gif` | 68,870 | comment 52,309 | 676×1725 | 52,305 | 97/3,186 |
| `Untitled#01` 05:03 (stable) | 204,896 | 69,080 | 676×1725 | 52,505 | 98/3,188 |
| `Untitled#01` 05:42 (transient) | 218,547 | 71,464 | 853×2021 | 52,736 | 99/3,191 |
| `Untitled#02` 05:03 (stable) | 41,641 | — | — | — | 0 |
| `Untitled#02` 05:42 (transient) | 42,240 | 450 | 4×4 | 390 | 1/2 |

### 1. Container bytes (`Untitled#01.png`, stable 05:03 snapshot)

- File 204,896 B; IHDR 2500×3235, bit depth 8, color type 6 (RGBA). Chunk order: `IHDR, IDAT(135,528 B), sRGB, gAMA, pHYs, sVER(4)=00 00 00 03, sINK(69,080 B), sLYT(1)=00, sBKG(1)=01, sCRP(1)=01, sSTD(10)="Letter", sPNA(42)="/Assets/Paper/Square/HighRes/ruled.png", sBKC(13)="#FFFFFFFF", sBRL(1)=01, IEND`.
- `sINK` chunk at file offset `0x211d7`, data at `0x211df`, length 69,080. First six data bytes `47 49 46 38 39 61` = `GIF89a`.
- GIF logical screen 676×1725, no global color table; one image descriptor with a local color table; one GCE (`21 f9 04 01 00 00 03 00`); **one frame**; no `NETSCAPE2.0` loop extension; trailer `3B` at `0x31fb6`. The preview is ink-only (4-entry palette: black, `#FE0000`, `#FF0000`, transparent; GCE transparent index 3).
- Comment extension at data offset 16,360 (file offset `0x251c7`); payload bytes start at file offset `0x251ca`: **52,509 bytes split across 207 data sub-blocks**, first bytes `00 99 9a 03 1d ...`. A reader must concatenate sub-block payloads; the ISF is not one contiguous file range.
- ISF header: version `00`; size is a 7-bit little-endian varint: `0x99 0x9a 0x03` → `0x19 | (0x1a<<7) | (0x03<<14)` = **52,505** bytes following the size field; next byte `0x1d` = `TAG_HIMETRIC_SIZE` (29). This matches the ISF spec: version, size, global properties, strokes.
- The GIF canvas matches (rounded) the ink bounding-box size: `BoundingRect` = X 332.1, Y 230.15, W 676.1, H 1725.86; GIF = 676×1725. The ISF point range is x 349.3–1005.0, y 235.1–1952.3 on the 2500×3235 page. So **ISF coordinates are page pixels; the GIF is a bbox crop**, not the full page and not a frame sequence.
- Transient 05:42 save: `sINK` 71,464 B, GIF 853×2021, comment 52,740 B / 208 sub-blocks, ISF varint `0x80 0x9c 0x03` = 52,736, bbox W 853.76 / H 2021.84. The GIF grew with the bbox; the structure is identical.

### 2. The ISF payload is editable ink

- `InkStrokeContainer.LoadAsync` on the stable 52,509-byte payload returns **98 strokes / 3,188 points**; the transient 52,740-byte payload returns **99 / 3,191**. Bounding rects as above.
- First strokes: color `A255 R255 G0 B0` (red), `Size 3×6`, `PenTip Rectangle`, `IgnorePressure=False`, `FitToCurve=True`, pressure 0.5; stroke 0 has 26 points from (442.692,235.654) to (444.769,321.231). The sample is mostly constant-pressure; use a pressure-varying note for fidelity tests.
- The transient save is 3 points larger than the stable one (one new 3-point stroke), and the ISF grew by 231 bytes. This is exactly what a save-time snapshot should do, and is incompatible with "the GIF is the replay recording".
- DLL confirms the format: `InkPersistenceFormat` and `GifWithEmbeddedIsf` (ASCII `0x8f6c35`); `_IsRealPNG` `0x887393`, `_IsInkGIF` `0x8873aa`, `HEADER_GIF` `0x8873e4`, `HEADER_PNG` `0x8873ef`, `_ReadInk` `0x88721e`, `ReadPageInfoChunks` `0x887481`, `HasInk` `0x8874c0`.

### 3. `TempState` is a save, not a replay

- `TempState/65505368.gif`: 68,870 B, GIF89a 676×1725, **one frame**, one GCE, one comment with **52,309 payload bytes** in 206 sub-blocks; first bytes `00 d1 98 03 1d ...` (varint 52,305). Its ISF loads as **97 strokes / 3,186 points**. Last write 04:09; the note's saves were 05:03 and 05:42.
- The observed ISF payloads grew 52,309 → 52,509 → 52,740 bytes and 97 → 98 → 99 strokes as the drawing gained strokes; none of the observed original-app files is an animation.
- This contradicts the prior claims in `docs/ANALYSIS.md:59,69-76` ("complete GIF89a animation", "replay recording", "per-session replay recordings") and `docs/specs/2026-10-19-writecanvas-design.md:40-44` ("full GIF89a ink-replay animation"). Those claims generalize from WriteCanvas's own artifact (below), not from the original app.

### 4. Why the wrong "replay" claim spread

- WriteCanvas's current `sINK` is a **gifenc animation**: test note `Scribble/QA5b 2#01.png` (1,228,611 B) contains **45 identical copies** of a 23,113-B `sINK` (1,040,085 B total, 85% of the file). The first copy is `GIF89a` 989×1280, **3 frames**, 3 GCEs, `NETSCAPE2.0` loop extension, and **no `0xFE` comment / no ISF**. The file also has 45 IDATs and 45 copies of every metadata chunk.
- The code calls this a replay GIF and writes it on save: `main/main.js:115-126` (`encodeGif`), `main/main.js:230,260-263` (`meta.inkGif` extraction/write), `main/scrble-format.js:7,70,113-116`; replay playback is in `src/js/replay.js:1,44-60`. `repairPNG` exists to clean up the duplicate/interleaved result (`main/scrble-format.js:148-171`).
- That artifact is why the inventory/design docs described `sINK` as a replay. It is not the original Scrble format; a reader looking for GIF+ISF finds no ISF in it.

### 5. Raster-only pages and picture layers

- Stable `Untitled#02.png` (41,641 B) has only `IHDR, sRGB, gAMA, pHYs, IDAT(41,518 B), sVER=3, IEND`; no `sINK`, no paper chunks. The transient 05:42 save (42,240 B) added `sINK(450)` for a 2-point dot. So a page can have no vector data at all, and a minimal mark produces a minimal ISF/GIF pair.
- The DLL contains `IStrokeLayer`, `IShapeLayer`, `IPictureLayer`, `ITextLayer` (ASCII `0x78a412-0x78a439`), `PictureLayer` references, `IsFlatPNG` `0x7ed85a`, and extra four-byte literals `sTEX, rRTF, sTXT, rIMG, sIMG, sRTF, rIM2, nIM2, sVER, nIMG, sIM2, rSHP, sSHP` (UTF-16 `0xd023ac-0xd0254c`) plus `sPPR` `0xd699dc`. This is consistent with text/picture/shape layers, but exact payloads are not proven by any sample; `sPPR` is print-only per `docs/research/scrble-feature-inventory.md:111`.
- Current WriteCanvas gap: `src/js/editor.js:277-285` restores only strokes/texts from `sVec`; `src/js/editor.js:302` skips the PNG raster whenever vectors exist; `src/js/editor.js:1408` writes only strokes/texts into `sVec`. So an imported or legacy page's only raster is drawn into the flattened PNG at `src/js/editor.js:125` (IDAT) and then ignored on reload. That is the concrete reason to persist the base separately.

## Recommendation

**Use a layered page model with a persisted base raster; treat `sINK` as a compatibility envelope, never as a replay container.**

1. **Load precedence.** (a) `sVec` vectors + `sBAS` base; (b) `sINK` ISF strokes + paper metadata; (c) IDAT raster as the last-resort base. On first open of an original `sINK` page, seed `sVec` with the decoded ISF strokes so the later `sVec` precedence does not drop them. Always decode `sBAS` when present, even if `sVec` exists—otherwise the current `editor.js:302` path loses imported images.
2. **Persist the base.** Add an unregistered ancillary chunk `sBAS` containing the original base image bytes (a format tag + original PNG/JPEG/WebP, not a re-encode). Keep it immutable; `IDAT` remains the regenerated composite preview for generic viewers and Scrble. For original paper notes (including Scrble `sINK` notes), omit `sBAS`: the base is the paper rendered from metadata (`sPNA/sBKC/sSTD/sLYT`) or the app's procedural equivalent, and the ink is vectors. Use `sBAS` only for imported/picture content. For very large bases (above a size budget, e.g. 8 MB) use a sidecar `page.base.<ext>` plus a hash/reference, because duplicating megabytes in every PNG is wasteful. Never let the only copy of the base be the composite IDAT. Also keep the imported file itself byte-for-byte as an immutable `page.orig.png` backup; `sBAS` is the content base for compositing, not a substitute for the original file.
3. **Persist vectors with the base reference.** Extend `sVec` to `{v:2, base:{chunk:"sBAS", w, h, sha256}, strokes, texts}` (or simply always composite `sBAS` + `sVec` on load). Update the renderer so a page with `sVec` still draws its base layer; this fixes the imported-raster loss after the first save.
4. **`sINK` policy.** Do not write gifenc replay frames into `sINK`. Either leave an imported `sINK` untouched, or write a valid **single-frame GIF89a + `0xFE` ISF** comment (the app's `GifWithEmbeddedIsf` shape) so the original app can still edit the ink; verify with a round-trip before relying on it. Put WriteCanvas replay recordings in an unregistered `sRPL` chunk or a sidecar; expose replay only from that data.
5. **Reader detection.** If `sINK` starts `GIF89a`, find `0xFE`, concatenate sub-block payloads, and parse ISF. If it starts `0x00`, parse it as raw ISF (the DLL also has an `Isf` mode). If it is a multi-frame GIF (current WriteCanvas files), treat it as a replay artifact and do not claim it is Scrble ink.
6. **Interop consistency.** Before writing both `sINK` and a composite IDAT, test whether the original app renders ISF on top of IDAT or treats IDAT as a preview. If it draws both, either keep IDAT ink-free (paper/images only) when `sINK` is present, or write ISF that matches the composite exactly. Do this on a copy, not the user's only note.
7. **Chunk hygiene.** Write each chunk once, after the last IDAT and before IEND; never insert between IDATs. Preserve unknown chunks byte-for-byte. In `repairPNG`, dedupe only known singletons (`sVER/sLYT/sBKG/sCRP/sSTD/sPNA/sBKC/sBRL`); for other types, drop only byte-identical duplicates from the known writer bug and preserve distinct repeats—`sIMG/sTXT/sSHP` may be per-layer entries.
8. **Acceptance tests.** (a) Load the stable `Untitled#01` → 98 strokes/3,188 points; save/reload → same strokes, one `sINK`, contiguous IDATs, no file-size blow-up. (b) Load the transient dot page → 1 stroke/2 points; save → 450-B-scale `sINK`, 4×4 GIF. (c) Import a PNG/JPEG → base hash unchanged after open/save/reload, annotations round-trip. (d) `QA5b 2#01.png` regression → no duplicate chunk types, no non-IDAT chunk between IDATs, `sINK` either absent or single-frame GIF+ISF (never a 3-frame gifenc file).

## Open questions

1. Does the original app draw ISF strokes over the IDAT raster, ignore the raster when `sINK` exists, or use the raster only as a thumbnail? This decides the safe IDAT/ISF consistency rule.
2. Exact payloads and multiplicity of `sIMG`, `sTXT`, `sSHP`, `sTEX`, `rRTF`; are repeated chunks legal per page (multiple images/text boxes)? Until proven, preserve them all.
3. Does a WriteCanvas-written `sBAS`/`sVec` survive a round-trip through the original app, or does the original save strip unknown chunks? Test on a copy.
4. Does the original app accept a full-page GIF preview, or does it require the bbox-sized preview seen here? The GIF is only a preview, so likely flexible; verify.
5. Pressure/tilt/angle fidelity: the observed sample is mostly constant 0.5 pressure; test a pressure-varying stroke before making ISF the only storage.
6. File-size budget: is `sBAS` duplication acceptable for typical 2500×3235 pages, or should sidecar be the default for all imported rasters?
7. Does a WriteCanvas-written single-frame GIF+ISF load in the original app with the same stroke count/attributes? Round-trip a copy alongside the unknown-chunk test.
8. Implementation path for writing ISF from Electron: a native WinRT helper (`InkStrokeContainer.SaveAsync` + `InkPersistenceFormat.GifWithEmbeddedIsf`) versus a JS ISF serializer.
