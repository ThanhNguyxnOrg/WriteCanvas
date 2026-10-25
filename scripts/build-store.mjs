// Builds the Windows Store package (AppX) with the electron-builder already
// pinned by the release pipeline.
//
// Why AppX and not MSIX: the MSIX target is documented in electron-builder's
// master branch, but the newest published version (26.18.0 at the time of
// writing) still rejects `msix` as an unknown config property. AppX uses the same
// manifest and the same Store submission flow, and Microsoft's Store accepts
// .appx/.appxbundle for new submissions and re-signs them itself, so no
// certificate is needed either way.
//
// The identity lives in store/identity.json (values from Partner Center), not in
// package.json: electron-builder 25 validates its config schema strictly, so the
// identity is passed as CLI overrides and only this script sees it.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const identity = JSON.parse(readFileSync(new URL('../store/identity.json', import.meta.url), 'utf8'))

const overrides = Object.entries(identity).map(([key, value]) => `-c.appx.${key}=${value}`)

const args = [
  '--win',
  'appx',
  '--x64',
  '--publish',
  'never',
  ...overrides,
]

const bin = process.platform === 'win32'
  ? 'node_modules/.bin/electron-builder.cmd'
  : 'node_modules/.bin/electron-builder'

console.log(`${bin} ${args.join(' ')}`)
const result = spawnSync(bin, args, { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(result.status ?? 1)