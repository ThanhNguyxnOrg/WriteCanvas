// Local release preflight, used by tests/release-notes.test.mjs.
//
// The organization's central release controller owns version bumps, tags and
// release notes. These helpers let the test suite check the same conventions
// before a prepared `release: vX.Y.Z` commit is pushed: the subject must match,
// and the version must have a changelog section to use as the release body.
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
