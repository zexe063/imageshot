export type ExportFormat = 'png' | 'jpg' | 'webp' | 'pdf'
export type PdfPageSize = 'auto' | 'image' | 'a4'

export interface PdfExportOptions {
  pageSize?: PdfPageSize
  /** Unscaled composition dimensions; export scale changes resolution, not paper size. */
  originalSize?: { width: number; height: number }
}

const encoder = new TextEncoder()
const asBytes = (text: string) => encoder.encode(text)

function checkCanvas(canvas: HTMLCanvasElement): void {
  if (!canvas.width || !canvas.height) throw new Error('The canvas is empty. Add a screenshot before exporting.')
  if (Math.max(canvas.width, canvas.height) > 32_760 || canvas.width * canvas.height > 100_000_000) throw new Error('This canvas is too large to export. Try a smaller screenshot.')
}

/**
 * Encode with the browser's own raster encoder. A format the browser cannot handle
 * silently falls back to PNG, so the returned type is checked to keep the file
 * extension honest.
 */
function imageBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('The browser could not export this canvas. Try a smaller image.'))
        else if (blob.type !== mime) reject(new Error(`${mime.replace('image/', '').toUpperCase()} export is not supported in this browser. Use PNG instead.`))
        else resolve(blob)
      }, mime, 0.95)
    } catch {
      reject(new Error('This image cannot be exported. Import the image as a local file and try again.'))
    }
  })
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return imageBlob(canvas, 'image/png')
}

/** JPEG has no alpha channel, so anything transparent is flattened onto white. */
function jpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const context = canvas.getContext('2d')
  if (context) {
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.globalCompositeOperation = 'source-over'
  }
  return imageBlob(canvas, 'image/jpeg')
}

function webpBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return imageBlob(canvas, 'image/webp')
}

/** Compress RGB and alpha in small strips instead of allocating a second full image. */
async function imageStreams(canvas: HTMLCanvasElement): Promise<{ rgb: Uint8Array<ArrayBuffer>; alpha?: Uint8Array<ArrayBuffer> }> {
  if (typeof CompressionStream === 'undefined') throw new Error('PDF export needs a current version of Chrome, Edge, or Firefox.')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser could not read this canvas for PDF export.')
  const rgbStream = new CompressionStream('deflate')
  const alphaStream = new CompressionStream('deflate')
  const rgbWriter = rgbStream.writable.getWriter()
  const alphaWriter = alphaStream.writable.getWriter()
  const rgbResult = new Response(rgbStream.readable).arrayBuffer()
  const alphaResult = new Response(alphaStream.readable).arrayBuffer()
  // Attach rejection handlers immediately; aborting a writer also rejects its reader.
  void rgbResult.catch(() => undefined)
  void alphaResult.catch(() => undefined)
  let hasTransparency = false
  let lastYield = performance.now()
  const stripHeight = Math.max(1, Math.min(256, Math.floor(524_288 / canvas.width)))
  try {
    for (let top = 0; top < canvas.height; top += stripHeight) {
      const height = Math.min(stripHeight, canvas.height - top)
      const rgba = context.getImageData(0, top, canvas.width, height).data
      const pixels = canvas.width * height
      const rgb = new Uint8Array(pixels * 3)
      const alpha = new Uint8Array(pixels)
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const source = pixel * 4
        const destination = pixel * 3
        rgb[destination] = rgba[source]
        rgb[destination + 1] = rgba[source + 1]
        rgb[destination + 2] = rgba[source + 2]
        alpha[pixel] = rgba[source + 3]
        if (alpha[pixel] !== 255) hasTransparency = true
      }
      await Promise.all([rgbWriter.write(rgb), alphaWriter.write(alpha)])
      // Large captures can contain millions of pixels. Give the browser time to
      // paint progress and process input between strips, including fast writers.
      if (performance.now() - lastYield >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        lastYield = performance.now()
      }
    }
    await Promise.all([rgbWriter.close(), alphaWriter.close()])
    const [rgb, alpha] = await Promise.all([rgbResult, alphaResult])
    return { rgb: new Uint8Array(rgb), alpha: hasTransparency ? new Uint8Array(alpha) : undefined }
  } catch (error) {
    await Promise.allSettled([rgbWriter.abort(error), alphaWriter.abort(error)])
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new Error('This image cannot be exported. Import the image as a local file and try again.')
    }
    throw error
  }
}

/** Standard A4 dimensions in PDF points (72 points per inch). */
const A4_SHORT = 595.276
const A4_LONG = 841.89
const POINTS_PER_PIXEL = 72 / 96
// PDF 1.4 readers support a maximum page side of 200 inches. Keep the bitmap
// intact and uniformly reduce its physical placement for very long screenshots.
const MAX_PDF_POINTS = 14_400

function pdfLayout(canvas: HTMLCanvasElement, options: PdfExportOptions) {
  const original = options.originalSize ?? canvas
  if (![original.width, original.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('PDF image dimensions must be positive, finite numbers.')
  }
  const pageSize = options.pageSize ?? 'auto'
  if (pageSize !== 'auto' && pageSize !== 'image' && pageSize !== 'a4') throw new Error('Choose Full image, Original size, or A4 for the PDF page.')
  if (pageSize === 'auto' || pageSize === 'image') {
    // Full image uses a conventional reading width and an unrestricted aspect
    // ratio. Only the physical page shrinks; every source pixel stays embedded.
    const pointsPerPixel = Math.min(
      POINTS_PER_PIXEL,
      pageSize === 'auto' ? A4_SHORT / original.width : Infinity,
      MAX_PDF_POINTS / Math.max(original.width, original.height),
    )
    const pageWidth = original.width * pointsPerPixel
    const pageHeight = original.height * pointsPerPixel
    return { pageWidth, pageHeight, imageWidth: pageWidth, imageHeight: pageHeight, x: 0, y: 0 }
  }
  const landscape = original.width > original.height
  const pageWidth = landscape ? A4_LONG : A4_SHORT
  const pageHeight = landscape ? A4_SHORT : A4_LONG
  const fit = Math.min(pageWidth / original.width, pageHeight / original.height)
  const imageWidth = original.width * fit
  const imageHeight = original.height * fit
  return { pageWidth, pageHeight, imageWidth, imageHeight, x: (pageWidth - imageWidth) / 2, y: (pageHeight - imageHeight) / 2 }
}

/**
 * A PDF 1.4 image XObject and soft mask preserve every rendered pixel and its alpha.
 *
 * The default page follows the image's proportions at up to A4 width. Original
 * size uses 96 pixels per inch; A4 fits and centers the whole image on one sheet.
 * No page option crops or stretches the composition.
 * The full-resolution bitmap is embedded without JPEG compression or downsampling.
 */
async function pdfBlob(canvas: HTMLCanvasElement, options: PdfExportOptions): Promise<Blob> {
  const { pageWidth, pageHeight, imageWidth, imageHeight, x, y } = pdfLayout(canvas, options)
  const { rgb, alpha } = await imageStreams(canvas)
  const width = canvas.width
  const height = canvas.height
  const point = (value: number) => Number(value.toFixed(6)).toString()
  // 1 catalog, 2 page tree, 3 the page, 4 the image, 5 its soft mask, 6 the content.
  const imageId = 4
  const alphaId = alpha ? imageId + 1 : undefined
  const contentId = alpha ? imageId + 2 : imageId + 1
  const parts: Uint8Array<ArrayBuffer>[] = [asBytes('%PDF-1.4\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  const offsets: number[] = [0]
  let length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const append = (part: Uint8Array<ArrayBuffer>) => {
    parts.push(part)
    length += part.byteLength
  }
  const object = (id: number, body: Uint8Array<ArrayBuffer>[]) => {
    offsets[id] = length
    append(asBytes(`${id} 0 obj\n`))
    for (const part of body) append(part)
    append(asBytes('\nendobj\n'))
  }
  const stream = (dictionary: string, data: Uint8Array<ArrayBuffer>) => [
    asBytes(`<< ${dictionary} /Length ${data.byteLength} >>\nstream\n`), data, asBytes('\nendstream'),
  ]
  object(1, [asBytes('<< /Type /Catalog /Pages 2 0 R >>')])
  object(2, [asBytes(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`)])
  object(3, [asBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${point(pageWidth)} ${point(pageHeight)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)])
  object(imageId, stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode${alphaId ? ` /SMask ${alphaId} 0 R` : ''}`, rgb))
  if (alpha && alphaId) object(alphaId, stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, alpha))
  object(contentId, stream('', asBytes(`q\n${point(imageWidth)} 0 0 ${point(imageHeight)} ${point(x)} ${point(y)} cm\n/Im0 Do\nQ\n`)))
  const xrefOffset = length
  const count = offsets.length
  append(asBytes(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`))
  return new Blob(parts, { type: 'application/pdf' })
}

export async function createExportBlob(canvas: HTMLCanvasElement, format: ExportFormat, pdfOptions: PdfExportOptions = {}): Promise<Blob> {
  checkCanvas(canvas)
  if (format === 'pdf') return pdfBlob(canvas, pdfOptions)
  if (format === 'jpg') return jpegBlob(canvas)
  if (format === 'webp') return webpBlob(canvas)
  return pngBlob(canvas)
}

function supportsClipboardType(type: string): boolean {
  try {
    // Chromium supported custom web formats before ClipboardItem.supports existed.
    return typeof ClipboardItem.supports === 'function' ? ClipboardItem.supports(type) : type === 'image/png' || type === 'web application/pdf'
  } catch {
    return false
  }
}

export async function copyExport(canvas: HTMLCanvasElement, format: 'png' | 'pdf'): Promise<string> {
  const label = format.toUpperCase()
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error(`Clipboard is unavailable in this browser. Use Export ${label} to save the file.`)
  }
  let mimeType = format === 'png' ? 'image/png' : 'application/pdf'
  let customPdf = false
  if (!supportsClipboardType(mimeType)) {
    if (format === 'pdf' && supportsClipboardType('web application/pdf')) {
      mimeType = 'web application/pdf'
      customPdf = true
    } else {
      throw new Error(`${label} clipboard is not supported in this browser. Use Export ${label} instead.`)
    }
  }
  try {
    // Passing a promise immediately keeps the copy operation inside the original
    // click's user activation, even when encoding a large image takes time.
    const item = new ClipboardItem({ [mimeType]: createExportBlob(canvas, format) })
    await navigator.clipboard.write([item])
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error(`Clipboard access was blocked. Allow clipboard access or use Export ${label}.`)
    }
    if (error instanceof DOMException && ['NotSupportedError', 'DataError'].includes(error.name)) {
      throw new Error(`This browser could not copy ${label} data. Use Export ${label} instead.`)
    }
    if (error instanceof Error) throw error
    throw new Error(`Could not copy ${label}. Use Export ${label} instead.`)
  }
  return customPdf
    ? 'PDF copied as browser data. Paste into a web app that supports PDF clipboard data.'
    : `${label} copied to clipboard.`
}
