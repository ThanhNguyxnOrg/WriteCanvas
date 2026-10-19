// Byte-level verification of a saved note's Scrble Ink compatibility.
//   node scripts/verify-note.js <path-to-png>
// Checks: PNG structure, expected metadata chunk set, sINK GIF header, and
// re-reading through main/scrble-format (round-trip).

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { parseChunks, pngSize } = require(path.join(root, 'main', 'png-chunks.js'))
const { readNoteMeta, extractInkGif } = require(path.join(root, 'main', 'scrble-format.js'))

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/verify-note.js <file.png>'); process.exit(1) }
const buf = fs.readFileSync(file)

const chunks = parseChunks(buf)
const types = chunks.map(c => c.type)
const requiredMeta = ['sVER', 'sLYT', 'sBKG', 'sCRP', 'sSTD', 'sPNA', 'sBKC', 'sBRL']
const missing = requiredMeta.filter(t => !types.includes(t))
if (missing.length) { console.error('FAIL missing chunks:', missing.join(',')); process.exit(1) }
if (types[0] !== 'IHDR') { console.error('FAIL IHDR not first'); process.exit(1) }
if (types.at(-1) !== 'IEND') { console.error('FAIL IEND not last'); process.exit(1) }

const meta = readNoteMeta(buf)
console.log('meta:', JSON.stringify(meta))
if (meta.version !== 3) { console.error('FAIL sVER != 3'); process.exit(1) }
if (!meta.sizeName) { console.error('FAIL no sSTD size'); process.exit(1) }
if (!/^#[0-9A-Fa-f]{6,8}$/.test(meta.bgColor || '')) { console.error('FAIL bad sBKC color'); process.exit(1) }

const gif = extractInkGif(buf)
console.log('sINK:', gif ? `yes, ${gif.length} bytes, header=${gif.subarray(0, 6).toString('latin1')}` : 'no')
if (gif) {
  if (gif.subarray(0, 6).toString('latin1') !== 'GIF89a') { console.error('FAIL sINK is not GIF89a'); process.exit(1) }
  // 3 blocks minimum: header(6) + LSD(7) => first data block starts at 13 with an INTRODUCTOR 0x21 or 0x2C
  if (gif.length < 14 || ![0x21, 0x2c].includes(gif[13])) { console.error('FAIL sINK GIF structure'); process.exit(1) }
}

const size = pngSize(buf)
console.log('pixels:', size.width + 'x' + size.height)
console.log('VERIFY OK:', file)
