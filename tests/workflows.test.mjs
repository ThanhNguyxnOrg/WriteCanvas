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

const MANAGED_ORG =
  /^ThanhNguyxnOrg\/\.github\/\.github\/(?:workflows\/[\w.-]+\.yml|actions\/[\w.-]+)@(agent-v1|ci-v1|release-v1)$/

test('managed tags are restricted to central organization workflows and actions', () => {
  for (const tag of ['agent-v1', 'ci-v1', 'release-v1']) {
    assert.ok(MANAGED_ORG.test(`ThanhNguyxnOrg/.github/.github/workflows/ci-node.yml@${tag}`))
    assert.ok(MANAGED_ORG.test(`ThanhNguyxnOrg/.github/.github/actions/agent-token@${tag}`))
  }
  for (const ref of [
    '',
    'actions/checkout@ci-v1',
    'OtherOrg/.github/.github/workflows/ci-node.yml@ci-v1',
    'ThanhNguyxnOrg/other/.github/workflows/ci-node.yml@ci-v1',
    'ThanhNguyxnOrg/.github/.github/scripts/check@agent-v1',
    'ThanhNguyxnOrg/.github/.github/workflows/agent-pr-worker.yml@main',
    'ThanhNguyxnOrg/.github/.github/workflows/ci-node.yml@ci-v2',
    'ThanhNguyxnOrg/.github/.github/actions/agent-token@agent-v1-extra',
  ]) {
    assert.ok(!MANAGED_ORG.test(ref), `${ref} must not be accepted as a managed org tag`)
    assert.ok(!PINNED.test(ref), `${ref} must not be accepted as a major tag or sha`)
  }
})

test('there is at least one workflow, and every one declares permissions', () => {
  assert.ok(files.length > 0, 'no workflow files found')
  for (const f of files) {
    assert.match(read(f), /^permissions:/m, `${f} must declare permissions`)
  }
})

test('every action is pinned to a major tag, a commit sha, or a managed org tag', () => {
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      const m = /^\s*(?:-\s*)?uses:\s*(\S+)\s*$/.exec(line)
      if (!m) continue
      const ref = m[1]
      if (ref.startsWith('./')) continue // a local action in this repository
      assert.ok(
        PINNED.test(ref) || MANAGED_ORG.test(ref),
        `${f}: "${ref}" is not pinned to a major version, a sha, or a managed org tag`,
      )
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

test('pull_request_target is restricted to the metadata-only Agent signal', () => {
  const triggered = files.filter(f => /^\s*pull_request_target:/m.test(read(f)))
  assert.deepEqual(triggered, ['agent-pr-signal.yml'])

  const signal = read('agent-pr-signal.yml')
  assert.match(signal, /^permissions:\s*\{\}/m)
  assert.match(signal, /^\s+permissions:\s*\{\}/m)
  assert.match(signal, /EVENT_PR_HEAD_SHA:/)
  assert.match(signal, /actions\/upload-artifact@/)

  // The target-context workflow must not receive credentials, execute PR code,
  // check out a repository, or request a write-capable token.
  assert.doesNotMatch(
    signal,
    /secrets\.|github\.token|GITHUB_TOKEN|actions\/checkout|contents:\s*write|pull-requests:\s*write/i,
  )
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

test('repository-local auto-merge workflows are not duplicated', () => {
  assert.ok(!files.some(f => /^auto-merge(?:-dependabot)?\.yml$/.test(f)), 'merge governance is centralized in ThanhNguyxnOrg/.github')
})
