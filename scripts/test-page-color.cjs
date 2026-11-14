const assert = require('node:assert/strict');
const { darkPaper, readableInk } = require('../.tools/test-build/pageColor.js');

assert.equal(darkPaper('#181f2a'), true);
assert.equal(darkPaper('#fffaf0'), false);
assert.equal(readableInk('#111111', '#181f2a'), '#ffffff');
assert.equal(readableInk('#ffffff', '#181f2a'), '#ffffff');
assert.equal(readableInk('#ffbb00', '#181f2a'), '#ffbb00');
assert.equal(readableInk('#111111', '#181f2a', true), '#111111');
console.log('Paper contrast checks passed');
