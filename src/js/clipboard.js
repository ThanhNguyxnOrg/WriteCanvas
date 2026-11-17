// Clipboard interop: the payload WriteCanvas puts on the OS clipboard and the
// pure helpers behind pasted pictures and pasted text. No DOM access here, so
// the unit suite can drive every rule without an Electron window.

export const PAYLOAD_TYPE = 'writecanvas-objects'
// v1 carried strokes, v2 added texts, v3 adds pictures. The format only ever
// grows: an older payload still pastes, and a newer one carries fields an older
// build filters out before use instead of failing.
export const PAYLOAD_VERSION = 3

// A picture lives on a page as { x, y, w, h, data, img }: the box in document
// pixels, the PNG (or JPEG) data URL that is saved, and the decoded element the
// canvas draws. Only the plain fields travel in a payload or in a saved sVec
// chunk — `img` is a session field.
export const MAX_PAGE_IMAGES = 40
// One picture's data URL. A page-scaled screenshot lands far below this; the
// cap only stops a hostile or absurd payload from riding into a save.
export const MAX_IMAGE_DATA_CHARS = 32 * 1024 * 1024
// Above this a pasted picture is stored as JPEG instead of PNG: a large
// photographic paste re-encoded losslessly would bloat every later save.
export const JPEG_FALLBACK_CHARS = 8 * 1024 * 1024
// Every picture on a page travels inside one saved sVec, and main refuses a
// vector snapshot above 64 MB, so a page stops taking pictures long before
// that. The budget is the same as one picture's cap, so a picture that is valid
// at all always fits on an empty page, and normal use (a handful of
// screenshots) never comes near it.
export const MAX_PAGE_IMAGE_CHARS = 32 * 1024 * 1024
export const MAX_PASTE_TEXT_CHARS = 20000

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i

export function validImageObject(o) {
  return !!o &&
    Number.isFinite(o.x) && Number.isFinite(o.y) &&
    Number.isFinite(o.w) && Number.isFinite(o.h) &&
    o.w > 0 && o.h > 0 &&
    typeof o.data === 'string' &&
    IMAGE_DATA_URL.test(o.data) &&
    o.data.length <= MAX_IMAGE_DATA_CHARS
}

// The saved shape of a picture: everything the page needs to draw it again.
export function serializeImageObject(o) {
  return { x: o.x, y: o.y, w: o.w, h: o.h, data: o.data }
}

// How many characters of picture data a page already carries: the length of the
// data URLs it would write into sVec.
export function pageImageChars(images) {
  let n = 0
  for (const o of images || []) {
    if (o && typeof o.data === 'string') n += o.data.length
  }
  return n
}

// The part of `list` that still fits on a page holding `images`: the per-page
// picture cap and the character budget together, stopping at the first picture
// that would not fit. The caller shows a reason when something was dropped;
// nothing here mutates the page.
export function fitPageImages(images, list) {
  const room = Math.max(0, MAX_PAGE_IMAGES - (images || []).length)
  let budget = MAX_PAGE_IMAGE_CHARS - pageImageChars(images)
  const keep = []
  for (const o of list || []) {
    const len = o && typeof o.data === 'string' ? o.data.length : Infinity
    if (keep.length >= room || len > budget) break
    budget -= len
    keep.push(o)
  }
  return keep
}

// The copy payload is plain JSON text, so a copy survives a restart, a note
// switch and a second WriteCanvas window. It rides next to a picture flavour on
// the clipboard: other apps take the picture, WriteCanvas takes this.
export function buildPayload({ strokes = [], texts = [], images = [] } = {}) {
  return JSON.stringify({
    type: PAYLOAD_TYPE,
    version: PAYLOAD_VERSION,
    objects: strokes,
    texts,
    images: images.map(serializeImageObject),
  })
}

// Read a payload back. Returns null for anything that is not ours, so the
// caller can fall through to a picture or to plain text on the clipboard.
export function parsePayload(text, { validStroke, validText } = {}) {
  if (typeof text !== 'string' || text[0] !== '{') return null
  let parsed = null
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || parsed.type !== PAYLOAD_TYPE || !Array.isArray(parsed.objects)) return null
  const keep = (list, check) => {
    if (!Array.isArray(list)) return []
    const ok = typeof check === 'function' ? check : () => true
    return list.filter(ok).map(o => JSON.parse(JSON.stringify(o)))
  }
  const strokes = keep(parsed.objects, validStroke)
  const texts = keep(parsed.texts, validText)
  const images = keep(parsed.images, validImageObject)
    .map(serializeImageObject)
    .slice(0, MAX_PAGE_IMAGES)
  return (strokes.length || texts.length || images.length) ? { strokes, texts, images } : null
}

// Centre a pasted picture on a point, never enlarging it, keeping its aspect
// ratio and staying inside the box it is given (the caller passes the page).
export function fitImageBox(w, h, maxW, maxH, cx = 0, cy = 0) {
  if (!(w > 0) || !(h > 0) || !(maxW > 0) || !(maxH > 0)) return null
  const s = Math.min(1, maxW / w, maxH / h)
  const bw = Math.max(1, Math.round(w * s))
  const bh = Math.max(1, Math.round(h * s))
  return { x: Math.round(cx - bw / 2), y: Math.round(cy - bh / 2), w: bw, h: bh }
}

// Wrap pasted text to a width, measuring with the caller's own font (the same
// one the page draws the box with). A word too long for a line is hard-broken
// rather than left to run off the page.
export function wrapTextToWidth(text, measure, maxWidth) {
  if (typeof measure !== 'function' || !(maxWidth > 0)) return String(text == null ? '' : text)
  const lines = []
  for (const raw of String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = ''
    for (let word of words) {
      while (word.length > 1 && measure(word) > maxWidth) {
        let cut = word.length - 1
        while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) cut--
        if (line) { lines.push(line); line = '' }
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const probe = line ? `${line} ${word}` : word
      if (line && measure(probe) > maxWidth) { lines.push(line); line = word }
      else line = probe
    }
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

// Whether a copied file looks like a picture the app can read. Used when the
// clipboard carries a file list (a picture copied in the file manager) instead
// of a bitmap.
export function imageFileName(name) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(name || ''))
}

// ---------- reading a picture off the OS clipboard ----------
// The clipboard shape differs by runtime and by OS, so the reader takes a
// `host`: the Electron side passes the real clipboard/nativeImage calls, the
// unit suite passes fakes. What lives here — and is therefore testable — is the
// order a paste tries its sources in and the guards on what it accepts. Every
// host call is best-effort: one that throws or answers nothing moves the reader
// on rather than failing the paste.

// One picture file read off the clipboard must really be a picture (the app can
// only decode the formats imageFileName names) and must not be absurdly large.
export const MAX_CLIPBOARD_FILE = 48 * 1024 * 1024

export function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

export function decodeClipboardText(bytes) {
  const u8 = toBytes(bytes)
  return u8 ? new TextDecoder().decode(u8) : ''
}

// Windows' file list: FileNameW is the Unicode flavour (UCS-2, little endian),
// FileName the ANSI one older apps still write. Both are NUL-separated, with a
// trailing NUL, and a stray empty entry must not become a file named "".
export function parseClipboardFileList(bytes, wide) {
  const u8 = toBytes(bytes)
  if (!u8 || !u8.length) return []
  let text = ''
  if (wide) {
    for (let i = 0; i + 1 < u8.length; i += 2) text += String.fromCharCode(u8[i] | (u8[i + 1] << 8))
  } else {
    for (let i = 0; i < u8.length; i++) text += String.fromCharCode(u8[i])
  }
  return text.split('\0').map(s => s.trim()).filter(Boolean)
}

// The first MIME type an item offers that matches, or '' — the item clipboard
// lists its flavours per item and the app only takes the ones it can use.
export function firstImageType(types) {
  if (!Array.isArray(types)) return ''
  for (const t of types) if (typeof t === 'string' && /^image\//i.test(t)) return t
  return ''
}

export function firstUriListType(types) {
  if (!Array.isArray(types)) return ''
  for (const t of types) if (typeof t === 'string' && /^text\/uri-list$/i.test(t)) return t
  return ''
}

// A text/uri-list names files as file:// URIs, one per line; lines starting
// with # are comments. `toPath` turns one into a local path (the host uses
// fileURLToPath); an entry that cannot become a path is skipped.
export function parseUriListFiles(list, toPath) {
  if (typeof list !== 'string' || typeof toPath !== 'function') return []
  const out = []
  for (const line of list.split(/\r?\n/)) {
    const uri = line.trim()
    if (!uri || uri[0] === '#') continue
    try {
      const file = toPath(uri)
      if (file) out.push(file)
    } catch { /* not a file URI */ }
  }
  return out
}

// Best-effort: a clipboard call that throws, or answers nothing, is simply the
// source not being on the clipboard.
async function safe(fn) {
  try { return await fn() } catch { return null }
}

function isPictureShape(pic) {
  return !!pic && typeof pic.dataUrl === 'string' && pic.dataUrl.startsWith('data:image/')
}

// A picture file the person copied somewhere, handed over as a data URL. Only
// extensions the app can decode, only files that really are files, and only
// within the size cap.
async function pictureFromFile(host, file) {
  if (!imageFileName(file)) return null
  const size = await safe(() => host.fileSize(file))
  if (typeof size !== 'number' || size < 0 || size > MAX_CLIPBOARD_FILE) return null
  const pic = await safe(() => host.imageFromFile(file))
  if (!isPictureShape(pic)) return null
  return { dataUrl: pic.dataUrl, width: pic.width, height: pic.height, source: 'file' }
}

// What another app put on the clipboard as a picture: a screenshot bitmap
// (Snipping Tool, Win+Shift+S) or a picture file copied in the file manager.
// A data URL comes back so the renderer pastes it without a read permission.
//
// `host` supplies what only the platform can do:
//   platform              'win32' | 'darwin' | 'linux'
//   readBitmap()          -> { dataUrl, width, height } | null   (classic shape)
//   readBuffer(format)    -> bytes | null                        (classic shape)
//   readItems()           -> Promise<items | null>               (item shape)
//   getItemBytes(item, t) -> Promise<bytes | null>               (item shape)
//   imageFromBytes(bytes) -> { dataUrl, width, height } | null
//   imageFromFile(path)   -> { dataUrl, width, height } | null
//   fileSize(path)        -> Promise<number | null>
//   toPath(uri)           -> local path (throws for a foreign URI)
export async function readClipboardPicture(host) {
  if (!host) return null
  // 1. The classic clipboard's image flavour: a screenshot, or a picture copied
  //    in a browser.
  const bitmap = await safe(() => host.readBitmap())
  if (isPictureShape(bitmap)) {
    return { dataUrl: bitmap.dataUrl, width: bitmap.width, height: bitmap.height, source: 'bitmap' }
  }
  // 2. A picture file copied in Explorer: the classic clipboard exposes the
  //    Windows file list. The item shape carries the same list as a
  //    text/uri-list instead (step 3), which also works on macOS and Linux.
  if (host.platform === 'win32' && typeof host.readBuffer === 'function') {
    for (const [format, wide] of [['FileNameW', true], ['FileName', false]]) {
      const files = parseClipboardFileList(await safe(() => host.readBuffer(format)), wide)
      for (const file of files) {
        const pic = await pictureFromFile(host, file)
        if (pic) return pic
      }
    }
  }
  // 3. The promise-based item clipboard: an image item first, then the
  //    file list as text/uri-list.
  if (typeof host.readItems !== 'function') return null
  const items = await safe(() => host.readItems())
  if (!Array.isArray(items)) return null
  for (const item of items) {
    const type = firstImageType(item && item.types)
    if (!type) continue
    const bytes = await safe(() => host.getItemBytes(item, type))
    if (!bytes || !bytes.length) continue
    const pic = await safe(() => host.imageFromBytes(bytes))
    if (isPictureShape(pic)) {
      return { dataUrl: pic.dataUrl, width: pic.width, height: pic.height, source: 'bitmap' }
    }
  }
  for (const item of items) {
    const type = firstUriListType(item && item.types)
    if (!type) continue
    const bytes = await safe(() => host.getItemBytes(item, type))
    if (!bytes || !bytes.length) continue
    const list = await safe(() => decodeClipboardText(bytes))
    for (const file of parseUriListFiles(list, host.toPath)) {
      const pic = await pictureFromFile(host, file)
      if (pic) return pic
    }
  }
  return null
}
