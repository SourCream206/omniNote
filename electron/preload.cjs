const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('whiteboard', Object.freeze({
  load: () => invoke('workspace:load'),
  createNode: (parentId, kind, title) => invoke('node:create', parentId, kind, title),
  renameNode: (nodeId, title) => invoke('node:rename', nodeId, title),
  deleteNode: (nodeId) => invoke('node:delete', nodeId),
  moveNode: (nodeId, parentId, beforeId) => invoke('node:move', nodeId, parentId, beforeId),
  savePage: (pageId, objects, camera) => invoke('page:save', pageId, objects, camera),
  savePageSync: (pageId, objects, camera) => {
    const result = ipcRenderer.sendSync('page:save-sync', pageId, objects, camera);
    if (result?.error) throw new Error(result.error);
    if (result?.ok !== true) throw new Error('Page save did not complete');
  },
  setPageStyle: (pageId, style) => invoke('page:style', pageId, style),
  importAsset: (name, mimeType, bytes) => invoke('asset:import', name, mimeType, bytes),
  pickAssets: () => invoke('asset:pick'),
  readAsset: (assetId) => invoke('asset:read', assetId),
  copyImage: (assetId) => invoke('clipboard:copy-image', assetId),
  copyText: (text) => invoke('clipboard:copy-text', text),
  readClipboard: () => invoke('clipboard:read'),
  openOriginal: (assetId) => invoke('asset:open', assetId),
  openExternal: (url) => invoke('link:open', url),
  listExtensions: () => invoke('extension:list'),
  searchMarketplace: (query) => invoke('marketplace:search', query),
  installMarketplaceExtension: (extensionId, version) => invoke('marketplace:install', extensionId, version),
  extensionSource: (extensionId) => invoke('extension:source', extensionId),
  extensionResource: (extensionId, fileName) => invoke('extension:resource', extensionId, fileName),
  enableExtension: (extensionId, enabled, permissions) => invoke('extension:enable', extensionId, enabled, permissions),
  setExtensionSetting: (extensionId, key, value) => invoke('extension:setting', extensionId, key, value),
  saveExtensionExport: (name, bytes) => invoke('export:save', name, bytes),
  exportWorkspace: () => invoke('workspace:export'),
  exportPagePdf: () => invoke('page:export-pdf'),
  setFullScreen: (enabled) => invoke('window:full-screen', enabled),
}));
