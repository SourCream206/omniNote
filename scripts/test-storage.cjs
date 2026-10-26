const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const JSZip = require('jszip');
const { WorkspaceStore } = require('../electron/storage.cjs');
const { createWorkspaceArchive } = require('../electron/export.cjs');

async function main() {
const testRoot = path.resolve(__dirname, '..', 'workspace', 'test-runs');
fs.mkdirSync(testRoot, { recursive: true });
const directory = fs.mkdtempSync(path.join(testRoot, 'storage-'));
const store = new WorkspaceStore(directory);
const notebook = store.load().nodes.find((node) => node.kind === 'notebook');
assert.ok(notebook);
const folder = store.createNode(notebook.id, 'folder', 'Tests');
const nested = store.createNode(folder, 'folder', 'Nested');
const section = store.createNode(nested, 'section', 'Section');
store.moveNode(section, notebook.id, folder);
const reordered = store.load().nodes.filter((node) => node.parent_id === notebook.id).map((node) => node.id);
assert.ok(reordered.indexOf(section) < reordered.indexOf(folder));
store.moveNode(section, nested);
const page = store.createNode(section, 'page', 'Page');
const object = { id: crypto.randomUUID(), page_id: page, type: 'text', x: 123, y: -42, width: 300, height: 100, z_index: 1, group_id: null, payload_version: 1, payload: { doc: { type: 'doc', content: [] } } };
const ink = { id: crypto.randomUUID(), page_id: page, type: 'ink', x: -20, y: 30, width: 100, height: 50, z_index: 2, group_id: null, payload_version: 1, payload: { points: [{ x: 0, y: 0, pressure: 0.42, tiltX: 12, tiltY: -4, timestamp: 123 }], color: '#102030', width: 3, highlighter: false } };
store.savePage(page, [object, ink], { x: -123, y: 75, zoom: 1.75 });
store.setPageStyle(page, 'grid');
assert.throws(() => store.setPageStyle(page, 'unsafe'), /Invalid paper style/);
const original = Buffer.from('test asset bytes');
const asset = store.importAsset('fixture.txt', 'text/plain', original);
const extensionId = 'omninote.contributions';
fs.cpSync(path.resolve(__dirname, '..', 'examples', 'contributions'), path.join(store.extensionDir, extensionId), { recursive: true });
assert.equal(store.listExtensions().find((item) => item.manifest.id === extensionId).enabled, false);
assert.throws(() => store.setExtensionEnabled(extensionId, true, ['filesystem.read']), /Undeclared permission/);
store.setExtensionEnabled(extensionId, true, ['canvas.write', 'asset.read', 'export.write', 'link.open']);
store.setExtensionSetting(extensionId, 'label', 'Test card');
assert.equal(store.listExtensions().find((item) => item.manifest.id === extensionId).settings.label, 'Test card');
assert.match(store.extensionResource(extensionId, 'card.html'), /Loading card/);
assert.throws(() => store.extensionResource(extensionId, '../other.html'), /Invalid extension resource/);
const archive = await createWorkspaceArchive(store);
store.close();

const reopened = new WorkspaceStore(directory);
const snapshot = reopened.load();
assert.equal(snapshot.schemaVersion, 2);
assert.equal(snapshot.nodes.find((node) => node.id === page).parent_id, section);
assert.equal(snapshot.objects.find((item) => item.id === object.id).payload.doc.type, 'doc');
assert.equal(snapshot.objects.find((item) => item.id === ink.id).payload.points[0].pressure, 0.42);
assert.equal(snapshot.pages.find((item) => item.id === page).camera_zoom, 1.75);
assert.equal(snapshot.pages.find((item) => item.id === page).paper_style, 'grid');
assert.deepEqual(reopened.readAsset(asset.id), original);
assert.equal(reopened.listExtensions().find((item) => item.manifest.id === extensionId).settings.label, 'Test card');
assert.throws(() => reopened.moveNode(folder, nested), /itself/);
reopened.close();

const extracted = fs.mkdtempSync(path.join(testRoot, 'restore-'));
  const zip = await JSZip.loadAsync(archive);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.format, 'omninote-workspace');
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const destination = path.join(extracted, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, await entry.async('nodebuffer'));
  }
  const restored = new WorkspaceStore(extracted);
  assert.equal(restored.load().nodes.find((node) => node.id === page).title, 'Page');
  assert.deepEqual(restored.readAsset(asset.id), original);
  restored.close();

  const legacyDirectory = fs.mkdtempSync(path.join(testRoot, 'legacy-'));
  const legacy = new WorkspaceStore(legacyDirectory);
  const legacyPageId = legacy.load().nodes.find((item) => item.kind === 'page').id;
  legacy.close();
  const raw = new DatabaseSync(path.join(legacyDirectory, 'notes.sqlite'));
  raw.exec('ALTER TABLE pages DROP COLUMN paper_style; PRAGMA user_version=1; DELETE FROM schema_migrations WHERE version=2;');
  raw.close();
  const upgraded = new WorkspaceStore(legacyDirectory);
  assert.equal(upgraded.load().pages.find((item) => item.id === legacyPageId).paper_style, 'dots');
  assert.equal(upgraded.load().schemaVersion, 2);
  upgraded.close();
console.log('Storage and backup restore round-trip passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
