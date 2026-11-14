const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'dist', 'catalog.json'), 'utf8'));
assert.ok(catalog.extensions.some((entry) => entry.id === 'whiteboard.date-insert'));
assert.ok(!catalog.extensions.some((entry) => entry.id === 'omninote.contributions'));
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'marketplace', 'dist', 'omninote.contributions-1.0.0.zip')));
console.log('Published marketplace catalog checks passed');
