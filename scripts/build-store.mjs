// MSIX is not in any published electron-builder yet (26.18.0 rejects the config
// key), but AppX is — and so is the `toolsets` option that selects a modern
// winCodeSign bundle. The bundle that 25.x downloads carries a 2019 makeappx,
// which rejects the manifest electron-builder generates ("package manifest is
// not valid"); electron-builder 26 with winCodeSign 1.1.0 carries a current one.
//
// So the Store build uses 26 through npx, and the release pipeline keeps the
// pinned 25.x for Windows NSIS, macOS and Linux.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const identity = JSON.parse(readFileSync(new URL('../store/identity.json', import.meta.url), 'utf8'))

const overrides = Object.entries(identity).map(([key, value]) => `-c.appx.${key}=${value}`)

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