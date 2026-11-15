const assert = require('node:assert/strict');
const { visiblePdfPages, pdfPrintoutHeight } = require('../.tools/test-build/pdfVisibility.js');

let reads = 0;
const slots = Array.from({ length: 300 }, (_, index) => ({
  getBoundingClientRect() {
    reads++;
    return { top: index * 1000, bottom: (index + 1) * 1000 };
  },
}));

assert.deepEqual([...visiblePdfPages(slots, 0, 1900)], [1, 2]);
assert.deepEqual([...visiblePdfPages(slots, 145000, 146900)], [145, 146, 147]);
const longDocument = Array(1_000).fill(1.3);
assert.equal(pdfPrintoutHeight(620, longDocument), 16 + 1_000 * (Math.ceil(596 * 1.3) + 8));
const longSlots = Array.from({ length: 1_000 }, (_, index) => ({ getBoundingClientRect: () => ({ top: index * 800, bottom: (index + 1) * 800 }) }));
assert.deepEqual([...visiblePdfPages(longSlots, 799_000, 800_000)], [999, 1000]);
assert.ok(reads < 35, `Too many layout reads: ${reads}`);
