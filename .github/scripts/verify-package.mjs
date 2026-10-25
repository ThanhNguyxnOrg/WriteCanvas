// Verifies the packaged application before a release attaches it.
//
// The 0.1.0 and 0.1.1 installers were built without preload.js, and nothing in
// the pipeline noticed: the build succeeded, the tests passed (they run from
// source), and the broken file only showed up when someone launched the
// installer. This runs inside each build job, on its own operating system, and
// reads the app.asar that is about to be packaged.
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import asar from '@electron/asar'
import { findPackagedApps } from './package-paths.mjs'

// Everything the app needs to start: the bridge, the main script, the renderer
// entry point, the module marker that makes src/js an ES module tree, and the
// one runtime dependency.
const REQUIRED = [
  '/preload.js',
  '/main/main.js',
  '/src/index.html',
  '/src/package.json',
  '/package.json',
  '/node_modules/gifenc/package.json',
]

const fail = message => {
  console.error(`::error::${message}`)
  process.exit(1)
}

const apps = findPackagedApps()
if (!apps.length) fail('no packaged application found under dist/')

for (const app of apps) {
  const entries = asar.listPackage(app.asar).map(entry => entry.replace(/\\/g, '/'))
  const missing = REQUIRED.filter(required => !entries.includes(required))
  if (missing.length) {
    fail(`${app.asar} is missing ${missing.join(', ')} — the installed app would not start`)
  }

  // The icon is applied by the platform packager, so on macOS it must have
  // become an .icns inside the bundle. Windows and Linux fail their packaging
  // step outright when the icon cannot be converted.
  if (process.platform === 'darwin') {
    const resources = dirname(app.asar)
    if (!readdirSync(resources).some(file => file.endsWith('.icns'))) {
      fail(`no .icns in ${resources} — the app icon was not applied`)
    }
  }

  console.log(`::notice::verified ${entries.length} entries in ${app.asar}`)
}