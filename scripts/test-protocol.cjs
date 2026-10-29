const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveAppFile } = require('../electron/protocol-path.cjs');

const root = path.resolve(__dirname, '..');
assert.equal(resolveAppFile(root, 'whiteboard://app/dist-ui/index.html'), path.join(root, 'dist-ui', 'index.html'));
assert.equal(resolveAppFile(root, 'whiteboard://app/ink-lab.html'), path.join(root, 'ink-lab.html'));
assert.equal(resolveAppFile(root, 'whiteboard://other/dist-ui/index.html'), null);
assert.equal(resolveAppFile(root, 'whiteboard://app/dist-ui/%2e%2e/electron/main.cjs'), null);
assert.equal(resolveAppFile(root, 'whiteboard://app/dist-ui/%252e%252e/electron/main.cjs'), null);
assert.equal(resolveAppFile(root, 'whiteboard://app/dist-ui/%2e%2e%5celectron%5cmain.cjs'), null);
assert.equal(resolveAppFile(root, 'whiteboard://app/electron/main.cjs'), null);
console.log('App protocol path checks passed');
