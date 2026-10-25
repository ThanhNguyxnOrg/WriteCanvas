// Builds the Microsoft Store package with electron-builder 26, without touching
// the electron-builder 25 that the release pipeline uses.
//
// The identity lives in store/identity.json rather than in package.json because
// electron-builder 25 validates its config schema strictly: an unknown `msix` or
// `toolsets` key makes it refuse to build at all, which is exactly what happened
// to every release job. Version 26 accepts those keys, so they are passed here as
// CLI overrides and only this script ever sees them.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const identity = JSON.parse(readFileSync(new URL('../store/identity.json', import.meta.url), 'utf8'))

// values from Partner Center → -c.msix.* overrides
const overrides = Object.entries(identity).map(([key, value]) => `-c.msix.${key}=${value}`)

const args = [
  '--yes',
  'electron-builder@26.18.0',
  '--win',
  'msix',
  '--x64',
  '--publish',
  'never',
  ...overrides,
  '-c.msix.createMsixupload=true',
  // MSIX needs the modern winCodeSign toolset; electron-builder downloads it.
  '-c.toolsets.winCodeSign=1.1.0',
]

console.log(`npx ${args.join(' ')}`)
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(npx, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)