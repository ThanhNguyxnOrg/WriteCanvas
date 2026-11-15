# Releasing

WriteCanvas releases are cut by the organization's central release controller,
not by a tag pushed from a laptop. The controller lives in
[`ThanhNguyxnOrg/.github`](https://github.com/ThanhNguyxnOrg/.github) and reads
this repository's entry in `release-policy.json`. It owns the version, the
changelog entry, the tag and the GitHub Release; `.github/workflows/release.yml`
is only the adapter that builds and uploads the installers.

The changelog is still the source of truth for what a version says. In the normal
flow the controller writes the entry from Conventional Commits; in a prepared
release you write it yourself, and the controller uses it verbatim.

## The normal flow

1. **Write Conventional Commits.** The controller classifies the commits since
   the last tag:

   | Subject | Version bump |
   |---|---|
   | `feat: ...`, `feat(scope): ...` | minor |
   | `fix: ...`, `perf: ...`, `revert: ...` | patch |
   | `feat!: ...`, `fix!: ...`, or a `BREAKING CHANGE:` footer | major |
   | `docs:`, `chore:`, `ci:`, `build:`, `test:`, `release:` | no release |

   A scope of `release`, `ci`, `build`, `docs` or `meta` is ignored even when the
   type would normally count. A pull request with no releasable commit lands on
   `master` without cutting a version.

2. **Keep `master` green.** The controller checks the required CI checks on the
   exact head commit before it writes anything. A failing or missing required
   check holds the release; it does not publish a partial one.

3. **Let the controller prepare the version.** Within roughly fifteen minutes
   (the controller runs on a `7,22,37,52 * * *` schedule, and can be dispatched
   by hand in the central repository), it:
   - bumps `package.json` and both version fields in `package-lock.json`;
   - inserts a `## [X.Y.Z] - YYYY-MM-DD` section at the top of `CHANGELOG.md`;
   - commits both as `release: vX.Y.Z`.

4. **The controller creates the tag and a draft release.** On its next pass it
   creates the real `vX.Y.Z` tag on the release commit and a draft GitHub Release
   whose notes are the matching changelog section.

5. **This repository builds.** Creating the tag triggers `release.yml`. It builds
   every installer, verifies each packaged bundle, launches the packaged app on
   its own platform, and uploads the assets to the tag's draft release through the
   organization's shared publisher.

6. **The controller publishes.** When the build workflow has succeeded for the
   exact tag commit and every asset in the central `requiredAssets` manifest is
   present, the controller publishes the draft. If an asset is missing, the draft
   stays a draft.

You do not create the tag, the release or a second release workflow.

## Preparing a version by hand

A hand-written changelog reads better than notes generated from commit subjects.
To curate a release, prepare the same files the controller would have written and
put the version in the commit subject:

1. **Move the entries** out of `## [Unreleased]` into a new
   `## [X.Y.Z] - YYYY-MM-DD` section. Write it the way a user reads it: what
   changed and why it matters, not which file was touched.

2. **Bump `package.json` and `package-lock.json`** to the same version. Both
   version fields in the lockfile matter — the top-level `version` and
   `packages[""].version`. `npm install --package-lock-only` refreshes them
   without touching `node_modules`.

3. **Check the pair locally:**

   ```bash
   npm test        # tests/release-notes.test.mjs fails if the version has no section
   ```

4. **Commit the release** — a version commit, or an empty commit when the files
   were already prepared:

   ```bash
   git checkout master
   git pull
   git add CHANGELOG.md package.json package-lock.json
   git commit -m "release: v1.2.0"
   git push
   ```

   The controller recognises that subject as a prepared release. It verifies CI
   on the commit, creates the tag and the draft release, and takes the release
   notes from the `## [1.2.0]` section — it does not generate or rewrite them.
   Do not mix code changes into the release commit, and do not create the tag
   yourself.

A version containing a hyphen (`release: v1.3.0-rc.1`) is published as a
pre-release and never becomes the "latest" release.

## What a release contains

- A tag on the release commit, and a GitHub Release whose notes are written by a
  person in `CHANGELOG.md`.
- Six installers, named by electron-builder:

| Asset | Platform |
|---|---|
| `WriteCanvas.Setup.<version>.exe` | Windows x64, NSIS assisted setup — it asks where to install |
| `WriteCanvas-<version>-mac-x64.dmg` | macOS Intel |
| `WriteCanvas-<version>-mac-arm64.dmg` | macOS Apple silicon |
| `WriteCanvas-<version>-linux-x86_64.AppImage` | Linux x64 |
| `writecanvas_<version>_amd64.deb` | Linux x64, Debian/Ubuntu |
| `WriteCanvas-<version>-linux-arm64.AppImage` | Linux arm64 |

Each architecture is built on a runner of that architecture, so the launch check
runs the real binary rather than an emulation. Linux arm64 ships the AppImage
only, because the deb target's fpm toolchain is x86-only. Windows is x64 only; a
32-bit or Windows-on-ARM build is not produced.

**The builds are unsigned.** There is no code-signing certificate configured, so
Windows SmartScreen and macOS Gatekeeper will warn the first time the installer
runs, and macOS may require an explicit right-click → Open. Signing is a
deliberate gap, not a bug: it needs a paid certificate per platform, and adding it
means adding the secrets and the signing steps to the build job.

## Rebuilding an existing tag

`Release` supports manual dispatch with one input, `tag`. It rebuilds the assets
for a tag that already exists and uploads them to that tag's draft release — it
does **not** create a tag, move one, or change the version. Use it when:

- a build job failed for one platform and the release was never published;
- the draft is missing an asset, so the controller has not published it;
- an installer is broken and the tag is still the current version.

Run it from Actions → **Release** → *Run workflow*, with the existing tag such as
`v1.2.0`. The controller checks the build and the asset manifest on its next pass
and publishes the draft when everything is present.

## When something goes wrong

| Symptom | Cause and remedy |
|---|---|
| No release appeared after a `feat:` or `fix:` merge | The controller waits for required CI on the head commit. Fix the check; the next pass picks the commit up. A commit whose type or scope is ignored never cuts a release by itself. |
| The controller logged "CHANGELOG already contains version X" | A hand-written section and the automatic bump raced. Keep one path: either let the controller write the section, or push the version files and the `release: vX.Y.Z` commit together. |
| The tag exists but the draft has no assets | The build workflow failed or one platform produced nothing. Run `Release` with that `tag`; do not create a second tag. |
| The build is green but the draft is still unpublished | One of the six required asset names is missing or the build-workflow name does not match the central policy. Compare the draft with the list above, fix the build, then rerun `Release` for the tag. |
| The notes are wrong before publication | The notes are read from the changelog section at the tag commit. Check them before pushing the release commit. After the draft exists, edit the release body on GitHub; do not move the tag. |
| `package.json` does not match the tag | The repository and the release disagree. Fix the version files in a follow-up commit; the release already exists. |
| A release did not appear after a push | The controller runs on its own schedule. Check that the merge contains a releasable Conventional Commit or a prepared `release: vX.Y.Z` commit, and that the required CI checks are green on the head commit. A local `release.yml` run does not create a release. |

Deleting or moving a published tag is destructive and outside the normal flow.
If it is truly necessary, remove the release and the tag together and let the
controller recreate them from a corrected release commit:

```bash
gh release delete v1.2.0 --yes --cleanup-tag
```

Re-check the notes and the commit before doing that.

## After the release

- Check the Release page: the actor should be ThanhNguyxnAgent, the notes should
  read as a summary rather than a file list, and all six assets should be there.
- A published stable release also triggers `store.yml`, which rebuilds the package
  and submits it to the Microsoft Store with the organisation's Partner Center
  credentials. A failed submission leaves the GitHub Release untouched; work the
  Microsoft Store job the same way you would any other build, and re-run it with
  the tag when a credential or manifest problem is fixed.
- Check that the CI badge is green for the tag commit, and that the code-scanning
  page has no new alerts for it.
- Leave `## [Unreleased]` at the top of `CHANGELOG.md`. Add entries there as work
  lands; the next release moves or generates the section above it.

## Why the changelog, not the commits

Generated release notes from commit subjects describe the work; a changelog
describes the change. Users read the second one. The controller makes that
non-negotiable: a tag whose changelog section is missing does not publish, so a
release cannot ship empty notes.
