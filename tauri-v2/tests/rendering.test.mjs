import assert from 'node:assert/strict';
import test from 'node:test';
import { drawStroke, outlineInput, relativeCameraTransform } from '../.test-build/rendering.js';

const sample = (x, pressure) => ({ x, y: 0, pressure, tiltX: 0, tiltY: 0, timestamp: x });

test('pressure jitter is softened for rendering without modifying captured points', () => {
  const points = [sample(0, 0.4), sample(2, 0.9), sample(4, 0.4)];
  const input = outlineInput(points);
  assert.deepEqual(input.map((point) => point[2]), [0.525, 0.65, 0.525]);
  assert.deepEqual(points.map((point) => point.pressure), [0.4, 0.9, 0.4]);
});

test('stroke outline closes with curves, including the final edge', () => {
  const calls = [];
  const context = Object.fromEntries(['save', 'restore', 'beginPath', 'closePath', 'fill', 'moveTo', 'quadraticCurveTo'].map((method) => [method, (...args) => calls.push([method, ...args])]));
  drawStroke(context, { tool: 'pen', color: '#111', width: 4, points: [sample(0, 0.5), sample(10, 0.5), sample(20, 0.5)] });
  const move = calls.find(([method]) => method === 'moveTo');
  const lastCurve = calls.filter(([method]) => method === 'quadraticCurveTo').at(-1);
  assert.ok(move && lastCurve, 'the outline must contain curved segments');
  assert.deepEqual(move.slice(1), lastCurve.slice(-2), 'the final curve must meet the starting point');
  assert.equal(calls.at(-2)[0], 'fill');
});

test('the live tip is smoothed, then the completed outline reaches the final sample', () => {
  const calls = [];
  const context = Object.fromEntries(['save', 'restore', 'beginPath', 'closePath', 'fill', 'moveTo', 'quadraticCurveTo'].map((method) => [method, (...args) => calls.push([method, ...args])]));
  const stroke = { tool: 'pen', color: '#111', width: 4, completed: false, points: [sample(0, 0.5), sample(10, 0.5), sample(20, 0.5), sample(30, 0.5)] };
  drawStroke(context, stroke);
  const liveCurve = calls.filter(([method]) => method === 'quadraticCurveTo');
  calls.length = 0;
  stroke.completed = true;
  drawStroke(context, stroke);
  const completedCurve = calls.filter(([method]) => method === 'quadraticCurveTo');
  assert.notDeepEqual(liveCurve, completedCurve);
  assert.equal(stroke.points.at(-1).x, 30);
});

test('temporary canvas transform matches a repainted zoom and pan', () => {
  const rendered = { x: -40, y: 25, scale: 1 };
  const current = { x: 30, y: -15, scale: 2 };
  const transform = relativeCameraTransform(current, rendered);
  const world = { x: 120, y: 60 };
  assert.equal(transform.scale * (rendered.scale * world.x + rendered.x) + transform.x, current.scale * world.x + current.x);
  assert.equal(transform.scale * (rendered.scale * world.y + rendered.y) + transform.y, current.scale * world.y + current.y);
});
