# Security policy

## Supported versions

WriteCanvas is at `0.1.x`. Fixes land on `master` and are published as a new
patch release; only the latest release is supported. There is no long-term
support branch yet, and the app ships no server component, so a fix means a new
build rather than a hotpatch.

| Version | Supported |
|---|---|
| 0.1.x | yes |
| older | no |

## Reporting a vulnerability

Report privately through GitHub's advisory form:

**https://github.com/ThanhNguyxnOrg/WriteCanvas/security/advisories/new**

Please do not open a public issue, and do not attach a note you cannot afford to
lose — a copy of the library, or a note exported first, is enough to reproduce
almost anything.

A useful report contains the version (or commit), your operating system, the
steps that trigger the problem, and what you expected instead. This is a
volunteer project: expect an acknowledgement within about a week, and a candid
answer about whether and when a fix will land. Credit in the advisory is offered
unless you would rather stay anonymous.

## Scope

The parts that matter most, in order:

| Area | What we worry about |
|---|---|
| `preload.js` and the IPC surface | The renderer is context isolated and reaches Node only through the `WriteCanvasHost` bridge. Anything that exposes more than the documented calls, or lets renderer input reach `fs` or a shell, is in scope. |
| Library path handling | Every path that arrives from the renderer is resolved and validated in the main process before use. Path traversal, symlink escapes, or a crafted note or folder name that writes outside the library is in scope. |
| Note file parsing | `main/png-chunks.js` and `src/js/png-toolkit.js` parse PNG structure and private `s*` chunks of files that may come from anywhere. Memory exhaustion, out-of-bounds reads or a crash from a hostile chunk layout is in scope. |
| `.wcanvas` import | The container reader accepts a zip that another tool may have produced. Declared sizes, page counts and total bytes are capped, and a file that ignores the caps should be rejected rather than trusted. |
| Dependency compromise | `gifenc` and Electron are the only runtime dependencies. Report a supply-chain concern about either, or about the workflows that consume them. |

## What is out of scope

- A note that a hostile party can already edit: the format is not signed, and
  editing a PNG by hand is not a vulnerability.
- Anything that requires the attacker to already run code on the machine as the
  same user.
- Rendering oddities that do not cross a trust boundary — open a bug report
  instead.

## What the project does

- Keep dependencies current through Dependabot, with major bumps held for human
  review (`docs/AUTOMATION.md`).
- Run CodeQL with the `security-and-quality` query pack on every push and weekly.
- Keep the renderer free of Node access: all file work happens in `main/` behind
  validated IPC, and the window keeps `contextIsolation: true`,
  `nodeIntegration: false` and `sandbox: true`.
- Ship no analytics, no auto-update channel and no network calls at runtime.

## Disclosure

Once a fix is released, the advisory is published with the affected versions and
the mitigation. Please give us a reasonable window to ship the fix before
writing about the issue publicly.