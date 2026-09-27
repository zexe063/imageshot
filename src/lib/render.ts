import type { Annotation, ArrowStyle, CompositionSize, CompositionStyle, Point } from './editor-types';
import { DEFAULT_STYLE } from './editor-types';

/** Height of the fake browser chrome drawn above the screenshot. */
export const FRAME_HEADER = 40;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const MAX_PIXELS = 64_000_000;
const MAX_SIDE = 32_760;

function safeDimension(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_SIDE) return 0;
  // Round outward to include the final edge; never silently clamp away content.
  return Math.max(1, Math.ceil(value));
}

function styleNumber(value: number | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface ArrowGeometry {
  kind: 'straight' | 'curved' | 'elbow';
  tail: Point;
  tip: Point;
  /** Curved: the bow's control point. */
  control?: Point;
  /** Elbow: the corner before it is filleted. */
  corner?: Point;
  /** Elbow: where the fillet leaves the first leg and joins the second. */
  enter?: Point;
  exit?: Point;
  /** Elbow: the centre of the fillet's quarter circle. */
  centre?: Point;
  /** Elbow: the fillet radius, 0 for a square corner. */
  radius: number;
  /** The way the body arrives at the tip, so the arrowhead lines up with it. */
  angle: number;
  /** The way the body leaves the tail, for a head on the near end. */
  startAngle: number;
  length: number;
  /**
   * The body flattened to points, for hit testing and the bend handle. Drawing uses
   * the analytic pieces above, so these samples are never what is painted.
   */
  path: Point[];
}

/** Arrows saved before the bend system have no curve of their own. */
export const ARROW_CURVE_DEFAULT = 0.4;

export function arrowCurve(annotation: Annotation): number {
  return clamp(styleNumber(annotation.curve, ARROW_CURVE_DEFAULT), -1, 1);
}

function arrowEnds(annotation: Annotation) {
  return {
    tail: { x: annotation.x, y: annotation.y },
    tip: { x: annotation.x + annotation.width, y: annotation.y + annotation.height },
  };
}

/**
 * The one place an arrow's shape is decided. The canvas preview, the pointer hit test
 * and the exported image all read this, so a bent arrow can never be drawn one way and
 * picked another.
 */
export function arrowGeometry(annotation: Annotation): ArrowGeometry {
  const { tail, tip } = arrowEnds(annotation);
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const length = Math.hypot(dx, dy);
  const style = annotation.arrowStyle || 'straight';
  const angle = Math.atan2(dy, dx);
  const base: ArrowGeometry = { kind: 'straight', tail, tip, radius: 0, angle, startAngle: angle, length, path: [tail, tip] };
  // A drag too short to bend has no room for a bow or a corner.
  if (style === 'straight' || length < 1) return base;

  const curve = arrowCurve(annotation);

  if (style === 'curved') {
    // A quadratic bow: the control point sits off the chord, so the body leaves it by
    // half that offset at its midpoint, and negative values bow the other way.
    const offset = curve * length;
    const control = { x: (tail.x + tip.x) / 2 - (dy / length) * offset, y: (tail.y + tip.y) / 2 + (dx / length) * offset };
    const steps = Math.max(8, Math.min(96, Math.ceil(length / 6)));
    const path: Point[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const inverse = 1 - t;
      path.push({
        x: inverse * inverse * tail.x + 2 * inverse * t * control.x + t * t * tip.x,
        y: inverse * inverse * tail.y + 2 * inverse * t * control.y + t * t * tip.y,
      });
    }
    return {
      ...base,
      kind: 'curved',
      control,
      // The exact tangents at each end, not the last sampled step, so a head drawn on
      // either end stays square to the body.
      angle: Math.atan2(tip.y - control.y, tip.x - control.x),
      startAngle: Math.atan2(control.y - tail.y, control.x - tail.x),
      path,
    };
  }

  // A bent arrow turns at one of the two corners of its own box, then runs to the tip.
  const horizontalFirst = (annotation.arrowTurn || 'horizontal-first') === 'horizontal-first';
  const corner = horizontalFirst ? { x: tip.x, y: tail.y } : { x: tail.x, y: tip.y };
  const along = (from: Point, to: Point): Point => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
  };
  const first = along(tail, corner);
  const second = along(corner, tip);
  // Never let the fillet eat more than half of either leg, or the body folds back.
  const firstLength = Math.hypot(corner.x - tail.x, corner.y - tail.y);
  const secondLength = Math.hypot(tip.x - corner.x, tip.y - corner.y);
  const radius = Math.min(Math.abs(curve) * Math.min(firstLength, secondLength) / 2, firstLength / 2, secondLength / 2);
  const leaves = Math.atan2(first.y, first.x);
  if (radius < 0.5) {
    return { ...base, kind: 'elbow', corner, angle: Math.atan2(second.y, second.x), startAngle: leaves, path: [tail, corner, tip] };
  }
  // The legs are perpendicular, so the fillet is always an exact quarter circle: it is
  // tangent to each leg a radius back, and centred where those two tangents cross.
  const enter = { x: corner.x - first.x * radius, y: corner.y - first.y * radius };
  const exit = { x: corner.x + second.x * radius, y: corner.y + second.y * radius };
  const centre = { x: enter.x + second.x * radius, y: enter.y + second.y * radius };
  const steps = 12;
  const from = Math.atan2(enter.y - centre.y, enter.x - centre.x);
  // The turn runs anticlockwise exactly when the first leg turns into the second.
  const sweep = (first.x * second.y - first.y * second.x > 0 ? 1 : -1) * (Math.PI / 2);
  const path: Point[] = [tail, enter];
  for (let index = 1; index < steps; index += 1) {
    const angleAt = from + sweep * (index / steps);
    path.push({ x: centre.x + Math.cos(angleAt) * radius, y: centre.y + Math.sin(angleAt) * radius });
  }
  path.push(exit, tip);
  return {
    ...base,
    kind: 'elbow',
    corner,
    enter,
    exit,
    centre,
    radius,
    angle: Math.atan2(tip.y - exit.y, tip.x - exit.x),
    startAngle: leaves,
    path,
  };
}

/** The curve value that puts the body under a point, for dragging the bend handle. */
export function arrowCurveAt(annotation: Annotation, point: Point): number {
  const { tail, tip } = arrowEnds(annotation);
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return 0;
  const curve = arrowCurve(annotation);
  if ((annotation.arrowStyle || 'straight') === 'elbow') {
    // A bigger radius pulls the fillet away from the corner along the bisector of the
    // two legs, so the drag is projected onto that one direction.
    const horizontalFirst = (annotation.arrowTurn || 'horizontal-first') === 'horizontal-first';
    const corner = horizontalFirst ? { x: tip.x, y: tail.y } : { x: tail.x, y: tip.y };
    const firstLength = Math.hypot(corner.x - tail.x, corner.y - tail.y);
    const secondLength = Math.hypot(tip.x - corner.x, tip.y - corner.y);
    const limit = Math.min(firstLength, secondLength) / 2;
    if (limit < 1) return 0;
    const first = { x: (corner.x - tail.x) / (firstLength || 1), y: (corner.y - tail.y) / (firstLength || 1) };
    const second = { x: (tip.x - corner.x) / (secondLength || 1), y: (tip.y - corner.y) / (secondLength || 1) };
    const away = { x: -first.x + second.x, y: -first.y + second.y };
    const scale = Math.SQRT1_2;
    const moved = (point.x - corner.x) * away.x * scale + (point.y - corner.y) * away.y * scale;
    return clamp(moved / limit, 0, 1);
  }
  // Signed distance off the chord, so the handle picks up whichever side it is on.
  const signed = ((point.x - (tail.x + tip.x) / 2) * -dy + (point.y - (tail.y + tip.y) / 2) * dx) / length;
  return clamp((2 * signed) / length, -1, 1);
}

/** Where the bend handle sits: the body's own midpoint, bowed or cornered. */
export function arrowBendPoint(annotation: Annotation): Point {
  const path = arrowGeometry(annotation).path;
  return path[Math.floor(path.length / 2)];
}

/** Head length, following the stroke weight unless the layer set its own. */
export function arrowHeadSize(annotation: Annotation, length: number): number {
  const own = styleNumber(annotation.headSize, 0);
  const size = own > 0 ? own : Math.max(14, annotation.strokeWidth * 4);
  return Math.min(size, Math.max(6, length * 0.5));
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

/** Traces an arrow's body with native path commands, so it stays true at any zoom. */
function traceArrowBody(ctx: CanvasRenderingContext2D, geometry: ArrowGeometry) {
  ctx.beginPath();
  ctx.moveTo(geometry.tail.x, geometry.tail.y);
  if (geometry.kind === 'curved' && geometry.control) {
    ctx.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.tip.x, geometry.tip.y);
    return;
  }
  if (geometry.kind === 'elbow' && geometry.enter && geometry.exit && geometry.corner && geometry.radius > 0) {
    // The corner itself is the first control point, which is what makes the browser
    // tangent to both legs instead of to the chord between them.
    ctx.lineTo(geometry.enter.x, geometry.enter.y);
    ctx.arcTo(geometry.corner.x, geometry.corner.y, geometry.exit.x, geometry.exit.y, geometry.radius);
    ctx.lineTo(geometry.tip.x, geometry.tip.y);
    return;
  }
  if (geometry.kind === 'elbow' && geometry.corner) ctx.lineTo(geometry.corner.x, geometry.corner.y);
  ctx.lineTo(geometry.tip.x, geometry.tip.y);
}

/** One head at `at`, pointing along `angle`. Filled heads are closed, the rest stroked. */
function drawArrowHead(ctx: CanvasRenderingContext2D, annotation: Annotation, at: Point, angle: number, size: number) {
  const style = annotation.arrowHead || 'chevron';
  if (style === 'none') return;
  const spread = Math.PI / 6;
  if (style === 'dot') {
    ctx.beginPath();
    ctx.arc(at.x, at.y, Math.max(2, size * 0.32), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    return;
  }
  if (style === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x - size * Math.cos(angle - spread), at.y - size * Math.sin(angle - spread));
    ctx.lineTo(at.x - size * Math.cos(angle) * 0.82, at.y - size * Math.sin(angle) * 0.82);
    ctx.lineTo(at.x - size * Math.cos(angle + spread), at.y - size * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(at.x - size * Math.cos(angle - spread), at.y - size * Math.sin(angle - spread));
  ctx.lineTo(at.x, at.y);
  ctx.lineTo(at.x - size * Math.cos(angle + spread), at.y - size * Math.sin(angle + spread));
  ctx.stroke();
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
      const geometry = arrowGeometry(a);
      traceArrowBody(ctx, geometry);
      ctx.stroke();
      const head = arrowHeadSize(a, geometry.length);
      drawArrowHead(ctx, a, geometry.tip, geometry.angle, head);
      if ((a.arrowEnds || 'head') === 'both') drawArrowHead(ctx, a, geometry.tail, geometry.startAngle, head);
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
  if (!width || !height || width * height > MAX_PIXELS) {
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
