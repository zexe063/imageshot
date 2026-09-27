export type Tool =
  | 'select'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'pen'
  | 'text'
  | 'blur'
  | 'highlight'
  | 'crop'
  /** Legacy: kept so older documents keep rendering. Not offered in the toolbar. */
  | 'number';

export interface Point {
  x: number;
  y: number;
}

/** All coordinates are in the original screenshot's pixel space. */
export interface Annotation {
  id: string;
  type: Exclude<Tool, 'select' | 'crop'>;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Outline colour, and the text colour for text layers. */
  color: string;
  strokeWidth: number;
  /** Shape background colour. `null` keeps the shape outline only. */
  fill?: string | null;
  text?: string;
  /** Typography, shared by the canvas preview, the inline editor and the export. */
  fontSize?: number;
  /** One of `TEXT_FAMILIES`, defaults to Inter. */
  fontFamily?: string;
  /** 400-700, defaults to 600. */
  fontWeight?: number;
  /** Unitless multiple of the font size, defaults to 1.3. */
  lineHeight?: number;
  /** Pixels added between characters, defaults to 0. */
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
  /** Pen points are local to the annotation's x/y. */
  points?: Point[];
  number?: number;
  hidden?: boolean;
  locked?: boolean;
  /** 0-100, defaults to 100. */
  opacity?: number;
  /** Rectangle corner radius, defaults to 3. */
  radius?: number;
  /** Defaults to the annotation colour. */
  strokeColor?: string;
}

export interface CompositionStyle {
  /** Solid colour, CSS gradient, or `transparent`. */
  background: string;
  /** Space around the screenshot, in screenshot pixels. */
  padding: number;
  /** Corner radius of the background and screenshot. */
  radius: number;
  strokeColor: string;
  strokeWidth: number;
  /** Retained to read older saved documents. */
  frame: 'none' | 'browser';
}

export interface CompositionSize {
  width: number;
  height: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * The plate starts bare: no padding, no rounding, no background. A capture should
 * look like the screenshot on its own, and every one of those is the user's decision
 * to make in the Layout section.
 */
export const DEFAULT_STYLE: CompositionStyle = {
  background: 'transparent',
  padding: 0,
  radius: 0,
  strokeColor: '#1e1e1e',
  strokeWidth: 0,
  frame: 'none',
};
