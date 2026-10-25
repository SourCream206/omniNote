const { app, BrowserWindow, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'whiteboard', privileges: { standard: true, secure: true } }]);
const files = new Map([['/index.html', 'index.html'], ['/src/spike.css', 'src/spike.css'], ['/dist/spike.js', 'dist/spike.js']]);

app.whenReady().then(() => {
  protocol.handle('whiteboard', (request) => {
    const resource = files.get(new URL(request.url).pathname);
    return resource ? net.fetch(pathToFileURL(path.join(__dirname, '..', resource)).toString()) : new Response('Not found', { status: 404 });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 650, backgroundColor: '#f4f5f8', title: 'Whiteboard+ — Ink Lab', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadURL('whiteboard://app/index.html');
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
