// Guards for the packaged build.
//
// The 0.1.0 installer shipped without preload.js in app.asar, so the packaged app
// opened to "No host bridge found" while every source run worked. build.files is a
// list of globs, and a root-level file is easy to forget; these checks compare it
// with what the main process actually opens.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const mainSource = readFileSync(new URL('main/main.js', root), 'utf8')
const files = manifest.build.files

const isCovered = entry => {
  if (files.includes(entry)) return true
  // A directory reference such as "src" is covered by "src/**".
  return files.some(f => f === `${entry}/**` || f.startsWith(`${entry}/`))
}

test('the build ships every root-level file the main process opens', () => {
  // path.join(__dirname, '..', <name>) resolves against the app root, both in
  // development and inside app.asar.
  const refs = [...mainSource.matchAll(/'\.\.',\s*'([^']+)'/g)].map(m => m[1])
  assert.ok(refs.includes('preload.js'), 'main.js should point at preload.js')

  for (const ref of new Set(refs)) {
    assert.ok(isCovered(ref), `build.files does not ship "${ref}", which main.js opens`)
  }
})

test('the preload script exists where main.js expects it', () => {
  assert.ok(existsSync(new URL('preload.js', root)))
})

test('the renderer modules are shipped with their module marker', () => {
  assert.ok(isCovered('src'), 'src/** must be listed in build.files')
  const marker = JSON.parse(readFileSync(new URL('src/package.json', root), 'utf8'))
  assert.equal(marker.type, 'module', 'src/package.json is what makes the renderer ES modules')
  assert.ok(isCovered('main'), 'main/** must be listed in build.files')
  assert.ok(files.some(f => f.includes('node_modules/gifenc')), 'gifenc is a runtime dependency')
})

test('every platform has an icon that exists and is large enough', () => {
  for (const platform of ['win', 'mac', 'linux']) {
    const icon = manifest.build[platform].icon
    assert.ok(icon, `${platform} has no icon`)
    const path = new URL(icon, root)
    assert.ok(existsSync(path), `${platform} icon ${icon} does not exist`)

    const png = readFileSync(path)
    assert.equal(png.toString('ascii', 1, 4), 'PNG', `${icon} is not a PNG`)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    assert.ok(width >= 256 && width === height, `${icon} should be a square of at least 256px, got ${width}x${height}`)
  }
})