import type { Annotation } from './editor-types';

const LAYER_LABELS: Record<string, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  pen: 'Vector',
  text: 'Text',
  highlight: 'Highlight',
  blur: 'Pixelate',
  number: 'Step',
  arrow: 'Line',
};

export function layerLabel(type: string) {
  return LAYER_LABELS[type] || 'Layer';
}

/** Figma-style layer names: the top of the stack is always number 1. */
export function layerDisplayName(annotation: Annotation, index = 1) {
  if (annotation.type === 'text') return (annotation.text || 'Text').slice(0, 24) || 'Text';
  if (annotation.type === 'number') return `Step ${annotation.number || 1}`;
  return `${layerLabel(annotation.type)} ${index}`;
}
