const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WorkspaceStore } = require('../electron/storage.cjs');
const { workspaceDirectory } = require('../electron/workspace-path.cjs');

const root = fs.mkdtempSync(path.resolve(__dirname, '..', 'workspace', 'test-runs', 'workspace-path-'));
const documents = path.join(root, 'Documents');
const userData = path.join(root, 'AppData');
const legacy = path.join(userData, 'workspace');
const source = new WorkspaceStore(legacy);
const page = source.load().nodes.find((node) => node.kind === 'page');
const asset = source.importAsset('original.txt', 'text/plain', Buffer.from('original bytes'));
source.close();

const destination = workspaceDirectory(documents, userData);
assert.equal(destination, path.join(documents, 'omniNote', 'workspace'));
assert.ok(fs.existsSync(path.join(legacy, 'notes.sqlite')));
const migrated = new WorkspaceStore(destination);
assert.ok(migrated.getNode(page.id));
assert.equal(migrated.readAsset(asset.id).toString(), 'original bytes');
migrated.close();
assert.equal(workspaceDirectory(documents, userData), destination);
assert.equal(workspaceDirectory(documents, userData, 'override'), 'override');
console.log('Documents workspace migration passed');
