// Guards over the workflow files themselves.
//
// The automation is only as trustworthy as its invariants: an action pinned to a
// branch can be moved under us, and a workflow that writes with the default
// token would put a second identity in the repository's history. These checks
// read the workflow text, so they need no YAML parser and no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const DIR = new URL('../.github/workflows/', import.meta.url)
const files = readdirSync(DIR).filter(f => f.endsWith('.yml'))
const read = f => readFileSync(new URL(f, DIR), 'utf8')

const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@(v\d+|[0-9a-f]{40})$/

test('there is at least one workflow, and every one declares permissions', () => {
  assert.ok(files.length > 0, 'no workflow files found')
  for (const f of files) {
    assert.match(read(f), /^permissions:/m, `${f} must declare permissions`)
  }
})

test('every action is pinned to a major tag or a commit sha', () => {
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      const m = /^\s*(?:-\s*)?uses:\s*(\S+)\s*$/.exec(line)
      if (!m) continue
      const ref = m[1]
      if (ref.startsWith('./')) continue // a local action in this repository
      assert.ok(PINNED.test(ref), `${f}: "${ref}" is not pinned to a major version or a sha`)
    }
  }
})

test('the same action is pinned to the same major in every workflow', () => {
  const pins = new Map()
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      const m = /uses:\s*(\S+)@(v\d+|[0-9a-f]{40})\s*$/.exec(line)
      if (!m) continue
      const [, action, ref] = m
      const seen = pins.get(action)
      assert.ok(
        !seen || seen === ref,
        `${action} is pinned to ${seen} in one workflow and to ${ref} in another`,
      )
      pins.set(action, ref)
    }
  }
})

test('no workflow uses pull_request_target', () => {
  for (const f of files) {
    assert.doesNotMatch(read(f), /pull_request_target/, `${f} must not run in the target context`)
  }
})

test('no workflow writes with the default token', () => {
  for (const f of files) {
    assert.doesNotMatch(
      read(f),
      /secrets\.GITHUB_TOKEN/,
      `${f} must write with the Agent token, not GITHUB_TOKEN`,
    )
  }
})

test('every workflow that writes mints a ThanhNguyxnAgent token', () => {
  for (const f of files) {
    const text = read(f)
    const writes = /gh (pr merge|release create|release edit|release upload|label create|api -X PATCH)/
    if (!writes.test(text)) continue
    assert.match(
      text,
      /uses: actions\/create-github-app-token@v\d+/,
      `${f} writes to GitHub, so it must mint the Agent token`,
    )
    assert.match(text, /private-key: \$\{\{ secrets\.BOT_PRIVATE_KEY \}\}/, `${f} must use the Agent key`)
  }
})

test('only the auto-merge workflow reacts to a finished run', () => {
  for (const f of files) {
    const text = read(f)
    if (!/workflow_run:/.test(text)) continue
    assert.equal(f, 'auto-merge.yml', `${f} should not need a workflow_run trigger`)
  }
})