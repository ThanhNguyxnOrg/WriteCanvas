// Release helpers for .github/workflows/release.yml.
//
// A push to master whose subject is `release: v1.4.0` publishes that version,
// and the notes come from the matching section of CHANGELOG.md. Nothing is
// generated from commit subjects: the changelog is the source of truth, so a
// release without a changelog entry fails instead of publishing empty notes.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const VERSION_RE = /^release:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/

export function parseVersion(message) {
  const subject = String(message || '').replace(/\r/g, '').split('\n')[0].trim()
  const m = VERSION_RE.exec(subject)
  return m ? m[1] : null
}

// Returns the body of the `## [<version>]` section, or null when absent.
export function changelogSection(markdown, version) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n')
  const heading = new RegExp(`^##\\s+(\\[${version.replace(/\./g, '\\.')}\\]|${version.replace(/\./g, '\\.')})(\\s|$)`)
  const start = lines.findIndex(line => heading.test(line.trim()))
  if (start === -1) return null

  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^##\s/.test(line))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
  return body || null
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT
  if (file) appendFileSync(file, `${key}=${value}\n`)
  console.log(`${key}=${value}`)
}

function resolve() {
  const fromInput = (process.env.INPUT_VERSION || '').trim().replace(/^v/, '')
  const version = fromInput || parseVersion(process.env.COMMIT_MESSAGE)
  if (!version) {
    setOutput('should_release', 'false')
    console.log('::notice::this push is not a release commit (expected a "release: vX.Y.Z" subject)')
    return
  }
  setOutput('should_release', 'true')
  setOutput('version', version)
}

function notes() {
  const version = (process.env.VERSION || process.argv[3] || '').trim()
  if (!version) throw new Error('no version given to the notes step')

  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const body = changelogSection(changelog, version)
  if (!body) {
    throw new Error(`CHANGELOG.md has no "## [${version}]" section; add the entry before releasing`)
  }

  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  if (manifest.version !== version) {
    console.log(`::warning::package.json says ${manifest.version} but the release commit says ${version}`)
  }

  const out = `${process.env.RUNNER_TEMP || '.'}/release-notes.md`
  writeFileSync(out, `${body}\n`)
  setOutput('notes_file', out)
  console.log(`notes written to ${out}`)
}

// Guarded so tests can import parseVersion()/changelogSection() safely.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2]
  if (mode === 'resolve') resolve()
  else if (mode === 'notes') notes()
  else {
    console.error('usage: release-notes.mjs resolve | notes')
    process.exit(2)
  }
}