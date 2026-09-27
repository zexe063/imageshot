import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { ActionButton, IconButton, Row, Segmented, Select } from './ui';
import type { ExportFormat, PdfPageSize } from '../lib/export';

const EXPORT_SCALES = [0.5, 1, 2, 3];
const PDF_SCALES = [1, 2, 3];
const PDF_PAGES: { value: PdfPageSize; label: string }[] = [
  { value: 'auto', label: 'Full image' },
  { value: 'image', label: 'Original size' },
  { value: 'a4', label: 'A4' },
];
const PDF_PAGE_HINTS: Record<PdfPageSize, string> = {
  auto: 'One continuous page at a readable width.',
  image: 'One page at the image’s original size; wide captures make wider pages.',
  a4: 'Fits the complete image on one A4 page.',
};

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'webp', label: 'WebP' },
  { value: 'pdf', label: 'PDF' },
];

interface ExportMenuProps {
  format: ExportFormat;
  scale: number;
  pageSize: PdfPageSize;
  width: number;
  height: number;
  preview: string;
  exporting: boolean;
  ready: boolean;
  onFormat: (format: ExportFormat) => void;
  onScale: (scale: number) => void;
  onPageSize: (pageSize: PdfPageSize) => void;
  onDownload: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export default function ExportMenu({
  format, scale, pageSize, width, height, preview, exporting, ready, onFormat, onScale, onPageSize, onDownload, onCopy, onClose,
}: ExportMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const imageAspect = width > 0 && height > 0 ? width / height : 1;
  const pageAspect = format === 'pdf' && pageSize === 'a4'
    ? (width > height ? 841.89 / 595.276 : 595.276 / 841.89)
    : imageAspect;
  const previewWidth = Math.min(244, 124 * pageAspect);
  const previewHeight = Math.min(124, 244 / pageAspect);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      if ((event.target as HTMLElement).closest('.export-wrap')) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-label="Export image" onMouseDown={event => event.stopPropagation()} className="absolute top-[calc(100%+8px)] right-0 z-[220] w-[268px] rounded-[10px] bg-surface overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,.06),0_14px_32px_rgba(0,0,0,.16),0_3px_8px_rgba(0,0,0,.08)]">
      <div className="flex items-center justify-between h-[34px] pl-3 pr-1.5 text-[12px] font-medium border-b border-line-soft">
        <span>Export</span>
        <IconButton icon="close" label="Close export menu" size={24} iconSize={14} onClick={onClose} />
      </div>
      <div className="grid place-items-center h-[148px] p-3 overflow-hidden bg-canvas bg-[repeating-conic-gradient(#dcdcdc_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
        {preview ? (
          <div
            className={`shadow-[0_2px_8px_rgba(0,0,0,.18)] ${format === 'pdf' ? 'bg-white' : ''}`}
            style={{ width: previewWidth, height: previewHeight }}
            aria-label={format === 'pdf' ? `${PDF_PAGES.find(page => page.value === pageSize)?.label} PDF page preview` : undefined}
          >
            <img className="block w-full h-full object-contain" src={preview} alt="Export preview" />
          </div>
        ) : <span className="text-ink-3"><Icon name="image" size={22} /></span>}
      </div>
      <div className="flex flex-col gap-2 pt-2.5 px-3 pb-3">
        <Segmented label="Format" value={format} onChange={onFormat} options={FORMATS} />
        {format === 'pdf' ? (
          <Row className="items-center">
            <span className="text-app text-ink-2">Page size</span>
            <Select<PdfPageSize>
              label="PDF page size"
              value={pageSize}
              onChange={onPageSize}
              options={PDF_PAGES}
            />
          </Row>
        ) : null}
        <Row>
          <div className="relative flex items-center gap-1.5 h-7 px-[7px] rounded-control bg-field min-w-0">
            <span className="text-app text-ink-2 whitespace-nowrap">Scale</span>
            <Select
              label="Export scale"
              value={scale}
              onChange={onScale}
              options={(format === 'pdf' ? PDF_SCALES : EXPORT_SCALES).map(value => ({ value, label: `${value}×` }))}
            />
          </div>
          <span className="text-[10px] text-ink-3 self-center whitespace-nowrap tabular-nums">{Math.round(width * scale).toLocaleString()} × {Math.round(height * scale).toLocaleString()} px</span>
        </Row>
        {format === 'jpg' ? <p className="text-[10px] leading-[1.5] text-ink-3">JPG has no transparency — transparent areas export as white.</p> : null}
        {format === 'pdf' ? <p className="text-[10px] leading-[1.5] text-ink-3">{PDF_PAGE_HINTS[pageSize]} No stretching or cropping. Scale changes resolution while keeping the page size.</p> : null}
        <ActionButton icon="download" variant="primary" onClick={onDownload} disabled={exporting || !ready} className="w-full h-8 [&>span]:block" ariaLabel="Download image">
          {exporting ? 'Preparing…' : `Export ${format.toUpperCase()}`}
        </ActionButton>
        <ActionButton icon="copy" onClick={onCopy} disabled={exporting || !ready} className="w-full h-8 [&>span]:block" ariaLabel="Copy image as PNG">
          Copy image (PNG)
        </ActionButton>
        <p className="flex items-center gap-[5px] text-[10px] text-ink-3"><Icon name="shield" size={13} />Rendered on your device. Nothing is uploaded.</p>
      </div>
    </div>
  );
}
