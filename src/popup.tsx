import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Brand, Icon, type IconName } from './components/Icon';
import './styles.css';

function Popup() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const extension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  async function capture(mode: 'area' | 'visible' | 'full') {
    if (!extension) { setError('Load the dist folder as an unpacked extension in Chrome or Edge to capture a webpage. You can try the editor below.'); return; }
    setError(''); setBusy(mode);
    try {
      const promise = chrome.runtime.sendMessage({ type: 'IMAGESHOT_CAPTURE', mode });
      if (mode === 'area') { window.setTimeout(() => window.close(), 150); }
      const result = await promise;
      if (!result?.ok) setError(result?.error || 'Capture could not finish. Try again on a regular webpage.');
      else window.close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(null); }
  }
  function openEditor() {
    if (extension) chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
    else window.open('./editor.html', '_blank');
  }
  const modes: { id: 'area' | 'visible' | 'full'; icon: IconName; title: string; text: string }[] = [
    { id: 'visible', icon: 'display', title: 'Visible page', text: 'Current viewport' },
    { id: 'full', icon: 'full', title: 'Full page', text: 'Entire webpage' },
    { id: 'area', icon: 'crop', title: 'Select area', text: 'Choose a region' },
  ];
  return <div className="w-[360px] overflow-hidden bg-white text-[#272b31] text-[13px]">
    <header className="flex items-center justify-between h-[66px] px-4 border-b border-[#e9ebee]">
      <Brand small />
      <span className="inline-flex items-center gap-[5px] px-[7px] py-[5px] border border-[#e5e8ec] rounded-[5px] bg-[#f8f9fb] text-[#68717e] text-[10px] font-medium"><Icon name="image" size={14} />Screenshot</span>
    </header>
    <main className="p-3.5">
      <div className="grid grid-cols-2 gap-2" aria-label="Capture options">
        {modes.map(m => {
          const primary = m.id === 'visible';
          const busyHere = busy === m.id;
          return <button
            key={m.id}
            disabled={!!busy}
            aria-label={m.title}
            aria-busy={busyHere}
            // One class list per variant: two `bg-*` utilities would be sorted by the
            // stylesheet, not by the order they appear here.
            className={`flex flex-col items-center justify-center gap-[5px] min-w-0 h-[87px] px-1.5 py-2.5 rounded-[7px] border shadow-[0_1px_1px_#15202e03] transition-[border-color,background] duration-150 disabled:cursor-wait disabled:opacity-50 aria-busy:opacity-100 ${
              primary
                ? 'border-[#91bbf4] bg-[#f0f6ff] text-[#226bcd] enabled:hover:border-[#2478ea] enabled:hover:bg-[#e6f0ff]'
                : 'border-[#dfe3e8] bg-[#fbfcfd] text-[#343b45] enabled:hover:border-[#aeb9c6] enabled:hover:bg-[#f2f5f8]'}`}
            onClick={() => capture(m.id)}
          >
            <Icon name={busyHere ? 'reset' : m.icon} size={23} className={`${primary ? 'text-[#2478ea]' : 'text-[#66707e]'} ${busyHere ? 'animate-busy' : ''}`} />
            <strong className="mt-0.5 text-[13px] font-semibold leading-[1.2]">{busyHere ? 'Capturing\u2026' : m.title}</strong>
            <span className={`text-[10px] leading-[1.2] ${primary ? 'text-[#587dab]' : 'text-[#747d89]'}`}>{busyHere && m.id === 'full' ? 'Keep this tab visible' : m.text}</span>
          </button>;
        })}
        <button
          className="flex flex-col items-center justify-center gap-[5px] min-w-0 h-[87px] px-1.5 py-2.5 rounded-[7px] border border-[#dfe3e8] bg-[#fbfcfd] text-[#66707e] shadow-[0_1px_1px_#15202e03] transition-[border-color,background] duration-150 enabled:hover:border-[#aeb9c6] enabled:hover:bg-[#f2f5f8] disabled:cursor-wait disabled:opacity-50"
          onClick={openEditor}
          disabled={!!busy}
          aria-label="Open editor"
        >
          <Icon name="image" size={23} />
          <strong className="mt-0.5 text-[13px] font-semibold leading-[1.2] text-[#343b45]">Open editor</strong>
          <span className="text-[10px] leading-[1.2] text-[#747d89]">Edit an image</span>
        </button>
      </div>
      {error && <p role="alert" className="mt-3 px-[11px] py-2.5 border border-[#f1d3cc] rounded-[6px] bg-[#fff7f5] text-[#9b493b] text-[11px] leading-[1.55]">{error}</p>}
    </main>
    <footer className="flex items-center justify-between h-[34px] px-[15px] border-t border-[#eceef1] text-[10px] text-[#7d8693] bg-[#fafbfd] [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&_kbd]:font-normal [&_kbd]:text-[10px] [&_kbd]:text-[#707987]">
      <span><Icon name="keyboard" size={14} /><kbd>Alt + Shift + S</kbd></span>
      <span><i className="w-1 h-1 rounded-full bg-[#6c967a]" />Saved locally</span>
    </footer>
  </div>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Popup /></React.StrictMode>);
