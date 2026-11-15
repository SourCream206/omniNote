const assert = require('node:assert/strict');
const { readMousePanButton, isMousePanPress } = require('../.tools/test-build/mouseControls.js');

assert.equal(readMousePanButton({ getItem: () => null }), 'middle');
assert.equal(readMousePanButton({ getItem: () => 'right' }), 'right');
assert.equal(readMousePanButton({ getItem: () => 'wrong' }), 'middle');
assert.equal(isMousePanPress({ pointerType: 'mouse', button: 1 }, 'middle'), true);
assert.equal(isMousePanPress({ pointerType: 'mouse', button: 1 }, 'right'), false);
assert.equal(isMousePanPress({ pointerType: 'mouse', button: 2 }, 'right'), true);
assert.equal(isMousePanPress({ pointerType: 'pen', button: 2 }, 'right'), false);
assert.equal(isMousePanPress({ pointerType: 'mouse', button: 1 }, 'none'), false);
