/** Captures stay in this extension's IndexedDB; no screenshot leaves the device. */
export type CaptureMode = 'area' | 'visible' | 'full'

export interface CaptureTile {
  dataUrl: string
  /** Source rectangle in the captured viewport bitmap. */
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  /** Destination rectangle in the final bitmap. */
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureRecord {
  id: string
  name: string
  sourceUrl?: string
  createdAt: number
  mode: CaptureMode
  width: number
  height: number
  dataUrl?: string
  tiles?: CaptureTile[]
}

const DATABASE_NAME = 'imageshot-local'
const STORE_NAME = 'captures'
const KEEP_CAPTURES = 12

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex('createdAt', 'createdAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local screenshot storage.'))
    request.onblocked = () => reject(new Error('Local screenshot storage is busy. Close other ImageShot tabs and try again.'))
  })
}

export async function saveCapture(record: CaptureRecord): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      store.put(record)
      // Keep a bounded history without reading every screenshot back into memory.
      let count = 0
      const cursor = store.index('createdAt').openKeyCursor(null, 'prev')
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (!entry) return
        count += 1
        if (count > KEEP_CAPTURES) store.delete(entry.primaryKey)
        entry.continue()
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the screenshot locally.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Screenshot storage is full. Remove an older screenshot and try again.'))
    })
  } finally {
    database.close()
  }
}

export async function getCapture(id: string): Promise<CaptureRecord | undefined> {
  const database = await openDatabase()
  try {
    return await new Promise<CaptureRecord | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve(request.result as CaptureRecord | undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not load this screenshot.'))
    })
  } finally {
    database.close()
  }
}

export async function listCaptures(limit = 8): Promise<CaptureRecord[]> {
  const database = await openDatabase()
  const boundedLimit = Math.max(0, Math.min(KEEP_CAPTURES, Math.floor(limit)))
  try {
    return await new Promise<CaptureRecord[]>((resolve, reject) => {
      const records: CaptureRecord[] = []
      if (!boundedLimit) return resolve(records)
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('createdAt').openCursor(null, 'prev')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || records.length >= boundedLimit) return resolve(records)
        records.push(cursor.value as CaptureRecord)
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('Could not load recent screenshots.'))
    })
  } finally {
    database.close()
  }
}

export async function deleteCapture(id: string): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove the screenshot.'))
    })
  } finally {
    database.close()
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('One of the screenshot images could not be decoded.'))
    img.src = dataUrl
  })
}

/**
 * Chrome refuses a 2D canvas past 32,767 px on a side, and past roughly 48 megapixels
 * it runs the tab out of memory. `MAX_OUTPUT_SIDE` leaves headroom for composition
 * padding. A capture that does not fit is shrunk rather than refused, so a very long
 * page still opens.
 */
const MAX_OUTPUT_PIXELS = 48_000_000
const MAX_OUTPUT_SIDE = 32_000

/** The scale a capture is reduced by to fit one canvas. 1 means it fits as captured. */
export function captureFitScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 1
  return Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)), MAX_OUTPUT_SIDE / width, MAX_OUTPUT_SIDE / height)
}

/** Run in the editor document: only decode one tile at a time to bound memory. */
export async function materializeCapture(record: CaptureRecord): Promise<string> {
  if (record.dataUrl) return record.dataUrl
  if (!record.tiles?.length) throw new Error('This screenshot has no image data.')
  if (record.width < 1 || record.height < 1) throw new Error('This screenshot has no image data.')
  // The tiles keep their full resolution, so reducing the composed image costs export
  // detail rather than discarding the capture.
  const scale = captureFitScale(record.width, record.height)
  const width = Math.max(1, Math.floor(record.width * scale))
  const height = Math.max(1, Math.floor(record.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Your browser could not create the screenshot canvas.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  try {
    for (const tile of record.tiles) {
      const img = await loadImage(tile.dataUrl)
      // Scale every edge independently, the way the capture loop places tiles, so
      // neighbours stay flush and no seam opens between them.
      const x = Math.round(tile.x * scale)
      const y = Math.round(tile.y * scale)
      context.drawImage(img, tile.sourceX, tile.sourceY, tile.sourceWidth, tile.sourceHeight, x, y, Math.max(1, Math.round((tile.x + tile.width) * scale) - x), Math.max(1, Math.round((tile.y + tile.height) * scale) - y))
      img.src = ''
    }
    const dataUrl = canvas.toDataURL('image/png')
    if (dataUrl === 'data:,') throw new Error('The browser could not render a screenshot this large.')
    return dataUrl
  } finally {
    // Release the large backing surface as soon as the combined image is encoded.
    canvas.width = 1
    canvas.height = 1
  }
}
