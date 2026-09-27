import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import ts from 'typescript'
import { chromium } from '@playwright/test'

const exportSource = ts.transpileModule(await readFile(new URL('../src/lib/export.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^export /gm, '')

let browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close() })

async function fixture() {
  const context = await browser.newContext()
  await context.route('https://exports.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>ImageShot export tests</title>' }))
  const page = await context.newPage()
  await page.goto('https://exports.test/')
  await page.addScriptTag({ content: `${exportSource}\nwindow.__exports = { createExportBlob, copyExport };` })
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 3
    canvas.height = 2
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0,
      0, 0, 255, 64, 255, 255, 0, 255, 255, 255, 255, 64,
    ])
    canvas.getContext('2d').putImageData(new ImageData(pixels, 3, 2), 0, 0)
    window.__canvas = canvas
  })
  return { page, close: () => context.close() }
}

function parsePdf(data) {
  const bytes = Buffer.from(data)
  const text = bytes.toString('latin1')
  assert.ok(text.startsWith('%PDF-1.4\n'))
  assert.match(text, /%%EOF\n$/)
  const xrefPosition = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1])
  assert.equal(text.slice(xrefPosition, xrefPosition + 5), 'xref\n')
  const xref = text.slice(xrefPosition).split('\n')
  const count = Number(xref[1].split(' ')[1])
  const offsets = Array.from({ length: count - 1 }, (_, index) => Number(xref[index + 3].slice(0, 10)))
  const objects = []
  for (let id = 1; id < count; id += 1) {
    const offset = offsets[id - 1]
    const end = offsets[id] ?? xrefPosition
    assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`, `Cross reference for object ${id} must point to its header`)
    objects[id] = { offset, text: text.slice(offset, end) }
  }
  const stream = (id) => {
    const object = objects[id]
    const length = Number(object.text.match(/\/Length (\d+)/)[1])
    const start = object.offset + object.text.indexOf('stream\n') + 'stream\n'.length
    assert.equal(text.slice(start + length, start + length + 10), '\nendstream')
    const data = bytes.subarray(start, start + length)
    return /\/FlateDecode/.test(object.text.slice(0, object.text.indexOf('stream\n'))) ? inflateSync(data) : data
  }
  const page = objects.find(object => object && /\/Type \/Page\b/.test(object.text))
  const mediaBox = page.text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).slice(1).map(Number)
  const contentId = Number(page.text.match(/\/Contents (\d+) 0 R/)[1])
  const content = stream(contentId).toString('ascii')
  const placements = [...content.matchAll(/([\d.]+) 0 0 ([\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)].map(match => match.slice(1).map(Number))
  assert.equal(placements.length, 1, 'a composition must be drawn once')
  assert.equal(objects.filter(object => object && /\/Type \/Page\b/.test(object.text)).length, 1)
  assert.match(objects[2].text, /\/Count 1\b/)
  return { text, objects, stream, mediaBox, placement: placements[0] }
}

async function markedPdf(page, width, height, options = {}) {
  const bytes = await page.evaluate(async ({ width, height, options }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    // Distinct end rows expose lost content, strip boundaries, and resampling.
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, width, 1)
    context.fillStyle = '#0000ff'
    context.fillRect(0, height - 1, width, 1)
    return [...new Uint8Array(await (await window.__exports.createExportBlob(canvas, 'pdf', options)).arrayBuffer())]
  }, { width, height, options })
  const pdf = parsePdf(bytes)
  const image = pdf.objects.find(object => object && /\/ColorSpace \/DeviceRGB/.test(object.text))
  assert.match(image.text, new RegExp(`/Width ${width} /Height ${height}\\b`), 'the embedded image keeps its full raster dimensions')
  const imageId = Number(image.text.match(/^(\d+) 0 obj/)[1])
  const rgb = pdf.stream(imageId)
  assert.equal(rgb.length, width * height * 3, 'every source pixel must remain in the PDF')
  for (let x = 0; x < width; x += 1) {
    assert.deepEqual([...rgb.subarray(x * 3, x * 3 + 3)], [255, 0, 0], 'the first row is intact')
    const bottom = ((height - 1) * width + x) * 3
    assert.deepEqual([...rgb.subarray(bottom, bottom + 3)], [0, 0, 255], 'the last row is intact')
  }
  return pdf
}

function assertClose(actual, expected, message, tolerance = 0.0002) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`)
}

function assertContained(pdf, sourceWidth, sourceHeight) {
  const [pageWidth, pageHeight] = pdf.mediaBox
  const [width, height, x, y] = pdf.placement
  assert.ok(width > 0 && height > 0, 'the image has positive dimensions')
  assertClose(width / height, sourceWidth / sourceHeight, 'the composition retains its aspect ratio')
  assert.ok(x >= 0 && y >= 0 && x + width <= pageWidth + 0.0002 && y + height <= pageHeight + 0.0002, 'all image edges lie inside the page')
  assertClose(x, (pageWidth - width) / 2, 'the composition is horizontally centered')
  assertClose(y, (pageHeight - height) / 2, 'the composition is vertically centered')
}

test('PNG export preserves transparent and partially transparent pixels', async () => {
  const { page, close } = await fixture()
  try {
    const result = await page.evaluate(async () => {
      const blob = await window.__exports.createExportBlob(window.__canvas, 'png')
      const image = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return { type: blob.type, width: image.width, height: image.height, pixels: [...context.getImageData(0, 0, 3, 2).data] }
    })
    assert.equal(result.type, 'image/png')
    assert.deepEqual([result.width, result.height], [3, 2])
    assert.deepEqual(result.pixels, [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0, 0, 0, 255, 64, 255, 255, 0, 255, 255, 255, 255, 64])
  } finally { await close() }
})

test('PDF export has valid cross references, exact aspect ratio, and lossless RGB plus transparency streams', async () => {
  const { page, close } = await fixture()
  try {
    const result = await page.evaluate(async () => {
      const blob = await window.__exports.createExportBlob(window.__canvas, 'pdf')
      return { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] }
    })
    assert.equal(result.type, 'application/pdf')
    const pdf = parsePdf(result.bytes)
    const { objects, stream } = pdf
    assert.equal(objects.length, 7)
    assert.match(objects[1].text, /\/Type \/Catalog \/Pages 2 0 R/)
    assert.deepEqual(pdf.mediaBox, [2.25, 1.5], 'the default page does not enlarge small compositions beyond 96 pixels per inch')
    assert.deepEqual(pdf.placement, [2.25, 1.5, 0, 0], 'the image fills its matching page without cropping or stretching')
    assert.match(objects[3].text, /\/Contents 6 0 R/)
    assert.match(objects[4].text, /\/ColorSpace \/DeviceRGB/)
    assert.match(objects[4].text, /\/SMask 5 0 R/)
    assert.match(objects[4].text, /\/Interpolate false/, 'text and screenshot edges are not blurred by forced interpolation')
    assert.match(objects[5].text, /\/ColorSpace \/DeviceGray/)
    assert.deepEqual([...stream(4)], [255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 255, 255, 255])
    assert.deepEqual([...stream(5)], [255, 128, 0, 64, 255, 64])
  } finally { await close() }
})

test('Image size keeps tall, square, and wide compositions at their original physical size without missing ends', async () => {
  const { page, close } = await fixture()
  try {
    for (const [width, height] of [[400, 1600], [400, 400], [1600, 400]]) {
      const pdf = await markedPdf(page, width, height, { pageSize: 'image' })
      assert.deepEqual(pdf.mediaBox, [width * 0.75, height * 0.75])
      assert.deepEqual(pdf.placement, [...pdf.mediaBox, 0, 0])
      assertContained(pdf, width, height)
    }
  } finally { await close() }
})

test('default Auto uses a readable continuous page width without enlarging small images or losing pixels', async () => {
  const { page, close } = await fixture()
  try {
    for (const [width, height, expectedWidth, expectedHeight] of [
      [400, 1600, 300, 1200],
      [400, 400, 300, 300],
      [1600, 400, 595.276, 148.819],
      [20, 30000, 9.6, 14400],
    ]) {
      const pdf = await markedPdf(page, width, height)
      assertClose(pdf.mediaBox[0], expectedWidth, 'Auto sets the expected physical page width')
      assertClose(pdf.mediaBox[1], expectedHeight, 'Auto preserves the full proportional page height')
      assert.ok(pdf.mediaBox[0] <= 595.276, 'the reading width is at most the short side of A4')
      assert.ok(pdf.mediaBox.every(dimension => dimension > 0 && dimension <= 14400), 'both page sides fit within PDF 1.4 limits')
      assert.ok(pdf.mediaBox[0] <= width * 0.75 && pdf.mediaBox[1] <= height * 0.75, 'Auto never enlarges the original physical dimensions')
      assert.deepEqual(pdf.placement, [...pdf.mediaBox, 0, 0], 'the whole image fills one page without added white margins')
      assertContained(pdf, width, height)
    }
  } finally { await close() }
})

test('Auto gives the supplied CleanShot capture geometry the reference reading width and its full proportional height', async () => {
  const { page, close } = await fixture()
  try {
    const originalSize = { width: 1883, height: 14318 }
    // Physical sizing uses originalSize; a small fixture avoids allocating the
    // full 27-million-pixel capture just to verify its page dimensions.
    const pdf = await markedPdf(page, 3, 2, { pageSize: 'auto', originalSize })
    assertClose(pdf.mediaBox[0], 595.276, 'the capture matches the reference PDF reading width')
    assertClose(pdf.mediaBox[1], 595.276 * 14318 / 1883, 'the capture remains a continuous page with its original proportions')
    assert.deepEqual(pdf.placement, [...pdf.mediaBox, 0, 0])
    assertContained(pdf, originalSize.width, originalSize.height)
  } finally { await close() }
})

test('A4 export contains and centers tall, square, and wide compositions with every end pixel intact', async () => {
  const { page, close } = await fixture()
  try {
    for (const [width, height] of [[400, 1600], [400, 400], [1600, 400]]) {
      const pdf = await markedPdf(page, width, height, { pageSize: 'a4' })
      const expectedPage = width > height ? [841.89, 595.276] : [595.276, 841.89]
      assert.deepEqual(pdf.mediaBox, expectedPage)
      assertContained(pdf, width, height)
      const [drawWidth, drawHeight] = pdf.placement
      assert.ok(Math.abs(drawWidth - expectedPage[0]) < 0.0002 || Math.abs(drawHeight - expectedPage[1]) < 0.0002, 'the image uses the available page space without an arbitrary inset')
      assert.ok(drawWidth < expectedPage[0] || drawHeight < expectedPage[1], 'mismatched aspect ratios produce space instead of distortion')
    }
  } finally { await close() }
})

test('higher raster export scale preserves physical PDF page size and composition placement', async () => {
  const { page, close } = await fixture()
  try {
    for (const [pageSize, originalSize] of [
      ['auto', { width: 301, height: 199 }],
      ['auto', { width: 801, height: 199 }],
      ['image', { width: 301, height: 199 }],
      ['a4', { width: 301, height: 199 }],
    ]) {
      const options = { pageSize, originalSize }
      const normal = await markedPdf(page, originalSize.width, originalSize.height, options)
      const doubled = await markedPdf(page, originalSize.width * 2, originalSize.height * 2, options)
      assert.deepEqual(doubled.mediaBox, normal.mediaBox, '2× improves image resolution without doubling the paper size')
      assert.deepEqual(doubled.placement, normal.placement, '2× has the same placement on the page')
      assertContained(doubled, originalSize.width, originalSize.height)
    }
  } finally { await close() }
})

test('Image size keeps very long compositions within the PDF page limit with their aspect ratio and all pixels intact', async () => {
  const { page, close } = await fixture()
  try {
    for (const [width, height] of [[20, 30000], [30000, 20]]) {
      const pdf = await markedPdf(page, width, height, { pageSize: 'image' })
      assert.equal(Math.max(...pdf.mediaBox), 14400, 'the largest page dimension stays within the PDF 1.4 limit')
      assert.ok(pdf.mediaBox.every(dimension => dimension > 0 && dimension <= 14400))
      assert.deepEqual(pdf.placement, [...pdf.mediaBox, 0, 0])
      assertContained(pdf, width, height)
    }
  } finally { await close() }
})

test('invalid PDF dimensions and unsupported page sizes fail before producing a document', async () => {
  const { page, close } = await fixture()
  try {
    const errors = await page.evaluate(async () => {
      const invalidOptions = [
        { originalSize: { width: 0, height: 2 } },
        { originalSize: { width: 3, height: -1 } },
        { originalSize: { width: NaN, height: 2 } },
        { originalSize: { width: 3, height: Infinity } },
        { originalSize: { width: 3 } },
        { pageSize: 'letter' },
      ]
      return Promise.all(invalidOptions.map(async options => {
        try {
          await window.__exports.createExportBlob(window.__canvas, 'pdf', options)
          return null
        } catch (error) {
          return error.message
        }
      }))
    })
    for (const error of errors) {
      assert.equal(typeof error, 'string', 'invalid options must reject instead of producing a corrupt PDF')
      assert.match(error, /PDF/i, 'the error identifies the export that needs correcting')
    }
  } finally { await close() }
})

test('PDF transparency and colors survive compression across multiple image strips', async () => {
  const { page, close } = await fixture()
  try {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 9
      canvas.height = 513
      const context = canvas.getContext('2d')
      const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4)
      for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 1) {
        pixels.set([pixel % 2 ? 255 : 0, pixel % 3 ? 255 : 0, pixel % 5 ? 255 : 0, pixel % 256], pixel * 4)
      }
      context.putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0)
      const source = [...context.getImageData(0, 0, canvas.width, canvas.height).data]
      const bytes = [...new Uint8Array(await (await window.__exports.createExportBlob(canvas, 'pdf')).arrayBuffer())]
      const after = [...context.getImageData(0, 0, canvas.width, canvas.height).data]
      return { source, bytes, after }
    })
    const pdf = parsePdf(result.bytes)
    const rgb = pdf.stream(4)
    const alpha = pdf.stream(5)
    const reconstructed = []
    for (let pixel = 0; pixel < alpha.length; pixel += 1) reconstructed.push(rgb[pixel * 3], rgb[pixel * 3 + 1], rgb[pixel * 3 + 2], alpha[pixel])
    assert.deepEqual(reconstructed, result.source, 'every pixel and alpha value survives strip boundaries')
    assert.deepEqual(result.after, result.source, 'PDF export does not alter its source canvas')
  } finally { await close() }
})

test('opaque PDF export omits the unnecessary transparency mask', async () => {
  const { page, close } = await fixture()
  try {
    const pdf = await page.evaluate(async () => {
      const context = window.__canvas.getContext('2d')
      context.fillStyle = 'white'
      context.fillRect(0, 0, 3, 2)
      return (await window.__exports.createExportBlob(window.__canvas, 'pdf')).text()
    })
    assert.doesNotMatch(pdf, /\/SMask/)
    assert.match(pdf, /\/Contents 5 0 R/)
  } finally { await close() }
})

test('JPG export flattens transparency onto white and WebP keeps its own mime type', async () => {
  const { page, close } = await fixture()
  try {
    const result = await page.evaluate(async () => {
      const read = async (format) => {
        const blob = await window.__exports.createExportBlob(window.__canvas, format)
        const image = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return { type: blob.type, transparent: [...context.getImageData(2, 1, 1, 1).data] }
      }
      return { jpg: await read('jpg'), webp: await read('webp') }
    })
    assert.equal(result.jpg.type, 'image/jpeg')
    // the fourth fixture pixel is fully transparent, so flattening must reveal white
    assert.ok(result.jpg.transparent[0] > 245 && result.jpg.transparent[1] > 245 && result.jpg.transparent[2] > 245)
    assert.equal(result.webp.type, 'image/webp')
  } finally { await close() }
})

async function copiedFormat(page, format, supportedTypes) {
  return page.evaluate(async ({ format, supportedTypes }) => {
    const writes = []
    class FakeClipboardItem {
      static supports(type) { return supportedTypes.includes(type) }
      constructor(data) { this.data = data }
    }
    Object.defineProperty(window, 'ClipboardItem', { value: FakeClipboardItem, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items) => {
      for (const [type, promisedBlob] of Object.entries(items[0].data)) {
        const wasPromise = typeof promisedBlob.then === 'function'
        const blob = await promisedBlob
        writes.push({ type, mime: blob.type, wasPromise, isPdf: (await blob.text()).startsWith('%PDF-') })
      }
    } } })
    const message = await window.__exports.copyExport(window.__canvas, format)
    return { writes, message }
  }, { format, supportedTypes })
}

test('Copy PNG writes a promise-backed native PNG clipboard item', async () => {
  const { page, close } = await fixture()
  try {
    const result = await copiedFormat(page, 'png', ['image/png'])
    assert.deepEqual(result.writes, [{ type: 'image/png', mime: 'image/png', wasPromise: true, isPdf: false }])
    assert.equal(result.message, 'PNG copied to clipboard.')
  } finally { await close() }
})

test('Copy PDF prefers native PDF and otherwise writes genuine PDF in the Chromium custom format', async () => {
  for (const native of [true, false]) {
    const { page, close } = await fixture()
    try {
      const result = await copiedFormat(page, 'pdf', native ? ['application/pdf', 'web application/pdf'] : ['web application/pdf'])
      assert.deepEqual(result.writes, [{ type: native ? 'application/pdf' : 'web application/pdf', mime: 'application/pdf', wasPromise: true, isPdf: true }])
      if (native) assert.equal(result.message, 'PDF copied to clipboard.')
      else assert.match(result.message, /web app that supports PDF clipboard data/)
    } finally { await close() }
  }
})

test('unsupported PDF clipboard gives an actionable error and performs no write', async () => {
  const { page, close } = await fixture()
  try {
    await assert.rejects(copiedFormat(page, 'pdf', ['image/png']), /PDF clipboard is not supported.*Export PDF/)
  } finally { await close() }
})
