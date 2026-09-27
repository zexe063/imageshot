import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Brand, Icon, type IconName } from './components/Icon';
import { Segmented } from './components/ui';
import type { CaptureMode } from './lib/capture-store';
import './styles.css';

/** One word fits a stacked toolbar; the full name stays the accessible label. */
const MODES: { id: CaptureMode; icon: IconName; label: string; text: string }[] = [
  { id: 'visible', icon: 'display', label: 'Visible', text: 'the current viewport' },
  { id: 'full', icon: 'full', label: 'Fullpage', text: 'the whole webpage' },
  { id: 'area', icon: 'crop', label: 'Area', text: 'a region you drag out' },
];
const NAMES: Record<CaptureMode, string> = { visible: 'Visible page', full: 'Full page', area: 'Select area' };

function Popup() {
  const [busy, setBusy] = useState<CaptureMode | null>(null);
  const [error, setError] = useState('');
  const extension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  async function capture(mode: CaptureMode) {
    if (!extension) { setError('Load the dist folder as an unpacked extension in Chrome or Edge to capture a webpage. You can try the editor below.'); return; }
    setError(''); setBusy(mode);
    let closeTimer: ReturnType<typeof window.setTimeout> | undefined;
    try {
      const promise = chrome.runtime.sendMessage({ type: 'IMAGESHOT_CAPTURE', mode });
      // These two take over the page, so the popup steps aside straight away rather
      // than sitting on top of the thing being captured.
      if (mode === 'area' || mode === 'full') { closeTimer = window.setTimeout(() => window.close(), 150); }
      const result = await promise;
      if (!result?.ok) setError(result?.error || 'Capture could not finish. Try again on a regular webpage.');
      else window.close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); }
    finally { window.clearTimeout(closeTimer); setBusy(null); }
  }
  function openEditor() {
    if (extension) chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
    else window.open('./editor.html', '_blank');
  }
  const current = MODES.find(m => m.id === busy);
  return <div className="w-[336px] overflow-hidden bg-surface text-app">
    <header className="flex items-center justify-between h-[54px] px-4 border-b border-line">
      <Brand small />
      <span className="inline-flex items-center gap-[5px] px-2 py-[4px] border border-line rounded-full bg-panel text-ink-2 text-[10px] font-medium"><Icon name="image" size={13} />Screenshot</span>
    </header>

    <main className="p-3.5 flex flex-col gap-2.5">
      <Segmented
        layout="stacked"
        label="Capture options"
        // The raised card marks the type to use unless another is chosen, and follows
        // the capture in flight.
        value={busy ?? 'visible'}
        busy={!!busy}
        disabled={!!busy}
        options={MODES.map(m => ({ value: m.id, label: busy === m.id ? 'Capturing…' : m.label, icon: busy === m.id ? 'reset' : m.icon, name: NAMES[m.id] }))}
        onChange={value => capture(value as CaptureMode)}
      />

      <p className="flex items-center justify-center h-[15px] px-1 text-[10.5px] leading-none text-center text-ink-2 whitespace-nowrap" role="status" aria-live="polite">
        {current ? `Capturing ${current.text}` : 'Visible, full page, or a region you drag out'}
      </p>

      <button
        type="button"
        className="group flex items-center gap-2.5 w-full px-2.5 py-2 rounded-[9px] border border-line bg-surface text-left transition-[border-color,background,box-shadow] duration-150 enabled:hover:border-ink-4 enabled:hover:shadow-[0_1px_3px_rgba(0,0,0,.06)] enabled:active:bg-field disabled:cursor-wait disabled:opacity-50"
        onClick={openEditor}
        disabled={!!busy}
        aria-label="Open editor"
        aria-describedby="open-editor-description"
      >
        <span className="grid place-items-center w-[30px] h-[30px] rounded-[7px] bg-field text-ink-2 transition-colors group-hover:text-ink"><Icon name="image" size={16} /></span>
        <span className="flex flex-1 flex-col gap-[1px] min-w-0">
          <strong className="text-[12px] font-semibold leading-[1.25] text-ink">Open editor</strong>
          <span id="open-editor-description" className="text-[10.5px] leading-[1.25] text-ink-2">Import, annotate and export an image</span>
        </span>
        <Icon name="right" size={14} className="text-ink-3 transition-transform duration-150 group-hover:translate-x-px" />
      </button>

      {error && <p role="alert" className="px-3 py-2.5 border border-[#f1d3cc] rounded-[8px] bg-[#fff7f5] text-[#9b493b] text-[11px] leading-[1.55]">{error}</p>}
    </main>

    <footer className="flex items-center justify-between h-[30px] px-3.5 border-t border-line text-[10px] text-ink-3 bg-panel [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&_kbd]:font-normal [&_kbd]:text-[10px] [&_kbd]:text-ink-2 [&_kbd]:tracking-[.02em]">
      <span><Icon name="keyboard" size={13} /><kbd>Alt + Shift + S</kbd></span>
      <span><i className="w-1 h-1 rounded-full bg-[#6c967a]" />Saved locally</span>
    </footer>
  </div>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Popup /></React.StrictMode>);
