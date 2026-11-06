import type { CanvasObject } from './types';

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function resizeObject(object: CanvasObject, edge: ResizeEdge, dx: number, dy: number): CanvasObject {
  const minWidth = 90;
  const minHeight = object.type === 'audio' ? 54 : object.type === 'text' ? 28 : 70;
  let { x, y, width, height } = object;
  if (edge.includes('w')) { width = Math.max(minWidth, object.width - dx); x = object.x + object.width - width; }
  if (edge.includes('e')) width = Math.max(minWidth, object.width + dx);
  if (edge.includes('n')) { height = Math.max(minHeight, object.height - dy); y = object.y + object.height - height; }
  if (edge.includes('s')) height = Math.max(minHeight, object.height + dy);
  return { ...object, x, y, width, height };
}
