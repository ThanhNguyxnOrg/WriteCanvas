# Releasing

A release is a commit with a special subject. The tag, the GitHub Release and the
release notes are produced by `.github/workflows/release.yml`, and the notes come
out of `CHANGELOG.md` — so the changelog is the source of truth for what a
version says, not the commit log.

## Before you release

1. **Move the changelog entries** from `## [Unreleased]` into a new
   `## [X.Y.Z] - YYYY-MM-DD` section. Write it the way a user reads it: what
   changed and why it matters, not which file was touched.
2. **Bump `package.json`** to the same version. A mismatch does not fail the
   release, but it logs a warning and leaves the repository inconsistent.
3. **Check the pair locally:**

```bash
npm test        # tests/release-notes.test.mjs fails if the version has no section
```

4. **Decide the version honestly.** Semantic versioning: a fix is a patch, a new
   tool or a new option is a minor, a change that can break an existing note or
   export is a major.

## Cut the release

```bash
git checkout master
git pull
git add CHANGELOG.md package.json
git commit -m "release: v0.2.0"
git push
```

That push does the rest:

| Step | What happens |
|---|---|
| Resolve | The subject is parsed. A push whose subject is not `release: vX.Y.Z` ends here with a notice and changes nothing. |
| Guard | If `vX.Y.Z` is already published, the run stops — unless it was asked to replace that version's files (see below). |
| Build | Four packaging jobs, one per installer: NSIS on Windows, DMG on macOS, AppImage and deb on Linux. **This is the only place a build happens**; an ordinary push never triggers one, because each job downloads Electron and packages the app. |
| Verify | Each build job reads its own `app.asar` and fails if the bridge (`preload.js`), the renderer entry point or the runtime dependency is missing. This is what the 0.1.0 installer needed. |
| Publish | The notes come from the `## [X.Y.Z]` section of `CHANGELOG.md`, and the installers built above are attached to the release. Created with a ThanhNguyxnAgent token, so the Release page names the Agent. |

A version containing a hyphen (`release: v0.2.0-rc.1`) is published as a
pre-release and never becomes the "latest" release.

### Replacing the files of a published version

`Release` also supports manual dispatch, with two inputs: `version`, and `force`.
The manual path is useful when the release commit is not the head of `master` any
more, or when you want to re-publish:

- `force: false` (default) — a version that is already published is left alone.
- `force: true` — the notes are refreshed and the installers of **that version
  only** are replaced (`--clobber`). Other releases keep their files and tags.

So the rule for a bad build is: fix whatever made it bad, then run `Release` again
with `force: true` for that same version. Nothing else in the release history is
touched.

## What a release contains

- A tag on the release commit, and a GitHub Release whose notes are written by a
  person in `CHANGELOG.md`.
- Four installers, named by electron-builder:

| Asset | Platform |
|---|---|
| `WriteCanvas.Setup.<version>.exe` | Windows x64, NSIS assisted setup — it asks where to install |
| `WriteCanvas-<version>-arm64.dmg` | macOS Apple silicon |
| `WriteCanvas-<version>.AppImage` | Linux x64 |
| `writecanvas_<version>_amd64.deb` | Linux x64, Debian/Ubuntu |

The macOS runner is Apple silicon, so the DMG is arm64. Intel Macs are not built
yet: adding an x64 leg (or a universal binary) is a matrix change in
`release.yml` and a deliberate follow-up, not something to assume.

**The builds are unsigned.** There is no code-signing certificate configured, so
Windows SmartScreen and macOS Gatekeeper will warn the first time the installer
runs, and macOS may require an explicit right-click → Open. Signing is a
deliberate gap, not a bug: it needs a paid certificate per platform, and adding it
means adding the secrets and the signing steps to the build job.

Also note that the build job does not wait for CI to finish on the same commit.
The release commit is normally an empty commit on top of a green `master`, which
is what makes that acceptable. Do not put code changes in a release commit.

## When something goes wrong

| Symptom | Cause and remedy |
|---|---|
| Job failed at "Build the notes" | `CHANGELOG.md` has no `## [X.Y.Z]` section. Add it, push the fix, then re-run the workflow or push a new release commit. The tag was not created, so nothing is half-published. |
| Job failed in one of the build jobs | That platform's installer did not build. The release was not created, because publishing waits for the builds. Fix the cause and re-run; nothing needs cleaning up. |
| Warning about `package.json` | The version there does not match the release commit. Fix it in a follow-up commit; the release already exists. |
| The release exists but the notes are wrong | Edit the changelog, then run `Release` with `version` set and `force: true`; the notes of that release are refreshed. |
| The installer is broken or stale | Run `Release` with `version` set and `force: true`: the files of that version are replaced, other releases are untouched. |
| Wrong tag on the wrong commit | Delete the release and the tag, fix the changelog or the commit, then re-run: `gh release delete v0.2.0 --yes --cleanup-tag`. Deleting a published tag is destructive — re-check the notes and the commit first. |
| A push that was meant to release did nothing | Check the subject line. It must be the first line, exactly `release: vX.Y.Z` (a leading `v` is optional, `release:` is not). |

## After the release

- Check the Release page: the actor should be ThanhNguyxnAgent, and the notes
  should read as a summary rather than a file list.
- Check that the CI and CodeQL badges on the README are green for that commit.
- Start the next `## [Unreleased]` section in `CHANGELOG.md` — the convention is
  to add entries as work lands, not at release time.

## Why the changelog, not the commits

Generated release notes from commit subjects describe the work; a changelog
describes the change. Users read the second one. The workflow makes that
non-negotiable: a version without a written section does not publish, so a release
cannot happen by accident and cannot ship empty notes.