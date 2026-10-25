# Note format

WriteCanvas stores notes in the format Scrble Ink uses, so one library folder can
be read by either application. A note is an ordinary PNG with private ancillary
chunks appended after the image data, plus two extensions of our own that keep a
page editable.

Everything here is implemented once, in `src/js/png-toolkit.js`. The Node side
(`main/scrble-format.js`) is a thin Buffer facade over that module.

## Library layout

```
<library root>/
  index.json                      the tree and per-page metadata
  Scribble/
    <Note name>#01.png            page 1
    <Note name>#02.png            page 2
```

- The folder is `Scribble/`, and page files are `<Name>#<NN>.png`, matching the
  original application. A note imported from Scrble Ink keeps working in place.
- `index.json` holds what the PNGs cannot express: the folder tree, note titles,
  and per-page metadata. Its shape is
  `{ version: 1, nextId, items: [{ id, type: 'folder' | 'note', name, parent, created, note? }] }`,
  where a note's `note` is `{ pages: [{ file, paper }], currentPage }`.
- Names are sanitised before they become file names: `\ / : * ? " < > |` are
  replaced, and page numbers are zero-padded.
- The library root is chosen by the user and defaults to `Documents/WriteCanvas`;
  the choice lives in `config.json` inside the Electron `userData` folder, not in
  the library itself.

`index.json` is a WriteCanvas file, not a Scrble Ink one. Deleting it costs the
tree, titles and page metadata; the PNGs still open.

## Chunks in a note PNG

A note PNG contains, in this order: the signature, `IHDR`, other standard chunks,
the `IDAT` image data, and finally the private `s*` chunks. Only the chunk *name*
is private, so any spec-compliant reader — including Scrble Ink — sees an ordinary
image and ignores the rest.

| Chunk | Payload | Meaning |
|---|---|---|
| `sVER` | uint32 BE | Format version of the note. Currently `3`. |
| `sINK` | bytes | The ink replay envelope (a GIF; see below). |
| `sLYT` | 1 byte | Layout / orientation: `0` portrait, `1` landscape. |
| `sBKG` | 1 byte | Whether the page was created from a template. |
| `sCRP` | 1 byte | Mirrored as read; meaning owned by the original app. |
| `sSTD` | 4-byte-BE length + UTF-8 name | Paper size name, e.g. `Letter`. |
| `sPNA` | 4-byte-BE length + UTF-8 path | Template path for the page background. |
| `sBKC` | 4-byte-BE length + UTF-8 `#AARRGGBB` | Background (board) colour. |
| `sBRL` | 1 byte | Mirrored as read; meaning owned by the original app. |
| `sVec` | UTF-8 JSON | **WriteCanvas extension.** The editable strokes and text. |
| `sRST` | PNG bytes | **WriteCanvas extension.** The clean raster base the strokes sit on. |

Length-prefixed strings are UTF-8 with a 4-byte big-endian length, which is how
the original application frames its own string chunks.

`IDAT` is never edited in place. It is written from a flattened composite of
paper, raster base and ink, so the file is a valid image for every reader; the
`s*` chunks carry the information that makes the page editable again.

### `sVec`: the editable ink

```json
{
  "v": 2,
  "strokes": [
    { "type": "pen", "color": "#000000", "width": 14, "opacity": 1,
      "pts": [{ "x": 120, "y": 340, "p": 0.5 }] }
  ],
  "texts": [
    { "txt": "hello", "x": 200, "y": 400, "color": "#000000",
      "size": 60, "bold": false, "italic": false, "underline": false }
  ]
}
```

- `v` is the payload version. Readers must ignore a payload they do not
  understand and fall back to the raster base rather than failing.
- A stroke's `pts` are document pixels, at the document scale described below. `p`
  is the pointer pressure used to shape the stamp when a device provides one;
  devices that do not report pressure use `0.5`.
- `type` selects the pen engine, `width` is in document pixels and `opacity` is
  the pen's alpha.
- A shape produces strokes that also carry a `shape` descriptor; they are
  ordinary strokes otherwise, which is why shapes can be erased and selected like
  ink.
- Texts are optional. A page saved by an older build, or by Scrble Ink, has none.

### `sRST`: the raster base

The pixels of a page WriteCanvas did not draw: an imported image, or a page
written by Scrble Ink that contains only ink. Keeping it as a PNG inside the file
means a page that is re-saved is composited over the same base pixels instead of
being flattened and re-flattened, which is what makes importing lossless for
those pages.

### `sINK`: the ink replay

The replay is an animated GIF of the drawing, embedded as the original
application does. Frames are captured in the renderer after committed changes
(`src/js/replay.js`) and encoded in the main process with `gifenc` at save time.
It is a record of the drawing, not editable content: deleting it downgrades the
replay and nothing else.

## Document scale

Paper geometry and stroke widths are expressed in document pixels, sampled from
the original application's assets: a Letter page raster is 2500×3235 px for
8.5×11 in, so the document scale is `DOC_DPI = 2500 / 8.5 ≈ 294.12` dpi. A
millimetre is therefore about 11.58 document pixels, and `docMM()` in
`src/js/paper.js` is the single conversion used by pens and the ruler.

Page sizes and template paths live in `src/js/paper.js`; the size name written to
`sSTD` comes from that same table, so a note always names a size the app can
resolve on the way back in.

## `.wcanvas`: a note in one file

For sharing or archiving, a note can be exported as `.wcanvas`, a zip container
with no third-party dependency:

```
manifest.json     { schemaVersion, app, kind, name, createdAt, modifiedAt, project?, tool?, pages: [{ file, paper }] }
page-01.png       the page exactly as the library stores it
page-02.png
```

- `schemaVersion` is `1`.
- Pages are stored with the zip `STORE` method: PNGs are already DEFLATE data, so
  compressing them again costs CPU and saves nothing. The reader still accepts
  `DEFLATE` entries, for files some other tool re-zipped.
- Import re-creates the note and its pages, chunks and all, so a round trip keeps
  the replay, the paper and the editable strokes.
- Limits are enforced on read: at most 9999 pages, 200 MB per page, 1 GB for the
  container.

## Compatibility rules

| Direction | What happens |
|---|---|
| Scrble Ink → WriteCanvas | Paper, background, size, replay and the flattened image are read; the page arrives as a raster base and is editable on top of it. |
| WriteCanvas → Scrble Ink | The flattened image sits in `IDAT` and the private chunks keep their original meaning, so the other app sees a normal note with a background and a replay. |
| WriteCanvas → WriteCanvas | `sVec` and `sRST` restore the exact editable page, including strokes a flattened image could not describe. |

Which means: a page drawn in WriteCanvas round-trips losslessly, while a page
drawn in Scrble Ink itself round-trips as pixels plus whatever ink is added
afterwards. Vector data does not exist in those files, so it cannot be invented.

## Compatibility risks to respect when changing the format

- Never renumber or repurpose an existing chunk. Add a new one.
- Bump `sVec.v` when the payload shape changes, and keep readers tolerant of
  unknown fields and unknown versions.
- Keep writing a flattened `IDAT` in every case. A note that only works in
  WriteCanvas is a regression.
- Preserve ancillary chunks you do not understand on read, so a note that passes
  through the app is not stripped of another tool's metadata.