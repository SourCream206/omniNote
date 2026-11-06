import getStroke from 'perfect-freehand';

export type Sample = { x: number; y: number; pressure: number; tiltX: number; tiltY: number; timestamp: number };
export type Stroke = { tool: 'pen' | 'highlighter'; color: string; width: number; points: Sample[]; completed?: boolean; bounds?: { left: number; top: number; right: number; bottom: number } };
const outlineCache = new WeakMap<Stroke, { count: number; completed: boolean; outline: number[][] }>();

export function relativeCameraTransform(current: { x: number; y: number; scale: number }, rendered: { x: number; y: number; scale: number }) {
  const scale = current.scale / rendered.scale;
  return { x: current.x - scale * rendered.x, y: current.y - scale * rendered.y, scale };
}

// Smooth the rendered width without changing the captured vector samples.
export function outlineInput(points: Sample[]): number[][] {
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)].pressure;
    const after = points[Math.min(points.length - 1, index + 1)].pressure;
    return [point.x, point.y, (before + 2 * point.pressure + after) / 4];
  });
}

export function strokeBounds(stroke: Stroke) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of stroke.points) {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  const margin = stroke.width * (stroke.tool === 'highlighter' ? 2 : 1);
  return { left: left - margin, top: top - margin, right: right + margin, bottom: bottom + margin };
}

export function strokeVisible(stroke: Stroke, camera: { x: number; y: number; scale: number }, width: number, height: number, culling: boolean) {
  if (!culling || !stroke.bounds) return true;
  const viewportLeft = -camera.x / camera.scale;
  const viewportTop = -camera.y / camera.scale;
  return stroke.bounds.right >= viewportLeft && stroke.bounds.bottom >= viewportTop &&
    stroke.bounds.left <= viewportLeft + width / camera.scale &&
    stroke.bounds.top <= viewportTop + height / camera.scale;
}

export function drawStroke(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, stroke: Stroke) {
  const points = stroke.points;
  if (!points.length) return;
  const completed = stroke.completed !== false;
  let cached = outlineCache.get(stroke);
  if (!cached || cached.count !== points.length || cached.completed !== completed) {
    cached = { count: points.length, completed, outline: getStroke(outlineInput(points), {
      size: stroke.tool === 'highlighter' ? stroke.width * 3.5 : stroke.width,
      thinning: stroke.tool === 'highlighter' ? 0 : 0.5,
      smoothing: 0.85,
      streamline: 0.25,
      simulatePressure: false,
      start: { cap: true }, end: { cap: true }, last: completed,
    }) };
    outlineCache.set(stroke, cached);
  }
  const outline = cached.outline;
  if (!outline.length) return;
  context.save();
  context.fillStyle = stroke.color;
  context.globalAlpha = stroke.tool === 'highlighter' ? 0.33 : 1;
  context.beginPath();
  const last = outline[outline.length - 1];
  context.moveTo((last[0] + outline[0][0]) / 2, (last[1] + outline[0][1]) / 2);
  for (let index = 0; index < outline.length; index++) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    context.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  context.closePath();
  context.fill();
  context.restore();
}
