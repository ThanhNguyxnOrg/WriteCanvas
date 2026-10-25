# WriteCanvas documentation

Start where you are, not at the top. Everything below is self-contained, and the
root [README](../README.md) is only a signpost to this folder.

## If you use the app

| Document | Contents |
|---|---|
| [PLATFORMS.md](PLATFORMS.md) | What each operating system does differently, what the installers are, and the complete keyboard table. |
| [FORMAT.md](FORMAT.md) | What a note file actually is, so you can trust your library to another tool or hand-edit a PNG. |
| [PRIVACY.md](PRIVACY.md) | What the app stores and what it sends — nothing leaves the machine. |

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
| [AUTOMATION.md](AUTOMATION.md) | Every workflow, the secrets they use, the auto-merge policy, and the pull requests ThanhNguyxnAgent deliberately refuses to merge. |
| [RELEASING.md](RELEASING.md) | Turn a `release: vX.Y.Z` commit into a tag and a GitHub Release, and how the changelog is read. |
| [STORE.md](STORE.md) | Build the MSIX package, the reserved identity, the listing copy and the Partner Center steps. |
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