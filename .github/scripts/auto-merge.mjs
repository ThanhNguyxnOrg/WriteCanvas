// Auto-merge policy for .github/workflows/auto-merge.yml.
//
// ThanhNguyxnAgent merges by default. Everything is merged unless it is one of
// the few things a person has to see:
//   - a draft, a pull request for another branch, or a run whose commit is no
//     longer the head,
//   - a blocking label (an explicit veto, e.g. do-not-merge),
//   - a protected path: the Electron main process and the context-isolated
//     bridge, where file access and IPC live,
//   - a workflow change that does more than move an action to another version,
//   - a major dependency bump.
//
// A routine dependency or action bump therefore lands on its own, while a
// rewrite of a job, a permission or a shell script in .github/workflows stops
// and asks for a human. Anything else is merged.
//
// decide() is pure so tests/auto-merge.test.mjs can cover the policy without
// GitHub; the CLI half at the bottom only talks to `gh`.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const list = (value, fallback) => (value || fallback).split(',').map(s => s.trim()).filter(Boolean)

export const BLOCKING_LABELS = list(process.env.BLOCKING_LABELS, 'needs-review,do-not-merge,breaking,security,wip')
// The main process and the preload bridge are the trust boundary. A change
// there is always read by a person.
export const SENSITIVE_PATHS = list(process.env.SENSITIVE_PATHS, 'main/**,preload.js')
// Workflow files are treated separately: a version bump is routine, anything
// else in them is not.
export const WORKFLOW_PATHS = list(process.env.WORKFLOW_PATHS, '.github/workflows/**')

const ESCAPE = /[.+^${}()|[\]\\]/g

// Supports the two shapes used above: `**` spans directories, `*` stays inside
// one path segment. No third-party glob dependency for four patterns.
export function globToRegExp(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(ESCAPE, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

// Dependabot titles read "Bump <dep> from <old> to <new>". A major jump can
// break the ink and file APIs, so it never auto-merges.
export function isMajorBump(title) {
  const m = /from v?(\d+)\.\d+\.\d+ to v?(\d+)\.\d+\.\d+/.exec(String(title || ''))
  if (!m) return false
  return Number(m[2]) > Number(m[1])
}

// One changed line of a unified diff that only moves an action to another ref:
//   -      - uses: actions/checkout@v5
//   +      - uses: actions/checkout@v7
const ACTION_PIN = /^[+-]\s*(?:-\s*)?uses:\s*[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@\S+/

// True when a workflow file's diff does nothing but re-point actions at other
// versions - which is all a dependency bump does. A change to a job, a
// permission, a trigger or a shell script returns false, so it waits for a
// person. A patch we were not given is treated as unknown, not as routine.
export function isRoutineWorkflowBump(patchLines) {
  if (!Array.isArray(patchLines) || !patchLines.length) return false
  let changed = 0
  for (const line of patchLines) {
    if (!/^[+-]/.test(line)) continue // context lines and hunk headers
    if (/^(\+\+\+|---)/.test(line)) continue // file headers
    if (/^[+-]\s*$/.test(line)) continue // a blank line added or removed
    changed++
    if (!ACTION_PIN.test(line)) return false
  }
  return changed > 0
}

function describe(files, limit = 5) {
  const shown = files.slice(0, limit).join(', ')
  return files.length > limit ? `${shown} (+${files.length - limit} more)` : shown
}

export function decide({
  title = '',
  labels = [],
  files = [],
  patches = {},
  isDraft = false,
  headMatches = true,
  baseRef = 'master',
  targetBranch = 'master',
  blockingLabels = BLOCKING_LABELS,
  sensitivePaths = SENSITIVE_PATHS,
  workflowPaths = WORKFLOW_PATHS,
} = {}) {
  if (baseRef !== targetBranch) return { action: 'skip', reason: `targets ${baseRef}, not ${targetBranch}` }
  if (isDraft) return { action: 'skip', reason: 'draft pull request' }
  if (!headMatches) return { action: 'skip', reason: 'CI ran for a newer commit' }

  const blocked = labels.filter(l => blockingLabels.includes(l))
  if (blocked.length) return { action: 'review', reason: `blocking label: ${blocked.join(', ')}` }

  const protectedFiles = files.filter(f => sensitivePaths.some(p => globToRegExp(p).test(f)))
  if (protectedFiles.length) {
    return { action: 'review', reason: `touches paths that need a human: ${describe(protectedFiles)}` }
  }

  const structural = files
    .filter(f => workflowPaths.some(p => globToRegExp(p).test(f)))
    .filter(f => !isRoutineWorkflowBump(patches[f]))
  if (structural.length) {
    return { action: 'review', reason: `changes workflow structure: ${describe(structural)}` }
  }

  if (isMajorBump(title)) return { action: 'review', reason: 'major dependency bump' }

  return { action: 'merge', reason: 'green CI, nothing that needs a person' }
}

// ---------- CLI half ----------

function gh(args, { json = false } = {}) {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: process.env })
  return json ? JSON.parse(out) : out
}

function ensureLabel(name, color, description) {
  try {
    gh(['label', 'create', name, '--repo', process.env.REPO, '--color', color, '--description', description, '--force'])
  } catch (err) {
    console.log(`::warning::could not create label ${name}: ${err.message}`)
  }
}

function comment(url, body) {
  try {
    gh(['pr', 'comment', process.env.PR_NUMBER, '--repo', process.env.REPO, '--body', body])
  } catch (err) {
    console.log(`::warning::could not comment on ${url}: ${err.message}`)
  }
}

function main() {
  const repo = process.env.REPO
  const prNumber = process.env.PR_NUMBER
  if (!repo || !prNumber) {
    console.log('::notice::this CI run has no pull request attached; nothing to merge')
    return
  }

  const pr = gh(
    ['pr', 'view', prNumber, '--repo', repo, '--json', 'title,url,isDraft,labels,headRefOid,mergeable,baseRefName'],
    { json: true },
  )
  // One JSON object per line: the file list and the patches, so the policy can
  // tell a routine action bump from a rewrite of a workflow. GitHub omits the
  // patch for a large or binary file; that is treated as unknown, not routine.
  const changed = gh(['api', `repos/${repo}/pulls/${prNumber}/files`, '--paginate', '--jq', '.[] | @json'])
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const files = changed.map(f => f.filename)
  const patches = {}
  for (const f of changed) if (f.patch) patches[f.filename] = f.patch.split('\n')

  const verdict = decide({
    title: pr.title,
    labels: pr.labels.map(l => l.name),
    files,
    patches,
    isDraft: pr.isDraft,
    headMatches: pr.headRefOid === process.env.HEAD_SHA,
    baseRef: pr.baseRefName,
  })
  console.log(`${pr.url} -> ${verdict.action}: ${verdict.reason}`)

  if (verdict.action === 'skip') return
  if (verdict.action === 'review') return requestReview(pr, verdict)
  merge(pr, verdict)
}

function requestReview(pr, verdict) {
  ensureLabel('needs-review', 'FBCA04', 'Held for a human owner by ThanhNguyxnAgent')
  try {
    gh(['pr', 'edit', process.env.PR_NUMBER, '--repo', process.env.REPO, '--add-label', 'needs-review'])
  } catch (err) {
    console.log(`::warning::could not label ${pr.url}: ${err.message}`)
  }

  const owner = process.env.REVIEW_ASSIGNEE
  if (owner) {
    try {
      gh(['pr', 'edit', process.env.PR_NUMBER, '--repo', process.env.REPO, '--add-assignee', owner, '--add-reviewer', owner])
    } catch (err) {
      console.log(`::warning::could not assign ${owner}: ${err.message}`)
    }
  }

  comment(pr.url, `Not auto-merged: ${verdict.reason}.${owner ? ` Assigned to @${owner} for review.` : ''}`)
}

function merge(pr, verdict) {
  if (pr.mergeable !== 'MERGEABLE') {
    comment(pr.url, `Not auto-merged: the branch state is ${pr.mergeable}. ${verdict.reason}.`)
    return
  }
  try {
    // --match-head-commit keeps the merge atomic: if anyone pushes to the
    // branch between the checks and now, the merge is rejected instead of
    // shipping an unchecked commit.
    gh(['pr', 'merge', process.env.PR_NUMBER, '--repo', process.env.REPO, '--squash', '--delete-branch', '--match-head-commit', pr.headRefOid])
    console.log(`::notice::merged ${pr.url} as ThanhNguyxnAgent`)
  } catch (err) {
    console.log(`::warning::merge of ${pr.url} failed: ${err.message}`)
  }
}

// Only talk to `gh` when the workflow runs this file directly; the tests import
// decide() without a GitHub token or a network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()