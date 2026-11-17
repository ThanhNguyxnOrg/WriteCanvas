// The clipboard contract: what a copy writes and what a paste accepts.
//
// These rules decide whether a copy survives a restart, whether a payload from
// another app is ignored instead of pasted as garbage, and how a pasted picture
// is scaled onto the page — so they are worth pinning down without an Electron
// window.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPayload,
  parsePayload,
  validImageObject,
  serializeImageObject,
  pageImageChars,
  fitPageImages,
  fitImageBox,
  wrapTextToWidth,
  imageFileName,
  parseClipboardFileList,
  parseUriListFiles,
  firstImageType,
  firstUriListType,
  decodeClipboardText,
  readClipboardPicture,
  MAX_IMAGE_DATA_CHARS,
  MAX_PAGE_IMAGES,
  MAX_PAGE_IMAGE_CHARS,
  MAX_CLIPBOARD_FILE,
} from '../src/js/clipboard.js'

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo='
const stroke = { type: 'marker', color: '#000000', width: 12, pts: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }
const text = { txt: 'hello', x: 10, y: 20, size: 55, color: '#111111' }
const picture = { x: 0, y: 0, w: 100, h: 50, data: PNG_URL }

const validStroke = s => !!s && Array.isArray(s.pts) && s.pts.length > 0
const validText = t => !!t && typeof t.txt === 'string' && t.txt.length > 0

describe('clipboard payload', () => {
  it('round-trips strokes, texts and pictures', () => {
    const payload = buildPayload({ strokes: [stroke], texts: [text], images: [picture] })
    const back = parsePayload(payload, { validStroke, validText })
    assert.deepEqual(back.strokes, [stroke])
    assert.deepEqual(back.texts, [text])
    assert.deepEqual(back.images, [picture])
  })

  it('never carries the decoded element, only the saved fields', () => {
    const withImg = { ...picture, img: { naturalWidth: 100 } }
    const back = parsePayload(buildPayload({ images: [withImg] }), {})
    assert.deepEqual(back.images, [picture])
    assert.deepEqual(serializeImageObject(withImg), picture)
  })

  it('still reads a v1 payload that only carried strokes', () => {
    const v1 = JSON.stringify({ type: 'writecanvas-objects', version: 1, objects: [stroke] })
    const back = parsePayload(v1, { validStroke, validText })
    assert.deepEqual(back.strokes, [stroke])
    assert.deepEqual(back.texts, [])
    assert.deepEqual(back.images, [])
  })

  it('ignores anything that is not a WriteCanvas payload', () => {
    assert.equal(parsePayload('hello world', { validStroke, validText }), null)
    assert.equal(parsePayload('{"type":"other","objects":[]}', { validStroke, validText }), null)
    assert.equal(parsePayload('{"type":"writecanvas-objects","objects":[]}', { validStroke, validText }), null)
    assert.equal(parsePayload('{not json', { validStroke, validText }), null)
    assert.equal(parsePayload('', { validStroke, validText }), null)
    assert.equal(parsePayload(null, { validStroke, validText }), null)
  })

  it('drops objects a page could not render instead of failing the paste', () => {
    const payload = JSON.stringify({
      type: 'writecanvas-objects',
      version: 3,
      objects: [stroke, { pts: [] }],
      texts: [text, { txt: '' }],
      images: [picture, { x: 0, y: 0, w: 10, h: 10 }],
    })
    const back = parsePayload(payload, { validStroke, validText })
    assert.deepEqual(back.strokes, [stroke])
    assert.deepEqual(back.texts, [text])
    assert.deepEqual(back.images, [picture])
  })

  it('caps how many pictures one payload can carry', () => {
    const images = Array.from({ length: MAX_PAGE_IMAGES + 5 }, () => ({ ...picture }))
    const back = parsePayload(buildPayload({ strokes: [stroke], images }), { validStroke, validText })
    assert.equal(back.images.length, MAX_PAGE_IMAGES)
  })
})

describe('picture objects', () => {
  it('accepts a box with a picture data URL', () => {
    assert.equal(validImageObject(picture), true)
  })

  it('rejects a box with no picture, no size or a foreign URL', () => {
    assert.equal(validImageObject(null), false)
    assert.equal(validImageObject({ ...picture, data: '' }), false)
    assert.equal(validImageObject({ ...picture, data: 'https://example.com/a.png' }), false)
    assert.equal(validImageObject({ ...picture, w: 0 }), false)
    assert.equal(validImageObject({ ...picture, y: NaN }), false)
  })

  it('rejects a payload picture larger than the save cap', () => {
    const huge = { ...picture, data: 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_DATA_CHARS) }
    assert.equal(validImageObject(huge), false)
  })
})

describe('fitting a pasted picture onto a page', () => {
  it('centres the picture and keeps its aspect ratio', () => {
    const box = fitImageBox(1000, 500, 800, 800, 500, 400)
    assert.deepEqual(box, { x: 100, y: 200, w: 800, h: 400 })
  })

  it('never enlarges a small picture', () => {
    const box = fitImageBox(60, 40, 800, 800, 100, 100)
    assert.deepEqual(box, { x: 70, y: 80, w: 60, h: 40 })
  })

  it('fits the tall side when the height is the tighter bound', () => {
    const box = fitImageBox(400, 2000, 800, 1000, 0, 0)
    assert.deepEqual(box, { x: -100, y: -500, w: 200, h: 1000 })
  })

  it('refuses a picture or a page with no usable size', () => {
    assert.equal(fitImageBox(0, 100, 800, 800), null)
    assert.equal(fitImageBox(100, 100, 0, 800), null)
    assert.equal(fitImageBox(NaN, 100, 800, 800), null)
  })
})

describe('wrapping pasted text', () => {
  // Every character is 10 wide, so a 100-wide line holds ten of them.
  const measure = s => String(s).length * 10

  it('breaks at the last word that fits', () => {
    assert.equal(wrapTextToWidth('aaa bbb ccc ddd', measure, 75), 'aaa bbb\nccc ddd')
  })

  it('leaves text that already fits alone', () => {
    assert.equal(wrapTextToWidth('one two', measure, 200), 'one two')
  })

  it('keeps the blank lines the text arrived with', () => {
    assert.equal(wrapTextToWidth('one\n\ntwo', measure, 200), 'one\n\ntwo')
  })

  it('normalises Windows line endings', () => {
    assert.equal(wrapTextToWidth('one\r\ntwo', measure, 200), 'one\ntwo')
  })

  it('hard-breaks a word too long for a whole line', () => {
    assert.equal(wrapTextToWidth('abcdefghijklmnop', measure, 60), 'abcdef\nghijkl\nmnop')
    assert.equal(wrapTextToWidth('abcdefghijklmnop', measure, 30), 'abc\ndef\nghi\njkl\nmno\np')
  })

  it('returns the text unchanged when there is nothing to measure with', () => {
    assert.equal(wrapTextToWidth('anything', null, 100), 'anything')
  })
})

describe('copied picture files', () => {
  it('recognises the picture extensions the app can read', () => {
    for (const name of ['shot.png', 'photo.JPG', 'scan.jpeg', 'anim.gif', 'a.webp', 'b.BMP']) {
      assert.equal(imageFileName(name), true, name)
    }
    for (const name of ['notes.txt', 'doc.pdf', 'noext', '']) {
      assert.equal(imageFileName(name), false, name)
    }
  })
})

// ---------- reading a picture off the OS clipboard ----------
// The reader tries its sources in a fixed order (bitmap, Windows file list,
// item clipboard) and takes only what it can decode. These fakes stand in for
// Electron's clipboard and nativeImage calls, so the whole paste-in path — the
// one the person reported — is covered without a window.

const PIC = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 800, height: 600 }

function hostWith(over = {}) {
  return {
    platform: 'win32',
    readBitmap: () => null,
    readBuffer: () => null,
    readItems: () => null,
    getItemBytes: () => null,
    imageFromBytes: () => null,
    imageFromFile: () => null,
    fileSize: () => null,
    toPath: () => { throw new Error('no file URIs here') },
    ...over,
  }
}

// An item-clipboard entry whose bytes come back the way Electron delivers them.
const item = (types, bytes) => ({ types, getType: async () => ({ arrayBuffer: async () => Buffer.from(bytes) }) })
const getItemBytes = async (it, type) => {
  const blob = await it.getType(type)
  return Buffer.from(await blob.arrayBuffer())
}

describe('clipboard file lists and flavours', () => {
  it('splits the NUL-separated Windows file list and drops empty entries', () => {
    assert.deepEqual(
      parseClipboardFileList(Buffer.from('C:\\a\\b.png\0C:\\c.png\0\0', 'ucs2'), true),
      ['C:\\a\\b.png', 'C:\\c.png'])
    assert.deepEqual(
      parseClipboardFileList(Buffer.from('C:\\a b.png\0', 'latin1'), false),
      ['C:\\a b.png'])
  })

  it('answers nothing for a buffer that is empty or missing', () => {
    assert.deepEqual(parseClipboardFileList(null, true), [])
    assert.deepEqual(parseClipboardFileList(new Uint8Array(0), false), [])
  })

  it('reads a URI list into paths and skips what cannot become one', () => {
    const toPath = uri => {
      if (!uri.startsWith('file:///')) throw new Error('foreign URI')
      return uri.slice(8)
    }
    assert.deepEqual(
      parseUriListFiles('# a comment\r\nfile:///D:/a.png\r\n\r\nfile:///D:/b.jpg\n', toPath),
      ['D:/a.png', 'D:/b.jpg'])
    assert.deepEqual(parseUriListFiles('https://example.com/a.png', toPath), [])
    assert.deepEqual(parseUriListFiles(null, toPath), [])
  })

  it('finds the flavour an item offers and ignores the ones the app cannot use', () => {
    assert.equal(firstImageType(['text/plain', 'image/png']), 'image/png')
    assert.equal(firstImageType(['text/plain']), '')
    assert.equal(firstImageType(null), '')
    assert.equal(firstUriListType(['text/plain', 'text/uri-list']), 'text/uri-list')
    assert.equal(firstUriListType(['text/plain']), '')
  })

  it('decodes item bytes as UTF-8 text', () => {
    assert.equal(decodeClipboardText(Buffer.from('file:///a.png', 'utf8')), 'file:///a.png')
    assert.equal(decodeClipboardText(null), '')
  })
})

describe('reading a picture off the clipboard', () => {
  it('takes a screenshot bitmap first, without asking for a file list', async () => {
    let fileAsked = false
    const pic = await readClipboardPicture(hostWith({
      readBitmap: () => PIC,
      readBuffer: () => { fileAsked = true; return null },
    }))
    assert.deepEqual(pic, { ...PIC, source: 'bitmap' })
    assert.equal(fileAsked, false)
  })

  it('reads the picture file the Windows file list names', async () => {
    const listed = 'C:\\Users\\me\\shot.png'
    const pic = await readClipboardPicture(hostWith({
      readBuffer: format => (format === 'FileNameW' ? Buffer.from(listed + '\0', 'ucs2') : null),
      fileSize: f => (f === listed ? 1200 : null),
      imageFromFile: f => (f === listed ? PIC : null),
    }))
    assert.deepEqual(pic, { ...PIC, source: 'file' })
  })

  it('falls back to the ANSI file list older apps still write', async () => {
    const listed = 'C:\\shots\\a.jpg'
    const pic = await readClipboardPicture(hostWith({
      readBuffer: format => (format === 'FileName' ? Buffer.from(listed + '\0', 'latin1') : null),
      fileSize: () => 10,
      imageFromFile: () => PIC,
    }))
    assert.deepEqual(pic, { ...PIC, source: 'file' })
  })

  it('skips a listed file that is not a picture, is gone, or is too large', async () => {
    const listed = ['C:\\a\\notes.txt', 'C:\\a\\gone.png', 'C:\\a\\huge.png', 'C:\\a\\ok.png']
    const sizes = { 'C:\\a\\gone.png': null, 'C:\\a\\huge.png': MAX_CLIPBOARD_FILE + 1, 'C:\\a\\ok.png': 500 }
    const pic = await readClipboardPicture(hostWith({
      readBuffer: format => (format === 'FileNameW' ? Buffer.from(listed.join('\0') + '\0', 'ucs2') : null),
      fileSize: f => (f in sizes ? sizes[f] : 100),
      imageFromFile: f => (f === 'C:\\a\\ok.png' ? PIC : null),
    }))
    assert.deepEqual(pic, { ...PIC, source: 'file' })
  })

  it('prefers an image item over a file list on the item clipboard', async () => {
    const items = [
      item(['text/plain', 'text/uri-list'], 'file:///D:/pics/cat.png\r\n'),
      item(['image/png'], [1, 2, 3]),
    ]
    const pic = await readClipboardPicture(hostWith({
      platform: 'darwin',
      readItems: () => items,
      getItemBytes,
      imageFromBytes: () => PIC,
      fileSize: () => 10,
      imageFromFile: () => ({ ...PIC, dataUrl: 'data:image/png;base64,AAAA' }),
      toPath: uri => uri.slice(8),
    }))
    assert.equal(pic.source, 'bitmap')
  })

  it('reads the uri-list file when no item carries an image', async () => {
    const items = [item(['text/uri-list'], 'file:///home/me/pic.webp\r\n')]
    const pic = await readClipboardPicture(hostWith({
      platform: 'linux',
      readItems: () => items,
      getItemBytes,
      imageFromFile: f => (f === '/home/me/pic.webp' ? PIC : null),
      fileSize: () => 5,
      toPath: uri => uri.slice(7),
    }))
    assert.deepEqual(pic, { ...PIC, source: 'file' })
  })

  it('never asks for the Windows file list on another platform', async () => {
    let asked = false
    await readClipboardPicture(hostWith({
      platform: 'darwin',
      readBuffer: () => { asked = true; return null },
    }))
    assert.equal(asked, false)
  })

  it('fails softly: a call that throws is just one source missing', async () => {
    const pic = await readClipboardPicture(hostWith({
      readBitmap: () => { throw new Error('no clipboard') },
      readBuffer: () => { throw new Error('no format') },
      readItems: () => { throw new Error('no items') },
    }))
    assert.equal(pic, null)
  })

  it('answers null when nothing on the clipboard is a picture', async () => {
    assert.equal(await readClipboardPicture(hostWith({})), null)
    assert.equal(await readClipboardPicture(null), null)
    assert.equal(await readClipboardPicture(hostWith({
      platform: 'darwin',
      readItems: () => [item(['text/plain'], 'just words')],
    })), null)
  })

  it('accepts only a data: image URL from the host', async () => {
    assert.equal(await readClipboardPicture(hostWith({
      readBitmap: () => ({ dataUrl: 'https://example.com/a.png' }),
    })), null)
  })
})

describe('how many pictures a page takes', () => {
  const boxes = n => Array.from({ length: n }, () => ({ ...picture }))
  // A data URL of an exact length, so the budget can be spent to the character.
  const sized = n => ({ ...picture, data: 'data:image/png;base64,' + 'A'.repeat(n - 22) })

  it('counts the picture data a page already carries', () => {
    assert.equal(pageImageChars([]), 0)
    assert.equal(pageImageChars([{ data: 'abc' }, { data: 'de' }]), 5)
    // a decoded element or an empty slot adds nothing
    assert.equal(pageImageChars([{ data: 'abc', img: {} }, {}]), 3)
    assert.equal(pageImageChars(null), 0)
  })

  it('keeps every picture while the page has room', () => {
    assert.equal(fitPageImages(boxes(2), [picture, picture, picture]).length, 3)
    assert.equal(fitPageImages([], []).length, 0)
  })

  it('stops at the per-page picture cap', () => {
    const back = fitPageImages(boxes(MAX_PAGE_IMAGES - 1), [picture, picture, picture])
    assert.equal(back.length, 1)
    assert.equal(fitPageImages(boxes(MAX_PAGE_IMAGES), [picture]).length, 0)
  })

  it('stops when the page has spent its picture budget', () => {
    const spent = sized(MAX_PAGE_IMAGE_CHARS)
    assert.equal(fitPageImages([spent], [picture]).length, 0)
    // a picture that is exactly the size of the room left still fits
    const half = sized(MAX_PAGE_IMAGE_CHARS / 2)
    assert.equal(fitPageImages([half], [sized(MAX_PAGE_IMAGE_CHARS - MAX_PAGE_IMAGE_CHARS / 2)]).length, 1)
  })

  it('takes the pictures that fit, in order, and drops the rest', () => {
    const big = sized(MAX_PAGE_IMAGE_CHARS * 0.6)
    const back = fitPageImages([], [big, big, big])
    assert.equal(back.length, 1)
    assert.equal(back[0], big)
  })

  it('refuses an entry with no picture data instead of pasting an empty box', () => {
    assert.equal(fitPageImages([], [{ x: 0, y: 0, w: 10, h: 10 }]).length, 0)
  })
})
