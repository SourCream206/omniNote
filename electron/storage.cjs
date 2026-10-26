const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const validKinds = new Set(['notebook', 'folder', 'section', 'page']);
const validTypes = new Set(['text', 'ink', 'image', 'audio', 'video', 'document', 'extension']);
const paperStyles = new Set(['blank', 'dots', 'grid', 'lines']);
const allowedParents = {
  notebook: [null],
  folder: ['notebook', 'folder'],
  section: ['notebook', 'folder'],
  page: ['section'],
};

class WorkspaceStore {
  constructor(directory) {
    this.directory = directory;
    this.assetDir = path.join(directory, 'assets');
    this.extensionDir = path.join(directory, 'extensions');
    fs.mkdirSync(this.assetDir, { recursive: true });
    fs.mkdirSync(this.extensionDir, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'notes.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.migrate();
    this.seed();
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  migrate() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) throw new Error(`Workspace schema ${version} is newer than this app`);
    if (version === 0) this.transaction(() => {
      this.db.exec(`
        CREATE TABLE nodes (
          id TEXT PRIMARY KEY, parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('notebook','folder','section','page')),
          title TEXT NOT NULL, order_index INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX nodes_parent_order ON nodes(parent_id, order_index);
        CREATE TABLE pages (
          id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
          camera_x REAL NOT NULL DEFAULT 0, camera_y REAL NOT NULL DEFAULT 0, camera_zoom REAL NOT NULL DEFAULT 1
        );
        CREATE TABLE objects (
          id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
          type TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
          z_index INTEGER NOT NULL, group_id TEXT, payload_version INTEGER NOT NULL DEFAULT 1,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX objects_page_z ON objects(page_id, z_index);
        CREATE TABLE assets (
          id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE extension_settings (extension_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(extension_id,key));
        CREATE TABLE extension_grants (extension_id TEXT NOT NULL, permission TEXT NOT NULL, granted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(extension_id,permission));
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      `);
      this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(1, now());
      this.db.exec('PRAGMA user_version=1');
    });
    if (version < 2) this.transaction(() => {
      this.db.exec("ALTER TABLE pages ADD COLUMN paper_style TEXT NOT NULL DEFAULT 'blank' CHECK (paper_style IN ('blank','dots','grid','lines'))");
      if (version === 1) this.db.exec("UPDATE pages SET paper_style='dots'");
      this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(2, now());
      this.db.exec('PRAGMA user_version=2');
    });
  }

  seed() {
    if (this.db.prepare('SELECT COUNT(*) AS count FROM nodes').get().count) return;
    this.transaction(() => {
      const notebook = this.insertNode(null, 'notebook', 'My Notebook');
      const section = this.insertNode(notebook, 'section', 'General');
      this.insertNode(section, 'page', 'Untitled page');
    });
  }

  getNode(nodeId) {
    return this.db.prepare('SELECT * FROM nodes WHERE id=?').get(nodeId);
  }

  assertParent(parentId, kind) {
    if (!validKinds.has(kind)) throw new Error('Invalid node kind');
    const parent = parentId ? this.getNode(parentId) : null;
    if (!allowedParents[kind].includes(parent?.kind ?? null)) throw new Error(`Cannot put ${kind} in this location`);
  }

  insertNode(parentId, kind, title) {
    this.assertParent(parentId, kind);
    const nodeId = id();
    const sibling = this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM nodes WHERE parent_id IS ?').get(parentId);
    const timestamp = now();
    this.db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?)').run(nodeId, parentId, kind, title.trim() || `Untitled ${kind}`, sibling.next, timestamp, timestamp);
    if (kind === 'page') this.db.prepare('INSERT INTO pages(id) VALUES (?)').run(nodeId);
    return nodeId;
  }

  createNode(parentId, kind, title) {
    if (typeof title !== 'string' || title.length > 200) throw new Error('Invalid title');
    return this.transaction(() => this.insertNode(parentId ?? null, kind, title));
  }

  renameNode(nodeId, title) {
    if (!this.getNode(nodeId)) throw new Error('Item not found');
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Title must be 1–200 characters');
    this.db.prepare('UPDATE nodes SET title=?, updated_at=? WHERE id=?').run(title.trim(), now(), nodeId);
  }

  deleteNode(nodeId) {
    if (!this.getNode(nodeId)) throw new Error('Item not found');
    this.transaction(() => this.db.prepare('DELETE FROM nodes WHERE id=?').run(nodeId));
  }

  moveNode(nodeId, parentId, beforeId = null) {
    const node = this.getNode(nodeId);
    if (!node) throw new Error('Item not found');
    if (beforeId === nodeId) return;
    parentId = parentId ?? null;
    this.assertParent(parentId, node.kind);
    let cursor = parentId;
    while (cursor) {
      if (cursor === nodeId) throw new Error('Cannot move a folder into itself');
      cursor = this.getNode(cursor)?.parent_id ?? null;
    }
    if (beforeId) {
      const before = this.getNode(beforeId);
      if (!before || before.parent_id !== parentId) throw new Error('Invalid reorder target');
    }
    this.transaction(() => {
      const oldParent = node.parent_id;
      this.db.prepare('UPDATE nodes SET parent_id=?, updated_at=? WHERE id=?').run(parentId, now(), nodeId);
      for (const parent of new Set([oldParent, parentId])) {
        const siblings = this.db.prepare('SELECT id FROM nodes WHERE parent_id IS ? ORDER BY order_index, created_at').all(parent).map((row) => row.id);
        const filtered = siblings.filter((siblingId) => siblingId !== nodeId);
        if (parent === parentId) filtered.splice(beforeId ? filtered.indexOf(beforeId) : filtered.length, 0, nodeId);
        const update = this.db.prepare('UPDATE nodes SET order_index=? WHERE id=?');
        filtered.forEach((siblingId, index) => update.run(index, siblingId));
      }
    });
  }

  load() {
    return {
      schemaVersion: 2,
      directory: this.directory,
      nodes: this.db.prepare('SELECT * FROM nodes ORDER BY order_index, created_at').all(),
      pages: this.db.prepare('SELECT * FROM pages').all(),
      objects: this.db.prepare('SELECT * FROM objects ORDER BY z_index').all().map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })),
      assets: this.db.prepare('SELECT * FROM assets').all(),
    };
  }

  savePage(pageId, objects, camera) {
    if (this.getNode(pageId)?.kind !== 'page') throw new Error('Page not found');
    if (!Array.isArray(objects) || objects.length > 10000) throw new Error('Invalid page objects');
    for (const object of objects) {
      if (!object || typeof object.id !== 'string' || !validTypes.has(object.type)) throw new Error('Invalid object');
      for (const key of ['x','y','width','height','z_index']) if (!Number.isFinite(object[key])) throw new Error('Invalid object geometry');
      if (object.width < 0 || object.height < 0 || JSON.stringify(object.payload).length > 2_000_000) throw new Error('Invalid object payload');
    }
    if (!camera || ![camera.x,camera.y,camera.zoom].every(Number.isFinite) || camera.zoom < 0.1 || camera.zoom > 8) throw new Error('Invalid camera');
    this.transaction(() => {
      this.db.prepare('DELETE FROM objects WHERE page_id=?').run(pageId);
      const insert = this.db.prepare('INSERT INTO objects VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const object of objects) insert.run(object.id, pageId, object.type, object.x, object.y, object.width, object.height, object.z_index, object.group_id ?? null, 1, JSON.stringify(object.payload));
      this.db.prepare('UPDATE pages SET camera_x=?, camera_y=?, camera_zoom=? WHERE id=?').run(camera.x, camera.y, camera.zoom, pageId);
      this.db.prepare('UPDATE nodes SET updated_at=? WHERE id=?').run(now(), pageId);
    });
  }

  setPageStyle(pageId, style) {
    if (this.getNode(pageId)?.kind !== 'page') throw new Error('Page not found');
    if (!paperStyles.has(style)) throw new Error('Invalid paper style');
    this.transaction(() => {
      this.db.prepare('UPDATE pages SET paper_style=? WHERE id=?').run(style, pageId);
      this.db.prepare('UPDATE nodes SET updated_at=? WHERE id=?').run(now(), pageId);
    });
  }

  importAsset(name, mimeType, bytes) {
    if (typeof name !== 'string' || !name || name.length > 255) throw new Error('Invalid file name');
    const fileName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const content = Buffer.from(bytes);
    if (content.length === 0 || content.length > 100 * 1024 * 1024) throw new Error('File must be between 1 byte and 100 MB');
    const assetId = id();
    const relative = path.join('assets', `${assetId}-${fileName}`);
    const destination = path.join(this.directory, relative);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, destination);
    try {
      this.db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?,?)').run(assetId, relative, fileName, typeof mimeType === 'string' ? mimeType : '', crypto.createHash('sha256').update(content).digest('hex'), content.length, now());
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
    return this.db.prepare('SELECT * FROM assets WHERE id=?').get(assetId);
  }

  assetPath(assetId) {
    const asset = this.db.prepare('SELECT * FROM assets WHERE id=?').get(assetId);
    if (!asset) throw new Error('Asset not found');
    return { asset, absolutePath: path.join(this.directory, asset.relative_path) };
  }

  readAsset(assetId) {
    const { absolutePath } = this.assetPath(assetId);
    return fs.readFileSync(absolutePath);
  }

  listExtensions() {
    const result = [];
    for (const entry of fs.readdirSync(this.extensionDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(this.extensionDir, entry.name, 'extension.json'), 'utf8'));
        if (manifest.id !== entry.name || !/^[a-z0-9][a-z0-9.-]*$/.test(manifest.id) || !/^1\./.test(manifest.apiVersion) || !manifest.contributes || !Array.isArray(manifest.permissions)) continue;
        const enabled = this.db.prepare('SELECT value_json FROM extension_settings WHERE extension_id=? AND key=?').get(manifest.id, 'enabled');
        const grants = this.db.prepare('SELECT permission FROM extension_grants WHERE extension_id=? AND granted=1').all(manifest.id).map((row) => row.permission);
        const settings = {};
        for (const setting of manifest.contributes.settings ?? []) {
          const stored = this.db.prepare('SELECT value_json FROM extension_settings WHERE extension_id=? AND key=?').get(manifest.id, setting.key);
          settings[setting.key] = stored ? JSON.parse(stored.value_json) : setting.default;
        }
        result.push({ manifest, enabled: enabled ? JSON.parse(enabled.value_json) : false, grantedPermissions: grants, settings });
      } catch { /* ignore malformed extension directory */ }
    }
    return result;
  }

  extensionSource(extensionId) {
    const extension = this.listExtensions().find((item) => item.manifest.id === extensionId && item.enabled);
    if (!extension) throw new Error('Extension disabled or missing');
    const entry = extension.manifest.main;
    if (typeof entry !== 'string' || !/^[\w.-]+\.js$/.test(entry)) throw new Error('Invalid extension entry');
    return fs.readFileSync(path.join(this.extensionDir, extensionId, entry), 'utf8');
  }

  extensionResource(extensionId, fileName) {
    const extension = this.listExtensions().find((item) => item.manifest.id === extensionId && item.enabled);
    if (!extension || typeof fileName !== 'string' || !/^[\w.-]+\.html$/.test(fileName)) throw new Error('Invalid extension resource');
    const entries = [...(extension.manifest.contributes.canvasObjectTypes ?? []), ...(extension.manifest.contributes.documentViewers ?? [])];
    if (!entries.some((item) => item.entry === fileName)) throw new Error('Undeclared extension resource');
    return fs.readFileSync(path.join(this.extensionDir, extensionId, fileName), 'utf8');
  }

  setExtensionEnabled(extensionId, enabled, permissions = []) {
    const extension = this.listExtensions().find((item) => item.manifest.id === extensionId);
    if (!extension) throw new Error('Extension not found');
    if (!Array.isArray(permissions) || permissions.some((permission) => !extension.manifest.permissions.includes(permission))) throw new Error('Undeclared permission');
    this.transaction(() => {
      if (enabled) for (const permission of permissions) this.db.prepare('INSERT INTO extension_grants VALUES (?,?,1) ON CONFLICT(extension_id,permission) DO UPDATE SET granted=1').run(extensionId, permission);
      this.db.prepare('INSERT INTO extension_settings VALUES (?,?,?) ON CONFLICT(extension_id,key) DO UPDATE SET value_json=excluded.value_json').run(extensionId, 'enabled', JSON.stringify(Boolean(enabled)));
    });
  }

  setExtensionSetting(extensionId, key, value) {
    const extension = this.listExtensions().find((item) => item.manifest.id === extensionId);
    const setting = extension?.manifest.contributes.settings?.find((item) => item.key === key);
    if (!setting || key === 'enabled' || (setting.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 1000)) throw new Error('Invalid extension setting');
    this.db.prepare('INSERT INTO extension_settings VALUES (?,?,?) ON CONFLICT(extension_id,key) DO UPDATE SET value_json=excluded.value_json').run(extensionId, key, JSON.stringify(value));
  }

  close() { this.db.close(); }
}

module.exports = { WorkspaceStore };
