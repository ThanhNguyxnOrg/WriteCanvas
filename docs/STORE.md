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

These values live in `store/identity.json`. `npm run dist:store` passes them to
electron-builder 26 as `-c.msix.*` overrides, and the workflow reads the built
manifest back and compares it with that file, because a mismatch is the one
rejection that is both easy to avoid and impossible to fix after upload.

They are deliberately **not** in `package.json`: electron-builder 25 validates its
config schema strictly and refuses to build at all when it meets an unknown
`msix` or `toolsets` key — which is what broke every release job on the first
attempt. Keeping the Store config on the Store path leaves the pinned release
toolchain untouched.

## Why AppX, and why a separate script

- **The Store accepts AppX.** Microsoft's package requirements list `.appx`,
  `.appxbundle` and `.appxupload` alongside the MSIX formats for new submissions,
  and Store packages are **re-signed by Microsoft** during publishing, so no
  certificate is purchased or stored. A certificate is only needed to sideload
  outside the Store.
- **MSIX is not available in the published toolchain yet.** The MSIX target is
  documented in electron-builder's master branch, but the newest published
  version (26.18.0) rejects `msix` as an unknown configuration property. AppX
  shares the manifest format and the Store flow, and it builds with the
  electron-builder already pinned by the release pipeline.
- **The Store config stays out of `package.json`.** electron-builder validates its
  config schema strictly: an unknown key makes it refuse to build, which is why
  the identity is passed as CLI overrides by `scripts/build-store.mjs` instead of
  sitting in the release config. When electron-builder publishes MSIX support,
  only that script's target flag changes.

## Build the package

On Windows:

```powershell
npm ci
npm run dist:store
```

Or Actions → **Store package** → *Run workflow*, then download the
`writecanvas-store-appx` artifact. Both produce:

```
dist/<app>-<version>-x64.appx    the package to upload
```

The workflow additionally reads `AppxManifest.xml` back out of the package and
fails unless `Identity/Name` and `Identity/Publisher` match `store/identity.json`.

AppX package versions are four parts. electron-builder derives `1.1.0.0` from
`package.json` `1.1.0`, and the fourth part is reserved for the Store. A new
submission must use a higher version than the last published one, so bump
`package.json` and `CHANGELOG.md` before building.

## Submit

1. Partner Center → **Apps and games** → **WriteCanvas** → **Start submission**.
2. **Packages**: upload the `.appx`. Architecture x64, Windows 10/11 desktop. Do
   not upload the NSIS `.exe` in this flow.
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
   - **Privacy policy**: `https://github.com/ThanhNguyxnOrg/WriteCanvas/blob/master/PRIVACY.md`
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

| Partner Center field | File | Size |
|---|---|---|
| Screenshots (desktop) | `store/screenshot-1-ink.png` … `screenshot-5-shortcuts.png` | 1920×1080 each |
| 9:16 Poster art | `store/PosterArt-1440x2160.png` (or `PosterArt-720x1080.png`) | 1440×2160 / 720×1080 |
| 1:1 Box art | `store/BoxArt-1080x1080.png` | 1080×1080 |
| 1:1 App tile icon | `store/AppTileIcon-300.png` | 300×300 |
| 1:1 display tile | `store/StoreTile-150.png` | 150×150 |
| 1:1 display tile | `store/StoreTile-71.png` | 71×71 |
| Package tile logos | `build/appx/*.png` | inside the AppX; upload nothing |

The 16:9 hero (`store/hero-1920x1080.png`) is not requested by this listing form;
it is kept for promotional use and trailers.

Screenshots come from a throwaway demo library, not from personal notes, and are
regenerated with:

```bash
npx electron . --user-data-dir=<temp profile> --remote-debugging-port=9444
node scripts/store-shots.mjs
```

The logos, poster art and box art are regenerated with
`scripts/make-store-assets.ps1`.

## Product features

Partner Center shows these as a bulleted list (up to 20). Paste:

- Five pen types: smooth pen, pencil, calligraphy, highlighter and solid marker
- The full colour palette, a custom hex field and a colour picker
- Ruled and math paper from Letter to A6, portrait or landscape
- A ruler that snaps and rotates, plus shapes and text boxes next to your ink
- Eraser by stroke, by segment or across a whole sheet
- A laser pointer for walking someone through a page without leaving a mark
- Pages with thumbnails and continuous page turns
- Board colour for one page or for the whole note
- Export to PDF, PNG, or a portable `.wcanvas` file
- Opens an existing Scrble Ink library; notes stay ordinary PNG files
- Works offline: no account, no telemetry, no network calls

Leave **What's new in this version** blank — this is the first submission for the
product.

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
- Local sideloading of the AppX needs a trusted certificate; that is a separate
  concern from Store submission and is not configured here.
- The app is `1.x`; the Store will not accept a version lower than one already
  published.
- If electron-builder ships the MSIX target, `scripts/build-store.mjs` only needs
  its `--win appx` flag changed to `--win msix` and the override prefix from
  `-c.appx.` to `-c.msix.`; the identity and the Store steps stay the same.