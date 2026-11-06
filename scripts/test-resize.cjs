const assert = require('node:assert/strict');
const { resizeObject } = require('../app/resize.ts');
const object = { type: 'text', x: 100, y: 200, width: 300, height: 100 };
const bounds = ({ x, y, width, height }) => ({ x, y, width, height });
assert.deepEqual(bounds(resizeObject(object, 'nw', 20, 30)), { x: 120, y: 230, width: 280, height: 70 });
assert.deepEqual(bounds(resizeObject(object, 'e', 20, 30)), { x: 100, y: 200, width: 320, height: 100 });
assert.deepEqual(bounds(resizeObject(object, 'sw', 400, 20)), { x: 310, y: 200, width: 90, height: 120 });
assert.deepEqual(bounds(resizeObject(object, 'n', 0, 200)), { x: 100, y: 272, width: 300, height: 28 });
assert.deepEqual(bounds(resizeObject(object, 's', 0, 20)), { x: 100, y: 200, width: 300, height: 120 });
