import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './components/Icon';
import EditorCanvas from './components/EditorCanvas';
import LayersPanel from './components/LayersPanel';
import PropertiesPanel from './components/PropertiesPanel';
import TopBar, { TOOLS } from './components/TopBar';
import ExportMenu from './components/ExportMenu';
import { IconButton } from './components/ui';
import { DEFAULT_STYLE, type Annotation, type CompositionStyle, type Tool } from './lib/editor-types';
import { annotationBounds, getCompositionSize, renderComposition } from './lib/render';
import { layerDisplayName } from './lib/naming';
import { getCapture, listCaptures, materializeCapture, type CaptureRecord } from './lib/capture-store';
import { readDraft, writeDraft, type ShotDocument } from './lib/document-store';
import { createExportBlob, type ExportFormat } from './lib/export';

const toolIcons = TOOLS.reduce<Record<string, IconName>>((map, tool) => ({ ...map, [tool.id]: tool.icon }), {});
const initialDocument: ShotDocument = { name: 'A little more clarity', imageSrc: './sample-workspace.svg', annotations: [], style: DEFAULT_STYLE, sample: true };
type Dialog = 'capture' | 'shortcuts' | 'recent' | null;

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref}
      className="m-auto w-[min(440px,calc(100vw-32px))] p-0 border-0 rounded-xl bg-surface text-ink shadow-[0_24px_64px_rgba(15,12,30,.24),0_0_0_1px_rgba(0,0,0,.06)] backdrop:bg-[rgba(24,20,38,.32)] backdrop:blur-[2px]"
      onCancel={onClose}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-[550] tracking-[-.2px]">{title}</h2>
            <p className="mt-[3px] text-app text-ink-2 leading-[1.5]">{subtitle}</p>
          </div>
          <IconButton icon="close" label="Close dialog" onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
}

export default function App() {
  const [doc, setDoc] = useState<ShotDocument>(initialDocument);
  const docRef = useRef(doc); docRef.current = doc;
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [past, setPast] = useState<ShotDocument[]>([]);
  const [future, setFuture] = useState<ShotDocument[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState({ color: '#000000', strokeWidth: 4, fontSize: 32, fill: null as string | null, radius: 3, opacity: 100 });
  const [zoom, setZoom] = useState(1);
  const [actualZoom, setActualZoom] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [exportScale, setExportScale] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportPreview, setExportPreview] = useState('');
  const [recent, setRecent] = useState<CaptureRecord[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const selected = doc.annotations.find(a => a.id === selectedId) ?? null;
  const size = useMemo(() => (image ? getCompositionSize(image, doc.style) : { width: 0, height: 0 }), [image, doc.style]);
  const selectedIndex = useMemo(() => {
    if (!selected) return 1;
    let counter = 0;
    let found = 0;
    [...doc.annotations].reverse().forEach(annotation => {
      if (annotation.id === selected.id) { found = counter + 1; return; }
      if (annotation.type === selected.type) counter += 1;
    });
    return found || 1;
  }, [doc.annotations, selected]);
  const selectedName = selected ? layerDisplayName(selected, selectedIndex) : 'Screenshot';

  /** Steps the on-screen scale by whole percentage points (5% per click). */
  const zoomBy = useCallback((delta: number) => {
    setZoom(current => {
      const shown = Math.max(0.05, actualZoom) || 1;
      const next = Math.max(0.1, Math.min(4, actualZoom + delta));
      return Math.max(0.1, Math.min(4, current * (next / shown)));
    });
  }, [actualZoom]);

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);

  const commit = useCallback((change: Partial<ShotDocument> | ((d: ShotDocument) => ShotDocument)) => {
    const current = docRef.current;
    const next = typeof change === 'function' ? change(current) : { ...current, ...change };
    if (next === current) return;
    setPast(p => [...p.slice(-39), current]);
    setFuture([]);
    docRef.current = next;
    setDoc(next);
  }, []);

  const changeStyle = (change: Partial<CompositionStyle>) => commit(d => ({ ...d, style: { ...d.style, ...change } }));

  function undo() {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setFuture(f => [docRef.current, ...f]);
    setPast(p => p.slice(0, -1));
    docRef.current = previous;
    setDoc(previous);
    setSelectedId(null);
  }
  function redo() {
    if (!future.length) return;
    const next = future[0];
    setPast(p => [...p, docRef.current]);
    setFuture(f => f.slice(1));
    docRef.current = next;
    setDoc(next);
    setSelectedId(null);
  }
  function updateAnnotation(id: string, change: Partial<Annotation>) {
    commit(d => ({ ...d, annotations: d.annotations.map(a => (a.id === id ? { ...a, ...change } : a)) }));
  }
  function deleteSelected() {
    if (!selected || selected.locked) return;
    commit(d => ({ ...d, annotations: d.annotations.filter(a => a.id !== selectedId) }));
    setSelectedId(null);
  }
  function duplicateSelected() {
    if (!selected) return;
    const copy = { ...selected, id: crypto.randomUUID(), x: selected.x + 20, y: selected.y + 20, locked: false };
    commit(d => ({ ...d, annotations: [...d.annotations, copy] }));
    setSelectedId(copy.id);
  }
  /** Applies a bounding box, keeping each layer type's geometry consistent. */
  function applyBox(id: string, box: { x: number; y: number; width: number; height: number }, extra?: Partial<Annotation>) {
    commit(d => ({
      ...d,
      annotations: d.annotations.map(annotation => {
        if (annotation.id !== id) return annotation;
        const current = annotationBounds(annotation);
        if (annotation.type === 'arrow') {
          return { ...annotation, x: annotation.x + (box.x - current.x), y: annotation.y + (box.y - current.y) };
        }
        if (annotation.type === 'text') {
          const factor = box.width / (current.width || 1);
          return { ...annotation, x: box.x, y: box.y, fontSize: Math.max(8, Math.round((annotation.fontSize || 28) * factor)) };
        }
        if (annotation.type === 'number') {
          const side = Math.max(20, box.width, box.height);
          return { ...annotation, x: box.x, y: box.y, width: side, height: side };
        }
        return {
          ...annotation,
          ...extra,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          points: annotation.points?.map(point => ({ x: point.x * (box.width / (current.width || 1)), y: point.y * (box.height / (current.height || 1)) })),
        };
      }),
    }));
  }
  function patchLayer(patch: Partial<Annotation>) {
    if (!selected) return;
    const boxKeys = ['width', 'height'] as const;
    if (boxKeys.some(key => key in patch)) {
      const current = annotationBounds(selected);
      // A text box is measured, so a caller that also carries typography (the
      // inspector) must not lose it to the box branch.
      const rest = Object.fromEntries(Object.entries(patch).filter(([key]) => !boxKeys.includes(key as (typeof boxKeys)[number])));
      applyBox(selected.id, {
        x: current.x,
        y: current.y,
        width: Math.max(1, patch.width ?? current.width),
        height: Math.max(1, patch.height ?? current.height),
      }, rest as Partial<Annotation>);
      return;
    }
    updateAnnotation(selected.id, patch);
  }

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const id = new URLSearchParams(window.location.search).get('capture');
        if (id) {
          const draft = await readDraft(`capture:${id}`);
          if (draft) { if (live) setDoc({ ...draft, style: { ...DEFAULT_STYLE, ...draft.style } }); return; }
          const capture = await getCapture(id);
          if (!capture) throw new Error('This capture is no longer available. Import an image or take a new screenshot.');
          const dataUrl = await materializeCapture(capture);
          if (live) setDoc({ ...initialDocument, name: capture.name, imageSrc: dataUrl, sample: false, captureId: id });
        } else {
          const draft = await readDraft();
          if (draft && live) setDoc({ ...draft, style: { ...DEFAULT_STYLE, ...draft.style } });
        }
      } catch (error) {
        if (live) notify(error instanceof Error ? error.message : 'Could not load the previous capture.');
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => { live = false; };
  }, [notify]);

  useEffect(() => {
    let live = true;
    const next = new Image();
    next.onload = () => { if (live) setImage(next); };
    next.onerror = () => { if (live) { setImage(null); notify('This image could not be opened. Try a PNG, JPG, or WebP.'); } };
    next.src = doc.imageSrc;
    return () => { live = false; };
  }, [doc.imageSrc, notify]);

  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (doc.captureId) url.searchParams.set('capture', doc.captureId); else url.searchParams.delete('capture');
    window.history.replaceState(null, '', url);
    const timer = setTimeout(() => { void writeDraft(doc); }, 650);
    return () => clearTimeout(timer);
  }, [doc, ready]);

  useEffect(() => {
    if (dialog === 'recent') listCaptures(12).then(setRecent).catch(() => notify('Could not load recent captures.'));
  }, [dialog, notify]);

  useEffect(() => {
    if (!exportOpen || !image) return;
    try {
      const preview = renderComposition(image, doc.annotations, doc.style, Math.min(1, 420 / size.width, 260 / size.height));
      setExportPreview(preview.toDataURL('image/png'));
      preview.width = 1;
      preview.height = 1;
    } catch {
      setExportPreview('');
    }
  }, [exportOpen, image, doc.annotations, doc.style, size.width, size.height]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]') || dialog) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); setExportOpen(value => !value); return; }
      if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
      if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); fileInput.current?.click(); return; }
      if (mod) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
      if (event.key === 'Escape') { setTool('select'); setSelectedId(null); setMenuOpen(false); setExportOpen(false); }
      const match = TOOLS.find(tool => tool.key.toLowerCase() === event.key.toLowerCase());
      if (match) { event.preventDefault(); setTool(match.id); }
      if (event.key === '0') setZoom(1);
      if (event.key === '+' || event.key === '=') zoomBy(0.05);
      if (event.key === '-') zoomBy(-0.05);
      if (event.key === '?') setDialog('shortcuts');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function importFile(file?: File) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { notify('Choose a PNG, JPG, WebP, or GIF image.'); return; }
    if (file.size > 40 * 1024 * 1024) { notify('Choose an image smaller than 40 MB.'); return; }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const probe = new Image();
      probe.src = dataUrl;
      await probe.decode();
      if (probe.naturalWidth * probe.naturalHeight > 48_000_000 || Math.max(probe.naturalWidth, probe.naturalHeight) > 32760) {
        throw new Error('This image is too large. Keep it under 48 megapixels and 32,760 pixels on either side.');
      }
      commit({ imageSrc: dataUrl, name: file.name.replace(/\.[^.]+$/, ''), annotations: [], sample: false, captureId: undefined });
      setSelectedId(null);
      setZoom(1);
      notify('Image imported.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'This image could not be imported.');
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea')) return;
      const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
      if (file) { event.preventDefault(); void importFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  async function exportImage(copy = false) {
    if (!image || exporting) return;
    setExporting(true);
    try {
      const outputSize = getCompositionSize(image, doc.style);
      const scale = copy ? 1 : exportScale;
      if (outputSize.width * outputSize.height * scale ** 2 > 64_000_000 || Math.max(outputSize.width, outputSize.height) * scale > 32760) {
        throw new Error('This export is too large. Reduce the export scale or the canvas padding.');
      }
      const canvas = renderComposition(image, doc.annotations, doc.style, scale);
      if (copy) {
        // Copy always hands over a PNG, whatever the format row is set to.
        const blobPromise = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create the image.'))), 'image/png'));
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard is unavailable here. Download your image instead.');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        notify('Image copied to clipboard.');
      } else {
        const blob = await createExportBlob(canvas, format);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${doc.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim() || 'imageshot'}.${format}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setExportOpen(false);
        notify('Export started.');
      }
      canvas.width = 1;
      canvas.height = 1;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed. Try PNG at 1×.');
    } finally {
      setExporting(false);
    }
  }

  async function openRecent(capture: CaptureRecord) {
    try {
      const saved = await readDraft(`capture:${capture.id}`);
      const imageSrc = saved?.imageSrc || await materializeCapture(capture);
      commit(saved ? { ...saved, style: { ...DEFAULT_STYLE, ...saved.style } } : { imageSrc, name: capture.name, annotations: [], style: DEFAULT_STYLE, sample: false, captureId: capture.id });
      setDialog(null);
      setZoom(1);
    } catch {
      notify('Could not open this capture.');
    }
  }

  function reorderLayer(from: string, to: string) {
    const source = doc.annotations.findIndex(item => item.id === from);
    const target = doc.annotations.findIndex(item => item.id === to);
    if (source < 0 || source === target) return;
    commit(d => {
      const next = [...d.annotations];
      const [moved] = next.splice(source, 1);
      next.splice(target, 0, moved);
      return { ...d, annotations: next };
    });
  }

  return (
    <div
      className={`relative flex flex-col h-dvh bg-canvas ${
        dragging ? "after:content-[''] after:absolute after:inset-1.5 after:z-[60] after:border-2 after:border-dashed after:border-accent after:rounded-[10px] after:bg-accent/5 after:pointer-events-none" : ''}`}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); void importFile(event.dataTransfer.files[0]); } }}
    >
      <input
        type="file"
        ref={fileInput}
        className="sr-only"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }}
      />

      <TopBar
        menuOpen={menuOpen}
        tool={tool}
        exportOpen={exportOpen}
        exporting={exporting}
        onToggleMenu={() => setMenuOpen(value => !value)}
        onImport={() => fileInput.current?.click()}
        onCapture={() => { setDialog('capture'); setMenuOpen(false); }}
        onRecent={() => { setDialog('recent'); setMenuOpen(false); }}
        onSample={() => { commit(initialDocument); setMenuOpen(false); setZoom(1); }}
        onShortcuts={() => { setDialog('shortcuts'); setMenuOpen(false); }}
        onTool={setTool}
        zoom={zoom}
        actualZoom={actualZoom}
        onZoomIn={() => zoomBy(0.05)}
        onZoomOut={() => zoomBy(-0.05)}
        onFit={() => setZoom(1)}
        onCopy={() => exportImage(true)}
        onToggleExport={() => setExportOpen(value => !value)}
        exportMenu={(
          <ExportMenu
            format={format}
            scale={exportScale}
            width={size.width}
            height={size.height}
            preview={exportPreview}
            exporting={exporting}
            ready={!!image}
            onFormat={setFormat}
            onScale={setExportScale}
            onDownload={() => exportImage(false)}
            onCopy={() => exportImage(true)}
            onClose={() => setExportOpen(false)}
          />
        )}
      />

      <div className="flex flex-1 min-h-0">
        <LayersPanel
          annotations={doc.annotations}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); setTool('select'); }}
          onToggleHidden={annotation => updateAnnotation(annotation.id, { hidden: !annotation.hidden })}
          onToggleLock={annotation => updateAnnotation(annotation.id, { locked: !annotation.locked })}
          onReorder={reorderLayer}
          imageSrc={doc.imageSrc}
          dimensions={image ? `${image.naturalWidth} × ${image.naturalHeight}` : 'Loading…'}
          toolIcons={toolIcons}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-canvas">
          <div className="relative flex-1 min-h-0 bg-canvas bg-[radial-gradient(circle,rgba(0,0,0,.09)_1px,transparent_1px)] bg-[length:16px_16px] bg-[position:-1px_-1px]">
            <EditorCanvas
              image={image}
              annotations={doc.annotations}
              onChange={annotations => commit({ annotations })}
              selectedId={selectedId}
              onSelect={setSelectedId}
              tool={tool}
              color={defaults.color}
              strokeWidth={defaults.strokeWidth}
              textSize={defaults.fontSize}
              style={doc.style}
              zoom={zoom}
              onToolChange={setTool}
              onZoomChange={setActualZoom}
              onCrop={(imageSrc, annotations) => { commit({ imageSrc, annotations }); setZoom(1); notify('Image cropped. Undo restores the original.'); }}
              onStatus={notify}
            />
          </div>
        </main>

        <PropertiesPanel
          selected={selected}
          selectedName={selectedName}
          style={doc.style}
          bounds={selected ? annotationBounds(selected) : null}
          tool={tool}
          defaults={defaults}
          onStyle={changeStyle}
          onLayer={patchLayer}
          onDefaults={patch => setDefaults(current => ({ ...current, ...patch }))}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
        />
      </div>

      {dialog === 'capture' && (
        <Modal title="Capture a screenshot" subtitle="Grab an area, the visible page, or the full scroll." onClose={() => setDialog(null)}>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="flex flex-col items-start gap-1 p-3 rounded-lg bg-panel text-left hover:bg-accent-soft" onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={20} className="text-ink-2" />
              <strong className="text-[12px] font-medium">Import an image</strong>
              <span className="text-[10px] leading-[1.5] text-ink-3">PNG, JPG, WebP or GIF</span>
            </button>
            <a className="flex flex-col items-start gap-1 p-3 rounded-lg bg-panel text-left hover:bg-accent-soft" href="./popup.html" target="_blank" rel="noreferrer">
              <Icon name="camera" size={20} className="text-ink-2" />
              <strong className="text-[12px] font-medium">Open capture popup</strong>
              <span className="text-[10px] leading-[1.5] text-ink-3">Load the dist folder as an unpacked extension</span>
            </a>
          </div>
        </Modal>
      )}

      {dialog === 'shortcuts' && (
        <Modal title="Keyboard shortcuts" subtitle="Everything you need, without the mouse." onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-px max-h-[46vh] overflow-y-auto scrollbar-none">
            {TOOLS.map(tool => (
              <div key={tool.id} className="flex items-center justify-between h-7 px-2 rounded-[5px] odd:bg-panel">
                <span className="inline-flex items-center gap-2"><Icon name={tool.icon} size={15} className="text-ink-3" />{tool.label}</span>
                <kbd className="font-ui text-[10px] font-[450] px-1 py-0.5 rounded-[4px] whitespace-nowrap bg-field text-ink-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,.05)]">{tool.key}</kbd>
              </div>
            ))}
            {[['Undo', 'Ctrl Z'], ['Redo', 'Ctrl Shift Z'], ['Export', 'Ctrl S'], ['Import image', 'Ctrl O'], ['Duplicate layer', 'Ctrl D'], ['Delete layer', 'Delete'], ['Fit canvas', '0']].map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between h-7 px-2 rounded-[5px] odd:bg-panel"><span>{label}</span><kbd className="font-ui text-[10px] font-[450] px-1 py-0.5 rounded-[4px] whitespace-nowrap bg-field text-ink-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,.05)]">{keys}</kbd></div>
            ))}
          </div>
        </Modal>
      )}

      {dialog === 'recent' && (
        <Modal title="Recent captures" subtitle="Stored privately in this browser." onClose={() => setDialog(null)}>
          {recent.length ? (
            <div className="flex flex-col gap-0.5 max-h-[46vh] overflow-y-auto scrollbar-none">
              {recent.map(capture => (
                <button key={capture.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-[6px] text-left hover:bg-panel" onClick={() => openRecent(capture)}>
                  <span className="grid place-items-center w-7 h-7 rounded-[6px] bg-field text-ink-3"><Icon name="image" size={18} /></span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <strong className="text-app font-medium overflow-hidden whitespace-nowrap text-ellipsis">{capture.name}</strong>
                    <small className="text-[10px] text-ink-3">{capture.width} × {capture.height} · {new Date(capture.createdAt).toLocaleDateString()}</small>
                  </div>
                  <Icon name="right" size={15} className="text-ink-3 ml-auto" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-5 px-3 text-center text-ink-3">
              <Icon name="camera" size={26} />
              <h3 className="text-[13px] font-medium text-ink">No captures yet</h3>
              <p className="text-app">Take a screenshot or import an image to get started.</p>
              <button className="mt-1.5 inline-flex items-center justify-center gap-1.5 h-[30px] px-2.5 rounded-control text-app font-medium bg-accent text-white whitespace-nowrap enabled:hover:bg-accent-hover" onClick={() => fileInput.current?.click()}><Icon name="upload" size={15} /><span>Import an image</span></button>
            </div>
          )}
        </Modal>
      )}

      {toast && (
        <div role="status" className="fixed left-1/2 bottom-11 -translate-x-1/2 z-[300] flex items-center gap-2 max-w-[min(520px,calc(100vw-24px))] py-2 pl-3 pr-2 rounded-lg bg-ink text-white text-app shadow-[0_10px_28px_rgba(0,0,0,.28)]">
          <Icon name="info" size={16} className="text-[#b9b4cc]" />
          <span>{toast}</span>
          <IconButton icon="close" label="Dismiss notification" size={22} iconSize={13} tone="inverse" onClick={() => setToast('')} />
        </div>
      )}


    </div>
  );
}
