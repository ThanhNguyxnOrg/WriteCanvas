// Paper engine. Sizes are mm; the document render scale matches the original
// app: 3 × 96 dpi (see docs/ANALYSIS.md §3 — original note = 2500×3235 px at
// pHYs 3779 ppm for "Letter").

export const SCALE = 3
export const BASE_DPI = 96
export const DOC_DPI = BASE_DPI * SCALE

export const SIZES = {
  letter: { w: 216, h: 279, name: 'Letter' },
  a4: { w: 210, h: 297, name: 'A4' },
  a5: { w: 148, h: 210, name: 'A5' },
  square: { w: 200, h: 200, name: 'Square' },
}

export const TEMPLATES = ['ruled', 'grid', 'dotted', 'graph', 'black', 'blank']

export const docMM = mm => Math.round((mm / 25.4) * DOC_DPI)

export function paperDocSize(size, orientation) {
  const s = SIZES[size] || SIZES.letter
  const w = docMM(s.w), h = docMM(s.h)
  return orientation === 'landscape' ? { w: h, h: w } : { w, h }
}

// Paint the paper background + template pattern at document resolution.
export function renderPaper(ctx, paper) {
  const { w, h } = paperDocSize(paper.size, paper.orientation)
  ctx.save()
  ctx.clearRect(0, 0, w, h)
  // background
  ctx.fillStyle = paper.template === 'black' ? '#1c1c1e' : (hexToCss(paper.bg, '#FFFFFF'))
  ctx.fillRect(0, 0, w, h)

  const tpl = paper.template
  if (tpl === 'ruled') {
    ctx.strokeStyle = 'rgba(120,163,208,0.55)'
    ctx.lineWidth = Math.max(1, docMM(0.22))
    const step = docMM(8)
    for (let y = step; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(235,140,180,0.8)'
    ctx.lineWidth = Math.max(1, docMM(0.3))
    const mx = docMM(24)
    ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, h); ctx.stroke()
  } else if (tpl === 'grid') {
    ctx.strokeStyle = 'rgba(120,163,208,0.5)'
    ctx.lineWidth = Math.max(1, docMM(0.2))
    const step = docMM(10)
    for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  } else if (tpl === 'dotted') {
    ctx.fillStyle = 'rgba(120,163,208,0.8)'
    const step = docMM(5)
    const r = Math.max(1.2, docMM(0.35))
    for (let y = step; y < h; y += step)
      for (let x = step; x < w; x += step) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      }
  } else if (tpl === 'graph') {
    ctx.strokeStyle = 'rgba(120,163,208,0.35)'
    ctx.lineWidth = Math.max(1, docMM(0.18))
    const sub = docMM(2)
    for (let x = sub; x < w; x += sub) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = sub; y < h; y += sub) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
    ctx.strokeStyle = 'rgba(120,163,208,0.7)'
    ctx.lineWidth = Math.max(1, docMM(0.3))
    const step = docMM(10)
    for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  }
  ctx.restore()
}

export function hexToCss(argb, fallback) {
  if (!argb) return fallback
  let s = String(argb).trim()
  if (s[0] === '#') s = s.slice(1)
  // original stores ARGB (#AARRGGBB); css wants #RRGGBB
  if (s.length === 8) s = s.slice(2)
  if (s.length !== 6) return fallback
  return '#' + s
}

// original-style sPNA path so notes re-open in Scrble Ink correctly
export function templatePathFor(template, orientation) {
  if (!template || template === 'blank') return ''
  const L = orientation === 'landscape' ? 'Landscape' : 'Portrait'
  const map = { ruled: 'ruled', grid: 'grid', dotted: 'dotted', graph: 'mathpaper', black: 'black' }
  return `/Assets/Paper/${L}/HighRes/${map[template] || 'ruled'}.png`
}
