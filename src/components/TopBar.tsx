import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';
import { ActionButton, IconButton } from './ui';
import type { Tool } from '../lib/editor-types';

export interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  icon: IconName;
}

/** Figma-like tool clusters, separated by thin dividers. */
export const TOOL_GROUPS: ToolDef[][] = [
  [{ id: 'select', label: 'Select', key: 'V', icon: 'select' }],
  [
    { id: 'arrow', label: 'Line', key: 'A', icon: 'arrow' },
    { id: 'rectangle', label: 'Rectangle', key: 'R', icon: 'rectangle' },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse' },
      { id: 'text', label: 'Text', key: 'T', icon: 'text' }
  ],
  [

    { id: 'pen', label: 'Pen', key: 'P', icon: 'pen' },
    { id: 'highlight', label: 'Highlight', key: 'H', icon: 'highlight' },
    { id: 'blur', label: 'Pixelate', key: 'B', icon: 'blur' },
  ],
];

export const TOOLS: ToolDef[] = TOOL_GROUPS.flat();

interface TopBarProps {
  menuOpen: boolean;
  tool: Tool;
  exportOpen: boolean;
  exporting: boolean;
  onToggleMenu: () => void;
  onImport: () => void;
  onCapture: () => void;
  onRecent: () => void;
  onSample: () => void;
  onTool: (tool: Tool) => void;
  zoom: number;
  actualZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onCopy: () => void;
  onToggleExport: () => void;
  onShortcuts: () => void;
  exportMenu: React.ReactNode;
}

export default function TopBar({
  menuOpen, tool, exportOpen, exporting, zoom, actualZoom,
  onToggleMenu, onImport, onCapture, onRecent, onSample, onTool,
  onZoomIn, onZoomOut, onFit, onCopy, onToggleExport, onShortcuts, exportMenu,
}: TopBarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onToggleMenu();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, onToggleMenu]);

  return (
    <header className="relative z-40 grid items-center h-12 shrink-0 bg-surface border-b border-line grid-cols-[var(--left-w)_minmax(0,1fr)_var(--right-w)] max-[1040px]:grid-cols-[0_minmax(0,1fr)_var(--right-w)]">
      <div className="col-start-1 flex items-center gap-0.5 min-w-0 pl-3 max-[1040px]:absolute max-[1040px]:left-1.5 max-[1040px]:pl-0">
        <div className="relative flex items-center gap-px" ref={menuRef}>
          <button type="button" className="grid place-items-center w-7 h-7 rounded-[7px] shrink-0 hover:bg-black/5" aria-label="ImageShot menu" title="ImageShot menu" onClick={onToggleMenu} aria-expanded={menuOpen}>
            <img className="w-[22px] h-[22px] block" src="./favicon.svg" alt="" />
          </button>
          <IconButton icon="chevron" label="File menu" size={24} iconSize={14} active={menuOpen} onClick={onToggleMenu} />
          {menuOpen ? (
            <div className="absolute top-[calc(100%+6px)] left-0 z-[200] min-w-[208px] p-1 rounded-lg bg-surface shadow-[0_0_0_1px_rgba(0,0,0,.06),0_12px_28px_rgba(0,0,0,.14),0_3px_8px_rgba(0,0,0,.07)]" role="menu">
              <button type="button" role="menuitem" className="flex items-center gap-2 w-full h-7 px-2 rounded-[5px] text-app text-ink text-left hover:bg-field" onClick={onImport}><Icon name="upload" size={15} className="text-ink-3" />Import image</button>
              <button type="button" role="menuitem" className="flex items-center gap-2 w-full h-7 px-2 rounded-[5px] text-app text-ink text-left hover:bg-field" onClick={onCapture}><Icon name="camera" size={15} className="text-ink-3" />New capture</button>
              <button type="button" role="menuitem" className="flex items-center gap-2 w-full h-7 px-2 rounded-[5px] text-app text-ink text-left hover:bg-field" onClick={onRecent}><Icon name="folder" size={15} className="text-ink-3" />Recent captures</button>
              <span className="block h-px my-1 mx-1.5 bg-line" />
              <button type="button" role="menuitem" className="flex items-center gap-2 w-full h-7 px-2 rounded-[5px] text-app text-ink text-left hover:bg-field" onClick={onSample}><Icon name="reset" size={15} className="text-ink-3" />Open sample</button>
              <button type="button" role="menuitem" className="flex items-center gap-2 w-full h-7 px-2 rounded-[5px] text-app text-ink text-left hover:bg-field" onClick={onShortcuts}><Icon name="keyboard" size={15} className="text-ink-3" />Keyboard shortcuts</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="col-start-2 flex items-center justify-center min-w-0">
        <div className="flex items-center gap-0.5 p-1 rounded-lg bg-surface" role="toolbar" aria-label="Annotation tools">
          {TOOL_GROUPS.map((group, groupIndex) => (
            <div
              data-tool-group=""
              className="flex gap-0.5 relative [&+[data-tool-group]]:ml-[3px] [&+[data-tool-group]]:pl-[5px] [&+[data-tool-group]]:before:content-[''] [&+[data-tool-group]]:before:absolute [&+[data-tool-group]]:before:left-0 [&+[data-tool-group]]:before:top-1/2 [&+[data-tool-group]]:before:w-px [&+[data-tool-group]]:before:h-[18px] [&+[data-tool-group]]:before:-translate-y-1/2 [&+[data-tool-group]]:before:bg-line"
              key={groupIndex}
            >
              {group.map(item => (
                <button
                  key={item.id}
                  type="button"
                  data-active={tool === item.id || undefined}
                  className="group relative grid place-items-center w-[34px] h-[34px] max-[760px]:w-[30px] max-[760px]:h-[30px] rounded-[7px] text-ink-2 hover:bg-black/[.055] hover:text-ink data-[active]:bg-accent-soft data-[active]:text-accent-ink"
                  aria-label={`${item.label} (${item.key})`}
                  aria-pressed={tool === item.id}
                  onClick={() => onTool(item.id)}
                >
                  <Icon name={item.icon} size={24} />
                  <span className="absolute top-[calc(100%+9px)] left-1/2 translate-x-[-50%] translate-y-[-3px] inline-flex items-center gap-1.5 px-[7px] py-[5px] rounded-[6px] bg-ink text-white text-app font-[450] whitespace-nowrap opacity-0 pointer-events-none z-[60] transition-[opacity,transform] duration-[.12s] ease-out delay-[.35s] group-hover:opacity-100 group-hover:translate-y-0">{item.label}<kbd className="font-ui text-[10px] font-[450] px-1 py-0.5 rounded-[4px] bg-white/12">{item.key}</kbd></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div data-testid="header-actions" className="col-start-3 flex items-center gap-1 justify-end pr-1.5">
        <div className="flex items-center gap-px ml-1 p-0.5 rounded-control bg-field max-[760px]:hidden">
          <IconButton icon="zoomOut" label="Zoom out" size={24} iconSize={15} onClick={onZoomOut} />
          <button type="button" className="min-w-[44px] h-6 rounded-[4px] text-app text-ink tabular-nums hover:bg-field-hover" title="Reset zoom to fit" onClick={onFit}>{Math.round(actualZoom * 100)}%</button>
          <IconButton icon="zoomIn" label="Zoom in" size={24} iconSize={15} onClick={onZoomIn} />
          <span className="w-px h-[14px] mx-0.5 bg-black/10 max-[900px]:hidden" />
          <IconButton icon="fit" label="Fit to canvas (0)" size={24} iconSize={15} onClick={onFit} />
        </div>
        <span className="w-px h-5 bg-line shrink-0" />
        <ActionButton icon="copy" onClick={onCopy} title="Copy image to clipboard" ariaLabel="Copy image to clipboard" className="max-[900px]:px-2">Copy</ActionButton>
        <div className="relative flex">
          <ActionButton
            icon="export"
            variant="primary"
            onClick={onToggleExport}
            title="Export image"
            ariaLabel="Export image"
            trailing={<Icon name="chevron" size={12} data-open={exportOpen || undefined} className="-ml-[4.5px] opacity-75 transition-transform duration-[.14s] data-[open]:rotate-180" />}
          >
            Export
          </ActionButton>
          {exportOpen ? exportMenu : null}
        </div>
        {exporting ? <span className="inline-flex items-center gap-[5px] text-app text-ink-2 pl-0.5"><Icon name="reset" size={14} className="animate-busy" />Working…</span> : null}
      </div>
    </header>
  );
}
