// Ink replay recorder — mirrors the original app's behavior of embedding an
// animated GIF of the drawing (the sINK chunk, docs/ANALYSIS.md §3).
// Frames are captured after every committed visual change; the main process
// encodes them into a GIF with gifenc at save time.

export class Recorder {
  constructor(max = 400) {
    this.max = max
    this.frames = []
    this.lastCapture = performance.now()
    this.changed = false // any visual change since last save
  }

  reset() {
    this.frames = []
    this.lastCapture = performance.now()
    this.changed = false
  }

  markChanged() { this.changed = true }

  // Capture the composited page canvas; call after marking a change.
  capture(sourceCanvas) {
    const now = performance.now()
    let delay = Math.floor(now - this.lastCapture)
    this.lastCapture = now
    delay = Math.max(40, Math.min(2500, delay))
    const w = sourceCanvas.width, h = sourceCanvas.height
    const maxDim = 1280
    const scale = Math.min(1, maxDim / Math.max(w, h))
    const fw = Math.max(1, Math.round(w * scale))
    const fh = Math.max(1, Math.round(h * scale))
    let img
    if (scale === 1) {
      // Already at replay resolution: read it directly instead of copying the
      // whole frame through a second canvas first.
      img = sourceCanvas.getContext('2d').getImageData(0, 0, fw, fh)
    } else {
      const off = document.createElement('canvas')
      off.width = fw; off.height = fh
      const ctx = off.getContext('2d')
      ctx.drawImage(sourceCanvas, 0, 0, fw, fh)
      img = ctx.getImageData(0, 0, fw, fh)
    }
    if (this.frames.length >= this.max) this.frames.shift()
    this.frames.push({ delay, width: fw, height: fh, data: img.data })
    this.changed = true
  }
}

// Playback: prefers the stored replay GIF (from sINK) for imported note pages;
// falls back to a flipbook of this session's frames.
export function playReplay(container, page, stop) {
  if (page.inkGif && page.inkGif.length) {
    const blob = new Blob([page.inkGif], { type: 'image/gif' })
    const url = URL.createObjectURL(blob)
    const img = document.createElement('img')
    img.src = url
    img.className = 'replay-gif'
    container.appendChild(img)
    const done = () => { URL.revokeObjectURL(url); img.remove(); stop && stop() }
    img.onclick = done
    return () => done()
  }
  // flipbook
  const frames = page.recorder && page.recorder.frames.length ? page.recorder.frames : null
  if (!frames) { stop && stop(); return () => { } }
  const cv = document.createElement('canvas')
  cv.className = 'replay-gif'
  container.appendChild(cv)
  let cancelled = false
  const stopper = () => { cancelled = true; cv.remove(); stop && stop() }
  cv.onclick = stopper
  ;(async () => {
    cv.width = frames[0].width; cv.height = frames[0].height
    const ctx = cv.getContext('2d')
    while (!cancelled) {
      for (const f of frames) {
        if (cancelled) return
        ctx.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0)
        await new Promise(r => setTimeout(r, Math.max(40, f.delay)))
      }
    }
  })()
  return () => stopper()
}
