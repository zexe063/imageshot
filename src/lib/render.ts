import type { Annotation, CompositionSize, CompositionStyle } from './editor-types';
import { DEFAULT_STYLE } from './editor-types';

/** Height of the fake browser chrome drawn above the screenshot. */
export const FRAME_HEADER = 40;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const MAX_PIXELS = 64_000_000;
const MAX_SIDE = 32_000;

function safeDimension(value: number) {
  if (!Number.isFinite(value) || value < 1) return 0;
  return Math.max(1, Math.min(MAX_SIDE, Math.floor(value)));
}

function styleNumber(value: number | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The two families the app ships, so the canvas never guesses a missing face. */
export const TEXT_FAMILIES = ['Inter', 'Geist'] as const;
export type TextFamily = (typeof TEXT_FAMILIES)[number];
const TEXT_STACKS: Record<TextFamily, string> = {
  Inter: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  Geist: '"Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
const TEXT_WEIGHTS = [400, 500, 600, 700] as const;

export function textStack(family?: string) {
  return TEXT_STACKS[(family as TextFamily) ?? 'Inter'] ?? TEXT_STACKS.Inter;
}

/** Every text metric in one place, so the preview, the editor and the export agree. */
export function textMetrics(annotation: Annotation) {
  const size = styleNumber(annotation.fontSize, 28) || 28;
  const weight = TEXT_WEIGHTS.includes(annotation.fontWeight as (typeof TEXT_WEIGHTS)[number]) ? annotation.fontWeight! : 600;
  const lineHeight = styleNumber(annotation.lineHeight, 1.3) || 1.3;
  const letterSpacing = styleNumber(annotation.letterSpacing, 0);
  const align = annotation.align ?? 'left';
  return {
    size,
    weight,
    lineHeight,
    letterSpacing,
    align,
    lines: (annotation.text || '').split('\n'),
    lineStep: size * lineHeight,
    font: `${weight} ${size}px ${textStack(annotation.fontFamily)}`,
  };
}

let measuringContext: CanvasRenderingContext2D | null | undefined;
/** One shared offscreen context, so measuring text allocates nothing per call. */
function textContext() {
  if (measuringContext === undefined) measuringContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  return measuringContext;
}

/** Letter spacing has no canvas equivalent, so the advance is summed per character. */
function measureLine(context: CanvasRenderingContext2D | null, line: string, letterSpacing: number) {
  if (!context) return line.length * 8;
  if (!letterSpacing) return context.measureText(line).width;
  let total = 0;
  for (const character of line) total += context.measureText(character).width + letterSpacing;
  return Math.max(0, total - letterSpacing);
}

/** The box the text needs, used for both drawing and the selection frame. */
export function textFrame(annotation: Annotation) {
  const { size, lineHeight, lineStep, lines, letterSpacing, font } = textMetrics(annotation);
  const context = textContext();
  if (context) context.font = font;
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, measureLine(context, line, letterSpacing));
  return { width: Math.max(12, widest), height: Math.max(size * lineHeight, lines.length * lineStep) };
}

/** Fills one line, advancing by hand when the text carries letter spacing. */
function fillLine(context: CanvasRenderingContext2D, line: string, x: number, y: number, letterSpacing: number) {
  if (!letterSpacing) {
    context.fillText(line, x, y);
    return;
  }
  let cursor = x;
  for (const character of line) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + letterSpacing;
  }
}

export function getCompositionSize(image: HTMLImageElement, style: CompositionStyle = DEFAULT_STYLE): CompositionSize {
  const imageWidth = image?.naturalWidth || image?.width || 0;
  const imageHeight = image?.naturalHeight || image?.height || 0;
  const padding = Math.max(0, styleNumber(style?.padding));
  const stroke = Math.max(0, styleNumber(style?.strokeWidth));
  const header = style?.frame === 'browser' ? FRAME_HEADER : 0;
  return {
    width: imageWidth + (padding + stroke) * 2,
    height: imageHeight + (padding + stroke) * 2 + header,
    imageX: padding + stroke,
    imageY: padding + stroke + header,
    imageWidth,
    imageHeight,
  };
}

export function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function annotationBounds(annotation: Annotation) {
  if (annotation.type === 'text') {
    // The box always hugs the text. Dragging a text layer scales the type instead of
    // stretching a frame, so there is no stored width to honour here.
    return { x: annotation.x, y: annotation.y, ...textFrame(annotation) };
  }
  return {
    x: Math.min(annotation.x, annotation.x + annotation.width),
    y: Math.min(annotation.y, annotation.y + annotation.height),
    width: Math.max(1, Math.abs(annotation.width)),
    height: Math.max(1, Math.abs(annotation.height)),
  };
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation, source: HTMLImageElement) {
  if (annotation.hidden) return;
  const a = annotation;
  const box = annotationBounds(a);
  const opacity = clamp(styleNumber(a.opacity, 100), 0, 100);
  ctx.save();
  if (opacity < 100) ctx.globalAlpha = Math.max(0, Math.min(1, opacity / 100));
  ctx.strokeStyle = a.strokeColor || a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = Math.max(1, a.strokeWidth);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (a.type) {
    case 'rectangle':
      roundedPath(ctx, box.x, box.y, box.width, box.height, styleNumber(a.radius, 3));
      if (a.fill) { ctx.fillStyle = a.fill; ctx.fill(); }
      ctx.stroke();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
      if (a.fill) { ctx.fillStyle = a.fill; ctx.fill(); }
      ctx.stroke();
      break;
    case 'arrow': {
      const endX = a.x + a.width;
      const endY = a.y + a.height;
      const angle = Math.atan2(a.height, a.width);
      const head = Math.min(Math.hypot(a.width, a.height) * 0.5, Math.max(14, a.strokeWidth * 4));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(endX, endY);
      ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case 'pen': {
      const points = a.points || [];
      if (!points.length) break;
      ctx.beginPath();
      ctx.moveTo(a.x + points[0].x, a.y + points[0].y);
      if (points.length === 1) ctx.lineTo(a.x + points[0].x + 0.1, a.y + points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(a.x + points[i].x, a.y + points[i].y);
      ctx.stroke();
      break;
    }
    case 'text': {
      const { size, lineStep, lines, letterSpacing, align, font } = textMetrics(a);
      ctx.font = font;
      ctx.textBaseline = 'top';
      // Alignment is resolved to a left edge here, so spaced and unspaced text are
      // positioned by exactly the same maths.
      ctx.textAlign = 'left';
      const context = textContext();
      if (context) context.font = font;
      const frameWidth = textFrame(a).width;
      lines.forEach((line, index) => {
        const width = measureLine(context, line, letterSpacing);
        const left = align === 'center' ? a.x + (frameWidth - width) / 2 : align === 'right' ? a.x + frameWidth - width : a.x;
        fillLine(ctx, line, left, a.y + index * lineStep, letterSpacing);
      });
      break;
    }
    case 'highlight':
      ctx.globalAlpha *= 0.3;
      ctx.fillRect(box.x, box.y, box.width, box.height);
      break;
    case 'blur': {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      const sourceWidth = source.naturalWidth || source.width;
      const sourceHeight = source.naturalHeight || source.height;
      const x = Math.max(0, box.x);
      const y = Math.max(0, box.y);
      const w = Math.min(sourceWidth - x, box.width - Math.max(0, -box.x));
      const h = Math.min(sourceHeight - y, box.height - Math.max(0, -box.y));
      if (w <= 0 || h <= 0) break;
      const pixelSize = Math.max(10, a.strokeWidth * 4);
      const buffer = document.createElement('canvas');
      buffer.width = Math.max(1, Math.ceil(w / pixelSize));
      buffer.height = Math.max(1, Math.ceil(h / pixelSize));
      const bufferCtx = buffer.getContext('2d');
      if (!bufferCtx) break;
      bufferCtx.drawImage(source, x, y, w, h, 0, 0, buffer.width, buffer.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buffer, 0, 0, buffer.width, buffer.height, x, y, w, h);
      break;
    }
    case 'number': {
      ctx.shadowColor = 'transparent';
      const radius = Math.max(box.width, box.height) / 2;
      ctx.beginPath();
      ctx.arc(box.x + box.width / 2, box.y + box.height / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(radius * 0.95)}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(a.number || 1), box.x + box.width / 2, box.y + box.height / 2 + 1);
      break;
    }
  }
  ctx.restore();
}

function drawFrameHeader(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, header: number, radius: number, base: string) {
  ctx.save();
  roundedPath(ctx, x, y, width, header + radius, radius);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, width, header + radius);
  ctx.fillStyle = 'rgba(15, 18, 28, 0.06)';
  ctx.fillRect(x, y + header - 1, width, 1);
  const dotY = y + header / 2;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((color, index) => {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x + 18 + index * 15, dotY, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
  roundedPath(ctx, x + width / 2 - 96, dotY - 8, 192, 16, 8);
  ctx.fillStyle = 'rgba(15, 18, 28, 0.05)';
  ctx.fill();
  ctx.restore();
}

const HEX_COLOR = /^#([0-9a-f]{3,8})$/i;

function solidFrom(value: string) {
  const match = value.trim().match(HEX_COLOR);
  if (!match) return null;
  const digits = match[1];
  const expand = (part: string) => (part.length === 1 ? part + part : part);
  if (digits.length === 3) return `#${expand(digits[0])}${expand(digits[1])}${expand(digits[2])}`;
  if (digits.length === 6) return `#${digits}`;
  if (digits.length === 8) return `#${digits.slice(0, 6)}`;
  return null;
}

/** Canvas gradients ignore CSS `linear-gradient()` values, so presets are translated here. */
function paintFill(ctx: CanvasRenderingContext2D, value: string, box: { x: number; y: number; width: number; height: number }) {
  if (!value || value === 'transparent') return null;
  const gradient = value.match(/^linear-gradient\((.+)\)$/i);
  if (!gradient) return value;
  const parts = gradient[1].split(',').map(part => part.trim());
  const anglePart = parts[0].match(/^(-?[\d.]+)deg$/);
  const angle = anglePart ? (Number(anglePart[1]) * Math.PI) / 180 : Math.PI / 2;
  const stops = parts.slice(anglePart ? 1 : 0);
  if (!stops.length) return value;
  const radian = Math.sin(angle);
  const cosine = Math.cos(angle);
  const length = Math.abs(box.width * radian) + Math.abs(box.height * cosine);
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const created = ctx.createLinearGradient(
    centreX - (radian * length) / 2,
    centreY + (cosine * length) / 2,
    centreX + (radian * length) / 2,
    centreY - (cosine * length) / 2,
  );
  let fallback: string | null = null;
  stops.forEach((stop, index) => {
    const [color, offset] = stop.split(/\s+/);
    const solid = solidFrom(color);
    if (!fallback) fallback = solid;
    if (!solid) return;
    const parsedOffset = offset ? Number(offset.replace('%', '')) / 100 : index / Math.max(1, stops.length - 1);
    const position = Number.isFinite(parsedOffset) ? parsedOffset : index / Math.max(1, stops.length - 1);
    created.addColorStop(Math.max(0, Math.min(1, position)), solid);
  });
  return fallback ? created : value;
}

/** A solid stand-in for a gradient, used by the window frame header. */
function frameBaseColor(background: string) {
  if (!background || background === 'transparent') return '#ffffff';
  return solidFrom(background) || '#ffffff';
}


/** Renders padding, background, corner radius, frame and stroke around the original pixels. */
export function renderComposition(image: HTMLImageElement, annotations: Annotation[], style: CompositionStyle, scale = 1, target?: HTMLCanvasElement): HTMLCanvasElement {
  const size = getCompositionSize(image, style);
  const canvas = target || document.createElement('canvas');
  const ratio = Math.max(0.01, Number.isFinite(scale) ? scale : 1);
  // Guard the backing store: an invalid or oversized size throws, which would
  // take the whole editor down with it.
  const width = safeDimension(size.width * ratio);
  const height = safeDimension(size.height * ratio);
  if (!width || !height) {
    if (target) return canvas;
    throw new Error('This composition is too large to render.');
  }
  // Assigning width/height wipes the bitmap, so only touch it when it changed.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create a screenshot canvas.');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ratio, ratio);
  if (!size.imageWidth || !size.imageHeight) return canvas;

  const stroke = clamp(styleNumber(style.strokeWidth), 0, 200);
  const header = style.frame === 'browser' ? FRAME_HEADER : 0;
  const plate = { x: stroke, y: stroke, width: size.width - stroke * 2, height: size.height - stroke * 2 };
  const radius = clamp(styleNumber(style.radius), 0, Math.min(plate.width, plate.height) / 2);
  const background = style.background || 'transparent';

  if (background !== 'transparent') {
    ctx.save();
    roundedPath(ctx, plate.x, plate.y, plate.width, plate.height, radius);
    ctx.fillStyle = paintFill(ctx, background, plate) || 'transparent';
    ctx.fill();
    ctx.restore();
  }

  if (header) drawFrameHeader(ctx, plate.x, plate.y, plate.width, header, radius, frameBaseColor(background));

  ctx.save();
  roundedPath(ctx, size.imageX, size.imageY, size.imageWidth, size.imageHeight, radius);
  ctx.clip();
  ctx.translate(size.imageX, size.imageY);
  ctx.drawImage(image, 0, 0, size.imageWidth, size.imageHeight);
  for (const annotation of annotations) drawAnnotation(ctx, annotation, image);
  ctx.restore();

  if (stroke > 0 && style.strokeColor && style.strokeColor !== 'transparent') {
    ctx.save();
    roundedPath(ctx, plate.x + stroke / 2, plate.y + stroke / 2, plate.width - stroke, plate.height - stroke, Math.max(0, radius - stroke / 2));
    ctx.lineWidth = stroke;
    ctx.strokeStyle = style.strokeColor;
    ctx.stroke();
    ctx.restore();
  }
  return canvas;
}
