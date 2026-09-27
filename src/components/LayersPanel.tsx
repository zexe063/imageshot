import { useRef } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './ui';
import type { Annotation } from '../lib/editor-types';
import { layerDisplayName, layerLabel } from '../lib/naming';

interface LayersPanelProps {
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggleHidden: (annotation: Annotation) => void;
  onToggleLock: (annotation: Annotation) => void;
  onReorder: (from: string, to: string) => void;
  imageSrc: string;
  dimensions: string;
  toolIcons: Record<string, IconName>;
}

export default function LayersPanel({
  annotations, selectedId, onSelect, onToggleHidden, onToggleLock, onReorder, imageSrc, dimensions, toolIcons,
}: LayersPanelProps) {
  const dragged = useRef<string | null>(null);
  // Figma numbers layers from the top of the stack downwards.
  const counters = new Map<string, number>();
  const rows = [...annotations].reverse().map(annotation => {
    const base = layerLabel(annotation.type);
    const next = (counters.get(base) || 0) + 1;
    counters.set(base, next);
    return { annotation, name: layerDisplayName(annotation, next), base };
  });

  return (
    <aside data-panel="left" className="flex flex-col min-h-0 shrink-0 w-[var(--left-w)] bg-surface border-r border-line max-[1040px]:hidden">
      <div className="flex items-center justify-between h-[38px] shrink-0 px-1.5 pl-3 border-b border-line-soft">
        <h2 className="text-[12px] font-medium tracking-[-.01em]">Layers</h2>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none py-[5px] px-1" role="list">
        {rows.map(({ annotation, name, base }) => (
          <div
            key={annotation.id}
            role="listitem"
            data-testid="layer-row"
            data-selected={selectedId === annotation.id || undefined}
            className="group relative flex items-center h-7 rounded-control text-ink hover:bg-black/[.04] data-[selected]:bg-accent-soft"
            draggable
            onDragStart={() => { dragged.current = annotation.id; }}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              if (dragged.current && dragged.current !== annotation.id) onReorder(dragged.current, annotation.id);
              dragged.current = null;
            }}
            onDragEnd={() => { dragged.current = null; }}
          >
            <button type="button" data-testid="layer-select" className="flex-1 flex items-center gap-2 min-w-0 h-full pl-[7px] pr-1 text-left text-inherit" onClick={() => onSelect(annotation.id)} title={name}>
              <span className="grid place-items-center w-[15px] text-ink-3 group-data-[selected]:text-accent-ink"><Icon name={toolIcons[annotation.type] || 'rectangle'} size={14} /></span>
              <span className="flex flex-col justify-center min-w-0 text-app leading-[1.25] overflow-hidden whitespace-nowrap text-ellipsis group-data-[selected]:text-accent-ink group-data-[selected]:font-medium">{name}</span>
            </button>
            <div className="hidden items-center pr-[3px] group-hover:flex group-data-[selected]:flex">
               <IconButton
                icon={annotation.locked ? 'lock' : 'unlock'}
                label={annotation.locked ? 'Unlock layer' : 'Lock layer'}
                tone={annotation.locked ? 'locked' : 'default'}
                size={24}
                iconSize={14}
                onClick={() => onToggleLock(annotation)}
              />
              <IconButton
                icon={annotation.hidden ? 'hidden' : 'eye'}
                label={annotation.hidden ? `Show ${base}` : `Hide ${base}`}
                size={24}
                iconSize={14}
                tone="muted"
                onClick={() => onToggleHidden(annotation)}
              />
            </div>
          </div>
        ))}

        <div data-testid="layer-row" data-kind="image" data-selected={selectedId === null || undefined} className="group relative flex items-center h-7 rounded-control text-ink hover:bg-black/[.04] data-[selected]:bg-accent-soft">
          <button type="button" data-testid="layer-select" className="flex-1 flex items-center gap-2 min-w-0 h-full pl-[7px] pr-1 text-left text-inherit" onClick={() => onSelect(null)}>
            <span className="block w-[18px] h-[18px] rounded-[3px] overflow-hidden bg-surface shrink-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)]"><img className="block w-full h-full object-cover" src={imageSrc} alt="" /></span>
            <span className="flex flex-col justify-center min-w-0 text-app leading-[1.25] overflow-hidden whitespace-nowrap text-ellipsis group-data-[selected]:text-accent-ink group-data-[selected]:font-medium">Screenshot<small className="text-[10px] font-normal text-ink-3 group-data-[selected]:text-accent-ink group-data-[selected]:opacity-70">{dimensions}</small></span>
          </button>
        </div>
      </div>

      {!annotations.length ? (
        <p className="px-3 pt-2.5 pb-3.5 text-app leading-[1.5] text-ink-3 border-t border-line-soft">Choose a shape tool, then drag on the image to add a layer.</p>
      ) : null}
    </aside>
  );
}
