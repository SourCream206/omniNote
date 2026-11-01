const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertSafeToOpen, readSelectedFile } = require('../electron/selected-file.cjs');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omninote-file-test-'));
  const file = path.join(directory, 'sample.pdf');
  try {
    fs.writeFileSync(file, 'example');
    assert.equal((await readSelectedFile(file, 7)).toString(), 'example');
    await assert.rejects(readSelectedFile(file, 6), /100 MB/);
    assert.doesNotThrow(() => assertSafeToOpen('notes.pdf'));
    assert.throws(() => assertSafeToOpen('setup.EXE'), /cannot be launched/);
    assert.throws(() => assertSafeToOpen('setup.exe. '), /cannot be launched/);
    assert.throws(() => assertSafeToOpen('shortcut.lnk'), /cannot be launched/);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
  console.log('Selected file limits and launch checks passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
