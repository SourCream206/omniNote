const assert = require('node:assert/strict');
const { visiblePdfPages } = require('../.tools/test-build/pdfVisibility.js');

let reads = 0;
const slots = Array.from({ length: 300 }, (_, index) => ({
  getBoundingClientRect() {
    reads++;
    return { top: index * 1000, bottom: (index + 1) * 1000 };
  },
}));

assert.deepEqual([...visiblePdfPages(slots, 0, 1900)], [1, 2]);
assert.deepEqual([...visiblePdfPages(slots, 145000, 146900)], [145, 146, 147]);
assert.ok(reads < 35, `Too many layout reads: ${reads}`);
