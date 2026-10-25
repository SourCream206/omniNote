type Tool = 'pen' | 'highlighter' | 'eraser' | 'hand';
type Sample = { x: number; y: number; pressure: number; tiltX: number; tiltY: number; timestamp: number };
type Stroke = { tool: 'pen' | 'highlighter'; color: string; width: number; points: Sample[] };
type Gesture = { id: number; kind: 'ink' | 'erase' | 'pan'; lastX: number; lastY: number };

const surface = document.querySelector<HTMLDivElement>('#surface')!;
const canvas = document.querySelector<HTMLCanvasElement>('#ink')!;
const context = canvas.getContext('2d', { alpha: true })!;
const hint = document.querySelector<HTMLDivElement>('.canvas-hint')!;
const widthInput = document.querySelector<HTMLInputElement>('#width')!;
const palmInput = document.querySelector<HTMLInputElement>('#palm')!;
const penOnlyInput = document.querySelector<HTMLInputElement>('#pen-only')!;
const streamInput = document.querySelector<HTMLSelectElement>('#event-source')!;
const rawNote = document.querySelector<HTMLParagraphElement>('#raw-note')!;

const value = (selector: string, content: string) => { document.querySelector<HTMLElement>(selector)!.textContent = content; };
const clamp = (number: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, number));
const median = (numbers: number[]) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const percentile = (numbers: number[], percentileValue: number) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
};

let tool: Tool = 'pen';
let color = '#202b49';
let thickness = 4;
let spaceHeld = false;
let gesture: Gesture | null = null;
let liveStroke: Stroke | null = null;
let strokes: Stroke[] = [];
let camera = { x: 0, y: 0, scale: 1 };
let deviceScale = window.devicePixelRatio || 1;
let renderRequested = false;
let lastFrame = 0;
let penLastSeen = -Infinity;
let coalescedCount = 0;
let eventTimes: number[] = [];
let pendingSamples: number[] = [];
let delays: number[] = [];
let frameIntervals: number[] = [];
let lastPointer = 'Waiting for pointer input';

function screenPosition(event: PointerEvent | WheelEvent) {
  const rect = surface.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function worldPosition(event: PointerEvent) {
  const point = screenPosition(event);
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

function makeSample(event: PointerEvent): Sample {
  const point = worldPosition(event);
  return {
    ...point,
    pressure: event.pointerType === 'mouse' ? 0.5 : clamp(event.pressure || 0.01, 0.01, 1),
    tiltX: event.tiltX || 0,
    tiltY: event.tiltY || 0,
    timestamp: event.timeStamp,
  };
}

function updateCounts() {
  value('#stroke-count', `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`);
  value('#point-count', `${strokes.reduce((total, stroke) => total + stroke.points.length, 0)} points`);
  hint.classList.toggle('hidden', strokes.length > 0 || liveStroke !== null);
}

function drawStroke(stroke: Stroke) {
  const points = stroke.points;
  if (!points.length) return;
  context.save();
  context.fillStyle = stroke.color;
  context.strokeStyle = stroke.color;
  context.globalAlpha = stroke.tool === 'highlighter' ? 0.33 : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const widthAt = (sample: Sample) => stroke.tool === 'highlighter'
    ? stroke.width * 3.5
    : stroke.width * (0.35 + sample.pressure * 1.3);

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

function render(frameTime: number) {
  renderRequested = false;
  if (lastFrame && gesture) {
    frameIntervals.push(frameTime - lastFrame);
    if (frameIntervals.length > 180) frameIntervals.shift();
  }
  lastFrame = frameTime;
  for (const timestamp of pendingSamples) {
    // This ends at the rAF callback, before composition and display scanout.
    delays.push(Math.max(0, frameTime - timestamp));
  }
  pendingSamples = [];
  if (delays.length > 180) delays = delays.slice(-180);

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(deviceScale * camera.scale, 0, 0, deviceScale * camera.scale, deviceScale * camera.x, deviceScale * camera.y);
  for (const stroke of strokes) drawStroke(stroke);
  if (liveStroke) drawStroke(liveStroke);

  if (gesture) requestRender();
}

function requestRender() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame(render);
}

function resizeCanvas() {
  const rect = surface.getBoundingClientRect();
  deviceScale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * deviceScale));
  canvas.height = Math.max(1, Math.round(rect.height * deviceScale));
  requestRender();
}

function setTool(next: Tool) {
  tool = next;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.classList.toggle('active', button.dataset.tool === next);
  }
  surface.dataset.tool = next;
}

function eraserDown(event: PointerEvent) {
  return event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
}

function pointSegmentDistance(point: Sample, first: Sample, second: Sample) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (first.x + t * dx), point.y - (first.y + t * dy));
}

function eraseAt(sample: Sample) {
  const radius = 12 / camera.scale;
  const originalLength = strokes.length;
  strokes = strokes.filter((stroke) => {
    const points = stroke.points;
    for (let index = 0; index < points.length; index++) {
      const distance = index === 0 ? Math.hypot(sample.x - points[0].x, sample.y - points[0].y)
        : pointSegmentDistance(sample, points[index - 1], points[index]);
      if (distance <= radius + stroke.width / 2) return false;
    }
    return true;
  });
  if (strokes.length !== originalLength) {
    updateCounts();
    requestRender();
  }
}

function recordInput(event: PointerEvent, samples: PointerEvent[]) {
  const now = performance.now();
  eventTimes.push(now);
  eventTimes = eventTimes.filter((time) => now - time <= 1000);
  for (const sample of samples) {
    const timestamp = sample.timeStamp;
    pendingSamples.push(timestamp >= 0 && timestamp <= now + 1000 ? timestamp : now);
  }
  coalescedCount += Math.max(0, samples.length - 1);
  value('#pressure', event.pressure.toFixed(2));
  value('#tilt', `${event.tiltX || 0}° / ${event.tiltY || 0}°`);
  value('#input-rate', `${eventTimes.length}`);
  value('#coalesced', `${coalescedCount}`);
  requestRender();
}

function isRejected(event: PointerEvent) {
  if (event.pointerType === 'pen') penLastSeen = performance.now();
  if (event.pointerType === 'touch' && palmInput.checked && performance.now() - penLastSeen < 700) return true;
  return penOnlyInput.checked && event.pointerType !== 'pen' && !spaceHeld && tool !== 'hand';
}

function onPointerDown(event: PointerEvent) {
  if (gesture || isRejected(event)) return;
  if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  surface.setPointerCapture(event.pointerId);
  const position = screenPosition(event);
  const mode: Gesture['kind'] = spaceHeld || tool === 'hand' || event.button === 1 ? 'pan'
    : tool === 'eraser' || eraserDown(event) ? 'erase' : 'ink';
  gesture = { id: event.pointerId, kind: mode, lastX: position.x, lastY: position.y };
  lastPointer = `${event.pointerType} · ${mode}`;
  value('#pointer-state', lastPointer);
  value('#frame-source', streamInput.value === 'raw' ? 'raw updates' : 'coalesced moves');
  if (mode === 'ink') {
    liveStroke = { tool: tool === 'highlighter' ? 'highlighter' : 'pen', color, width: thickness, points: [makeSample(event)] };
    recordInput(event, [event]);
    updateCounts();
  } else if (mode === 'erase') {
    eraseAt(makeSample(event));
    recordInput(event, [event]);
  } else {
    requestRender();
  }
}

function handlePointerMotion(event: PointerEvent) {
  if (event.pointerType === 'pen') penLastSeen = performance.now();
  if (!gesture || event.pointerId !== gesture.id) return;
  const position = screenPosition(event);
  if (gesture.kind === 'pan') {
    camera.x += position.x - gesture.lastX;
    camera.y += position.y - gesture.lastY;
    gesture.lastX = position.x;
    gesture.lastY = position.y;
    requestRender();
    return;
  }
  const samples = streamInput.value === 'move' && typeof event.getCoalescedEvents === 'function'
    ? event.getCoalescedEvents() : [event];
  const selected = samples.length ? samples : [event];
  if (gesture.kind === 'ink' && liveStroke) {
    for (const sample of selected) liveStroke.points.push(makeSample(sample));
    requestRender();
  } else if (gesture.kind === 'erase') {
    for (const sample of selected) eraseAt(makeSample(sample));
  }
  recordInput(event, selected);
}

function finishGesture(event?: PointerEvent) {
  if (!gesture || (event && event.pointerId !== gesture.id)) return;
  if (liveStroke) {
    strokes.push(liveStroke);
    liveStroke = null;
  }
  try { surface.releasePointerCapture(gesture.id); } catch { /* capture may already be gone */ }
  gesture = null;
  updateCounts();
  requestRender();
}

function zoomAt(factor: number, x: number, y: number) {
  const oldScale = camera.scale;
  const nextScale = clamp(oldScale * factor, 0.25, 4);
  camera.x = x - (x - camera.x) * nextScale / oldScale;
  camera.y = y - (y - camera.y) * nextScale / oldScale;
  camera.scale = nextScale;
  value('#zoom-value', `${Math.round(nextScale * 100)}%`);
  requestRender();
}

surface.addEventListener('pointerdown', onPointerDown);
surface.addEventListener('pointermove', (event) => {
  if (streamInput.value === 'move' || !gesture) handlePointerMotion(event);
});
surface.addEventListener('pointerrawupdate', (event) => {
  if (streamInput.value === 'raw') handlePointerMotion(event as PointerEvent);
});
surface.addEventListener('pointerup', finishGesture);
surface.addEventListener('pointercancel', finishGesture);
surface.addEventListener('lostpointercapture', finishGesture);
surface.addEventListener('contextmenu', (event) => event.preventDefault());
surface.addEventListener('wheel', (event) => {
  event.preventDefault();
  const position = screenPosition(event);
  zoomAt(Math.exp(-event.deltaY * 0.0015), position.x, position.y);
}, { passive: false });

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.addEventListener('click', () => setTool(button.dataset.tool as Tool));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
  button.addEventListener('click', () => {
    color = button.dataset.color!;
    document.querySelectorAll('[data-color]').forEach((item) => item.classList.toggle('active', item === button));
  });
}
widthInput.addEventListener('input', () => {
  thickness = Number(widthInput.value);
  value('#width-value', `${thickness} px`);
});
document.querySelector<HTMLButtonElement>('#clear')!.addEventListener('click', () => {
  finishGesture();
  strokes = [];
  delays = [];
  frameIntervals = [];
  coalescedCount = 0;
  updateCounts();
  requestRender();
});
document.querySelector<HTMLButtonElement>('#zoom-in')!.addEventListener('click', () => zoomAt(1.25, surface.clientWidth / 2, surface.clientHeight / 2));
document.querySelector<HTMLButtonElement>('#zoom-out')!.addEventListener('click', () => zoomAt(0.8, surface.clientWidth / 2, surface.clientHeight / 2));
document.querySelector<HTMLButtonElement>('#zoom-reset')!.addEventListener('click', () => {
  camera = { x: 0, y: 0, scale: 1 };
  value('#zoom-value', '100%');
  requestRender();
});
streamInput.addEventListener('change', () => {
  finishGesture();
  frameIntervals = [];
  delays = [];
  coalescedCount = 0;
  value('#coalesced', '0');
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') finishGesture();
  if (key === 'p') setTool('pen');
  if (key === 'h') setTool('highlighter');
  if (key === 'e') setTool('eraser');
  if (event.code === 'Space') { event.preventDefault(); spaceHeld = true; surface.classList.add('space-pan'); }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') { spaceHeld = false; surface.classList.remove('space-pan'); }
});
window.addEventListener('blur', () => finishGesture());

const rawAvailable = 'onpointerrawupdate' in window;
if (!rawAvailable) {
  streamInput.querySelector<HTMLOptionElement>('[value="raw"]')!.disabled = true;
  rawNote.textContent = 'Raw pointer updates are not available in this Electron build.';
} else {
  rawNote.textContent = 'Compare streams to see which feels smoother on your device.';
}

setInterval(() => {
  value('#latency', delays.length ? `${median(delays).toFixed(1)} ms` : '— ms');
  value('#frame-time', frameIntervals.length ? `${percentile(frameIntervals, 0.95).toFixed(1)} ms` : '— ms');
  eventTimes = eventTimes.filter((time) => performance.now() - time <= 1000);
  value('#input-rate', `${eventTimes.length}`);
}, 250);

new ResizeObserver(resizeCanvas).observe(surface);
setTool('pen');
updateCounts();
