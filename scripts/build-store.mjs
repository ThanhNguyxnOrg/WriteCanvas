// Build the Microsoft Store AppX package with the Store identity and the
// exact AppX settings required by Partner Center.
//
// Keep configuration values in a JSON object rather than passing dotted
// "-c.appx.*" CLI overrides. The latter can be parsed with the wrong type by
// electron-builder's CLI configuration parser (notably four-part Windows
// versions), and can accidentally duplicate settings from store/identity.json.
//
// The workflow checks out this current adapter separately from the release tag,
// so a Store rebuild can be repaired without moving or rewriting an existing tag.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const projectRoot = process.env.GITHUB_WORKSPACE || process.cwd()
const packagePath = join(projectRoot, 'package.json')
const identityPath = join(projectRoot, 'store', 'identity.json')
const packageSource = readFileSync(packagePath, 'utf8')
const packageJson = JSON.parse(packageSource)
const identity = JSON.parse(readFileSync(identityPath, 'utf8'))

const requiredIdentityFields = [
  'applicationId',
  'identityName',
  'publisher',
  'publisherDisplayName',
  'displayName',
]

for (const field of requiredIdentityFields) {
  if (typeof identity[field] !== 'string' || identity[field].trim() === '') {
    throw new Error(`Store identity is missing a valid ${field} value.`)
  }
}

if (!packageJson.build || typeof packageJson.build !== 'object' || Array.isArray(packageJson.build)) {
  throw new Error('package.json must contain a build configuration object.')
}

const appx = {
  ...Object.fromEntries(requiredIdentityFields.map(field => [field, identity[field]])),
  minVersion: '10.0.17763.0',
  maxVersionTested: '10.0.17763.0',
}

packageJson.build = {
  ...packageJson.build,
  appx,
  toolsets: {
    ...(packageJson.build.toolsets || {}),
    winCodeSign: '1.1.0',
  },
}

// electron-builder reads "build" from package.json. Apply the Store-only
// configuration temporarily so the checked-in application manifest and normal
// desktop builds remain unchanged.
writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

let result
try {
  const args = [
    '--yes',
    'electron-builder@26.18.0',
    '--win',
    'appx',
    '--x64',
    '--publish',
    'never',
  ]

  console.log('Building WriteCanvas AppX with validated Store configuration.')
  console.log(`npx ${args.join(' ')}`)
  result = spawnSync('npx', args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) throw result.error
} finally {
  // Restore the release's original package.json even when packaging fails.
  writeFileSync(packagePath, packageSource, 'utf8')
}

if (result.signal) {
  throw new Error(`electron-builder was terminated by signal ${result.signal}.`)
}

process.exitCode = result.status ?? 1
