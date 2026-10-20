# Ink recognition for WriteCanvas: Windows Ink, languages, math (research 2026-10-20)

> **Date:** 2026-10-20 · **Scope:** handwriting/ink → text for WriteCanvas, a Windows-only Electron app; optional math recognition. **Method:** primary vendor documentation, npm/GitHub metadata, and local runtime tests on Windows 11 26H2 (build 26300) with PowerShell 5.1.26100.9711 and Node 26.3.0. Local tests are labelled separately and are not vendor documentation.
>
> **No app code was changed.** Product effort estimates below are author judgment, not vendor data.

---

## 1. TL;DR

- **Yes, an unpackaged Electron app can call Windows Ink recognition.** `Windows.UI.Input.Inking.InkRecognizerContainer` is WinRT, not UWP-only, and is absent from Microsoft's "unsupported in desktop apps" and "requires package identity" lists.
- **Three host paths work; one is a prototype, one is a fallback, one is the best fit.** PowerShell 5.1 and a tiny C# helper were verified locally. `@microsoft/dynwinrt` was verified from Node; it is the best in-process candidate, but still needs an Electron-main spike.
- **Accuracy is language- and engine-dependent, and per-word.** Recognition returns candidate strings per word, with no confidence score. Isolated characters and math symbols are unreliable; the local en-US test recognized `2+2` but not `5` or `1`.
- **There is no public Microsoft math-recognition API.** Mathpix (cloud) and pix2tex (local, Python/PyTorch) are the realistic third-party options.
- **Recommendation:** ship lasso → recognize → editable text as an **explicit, default-off** feature. Use dynwinrt in the main process; keep the C# helper as fallback; use PowerShell only for diagnostics. Defer math.

## 2. Calling Windows Ink from Electron

- Windows Ink recognition lives in WinRT: `InkRecognizerContainer.RecognizeAsync(strokes, target)` returns `InkRecognitionResult` objects; `GetRecognizers()` enumerates installed engines, and the container is **null when no recognition engine exists** (https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognizercontainer).
- WinRT is usable from C#/C++ desktop apps; the exclusions are APIs tied to UWP-only UI and APIs that **require package identity** (MSIX). Neither `InkRecognizerContainer` nor `InkAnalyzer` is on either list (https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support).
- `InkAnalyzer` is a higher-level classifier: it separates writing from drawing and recognizes text, shapes, and layout, but **not math** (https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.analysis.inkanalyzer).

| Host path | Works unpackaged? | Integration cost | Verdict |
|---|---|---|---|
| PowerShell 5.1 child process | **Yes — local test** | Low | Prototype / diagnostics only |
| C# helper `.exe` (.NET Framework 4.8) | **Yes — local test** | Low–medium | Proven fallback |
| `@microsoft/dynwinrt` in Node | **Yes in Node — local test** | Medium | Primary candidate |
| Node C++/WinRT addon | Expected yes; not built | High | Not justified |
| `electron-edge-js` in-process .NET | Not tested | Medium | Unnecessary here |

- **PowerShell 5.1.** Loading the type with `[Windows.UI.Input.Inking.InkRecognizerContainer,Windows.UI.Input.Inking,ContentType=WindowsRuntime]` worked; WinRT `IAsyncOperation` was awaited through `System.WindowsRuntimeSystemExtensions.AsTask`; strokes were built with `InkStrokeBuilder.CreateStroke(IEnumerable<Point>)`, avoiding `PointerPoint`. Cold start is slow and async/error handling is awkward, so this is not a shipping path.
- **C# helper.** Compiled with the inbox `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, referencing `Windows.winmd`, `System.Runtime.dll`, and `System.Runtime.WindowsRuntime.dll`. The resulting exe is **5,632 bytes** and needs no .NET SDK or runtime install because .NET Framework 4.8 is inbox on Windows 10 1903+ and Windows 11 (https://learn.microsoft.com/en-us/dotnet/framework/install/versions-and-dependencies). Ship it as an extra resource, talk JSON over stdio, and code-sign it.
- **dynwinrt.** `@microsoft/dynwinrt` is MIT, currently **0.1.0-preview.23** (published 2026-10-10), Node 18+, x64/ARM64, with a prebuilt Node-API runtime; code generation needs Windows SDK metadata, and generated bindings can be committed (https://github.com/microsoft/dynwinrt, https://www.npmjs.com/package/@microsoft/dynwinrt). On Node 26.3.0 it generated bindings, enumerated **three** recognizers, and recognized `A` and `2+2`. **Not yet verified inside Electron's main process**; package the `.node` binary outside asar and test the Electron Node ABI before committing.
- **C++/WinRT addon.** C++/WinRT is the official C++ path for Win32 (https://learn.microsoft.com/en-us/windows/apps/develop/cpp-winrt/intro-to-using-cpp-with-winrt), but node-gyp, per-arch builds, async marshalling, and ABI maintenance make it the most expensive option for one recognizer call.
- **Dead ends.** The npm registry returned 404 for `winrt`, `node-winrt`, and `winrt-js` on 2026-10-20. `electron-edge-js` 44.0.0 exists but adds an in-process .NET dependency without solving anything the helper or dynwinrt does not.
- **Threading.** Recognition is async; call it off the UI path and marshal only the resulting strings/rectangles back. Do not block the renderer while a candidate list is computed.

## 3. Language coverage and accuracy limits

- Recognizers are **installed per handwriting engine**, normally added with Settings → Time & Language → Language → Options → Handwriting. The recognition guide describes this install flow and says the top candidate is the best match (https://learn.microsoft.com/en-us/windows/uwp/ui-input/convert-ink-to-text).
- `InkRecognizer.Name` identifies the engine/language. Microsoft's reference table did **not** list Vietnamese when checked (https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognizer.name), yet Windows lists Vietnamese as an available language pack (https://support.microsoft.com/en-us/windows/hardware/input-devices/language-packs-for-windows). The local machine enumerated `Microsoft bộ nhận dạng chữ viết tay Việt Nam`, English (US), and English (Canada). **Treat `GetRecognizers()` at runtime as the source of truth, not the docs table.**
- Results are produced **per detected word**, and `InkRecognitionResult` exposes only a bounding rectangle, the strokes, and string candidates — **no per-candidate confidence score** (https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognitionresult). Ranking is implicit in list order.
- Microsoft publishes no accuracy benchmark for these engines — **no primary-source number is available**. Accuracy depends on the installed language engine, handwriting style, stroke order, and segmentation.
- Local synthetic test (en-US, hand-constructed strokes, not human handwriting): `A → A | a | An | * | AA`; `5 → = | # | € | ¥ | •`; `1 → - | -- | .- | . | -.`; `+ → + | t | +5 | 4 | +,`; `= → = | . | : | - | I`; `x2 → > | , | ' | . | *`; `2+2 → 2+2 | 2+25 | 2=2 | 2+20 | 22`. **Isolated glyphs are unreliable; multi-character math can work.** This is a small, artificial sample — product validation on real handwriting is still required.
- Product implication: recognize **words/phrases**, always show candidates, keep the original ink until acceptance, and let the user pick a different language when the app language and note language differ.

## 4. Math recognition options

- **Microsoft has no public math API.** OneNote's Ink to Math converts equations, but it is an end-user feature with no documented API (https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/convert-your-ink-to-text-shape-and-math-equations). `InkAnalyzer` handles text/shapes/layout only. Math Input Panel is an interactive COM control (`IMathInputControl`), not headless (https://learn.microsoft.com/en-us/windows/win32/api/micaut/nn-micaut-imathinputcontrol); the Math Recognizer feature-on-demand adds the control and recognizer, but the Panel app is only included through Windows 10 2004 (https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/features-on-demand-non-language-fod?view=windows-11).
- **`Windows.Media.Ocr` is not an option:** it requires package identity, so an unpackaged Electron app cannot use it, and it is printed-text OCR, not handwriting or math (https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine).
- **Mathpix (cloud):** has a digital-ink endpoint that accepts strokes and returns LaTeX/text; pricing is **$0.002 per request** for ink, **$0.002 per image** for OCR, **$19.99 one-time setup**, **$29 trial credit**, and **$25,000/year** for private cloud; data is cloud-processed with 30-day default retention (https://mathpix.com/pricing/api, https://mathpix.com/digital-ink, https://mathpix.com/pricing/private-cloud-ocr). Author assessment: best accuracy-to-effort ratio, but it breaks offline use and requires a privacy disclosure.
- **pix2tex / LaTeX-OCR (local):** MIT-licensed, PyTorch-based, image → LaTeX, works offline after downloading checkpoints; the README describes handwritten support as "kinda done" and the tool needs Python 3.7+ (https://github.com/lukas-blecher/LaTeX-OCR). It rasterizes ink, adds a large Python/PyTorch sidecar, and has no official Electron packaging.
- **MyScript (commercial):** iink SDK supports handwriting and math, with a cloud dev tier (2,000 requests) and on-device dev licenses (25), but production use requires a sales contract (https://developer.myscript.com/pricing, https://www.myscript.com/handwriting-recognition/). Reasonable only if math/handwriting is a core differentiator.
- **Math recommendation:** defer. If demand appears, ship Mathpix behind explicit network consent first; choose pix2tex only if offline operation is a hard requirement.

## 5. Recommendation for WriteCanvas

- **UX contract:** lasso selection → "Recognize" action → candidate popover → accept replaces the selected ink with an editable text box at the selection's bounding rectangle. Keep the original strokes until acceptance; **Undo restores them**. Default the feature **off** in settings; never auto-convert while writing.
- **Availability state:** if no recognizer matches the note language, show "Handwriting recognition isn't installed for this language" with a link to Settings, not a silent failure. This matters because `InkRecognizerContainer` can be null and recognizer sets vary by machine.
- **Primary path:** dynwinrt in the Electron main process. It keeps strokes and results in-process, avoids a child process, and is MIT-licensed. First task is a packaging spike: Electron main load, `asarUnpack` for the native `.node`, x64 and ARM64, and a clean Windows 11 VM without developer tools.
- **Fallback path:** C# helper exe. It is already proven, 5.6 KB, and needs no installed runtime; the cost is IPC, code signing, and per-arch builds. Switch to it if dynwinrt fails the Electron spike or its preview status is unacceptable.
- **Do not ship PowerShell** as the production mechanism; keep it as a diagnostic script to dump `GetRecognizers()` and test segmentation.
- **Effort (author estimate):** dynwinrt spike + packaging 2–3 days; lasso/stroke serialization + candidate UI + undo 3–5 days; settings/availability/privacy copy 1 day; C# fallback 2–3 days if needed. Mathpix math mode adds 2–3 days plus billing/consent; local pix2tex is 1–2 weeks plus a large sidecar.
- **Risk register:** preview dependency (pin the version and commit generated bindings); native binary packaging; coordinate transforms between canvas, page, and recognizer bounds; language-pack variance; recognition quality on real handwriting; privacy if a cloud math option is added. Each is testable before the feature is enabled by default.

## 6. Evidence table

| # | Claim | Source | Status |
|---|---|---|---|
| 1 | Most WinRT APIs work in unpackaged desktop apps; only UWP-UI-dependent and package-identity APIs are excluded | https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support | Doc verified |
| 2 | `InkRecognizerContainer` recognizes ink, enumerates recognizers, can be null | https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognizercontainer | Doc verified |
| 3 | `InkAnalyzer` recognizes text/shapes/layout, not math | https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.analysis.inkanalyzer | Doc verified |
| 4 | Recognition returns per-word candidate strings; no confidence field | https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognitionresult | Doc verified |
| 5 | Recognizer docs table omits Vietnamese; language-pack page lists it | https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognizer.name · https://support.microsoft.com/en-us/windows/hardware/input-devices/language-packs-for-windows | Contradiction; local enumeration found Vietnamese |
| 6 | PowerShell 5.1 can load WinRT, build strokes, and recognize `A` | Local test, Windows 11 26H2 build 26300, PowerShell 5.1.26100.9711 | Local only |
| 7 | C# helper compiled with inbox `csc.exe` runs unpackaged; exe is 5,632 bytes | Local test, .NET Framework 4.8 | Local only |
| 8 | dynwinrt works from Node 26.3.0 unpackaged; preview 0.1.0-preview.23, MIT | Local test · https://github.com/microsoft/dynwinrt · https://www.npmjs.com/package/@microsoft/dynwinrt | Local + metadata |
| 9 | C++/WinRT is the official C++ Win32 path | https://learn.microsoft.com/en-us/windows/apps/develop/cpp-winrt/intro-to-using-cpp-with-winrt | Doc verified; not built |
| 10 | No `winrt`, `node-winrt`, or `winrt-js` npm package | npm registry 404, 2026-10-20 | Checked |
| 11 | OneNote Ink to Math has no documented API; Math Input Panel is not headless and its app is only included through Windows 10 2004 | https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/convert-your-ink-to-text-shape-and-math-equations · https://learn.microsoft.com/en-us/windows/win32/api/micaut/nn-micaut-imathinputcontrol · https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/features-on-demand-non-language-fod?view=windows-11 | Doc verified |
| 12 | `Windows.Media.Ocr` requires package identity and is not ink/math | https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine | Doc verified |
| 13 | Mathpix ink pricing/retention and private-cloud rate | https://mathpix.com/pricing/api · https://mathpix.com/digital-ink · https://mathpix.com/pricing/private-cloud-ocr | Vendor page verified |
| 14 | pix2tex is MIT, offline, Python/PyTorch, limited handwriting | https://github.com/lukas-blecher/LaTeX-OCR | Repo verified |
| 15 | MyScript dev tiers and commercial production | https://developer.myscript.com/pricing · https://www.myscript.com/handwriting-recognition/ | Vendor pages verified |
| 16 | .NET Framework 4.8 is inbox on Windows 10 1903+/Windows 11 | https://learn.microsoft.com/en-us/dotnet/framework/install/versions-and-dependencies | Doc verified |

**Bottom line:** the recognition capability is real and reachable without MSIX or a new runtime, but it is a language-dependent, per-word recognizer with no confidence scores. Treat it as an assistive, opt-in editing tool — not automatic transcription — and keep math out of v1.
