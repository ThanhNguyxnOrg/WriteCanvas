// electron-builder 25.x remains pinned for the normal Windows, macOS and Linux
// release targets. The Store package uses electron-builder 26.18.0 because its
// modern winCodeSign toolset includes the current MakeAppx tooling required by
// the Store manifest.
//
// The Microsoft Store Developer CLI's MSIX publisher expects a .msix package.
// The workflow keeps the original .appx for inspection and gives the same
// package container a .msix filename before submission. The Store MSIX path
// requires Windows 10 build 17763 (version 1809) or newer.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const identity = JSON.parse(readFileSync(new URL('../store/identity.json', import.meta.url), 'utf8'))

const overrides = [
  ...Object.entries(identity).map(([key, value]) => `-c.appx.${key}=${value}`),
  '-c.appx.minVersion=10.0.17763.0',
  '-c.appx.maxVersionTested=10.0.17763.0',
]

const args = [
  '--yes',
  'electron-builder@26.18.0',
  '--win',
  'appx',
  '--x64',
  '--publish',
  'never',
  ...overrides,
  '-c.toolsets.winCodeSign=1.1.0',
]

// shell: true so Windows resolves npx.cmd; the arguments above contain no spaces.
console.log(`npx ${args.join(' ')}`)
const result = spawnSync('npx', args, { stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
