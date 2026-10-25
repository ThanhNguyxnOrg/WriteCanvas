# Microsoft Store submission

The product is reserved in Partner Center and the package identity is fixed, so
the only work left is building the package, filling the listing and submitting it.

| | |
|---|---|
| Product | WriteCanvas |
| Store ID | `9NF59Q2L7QP3` |
| Package/Identity/Name | `ThanhNguyxn.WriteCanvas` |
| Package/Identity/Publisher | `CN=8328F2C5-2515-47AB-888E-BB7C866567C2` |
| Package/Properties/PublisherDisplayName | `ThanhNguyxn` |
| Package Family Name | `ThanhNguyxn.WriteCanvas_pajb20v6p2hpm` |
| Status | In draft |

These four values live in `package.json` under `build.msix`; the workflow checks
the built manifest against them, because a mismatch is the one rejection that is
both easy to avoid and impossible to fix after upload.

## Why MSIX, and why a separate toolchain

- **MSIX is the Store's recommended package format**, and Store submissions do
  **not** need a purchased certificate: Microsoft re-signs the package during
  publishing. A certificate is only needed to sideload outside the Store.
- **The MSIX target is newer than the electron-builder version the release
  pipeline uses.** `npm run dist` stays on the pinned 25.x so Windows NSIS, macOS
  DMG and Linux AppImage/deb keep building the way they are tested; the Store
  package is built by `npm run dist:store`, which runs electron-builder 26.18.0
  through `npx` without touching the installed toolchain.

## Build the package

On Windows:

```powershell
npm ci
npm run dist:store
```

Or Actions → **Store package** → *Run workflow*, then download the
`writecanvas-store-msix` artifact. Both produce:

```
dist/<app>-<version>-x64.msix          the package
dist/<app>-<version>-x64.msixupload    the file Partner Center wants
```

The workflow additionally reads `AppxManifest.xml` back out of the package and
fails unless `Identity/Name` and `Identity/Publisher` match `package.json`.

Version numbering for the Store is four parts. electron-builder derives
`1.1.0.0` from `package.json` `1.1.0`, and the fourth part is reserved for the
Store. A new submission must use a higher version than the last published one, so
bump `package.json` and `CHANGELOG.md` before building.

## Submit

1. Partner Center → **Apps and games** → **WriteCanvas** → **Start submission**.
2. **Packages**: upload the `.msixupload`. Architecture x64, Windows 10/11
   desktop. Do not upload the NSIS `.exe` in this flow.
3. **Store listing**:
   - **Category**: Productivity.
   - **Pricing**: Free. No in-app purchases, no ads.
   - **Languages**: English (United States). Add Vietnamese later from the same
     listing if you want a second language; each language needs its own caption
     text and images.
   - **Description**, **short description** and **screenshot captions**: copy
     from [Store listing copy](#store-listing-copy) below.
   - **Images**: see [Assets](#assets).
   - **Support**: `https://github.com/ThanhNguyxnOrg/WriteCanvas/issues`
   - **Privacy policy**: `https://github.com/ThanhNguyxnOrg/WriteCanvas/blob/master/docs/PRIVACY.md`
     (the app collects nothing; the policy says so in one page).
4. **Age rating**: complete the questionnaire. The app has no user-generated
   content sharing, no ads, no purchases and no online features, so every answer
   is "no".
5. **Submission options**: leave the default; no Windows 10/11 specific
   restrictions are needed.
6. **Submit for certification**. Certification typically takes hours to a few
   days. If it is rejected, the report names the failing requirement; fix, bump
   the version, rebuild and resubmit.

## Assets

| What Partner Center asks for | File | Notes |
|---|---|---|
| 1:1 app tile icon, 300×300 | `store/AppTileIcon-300.png` | Recommended; the Store prefers it over the package logo. |
| Desktop screenshots (1–10, 1366×768+) | `store/screenshot-1-ink.png` … `screenshot-5-shortcuts.png` | All 1920×1080 PNG. Order as numbered. |
| 16:9 Super hero art, 1920×1080 | `store/hero-1920x1080.png` | Optional. No text, no UI, by Microsoft's rules. |
| Package tile logos | `build/appx/*.png` | Already inside the MSIX; upload nothing. |

Screenshots come from a throwaway demo library, not from personal notes, and are
regenerated with:

```bash
npx electron . --user-data-dir=<temp profile> --remote-debugging-port=9444
node scripts/store-shots.mjs
```

The tile assets are regenerated with `scripts/make-store-assets.ps1`.

## Store listing copy

**Short description** (under 270 characters):

> Handwriting-first notes for the desktop. Write with five pen types, a
> highlighter, ruler and shapes on ruled or math paper, keep pages in a library
> you choose, and export to PDF, PNG or a portable .wcanvas file.

**Description**:

> WriteCanvas is a note-taking app built around a pen, not a keyboard.
>
> Write on ruled or math paper with a smooth pen, a calligraphy nib, a highlighter
> or a solid marker. The ruler snaps and rotates, shapes and text boxes sit next to
> your ink, and the eraser works by stroke, by segment or across a whole sheet.
> A laser pointer is there for walking someone through a page without leaving a
> mark.
>
> Notes live in a library folder you choose, as ordinary PNG files in the Scrble
> Ink layout, so an existing library opens as it is and stays readable outside
> this app. Each page records how it was drawn, and the editable ink is stored
> next to the image, so a page is never flattened away.
>
> Set a board colour per page or for the whole note. Turn pages with a continuous
> scroll and thumbnails. Export a page or the whole note to PDF, to PNG, or pack
> the note into a single .wcanvas file that keeps everything.
>
> The interface follows your system language of keyboard: shortcuts are resolved
> for Windows, macOS and Linux, and the help sheet shows only your platform.
>
> No account, no telemetry, no network calls. Your notes stay in the folder you
> pick.

**Screenshot captions** (under 200 characters each):

1. Write, annotate and sketch on ruled or math paper with five pen types.
2. Five pen types, the full colour palette, and a live size preview.
3. Set the board colour for this page, or for every page in the note.
4. Pages with thumbnails keep a long note easy to navigate.
5. Keyboard shortcuts that match your platform, with a built-in help sheet.

## After it is live

- The Store re-signs the package; updates ship through the Store, so there is no
  in-app updater to maintain.
- The GitHub release keeps the NSIS installer for people who prefer it; the two
  channels are independent, and the version numbers should stay in step.
- To update the Store app, bump the version, run `npm run dist:store`, and upload
  a new `.msixupload` to a new submission.

## Limits worth knowing

- The Store package is **x64 only**, matching the NSIS installer. The other
  builds (macOS x64/arm64, Linux x64/arm64) are on the GitHub release.
- Local sideloading of the MSIX needs a trusted certificate; that is a separate
  concern from Store submission and is not configured here.
- The app is `1.x`; the Store will not accept a version lower than one already
  published.