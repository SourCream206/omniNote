const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const folderKinds = new Set(['notebook', 'folder', 'section']);
const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function safeName(title) {
  let name = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') || 'Untitled';
  if (reservedName.test(name)) name = `_${name}`;
  return name;
}

function within(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

class NodeFiles {
  constructor(store) { this.store = store; }

  record(nodeId) {
    return this.store.db.prepare('SELECT relative_path FROM node_files WHERE node_id=?').get(nodeId)?.relative_path ?? null;
  }

  absolute(relativePath) {
    const root = path.resolve(this.store.directory);
    const target = path.resolve(root, relativePath);
    if (!within(root, target)) throw new Error('Item path escapes the workspace');
    return target;
  }

  assertParent(absolutePath) {
    const root = fs.realpathSync(this.store.directory);
    let parent = path.dirname(absolutePath);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const existing = fs.realpathSync(parent);
    if (existing !== root && !within(root, existing)) throw new Error('Parent path escapes the workspace');
  }

  reveal(nodeId) {
    const node = this.store.getNode(nodeId);
    const relativePath = this.record(nodeId);
    if (!node || !relativePath) throw new Error('Item not found');
    const root = fs.realpathSync(this.store.directory);
    const absolutePath = fs.realpathSync(this.absolute(relativePath));
    if (!within(root, absolutePath)) throw new Error('Item path escapes the workspace');
    return { absolutePath, isFolder: folderKinds.has(node.kind) };
  }

  nameParts(node, title = node.title) {
    const name = safeName(title);
    if (folderKinds.has(node.kind)) return { stem: name, extension: '' };
    const document = this.store.db.prepare('SELECT asset_id FROM document_pages WHERE page_id=?').get(node.id);
    if (!document) return { stem: name, extension: '.omninote' };
    const asset = this.store.db.prepare('SELECT original_name FROM assets WHERE id=?').get(document.asset_id);
    const extension = path.extname(asset?.original_name ?? '');
    return { stem: extension && name.toLowerCase().endsWith(extension.toLowerCase()) ? name.slice(0, -extension.length) : name, extension };
  }

  available(parentId, node, title = node.title, currentPath = null) {
    const parent = parentId ? this.record(parentId) : '';
    if (parentId && !parent) throw new Error('Parent folder is missing');
    const { stem, extension } = this.nameParts(node, title);
    for (let index = 1; index < 10000; index++) {
      const suffix = index === 1 ? '' : ` (${index})`;
      const relativePath = path.join(parent, `${stem}${suffix}${extension}`);
      const absolutePath = this.absolute(relativePath);
      if (relativePath === currentPath || !fs.existsSync(absolutePath)) return relativePath;
    }
    throw new Error('Too many files with the same name');
  }

  pageContents(nodeId) {
    const node = this.store.getNode(nodeId);
    return JSON.stringify({ format: 'omninote-page-pointer', version: 1, id: nodeId, title: node.title }, null, 2);
  }

  create(node, relativePath) {
    const destination = this.absolute(relativePath);
    this.assertParent(destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (folderKinds.has(node.kind)) fs.mkdirSync(destination);
    else {
      const document = this.store.db.prepare('SELECT asset_id FROM document_pages WHERE page_id=?').get(node.id);
      if (document) fs.copyFileSync(this.store.assetPath(document.asset_id).absolutePath, destination, fs.constants.COPYFILE_EXCL);
      else fs.writeFileSync(destination, this.pageContents(node.id), { flag: 'wx' });
    }
  }

  add(nodeId) {
    const node = this.store.getNode(nodeId);
    if (!node) throw new Error('Item not found');
    const relativePath = this.available(node.parent_id, node);
    this.create(node, relativePath);
    this.store.db.prepare('INSERT INTO node_files VALUES (?, ?)').run(nodeId, relativePath);
    return relativePath;
  }

  sync() {
    const nodes = this.store.db.prepare('SELECT * FROM nodes').all();
    const children = new Map();
    for (const node of nodes) {
      const siblings = children.get(node.parent_id) ?? [];
      siblings.push(node);
      children.set(node.parent_id, siblings);
    }
    const queue = [...(children.get(null) ?? [])];
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      const existing = this.record(node.id);
      if (!existing) this.add(node.id);
      else if (!fs.existsSync(this.absolute(existing))) this.create(node, existing);
      for (const child of children.get(node.id) ?? []) queue.push(child);
    }
    if (queue.length !== nodes.length) throw new Error('Notebook hierarchy contains an invalid parent or cycle');
  }

  savePage(nodeId) {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== 'page' || this.store.db.prepare('SELECT 1 FROM document_pages WHERE page_id=?').get(nodeId)) return;
    const destination = this.reveal(nodeId).absolutePath;
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, this.pageContents(nodeId), { flag: 'wx' });
      fs.renameSync(temporary, destination);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  relocate(nodeId, parentId, title) {
    const node = this.store.getNode(nodeId);
    const current = this.record(nodeId);
    if (!node || !current) throw new Error('Item not found');
    const next = this.available(parentId, node, title, current);
    if (next === current) return;
    const source = this.reveal(nodeId).absolutePath;
    const destination = this.absolute(next);
    this.assertParent(destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
    try {
      const descendants = this.store.db.prepare('SELECT node_id,relative_path FROM node_files').all().filter((item) => item.relative_path === current || item.relative_path.startsWith(`${current}${path.sep}`));
      const update = this.store.db.prepare('UPDATE node_files SET relative_path=? WHERE node_id=?');
      for (const item of descendants) update.run(`${next}${item.relative_path.slice(current.length)}`, item.node_id);
    } catch (error) {
      fs.renameSync(destination, source);
      throw error;
    }
  }

  trash(nodeId) {
    const source = this.reveal(nodeId).absolutePath;
    const directory = path.join(this.store.directory, '.omninote-trash');
    this.assertParent(path.join(directory, 'item'));
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${crypto.randomUUID()}-${path.basename(source)}`);
    fs.renameSync(source, destination);
    return () => fs.renameSync(destination, source);
  }
}

module.exports = { NodeFiles, safeName };
