import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'
import { chromium } from '@playwright/test'

const backgroundSource = ts.transpileModule(await readFile(new URL('../src/extension/background.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*?;\r?\n/gm, '')
const storeSource = ts.transpileModule(await readFile(new URL('../src/lib/capture-store.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^export /gm, '')

let browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close() })

async function harness(html, options = {}) {
  const context = await browser.newContext({ viewport: { width: 720, height: 500 }, deviceScaleFactor: 1 })
  await context.route('http://capture.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Capture fixture</title></head><body>${html}</body></html>` }))
  const page = await context.newPage()
  await page.goto('http://capture.test/example')
  const records = []
  const openedTabs = []
  const captureTimes = []
  const tab = { id: 1, windowId: 5, url: options.tabUrl ?? page.url(), title: 'Capture fixture', active: true }
  let listener
  let activeId = 1
  const chrome = {
    runtime: {
      id: 'imageshot-test',
      onMessage: { addListener: (callback) => { listener = callback } },
      getURL: (path) => `chrome-extension://imageshot-test/${path}`,
    },
    tabs: {
      query: async () => [{ ...tab, id: activeId }],
      get: async () => ({ ...tab }),
      captureVisibleTab: async () => {
        captureTimes.push(Date.now())
        if (options.failAtCapture === captureTimes.length) throw new Error('Simulated browser capture failure.')
        const png = await page.screenshot({ type: 'png' })
        if (options.switchAtCapture === captureTimes.length) activeId = 2
        return `data:image/png;base64,${png.toString('base64')}`
      },
      create: async ({ url }) => { openedTabs.push(url); return { id: 2 } },
    },
    scripting: {
      executeScript: async ({ func, args = [] }) => [{ result: await page.evaluate(({ source, values }) => {
        return (0, eval)(`(${source})`)(...values)
      }, { source: func.toString(), values: args }) }],
    },
  }
  vm.runInNewContext(backgroundSource, {
    chrome, crypto: webcrypto, atob, setTimeout, clearTimeout,
    saveCapture: async (record) => { records.push(record) },
  })
  const capture = (mode) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Capture test timed out.')), 30_000)
    listener({ type: 'IMAGESHOT_CAPTURE', mode }, { id: 'imageshot-test' }, (response) => { clearTimeout(timeout); resolve(response) })
  })
  const sample = async (record, points) => {
    await page.addScriptTag({ content: `${storeSource}\nwindow.__materializeCapture = materializeCapture;` })
    return page.evaluate(async ({ captureRecord, coordinates }) => {
      const dataUrl = await window.__materializeCapture(captureRecord)
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return { width: image.width, height: image.height, pixels: coordinates.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]) }
    }, { captureRecord: record, coordinates: points })
  }
  return { page, records, openedTabs, captureTimes, capture, sample, close: () => context.close() }
}

const fullPageFixture = `<style>
  body { margin:0; }
  .fixed { position:fixed;inset:0 0 auto;height:40px;background:rgb(240,64,64);z-index:2; }
  .sticky { position:sticky;top:0;height:40px;background:rgb(40,170,100); }
  .band { height:700px; }
  .one { background:rgb(70,130,230); } .two { background:rgb(130,80,210); } .three { background:rgb(245,190,70); }
</style><div class="fixed" style="visibility:visible">Header</div><div class="sticky" style="top:13px!important">Sticky content</div><div class="band one"></div><div class="band two"></div><div class="band three"></div>`

test('visible capture keeps pixel dimensions and opens its local editor record', async () => {
  const fixture = await harness('<style>body{margin:0;background:rgb(95,65,180)}</style>')
  try {
    const response = await fixture.capture('visible')
    assert.equal(response.ok, true)
    assert.equal(fixture.records.length, 1)
    const record = fixture.records[0]
    assert.equal(record.width, 720)
    assert.equal(record.height, 500)
    assert.equal(record.mode, 'visible')
    assert.equal(record.sourceUrl, 'http://capture.test/example')
    assert.ok(record.dataUrl.startsWith('data:image/png;base64,'))
    assert.equal(fixture.openedTabs[0], `chrome-extension://imageshot-test/editor.html?capture=${record.id}`)
  } finally { await fixture.close() }
})

test('full-page capture stitches the partial bottom tile and restores scrolling and sticky styles', async () => {
  const fixture = await harness(fullPageFixture)
  try {
    await fixture.page.evaluate(() => window.scrollTo(0, 330))
    const response = await fixture.capture('full')
    assert.equal(response.ok, true, response.error)
    const record = fixture.records[0]
    assert.deepEqual([record.width, record.height], [720, 2140])
    assert.equal(record.tiles.length, 5)
    assert.equal(record.tiles.at(-1).sourceY, 360)
    assert.equal(record.tiles.at(-1).height, 140)
    const image = await fixture.sample(record, [[50, 10], [50, 510], [50, 1010], [50, 1510], [50, 2130]])
    assert.deepEqual(image.pixels, [[240, 64, 64, 255], [70, 130, 230, 255], [130, 80, 210, 255], [245, 190, 70, 255], [245, 190, 70, 255]])
    assert.deepEqual(await fixture.page.evaluate(() => ({
      y: window.scrollY,
      stickyPosition: getComputedStyle(document.querySelector('.sticky')).position,
      stickyTop: document.querySelector('.sticky').style.getPropertyValue('top'),
      stickyPriority: document.querySelector('.sticky').style.getPropertyPriority('top'),
      fixedVisibility: document.querySelector('.fixed').style.visibility,
      temporaryState: !!window.__imageshotCaptureState,
    })), { y: 330, stickyPosition: 'sticky', stickyTop: '13px', stickyPriority: 'important', fixedVisibility: 'visible', temporaryState: false })
    for (let i = 1; i < fixture.captureTimes.length; i += 1) assert.ok(fixture.captureTimes[i] - fixture.captureTimes[i - 1] >= 580, 'Capture calls must stay below Chromium rate limit')
  } finally { await fixture.close() }
})

test('full-page capture includes horizontal overflow without overlapping edge tiles', async () => {
  const fixture = await harness('<style>body{margin:0}.wide{width:1150px;height:830px;background:linear-gradient(to right,rgb(230,90,90) 0 720px,rgb(60,170,140) 720px)}</style><div class="wide"></div>')
  try {
    const response = await fixture.capture('full')
    assert.equal(response.ok, true, response.error)
    const record = fixture.records[0]
    assert.deepEqual([record.width, record.height], [1150, 830])
    assert.equal(record.tiles.length, 4)
    const image = await fixture.sample(record, [[710, 400], [730, 400], [1140, 820]])
    assert.deepEqual(image.pixels, [[230, 90, 90, 255], [60, 170, 140, 255], [60, 170, 140, 255]])
  } finally { await fixture.close() }
})

test('area selection captures only the dragged rectangle after removing the overlay', async () => {
  const fixture = await harness('<style>body{margin:0;background:rgb(75,155,210)}</style>')
  try {
    const pending = fixture.capture('area')
    await fixture.page.locator('[data-imageshot-selector]').waitFor()
    await fixture.page.mouse.move(90, 120)
    await fixture.page.mouse.down()
    await fixture.page.mouse.move(430, 350)
    await fixture.page.mouse.up()
    const response = await pending
    assert.equal(response.ok, true, response.error)
    const record = fixture.records[0]
    assert.deepEqual([record.width, record.height], [340, 230])
    assert.deepEqual([record.tiles[0].sourceX, record.tiles[0].sourceY], [90, 120])
    assert.equal(await fixture.page.locator('[data-imageshot-selector]').count(), 0)
    const image = await fixture.sample(record, [[1, 1], [338, 228]])
    assert.deepEqual(image.pixels, [[75, 155, 210, 255], [75, 155, 210, 255]])
  } finally { await fixture.close() }
})

test('Escape cancels area selection without saving or opening an editor', async () => {
  const fixture = await harness('Capture fixture')
  try {
    const pending = fixture.capture('area')
    await fixture.page.locator('[data-imageshot-selector]').waitFor()
    await fixture.page.keyboard.press('Escape')
    const response = await pending
    assert.equal(response.ok, false)
    assert.equal(response.error, 'Capture cancelled.')
    assert.equal(fixture.records.length, 0)
    assert.equal(fixture.openedTabs.length, 0)
    assert.equal(await fixture.page.locator('[data-imageshot-selector]').count(), 0)
  } finally { await fixture.close() }
})

test('a capture failure restores the original webpage and reports the error', async () => {
  const fixture = await harness(fullPageFixture, { failAtCapture: 2 })
  try {
    await fixture.page.evaluate(() => window.scrollTo(0, 420))
    const response = await fixture.capture('full')
    assert.equal(response.ok, false)
    assert.match(response.error, /Simulated browser capture failure/)
    assert.equal(fixture.records.length, 0)
    assert.deepEqual(await fixture.page.evaluate(() => [window.scrollY, getComputedStyle(document.querySelector('.sticky')).position, document.querySelector('.fixed').style.visibility, !!window.__imageshotCaptureState]), [420, 'sticky', 'visible', false])
    assert.equal(await fixture.page.locator('[data-imageshot-notice]').count(), 1)
  } finally { await fixture.close() }
})

test('switching tabs stops capture before a screenshot of the wrong page is saved', async () => {
  const fixture = await harness(fullPageFixture, { switchAtCapture: 1 })
  try {
    const response = await fixture.capture('full')
    assert.equal(response.ok, false)
    assert.match(response.error, /switched tabs/)
    assert.equal(fixture.records.length, 0)
    assert.equal(await fixture.page.evaluate(() => !!window.__imageshotCaptureState), false)
  } finally { await fixture.close() }
})

test('restricted browser tabs return a useful error without taking a screenshot', async () => {
  const fixture = await harness('Browser settings', { tabUrl: 'chrome://settings/' })
  try {
    const response = await fixture.capture('visible')
    assert.equal(response.ok, false)
    assert.match(response.error, /regular website/)
    assert.equal(fixture.captureTimes.length, 0)
    assert.equal(fixture.records.length, 0)
  } finally { await fixture.close() }
})

test('local screenshot history persists records, retains the newest twelve, and supports deletion', async () => {
  const fixture = await harness('Local screenshot storage')
  try {
    await fixture.page.addScriptTag({ content: `${storeSource}\nwindow.__captureStore = { saveCapture, getCapture, listCaptures, deleteCapture };` })
    const result = await fixture.page.evaluate(async () => {
      const storage = window.__captureStore
      for (let i = 0; i < 14; i += 1) await storage.saveCapture({
        id: `capture-${i}`, name: `Screenshot ${i}`, createdAt: i, mode: 'visible', width: 1, height: 1,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
      })
      const history = await storage.listCaptures(12)
      const removedOldest = await storage.getCapture('capture-0')
      const newest = await storage.getCapture('capture-13')
      await storage.deleteCapture('capture-13')
      return { ids: history.map((record) => record.id), removedOldest, newest: newest?.name, afterDelete: await storage.getCapture('capture-13') }
    })
    assert.deepEqual(result.ids, Array.from({ length: 12 }, (_, index) => `capture-${13 - index}`))
    assert.equal(result.removedOldest, undefined)
    assert.equal(result.newest, 'Screenshot 13')
    assert.equal(result.afterDelete, undefined)
  } finally { await fixture.close() }
})
