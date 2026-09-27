export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** Accepts 0-1 or 0-100 alpha values. */
const normaliseAlpha = (value?: number) => (value === undefined || Number.isNaN(value) ? 1 : clamp(value > 1 ? value / 100 : value, 0, 1));
const round = (value: number) => Math.round(clamp(value, 0, 255));

export function parseColor(input: string): Rgba | null {
  const value = (input || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return { r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]), a: digits.length === 4 ? expand(digits[3]) / 255 : 1 };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)), g: expand(digits.slice(2, 4)), b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(part => !Number.isNaN(part))) {
      return { r: round(parts[0]), g: round(parts[1]), b: round(parts[2]), a: normaliseAlpha(parts[3]) };
    }
    return null;
  }
  const hsl = value.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    const [h, s, l] = parts;
    if ([h, s, l].every(part => !Number.isNaN(part))) {
      const alpha = normaliseAlpha(parts[3]);
      const rgbValue = hslToRgb({ h, s: s > 1 ? s / 100 : s, v: l > 1 ? l / 100 : l });
      return { ...rgbValue, a: alpha };
    }
  }
  return null;
}

/** Accepts the alpha on the colour itself, or as an explicit override. */
export function rgbaToHex({ r, g, b, a }: Rgba, alpha = a) {
  const part = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  const base = `#${part(r)}${part(g)}${part(b)}`;
  if (alpha === undefined || alpha >= 1) return base.toUpperCase();
  return `${base}${part(clamp(alpha, 0, 1) * 255)}`.toUpperCase();
}

export function toCss(color: Rgba) {
  const alpha = clamp(color.a, 0, 1);
  return alpha >= 1
    ? `rgb(${round(color.r)}, ${round(color.g)}, ${round(color.b)})`
    : `rgba(${round(color.r)}, ${round(color.g)}, ${round(color.b)}, ${Math.round(alpha * 1000) / 1000})`;
}

export function rgbToHsv({ r, g, b }: Rgba): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s: max ? Math.round((delta / max) * 100) : 0, v: Math.round(max * 100) };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgba {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const chroma = val * sat;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = val - chroma;
  const table: [number, number, number][] = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ];
  const [r, g, b] = table[Math.floor(hue / 60) % 6];
  return { r: Math.round((r + match) * 255), g: Math.round((g + match) * 255), b: Math.round((b + match) * 255), a: 1 };
}

export function hslToRgb({ h, s, v }: Hsv) {
  return hsvToRgb({ h, s, v: (1 - s) * 100 + v * s });
}

export function rgbToHsl({ r, g, b }: Rgba) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const light = (max + min) / 2;
  if (!delta) return { h: 0, s: 0, v: Math.round(light * 100) };
  const sat = delta / (1 - Math.abs(2 * light - 1));
  let h = 0;
  if (max === red) h = ((green - blue) / delta) % 6;
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s: Math.round(sat * 100), v: Math.round(light * 100) };
}

export function withAlpha(color: Rgba, alpha: number) {
  return { ...color, a: clamp(alpha, 0, 1) };
}

/** Mixes two colours, used for the checkerboard-aware swatch border. */
export function readableOn(color: Rgba) {
  const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
  return luminance > 0.62 ? '#1e1e1e' : '#ffffff';
}
