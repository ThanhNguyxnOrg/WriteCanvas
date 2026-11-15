# WriteCanvas documentation

Start where you are, not at the top. Everything below is self-contained; the
root [README](../README.md) is the short version and this folder goes deeper.

## If you use the app

| Document | Contents |
|---|---|
| [PLATFORMS.md](PLATFORMS.md) | What each operating system does differently, what the installers are, and the complete keyboard table. |
| [FORMAT.md](FORMAT.md) | What a note file actually is, so you can trust your library to another tool or hand-edit a PNG. |
| [Privacy policy](../PRIVACY.md) | What the app processes and what it sends — nothing leaves the machine. |

## If you contribute code

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Processes, canvas layers, module map, data flow, the save pipeline and the invariants to keep. |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Get a working copy running, use the developer scripts, and keep your real library out of harm's way. |
| [TESTING.md](TESTING.md) | Run and extend the unit suite; exercise the app with CDP without touching real notes. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Branch and commit style, what a pull request must contain, and how review is handled. |

## If you maintain the project

| Document | Contents |
|---|---|
| [AUTOMATION.md](AUTOMATION.md) | Trace the central Agent control plane, the local workflow adapters, the required checks, and the changes that always need a person. |
| [RELEASING.md](RELEASING.md) | Prepare a version, and follow how the central controller turns it into a tag, a build and a published GitHub Release. |
| [SECURITY.md](../SECURITY.md) | Private reporting channels and what is considered in scope. |
| [CHANGELOG.md](../CHANGELOG.md) | The released history, which is also the source of the release notes. |

## How these documents are written

- Claims about the app are checked against the code in `main/` and `src/js/`
  rather than restated from memory. When a document and the code disagree, the
  code wins and the document is a bug.
- Numbers that a reader might rely on — chunk names, paper sizes, limits, timing
  constants — are stated once, in the document that owns them, and linked
  elsewhere instead of duplicated.
- Anything that was measured rather than read is labelled as measured, with the
  method. Anything inferred is labelled as inferred.