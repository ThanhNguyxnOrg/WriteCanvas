// Auto-merge policy for .github/workflows/auto-merge.yml.
//
// ThanhNguyxnAgent merges a pull request only when all of the following hold:
//   - it is not a draft,
//   - the CI run that just finished was for the same commit as the PR head,
//   - it carries no blocking label,
//   - it touches no sensitive path,
//   - it is not a major dependency bump.
// Anything else is left alone, labelled `needs-review`, and assigned to the
// owner in REVIEW_ASSIGNEE so a human decides.
//
// decide() is pure so tests/auto-merge.test.mjs can cover the policy without
// GitHub; the CLI half at the bottom only talks to `gh`.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const list = (value, fallback) => (value || fallback).split(',').map(s => s.trim()).filter(Boolean)

export const BLOCKING_LABELS = list(process.env.BLOCKING_LABELS, 'needs-review,do-not-merge,breaking,security,wip')
export const SENSITIVE_PATHS = list(process.env.SENSITIVE_PATHS, '.github/**,main/**,preload.js')

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

export function decide({
  title = '',
  labels = [],
  files = [],
  isDraft = false,
  headMatches = true,
  baseRef = 'master',
  targetBranch = 'master',
  blockingLabels = BLOCKING_LABELS,
  sensitivePaths = SENSITIVE_PATHS,
} = {}) {
  if (baseRef !== targetBranch) return { action: 'skip', reason: `targets ${baseRef}, not ${targetBranch}` }
  if (isDraft) return { action: 'skip', reason: 'draft pull request' }
  if (!headMatches) return { action: 'skip', reason: 'CI ran for a newer commit' }

  const blocked = labels.filter(l => blockingLabels.includes(l))
  if (blocked.length) return { action: 'review', reason: `blocking label: ${blocked.join(', ')}` }

  const sensitive = files.filter(f => sensitivePaths.some(p => globToRegExp(p).test(f)))
  if (sensitive.length) {
    const shown = sensitive.slice(0, 5).join(', ')
    const more = sensitive.length > 5 ? ` (+${sensitive.length - 5} more)` : ''
    return { action: 'review', reason: `touches sensitive paths: ${shown}${more}` }
  }

  if (isMajorBump(title)) return { action: 'review', reason: 'major dependency bump' }

  return { action: 'merge', reason: 'green CI, no blocking label, no sensitive path' }
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
  const files = gh(['api', `repos/${repo}/pulls/${prNumber}/files`, '--paginate', '--jq', '.[].filename'])
    .split('\n')
    .filter(Boolean)

  const verdict = decide({
    title: pr.title,
    labels: pr.labels.map(l => l.name),
    files,
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