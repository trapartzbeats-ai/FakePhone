// Fake Phone desktop app: the same web app in its own window. server.js runs inside this process on a
// free port, and the page loads from fakephone://app, so saved projects (IndexedDB) keep one origin
// whatever port the server gets. Videos go to Documents/Fake Phone unless the user picks a folder.
import { app, BrowserWindow, protocol, shell, dialog, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, exportsDir } from '../server.js';

const ORIGIN = 'fakephone://app';

// test runs: FAKEPHONE_DATA_DIR keeps projects and settings away from the real ones, FAKEPHONE_EXPORTS the videos
if (process.env.FAKEPHONE_DATA_DIR) app.setPath('userData', process.env.FAKEPHONE_DATA_DIR);

// secure: WebCodecs, ImageDecoder and the microphone need a secure context
protocol.registerSchemesAsPrivileged([{ scheme: 'fakephone', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

const SETTINGS = path.join(app.getPath('userData'), 'desktop.json');
const settings = (() => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } })();
const saveSettings = () => { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); };

// desktop.log in the user folder: startup info and page errors (a GUI app has no console to read)
const LOG = path.join(app.getPath('userData'), 'desktop.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, '');
const log = (...a) => { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { /* best effort */ } };

// ffmpeg muxes the exports: bundled in resources/ffmpeg when installed, the ffmpeg-static package from source
function ffmpegPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try { return createRequire(import.meta.url)('ffmpeg-static'); } catch { return null; }
}

let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  const { port, ffmpeg } = await startServer({
    port: 0,
    exportsDir: process.env.FAKEPHONE_EXPORTS || settings.exportsDir || path.join(app.getPath('documents'), 'Fake Phone'),
    tmpDir: path.join(app.getPath('temp'), 'fake-phone-export'),
    ffmpeg: ffmpegPath(),
    onPickFolder: async (current) => {
      const r = await dialog.showOpenDialog(win, { title: 'Where should Fake Phone save videos?', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      if (!process.env.FAKEPHONE_EXPORTS) { settings.exportsDir = r.filePaths[0]; saveSettings(); }
      return r.filePaths[0];
    },
  });
  log(`Fake Phone ${app.getVersion()}, server on 127.0.0.1:${port}, ffmpeg: ${ffmpeg || 'none'}`);

  // every fakephone://app/... request (pages, /api, /exports) goes to the local server, bodies streamed
  const FORWARD = ['content-type', 'accept', 'xi-api-key', 'range'];
  protocol.handle('fakephone', (req) => {
    const u = new URL(req.url);
    const headers = {};
    for (const h of FORWARD) if (req.headers.has(h)) headers[h] = req.headers.get(h);
    const init = { method: req.method, headers };
    if (req.body) Object.assign(init, { body: req.body, duplex: 'half' });
    return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
  });

  // the microphone (voice takes) and the clipboard are all the page asks for
  const allowed = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm) && wc.getURL().startsWith(ORIGIN)));

  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 680, show: false, backgroundColor: '#09090b', title: 'Fake Phone',
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.removeMenu();
  win.webContents.on('console-message', (e) => { if (e.level === 'error') log('page error:', e.message); });
  win.webContents.on('render-process-gone', (e, d) => log('renderer gone:', d.reason));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // exported videos open in the system player, web links in the browser; no other app windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN + '/exports/')) shell.openPath(path.join(exportsDir(), path.basename(decodeURIComponent(new URL(url).pathname))));
    else if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // a file dropped on the window must not replace the app
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadURL(ORIGIN + '/');
});
