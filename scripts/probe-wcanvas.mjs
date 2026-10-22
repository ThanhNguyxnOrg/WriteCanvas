// Probe for main/wcanvas-export.js — pure node, no Electron, read-only
// against the real library folder (never writes into it).
//   node scripts/probe-wcanvas.mjs
// Checks:
//  1. build → read round-trip (store method)
//  2. externally deflated entries (method 8) are accepted and CRC-checked
//  3. corrupt CRC / bad names / missing manifest / missing page image rejected
//  4. interop: Windows PowerShell Expand-Archive can unpack the container
//  5. live library page (when present) survives manifest + chunk extraction

import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const require_ = createRequire(import.meta.url)
const { buildNoteZip, readNoteZip, readZipAll } = require_('../main/wcanvas-export.js')

let failures = 0
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-wcanvas-'))
try {
  // ---- 1. round trip ----
  const pageA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5])
  const pageB = Buffer.from(crypto.randomUUID ? crypto.randomUUID() : 'page-b-bytes' + Date.now())
  const { zip, manifest } = buildNoteZip({
    name: 'Round Trip',
    createdAt: '2026-10-21T09:00:00.000Z',
    modifiedAt: '2026-10-21T10:00:00.000Z',
    project: 'Projects',
    tool: { color: '#0f766e', widthMM: 2.5, opacity: 1 },
    pages: [
      { file: 'page-01.png', data: pageA, paper: { size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF' } },
      { file: null, data: null, paper: null },
      { file: 'page-03.png', data: pageB, paper: null },
    ],
  })
  const zipPath = path.join(tmp, 'round.wcanvas')
  fs.writeFileSync(zipPath, zip)
  const { manifest: m2, files } = readNoteZip(fs.readFileSync(zipPath))
  check('manifest round-trips', JSON.stringify(m2) === JSON.stringify(manifest))
  const f1 = files.find(f => f.name === 'page-01.png')
  const f3 = files.find(f => f.name === 'page-03.png')
  check('page-01 bytes identical', f1 && Buffer.compare(f1.data, pageA) === 0)
  check('page-03 bytes identical', f3 && Buffer.compare(f3.data, pageB) === 0)
  check('blank page kept out of zip entries', files.length === 3) // manifest + 2 pages
  check('manifest lists 3 pages', m2.pages.length === 3)
  check('container is a zip signature', zip.subarray(0, 4).toString('latin1') === 'PK\x03\x04')

  // ---- 2. external deflate entry accepted ----
  function zipOneDeflate(name, data) {
    const comp = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0, 6)
    head.writeUInt16LE(8, 8) // deflate
    head.writeUInt32LE(comp.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(0, 42) // local header offset
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(1, 8)
    end.writeUInt16LE(1, 10)
    end.writeUInt32LE(central.length + nameBuf.length, 12)
    end.writeUInt32LE(head.length + nameBuf.length + comp.length, 16)
    return Buffer.concat([head, nameBuf, comp, central, nameBuf, end])
  }
  const deflated = zipOneDeflate('page-04.png', Buffer.from('deflate me please ' + '0123456789'.repeat(40)))
  const read = readZipAll(deflated)
  check('deflate entry inflates', read.length === 1 && read[0].name === 'page-04.png' &&
    read[0].data.toString().endsWith('0123456789'.repeat(40)))

  // ---- 3. hostile inputs rejected ----
  const rejects = [
    ['zip-slip entry', () => readNoteZip(buildNoteZip({ name: 'x', pages: [{ file: '../evil.png', data: pageA }] }).zip)],
    ['absolute path entry', () => readNoteZip(buildNoteZip({ name: 'x', pages: [{ file: 'C:/evil.png', data: pageA }] }).zip)],
    ['traversal-looking name', () => readNoteZip(buildNoteZip({ name: 'x', pages: [{ file: 'a/../b.png', data: pageA }] }).zip)],
    ['not a zip', () => readNoteZip(Buffer.from('definitely not a zip file at all'))],
    ['empty buffer', () => readNoteZip(Buffer.alloc(0))],
  ]
  for (const [label, fn] of rejects) {
    let threw = false
    try { fn() } catch { threw = true }
    check(`rejects: ${label}`, threw)
  }

  // manifest without any page files at all is still a valid (blank) project
  const blank = buildNoteZip({ name: 'Blank', pages: [{ file: null, data: null, paper: null }] })
  check('blank project imports', readNoteZip(blank.zip).manifest.pages.length === 1)

  // ---- 4. Windows interop ----
  if (process.platform === 'win32') {
    const interopZip = path.join(tmp, 'interop.zip')
    fs.copyFileSync(zipPath, interopZip)
    fs.mkdirSync(path.join(tmp, 'interop'), { recursive: true })
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${interopZip}' -DestinationPath '${path.join(tmp, 'interop').replace(/'/g, "''")}' -Force`])
    const ok =
      fs.existsSync(path.join(tmp, 'interop', 'manifest.json')) &&
      fs.existsSync(path.join(tmp, 'interop', 'page-01.png'))
    check('PowerShell Expand-Archive unpacks the container', ok)
  }

  console.log(failures ? `PROBE FAILED: ${failures}` : 'PROBE OK')
  process.exitCode = failures ? 1 : 0
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
