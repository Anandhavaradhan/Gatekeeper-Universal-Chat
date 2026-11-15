// Gatekeeper Chat for Windows (also runs on macOS and Linux): the web app's files are packed inside and
// served to the window from app://local/, so storage and modules behave like a normal https page.
// When "remoteUrl" is set in app-config.json, that address is opened instead.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const config = require('./app-config.json');

const WWW = path.join(__dirname, 'www');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const startUrl = config.remoteUrl || `app://local/${config.start}`;
const startOrigin = new URL(startUrl).origin;

function createWindow() {
  const win = new BrowserWindow({
    width: config.width || 1280,
    height: config.height || 820,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: config.background || '#ffffff',
    title: config.name,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links to other sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || new URL(url).origin === startOrigin) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== startOrigin) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    // a folder address ("games/") shows that folder's index.html, as a web server would
    const wanted = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const file = path.normalize(path.join(WWW, decodeURIComponent(wanted)));
    if (file !== WWW && !file.startsWith(WWW + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not found', { status: 404 }));
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Go',
        submenu: [
          { label: 'Back', accelerator: 'Alt+Left', click: (_i, w) => w && w.webContents.navigationHistory.canGoBack() && w.webContents.navigationHistory.goBack() },
          { label: 'Home', accelerator: 'Alt+Home', click: (_i, w) => w && w.loadURL(startUrl) },
        ],
      },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    ])
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
