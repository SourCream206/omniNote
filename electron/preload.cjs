const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('whiteboard', Object.freeze({
  load: () => invoke('workspace:load'),
  createNode: (parentId, kind, title) => invoke('node:create', parentId, kind, title),
  renameNode: (nodeId, title) => invoke('node:rename', nodeId, title),
  deleteNode: (nodeId) => invoke('node:delete', nodeId),
  moveNode: (nodeId, parentId, beforeId) => invoke('node:move', nodeId, parentId, beforeId),
  savePage: (pageId, objects, camera) => invoke('page:save', pageId, objects, camera),
  importAsset: (name, mimeType, bytes) => invoke('asset:import', name, mimeType, bytes),
  pickAssets: () => invoke('asset:pick'),
  readAsset: (assetId) => invoke('asset:read', assetId),
  openOriginal: (assetId) => invoke('asset:open', assetId),
  openExternal: (url) => invoke('link:open', url),
  listExtensions: () => invoke('extension:list'),
  extensionSource: (extensionId) => invoke('extension:source', extensionId),
  enableExtension: (extensionId, enabled) => invoke('extension:enable', extensionId, enabled),
  exportWorkspace: () => invoke('workspace:export'),
  exportPagePdf: () => invoke('page:export-pdf'),
}));
