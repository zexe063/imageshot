import { saveCapture, type CaptureMode, type CaptureRecord, type CaptureTile } from '../lib/capture-store'

const MAX_PIXELS = 48_000_000
const MAX_DIMENSION = 32_760
const MAX_TILES = 40
const MAX_ENCODED_BYTES = 56_000_000
let capturing = false
let lastCaptureAt = 0

interface PageMetrics {
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  captureWidth: number
  captureHeight: number
  scrollX: number
  scrollY: number
}

interface PageCaptureState {
  fixed: HTMLElement[]
  cancelled: boolean
  cleanup: () => void
}

type CaptureWindow = Window & { __imageshotCaptureState?: PageCaptureState }

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/cannot access|missing host permission|extensions gallery|cannot be scripted|chrome:\/\//i.test(message)) {
    return 'This browser page cannot be captured. Open a regular website and try again.'
  }
  if (/No tab with id|frame was removed|Receiving end does not exist|tab was closed/i.test(message)) {
    return 'The page was closed or changed during capture. Open ImageShot on the page and try again.'
  }
  if (/quota|storage is full/i.test(message)) return 'Local screenshot storage is full. Remove an older screenshot or free some disk space, then try again.'
  return message || 'The screenshot could not be captured. Please try again.'
}

async function activeCaptureTab(): Promise<chrome.tabs.Tab & { id: number }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('Open the webpage you want to capture first.')
  const url = tab.url ?? ''
  if (!/^(https?:|file:)/i.test(url) || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(url)) {
    throw new Error('This browser page cannot be captured. Open a regular website and try again.')
  }
  return tab as chrome.tabs.Tab & { id: number }
}

async function assertSameTab(tab: chrome.tabs.Tab & { id: number }): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
  if (active?.id !== tab.id) throw new Error('Capture stopped because you switched tabs. Keep the page active until the screenshot opens.')
  const current = await chrome.tabs.get(tab.id)
  if (current.url && tab.url && current.url !== tab.url) throw new Error('The page changed during capture. Open ImageShot and try again.')
}

async function captureViewport(tab: chrome.tabs.Tab & { id: number }): Promise<string> {
  // Chromium allows two captureVisibleTab calls per second. Space every call,
  // including separate capture requests, safely beyond that rate limit.
  await delay(Math.max(0, 600 - (Date.now() - lastCaptureAt)))
  await assertSameTab(tab)
  lastCaptureAt = Date.now()
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  await assertSameTab(tab)
  return dataUrl
}

/** PNG dimensions are in IHDR; reading the header avoids decoding in the worker. */
function pngSize(dataUrl: string): { width: number; height: number } {
  const payload = dataUrl.split(',')[1]
  if (!payload || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('The browser returned an unreadable screenshot.')
  const header = atob(payload.slice(0, 44))
  const read = (offset: number) => (((header.charCodeAt(offset) << 24) >>> 0) + (header.charCodeAt(offset + 1) << 16) + (header.charCodeAt(offset + 2) << 8) + header.charCodeAt(offset + 3))
  const width = read(16)
  const height = read(20)
  if (!width || !height) throw new Error('The browser returned an empty screenshot.')
  return { width, height }
}

function checkSize(width: number, height: number): void {
  if (width < 1 || height < 1) throw new Error('This page has no visible content to capture.')
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('This capture is too large to save (48 megapixels or 32,760 pixels per side). Choose a smaller area and try again.')
  }
}

function recordFor(tab: chrome.tabs.Tab, mode: CaptureMode): Omit<CaptureRecord, 'width' | 'height'> {
  return {
    id: crypto.randomUUID(),
    name: (tab.title || 'Untitled screenshot').slice(0, 140),
    sourceUrl: tab.url,
    createdAt: Date.now(),
    mode,
  }
}

async function captureVisible(tab: chrome.tabs.Tab & { id: number }): Promise<CaptureRecord> {
  const dataUrl = await captureViewport(tab)
  const dimensions = pngSize(dataUrl)
  checkSize(dimensions.width, dimensions.height)
  return { ...recordFor(tab, 'visible'), ...dimensions, dataUrl }
}

/** Runs in the tab's isolated world. Keep every browser dependency inside it. */
async function selectArea(): Promise<{ x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number } | null> {
  if (document.querySelector('[data-imageshot-selector]')) throw new Error('An area selection is already open. Press Escape to close it.')
  return new Promise((resolve, reject) => {
    const host = document.createElement('div')
    host.setAttribute('data-imageshot-selector', '')
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;'
    const shadow = host.attachShadow({ mode: 'closed' })
    shadow.innerHTML = `<style>
      :host { color-scheme:light; }
      * { box-sizing:border-box; }
      .overlay { position:fixed;inset:0;background:rgba(23,24,40,.32);cursor:crosshair;touch-action:none;font-family:Inter,system-ui,-apple-system,sans-serif;user-select:none; }
      .tip { position:fixed;top:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;white-space:nowrap;background:white;color:#27243b;border:1px solid #eeeaf4;border-radius:14px;padding:13px 17px;box-shadow:0 8px 32px #19132e26;font-size:13px;line-height:20px;pointer-events:none; }
      .mark { width:24px;height:24px;display:grid;place-items:center;color:#7755dc;background:#f1ecff;border-radius:7px;font-size:16px; }
      .tip strong { font-weight:600; }
      .key { border:1px solid #e5e3ec;border-radius:5px;padding:1px 5px;font-size:11px;color:#8a8798; }
      .selection { display:none;position:fixed;border:1.5px solid #fff;outline:1px solid #8162e8;box-shadow:0 0 0 99999px rgba(23,24,40,.40);pointer-events:none; }
      .dimensions { position:absolute;bottom:calc(100% + 9px);left:0;border-radius:6px;background:#292336;color:white;padding:4px 8px;font-size:11px;font-weight:500;white-space:nowrap; }
    </style><div class="overlay"><div class="tip"><span class="mark">⌗</span><strong>Drag to capture an area</strong><span class="key">esc</span><span>to cancel</span></div><div class="selection"><span class="dimensions"></span></div></div>`
    const overlay = shadow.querySelector('.overlay') as HTMLDivElement
    const selection = shadow.querySelector('.selection') as HTMLDivElement
    const dimensions = shadow.querySelector('.dimensions') as HTMLSpanElement
    const tip = shadow.querySelector('.tip') as HTMLDivElement
    let start: { x: number; y: number } | null = null
    let rectangle = { x: 0, y: 0, width: 0, height: 0 }
    let finished = false
    const stopScroll = (event: Event) => event.preventDefault()
    const cleanup = () => {
      clearTimeout(timeout)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', stopScroll, true)
      host.remove()
    }
    const finish = async (cancelled: boolean) => {
      if (finished) return
      finished = true
      const result = { ...rectangle, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
      cleanup()
      // Wait for the compositor to remove selection UI before taking the image.
      await new Promise<void>((done) => {
        const fallback = setTimeout(done, 120)
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(fallback); done() }))
      })
      await new Promise<void>((done) => setTimeout(done, 80))
      resolve(cancelled ? null : result)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        void finish(true)
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.preventDefault()
    }
    const update = (event: PointerEvent) => {
      if (!start) return
      const endX = Math.max(0, Math.min(window.innerWidth, event.clientX))
      const endY = Math.max(0, Math.min(window.innerHeight, event.clientY))
      rectangle = { x: Math.min(start.x, endX), y: Math.min(start.y, endY), width: Math.abs(endX - start.x), height: Math.abs(endY - start.y) }
      Object.assign(selection.style, { display: 'block', left: `${rectangle.x}px`, top: `${rectangle.y}px`, width: `${rectangle.width}px`, height: `${rectangle.height}px` })
      dimensions.textContent = `${Math.round(rectangle.width)} × ${Math.round(rectangle.height)}`
      dimensions.style.bottom = rectangle.y < 35 ? 'auto' : 'calc(100% + 9px)'
      dimensions.style.top = rectangle.y < 35 ? 'calc(100% + 9px)' : 'auto'
    }
    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      start = { x: Math.max(0, Math.min(window.innerWidth, event.clientX)), y: Math.max(0, Math.min(window.innerHeight, event.clientY)) }
      overlay.setPointerCapture(event.pointerId)
      overlay.style.background = 'transparent'
      tip.style.display = 'none'
      update(event)
    })
    overlay.addEventListener('pointermove', update)
    overlay.addEventListener('pointerup', (event) => {
      if (!start) return
      update(event)
      if (rectangle.width < 6 || rectangle.height < 6) {
        start = null
        selection.style.display = 'none'
        tip.style.display = 'flex'
        overlay.style.background = 'rgba(23,24,40,.32)'
        return
      }
      void finish(false)
    })
    overlay.addEventListener('pointercancel', () => void finish(true))
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', stopScroll, { capture: true, passive: false })
    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('Area selection timed out. Open ImageShot to try again.'))
    }, 120_000)
    document.documentElement.appendChild(host)
  })
}

async function captureArea(tab: chrome.tabs.Tab & { id: number }): Promise<CaptureRecord> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectArea })
  const selection = injection?.result
  if (!selection) throw new Error('Capture cancelled.')
  const dataUrl = await captureViewport(tab)
  const bitmap = pngSize(dataUrl)
  const scaleX = bitmap.width / selection.viewportWidth
  const scaleY = bitmap.height / selection.viewportHeight
  const sourceX = Math.round(selection.x * scaleX)
  const sourceY = Math.round(selection.y * scaleY)
  const width = Math.min(bitmap.width - sourceX, Math.round(selection.width * scaleX))
  const height = Math.min(bitmap.height - sourceY, Math.round(selection.height * scaleY))
  checkSize(width, height)
  return { ...recordFor(tab, 'area'), width, height, tiles: [{ dataUrl, sourceX, sourceY, sourceWidth: width, sourceHeight: height, x: 0, y: 0, width, height }] }
}

async function beginPageCapture(): Promise<PageMetrics> {
  const scope = window as CaptureWindow
  if (scope.__imageshotCaptureState) throw new Error('This page is already being captured.')
  if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.01) throw new Error('Reset pinch zoom before taking a full-page screenshot.')
  const originalScroll = { x: window.scrollX, y: window.scrollY }
  const style = document.createElement('style')
  style.textContent = 'html,body,*{scroll-behavior:auto!important;overflow-anchor:none!important}*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}'
  document.documentElement.appendChild(style)
  const originals: { element: HTMLElement; properties: { name: string; value: string; priority: string }[] }[] = []
  const fixed: HTMLElement[] = []
  const remember = (element: HTMLElement, names: string[]) => originals.push({ element, properties: names.map((name) => ({ name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) })) })
  const stopScroll = (event: Event) => event.preventDefault()
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      state.cancelled = true
      event.preventDefault()
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.preventDefault()
  }
  let watchdog = 0
  const state: PageCaptureState = {
    fixed,
    cancelled: false,
    cleanup: () => {
      clearTimeout(watchdog)
      for (const entry of originals) {
        for (const property of entry.properties) {
          if (property.value) entry.element.style.setProperty(property.name, property.value, property.priority)
          else entry.element.style.removeProperty(property.name)
        }
      }
      window.removeEventListener('wheel', stopScroll, true)
      window.removeEventListener('touchmove', stopScroll, true)
      window.removeEventListener('keydown', onKey, true)
      window.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: 'instant' })
      style.remove()
      delete scope.__imageshotCaptureState
    },
  }
  scope.__imageshotCaptureState = state
  // Recover page styles even if the extension is reloaded or the worker exits.
  watchdog = window.setTimeout(() => state.cleanup(), 90_000)
  try {
    for (const element of document.querySelectorAll<HTMLElement>('body, body *')) {
      const position = getComputedStyle(element).position
      if (position === 'fixed') {
        remember(element, ['visibility'])
        fixed.push(element)
      } else if (position === 'sticky') {
        // Keep sticky content in its natural document position exactly once.
        remember(element, ['position', 'top', 'right', 'bottom', 'left'])
        element.style.setProperty('position', 'relative', 'important')
        for (const side of ['top', 'right', 'bottom', 'left']) element.style.setProperty(side, 'auto', 'important')
      }
    }
    window.addEventListener('wheel', stopScroll, { capture: true, passive: false })
    window.addEventListener('touchmove', stopScroll, { capture: true, passive: false })
    window.addEventListener('keydown', onKey, true)
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(resolve, 120)
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(fallback); resolve() }))
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 160))
    const root = document.documentElement
    const body = document.body
    return {
      width: Math.max(root.scrollWidth, body?.scrollWidth ?? 0, root.clientWidth),
      height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0, root.clientHeight),
      viewportWidth: root.clientWidth || window.innerWidth,
      viewportHeight: root.clientHeight || window.innerHeight,
      captureWidth: window.innerWidth,
      captureHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }
  } catch (error) {
    state.cleanup()
    throw error
  }
}

async function movePageCapture(x: number, y: number, hideFixed: boolean): Promise<PageMetrics> {
  const state = (window as CaptureWindow).__imageshotCaptureState
  if (!state) throw new Error('Capture timed out. Please try a smaller area.')
  if (state.cancelled) throw new Error('Capture cancelled.')
  if (hideFixed) for (const element of state.fixed) element.style.setProperty('visibility', 'hidden', 'important')
  window.scrollTo({ left: x, top: y, behavior: 'instant' })
  await new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 120)
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(fallback); resolve() }))
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 160))
  if (state.cancelled) throw new Error('Capture cancelled.')
  const root = document.documentElement
  const body = document.body
  return {
    width: Math.max(root.scrollWidth, body?.scrollWidth ?? 0, root.clientWidth),
    height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0, root.clientHeight),
    viewportWidth: root.clientWidth || window.innerWidth,
    viewportHeight: root.clientHeight || window.innerHeight,
    captureWidth: window.innerWidth,
    captureHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }
}

function finishPageCapture(): void {
  ;(window as CaptureWindow).__imageshotCaptureState?.cleanup()
}

async function captureFullPage(tab: chrome.tabs.Tab & { id: number }): Promise<CaptureRecord> {
  const tiles: CaptureTile[] = []
  let prepared = false
  try {
    const [begin] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: beginPageCapture })
    const initial = begin?.result
    if (!initial) throw new Error('Could not prepare this webpage for capture.')
    prepared = true
    let height = initial.height
    const width = initial.width
    let scaleX = 0
    let scaleY = 0
    let totalBytes = 0
    let y = 0
    while (y < height) {
      let rowHeight = Math.min(initial.viewportHeight, height - y)
      for (let x = 0; x < width; x += initial.viewportWidth) {
        if (tiles.length >= MAX_TILES) throw new Error('This page is too long or keeps loading new content. Capture a smaller area or the visible page instead.')
        await assertSameTab(tab)
        const [step] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: movePageCapture, args: [x, y, tiles.length > 0] })
        const metrics = step?.result
        if (!metrics) throw new Error('The page stopped responding during capture.')
        if (metrics.captureWidth !== initial.captureWidth || metrics.captureHeight !== initial.captureHeight || metrics.viewportWidth !== initial.viewportWidth || metrics.viewportHeight !== initial.viewportHeight) {
          throw new Error('The browser was resized during capture. Keep its size unchanged and try again.')
        }
        if (Math.abs(metrics.width - width) > 2) throw new Error('This page changed its layout during capture. Wait for it to finish loading, then try again.')
        height = Math.max(height, metrics.height)
        if (x === 0) rowHeight = Math.min(initial.viewportHeight, height - y)
        const dataUrl = await captureViewport(tab)
        const bitmap = pngSize(dataUrl)
        const currentScaleX = bitmap.width / initial.captureWidth
        const currentScaleY = bitmap.height / initial.captureHeight
        if (scaleX && (Math.abs(scaleX - currentScaleX) > 0.01 || Math.abs(scaleY - currentScaleY) > 0.01)) throw new Error('Display scaling changed during capture. Keep the browser on the same display and try again.')
        scaleX = currentScaleX
        scaleY = currentScaleY
        // No canvas exists yet: the editor shrinks the composed image to fit, so an
        // over-long page is captured at full resolution instead of being refused.
        totalBytes += dataUrl.length * 0.75
        if (totalBytes > MAX_ENCODED_BYTES) throw new Error('This image-heavy page is too large to capture at once. Choose a smaller area instead.')
        const pieceWidth = Math.min(initial.viewportWidth, width - x)
        const sourceX = Math.round((x - metrics.scrollX) * scaleX)
        const sourceY = Math.round((y - metrics.scrollY) * scaleY)
        const tileX = Math.round(x * scaleX)
        const tileY = Math.round(y * scaleY)
        const tileWidth = Math.round((x + pieceWidth) * scaleX) - tileX
        const tileHeight = Math.round((y + rowHeight) * scaleY) - tileY
        if (sourceX < -1 || sourceY < -1 || sourceX + tileWidth > bitmap.width + 1 || sourceY + tileHeight > bitmap.height + 1) {
          throw new Error('This page uses a scrolling layout that cannot be stitched reliably. Use Visible page or Area instead.')
        }
        tiles.push({ dataUrl, sourceX: Math.max(0, sourceX), sourceY: Math.max(0, sourceY), sourceWidth: Math.min(tileWidth, bitmap.width - Math.max(0, sourceX)), sourceHeight: Math.min(tileHeight, bitmap.height - Math.max(0, sourceY)), x: tileX, y: tileY, width: tileWidth, height: tileHeight })
      }
      y += rowHeight
      // Re-check after capture: lazy content may extend the document while the
      // browser encodes the PNG. Advancing by rowHeight keeps partial rows gapless.
      const [latest] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      })
      height = Math.max(height, latest?.result ?? height)
    }
    return { ...recordFor(tab, 'full'), width: Math.round(width * scaleX), height: Math.round(height * scaleY), tiles }
  } finally {
    if (prepared) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: finishPageCapture })
      } catch {
        // Navigation removes the old document, including its temporary styles.
      }
    }
  }
}

async function showCaptureError(tabId: number, message: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (text: string) => {
        document.querySelector('[data-imageshot-notice]')?.remove()
        const host = document.createElement('div')
        host.setAttribute('data-imageshot-notice', '')
        host.style.cssText = 'all:initial!important;position:fixed!important;bottom:24px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:calc(100vw - 48px)!important;'
        const shadow = host.attachShadow({ mode: 'closed' })
        const box = document.createElement('div')
        box.setAttribute('role', 'alert')
        box.style.cssText = 'font:13px/1.6 system-ui,sans-serif;color:#322b40;background:white;border:1px solid #e7e2ee;border-radius:12px;box-shadow:0 8px 35px #25184325;padding:14px 20px;max-width:460px;'
        const heading = document.createElement('strong')
        heading.textContent = 'ImageShot · '
        box.append(heading, document.createTextNode(text))
        shadow.appendChild(box)
        document.documentElement.appendChild(host)
        setTimeout(() => host.remove(), 8500)
      },
      args: [message],
    })
  } catch {
    // The popup also receives the error if the page cannot be scripted.
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'IMAGESHOT_CAPTURE') return false
  if (sender.id !== chrome.runtime.id) return false
  const mode = 'mode' in message ? message.mode : undefined
  if (mode !== 'area' && mode !== 'visible' && mode !== 'full') {
    sendResponse({ ok: false, error: 'Choose an area, visible page, or full page capture.' })
    return false
  }
  if (capturing) {
    sendResponse({ ok: false, error: 'A capture is already in progress. Finish it or press Escape on the page.' })
    return false
  }
  capturing = true
  let tabId: number | undefined
  void (async () => {
    try {
      const tab = await activeCaptureTab()
      tabId = tab.id
      const record = mode === 'area' ? await captureArea(tab) : mode === 'full' ? await captureFullPage(tab) : await captureVisible(tab)
      await saveCapture(record)
      await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?capture=${encodeURIComponent(record.id)}`) })
      sendResponse({ ok: true, id: record.id })
    } catch (error) {
      const message = readableError(error)
      if (tabId && message !== 'Capture cancelled.') await showCaptureError(tabId, message)
      sendResponse({ ok: false, error: message })
    } finally {
      capturing = false
    }
  })()
  return true
})
