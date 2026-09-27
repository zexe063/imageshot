import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Annotation, ArrowDefaults, CompositionStyle, Point, Tool } from '../lib/editor-types';
import { annotationBounds, arrowBendPoint, arrowCurveAt, arrowGeometry, getCompositionSize, renderComposition, textFrame, textMetrics, textStack } from '../lib/render';

export interface EditorCanvasProps {
  image: HTMLImageElement | null;
  annotations: Annotation[];
  onChange: (annotations: Annotation[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tool: Tool;
  color: string;
  strokeWidth: number;
  /** The arrow body, bend and head a newly drawn arrow starts with. */
  arrow: ArrowDefaults;
  textSize: number;
  style: CompositionStyle;
  /** 1 is fit; other values multiply the fitted scale. */
  zoom: number;
  onToolChange?: (tool: Tool) => void;
  onCrop?: (dataUrl: string, annotations: Annotation[]) => void;
  onStatus?: (message: string) => void;
  /** Actual display scale relative to original screenshot pixels. */
  onZoomChange?: (actualZoom: number) => void;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se';
interface Gesture {
  mode: 'draw' | 'move' | 'resize' | 'bend' | 'crop';
  start: Point;
  base?: Annotation;
  handle?: Handle;
  points?: Point[];
}
interface TextEditor {
  annotation: Annotation;
  value: string;
  isNew: boolean;
}

const ACCENT = '#6244e0';
/** Breathing room around the artboard, and room kept free for a scrollbar. */
const CANVAS_INSET = 48;
const SCROLLBAR_ROOM = 17;

function distanceToLine(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function contains(annotation: Annotation, point: Point, tolerance: number) {
  if (annotation.hidden || annotation.locked) return false;
  if (annotation.type === 'arrow') {
    // The same body the canvas draws, so a bowed arrow is picked where it is drawn
    // and not along the straight chord between its ends.
    const path = arrowGeometry(annotation).path;
    const reach = Math.max(tolerance, annotation.strokeWidth * 2);
    for (let index = 1; index < path.length; index += 1) {
      if (distanceToLine(point, path[index - 1], path[index]) <= reach) return true;
    }
    return false;
  }
  if (annotation.type === 'pen') {
    const points = annotation.points || [];
    return points.some((p, index) => {
      const previous = points[Math.max(0, index - 1)];
      return distanceToLine(point, { x: annotation.x + previous.x, y: annotation.y + previous.y }, { x: annotation.x + p.x, y: annotation.y + p.y }) <= Math.max(tolerance, annotation.strokeWidth * 2);
    });
  }
  const box = annotationBounds(annotation);
  return point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance && point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance;
}

function resizeAnnotation(annotation: Annotation, handle: Handle, point: Point): Annotation {
  const box = annotationBounds(annotation);
  const opposite = {
    x: handle.includes('w') ? box.x + box.width : box.x,
    y: handle.includes('n') ? box.y + box.height : box.y,
  };
  const left = Math.min(point.x, opposite.x);
  const top = Math.min(point.y, opposite.y);
  const width = Math.max(3, Math.abs(point.x - opposite.x));
  const height = Math.max(3, Math.abs(point.y - opposite.y));
  if (annotation.type === 'arrow') {
    return {
      ...annotation,
      x: annotation.width < 0 ? left + width : left,
      y: annotation.height < 0 ? top + height : top,
      width: annotation.width < 0 ? -width : width,
      height: annotation.height < 0 ? -height : height,
    };
  }
  if (annotation.type === 'text') {
    const factor = Math.max(width / box.width, height / box.height);
    return { ...annotation, x: left, y: top, width: box.width * factor, height: box.height * factor, fontSize: Math.max(8, (annotation.fontSize || 28) * factor) };
  }
  if (annotation.type === 'number') {
    const side = Math.max(20, width, height);
    return { ...annotation, x: left, y: top, width: side, height: side };
  }
  return {
    ...annotation, x: left, y: top, width, height,
    points: annotation.points?.map(p => ({ x: p.x * width / box.width, y: p.y * height / box.height })),
  };
}

/** The box a piece of text needs, measured with the same code the canvas draws with. */
function textDimensions(annotation: Annotation, text: string, fontSize: number) {
  return textFrame({ ...annotation, text, fontSize: annotation.fontSize || fontSize });
}

export function EditorCanvas({ image, annotations, onChange, selectedId, onSelect, tool, color, strokeWidth, arrow, textSize, style, zoom, onToolChange, onCrop, onStatus, onZoomChange }: EditorCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const textEditorRef = useRef<TextEditor | null>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 700 });
  const [draft, setDraftState] = useState<Annotation | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [textEditor, setTextEditorState] = useState<TextEditor | null>(null);

  const setDraft = (annotation: Annotation | null) => {
    draftRef.current = annotation;
    setDraftState(annotation);
  };
  const setTextEditor = (value: TextEditor | null) => {
    textEditorRef.current = value;
    setTextEditorState(value);
  };

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Coalesce bursts and keep the object identity stable when nothing moved,
      // otherwise the artboard resize and the observer can ping-pong forever.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        setViewport(current => (current.width === width && current.height === height ? current : { width, height }));
      });
    });
    observer.observe(viewportElement);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const size = useMemo(() => image ? getCompositionSize(image, style) : null, [image, style]);
  // Scrollbar room is reserved up front: without it, growing the artboard adds a
  // scrollbar, which shrinks the viewport, which shrinks the artboard, and the
  // studio spins at mid zoom levels.
  const fit = size ? Math.min(
    1,
    Math.max(80, viewport.width - CANVAS_INSET * 2 - SCROLLBAR_ROOM) / size.width,
    size.height > size.width * 2 ? 1 : Math.max(80, viewport.height - CANVAS_INSET * 2 - SCROLLBAR_ROOM) / size.height,
  ) : 1;
  const displayScale = fit * Math.max(0.1, zoom);
  useEffect(() => { onZoomChange?.(displayScale); }, [displayScale, onZoomChange]);

  const visibleAnnotations = useMemo(() => {
    const editingId = textEditor?.annotation.id;
    const current = annotations.filter(a => a.id !== editingId);
    if (!draft) return current;
    return current.some(a => a.id === draft.id) ? current.map(a => a.id === draft.id ? draft : a) : [...current, draft];
  }, [annotations, draft, textEditor?.annotation.id]);

  useEffect(() => {
    if (!image || !size || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rasterScale = Math.min(1, displayScale * Math.min(window.devicePixelRatio || 1, 2), 16000 / Math.max(size.width, size.height), Math.sqrt(12000000 / (size.width * size.height)));
    const frame = requestAnimationFrame(() => renderComposition(image, visibleAnnotations, style, rasterScale, canvas));
    return () => cancelAnimationFrame(frame);
  }, [image, visibleAnnotations, style, displayScale, size]);

  useEffect(() => {
    gestureRef.current = null;
    setDraft(null);
    setCrop(null);
    setTextEditor(null);
  }, [image]);

  const coordinates = (event: ReactPointerEvent<HTMLDivElement>, clamp = true): Point => {
    const rect = artboardRef.current!.getBoundingClientRect();
    const x = (event.clientX - rect.left) / displayScale - (size?.imageX || 0);
    const y = (event.clientY - rect.top) / displayScale - (size?.imageY || 0);
    return clamp && size ? { x: Math.max(0, Math.min(size.imageWidth, x)), y: Math.max(0, Math.min(size.imageHeight, y)) } : { x, y };
  };

  const commitText = () => {
    const editor = textEditorRef.current;
    if (!editor) return;
    setTextEditor(null);
    const text = editor.value.trim();
    if (!text) {
      if (!editor.isNew) onChange(annotations.filter(a => a.id !== editor.annotation.id));
      onSelect(null);
      return;
    }
    const annotation = { ...editor.annotation, text, ...textDimensions(editor.annotation, text, textSize) };
    onChange(editor.isNew ? [...annotations, annotation] : annotations.map(a => a.id === annotation.id ? annotation : a));
    onSelect(annotation.id);
    onToolChange?.('select');
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!image || !size || event.button !== 0 || textEditorRef.current) return;
    const point = coordinates(event, false);
    const target = event.target as Element;
    const handle = target.getAttribute?.('data-handle') as Handle | null;
    const selected = annotations.find(a => a.id === selectedId && !a.hidden && !a.locked);
    if (handle && selected) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = { mode: 'resize', start: point, base: selected, handle };
      setDraft(selected);
      return;
    }
    // The bend handle sits on the arrow's own body, so it is picked before the
    // layer underneath it.
    if (target.getAttribute?.('data-bend') && selected?.type === 'arrow' && (selected.arrowStyle || 'straight') !== 'straight') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = { mode: 'bend', start: point, base: selected };
      setDraft(selected);
      return;
    }
    if (point.x < 0 || point.y < 0 || point.x > size.imageWidth || point.y > size.imageHeight) {
      onSelect(null);
      return;
    }
    if (tool === 'select') {
      const target = [...annotations].reverse().find(a => contains(a, point, 7 / displayScale));
      onSelect(target?.id || null);
      if (target) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = { mode: 'move', start: point, base: target };
        setDraft(target);
      }
      return;
    }
    if (tool === 'crop') {
      if (!onCrop) { onStatus?.('Cropping is unavailable for this image.'); return; }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelect(null);
      gestureRef.current = { mode: 'crop', start: point };
      setCrop({ ...point, width: 0, height: 0 });
      return;
    }
    const annotation: Annotation = {
      id: crypto.randomUUID(), type: tool, x: point.x, y: point.y, width: 0, height: 0, color, strokeWidth,
    };
    if (tool === 'arrow') {
      // A new arrow starts on the style, bend and head last used, so the next one in a
      // series matches without touching the panel again.
      Object.assign(annotation, arrow);
    }
    if (tool === 'text') {
      // Keep the original pointer's default focus action from immediately
      // blurring the inline editor that React mounts during this event.
      event.preventDefault();
      // Type reads as type: black ink first, never the colour the last shape used.
      annotation.color = '#000000';
      annotation.fontSize = textSize;
      const frame = textDimensions(annotation, '', textSize);
      annotation.width = frame.width;
      annotation.height = frame.height;
      setTextEditor({ annotation, value: '', isNew: true });
      onSelect(null);
      return;
    }
    if (tool === 'number') {
      const diameter = Math.max(36, textSize * 1.4);
      annotation.x -= diameter / 2;
      annotation.y -= diameter / 2;
      annotation.width = diameter;
      annotation.height = diameter;
      annotation.number = 1 + Math.max(0, ...annotations.filter(a => a.type === 'number').map(a => a.number || 0));
      onChange([...annotations, annotation]);
      onSelect(annotation.id);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { mode: 'draw', start: point, base: annotation, points: tool === 'pen' ? [point] : undefined };
    if (tool === 'pen') annotation.points = [{ x: 0, y: 0 }];
    setDraft(annotation);
    onSelect(annotation.id);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !size) return;
    const point = coordinates(event);
    if (gesture.mode === 'crop') {
      setCrop({ x: Math.min(gesture.start.x, point.x), y: Math.min(gesture.start.y, point.y), width: Math.abs(point.x - gesture.start.x), height: Math.abs(point.y - gesture.start.y) });
      return;
    }
    const base = gesture.base;
    if (!base) return;
    if (gesture.mode === 'move') {
      const x = base.x + point.x - gesture.start.x;
      const y = base.y + point.y - gesture.start.y;
      setDraft({ ...base, x, y });
    } else if (gesture.mode === 'bend') {
      setDraft({ ...base, curve: arrowCurveAt(base, point) });
    } else if (gesture.mode === 'resize' && gesture.handle) {
      setDraft(resizeAnnotation(base, gesture.handle, point));
    } else if (base.type === 'pen') {
      const points = gesture.points || [gesture.start];
      const last = points[points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.8 / displayScale) return;
      points.push(point);
      gesture.points = points;
      const minX = Math.min(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxX = Math.max(...points.map(p => p.x));
      const maxY = Math.max(...points.map(p => p.y));
      setDraft({ ...base, x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), points: points.map(p => ({ x: p.x - minX, y: p.y - minY })) });
    } else {
      let width = point.x - gesture.start.x;
      let height = point.y - gesture.start.y;
      if (event.shiftKey && ['rectangle', 'ellipse'].includes(base.type)) {
        const side = Math.max(Math.abs(width), Math.abs(height));
        width = side * (width < 0 ? -1 : 1);
        height = side * (height < 0 ? -1 : 1);
      }
      if (event.shiftKey && base.type === 'arrow') {
        const angle = Math.round(Math.atan2(height, width) / (Math.PI / 4)) * Math.PI / 4;
        const length = Math.hypot(width, height);
        width = Math.cos(angle) * length;
        height = Math.sin(angle) * length;
      }
      setDraft({ ...base, width, height });
    }
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.mode === 'crop' && image && size) {
      const end = coordinates(event);
      const x = Math.floor(Math.min(gesture.start.x, end.x));
      const y = Math.floor(Math.min(gesture.start.y, end.y));
      const width = Math.floor(Math.abs(end.x - gesture.start.x));
      const height = Math.floor(Math.abs(end.y - gesture.start.y));
      setCrop(null);
      if (width < 8 || height < 8) return;
      const cropped = document.createElement('canvas');
      cropped.width = width;
      cropped.height = height;
      const context = cropped.getContext('2d');
      if (!context) { onStatus?.('Could not crop this image. Please try again.'); return; }
      context.drawImage(image, x, y, width, height, 0, 0, width, height);
      const retained = annotations.filter(a => {
        const bounds = annotationBounds(a);
        return bounds.x + bounds.width > x && bounds.x < x + width && bounds.y + bounds.height > y && bounds.y < y + height;
      }).map(a => ({ ...a, x: a.x - x, y: a.y - y }));
      onCrop?.(cropped.toDataURL('image/png'), retained);
      onSelect(null);
      onToolChange?.('select');
      onStatus?.('Image cropped. You can undo to restore the original.');
      return;
    }
    const completed = draftRef.current;
    setDraft(null);
    if (!completed) return;
    if (gesture.mode === 'draw' && completed.type !== 'pen' && Math.hypot(completed.width, completed.height) < 4 / displayScale) { onSelect(null); return; }
    if (gesture.mode === 'move' && gesture.base?.x === completed.x && gesture.base?.y === completed.y) return;
    const normalized = completed.type === 'arrow' ? completed : { ...completed, ...annotationBounds(completed) };
    onChange(gesture.mode === 'draw' ? [...annotations, normalized] : annotations.map(a => a.id === completed.id ? normalized : a));
  };

  const cancelGesture = () => {
    gestureRef.current = null;
    setDraft(null);
    setCrop(null);
  };

  const selected = visibleAnnotations.find(a => a.id === selectedId && !a.hidden);
  const selection = selected ? annotationBounds(selected) : null;
  const cursor = tool === 'select'
    ? gestureRef.current?.mode === 'move' ? 'grabbing' : gestureRef.current?.mode === 'bend' ? 'grabbing' : 'default'
    : tool === 'text' ? 'text' : 'crosshair';
  const handlePositions: { key: Handle; x: number; y: number }[] = selection ? [
    { key: 'nw', x: selection.x, y: selection.y },
    { key: 'ne', x: selection.x + selection.width, y: selection.y },
    { key: 'sw', x: selection.x, y: selection.y + selection.height },
    { key: 'se', x: selection.x + selection.width, y: selection.y + selection.height },
  ] : [];
  // Only a bent arrow can be bent further, so the handle belongs to those alone.
  const bent = selected?.type === 'arrow' && (selected.arrowStyle || 'straight') !== 'straight' && !selected.locked;
  const bendHandle = bent && !textEditor && !crop ? arrowBendPoint(selected) : null;
  const chord = bent ? { x: selected.x + selected.width / 2, y: selected.y + selected.height / 2 } : null;
  const editorMetrics = textMetrics({
    id: 'editor', type: 'text', x: 0, y: 0, width: 0, height: 0, color: '#000000', strokeWidth: 0,
    ...(textEditor ? { ...textEditor.annotation, text: textEditor.value } : {}),
  });
  const overlayBase: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' };

  return (
    <div ref={viewportRef} className="flex-1 w-full h-full min-w-0 min-h-0 overflow-auto scrollbar-none relative overscroll-contain">
      <div className="flex items-center justify-center w-max min-w-full min-h-full box-border" style={{ padding: CANVAS_INSET }}>
        {image && size ? (
          <div
            ref={artboardRef}
            data-testid="editor-artboard"
            className="relative shrink-0 touch-none select-none"
            aria-label="Screenshot canvas. Choose a tool to annotate, or select a layer to move it."
            role="application"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={cancelGesture}
            onDoubleClick={event => {
              if (tool !== 'select') return;
              const rect = artboardRef.current!.getBoundingClientRect();
              const point = { x: (event.clientX - rect.left) / displayScale - size.imageX, y: (event.clientY - rect.top) / displayScale - size.imageY };
              const target = [...annotations].reverse().find(a => a.type === 'text' && contains(a, point, 4 / displayScale));
              if (target) { setTextEditor({ annotation: target, value: target.text || '', isNew: false }); onSelect(null); }
            }}
            style={{ width: size.width * displayScale, height: size.height * displayScale, cursor }}
          >
            <canvas ref={canvasRef} aria-label="Screenshot composition preview" className="block w-full h-full" />
            <svg style={overlayBase} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
              <g transform={`translate(${size.imageX} ${size.imageY})`}>
                {selection && !textEditor && !crop && (
                  <>
                    <rect x={selection.x} y={selection.y} width={selection.width} height={selection.height} fill="rgba(98, 68, 224, 0.04)" stroke={ACCENT} strokeWidth={1.25 / displayScale} strokeDasharray={selected?.locked ? `${4 / displayScale} ${3 / displayScale}` : undefined} />
                    {!selected?.locked && handlePositions.map(handle => (
                      <rect key={handle.key} data-handle={handle.key} x={handle.x - 3.5 / displayScale} y={handle.y - 3.5 / displayScale} width={7 / displayScale} height={7 / displayScale} rx={1 / displayScale} fill="white" stroke={ACCENT} strokeWidth={1.25 / displayScale} style={{ pointerEvents: 'all', cursor: `${handle.key}-resize` }} />
                    ))}
                    {bendHandle && chord && (
                      <g className="group">
                        <line x1={chord.x} y1={chord.y} x2={bendHandle.x} y2={bendHandle.y} stroke={ACCENT} strokeWidth={1 / displayScale} strokeDasharray={`${3 / displayScale} ${3 / displayScale}`} opacity={0.7} />
                        {/* A generous invisible target, so the handle is easy to grab at any zoom. */}
                        <circle data-bend="1" cx={bendHandle.x} cy={bendHandle.y} r={9 / displayScale} fill="transparent" className="cursor-grab group-hover:cursor-grab" style={{ pointerEvents: 'all' }} />
                        <circle cx={bendHandle.x} cy={bendHandle.y} r={4.5 / displayScale} fill="white" stroke={ACCENT} strokeWidth={1.5 / displayScale} className="transition-[fill] duration-100 group-hover:fill-[#ece9fe]" style={{ pointerEvents: 'none' }} />
                      </g>
                    )}
                  </>
                )}
                {crop && (
                  <>
                    <path d={`M 0 0 H ${size.imageWidth} V ${size.imageHeight} H 0 Z M ${crop.x} ${crop.y} V ${crop.y + crop.height} H ${crop.x + crop.width} V ${crop.y} Z`} fill="rgba(30, 30, 38, 0.5)" fillRule="evenodd" />
                    <rect x={crop.x} y={crop.y} width={crop.width} height={crop.height} fill="none" stroke="white" strokeWidth={1.5 / displayScale} strokeDasharray={`${6 / displayScale} ${4 / displayScale}`} />
                    <path d={`M ${crop.x + crop.width / 3} ${crop.y} V ${crop.y + crop.height} M ${crop.x + crop.width * 2 / 3} ${crop.y} V ${crop.y + crop.height} M ${crop.x} ${crop.y + crop.height / 3} H ${crop.x + crop.width} M ${crop.x} ${crop.y + crop.height * 2 / 3} H ${crop.x + crop.width}`} fill="none" stroke="rgba(255,255,255,.4)" strokeWidth={0.5 / displayScale} />
                  </>
                )}
              </g>
            </svg>
            {textEditor && (
              <textarea
                key={textEditor.annotation.id}
                autoFocus
                aria-label="Annotation text"
                placeholder="Type something…"
                value={textEditor.value}
                onChange={event => setTextEditor({ ...textEditor, value: event.target.value })}
                onPointerDown={event => event.stopPropagation()}
                onBlur={commitText}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Escape') { setTextEditor(null); onSelect(null); }
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commitText(); }
                }}
                style={{
                  position: 'absolute',
                  left: (size.imageX + textEditor.annotation.x) * displayScale - 5,
                  top: (size.imageY + textEditor.annotation.y) * displayScale - 4,
                  // The editor box follows the same metrics as the canvas, so what is
                  // typed is exactly what the layer renders.
                  width: Math.max(160, Math.min(size.imageWidth - textEditor.annotation.x, textDimensions(textEditor.annotation, textEditor.value || 'Type something…', textSize).width + 40)) * displayScale,
                  height: Math.max(44, textDimensions(textEditor.annotation, textEditor.value || 'Type something…', textSize).height * displayScale + 8),
                  padding: '4px',
                  resize: 'none',
                  border: `1.5px solid ${ACCENT}`,
                  borderRadius: 3,
                  outline: 'none',
                  background: 'rgba(255, 255, 255, .88)',
                  boxShadow: '0 4px 16px rgba(30,24,58,.12)',
                  color: textEditor.annotation.color,
                  fontFamily: textStack(textEditor.annotation.fontFamily),
                  fontSize: Math.max(12, editorMetrics.size * displayScale),
                  fontWeight: editorMetrics.weight,
                  lineHeight: editorMetrics.lineHeight,
                  letterSpacing: editorMetrics.letterSpacing * displayScale,
                  textAlign: editorMetrics.align,
                  overflow: 'hidden',
                  userSelect: 'text',
                  zIndex: 5,
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-ink-3">
            <strong className="text-[13px] font-medium text-ink">No image loaded</strong>
            <span className="text-app">Drop a screenshot here, or import one from the file menu.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default EditorCanvas;
