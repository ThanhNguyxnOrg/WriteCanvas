// Verifies the packaged application before a release attaches it.
//
// The 0.1.0 and 0.1.1 installers were built without preload.js, and nothing in
// the pipeline noticed: the build succeeded, the tests passed (they run from
// source), and the broken file only showed up when someone launched the
// installer. This runs inside each build job, on its own operating system, and
// reads the app.asar that is about to be packaged.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import asar from '@electron/asar'

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

function findAsar() {
  const direct = [
    'dist/win-unpacked/resources/app.asar',
    'dist/linux-unpacked/resources/app.asar',
  ]
  for (const path of direct) if (existsSync(path)) return path

  if (!existsSync('dist')) return null
  for (const entry of readdirSync('dist')) {
    if (!entry.startsWith('mac')) continue
    const dir = join('dist', entry)
    if (!statSync(dir).isDirectory()) continue
    for (const app of readdirSync(dir)) {
      if (!app.endsWith('.app')) continue
      const path = join(dir, app, 'Contents', 'Resources', 'app.asar')
      if (existsSync(path)) return path
    }
  }
  return null
}

const asarPath = findAsar()
if (!asarPath) fail('no packaged app.asar found under dist/')

const entries = asar.listPackage(asarPath).map(entry => entry.replace(/\\/g, '/'))
const missing = REQUIRED.filter(required => !entries.includes(required))
if (missing.length) {
  fail(`${asarPath} is missing ${missing.join(', ')} — the installed app would not start`)
}

// The icon is applied by the platform packager, so on macOS it must have become
// an .icns in the bundle. Windows and Linux are checked by their own packaging
// step, which fails outright when the icon cannot be converted.
if (process.platform === 'darwin') {
  const resources = dirname(asarPath)
  if (!readdirSync(resources).some(file => file.endsWith('.icns'))) {
    fail(`no .icns in ${resources} — the app icon was not applied`)
  }
}

console.log(`::notice::verified ${entries.length} entries in ${asarPath}`)
console.log(`preload.js, renderer modules and gifenc are present`)