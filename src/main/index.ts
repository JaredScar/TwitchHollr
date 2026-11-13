import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, net, protocol, session, shell } from 'electron';
import { HollrApp } from './hollr';
import { log, setupFileLogging } from './logger';

const E2E = process.env.HOLLR_E2E === '1';
const DEV_URL = process.env.HOLLR_RENDERER_URL;
const APP_ORIGIN = 'hollr://app';
const RENDERER_DIR = resolve(__dirname, '../renderer');

if (E2E) app.setPath('userData', mkdtempSync(join(tmpdir(), 'hollr-e2e-')));
app.setAppUserModelId('tv.hollr.app');

protocol.registerSchemesAsPrivileged([
  { scheme: 'hollr', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://static-cdn.jtvnw.net",
  "connect-src 'self'",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function isAppUrl(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return Boolean(DEV_URL && url.startsWith(DEV_URL));
}

const isTwitchUrl = (url: string) => /^https:\/\/((www|dev|id)\.)?twitch\.tv\//.test(url);

let win: BrowserWindow | null = null;
let hollr: HollrApp | null = null;
let quitting = false;

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function registerAppProtocol(): void {
  protocol.handle('hollr', async (req) => {
    const { pathname } = new URL(req.url);
    let file = resolve(RENDERER_DIR, `.${decodeURIComponent(pathname)}`);
    const rel = relative(RENDERER_DIR, file);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) return new Response('Forbidden', { status: 403 });
    if (pathname === '/' || !existsSync(file)) file = join(RENDERER_DIR, 'index.html');
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });
}

function hardenSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const audioOnly =
      permission === 'media' &&
      'mediaTypes' in details &&
      (details.mediaTypes ?? []).every((t) => t === 'audio') &&
      isAppUrl(details.requestingUrl);
    callback(audioOnly);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && isAppUrl(`${origin}/`));
}

function createWindow(startHidden: boolean): BrowserWindow {
  const w = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Hollr',
    backgroundColor: '#0e0e14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isTwitchUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (isTwitchUrl(url)) void shell.openExternal(url);
    }
  });
  w.on('ready-to-show', () => {
    if (!startHidden) w.show();
  });
  w.on('close', (e) => {
    if (!quitting && hollr?.settings.get().minimizeToTray) {
      e.preventDefault();
      w.hide();
    }
  });

  void w.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return w;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    setupFileLogging();
    registerAppProtocol();
    hardenSession();

    hollr = new HollrApp({
      e2e: E2E,
      isAppUrl,
      showWindow,
      quit: () => {
        quitting = true;
        app.quit();
      },
    });
    win = createWindow(process.argv.includes('--hidden'));
    hollr.attachWindow(win);
    await hollr.start();

    if (app.isPackaged && !E2E && existsSync(join(process.resourcesPath, 'app-update.yml'))) {
      try {
        const mod = await import('electron-updater');
        // electron-updater defines autoUpdater as a lazy getter, which only survives CJS interop on `default`.
        const autoUpdater = mod.autoUpdater ?? (mod as unknown as { default: typeof mod }).default.autoUpdater;
        autoUpdater.logger = log;
        await autoUpdater.checkForUpdatesAndNotify();
      } catch (err) {
        log.warn('Update check failed', err);
      }
    }
  });

  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    void hollr?.shutdown();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
