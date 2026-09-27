import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { hslToRgb, hsvToRgb, parseColor, rgbaToHex, rgbToHsl, rgbToHsv, toCss } from '../lib/color';

/* ------------------------------------------------------------------ buttons */

export function IconButton({
  icon, label, onClick, active = false, disabled = false, size = 28, iconSize = 16, tone = 'default', className = '', children,
}: {
  icon?: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean;
  size?: number; iconSize?: number; tone?: 'default' | 'muted' | 'locked' | 'inverse'; className?: string; children?: ReactNode;
}) {
  return (
    <button
      type="button"
      data-active={active || undefined}
      data-tone={tone === 'default' ? undefined : tone}
      className={`inline-flex items-center justify-center rounded-control text-ink-2 shrink-0 enabled:hover:bg-black/[.06] enabled:hover:text-ink data-[active]:bg-accent-soft data-[active]:text-accent-ink data-[tone=muted]:text-ink-3 data-[tone=muted]:enabled:hover:text-ink data-[tone=locked]:text-accent-ink data-[tone=inverse]:text-[#b9b4cc] data-[tone=inverse]:enabled:hover:bg-white/15 data-[tone=inverse]:enabled:hover:text-white ${className}`}
      style={{ width: size, height: size }}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </button>
  );
}

export function ActionButton({
  icon, children, trailing, onClick, variant = 'default', disabled = false, title, ariaLabel, className = '',
}: {
  icon?: IconName; children?: ReactNode; trailing?: ReactNode; onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string; ariaLabel?: string; className?: string;
}) {
  return (
    <button
      type="button"
      data-variant={variant}
      className={`inline-flex items-center justify-center gap-1.5 h-[30px] px-2.5 rounded-control text-app font-medium whitespace-nowrap bg-field text-ink enabled:hover:bg-field-hover data-[variant=primary]:bg-accent data-[variant=primary]:text-white data-[variant=primary]:shadow-[0_1px_2px_rgba(36,20,92,.22)] data-[variant=primary]:enabled:hover:bg-accent-hover data-[variant=ghost]:bg-transparent data-[variant=ghost]:text-ink-2 data-[variant=danger]:bg-field data-[variant=danger]:text-danger ${className}`} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}>
      {icon ? <Icon name={icon} size={15} /> : null}
      {children ? <span className="max-[900px]:hidden">{children}</span> : null}
      {trailing}
    </button>
  );
}

/* ------------------------------------------------------------------ numbers */

export function NumberField({
  value, onChange, label, suffix, min = -1e6, max = 1e6, step = 1, icon, disabled = false, title, className = '', placeholder, ariaLabel,
}: {
  value: number; onChange: (value: number) => void; label?: string; suffix?: string;
  min?: number; max?: number; step?: number; icon?: IconName; disabled?: boolean; title?: string; className?: string;
  placeholder?: string; ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '');
  // The input hugs its value so the unit sits right next to the number, like Figma.
  const size = Math.max(2, Math.min(10, display.length || 2));
  // Typing only edits the local draft; the value is pushed on blur or Enter so a
  // full repaint (and a history entry) happens once instead of per keystroke.
  const send = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === '' || Number.isNaN(parsed)) return false;
    onChange(Math.max(min, Math.min(max, parsed)));
    return true;
  };
  const input = (
    <input
      className="flex-[0_1_auto] min-w-[2ch] max-w-full w-auto px-px bg-none border-0 outline-none text-app text-ink text-left tabular-nums [field-sizing:content]"
      inputMode="decimal"
      size={size}
      value={display}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => { if (draft !== null) send(draft); setDraft(null); }}
      onKeyDown={event => {
        if (event.key === 'Enter') { if (draft !== null) send(draft); (event.target as HTMLInputElement).blur(); }
        if (event.key === 'Escape') { setDraft(null); (event.target as HTMLInputElement).blur(); }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const delta = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1) * step;
          setDraft(null);
          onChange(Math.max(min, Math.min(max, value + delta)));
        }
      }}
    />
  );
  return (
    <label
      className={`flex items-center gap-[5px] h-7 px-[7px] rounded-control bg-field text-ink-2 min-w-0 w-full hover:bg-field-hover focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--color-accent)] ${className}`}
      title={title}
    >
      {icon ? <Icon name={icon} size={13} className="text-ink-3" /> : label ? <span className="text-app text-ink-2">{label}</span> : null}
      {input}
      {suffix ? <span className="-ml-[3px] text-app text-ink-2">{suffix}</span> : null}
    </label>
  );
}

/** Stroke weight control: type a value or step it with the buttons. */
export function WeightField({
  value, onChange, min = 0, max = 200, step = 1, disabled = false, icon = 'weight', ariaLabel = 'Stroke width',
}: {
  value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean;
  icon?: IconName; ariaLabel?: string;
}) {
  const nudge = (delta: number) => onChange(Math.max(min, Math.min(max, Math.round((value + delta) * 10) / 10)));
  return (
    <div className="grid grid-cols-[1fr_auto] gap-1.5 min-w-0 w-full">
      <NumberField value={value} onChange={onChange} min={min} max={max} step={step} icon={icon} disabled={disabled} ariaLabel={ariaLabel} />
      <div className="flex items-center gap-0.5 p-0.5 rounded-control bg-field">
        <IconButton icon="minus" label="Decrease weight" size={26} iconSize={14} onClick={() => nudge(-step)} disabled={disabled || value <= min} />
        <IconButton icon="plus" label="Increase weight" size={26} iconSize={14} onClick={() => nudge(step)} disabled={disabled || value >= max} />
      </div>
    </div>
  );
}

/** Figma style: the label sits above the control, the icon lives inside it. */
export function PropertyField({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const control = useRef<HTMLDivElement>(null);
  return (
    <div className={`flex flex-col gap-[5px] min-w-0 ${className}`} ref={control}>
      <span
        className="text-app text-ink-2"
        onClick={() => {
          const field = control.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
          field?.focus();
          if (field instanceof HTMLInputElement) field.select();
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function SliderField({ label, value, onChange, min = 0, max = 100, icon, suffix = '%' }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; icon?: IconName; suffix?: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = live ?? value;
  // Dragging fires continuously, so the value is coalesced before it reaches the document.
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (live === null) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setLive(null); onChange(live); }, 90);
  }, [live, onChange]);
  const range = Math.max(1, max - min);
  const percent = Math.max(0, Math.min(100, ((shown - min) / range) * 100));
  return (
    <div className="flex items-center gap-2 w-full">
      {icon ? <Icon name={icon} size={14} /> : null}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={shown}
        style={{ '--slider-fill': `${percent}%` } as React.CSSProperties}
        onChange={event => setLive(Math.round(Number(event.target.value)))}
      />
      <span className="text-app text-ink tabular-nums">{Math.round(shown)}{suffix}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- layout */

/** Static section: the panel never collapses, so there is no caret or toggle. */
export function Section({ title, actions, children, id }: { title: string; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="border-b border-line">
      <div className="flex items-center justify-between h-[30px] px-[6px] pl-3">
        <span className="text-app font-medium">{title}</span>
        {actions ? <div className="flex items-center gap-px">{actions}</div> : null}
      </div>
      {children ? <div className="flex flex-col gap-2 pt-0.5 pb-3 px-3" id={id}>{children}</div> : null}
    </section>
  );
}

export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-x-2 gap-y-2.5 ${className}`}>{children}</div>;
}

export function Segmented<T extends string | number>({
  value, options, onChange, label,
}: {
  value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (value: T) => void; label?: string;
}) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-control bg-field" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          data-selected={value === option.value || undefined}
          className="flex-1 inline-flex items-center justify-center gap-[5px] h-6 rounded-[4px] text-app text-ink-2 whitespace-nowrap hover:text-ink data-[selected]:bg-surface data-[selected]:text-ink data-[selected]:font-medium data-[selected]:shadow-[0_1px_2px_rgba(0,0,0,.14)]"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={14} /> : null}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- color */

const OPAQUE_BLACK = { r: 0, g: 0, b: 0, a: 1 };
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function ColorField({
  color, onChange, onClear, disabled = false, ariaLabel = 'Colour', nativeLabel, preview, displayValue,
}: {
  color: string; onChange: (color: string) => void; onClear?: () => void;
  disabled?: boolean; ariaLabel?: string; nativeLabel?: string; preview?: string; displayValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseColor(color);
  const solid = parsed || OPAQUE_BLACK;
  const hex = rgbaToHex(solid);
  const empty = color === 'transparent' || solid.a === 0;
  // Figma writes the fill as a bare hex, without the hash.
  const text = parsed ? (empty ? displayValue || 'None' : hex.slice(1, 7)) : displayValue || 'Mixed';
  // The opacity cell only shows up once the colour is no longer fully opaque.
  const showAlpha = !!parsed && !empty && solid.a < 1;
  const toggle = () => setOpen(value => !value);

  return (
    <div className="flex items-center gap-1.5 w-full">
      <div
        data-open={open || undefined}
        className="flex-[1_1_auto] min-w-0 flex items-stretch h-7 rounded-control bg-field overflow-hidden data-[open]:bg-surface data-[open]:shadow-[inset_0_0_0_1px_var(--color-accent)]"
      >
        <button
          type="button"
          data-color-trigger=""
          data-open={open || undefined}
          className="relative flex items-center gap-2 flex-[1_1_0] min-w-0 px-2 border-0 bg-none text-left text-ink enabled:hover:bg-field-hover data-[open]:enabled:hover:bg-surface"
          aria-label={`${ariaLabel} picker`}
          aria-expanded={open}
          disabled={disabled}
          onClick={toggle}
        >
          <span
            className={`relative w-4 h-4 rounded-[4px] shrink-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,.14)] ${
              empty ? 'bg-[repeating-linear-gradient(45deg,#d3d3d8_0_1.5px,#f7f7f8_1.5px_4px)] shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)]' : ''}`}
            style={{ background: empty ? undefined : parsed ? toCss(solid) : preview }}
          />
          <span className="text-app text-ink tracking-[.2px] overflow-hidden text-ellipsis">{text}</span>
          {nativeLabel ? (
            <input
              className="absolute inset-0 w-full h-full opacity-0 pointer-events-none border-0 p-0"
              type="color"
              aria-label={nativeLabel}
              tabIndex={-1}
              disabled={disabled}
              value={parsed && !empty ? hex.slice(0, 7) : '#000000'}
              onInput={event => onChange((event.target as HTMLInputElement).value.toUpperCase())}
            />
          ) : null}
        </button>
        {showAlpha ? (
          <button
            type="button"
            className="flex items-center gap-0.5 flex-[1_1_0] min-w-0 px-2.5 border-0 bg-none text-ink text-app tabular-nums shadow-[inset_1px_0_0_rgba(0,0,0,.1)] hover:bg-field-hover"
            aria-label={`${ariaLabel} opacity`}
            disabled={disabled}
            onClick={toggle}
          >
            {Math.round(solid.a * 100)}<em className="not-italic -ml-0.5 text-ink-2">%</em>
          </button>
        ) : null}
      </div>
      {onClear ? <IconButton icon="minus" label={`Remove ${ariaLabel.toLowerCase()}`} size={24} iconSize={14} onClick={onClear} disabled={disabled} /> : null}
      {open ? <ColorPopover color={color} onChange={onChange} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/**
 * Drag helper for the spectrum and the sliders. React clears `event.currentTarget`
 * after dispatch, so the element is captured up front and pointer capture keeps the
 * moves coming even when the cursor leaves the track.
 */
function useDragArea(apply: (x: number, y: number) => void) {
  const drag = useRef<((clientX: number, clientY: number) => void) | null>(null);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      drag.current = (clientX, clientY) => {
        const rect = element.getBoundingClientRect();
        apply(
          rect.width ? clamp01((clientX - rect.left) / rect.width) : 0,
          rect.height ? clamp01((clientY - rect.top) / rect.height) : 0,
        );
      };
      drag.current(event.clientX, event.clientY);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => drag.current?.(event.clientX, event.clientY),
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => { drag.current = null; },
  };
}

export function ColorPopover({
  color, onChange, onClose,
}: {
  color: string; onChange: (color: string) => void; onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState<'HEX' | 'RGB' | 'HSL'>('HEX');
  const formatSelect = useRef<HTMLSelectElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const width = 248;
  const height = 356;

  useLayoutEffect(() => {
    const trigger = document.querySelector<HTMLElement>('[data-color-trigger]');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // The inspector is docked to the right edge, so the picker opens outwards and
    // clears the panel instead of covering it.
    const panel = trigger.closest<HTMLElement>('[data-panel="right"]');
    const edge = panel ? panel.getBoundingClientRect().left : rect.left;
    const left = Math.max(8, Math.min(edge - width - 8, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom;
    setPosition({ left, top: below > height + 12 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panelRef.current?.contains(target) || target.closest?.('[data-color-trigger]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const parsed = parseColor(color) || OPAQUE_BLACK;
  const hsv = rgbToHsv(parsed);
  const hsl = rgbToHsl(parsed);
  // Drag handlers read the freshest colour so hue, saturation and alpha compose.
  const state = useRef({ parsed, hsv });
  state.current = { parsed, hsv };

  const emit = (next: { r: number; g: number; b: number; a?: number }) => {
    const rgba = { ...next, a: next.a ?? state.current.parsed.a };
    onChange(format === 'HEX' ? rgbaToHex(rgba) : toCss(rgba));
  };

  const spectrum = useDragArea((x, y) => emit(hsvToRgb({ h: state.current.hsv.h, s: x * 100, v: (1 - y) * 100 })));
  const hue = useDragArea(x => emit(hsvToRgb({ h: x * 360, s: state.current.hsv.s, v: state.current.hsv.v })));
  const alpha = useDragArea(x => emit({ ...state.current.parsed, a: x }));

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[240] flex flex-col gap-2 p-[9px] rounded-[10px] bg-surface text-app shadow-[0_0_0_1px_rgba(0,0,0,.06),0_12px_28px_rgba(0,0,0,.16),0_3px_8px_rgba(0,0,0,.08)]"
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, width }}
      role="dialog"
      aria-label="Colour picker"
    >
      <div className="flex items-center justify-between h-6 pl-0.5 text-[12px] font-medium">
        <span>Color</span>
        <IconButton icon="close" label="Close colour picker" size={24} iconSize={14} onClick={onClose} />
      </div>

      <div
        className="relative w-full h-[156px] rounded-[6px] cursor-crosshair touch-none shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        {...spectrum}
      >
        <span className="absolute w-3 h-3 rounded-full bg-white -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,.25),0_1px_3px_rgba(0,0,0,.35)]" style={{ left: `${hsv.s * 100}%`, top: `${100 - hsv.v * 100}%` }} />
      </div>

      <div className="relative h-3 rounded-[6px] cursor-pointer touch-none shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" {...hue}>
        <span className="absolute inset-0 rounded-[inherit]" style={{ background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }} />
        <span className="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-white -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,.2),0_1px_3px_rgba(0,0,0,.3)]" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="relative h-3 rounded-[6px] cursor-pointer touch-none shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)] bg-[repeating-conic-gradient(#dcdcdc_0_25%,#fff_0_50%)] bg-[length:8px_8px]" {...alpha}>
        <span className="absolute inset-0 rounded-[inherit]" style={{ background: `linear-gradient(to right, ${toCss({ ...parsed, a: 0 })}, ${toCss({ ...parsed, a: 1 })})` }} />
        <span className="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-white -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,.2),0_1px_3px_rgba(0,0,0,.3)]" style={{ left: `${parsed.a * 100}%` }} />
      </div>

      <div className="flex items-center gap-[5px]">
        <label
          className="flex items-center gap-0.5 h-7 py-0 pl-2 pr-[5px] rounded-control bg-field shrink-0 cursor-pointer select-none"
          onClick={() => {
            // A wrapped <select> only takes focus on a label click; open it for real.
            const select = formatSelect.current;
            if (!select) return;
            try { select.showPicker?.(); } catch { select.focus(); }
          }}
        >
          <select ref={formatSelect} className="appearance-none bg-none border-0 outline-none text-app text-ink cursor-pointer" value={format} onChange={event => setFormat(event.target.value as 'HEX' | 'RGB' | 'HSL')} aria-label="Colour format">
            <option value="HEX">HEX</option>
            <option value="RGB">RGB</option>
            <option value="HSL">HSL</option>
          </select>
          <Icon name="chevron" size={11} className="text-ink-3" />
        </label>
        <div className="flex-[1_1_auto] min-w-0 flex items-stretch h-7 rounded-control bg-field overflow-hidden">
          {format === 'RGB'
            ? (['r', 'g', 'b'] as const).map(key => (
              <span className="flex items-center gap-0.5 flex-[1_1_0] min-w-0 px-1.5 focus-within:bg-surface cell-divider" key={key}>
                <input
                  className="w-full min-w-0 bg-none border-0 outline-none text-app text-ink text-left tabular-nums"
                  aria-label={`Colour ${key.toUpperCase()}`}
                  inputMode="numeric"
                  value={String(parsed[key])}
                  onChange={event => emit({ ...parsed, [key]: Math.max(0, Math.min(255, Number(event.target.value) || 0)) })}
                />
              </span>
            ))
            : format === 'HSL'
              ? (['h', 's', 'v'] as const).map(key => (
                <span className="flex items-center gap-0.5 flex-[1_1_0] min-w-0 px-2 focus-within:bg-surface cell-divider" key={key}>
                  <input
                    className="w-full min-w-0 bg-none border-0 outline-none text-app text-ink text-left tabular-nums"
                    aria-label={`Colour ${key.toUpperCase()}`}
                    inputMode="numeric"
                    value={String(hsl[key])}
                    onChange={event => emit(hslToRgb({ ...hsl, [key]: Number(event.target.value) || 0 }))}
                  />
                </span>
              ))
              : (
                <span className="flex items-center gap-0.5 flex-[1_1_0] min-w-0 px-2 focus-within:bg-surface cell-divider">
                  <input
                    className="w-full min-w-0 bg-none border-0 outline-none text-app text-ink text-left tabular-nums"
                    aria-label="Colour hex"
                    value={rgbaToHex({ ...parsed, a: 1 }).slice(1)}
                    spellCheck={false}
                    onChange={event => {
                      const next = parseColor(event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`);
                      if (next) onChange(rgbaToHex({ ...next, a: parsed.a }));
                    }}
                  />
                </span>
              )}
          <span className="flex items-center gap-0.5 flex-[0_0_56px] px-2 focus-within:bg-surface cell-divider">
            <input
              className="w-full min-w-0 bg-none border-0 outline-none text-app text-ink text-left tabular-nums"
              aria-label="Colour alpha"
              inputMode="numeric"
              value={String(Math.round(parsed.a * 100))}
              onChange={event => emit({ ...parsed, a: Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100 })}
            />
            <em className="not-italic text-app text-ink-2">%</em>
          </span>
        </div>
      </div>


    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------------- dropdown */

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

/**
 * A dropdown that looks like Figma's: a floating panel with a tick on the current
 * choice, roomy rows, and a soft elevation shadow. It renders through a portal so the
 * inspector's scrolling column cannot clip it, and the light theme keeps the panel
 * white.
 */
export function Select<T extends string | number>({
  value, options, onChange, label, disabled = false,
}: {
  value: T; options: SelectOption<T>[]; onChange: (value: T) => void; label: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; minWidth: number; openUp: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const chosen = useRef<HTMLButtonElement>(null);
  const current = options.find(option => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = Math.min(264, options.length * 28 + 8);
    const below = window.innerHeight - rect.bottom;
    const openUp = below < height + 12 && rect.top > below;
    setPosition({
      left: rect.left,
      top: openUp ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
      minWidth: rect.width,
      openUp,
    });
  }, [open, options.length]);

  // The list opens on the current value, the way Figma's does, so a font size of 96
  // does not mean scrolling past every smaller step to find it. This waits for the
  // panel to be in the document, which only happens once the position is known.
  useLayoutEffect(() => {
    if (!open || !position) return;
    chosen.current?.scrollIntoView({ block: 'center' });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        className="flex items-center gap-1.5 w-full h-7 px-[7px] rounded-control bg-field text-app text-ink text-left enabled:hover:bg-field-hover disabled:opacity-50"
      >
        <span className="flex-1 min-w-0 truncate">{current?.label ?? value}</span>
        <Icon name="chevron" size={12} className="text-ink-3" />
      </button>
      {open && position ? createPortal(
        <div
          ref={panel}
          role="listbox"
          aria-label={label}
          style={{ left: position.left, top: position.top, minWidth: position.minWidth }}
          className="fixed z-[260] max-h-[264px] overflow-y-auto scrollbar-none overscroll-contain py-1 rounded-lg bg-surface shadow-[0_0_0_1px_rgba(0,0,0,.05),0_12px_28px_rgba(0,0,0,.14),0_2px_6px_rgba(0,0,0,.07)]"
        >
          {options.map(option => {
            const selected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={selected}
                ref={selected ? chosen : undefined}
                onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}
                className={`flex items-center gap-2 w-full h-7 px-2 text-app text-left ${
                  selected ? 'text-ink font-medium' : 'text-ink-2 enabled:hover:bg-field enabled:hover:text-ink'}`}
              >
                <span className="flex-1 truncate">{option.label}</span>
                {selected ? <Icon name="check" size={13} className="text-ink-2" /> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
