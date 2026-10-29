const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { WorkspaceStore } = require('../electron/storage.cjs');
const { Marketplace } = require('../electron/marketplace.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(__dirname, '..', 'workspace', 'test-runs', 'market-'));
  const store = new WorkspaceStore(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'date-insert', 'extension.json'), 'utf8'));
  const zip = new JSZip();
  zip.file('extension.json', JSON.stringify(manifest));
  zip.file('extension.js', fs.readFileSync(path.join(__dirname, '..', 'examples', 'date-insert', 'extension.js')));
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  let catalog = { schemaVersion: 1, extensions: [{ id: manifest.id, name: manifest.name, summary: 'Insert today’s date', version: manifest.version, apiVersion: manifest.apiVersion, permissions: manifest.permissions, package: 'date.zip', sha256: digest }] };
  try {
    const base = 'https://extensions.example.test';
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/catalog.json') return new Response(JSON.stringify(catalog));
      if (pathname === '/date.zip') return new Response(archive);
      return new Response(null, { status: 404 });
    };
    const market = new Marketplace(store, `${base}/catalog.json`, { fetchImpl });
    assert.equal((await market.search('date')).entries.length, 1);
    assert.equal((await market.search('missing')).entries.length, 0);
    await market.install(manifest.id, manifest.version);
    const installed = store.listExtensions().find((item) => item.manifest.id === manifest.id);
    assert.ok(installed);
    assert.equal(installed.enabled, false);
    assert.equal(fs.readFileSync(path.join(store.extensionDir, manifest.id, 'extension.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'examples', 'date-insert', 'extension.js'), 'utf8'));
    await assert.rejects(() => market.install(manifest.id, manifest.version), /already installed/i);
    catalog = { ...catalog, extensions: [{ ...catalog.extensions[0], id: 'evil.extension', sha256: '0'.repeat(64) }] };
    await assert.rejects(() => market.install('evil.extension', manifest.version), /checksum/i);
    assert.throws(() => new Marketplace(store, 'http://example.com/catalog.json'), /HTTPS/i);
    console.log('Marketplace search and verified install passed');
  } finally { store.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
