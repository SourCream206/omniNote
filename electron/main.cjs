const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { WorkspaceStore } = require('./storage.cjs');
const { createWorkspaceArchive } = require('./export.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'whiteboard', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let store;
let window;
const projectRoot = path.resolve(__dirname, '..');

function registerIpc() {
  const handle = (name, action) => ipcMain.handle(name, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid IPC sender');
    return action(...args);
  });

  handle('workspace:load', () => store.load());
  handle('node:create', (parentId, kind, title) => store.createNode(parentId, kind, title));
  handle('node:rename', (nodeId, title) => store.renameNode(nodeId, title));
  handle('node:delete', (nodeId) => store.deleteNode(nodeId));
  handle('node:move', (nodeId, parentId, beforeId) => store.moveNode(nodeId, parentId, beforeId));
  handle('page:save', (pageId, objects, camera) => store.savePage(pageId, objects, camera));
  handle('page:style', (pageId, style) => store.setPageStyle(pageId, style));
  handle('window:full-screen', (enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid fullscreen state');
    window.setFullScreen(enabled);
  });
  handle('asset:import', (name, mimeType, bytes) => store.importAsset(name, mimeType, bytes));
  handle('asset:read', (assetId) => store.readAsset(assetId));
  handle('asset:pick', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => store.importAsset(path.basename(filePath), '', fs.readFileSync(filePath)));
  });
  handle('asset:open', async (assetId) => {
    const result = await shell.openPath(store.assetPath(assetId).absolutePath);
    if (result) throw new Error(result);
  });
  handle('link:open', async (rawUrl) => {
    if (typeof rawUrl !== 'string' || rawUrl.length > 4096) throw new Error('Invalid link');
    const url = new URL(rawUrl);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('Unsupported link protocol');
    await shell.openExternal(url.toString());
  });
  handle('extension:list', () => store.listExtensions());
  handle('extension:source', (extensionId) => store.extensionSource(extensionId));
  handle('extension:resource', (extensionId, fileName) => store.extensionResource(extensionId, fileName));
  handle('extension:enable', (extensionId, enabled, permissions) => store.setExtensionEnabled(extensionId, enabled, permissions));
  handle('extension:setting', (extensionId, key, value) => store.setExtensionSetting(extensionId, key, value));
  handle('export:save', async (name, bytes) => {
    if (typeof name !== 'string' || !/^[\w.-]{1,120}$/.test(name)) throw new Error('Invalid export name');
    const data = Buffer.from(bytes);
    if (!data.length || data.length > 100 * 1024 * 1024) throw new Error('Invalid export size');
    const result = await dialog.showSaveDialog(window, { title: 'Save extension export', defaultPath: name });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, data);
    return true;
  });
  handle('workspace:export', async () => {
    const result = await dialog.showSaveDialog(window, { title: 'Export notebook workspace', defaultPath: 'omninote-backup.zip', filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, await createWorkspaceArchive(store));
    return true;
  });
  handle('page:export-pdf', async () => {
    const result = await dialog.showSaveDialog(window, { title: 'Export visible page to PDF', defaultPath: 'page.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, await window.webContents.printToPDF({ printBackground: true, landscape: true }));
    return true;
  });
}

app.whenReady().then(() => {
  app.setName('omniNote');
  const workspacePath = process.env.WHITEBOARD_WORKSPACE || path.join(app.getPath('userData'), 'workspace');
  store = new WorkspaceStore(workspacePath);
  const exampleSource = path.join(projectRoot, 'examples', 'date-insert');
  const exampleDestination = path.join(store.extensionDir, 'whiteboard.date-insert');
  if (!fs.existsSync(exampleDestination)) fs.cpSync(exampleSource, exampleDestination, { recursive: true });
  const exampleState = store.db.prepare('SELECT value_json FROM extension_settings WHERE extension_id=? AND key=?').get('whiteboard.date-insert', 'enabled');
  if (!exampleState && fs.existsSync(path.join(exampleDestination, 'extension.js')) && fs.readFileSync(path.join(exampleSource, 'extension.js')).equals(fs.readFileSync(path.join(exampleDestination, 'extension.js')))) {
    store.setExtensionEnabled('whiteboard.date-insert', true, ['canvas.write']);
  }

  protocol.handle('whiteboard', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative.startsWith('dist-ui/') && !['ink-lab.html', 'src/spike.css', 'dist/spike.js'].includes(relative)) return new Response('Not found', { status: 404 });
    const absolute = path.resolve(projectRoot, relative);
    if (!absolute.startsWith(projectRoot + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(absolute).toString());
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
  registerIpc();

  window = new BrowserWindow({
    width: 1500, height: 930, minWidth: 1000, minHeight: 680, show: false,
    backgroundColor: '#f7f7f8', title: 'omniNote', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => { window.maximize(); window.show(); });
  window.loadURL(process.argv.includes('--ink-lab') ? 'whiteboard://app/ink-lab.html' : 'whiteboard://app/dist-ui/index.html');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => store?.close());
