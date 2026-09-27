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
    const bytes = Buffer.from(result.bytes)
    const text = bytes.toString('latin1')
    assert.ok(text.startsWith('%PDF-1.4\n'))
    assert.match(text, /%%EOF\n$/)
    const xrefPosition = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1])
    assert.equal(text.slice(xrefPosition, xrefPosition + 5), 'xref\n')
    const xref = text.slice(xrefPosition).split('\n')
    const count = Number(xref[1].split(' ')[1])
    assert.equal(count, 7)
    const objects = []
    for (let id = 1; id < count; id += 1) {
      const offset = Number(xref[id + 2].slice(0, 10))
      assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`, `Cross reference for object ${id} must point to its header`)
      const end = text.indexOf('\nendobj', offset)
      objects[id] = { offset, text: text.slice(offset, end) }
    }
    assert.match(objects[1].text, /\/Type \/Catalog \/Pages 2 0 R/)
    assert.match(objects[2].text, /\/Count 1/)
    const mediaBox = objects[3].text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
    // 3 x 2 is wider than tall, so the sheet turns landscape: A4 at 72pt per inch
    assert.ok(Math.abs(Number(mediaBox[1]) - 841.89) < 0.01, `page width ${mediaBox[1]} must be A4 landscape`)
    assert.ok(Math.abs(Number(mediaBox[2]) - 595.276) < 0.01, `page height ${mediaBox[2]} must be A4 landscape`)
    assert.match(objects[3].text, /\/Contents 6 0 R/)
    assert.match(objects[4].text, /\/ColorSpace \/DeviceRGB/)
    assert.match(objects[4].text, /\/SMask 5 0 R/)
    assert.match(objects[5].text, /\/ColorSpace \/DeviceGray/)
    const decodeStream = (id) => {
      const object = objects[id]
      const length = Number(object.text.match(/\/Length (\d+)/)[1])
      const start = object.offset + object.text.indexOf('stream\n') + 'stream\n'.length
      assert.equal(text.slice(start + length, start + length + 10), '\nendstream')
      return inflateSync(bytes.subarray(start, start + length))
    }
    assert.deepEqual([...decodeStream(4)], [255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 255, 255, 255])
    assert.deepEqual([...decodeStream(5)], [255, 128, 0, 64, 255, 64])
    // The unit square is drawn across the whole sheet: 841.89 x 595.276pt from the
    // origin, so there are no empty bands and nothing is clipped.
    assert.match(objects[6].text, /841\.89 0 0 595\.276 0 0 cm\n\/Im0 Do/)
  } finally { await close() }
})

test('a tall composition fills one A4 page edge to edge, never split', async () => {
  const { page, close } = await fixture()
  try {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 2400
      const context = canvas.getContext('2d')
      context.fillStyle = '#3366ff'
      context.fillRect(0, 0, 1200, 2400)
      const pdf = await (await window.__exports.createExportBlob(canvas, 'pdf')).text()
      return {
        count: Number(/\/Count (\d+)/.exec(pdf)[1]),
        mediaBoxes: [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]),
        placements: [...pdf.matchAll(/([\d.]+) 0 0 ([\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)].map(m => m.slice(1).map(Number)),
      }
    })
    // 1200 x 2400 is taller than A4 portrait, so the sheet turns portrait and the whole
    // capture is stretched across it: 595.276 x 841.89pt from the origin.
    assert.equal(result.count, 1, 'one composition is always one page, so nothing can be split')
    assert.deepEqual(result.mediaBoxes, [[595.276, 841.89]])
    assert.equal(result.placements.length, 1)
    const [width, height, x, y] = result.placements[0];
    // The drawn rect must be the page rect: no empty bands, and nothing past the
    // MediaBox for a renderer to clip away.
    const [pageWidth, pageHeight] = result.mediaBoxes[0];
    assert.deepEqual([width, height], [pageWidth, pageHeight], 'the image covers the whole sheet')
    assert.deepEqual([x, y], [0, 0], 'the image starts at the page origin')
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
