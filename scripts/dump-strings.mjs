// Extract UTF-16LE + ASCII strings from a binary and filter by keyword.
// Usage: node scripts/dump-strings.mjs <file> [more files...]
import { readFileSync } from 'node:fs'

const KEYWORDS = [
  'pen', 'pencil', 'highlight', 'marker', 'ballpoint', 'crayon', 'calligraph',
  'brush', 'fountain', 'gel', 'eraser', 'laser', 'ruler', 'lasso', 'shape',
  'text', 'color', 'colour', 'palette', 'paper', 'ruled', 'dotted', 'graph',
  'isometric', 'math', 'music', 'todo', 'blank', 'custom', 'planner', 'daily',
  'weekly', 'monthly', 'yearly', 'fitness', 'habit', 'homework', 'menu',
  'project', 'phone', 'tablet', 'letter', 'legal', 'tabloid', 'executive',
  'postcard', 'a3', 'a4', 'a5', 'a6', 'b4', 'b5', 'square', 'portrait',
  'landscape', 'width', 'opacity', 'pressure', 'size', 'margin', 'black',
  'background', 'replay', 'export', 'print', 'camera', 'picture', 'photo',
  'recognize', 'handwriting', 'assets', 'flyout', 'zoom', 'insert',
]
const KW_LOWER = KEYWORDS.map(k => k.toLowerCase())

function isPrintable(c) {
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0x17f)
}

function utf16Strings(buf) {
  const out = []
  let s = ''
  let start = -1
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8)
    if (isPrintable(c)) {
      if (start < 0) start = i
      s += String.fromCharCode(c)
    } else if (start >= 0) {
      if (s.length >= 3) out.push([start, s])
      s = ''
      start = -1
    }
  }
  return out
}

function asciiStrings(buf) {
  const out = []
  let s = ''
  let start = -1
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (c >= 0x20 && c <= 0x7e) {
      if (start < 0) start = i
      s += String.fromCharCode(c)
    } else if (start >= 0) {
      if (s.length >= 4) out.push([start, s])
      s = ''
      start = -1
    }
  }
  return out
}

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file)
  console.log(`##### ${file} (${buf.length} bytes)`)
  const all = [
    ...utf16Strings(buf).map(([o, s]) => ['u16', o, s]),
    ...asciiStrings(buf).map(([o, s]) => ['asc', o, s]),
  ]
  const seen = new Set()
  let count = 0
  for (const [kind, off, s] of all) {
    if (s.length > 150) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const low = s.toLowerCase()
    if (!KW_LOWER.some(k => low.includes(k))) continue
    console.log(`${kind}@0x${off.toString(16)}: ${s}`)
    if (++count > 4000) {
      console.log('... (capped at 4000)')
      break
    }
  }
  console.log(`##### ${file}: ${count} matches`)
}
