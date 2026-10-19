// Dump all strings (UTF-16LE + ASCII) within byte ranges of a file, for context reading.
// Usage: node scripts/dump-range.mjs <file> <startHex> <endHex> [...more ranges]
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const buf = readFileSync(file)
const ranges = []
for (let i = 3; i + 1 < process.argv.length; i += 2) {
  ranges.push([parseInt(process.argv[i], 16), parseInt(process.argv[i + 1], 16)])
}

function isPrintable(c) {
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0x17f)
}

for (const [start, end] of ranges) {
  console.log(`===== range 0x${start.toString(16)} - 0x${end.toString(16)} =====`)
  let s = ''
  let startOff = -1
  for (let i = start; i + 1 < Math.min(end, buf.length); i += 2) {
    const c = buf[i] | (buf[i + 1] << 8)
    if (isPrintable(c)) {
      if (startOff < 0) startOff = i
      s += String.fromCharCode(c)
    } else if (startOff >= 0) {
      if (s.trim().length >= 2) console.log(`0x${startOff.toString(16)}: ${s}`)
      s = ''
      startOff = -1
    }
  }
}
