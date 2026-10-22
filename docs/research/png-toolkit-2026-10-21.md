# Browser PNG toolkit — pre-port verification

**Date:** 2026-10-21 · **Scope:** the browser-safe Scrble PNG chunk functions in `writecanvas-zip/src/js/bridge.js` (`parseChunksBrowser`, `upsertChunksBrowser`, `writeNotePngBrowser`, `readNoteMetaBrowser`) before porting them to `src/js/png-toolkit.js`. **Research only — no product code was changed at research time; see §9 for the post-port status.**

## Summary

| Check | Result |
|---|---|
| PNG framing / CRC / IEND / truncation | Correct. Two lenient edge cases are shared with `main/` (see §1). |
| Ancillary placement (multi-IDAT, PLTE/tRNS, no IDAT) | Correct: metadata lands after the last IDAT, IDATs stay consecutive, IEND last. Byte-identical to `main/`. |
| Duplicate handling / writing twice | Correct: all copies of a written type are dropped, one is inserted; rewrites are byte-stable. |
| Parity with `main/scrble-format.js` | Byte-identical for every case tested **except one real bug**: the browser writer omits the `TEMPLATE_PATH` fallback for `sPNA` (`bridge.js:131` vs `scrble-format.js:75`). See §4. |
| Proposed 2-function interface | Sufficient for every current loader; one parse is strictly better than the current three. Keep the copy semantics and document "preserve on omission". See §5. |
| `sINK` validation | Stay byte-agnostic. Both the original GIF89a+ISF shape and the current gifenc replay are legitimate bytes for this layer. See §6. |

**Sources & access.** The canonical spec URL `https://www.w3.org/TR/png-3/` returned **HTTP 403 (Cloudflare)** from this host, so every spec quote below was verified against the W3C editor's copy at `https://w3c.github.io/png/` (same document; the cited anchors exist in the downloaded HTML). Repo `main/png-chunks.js` is byte-identical to the zip copy; repo `main/scrble-format.js` is content-identical to the zip copy (only CRLF/LF differs), so "main" below applies to both. Original Scrble notes are not committed to the repo; their byte-level description is taken from `docs/ANALYSIS.md` and `docs/research/scrble-ink-chunk-2026-10-20.md`. Measurements come from an ad-hoc Node 26.3.0 harness (temp, not committed) that imported the zip module verbatim (with the unused `gifenc` import stubbed) and `main/png-chunks.js` + `main/scrble-format.js` via `createRequire`.

---

## 1. PNG framing, CRC, IEND, truncation

| Requirement (PNG 3rd ed.) | Zip implementation | Result |
|---|---|---|
| 8-byte signature, chunks follow | checks length ≥ 8 and every signature byte (`bridge.js:50-51`) | correct; same error text as main (`png-chunks.js:25`) |
| Length counts **only** the data field; zero is valid; max 2³¹−1 | reads BE u32, slices exactly `len` data bytes (`bridge.js:55-59`); writer uses `data.byteLength` (`bridge.js:69`) | correct |
| CRC over **type + data**, not length; always present; stored MSB-first | table is the reflected zlib polynomial; init `0xffffffff`, final xor (`bridge.js:6-20`); `chunkToU8` CRCs `[type, data]` (`bridge.js:66-70`) | correct |
| IEND terminates the datastream | parser stops at the first `IEND` (`bridge.js:61`); writer never replaces IEND | correct for well-formed input |
| Multiple IDAT chunks are legal | parsed and re-serialized individually, never concatenated | correct |

Spec quotes: length/CRC fields — [§5.3 Chunk layout](https://w3c.github.io/png/#5Chunk-layout); CRC pre/post conditioning and MSB-first storage — [§5.5 CRC algorithm](https://w3c.github.io/png/#5CRC-algorithm); "beginning with an IHDR chunk and ending with an IEND chunk" — [§5.2 PNG signature](https://w3c.github.io/png/#5PNG-file-signature).

Measured:

- `crc32("IEND") = 0xAE426082`, and an **independent bitwise CRC** (not the module's table) validated every chunk of every written file. All passed.
- A 470-IDAT page survived a write with all 470 IDAT payloads byte-identical and consecutive.
- A corrupt stored CRC in the input is not detected; the writer recomputes a valid CRC from the (possibly corrupt) data. A corrupt data byte is preserved and "laundered" into a valid chunk. This is exactly what main does (`png-chunks.js:40-48,51-54`), but it means the toolkit is not a corruption checker.

### Truncation and malformed input — actual behavior

| Input | `writeNotePngBrowser` | `main writeNotePng` |
|---|---|---|
| < 8 bytes, or bad signature | throws `Not a PNG file` | same |
| Chunk data+CRC runs past EOF | throws `Truncated PNG chunk <type>` (`bridge.js:58`) | same (`png-chunks.js:32`) |
| Signature only (8 bytes) | **no error**: returns `signature + s*` with **no IHDR/IDAT/IEND** | same (verified byte-identical) |
| File ends after the last IDAT (no IEND) | **no error**: output has **no IEND** | same |
| Trailing bytes after IEND | dropped (parser stops at IEND) | same |
| Short trailing header (< 8 bytes, no IEND) | silently ignored, output without IEND | same |

This is a parity-preserving but sharp edge: the parser never asserts that IEND (or IHDR/IDAT) exists, and a truncated-at-a-chunk-boundary file can be "written" into an invalid PNG. **Recommendation:** keep parity for this port and pin these behaviors in tests; if the team wants strictness, harden `main/png-chunks.js` and the toolkit together in a separate change (otherwise cross-checks become conditional).

---

## 2. Ancillary chunk placement

Spec rules ([§5.6 Chunk ordering](https://w3c.github.io/png/#5ChunkOrdering)): `IDAT` — "Multiple IDAT chunks shall be consecutive"; `IEND` — "Shall be last"; `PLTE` — before first IDAT; `tRNS` — after PLTE, before IDAT. Ancillary chunks have no constraint unless the table lists one, so the private `s*` chunks may legally sit anywhere between IHDR and IEND.

The implementation drops the types it is about to write, finds the **last** IDAT, and splices the new entries once at `lastIdat + 1` (`bridge.js:72-80`). With no IDAT it inserts before the last chunk, i.e. before IEND (`bridge.js:78`). That satisfies the spec and the repo's own constraint, documented in `main/png-chunks.js:56-60`.

Measured sequences (all byte-identical to `main/`):

```
2 IDATs:   IHDR, IDAT, IDAT, sVER, sINK, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC, sBRL, IEND
+ sVec:    IHDR, IDAT, IDAT, sVER, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC, sBRL, sVec, IEND
470 IDATs: IHDR, IDAT×470, sVER, sINK, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC, sBRL, IEND
PLTE/tRNS: IHDR, PLTE, tRNS, IDAT, sVER, ..., sBRL, IEND
no IDAT:   IHDR, sVER, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC, sBRL, IEND   (input is invalid PNG; transform is deterministic)
tEXt pre-IDAT: unchanged, stays before IDAT
```

Notes:

- The metadata is inserted **immediately after the last IDAT**, not necessarily immediately before IEND. If the input already has chunks between IDAT and IEND, `s*` will precede them. That is legal and does not affect the IDAT run.
- The no-IDAT branch is only reachable for malformed input; no real encoder produces it. Keep it as a stable, tested behavior, not a supported format.
- APNG is out of scope. Inserting unknown ancillary chunks after the last IDAT remains legal alongside `fcTL`/`fdAT`; the toolkit does not need APNG awareness for this app.
- **Naming footnote (do not "fix"):** `s*` chunks set the ancillary bit (lowercase first letter), which is why ordinary viewers ignore them ([§5.4](https://w3c.github.io/png/#5Chunk-naming-conventions); `docs/ANALYSIS.md:73-75`). Their uppercase second letters mean the names claim "public" status although they are unregistered, and `sVec` has a lowercase third letter (`e`), i.e. reserved bit = 1, which the spec says makes the datastream "not conform to this version of PNG" (`scrble-format.js:78-81`). This is inherited from the original app + WriteCanvas extension; renaming would break Scrble compatibility. Treat it as a conformance footnote, not a bug.

---

## 3. Duplicate handling and stability

`upsertChunks` builds the replacement-type set from the entries, filters **all** chunks of those types, then inserts each entry exactly once (`bridge.js:73-79`; same in `png-chunks.js:61-76`). Measured:

- `write(write(png, meta), meta)` is byte-identical to the first write, including after a `main`-written intermediate.
- Every written `s*` type appears exactly once.
- A synthetic "old bug" file with `sVER`/`sINK` duplicated and placed between IDATs heals on the next write for the types being written: the IDATs become consecutive and each `s*` type appears once; output is byte-identical to `main`'s.
- Reading a file with duplicates uses the **first** occurrence (`find`, `bridge.js:140`; `scrble-format.js:95`) — same as main.

Important semantics hidden by a 2-function API:

- **Types not present in the entries are preserved.** Writing without `meta.inkGif` leaves an existing `sINK` byte-for-byte intact (`main.js:287-288` documents this as intentional); writing without `meta.vecJson` leaves an existing `sVec` intact. There is **no way to delete** `sINK` or `sVec` through this API. The editor always passes a vector snapshot (`src/js/editor.js:1618`), so it effectively overwrites `sVec`; an empty string does **not** clear it (`&& .length` check, `bridge.js:134`).
- The healing above only covers types being written. A pre-fix file with a `tEXt` chunk between IDATs would stay invalid; the full recovery routine is `repairPNG` (`scrble-format.js:148-171`), which the main load path calls (`main.js:255`). The zip/browser host has no equivalent. Not part of this interface, but a gap to remember when the browser host is wired.

---

## 4. Parity with `main/` — one real divergence

Tested against `writeNotePng`/`readNoteMeta` with the same input PNG. Byte-identical for: full meta; `inkGif`; `vecJson`; `fullPage:false`/`borderLines:false`; undefined `sizeName`/`bgColor`; `blank`/`custom` templates; UTF-8 strings (`A4 – groß ✓`); empty `inkGif`; planner with explicit path; all `main`-written intermediates; 470-IDAT input.

### B1 (real bug): missing `sPNA` fallback

- Browser: `lpStr(meta.templatePath || '')` — writes a zero-length `sPNA` when the caller omits `templatePath` (`bridge.js:131`).
- Main: `lengthPrefixedString(meta.templatePath || TEMPLATE_PATH(meta.template, meta.orientation))` (`scrble-format.js:75`), e.g. `/Assets/Paper/Landscape/HighRes/dailyPlanner.png`.

Measured consequence for `{template:'ruled', orientation:'landscape'}`:

```
zip:  sPNA="" (length prefix 0)  -> read back: templatePath=null, template='blank'
main: sPNA="/Assets/Paper/Square/HighRes/ruled.png" -> template='ruled'
```

The file is internally inconsistent: `sBKG = 1` (has template) but `sPNA` empty, so the paper is lost on re-open (`templateFromPath(null)` → `blank`, `bridge.js:151`). It is **latent today only because** the editor always computes `templatePath` (`src/js/editor.js:1610`); any other caller (tests, import path, future web host) can hit it. Fix in the port: use the same fallback as main (ideally share `paper.templatePathFor`, which matches `TEMPLATE_PATH` for all 36 templates × 2 orientations — measured 72/72, `src/js/paper.js:206-213`).

### B2 (minor): `inkGif` duck-typing differs

| `meta.inkGif` | Zip browser | Main |
|---|---|---|
| `Uint8Array` / `Buffer` | writes | writes |
| `ArrayBuffer` | writes (has `byteLength`) | **skips** (no `.length`) |
| `DataView` | writes a **zero-length sINK** (`new Uint8Array(dv)` has length 0) | skips |
| plain `Array` | **skips** (`byteLength` undefined) | throws inside `Buffer.concat` |

The two implementations therefore disagree on non-`Uint8Array` inputs. The public contract should accept `Uint8Array`/`ArrayBuffer` (normalize views with `ArrayBuffer.isView`) and reject anything else; do not rely on `.length`/`.byteLength` duck-typing.

### B3 (cosmetic): string coercion

`lpStr` uses `String(str || '')` (`bridge.js:84`) while main passes the value to `Buffer.from(str, 'utf8')`. Non-string metadata (e.g. a number) is coerced by the browser and throws (or, for a number, allocates zero bytes) in main. Document "strings only"; no code change needed if callers obey the contract.

### Verified identical

- Chunk set and order: `sVER, sINK?, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC, sBRL, sVec?` (`bridge.js:124-134`; `scrble-format.js:69-81`), matching the original observed order (`docs/ANALYSIS.md:48-49`; research doc `:30`).
- Defaults: `sVER=3`, `sSTD` default `"Letter"`, `sBKC` default `"#FFFFFFFF"`, `sBRL` default 1, `sCRP` 1 unless `fullPage===false`, `sBKG` 0 for `blank`/`custom`/absent, `sLYT` 0 unless exactly `landscape`.
- Length-prefixed strings: BE u32 + UTF-8; zero length reads back as `null` in both (`bridge.js:88-93`; `scrble-format.js:85-90`).
- Template mapping: pattern templates → `/Assets/Paper/Square/HighRes/<id>.png`; the 16 planners → `/Assets/Paper/{Portrait|Landscape}/HighRes/<id>.png`; unknown/custom → `blank` on read (`scrble-format.js:33-49`; `bridge.js:95-112`). `sizeFromName` exact/lowercase/contains/fallback matches main for all 12 sizes (`scrble-format.js:51-59`; `bridge.js:114-120`).
- `readNoteMeta` / `readNoteMetaBrowser` return the same key set and values, including `hasInkGif`, `layoutByte`, `hasTemplate`, and the `borderLines` default `true`.

Known limitation (both sides): `fullPage`/`sCRP` is write-only; neither reader exposes it. Current UI does not model `fullPage` (`src/js/editor.js:37`), so this is acceptable for the interface.

---

## 5. Is one parse returning `{meta, inkGif, vecJson}` sufficient?

Yes.

- Main's loader returns `file`, `exists`, `bytes`, `paperMeta`, `inkGif`, `vecJson` (`main/main.js:256-261`); the editor consumes exactly `p.paperMeta`, `p.vecJson`, `p.inkGif`, `p.bytes`/`p.exists` (`src/js/editor.js:292-310,335-341`). The proposed triple covers paper metadata + replay + editable vectors; the raster bytes are the input the caller already has.
- One parse is better than today's three: the zip's `loadNote` calls `readNoteMetaBrowser`, `extractChunkBrowser('sVec')` and `extractChunkBrowser('sINK')`, each reparsing (`bridge.js:472-479`); main does the same via three helpers (`main.js:258-260`). A single `parseChunks` pass is strictly cheaper.

Memory / performance (Node 26.3.0, indicative):

- 5 MB `sINK`: write incl. CRC 14.6 ms; `readNotePng` metadata 0.13 ms; copying the `sINK` out 1.60 ms. 2 MB `sINK` + 1.9 MB PNG with 470 IDATs: 18.9 ms total.
- `parseChunks` allocates one small object + one `subarray` view per chunk; it does **not** copy chunk data (`bridge.js:59`). The only new large allocation in `readNotePng` is the returned `inkGif` copy.
- Returning a copy is the right default (the caller can drop the source buffer and cannot mutate the PNG through the view). A zero-copy view would pin the whole page buffer for as long as `inkGif` lives; the copy costs ~1.6 ms per 5 MB and makes ownership unambiguous.
- `vecJson` is decoded eagerly. That is what the loader needs; main caps the vector snapshot at 64 MB (`main.js:296`) and pages at 200 MB (`main.js:280`), so the string is bounded. Do not parse the JSON inside the toolkit — the editor already handles malformed JSON (`src/js/editor.js:302-309`).

Contract points to write down in the module header (the interface hides them otherwise):

1. Omitted `inkGif`/`vecJson` means **preserve the existing chunk**, not delete it.
2. `meta.hasInkGif` mirrors `readNoteMeta`; `inkGif === null` iff no `sINK` exists.
3. `meta` is the same shape as main's `readNoteMeta` (plus `inkGif`/`vecJson` at the top level); `sizeName`/`size` both present.
4. Errors: `Not a PNG file`, `Truncated PNG chunk <type>` — keep the exact strings for parity.
5. Input: `Uint8Array` (or `ArrayBuffer`); output: a fresh `Uint8Array`. No `Buffer`, `fs`, or `gifenc` imports (the zip's `gifenc` import at `bridge.js:2-3` is unrelated to the toolkit and must not be carried over).
6. `fullPage` is write-only in both implementations.

Keep `parse`/`upsert`/CRC/string helpers private. Tests should use an independent 20-line chunk walker + bitwise CRC as the oracle rather than exporting internals, so the module's public surface stays the two functions.

Future extension: the research recommendation to persist a base raster (`sBAS`, `docs/research/scrble-ink-chunk-2026-10-20.md:68`) would require a third return field and chunk type. Out of scope now; the two-function shape does not block adding it later.

---

## 6. `sINK`: validate or stay byte-agnostic?

**Recommendation: stay byte-agnostic. Do not validate or warn in the toolkit.**

Evidence:

- Original Scrble `sINK` is a **single-frame GIF89a plus one `0xFE` comment containing an ISF stream** (editable strokes); the GIF is a bbox-cropped preview (`docs/research/scrble-ink-chunk-2026-10-20.md:11-14,30-35`). It explicitly corrects the older "replay animation" claim in `docs/ANALYSIS.md:59,69-76` (see research doc `:49`).
- Current WriteCanvas main writes a **gifenc multi-frame replay** (3 frames, `NETSCAPE2.0`, no comment/ISF) — `main/main.js:126-137,289-293`; the artifact that spread the wrong claim is documented at research doc `:51-55`.
- Therefore two incompatible payload shapes are legitimate at this layer today. A validator that required GIF+ISF would reject every current WriteCanvas save; one that required a multi-frame GIF would reject every original Scrble note and the raw-ISF mode (`Isf`, research doc `:71`). A warning would be pure noise until the write policy changes.
- The toolkit's job is preserving bytes. That is also what makes re-saving an imported original note safe: when `meta.inkGif` is absent, the existing `sINK` is left untouched (verified byte-for-byte; `main.js:287-288`).

If format detection is ever needed, expose a **separate** helper (e.g. `sniffInk(bytes) -> 'gif+isf' | 'gif-multiframe' | 'isf' | 'unknown'`) used by the importer/UI, not by the PNG framing module. That follows research recommendation 5 (`:71`) and does not redesign main. The actual policy fix — writing a single-frame GIF+ISF instead of a replay — belongs to `main/main.js` and the future browser host, tracked separately (research doc `:70`).

---

## 7. Risk register (concrete)

| # | Risk | Severity | Recommendation |
|---|---|---|---|
| R1 | `sPNA` fallback missing (`bridge.js:131` vs `scrble-format.js:75`) → `sBKG=1` + empty path, template lost on read | **high** for any caller omitting `templatePath`; latent in today's editor | Port the main fallback; add a byte-parity test for template-without-path. |
| R2 | No IEND/EOF guard: signature-only or missing-IEND input produces an invalid output PNG instead of throwing (`bridge.js:54-62`) | medium (malformed input only; same as main) | Pin behavior in tests now; harden both implementations together later if desired. |
| R3 | Input CRCs are not verified; the writer recomputes valid CRCs, laundering corruption | low–medium (import/repair path) | Keep out of the writer; if import integrity matters, validate CRCs at import. |
| R4 | `inkGif` duck-typing: `DataView` becomes an empty `sINK`; `ArrayBuffer` differs from main; plain `Array` differs | low (callers pass `Uint8Array`) | Normalize with `ArrayBuffer.isView`/`ArrayBuffer`; reject other types. |
| R5 | Browser host lacks `pngIsBroken`/`repairPNG` (`scrble-format.js:128-171`; main uses it at `main.js:255`) | future (browser mode not wired) | Add a browser repair equivalent before exposing web import/load of legacy notes. |
| R6 | `upsert` heals only types it writes; unknown chunks between IDATs stay | low | Document; do not turn the toolkit into a general repair tool. |
| R7 | `sVec` lower-case reserved bit / `s*` names claim public status | none (compat requirement) | Do not rename; tolerate in strict validators. |

---

## 8. Recommended test matrix

Harness: `node --test tests/png-toolkit.test.mjs` (repo already resolves `src/js/*.js` as ESM via `src/package.json:1-4` — make sure that file is committed; at research time it was untracked). Use `createRequire` for `main/png-chunks.js` + `main/scrble-format.js`, and an **independent bitwise CRC** + chunk walker as the oracle (do not test the module's table against itself).

| # | Fixture / action | Assertion |
|---|---|---|
| T1 | `crc32("IEND")` via oracle/module | `0xAE426082` |
| T2 | 1×1 PNG + full meta → write | every output chunk's length matches its data; stored CRC equals independent bitwise CRC over type+data; last chunk is IEND with length 0 |
| T3 | 7 bytes / bad signature | both read and write throw `Not a PNG file` |
| T4 | truncate inside IHDR, inside an IDAT, inside IEND CRC | throw `Truncated PNG chunk <type>` (same message as main) |
| T5 | signature-only; file ending after last IDAT; 5 trailing bytes after IEND | Pin current parity behavior (no IEND emitted / trailing dropped), or harden both later — decide explicitly |
| T6 | split a real IDAT into 3 (and a 470-IDAT stress page) | IDAT count/order/payload bytes unchanged; IDAT indices consecutive; metadata after last IDAT; IEND last |
| T7 | palette PNG with PLTE + tRNS | both stay before IDAT and byte-identical; metadata after last IDAT |
| T8 | PNG with tEXt before IDAT and with tEXt after IDAT | preserved in place; metadata after last IDAT (before the post-IDAT tEXt) |
| T9 | IHDR + IEND only (no IDAT) | deterministic output `IHDR, s*, IEND`, byte-identical to main |
| T10 | `write(write(png, meta), meta)` | byte-identical; each `s*` type exactly once |
| T11 | `write(mainOut, meta)` | equals `write(png, meta)` and equals `mainOut` |
| T12 | legacy broken layout: `IHDR, IDAT, sVER, sINK, IDAT, sVER, sINK, IEND` | after write: IDATs consecutive, one `sVER`/`sINK`, byte-identical to main |
| T13 | write meta without `inkGif` over a file with `sINK` | `sINK` count 1 and bytes unchanged |
| T14 | write meta without `vecJson` over a file with `sVec` | `sVec` preserved; document that `''` does not clear it |
| T15 | byte-parity matrix vs `main.writeNotePng`: pattern/planner × portrait/landscape, with and without `templatePath`, `blank`, `custom`, unknown template, `fullPage`/`borderLines` false, empty/undefined fields, UTF-8 strings, `inkGif`, `vecJson` | `Buffer.from(browserOut).equals(mainOut)` for every case |
| T16 | **template without `templatePath`** (`ruled`, `dailyPlanner` landscape) | browser `sPNA` equals main's `TEMPLATE_PATH` (this is the test that catches R1) |
| T17 | read parity: `readNotePng(bytes).meta` vs `main.readNoteMeta(bytes)` | identical key set + values (incl. `hasInkGif`, `layoutByte`, `hasTemplate`, `borderLines`) on browser-written, main-written, plain, and zero-length-flag files |
| T18 | bidirectional round-trip | main-written file read by toolkit → same meta/ink/vec; toolkit-written file read by main → same |
| T19 | all 16 planners × both orientations, plus all pattern templates | `paper.templatePathFor(t,o) === main.TEMPLATE_PATH(t,o)`; write→read restores `template` (note: iterating `Object.keys(TEMPLATES)` alone misses planners) |
| T20 | `templateFromPath` edges | case-sensitive (`RULED.PNG` → blank), backslash paths, `.png.png` strips one extension, unknown/custom → blank |
| T21 | `sizeFromName` table: `Letter`, `letter`, `A4`, `Tabloid`, `a0 poster`, `a3 ledger`, `archive 12x18`, `''` | expected keys; unknown → `letter` |
| T22 | defaults: `writeNotePng(png, {})` | raw bytes: `sVER=00000003`, `sLYT=00`, `sBKG=00`, `sCRP=01`, `sSTD="Letter"`, zero-length `sPNA`, `sBKC="#FFFFFFFF"`, `sBRL=01`; no `sINK`/`sVec` |
| T23 | UTF-8 `sizeName`/`bgColor`/`vecJson` | length prefixes count UTF-8 bytes; round-trip exact |
| T24 | `sINK` opaque bytes: fake `GIF89a` + `0xFE` comment/ISF payload; fake gifenc multi-frame payload | byte-exact round-trip, no throw, no warning; `hasInkGif` true |
| T25 | corrupt a stored CRC in a kept chunk; corrupt one data byte in a `tEXt` | read does not throw (parity); output CRCs are valid; document that corruption is not detected |
| T26 | input types: `Uint8Array`, `ArrayBuffer`, `Uint8Array` subarray with non-zero byteOffset | output correct for all; returned value is a plain `Uint8Array`; input bytes unchanged |
| T27 | 5 MB `sINK` smoke | correct one-chunk output, CRCs valid; no brittle timing assertion (indicative: ~15 ms on this host) |

The highest-value tests are T15/T16 (byte parity, catches the only real bug), T6/T10/T12 (placement + dedupe + healing), T17/T18 (read parity), and T24 (opaque `sINK`). T2/T3/T4 should use the independent CRC/chunk walker so the tests do not merely mirror the implementation's own helpers.

---

## 9. Post-port status (2026-10-21)

The toolkit was ported with the research fixes and then promoted from a twin to the single codec:

- **B1 / R1 fixed.** `writeNotePng` uses `paper.templatePathFor`; every planner × orientation is covered by tests.
- **B2 / R4 fixed.** `inkGif` goes through `asBytes`: `Uint8Array`/`Buffer`/`ArrayBuffer`/`DataView` are accepted, other types throw. Empty typed arrays still mean "leave the existing `sINK` alone" (preserve-on-omission).
- **R5 closed.** `pngIsBroken` and `repairPng` now live in `src/js/png-toolkit.js`; the browser-safe codec can heal the old interleaved/duplicated layout. `main/scrble-format.js` delegates to them.
- **Single source of truth.** `main/scrble-format.js` is now a thin Node facade (Buffer in/out) over `src/js/png-toolkit.js`; write/read/extract/repair no longer have two implementations. The renderer imports the same ESM module.
- **Read path.** `readNotePng(png, { ink, vec })` can skip copying a large `sINK` or decoding a large `sVec` for library scans; default reads still return an owned `inkGif` copy.
- **Tests.** 24/24 `node --test`; real smoke save + `verify-note`; `qa-5b` and `audit-ui` pass against the same build.
- **Deliberately unchanged.** Missing-IHDR/IEND and input-CRC leniency stay for parity (R2/R3); strict validation is a separate change.

