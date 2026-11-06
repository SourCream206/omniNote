import { drawStroke, strokeVisible, type Stroke } from './rendering';

type Camera = { x: number; y: number; scale: number };
type Message =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'scene'; strokes: Stroke[] }
  | { type: 'append'; stroke: Stroke }
  | { type: 'viewport'; width: number; height: number; dpr: number; camera: Camera; culling: boolean };

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let strokes: Stroke[] = [];
let viewport = { width: 1, height: 1, dpr: 1, camera: { x: 0, y: 0, scale: 1 }, culling: true };

function render() {
  if (!canvas || !context) return;
  const start = performance.now();
  const width = Math.max(1, Math.round(viewport.width * viewport.dpr));
  const height = Math.max(1, Math.round(viewport.height * viewport.dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const { camera, dpr, culling } = viewport;
  context.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.x, dpr * camera.y);
  for (const stroke of strokes) {
    if (strokeVisible(stroke, camera, viewport.width, viewport.height, culling)) drawStroke(context, stroke);
  }
  self.postMessage({ type: 'draw-time', ms: performance.now() - start, camera: { ...camera } });
}

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'init') {
    canvas = message.canvas;
    context = canvas.getContext('2d');
  } else if (message.type === 'scene') {
    strokes = message.strokes;
  } else if (message.type === 'append') {
    strokes.push(message.stroke);
  } else {
    viewport = message;
  }
  render();
};
