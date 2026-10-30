const { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, net, protocol, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { WorkspaceStore } = require('./storage.cjs');
const { createWorkspaceArchive } = require('./export.cjs');
const { resolveAppFile } = require('./protocol-path.cjs');
const { Marketplace } = require('./marketplace.cjs');
const { config: distribution, hasUpdateSource } = require('./distribution.cjs');
const { workspaceDirectory } = require('./workspace-path.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'whiteboard', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let store;
let window;
let marketplace;
let updateStatus = { state: 'unavailable', message: 'Updates require an installed release with a configured update address.' };
let ignoredUpdateVersion = null;
let installAfterDownload = false;
const projectRoot = path.resolve(__dirname, '..');
const updatePreferencesPath = path.join(app.getPath('appData'), 'omniNote', 'update-preferences.json');

try {
  const saved = JSON.parse(fs.readFileSync(updatePreferencesPath, 'utf8'));
  if (typeof saved.ignoredVersion === 'string') ignoredUpdateVersion = saved.ignoredVersion;
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Could not read update preferences:', error.message);
}

function ignoreUpdateVersion(version) {
  ignoredUpdateVersion = version;
  fs.mkdirSync(path.dirname(updatePreferencesPath), { recursive: true });
  const temporary = `${updatePreferencesPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ignoredVersion: version }));
  fs.renameSync(temporary, updatePreferencesPath);
}

function setUpdateStatus(state, message, version) {
  updateStatus = { state, message, ...(version ? { version } : {}) };
  if (window && !window.isDestroyed()) window.webContents.send('updates:status', updateStatus);
}

function configureUpdates() {
  if (!app.isPackaged || !hasUpdateSource(distribution)) return;
  setUpdateStatus('idle', 'Ready to check for updates.');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => setUpdateStatus('checking', 'Checking for updates…'));
  autoUpdater.on('update-available', (info) => {
    if (info.version === ignoredUpdateVersion) setUpdateStatus('ignored', `Version ${info.version} was ignored.`, info.version);
    else setUpdateStatus('available', `Version ${info.version} is available.`, info.version);
  });
  autoUpdater.on('download-progress', (progress) => setUpdateStatus('downloading', `Downloading update… ${Math.round(progress.percent)}%`));
  autoUpdater.on('update-not-available', () => setUpdateStatus('up-to-date', 'You have the latest version.'));
  autoUpdater.on('error', (error) => {
    installAfterDownload = false;
    setUpdateStatus('error', error.message);
  });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus('downloaded', `Version ${info.version} is ready to install.`, info.version);
    if (installAfterDownload) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch((error) => setUpdateStatus('error', error.message));
  setTimeout(check, 15000);
  setInterval(check, 24 * 60 * 60 * 1000);
}

function registerIpc() {
  const handle = (name, action) => ipcMain.handle(name, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid IPC sender');
    return action(...args);
  });

  handle('workspace:load', () => store.load());
  handle('workspace:open-folder', async () => { const error = await shell.openPath(store.directory); if (error) throw new Error(error); });
  handle('node:create', (parentId, kind, title) => store.createNode(parentId, kind, title));
  handle('document-page:create', (sectionId, assetId) => store.createDocumentPage(sectionId, assetId));
  handle('node:rename', (nodeId, title) => store.renameNode(nodeId, title));
  handle('node:delete', (nodeId) => store.deleteNode(nodeId));
  handle('node:move', (nodeId, parentId, beforeId) => store.moveNode(nodeId, parentId, beforeId));
  handle('page:save', (pageId, objects, camera) => store.savePage(pageId, objects, camera));
  ipcMain.on('page:save-sync', (event, pageId, objects, camera) => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid IPC sender');
      store.savePage(pageId, objects, camera);
      event.returnValue = { ok: true };
    } catch (error) { event.returnValue = { error: error instanceof Error ? error.message : String(error) }; }
  });
  handle('page:style', (pageId, style) => store.setPageStyle(pageId, style));
  handle('window:full-screen', (enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid fullscreen state');
    window.setFullScreen(enabled);
  });
  handle('window:action', (action) => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') { window.close(); return false; }
    else throw new Error('Invalid window action');
    return window.isMaximized();
  });
  handle('updates:status', () => updateStatus);
  handle('updates:check', async () => {
    if (!app.isPackaged || !hasUpdateSource(distribution)) return updateStatus;
    await autoUpdater.checkForUpdates();
    return updateStatus;
  });
  handle('updates:prompt', async () => {
    if (!['available', 'downloaded'].includes(updateStatus.state) || !updateStatus.version) return updateStatus;
    const version = updateStatus.version;
    const choice = await dialog.showMessageBox(window, {
      type: 'question', title: 'omniNote update', message: `Install omniNote ${version}?`,
      detail: 'Your notes stay on this computer. The app will restart after downloading the update.',
      buttons: ['Yes', 'Ignore', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
    });
    if (choice.response === 1) {
      ignoreUpdateVersion(version);
      setUpdateStatus('ignored', `Version ${version} was ignored.`, version);
    } else if (choice.response === 0) {
      if (updateStatus.state === 'downloaded') autoUpdater.quitAndInstall();
      else {
        installAfterDownload = true;
        setUpdateStatus('downloading', `Downloading version ${version}…`, version);
        try { await autoUpdater.downloadUpdate(); }
        catch (error) { installAfterDownload = false; setUpdateStatus('error', error.message); }
      }
    }
    return updateStatus;
  });
  handle('asset:import', (name, mimeType, bytes) => store.importAsset(name, mimeType, bytes));
  handle('asset:read', (assetId) => store.readAsset(assetId));
  handle('clipboard:copy-image', (assetId) => {
    const image = nativeImage.createFromPath(store.assetPath(assetId).absolutePath);
    if (image.isEmpty()) throw new Error('This image format cannot be copied to the system clipboard');
    return clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
  });
  handle('clipboard:copy-text', (text) => {
    if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('Invalid clipboard text');
    return clipboard.writeText(text);
  });
  handle('clipboard:read', () => {
    const text = clipboard.readText().slice(0, 1_000_000);
    const image = clipboard.readImage();
    const bytes = image.isEmpty() ? null : image.toPNG();
    if (bytes && bytes.length > 32_000_000) throw new Error('Clipboard image is too large');
    return { text, image: bytes ? new Uint8Array(bytes) : null };
  });
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
  handle('marketplace:search', (query) => marketplace.search(query));
  handle('marketplace:install', (extensionId, version) => marketplace.install(extensionId, version));
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

const stableUserData = path.join(app.getPath('appData'), 'omniNote');
fs.mkdirSync(stableUserData, { recursive: true });
app.setPath('userData', stableUserData);

app.whenReady().then(() => {
  app.setName('omniNote');
  let workspacePath;
  try { workspacePath = workspaceDirectory(process.platform === 'win32' ? path.join(app.getPath('home'), 'Documents') : app.getPath('documents'), app.getPath('userData'), process.env.WHITEBOARD_WORKSPACE); }
  catch (error) {
    dialog.showErrorBox('Workspace migration failed', `${error.message}\n\nThe previous workspace remains at ${path.join(app.getPath('userData'), 'workspace')}.`);
    workspacePath = path.join(app.getPath('userData'), 'workspace');
  }
  store = new WorkspaceStore(workspacePath);
  marketplace = new Marketplace(store, process.env.OMNINOTE_MARKETPLACE_URL || distribution.marketplaceUrl, { allowHttpLoopback: !app.isPackaged });
  const exampleSource = path.join(projectRoot, 'examples', 'date-insert');
  const exampleDestination = path.join(store.extensionDir, 'whiteboard.date-insert');
  if (!fs.existsSync(exampleDestination)) fs.cpSync(exampleSource, exampleDestination, { recursive: true });
  const exampleState = store.db.prepare('SELECT value_json FROM extension_settings WHERE extension_id=? AND key=?').get('whiteboard.date-insert', 'enabled');
  if (!exampleState && fs.existsSync(path.join(exampleDestination, 'extension.js')) && fs.readFileSync(path.join(exampleSource, 'extension.js')).equals(fs.readFileSync(path.join(exampleDestination, 'extension.js')))) {
    store.setExtensionEnabled('whiteboard.date-insert', true, ['canvas.write']);
  }

  protocol.handle('whiteboard', (request) => {
    const absolute = resolveAppFile(projectRoot, request.url);
    if (!absolute) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(absolute).toString());
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
  registerIpc();
  configureUpdates();

  const workArea = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    width: Math.min(1500, workArea.width), height: Math.min(930, workArea.height), minWidth: 1000, minHeight: 680, show: false,
    backgroundColor: '#f7f7f8', title: 'omniNote', autoHideMenuBar: true, frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.on('maximize', () => window.webContents.send('window:maximized', true));
  window.on('unmaximize', () => window.webContents.send('window:maximized', false));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => { window.maximize(); window.show(); });
  window.loadURL(process.argv.includes('--ink-lab') ? 'whiteboard://app/ink-lab.html' : 'whiteboard://app/dist-ui/index.html');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => store?.close());
