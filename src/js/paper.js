// Paper engine v2 — geometry byte-sampled from the original app's assets
// (docs/research/scrble-feature-inventory.md §3).
// Proof: the original Letter raster is 2500×3235 px for 8.5×11 in → render
// scale 294.12 dpi. Pattern templates draw at asset native scale (asset px ==
// doc px), anchored top-left, and continue across any page size.

export const DOC_DPI = 2500 / 8.5

const PPM = DOC_DPI / 25.4 // px per mm
const IN = inch => Math.round(inch * DOC_DPI)
const MM = mm => Math.round(mm * PPM)

// Page sizes: sSTD names from the original resources (PageSize section).
export const SIZES = {
  letter:  { name: 'Letter',  w: IN(8.5), h: IN(11) },
  legal:   { name: 'Legal',   w: IN(8.5), h: IN(14) },
  tabloid: { name: 'Tabloid', w: IN(11),  h: IN(17) },
  a0: { name: 'A0', w: MM(841), h: MM(1189) },
  a1: { name: 'A1', w: MM(594), h: MM(841) },
  a2: { name: 'A2', w: MM(420), h: MM(594) },
  a3: { name: 'A3', w: MM(297), h: MM(420) },
  a4: { name: 'A4', w: MM(210), h: MM(297) },
  a5: { name: 'A5', w: MM(148), h: MM(210) },
  a6: { name: 'A6', w: MM(105), h: MM(148) },
  a7: { name: 'A7', w: MM(74),  h: MM(105) },
  a8: { name: 'A8', w: MM(52),  h: MM(74) },
}

export const docMM = mm => Math.round(mm * PPM)

export function paperDocSize(size, orientation) {
  const s = SIZES[size] || SIZES.letter
  return orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h }
}

// --- Pattern templates (Assets/Paper/Square/HighRes, 4120×4120 each) ---------
// Colors are the asset RGBA values; alpha mirrors the original so patterns
// blend identically over any paper background color. Geometry in asset px:
// ruled line pitch 55 (= 4.75mm), first line one pitch from the top.

const BLUE = [65, 168, 253]  // #41A8FD, alpha 102 → flattens to #B3DCFE on white
const GRAY = [121, 128, 134] // #797A86, alpha 76

export const TEMPLATES = {
  blank:     { label: 'Blank' },
  ruled:     { label: 'Ruled',     kind: 'h', step: 55, c: BLUE, a: 102 / 255 },
  ruled10:   { label: 'Ruled 10',  kind: 'h', step: 27, c: GRAY, a: 76 / 255 },
  ruled15:   { label: 'Ruled 15',  kind: 'h', step: 41, c: GRAY, a: 76 / 255 },
  ruled20:   { label: 'Ruled 20',  kind: 'h', step: 55, c: GRAY, a: 76 / 255 },
  ruled30:   { label: 'Ruled 30',  kind: 'h', step: 80, c: GRAY, a: 76 / 255 },
  ruled40:   { label: 'Ruled 40',  kind: 'h', step: 110, c: GRAY, a: 76 / 255 },
  dotted10:  { label: 'Dots 10',   kind: 'dots', step: 27, r: 2, off: 1.5, c: [117, 117, 117], a: 76 / 255 },
  dotted20:  { label: 'Dots 20',   kind: 'dots', step: 55, r: 3.8, off: 3.5, c: [121, 121, 121], a: 77 / 255 },
  graph:     { label: 'Graph',     kind: 'grid', step: 7, c: [121, 121, 134], a: 19 / 255, edgeC: [119, 126, 133], edgeA: 75 / 255, from: 0 },
  isometric: { label: 'Isometric', kind: 'iso' },
  math:      { label: 'Math',      kind: 'grid', step: 55, c: BLUE, a: 102 / 255 },
  math10:    { label: 'Math 10',   kind: 'grid', step: 27, c: GRAY, a: 76 / 255 },
  math15:    { label: 'Math 15',   kind: 'grid', step: 41, c: GRAY, a: 76 / 255 },
  math20:    { label: 'Math 20',   kind: 'grid', step: 55, c: GRAY, a: 76 / 255 },
  math30:    { label: 'Math 30',   kind: 'grid', step: 80, c: GRAY, a: 76 / 255 },
  math40:    { label: 'Math 40',   kind: 'grid', step: 110, c: GRAY, a: 76 / 255 },
  music:     { label: 'Music',     kind: 'music', top: 171, pitch: 209, lineStep: 23, lines: 5, c: [155, 155, 155], a: 1 },
  todo:      { label: 'Todo',      kind: 'todo', top: 219, step: 110, boxX: 171, boxDy: 28, boxW: 50, boxH: 54, c: GRAY, a: 76 / 255, boxC: [155, 155, 155], boxA: 1 },
  custom:    { label: 'Custom' },
}

export const TEMPLATE_ORDER = [
  'blank', 'ruled', 'ruled10', 'ruled15', 'ruled20', 'ruled30', 'ruled40',
  'dotted10', 'dotted20', 'graph', 'isometric', 'math', 'math10', 'math15',
  'math20', 'math30', 'math40', 'music', 'todo', 'custom',
]

// Planner papers (Assets/Paper/{Portrait,Landscape}/HighRes, 2500×3235) —
// procedural rendering lands in a later pass; path mapping is already exact.
export const PLANNERS = [
  '5days', '7days', 'daily', 'dailyPlanner', 'fitness', 'habitTracker',
  'homework', 'menuPlanner', 'monthly', 'phone', 'phoneAndNote',
  'projectPlanner', 'tablet', 'tabletAndNote', 'yearly', 'yearlyPlanner',
]

// Border lines: two full-height verticals, opaque #C4728D (matches the real
// note's flattened margin color + geometry: spans [119,120] / [w−121,w−120]).
const BORDER_X = 119
const BORDER_C = [196, 114, 141]

const css = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

// True when a paper ARGB/RGB colour is dark enough that the ink-side pattern
// should flip from graphite/blue to a faint light mesh (pad.ws dark board).
export function isDarkPaperColor(argb) {
  const hex = hexToCss(argb, '#FFFFFF').replace('#', '')
  if (hex.length !== 6) return false
  const r = parseInt(hex.slice(0, 2), 16) || 0
  const g = parseInt(hex.slice(2, 4), 16) || 0
  const b = parseInt(hex.slice(4, 6), 16) || 0
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.42
}

// Paint the paper background + template pattern at document resolution.
// `transparent` skips the background fill (save-without-background export).
export function renderPaper(ctx, paper, { transparent = false } = {}) {
  const { w, h } = paperDocSize(paper.size, paper.orientation)
  const dark = isDarkPaperColor(paper.bg)
  ctx.save()
  if (transparent) ctx.clearRect(0, 0, w, h)
  else {
    ctx.fillStyle = hexToCss(paper.bg, '#FFFFFF')
    ctx.fillRect(0, 0, w, h)
  }

  const t = TEMPLATES[paper.template]
  if (paper.template === 'custom' && paper.customImage && paper.customImage.naturalWidth) {
    const iw = paper.customImage.naturalWidth, ih = paper.customImage.naturalHeight
    const s = Math.max(w / iw, h / ih)
    ctx.drawImage(paper.customImage, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s)
  } else if (t && t.kind) {
    drawTemplate(ctx, t, w, h, dark)
  }

  // Border lines (sBRL): two full-height verticals. On a dark board they read
  // as a soft rose guide instead of disappearing into the navy-black paper.
  if (paper.borderLines !== false) {
    ctx.fillStyle = dark ? 'rgba(255, 178, 201, 0.58)' : css(BORDER_C, 1)
    ctx.fillRect(BORDER_X, 0, 2, h)
    ctx.fillRect(w - BORDER_X - 2, 0, 2, h)
  }
  ctx.restore()
}

function drawTemplate(ctx, t, w, h, dark = false) {
  // Asset truth: pattern lines are 2 px tall, centered on the pitch multiple
  // (ruled.png rows [54,55] for pitch 55 → fillRect at k·pitch − 1).
  const light = 'rgba(232,238,248,0.16)'
  const lightSoft = 'rgba(232,238,248,0.10)'
  const lightStrong = 'rgba(232,238,248,0.28)'
  if (t.kind === 'h') {
    ctx.fillStyle = dark ? light : css(t.c, t.a)
    for (let y = t.step; y < h; y += t.step) ctx.fillRect(0, y - 1, w, 2)
  } else if (t.kind === 'grid') {
    const from = t.edgeC ? t.step : (t.from || t.step)
    if (t.edgeC) {
      // graph.png: opaque-ish 1px edge lines at x/y 0 + faint 2px interior mesh
      ctx.fillStyle = dark ? lightStrong : css(t.edgeC, t.edgeA)
      ctx.fillRect(0, 0, w, 1)
      ctx.fillRect(0, 0, 1, h)
      ctx.fillStyle = dark ? lightSoft : css(t.c, t.a)
    } else ctx.fillStyle = dark ? light : css(t.c, t.a)
    for (let y = from; y < h; y += t.step) ctx.fillRect(0, y - 1, w, 2)
    for (let x = from; x < w; x += t.step) ctx.fillRect(x - 1, 0, 2, h)
  } else if (t.kind === 'dots') {
    // asset dots are 4px (dots10) / 8px (dots20) antialiased discs with core
    // alpha ~0.3; arc from the dot's top-left lattice position
    ctx.fillStyle = dark ? 'rgba(232,238,248,0.30)' : css(t.c, t.a)
    for (let y = t.step - 2; y < h; y += t.step)
      for (let x = t.step - 2; x < w; x += t.step) {
        ctx.beginPath(); ctx.arc(x + t.off, y + t.off, t.r, 0, Math.PI * 2); ctx.fill()
      }
  } else if (t.kind === 'iso') {
    // single-tier isometric mesh: ±30° diagonals, horizontal intercept pitch
    // 38, plus pale blue full-height verticals every 37.6 px offset 19, and a
    // sparser stronger blue family (2 px) every 188 px offset 189
    const s = Math.tan(Math.PI / 6), p = 38, limit = h / s
    ctx.lineWidth = 2
    ctx.strokeStyle = dark ? 'rgba(225,233,245,0.11)' : 'rgba(114,124,132,0.106)'
    ctx.beginPath()
    for (let k = -Math.ceil(limit / p); k <= Math.ceil(w / p); k++) {
      ctx.moveTo(k * p, 0); ctx.lineTo(k * p + limit, h)
      ctx.moveTo(k * p, 0); ctx.lineTo(k * p - limit, h)
    }
    ctx.stroke()
    ctx.fillStyle = dark ? 'rgba(122,180,255,0.10)' : 'rgba(59,167,255,0.058)'
    for (let x = 19; x < w; x += 37.6) ctx.fillRect(Math.round(x), 0, 1, h)
    ctx.fillStyle = dark ? 'rgba(122,180,255,0.28)' : 'rgba(59,167,255,0.21)'
    for (let x = 189; x < w; x += 188) ctx.fillRect(Math.round(x), 0, 2, h)
  } else if (t.kind === 'music') {
    ctx.fillStyle = dark ? 'rgba(232,238,248,0.50)' : css(t.c, t.a)
    for (let top = t.top; top < h; top += t.pitch)
      for (let i = 0; i < t.lines; i++) ctx.fillRect(0, top + i * t.lineStep - 1, w, 2)
  } else if (t.kind === 'todo') {
    ctx.fillStyle = dark ? light : css(t.c, t.a)
    for (let y = t.top; y < h; y += t.step) {
      ctx.fillRect(0, y - 1, w, 2)
      // checkbox outline in the left column, hanging below the row line
      ctx.fillStyle = dark ? 'rgba(232,238,248,0.34)' : css(t.boxC, t.boxA)
      ctx.fillRect(t.boxX, y + t.boxDy, t.boxW, 2)
      ctx.fillRect(t.boxX, y + t.boxDy + t.boxH - 2, t.boxW, 2)
      ctx.fillRect(t.boxX, y + t.boxDy, 2, t.boxH)
      ctx.fillRect(t.boxX + t.boxW - 2, y + t.boxDy, 2, t.boxH)
      ctx.fillStyle = dark ? light : css(t.c, t.a)
    }
  }
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

// original-style sPNA asset path so notes round-trip into Scrble Ink with the
// same paper; pattern papers live under Square/ regardless of orientation
export function templatePathFor(template, orientation) {
  if (!template || template === 'blank' || template === 'custom') return ''
  if (PLANNERS.includes(template)) {
    const L = orientation === 'landscape' ? 'Landscape' : 'Portrait'
    return `/Assets/Paper/${L}/HighRes/${template}.png`
  }
  return `/Assets/Paper/Square/HighRes/${template}.png`
}
