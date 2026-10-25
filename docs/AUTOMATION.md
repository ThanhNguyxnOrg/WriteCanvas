# Automation

Four things happen without a person: the test suite runs, the code is scanned,
dependency updates are proposed, and green pull requests are merged. This page
describes what each one does, what it is allowed to write, and what it
deliberately refuses to do.

## The agent identity

Every write performed by automation — merges, review requests, labels, tags,
GitHub Releases, repository settings — uses a short-lived installation token
minted from a GitHub App, so the pull request and the Release page record
**ThanhNguyxnAgent** as the actor rather than `github-actions[bot]`.

| | |
|---|---|
| App slug | `thanhnguyxnagent` |
| App ID | `4125740`, installed on the `ThanhNguyxnOrg` organisation |
| Organisation secrets | `BOT_APP_ID`, `BOT_PRIVATE_KEY` |
| Secret visibility | **Public repositories** only — see the warning below |
| Token mint | `actions/create-github-app-token@v3` in every workflow that writes |

### The visibility trap

The two organisation secrets are scoped to *public repositories*. This repository
is public, so they resolve. **If the repository is ever made private, the secrets
stop being visible to these workflows and every job that mints a token fails.**
The fix is to change the secrets' visibility to include private repositories (an
organisation setting), not to add new secrets.

### `app-id` versus `client-id`

Version 3 of `create-github-app-token` prefers `client-id` and treats `app-id` as
a deprecated alias; the workflows use `app-id` because the secret holds the
numeric App ID. GitHub accepts either an app ID or a client ID as the JWT `iss`
claim, so both forms work. If the secret is ever replaced with a client ID (it
starts with `Iv`), rename the input to `client-id` — the comment in
`.github/workflows/auto-merge.yml` says the same next to the value.

### Rotating the key

Generate a new private key in the App's settings, store it as `BOT_PRIVATE_KEY`
at the organisation level, and delete the old key. Nothing in this repository
changes, and no workflow edit is needed.

### The reviewer a held pull request is assigned to

`REVIEW_ASSIGNEE` is a repository variable; when it is unset the workflows fall
back to `RealThanhNguyxn`. Set it to an organisation team
(`ThanhNguyxnOrg/owners`) or another owner without touching any workflow file:

```bash
gh variable set REVIEW_ASSIGNEE --org ThanhNguyxnOrg --body ThanhNguyxnOrg/owners
```

## Workflows

| Workflow | Trigger | What it writes |
|---|---|---|
| `ci.yml` | Push to `master`, every pull request, manual | Nothing. Runs the unit suite on Ubuntu, Windows and macOS, plus a `node --check` pass over every module. |
| `codeql.yml` | Push to `master`, pull requests into `master`, weekly | Code scanning alerts only. Runs the `security-and-quality` query pack over the JavaScript. |
| `auto-merge.yml` | CI finishing on a pull request | Merges, or labels and assigns for review. See the policy below. |
| `release.yml` | Push to `master`, manual | Creates the tag and the GitHub Release. See [RELEASING.md](RELEASING.md). |
| `repo-setup.yml` | Manual only | Repository merge settings and labels. Never runs on its own. |

`.github/dependabot.yml` opens the dependency pull requests: npm weekly (minor and
patch grouped into one pull request, majors left separate), and GitHub Actions
weekly, grouped.

## The auto-merge policy

The decision lives in `.github/scripts/auto-merge.mjs` as a pure function, so it
can be tested without GitHub; the workflow only supplies the inputs. A pull
request is **merged** with the Agent token when all of the following hold:

- CI for that exact commit finished successfully, and the commit is still the
  head of the branch,
- the pull request is not a draft and targets `master`,
- it carries none of the blocking labels,
- it touches no sensitive path,
- it is not a major dependency bump.

Anything else is **left open**, labelled `needs-review`, and assigned to the owner
in `REVIEW_ASSIGNEE` — with a comment saying which rule held it. Drafts, pull
requests that target another branch, and runs whose commit is no longer the head
are **skipped silently**, because the next run will pick them up.

| Input | Default | Meaning |
|---|---|---|
| `BLOCKING_LABELS` | `needs-review, do-not-merge, breaking, security, wip` | Any of these holds the pull request. |
| `SENSITIVE_PATHS` | `.github/**, main/**, preload.js` | A change here always needs a person: CI/CD, the Electron main process, and the context-isolated bridge. |
| Major dependency bump | title pattern `from 1.2.3 to 2.0.0` | A major jump can break the ink and file APIs, so it waits for a human. |

Two safety details in the merge itself:

- The merge is `--squash` with `--match-head-commit`, so if anyone pushes to the
  branch between the checks finishing and the merge, GitHub rejects the merge
  instead of landing an unchecked commit.
- The head branch is deleted after the merge (`--delete-branch`).

### Consequences worth knowing

- **A Dependabot minor or patch bump to `package.json` and the lockfile merges by
  itself.** Those paths are not sensitive by design, which is what makes the
  weekly update useful.
- **A GitHub Actions update never auto-merges**, because it edits `.github/`, and
  a major npm bump never auto-merges either. Both are held for review.
- **Fork pull requests are treated the same way.** This workflow uses
  `workflow_run`, which runs in the base repository's context with access to the
  secrets — a workflow triggered directly by a fork pull request would not see
  them at all.
- **Pull requests from the maintainer are not exempt.** The policy looks at the
  labels, the paths and the title, not at who opened it.

### Changing the policy

1. Edit `BLOCKING_LABELS`, `SENSITIVE_PATHS` or the `REVIEW_ASSIGNEE` fallback in
   `.github/workflows/auto-merge.yml`.
2. Update `tests/auto-merge.test.mjs` so the new rule is covered.
3. If you add a sensitive path, add it to `.github/CODEOWNERS` too, so GitHub also
   requests a review from the owner at PR-open time.

`npm test` runs the policy tests on every push, so a rule change with no test
fails CI rather than silently merging something it should not.

## The App's permissions

The installation currently holds broad write permission (contents, pull requests,
workflows, administration and more). Everything the workflows use needs only:

| Permission | Used for |
|---|---|
| Contents: write | Merging, creating tags and releases. |
| Pull requests: write | Merging, labels, review requests, comments. |
| Administration: write | Only `repo-setup.yml`, which patches repository settings. |

Reducing the installation's permissions to these three is a reasonable hardening
step; if you do, `repo-setup.yml` is the workflow to check first, because it is the
only one that touches settings.

## Repository settings

`repo-setup.yml` is manual by design — open the Actions tab, run it, and tick
what to apply. It can:

- create or refresh the labels the policy uses (`dependencies`, `needs-review`,
  `do-not-merge`, `breaking`, `security`, `wip`),
- enable GitHub's own auto-merge switch (a convenience for anyone merging by hand;
  the workflow does not need it),
- delete the head branch on merge, and offer the "Update branch" button.

Current state: auto-merge is **off**, `master` has **no branch protection**, and
the label set above does not exist yet. The auto-merge workflow works regardless,
because it merges directly with the Agent token.

**If branch protection is added later**, remember that a required review will also
apply to the Agent: either add the App as a bypass actor, or keep the sensitive-path
list as the thing that decides what needs a human.

**Code scanning must stay on the advanced setup.** `codeql.yml` uploads results
itself, so the repository's "Code scanning → Default setup" has to remain
disabled. Enabling default setup while this workflow exists makes the analysis
job fail with a conflict error.

## Keeping this page honest

The numbers and names here — App ID, secret names, visibility, permissions,
default labels and paths — were read from the organisation and the workflows. If
you change one of them, change it here in the same pull request. A stale
automation page is worse than none, because it is the page people trust when a
workflow fails.