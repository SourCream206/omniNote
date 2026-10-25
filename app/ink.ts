import getStroke from 'perfect-freehand';
import type { CanvasObject, InkPoint } from './types';

export function inkPath(points: InkPoint[], width: number) {
  if (!points.length) return '';
  const outline = getStroke(points.map((point) => [point.x, point.y, point.pressure]), {
    size: width, thinning: 0.65, smoothing: 0.5, streamline: 0.45,
    simulatePressure: false, start: { cap: true }, end: { cap: true },
  });
  if (!outline.length) return '';
  const d = [`M ${outline[0][0]} ${outline[0][1]}`];
  for (let index = 1; index < outline.length - 1; index++) {
    const current = outline[index];
    const next = outline[index + 1];
    d.push(`Q ${current[0]} ${current[1]} ${(current[0] + next[0]) / 2} ${(current[1] + next[1]) / 2}`);
  }
  d.push('Z');
  return d.join(' ');
}

function segmentDistance(x: number, y: number, a: InkPoint, b: InkPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

export function eraseInk(objects: CanvasObject[], x: number, y: number, radius: number, partial: boolean): CanvasObject[] {
  const result: CanvasObject[] = [];
  for (const object of objects) {
    if (object.type !== 'ink') { result.push(object); continue; }
    const payload = object.payload as { points: InkPoint[]; width: number; color: string; highlighter: boolean };
    const localX = x - object.x;
    const localY = y - object.y;
    const points = payload.points;
    const hit = points.some((point, index) => (index ? segmentDistance(localX, localY, points[index - 1], point) : Math.hypot(localX - point.x, localY - point.y)) < radius + payload.width / 2);
    if (!hit) { result.push(object); continue; }
    if (!partial) continue;
    let run: InkPoint[] = [];
    const segments: InkPoint[][] = [];
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const near = Math.hypot(localX - point.x, localY - point.y) < radius + payload.width / 2
        || (index > 0 && segmentDistance(localX, localY, points[index - 1], point) < radius + payload.width / 2);
      if (near) {
        if (run.length > 1) segments.push(run);
        run = [];
      } else run.push(point);
    }
    if (run.length > 1) segments.push(run);
    segments.forEach((part, index) => result.push({ ...object, id: index ? crypto.randomUUID() : object.id, payload: { ...payload, points: part } }));
  }
  return result;
}

export function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]; const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
