// Tests for .github/scripts/release-notes.mjs — the code path that decides
// whether a push publishes a version and what the release notes say.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parseVersion, changelogSection } from '../.github/scripts/release-notes.mjs'

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro text.',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- Something not shipped yet.',
  '',
  '## [1.2.0] - 2026-02-01',
  '',
  '### Added',
  '',
  '- Triton support.',
  '',
  '### Fixed',
  '',
  '- A page turn that ate the next stroke.',
  '',
  '## [1.1.0] - 2026-01-01',
  '',
  '- First cut.',
  '',
].join('\n')

test('parseVersion accepts the documented release subject', () => {
  assert.equal(parseVersion('release: v1.2.3'), '1.2.3')
  assert.equal(parseVersion('release: 1.2.3'), '1.2.3')
  assert.equal(parseVersion('release: v1.2.3-rc.1'), '1.2.3-rc.1')
  assert.equal(parseVersion('  release: v10.20.30  '), '10.20.30')
})

test('parseVersion reads the subject line, not the body', () => {
  assert.equal(parseVersion('release: v2.0.0\n\nSee CHANGELOG for details.'), '2.0.0')
})

test('parseVersion ignores anything that is not a release subject', () => {
  assert.equal(parseVersion('feat: release: v1.2.3'), null)
  assert.equal(parseVersion('Release v1.2.3'), null)
  assert.equal(parseVersion('release: v1.2'), null)
  assert.equal(parseVersion('release: v1.2.3.4'), null)
  assert.equal(parseVersion('chore: bump deps'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(undefined), null)
})

test('changelogSection returns the body of the matching section only', () => {
  assert.equal(
    changelogSection(CHANGELOG, '1.2.0'),
    '### Added\n\n- Triton support.\n\n### Fixed\n\n- A page turn that ate the next stroke.',
  )
  assert.equal(changelogSection(CHANGELOG, '1.1.0'), '- First cut.')
})

test('changelogSection never matches Unreleased or a missing version', () => {
  assert.equal(changelogSection(CHANGELOG, '9.9.9'), null)
  assert.equal(changelogSection(CHANGELOG, '3.0.0'), null)
})

test('the repository is release ready for its current package version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const body = changelogSection(changelog, manifest.version)
  assert.ok(body, `CHANGELOG.md needs a "## [${manifest.version}]" section before release: v${manifest.version}`)
})