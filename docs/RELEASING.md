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
| Guard | If `vX.Y.Z` is already published, the job stops. Re-running is safe. |
| Notes | The `## [X.Y.Z]` section of `CHANGELOG.md` becomes `release-notes.md`. A missing section fails the job with that message. |
| Publish | `gh release create vX.Y.Z --target <the pushed commit>` creates the tag and the Release, authored by **ThanhNguyxnAgent**. |

A version containing a hyphen (`release: v0.2.0-rc.1`) is published as a
pre-release and never becomes the "latest" release.

### Releasing from the Actions tab

`Release` also supports manual dispatch with a `version` input, which is useful
when the release commit is not the head of `master` any more, or when you want to
publish a version whose commit is already pushed. It runs exactly the same steps.

## What a release is not

- **No installers are attached.** The workflow publishes a tag and notes only.
  Build artifacts are produced locally with `npm run dist` (NSIS, DMG, AppImage,
  deb) and attached by hand if you want them on the Release page. Adding signed
  builds is a deliberate future step, not an accident of this workflow.
- **No version bump commit is pushed.** You bump `package.json` yourself, in the
  release commit.
- **No maintenance branches.** There is one line of development; a fix goes to
  `master` and ships in the next release.

## When something goes wrong

| Symptom | Cause and remedy |
|---|---|
| Job failed at "Build the notes" | `CHANGELOG.md` has no `## [X.Y.Z]` section. Add it, push the fix, then re-run the workflow or push a new release commit. The tag was not created, so nothing is half-published. |
| Warning about `package.json` | The version there does not match the release commit. Fix it in a follow-up commit; the release already exists. |
| The release exists but the notes are wrong | Edit the changelog **and** the GitHub Release: `gh release edit v0.2.0 --notes-file notes.md`. The workflow will not rewrite an existing release. |
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