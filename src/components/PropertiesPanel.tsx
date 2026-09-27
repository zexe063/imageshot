import { useState } from 'react';
import { Icon } from './Icon';
import { ColorField, IconButton, NumberField, PropertyField, Row, Section, Select, WeightField } from './ui';
import type { Annotation, CompositionStyle, Tool } from '../lib/editor-types';
import { TEXT_FAMILIES, textMetrics } from '../lib/render';

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 20, 24, 32, 36, 40, 48, 64, 96, 128];
const FONT_WEIGHTS = [
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
];
const LINE_HEIGHTS = [0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.8, 2, 2.5];

/** Legacy gradient values from older documents still render; name them in the field. */
const BACKGROUND_PRESETS = [
  { name: 'Lavender haze', value: 'linear-gradient(135deg, #c9c2fb 0%, #e0d7ff 50%, #f6d7e4 100%)' },
  { name: 'Blue hour', value: 'linear-gradient(135deg, #5864b6 0%, #8094df 50%, #bdd5f5 100%)' },
];

const SHAPE_TYPES = ['rectangle', 'ellipse'];
const LINE_TYPES = ['arrow', 'pen', 'number'];

export interface ToolDefaults {
  color: string;
  strokeWidth: number;
  fontSize: number;
  fill: string | null;
  radius: number;
  opacity: number;
}

interface PropertiesPanelProps {
  selected: Annotation | null;
  selectedName: string;
  style: CompositionStyle;
  bounds: { x: number; y: number; width: number; height: number } | null;
  tool: Tool;
  defaults: ToolDefaults;
  onStyle: (patch: Partial<CompositionStyle>) => void;
  onLayer: (patch: Partial<Annotation>) => void;
  onDefaults: (patch: Partial<ToolDefaults>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function PropertiesPanel({
  selected, selectedName, style, bounds, tool, defaults, onStyle, onLayer, onDefaults, onDuplicate, onDelete,
}: PropertiesPanelProps) {
  const [lockRatio, setLockRatio] = useState(false);
  const locked = !!selected?.locked;
  const drawing = !selected && !['select', 'crop'].includes(tool);
  const type = selected?.type ?? tool;
  const ratio = bounds && bounds.width ? bounds.height / bounds.width : 1;

  const isShape = SHAPE_TYPES.includes(type);
  const isLine = LINE_TYPES.includes(type);
  const isText = type === 'text';
  const isImage = !selected && !drawing;

  // Layer values fall back to the tool defaults so the next shape starts styled.
  const color = selected?.color ?? defaults.color;
  const fill = (selected ? selected.fill : defaults.fill) ?? null;
  const weight = selected?.strokeWidth ?? defaults.strokeWidth;
  const radius = selected?.radius ?? defaults.radius;
  const opacity = selected?.opacity ?? defaults.opacity;
  const fontSize = selected?.fontSize ?? defaults.fontSize;
  // Everything below mirrors the renderer's defaults, so a layer saved without the
  // new fields still shows the values it is actually drawn with.
  const textType = textMetrics({ id: 'panel', type: 'text', x: 0, y: 0, width: 0, height: 0, color: '#000000', strokeWidth: 0, ...(selected ?? {}), text: selected?.text ?? '' });
  const fontFamily = selected?.fontFamily ?? 'Inter';
  const fontWeight = textType.weight;
  const lineHeight = textType.lineHeight;
  const letterSpacing = textType.letterSpacing;
  const hasFill = style.background !== 'transparent';
  // A weight of zero means there is no stroke, so the row collapses on its own;
  // the "−" is the deliberate way to get rid of one.
  const hasStroke = style.strokeWidth > 0;
  const send = <K extends keyof Annotation>(key: K, value: Annotation[K]) => {
    if (selected) onLayer({ [key]: value } as Partial<Annotation>);
    else onDefaults({ [key]: value } as unknown as Partial<ToolDefaults>);
  };

  /**
   * Typography only. The selection box is measured from these values on every frame,
   * so it follows along without the patch having to carry a size of its own.
   */
  const sendType = (patch: Partial<Annotation>) => {
    if (selected) onLayer(patch);
  };

  const setWidth = (value: number) => {
    const width = Math.max(1, Math.round(value));
    onLayer(lockRatio && bounds ? { width, height: Math.max(1, Math.round(width * ratio)) } : { width });
  };
  const setHeight = (value: number) => {
    const height = Math.max(1, Math.round(value));
    onLayer(lockRatio && bounds ? { height, width: Math.max(1, Math.round(height / (ratio || 1))) } : { height });
  };
  const sizeFields = (
    <Row>
      <NumberField label="W" value={Math.round(bounds?.width ?? 0)} min={1} disabled={locked} onChange={setWidth} />
      <NumberField label="H" value={Math.round(bounds?.height ?? 0)} min={1} disabled={locked} onChange={setHeight} />
    </Row>
  );
  const sizeLock = (
    <IconButton icon="link" label="Constrain proportions" size={24} iconSize={14} active={lockRatio} onClick={() => setLockRatio(value => !value)} />
  );

  return (
    <aside data-panel="right" className="flex flex-col min-h-0 shrink-0 w-[var(--right-w)] bg-surface border-l border-line">
      <div className="flex items-center justify-between gap-1.5 h-[38px] shrink-0 px-1.5 pl-3 border-b border-line">
        <span className="flex items-center gap-1.5 min-w-0 text-[12px] font-medium">
          <Icon name={isImage ? 'image' : (type as never)} size={14} className="text-ink-3" />
          <span className="overflow-hidden whitespace-nowrap text-ellipsis">{isImage ? 'Screenshot' : selected ? selectedName : `${selectedName} style`}</span>
        </span>
        {selected ? (
          <div className="flex items-center">
            <IconButton icon="copy" label="Duplicate layer (Ctrl+D)" size={26} iconSize={15} onClick={onDuplicate} disabled={locked} />
            <IconButton icon="delete" label="Delete layer" size={26} iconSize={15} onClick={onDelete} disabled={locked} />
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none">
        {isImage ? (
          <>
            <Section title="Layout" id="image-layout">
              <Row>
                <PropertyField label="Padding">
                  <NumberField value={style.padding} min={0} max={400} icon="ruler" onChange={padding => onStyle({ padding: Math.round(padding) })} />
                </PropertyField>
                <PropertyField label="Radius">
                  <NumberField value={style.radius} min={0} max={200} icon="radius" onChange={radius => onStyle({ radius: Math.round(radius) })} />
                </PropertyField>
              </Row>
            </Section>

            <Section
              title="Fill"
              id="image-fill"
              actions={hasFill ? undefined : <IconButton icon="plus" label="Add background" size={24} iconSize={14} onClick={() => onStyle({ background: '#ffffff' })} />}
            >
              {hasFill ? (
                <ColorField
                  color={style.background}
                  ariaLabel="Background"
                  nativeLabel="Background color"
                  // A gradient or any other non-solid value keeps its own swatch and name.
                  displayValue={BACKGROUND_PRESETS.find(item => item.value === style.background)?.name || 'Custom'}
                  onClear={() => onStyle({ background: 'transparent' })}
                  onChange={background => onStyle({ background })}
                />
              ) : null}
            </Section>

            <Section
              title="Stroke"
              id="image-stroke"
              actions={hasStroke ? undefined : <IconButton icon="plus" label="Add stroke" size={24} iconSize={14} onClick={() => onStyle({ strokeWidth: 1 })} />}
            >
              {hasStroke ? (
                <>
                  <ColorField
                    color={style.strokeColor}
                    ariaLabel="Stroke colour"
                    nativeLabel="Stroke color"
                    onClear={() => onStyle({ strokeWidth: 0 })}
                    onChange={strokeColor => onStyle({ strokeColor })}
                  />
                  <PropertyField label="Weight">
                    <WeightField value={style.strokeWidth} min={0} max={40} ariaLabel="Frame stroke width" onChange={value => onStyle({ strokeWidth: value })} />
                  </PropertyField>
                </>
              ) : null}
            </Section>

          </>
        ) : null}

        {isShape || isLine ? (
          <>
            <Section title="Dimensions" id={`${type}-dimensions`}>
              {sizeFields}
            </Section>

            <Section title="Appearance" id={`${type}-appearance`}>
              {isShape ? (
                <Row>
                  <PropertyField label="Corner radius">
                    <NumberField value={radius} min={0} max={400} icon="radius" disabled={locked} onChange={value => send('radius', Math.round(value))} />
                  </PropertyField>
                  <PropertyField label="Opacity">
                    <NumberField value={opacity} suffix="%" min={0} max={100} icon="transparent" disabled={locked} onChange={value => send('opacity', Math.round(value))} />
                  </PropertyField>
                </Row>
              ) : (
                <PropertyField label="Opacity">
                  <NumberField value={opacity} suffix="%" min={0} max={100} icon="transparent" disabled={locked} onChange={value => send('opacity', Math.round(value))} />
                </PropertyField>
              )}
            </Section>
          </>
        ) : null}

        {isShape ? (
          <Section
            title="Fill"
            id="shape-fill"
            actions={fill ? undefined : <IconButton icon="plus" label="Add fill" size={24} iconSize={14} disabled={locked} onClick={() => send('fill', color)} />}
          >
            {fill ? (
              <ColorField
                color={fill}
                ariaLabel="Background color"
                nativeLabel="Annotation color"
                disabled={locked}
                onClear={() => send('fill', null)}
                onChange={value => {
                  if (selected) onLayer({ color: value, fill: value });
                  else onDefaults({ color: value, fill: value });
                }}
              />
            ) : null}
          </Section>
        ) : null}

        {isShape || isLine ? (
          <Section
            title="Stroke"
            id={`${type}-stroke`}
            actions={weight > 0 ? undefined : <IconButton icon="plus" label="Add stroke" size={24} iconSize={14} disabled={locked} onClick={() => send('strokeWidth', 2)} />}
          >
            {weight > 0 ? (
              <>
                <ColorField
                  color={selected?.strokeColor ?? color}
                  ariaLabel="Stroke color"
                  nativeLabel={isShape ? undefined : 'Annotation color'}
                  disabled={locked}
                  onClear={() => send('strokeWidth', 0)}
                  onChange={value => (selected ? onLayer({ strokeColor: value }) : onDefaults({ color: value }))}
                />
                <PropertyField label="Weight">
                  <WeightField
                    value={weight}
                    min={0}
                    max={200}
                    ariaLabel="Stroke width"
                    disabled={locked}
                    onChange={value => send('strokeWidth', value)}
                  />
                </PropertyField>
              </>
            ) : null}
          </Section>
        ) : null}

        {isText ? (
          <Section title="Text" id="text">
            <Row>
              <PropertyField label="Font" className="col-span-2">
                <Select
                  label="Font family"
                  value={fontFamily}
                  onChange={value => sendType({ fontFamily: value })}
                  options={TEXT_FAMILIES.map(family => ({ value: family, label: family }))}
                  disabled={locked}
                />
              </PropertyField>

              <PropertyField label="Size">
                <Select
                  label="Text size"
                  value={fontSize}
                  onChange={value => sendType({ fontSize: value })}
                  options={FONT_SIZES.map(size => ({ value: size, label: String(size) }))}
                  disabled={locked}
                />
              </PropertyField>

              <PropertyField label="Line height">
                <Select
                  label="Line height"
                  value={lineHeight}
                  onChange={value => sendType({ lineHeight: value })}
                  options={LINE_HEIGHTS.map(height => ({ value: height, label: String(height) }))}
                  disabled={locked}
                />
              </PropertyField>

              <PropertyField label="Weight">
                <Select
                  label="Font weight"
                  value={fontWeight}
                  onChange={value => sendType({ fontWeight: value })}
                  options={FONT_WEIGHTS}
                  disabled={locked}
                />
              </PropertyField>

              <PropertyField label="Letter spacing">
                <NumberField
                  value={letterSpacing}
                  min={-20}
                  max={80}
                  step={0.5}
                  suffix="px"
                  ariaLabel="Letter spacing"
                  disabled={locked}
                  onChange={value => sendType({ letterSpacing: value })}
                />
              </PropertyField>

              <PropertyField label="Colour" className="col-span-2">
                <ColorField
                  color={color}
                  ariaLabel="Font color"
                  nativeLabel="Annotation color"
                  disabled={locked}
                  onChange={value => (selected ? onLayer({ color: value }) : onDefaults({ color: value }))}
                />
              </PropertyField>
            </Row>
          </Section>
        ) : null}


                {type === 'highlight' ? (
          <Section title="Fill" id="highlight-fill">
            <ColorField
              color={color}
              ariaLabel="Background color"
              nativeLabel="Annotation color"
              disabled={locked}
              onChange={value => (selected ? onLayer({ color: value }) : onDefaults({ color: value }))}
            />
            <PropertyField label="Opacity">
              <NumberField value={opacity} suffix="%" min={0} max={100} icon="transparent" disabled={locked} onChange={value => send('opacity', Math.round(value))} />
            </PropertyField>
          </Section>
        ) : null}

        {type === 'blur' ? (
          <Section title="Dimensions" id="blur-dimensions">
            {sizeFields}
            <PropertyField label="Strength">
              <NumberField value={weight} min={1} max={60} icon="blur" disabled={locked} onChange={value => send('strokeWidth', Math.round(value))} />
            </PropertyField>
          </Section>
        ) : null}
      </div>
    </aside>
  );
}
