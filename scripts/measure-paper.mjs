// Measure paper template geometry from the original app's PNG assets.
// Usage: node scripts/measure-paper.mjs <dir-or-file> [more...]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

// ---------- minimal PNG decoder (8-bit, non-interlaced) ----------
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not PNG')
  let off = 8
  let ihdr = null
  let plte = null
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'PLTE') plte = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.interlace !== 0) throw new Error('unsupported PNG variant')
  const { w, h, colorType } = ihdr
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 3 ? 1 : 1
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(stride)
  let cur = Buffer.alloc(stride)
  let p = 0
  const paeth = (a, b, c) => {
    const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]
    for (let i = 0; i < stride; i++) {
      const x = i >= ch ? cur[i - ch] : 0
      const up = prev[i]
      const ul = i >= ch ? prev[i - ch] : 0
      let v = raw[p++]
      if (ft === 1) v += x
      else if (ft === 2) v += up
      else if (ft === 3) v += (x + up) >> 1
      else if (ft === 4) v += paeth(x, up, ul)
      cur[i] = v & 0xff
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (colorType === 6) {
        out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]
      } else if (colorType === 2) {
        out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255
      } else if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = cur[x * 2]; out[o + 3] = cur[x * 2 + 1]
      } else if (colorType === 3) {
        const idx = cur[x] * 3
        out[o] = plte[idx]; out[o + 1] = plte[idx + 1]; out[o + 2] = plte[idx + 2]; out[o + 3] = 255
      }
    }
    const t = prev; prev = cur; cur = t
  }
  return { w, h, data: out }
}

// ---------- structure analysis ----------
function segments(hitFn, n) {
  const segs = []
  let s = -1
  for (let i = 0; i < n; i++) {
    if (hitFn(i)) { if (s < 0) s = i }
    else if (s >= 0) { segs.push([s, i - 1]); s = -1 }
  }
  if (s >= 0) segs.push([s, n - 1])
  return segs
}

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function summarize(segs, px, colorAt) {
  if (!segs.length) return 'none'
  const centers = segs.map(([a, b]) => Math.round((a + b) / 2))
  const diffs = centers.slice(1).map((c, i) => c - centers[i])
  const th = segs.map(([a, b]) => b - a + 1)
  const [r, g, b, al] = colorAt(centers[0])
  return `n=${segs.length} sp=${median(diffs)} th=${median(th)} first=${centers[0]} last=${centers[centers.length - 1]} head=[${centers.slice(0, 6)}] c=rgb(${r},${g},${b},${al})`
}

function analyze(file) {
  const { w, h, data } = decodePNG(readFileSync(file))
  const at = (x, y) => {
    const o = (y * w + x) * 4
    return [data[o], data[o + 1], data[o + 2], data[o + 3]]
  }
  const dark = (x, y) => {
    const [r, g, b, a] = at(x, y)
    return a > 0 && (r < 235 || g < 235 || b < 235)
  }
  const parts = [`${file.split(/[\\/]/).pop()} ${w}x${h}`]
  for (const fx of [0.25, 0.5, 0.75]) {
    const x = Math.min(w - 1, Math.round(w * fx))
    const segs = segments(y => dark(x, y), h)
    parts.push(`col@${x}: ` + summarize(segs, data, yy => at(x, yy)))
  }
  {
    const y = Math.round(h * 0.5)
    const segs = segments(xx => dark(xx, y), w)
    parts.push(`row@${y}: ` + summarize(segs, data, xx => at(xx, y)))
  }
  {
    // full-height vertical structures (margin lines, grid columns)
    const need = Math.ceil((h / 8) * 0.92)
    const segs = segments(x => {
      let c = 0
      for (let y = 0; y < h; y += 8) if (dark(x, y)) c++
      return c >= need
    }, w)
    parts.push('vfull: ' + summarize(segs, data, xx => at(xx, Math.round(h * 0.5))))
  }
  if (parts.filter(p => /col@\d+: none/.test(p)).length >= 3) {
    // sparse-dot fallback: block scan
    const y0 = Math.max(0, Math.round(h * 0.5) - 200)
    const rowHits = []
    let dotColor = null
    for (let k = 0; k < 400 && y0 + k < h; k++) {
      let any = false
      for (let x = 0; x < w; x += 2) if (dark(x, y0 + k)) { any = true; if (!dotColor) dotColor = at(x, y0 + k); break }
      rowHits.push(any)
    }
    const rsegs = segments(i => rowHits[i], rowHits.length)
    if (rsegs.length > 1) {
      const pitch = rsegs.slice(1).map((s, i) => s[0] - rsegs[i][0])
      parts.push(`dotrows: n=${rsegs.length} pitch=${median(pitch)} th=${median(rsegs.map(([a, b]) => b - a + 1))} first=${rsegs[0][0]} c=${dotColor}`)
    } else parts.push('dotrows: none')
    const x0 = Math.max(0, Math.round(w * 0.5) - 200)
    const colHits = []
    for (let k = 0; k < 400 && x0 + k < w; k++) {
      let any = false
      for (let y = 0; y < h; y += 2) if (dark(x0 + k, y)) { any = true; break }
      colHits.push(any)
    }
    const csegs = segments(i => colHits[i], colHits.length)
    if (csegs.length > 1) {
      const pitch = csegs.slice(1).map((s, i) => s[0] - csegs[i][0])
      parts.push(`dotcols: n=${csegs.length} pitch=${median(pitch)} first=${csegs[0][0]}`)
    } else parts.push('dotcols: none')
  }
  console.log(parts.join(' | '))
}

const args = process.argv.slice(2)
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  for (const a of args) {
    const st = statSync(a)
    if (st.isDirectory()) {
      if (a.includes('HighRes')) {
        for (const f of readdirSync(a).filter(f => f.endsWith('.png')).sort()) analyze(join(a, f))
      } else {
        for (const f of readdirSync(a).filter(f => f.endsWith('.png')).sort()) {
          const { w, h } = decodePNG(readFileSync(join(a, f)))
          console.log(`${a.split(/[\\/]/).pop()}/${f} ${w}x${h}`)
        }
      }
    } else analyze(a)
  }
}
