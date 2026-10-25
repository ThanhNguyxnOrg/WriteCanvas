// Policy tests for .github/scripts/auto-merge.mjs.
//
// The merge decision is the only thing standing between a green check and a
// commit on master, so it is tested as a pure function rather than by watching
// a live pull request.
import test from 'node:test'
import assert from 'node:assert/strict'

import { decide, globToRegExp, isMajorBump, isRoutineWorkflowBump } from '../.github/scripts/auto-merge.mjs'

test('globToRegExp / directory spans', () => {
  assert.equal(globToRegExp('.github/**').test('.github/workflows/ci.yml'), true)
  assert.equal(globToRegExp('.github/**').test('.github/dependabot.yml'), true)
  assert.equal(globToRegExp('.github/**').test('main/main.js'), false)

  assert.equal(globToRegExp('main/**').test('main/main.js'), true)
  assert.equal(globToRegExp('main/**').test('main/deep/nested/file.js'), true)
  assert.equal(globToRegExp('main/**').test('src/main.js'), false)

  assert.equal(globToRegExp('preload.js').test('preload.js'), true)
  assert.equal(globToRegExp('preload.js').test('src/preload.js'), false)

  assert.equal(globToRegExp('src/**/*.js').test('src/js/editor.js'), true)
  assert.equal(globToRegExp('src/**/*.js').test('src/app.js'), true)
  assert.equal(globToRegExp('src/**/*.js').test('src/js/editor.css'), false)
})

test('isMajorBump only fires when the leading number changes', () => {
  assert.equal(isMajorBump('chore(deps): Bump gifenc from 1.0.3 to 2.0.0'), true)
  assert.equal(isMajorBump('Bump actions/checkout from v4.1.0 to v5.0.0'), true)
  assert.equal(isMajorBump('Bump gifenc from 1.0.3 to 1.4.0'), false)
  assert.equal(isMajorBump('Bump gifenc from 1.0.3 to 1.0.4'), false)
  assert.equal(isMajorBump('fix: keep the ruler on the page'), false)
})

test('decide merges a routine renderer change', () => {
  const verdict = decide({ title: 'fix: snap the ruler to the page edge', files: ['src/js/ruler.js', 'docs/PLATFORMS.md'] })
  assert.equal(verdict.action, 'merge')
})

// What dependabot actually sends for an action bump: nothing but the refs move.
const ACTION_BUMP = [
  '@@ -41,11 +41,11 @@ jobs:',
  '           owner: ${{ github.repository_owner }}',
  '           repositories: ${{ github.event.repository.name }}',
  '',
  '-      - uses: actions/checkout@v5',
  '+      - uses: actions/checkout@v7',
  '',
  '-      - uses: actions/setup-node@v5',
  '+      - uses: actions/setup-node@v7',
  '         with:',
  '           node-version: 22',
].join('\n').split('\n')

// A permission change, an added job or an edited script: the part of a workflow
// that a person has to read.
const STRUCTURAL_CHANGE = [
  '@@ -18,7 +18,7 @@ jobs:',
  '     runs-on: ubuntu-latest',
  '-    permissions:',
  '-      contents: write',
  '+    permissions:',
  '+      contents: read',
  '     steps:',
  '-      - run: gh pr merge "$PR" --squash',
  '+      - run: gh pr merge "$PR" --merge',
].join('\n').split('\n')

test('isRoutineWorkflowBump sees a version bump and nothing else', () => {
  assert.equal(isRoutineWorkflowBump(ACTION_BUMP), true)
  assert.equal(isRoutineWorkflowBump(STRUCTURAL_CHANGE), false)
  assert.equal(isRoutineWorkflowBump([]), false)
  assert.equal(isRoutineWorkflowBump(undefined), false)
  // Context alone is not a change.
  assert.equal(isRoutineWorkflowBump(['@@ -1,3 +1,3 @@', ' unchanged', ' also unchanged']), false)
})

test('decide lands a routine action bump on its own', () => {
  const verdict = decide({
    title: 'chore(ci): bump the actions group with 2 updates',
    files: ['.github/workflows/ci.yml'],
    patches: { '.github/workflows/ci.yml': ACTION_BUMP },
  })
  assert.equal(verdict.action, 'merge')
})

test('decide holds a workflow change that is not a version bump', () => {
  for (const patches of [{}, { '.github/workflows/release.yml': STRUCTURAL_CHANGE }]) {
    const verdict = decide({
      title: 'ci: change how the release job merges',
      files: ['.github/workflows/release.yml'],
      patches,
    })
    assert.equal(verdict.action, 'review')
    assert.match(verdict.reason, /workflow structure/)
  }
})

test('decide hands protected paths to a human', () => {
  for (const file of ['main/main.js', 'preload.js', 'main/deep/nested/module.js']) {
    const verdict = decide({ title: 'feat: add a thing', files: ['src/js/paper.js', file] })
    assert.equal(verdict.action, 'review', `${file} must require review`)
    assert.match(verdict.reason, /need a human/)
  }
})

test('decide merges an ordinary configuration change', () => {
  const verdict = decide({ title: 'chore: label the issue templates', files: ['.github/CODEOWNERS'] })
  assert.equal(verdict.action, 'merge')
})

test('decide hands blocking labels to a human', () => {
  const verdict = decide({ title: 'feat: add a thing', files: ['src/js/paper.js'], labels: ['do-not-merge'] })
  assert.equal(verdict.action, 'review')
  assert.match(verdict.reason, /do-not-merge/)
})

test('decide hands a major dependency bump to a human even though package.json is not sensitive', () => {
  const files = ['package.json', 'package-lock.json']
  assert.equal(decide({ title: 'chore(deps): Bump gifenc from 1.0.3 to 1.1.0', files }).action, 'merge')
  assert.equal(decide({ title: 'chore(deps): Bump gifenc from 1.0.3 to 2.0.0', files }).action, 'review')
})

test('decide skips drafts, stale commits and other base branches', () => {
  assert.equal(decide({ title: 'wip', files: ['src/js/pen.js'], isDraft: true }).action, 'skip')
  assert.equal(decide({ title: 'fix: x', files: ['src/js/pen.js'], headMatches: false }).action, 'skip')
  assert.equal(decide({ title: 'fix: x', files: ['src/js/pen.js'], baseRef: 'release' }).action, 'skip')
})

test('decide is unaffected by a pull request that touches nothing', () => {
  assert.equal(decide({ title: 'docs: fix a typo' }).action, 'merge')
})