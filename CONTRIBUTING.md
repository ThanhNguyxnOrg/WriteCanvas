# Contributing

Thanks for looking. WriteCanvas is a small project with a narrow goal: keep an
existing Scrble Ink library usable, and make handwriting on a desktop feel right.
Changes that serve that goal are welcome, on Windows, macOS and Linux alike.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

| | |
|---|---|
| **Report a bug** | Use the bug report form. Include your OS, the input device, and the tool in use — a page-turn bug and a pen bug have nothing in common. |
| **Ask or discuss** | [Discussions](https://github.com/ThanhNguyxnOrg/WriteCanvas/discussions) for setup, library questions and ideas that are not yet a proposal. |
| **Improve the docs** | `docs/` is the product of the same care as the code. If a document disagrees with the app, that is a bug in the document — see [docs/README.md](docs/README.md). |
| **Send code** | Fork, branch from `master`, open a pull request. |
| **Report a vulnerability** | Privately, through [SECURITY.md](SECURITY.md). Never in a public issue. |

## Setting up

```bash
git clone https://github.com/<your-fork>/WriteCanvas.git
cd WriteCanvas
npm ci
npm test
npm start
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the environment hooks, the
developer scripts and the coding conventions. Read the section on keeping your
real library out of harm's way before you point the app at notes you care about —
a dev run edits real files.

## Commits and branches

Subjects follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(ruler): snap the angle to 15 degrees
fix(pages): keep the stroke on the page it started on
docs(format): describe the sRST chunk
```

- Branch from `master`. `master` is the only long-lived branch, and it is what CI
  and the release workflow watch.
- One logical change per pull request. A refactor and a behaviour change in the
  same pull request cannot be reviewed or reverted independently.
- Scopes in use: `editor`, `ink`, `paper`, `pages`, `library`, `save`, `export`,
  `laser`, `ruler`, `shortcuts`, `ci`, `docs`, `deps`.

## What a pull request needs

The [template](.github/PULL_REQUEST_TEMPLATE.md) asks for the essentials. In
short:

1. **CI green.** `npm test` on all three operating systems plus CodeQL.
2. **A test for logic.** Pure behaviour belongs in `tests/` — see
   [docs/TESTING.md](docs/TESTING.md) for the rule that decides whether something
   can be unit tested or has to be checked in the running app.
3. **A note for UI work.** Say which OS you used, which tool you exercised, and
   what you expected versus what happened. "It looks fine" is not reviewable.
4. **A changelog entry** under `## [Unreleased]` for anything a user would
   notice.
5. **Docs updated in the same pull request** when behaviour, the note format, the
   shortcut table or the automation changes. A document that contradicts the code
   is treated as a bug.

## How review works

- CI has to pass before anything merges.
- A pull request that touches `src/` and nothing sensitive is merged
  automatically once CI is green, as long as it carries no blocking label.
- A pull request that touches `.github/`, `main/` or `preload.js`, carries a
  blocking label, or is a major dependency bump is assigned to a maintainer and
  waits for a person. The rule table is in
  [docs/AUTOMATION.md](docs/AUTOMATION.md).
- If you are unsure whether your change counts as sensitive, say so in the pull
  request and it will be treated as if it were.
- Disagreement is fine and useful. If a review asks for something you think is
  wrong, say why with the evidence — a failing test or a screenshot beats an
  opinion.

## Style

The short version of [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#code-layout-and-conventions):
CommonJS in `main/`, ES modules in `src/js/`, no bundler, no framework, no new
runtime dependency without a reason, pure logic in its own module, one
implementation of the note format and one of the millimetre conversion, and
comments that explain *why* — the ones that restate the code are deleted in
review.

## Licensing of contributions

The project is licensed under the [Apache License 2.0](LICENSE). By submitting a
pull request you agree that your contribution is provided under the same licence,
and you confirm you have the right to do so. There is no separate CLA to sign and
no copyright assignment.