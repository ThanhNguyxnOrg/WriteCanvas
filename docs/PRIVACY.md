# Privacy policy

WriteCanvas runs entirely on your computer. It has no accounts, no telemetry, no
analytics and no network calls.

## What the app stores

- **Your notes** live in the library folder you choose, as PNG files with
  WriteCanvas/Scrble Ink metadata, plus an `index.json` in the same folder. They
  never leave that folder unless you export or copy them.
- **Your settings** (the library path, the interface theme, the pen slots) are
  stored locally in the application's user-data folder on the same machine.
- **Nothing else.** There is no usage log, no crash reporting and no device
  identifier.

## What the app sends

Nothing. It makes no network requests at runtime, including in the Microsoft
Store build. The Store installation itself is handled by Windows; the app does
not contact a server after it starts.

## Exports

PDF, PNG and `.wcanvas` exports are written only where you choose in the save
dialog. The app does not upload them anywhere.

## Third parties

The app is built with Electron; it bundles Chromium and Node.js and no
advertising, analytics or tracking library. The only runtime npm dependency is
`gifenc`, which encodes the ink replay GIF locally.

## Children

The app collects no personal data from anyone, including children.

## Changes

If this ever changes — for example if an optional sync feature is added — this
page will say so before that version ships, and the feature will be opt-in.

## Contact

Open an issue at https://github.com/ThanhNguyxnOrg/WriteCanvas/issues, or use the
private channel in [SECURITY.md](../SECURITY.md) for a security concern.

_Last updated: 2026-10-25._