const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

async function createWorkspaceArchive(store) {
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const zip = new JSZip();
  zip.file('notes.sqlite', fs.readFileSync(path.join(store.directory, 'notes.sqlite')));
  zip.file('manifest.json', JSON.stringify({ format: 'omninote-workspace', schemaVersion: 1, exportedAt: new Date().toISOString() }, null, 2));
  for (const asset of store.load().assets) {
    zip.file(asset.relative_path.replaceAll('\\', '/'), fs.readFileSync(store.assetPath(asset.id).absolutePath));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { createWorkspaceArchive };
