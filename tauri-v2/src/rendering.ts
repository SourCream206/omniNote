export type Sample = { x: number; y: number; pressure: number; tiltX: number; tiltY: number; timestamp: number };
export type Stroke = { tool: 'pen' | 'highlighter'; color: string; width: number; points: Sample[]; bounds?: { left: number; top: number; right: number; bottom: number } };

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
  context.save();
  context.fillStyle = stroke.color;
  context.strokeStyle = stroke.color;
  context.globalAlpha = stroke.tool === 'highlighter' ? 0.33 : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const widthAt = (sample: Sample) => stroke.tool === 'highlighter'
    ? stroke.width * 3.5 : stroke.width * (0.35 + sample.pressure * 1.3);
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, widthAt(points[0]) / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      context.lineWidth = (widthAt(previous) + widthAt(current)) / 2;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    }
  }
  context.restore();
}
