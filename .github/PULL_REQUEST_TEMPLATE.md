<!--
Keep this short. The reviewer reads the diff; they do not need a restatement
of it. Say what changed, what it affects, and how you checked it.
-->

## What changed

<!-- One or two sentences. Reference the issue when there is one: "Closes #12". -->

## Affected surface

<!-- Tick what this pull request actually touches, so the reviewer knows which of
     the three desktop targets to think about. -->

- [ ] Renderer (`src/`)
- [ ] Electron main process or preload bridge (`main/`, `preload.js`)
- [ ] Note format, library layout or export (`main/scrble-format.js`, `main/wcanvas-export.js`)
- [ ] CI, release or dependency automation (`.github/`)
- [ ] Documentation only

## How it was checked

<!-- Commands run, and anything done by hand in the app: which OS, which tool,
     which note, what you expected versus what you saw. "npm test passes" is not
     enough for a UI change. -->

- [ ] `npm test` passes
- [ ] Exercised in the running app (state which OS and which tool)
- [ ] Not applicable, documentation only

## Notes for the reviewer

<!-- Trade-offs, follow-ups deliberately left out, anything surprising. -->