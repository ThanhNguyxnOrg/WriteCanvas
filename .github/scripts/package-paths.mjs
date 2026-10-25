// Locates the packaged application electron-builder just produced.
//
// The output directory differs by target: win-unpacked, linux-unpacked (or
// linux-arm64-unpacked), mac / mac-arm64 with a .app inside. Both the bundle
// check and the launch check need the same answer, so it lives here.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function findPackagedApps() {
  const found = []
  // Local debugging can point at another output folder; CI and the release
  // scripts use electron-builder's default.
  const output = process.env.PACKAGE_DIR || 'dist'
  if (!existsSync(output)) return found

  for (const entry of readdirSync(output)) {
    const dir = join(output, entry)
    if (!statSync(dir).isDirectory()) continue
    const candidates = []

    if (entry === 'win-unpacked') {
      candidates.push({ asar: join(dir, 'resources', 'app.asar'), exe: join(dir, 'WriteCanvas.exe') })
    } else if (/^linux.*unpacked$/.test(entry)) {
      const bin = readdirSync(dir).find(name => /^writecanvas$/i.test(name))
      if (bin) candidates.push({ asar: join(dir, 'resources', 'app.asar'), exe: join(dir, bin) })
    } else if (entry.startsWith('mac')) {
      for (const app of readdirSync(dir)) {
        if (!app.endsWith('.app')) continue
        const macos = join(dir, app, 'Contents', 'MacOS')
        if (!existsSync(macos)) continue
        candidates.push({
          asar: join(dir, app, 'Contents', 'Resources', 'app.asar'),
          exe: join(macos, app.replace(/\.app$/, '')),
        })
      }
    }

    for (const candidate of candidates) {
      if (existsSync(candidate.asar) && existsSync(candidate.exe)) found.push(candidate)
    }
  }
  return found
}

// Picks the app built for this job's architecture. electron-builder marks only
// non-x64 output with the arch name, so "no arm64 in the path" means x64.
export function findPackagedApp(arch = process.env.PACKAGE_ARCH || process.arch) {
  const apps = findPackagedApps()
  if (!apps.length) return null
  const wantsArm = arch === 'arm64'
  return apps.find(app => wantsArm === /arm64/.test(app.asar)) || apps[0]
}