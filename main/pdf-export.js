'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

async function renderPdf(pages, paper, destination, createWindow, io = fs) {
  const tmp = await io.mkdtemp(path.join(os.tmpdir(), 'wc-pdf-'))
  let pdfWin
  try {
    const files = []
    for (let i = 0; i < pages.length; i++) {
      const file = path.join(tmp, `p${i}.png`)
      await io.writeFile(file, Buffer.from(pages[i]))
      files.push(file)
    }
    const wMM = Math.round(paper.widthMM * 100) / 100
    const hMM = Math.round(paper.heightMM * 100) / 100
    const wIn = Math.round((wMM / 25.4) * 100) / 100
    const hIn = Math.round((hMM / 25.4) * 100) / 100
    const htmlFile = path.join(tmp, 'pages.html')
    await io.writeFile(htmlFile, `<!doctype html><html><head><style>
      @page { size: ${wMM}mm ${hMM}mm; margin: 0 }
      html,body{margin:0;padding:0}
      img{display:block;width:${wMM}mm;height:${hMM}mm;object-fit:contain;page-break-after:always}
      img:last-child{page-break-after:auto}
    </style></head><body>${files.map(f => `<img src="file:///${f.replace(/\\/g, '/')}">`).join('')}</body></html>`, 'utf8')
    pdfWin = createWindow(htmlFile)
    await pdfWin.loadFile(htmlFile)
    const buf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: wIn, height: hIn },
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
    })
    await io.writeFile(destination, buf)
  } finally {
    try {
      if (pdfWin) pdfWin.destroy()
    } finally {
      await io.rm(tmp, { recursive: true, force: true })
    }
  }
}

module.exports = { renderPdf }
