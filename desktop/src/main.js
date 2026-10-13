// Vicinity для Windows: окно с веб-клиентом, трей, уведомления, выбор экрана для показа и автообновление.
// Сам интерфейс — тот же веб-клиент с сервера, поэтому обновления дизайна приходят без переустановки.
const { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, nativeTheme, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://chat.13-143-162-211.sslip.io';
const ORIGIN = new URL(APP_URL).origin;
const START_URL = APP_URL + '/channels/@me';

app.setAppUserModelId('app.vicinity.desktop');
nativeTheme.themeSource = 'dark';

// Второй запуск — показываем уже открытое окно
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let quitting = false;

const asset = (name) => path.join(__dirname, '..', 'build', name);

// ── Значок приложения (Настройки → Значок приложения) ──
// Выбранный значок хранится в userData: appicon.png (окно и трей) и appicon-<id>.ico (ярлыки).
const iconPng = () => path.join(app.getPath('userData'), 'appicon.png');
function currentIcon() {
  try {
    const img = nativeImage.createFromPath(iconPng());
    if (!img.isEmpty()) return img;
  } catch {
    /* исходный */
  }
  return nativeImage.createFromPath(asset('icon.png'));
}
const trayIcon = (img) => img.resize({ width: 32, height: 32, quality: 'best' });

/** ICO из нескольких PNG (Windows Vista+ читает PNG внутри ICO) */
function icoFrom(img) {
  const sizes = [256, 48, 32, 16];
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((buf, i) => {
    const o = 6 + i * 16;
    head.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], o);
    head.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(buf.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs]);
}

/** Ярлыки Vicinity: рабочий стол, «Пуск», закреплённый на панели задач */
function shortcuts() {
  const appData = app.getPath('appData');
  return [
    path.join(app.getPath('desktop'), 'Vicinity.lnk'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Vicinity.lnk'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Vicinity.lnk'),
  ].filter((p) => {
    try {
      // Только наши ярлыки — те, что ведут на этот Vicinity.exe
      return fs.existsSync(p) && path.resolve(shell.readShortcutLink(p).target) === path.resolve(process.execPath);
    } catch {
      return false;
    }
  });
}

function setAppIcon(id, png) {
  const dir = app.getPath('userData');
  // Тот же значок, что уже стоит (каждый запуск приложения) — ярлыки не трогаем
  const same = png ? fs.existsSync(path.join(dir, `appicon-${id.replace(/[^\w-]/g, '')}.ico`)) : !fs.existsSync(iconPng());
  if (same) return;
  // Старые .ico — убрать (у каждого значка своё имя: Windows кэширует значки по пути)
  for (const f of fs.readdirSync(dir)) if (/^appicon-[\w-]+\.ico$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  let ico = null;
  if (png) {
    const img = nativeImage.createFromDataURL(png);
    if (img.isEmpty()) return;
    fs.writeFileSync(iconPng(), img.toPNG());
    ico = path.join(dir, `appicon-${id.replace(/[^\w-]/g, '')}.ico`);
    fs.writeFileSync(ico, icoFrom(img));
  } else {
    fs.rmSync(iconPng(), { force: true });
  }
  const img = currentIcon();
  if (win && !win.isDestroyed()) win.setIcon(img);
  if (tray) tray.setImage(trayIcon(img));
  if (!app.isPackaged || process.platform !== 'win32') return;
  for (const lnk of shortcuts()) {
    try {
      shell.writeShortcutLink(lnk, 'update', ico ? { icon: ico, iconIndex: 0 } : { icon: process.execPath, iconIndex: 0 });
    } catch {
      /* ярлык только для чтения — пропускаем */
    }
  }
}

let lastIcon = null;
ipcMain.on('icon:set', (e, id, png) => {
  if (!win || e.sender !== win.webContents || !sameOrigin(e.sender.getURL())) return;
  if (typeof id !== 'string' || !/^[\w-]{1,32}$/.test(id) || (png !== null && (typeof png !== 'string' || !png.startsWith('data:image/png;base64,') || png.length > 2_000_000))) return;
  if (id === lastIcon) return;
  lastIcon = id;
  try {
    setAppIcon(id, png);
  } catch {
    /* значок останется прежним */
  }
});
const sameOrigin = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};
const openExternal = (url) => {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url);
};

// ── Размер и положение окна между запусками ──
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    // Окно на отключённом мониторе — не восстанавливаем положение
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100;
    });
    return visible ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch {
    return { width: 1280, height: 800 };
  }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* не страшно */
  }
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: Math.max(940, b.width || 1280),
    height: Math.max(560, b.height || 800),
    minWidth: 940,
    minHeight: 560,
    title: 'Vicinity',
    icon: currentIcon(),
    backgroundColor: '#0e1015',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.removeMenu();
  if (b.maximized) win.maximize();
  // Автозапуск с Windows (--hidden) — сразу в трей, без окна
  const startHidden = process.argv.includes('--hidden') && !createWindow.done;
  createWindow.done = true;
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  void win.loadURL(START_URL);

  // Ссылки наружу — в браузер; внутри окна остаётся только сам Vicinity
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (sameOrigin(url)) return;
    e.preventDefault();
    openExternal(url);
  });

  // Нет связи с сервером — своя страница с кнопкой «Повторить»
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 /* ABORTED */ || !sameOrigin(url)) return;
    void win.loadFile(path.join(__dirname, 'offline.html'));
  });

  // Ctrl+R / F5 — перезагрузить, Ctrl+Shift+I — инструменты разработчика, Ctrl+колесо/±/0 — масштаб
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
      e.preventDefault();
      win.webContents.reload();
    } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
      e.preventDefault();
      win.webContents.toggleDevTools();
    } else if (ctrl && (input.key === '=' || input.key === '+')) {
      e.preventDefault();
      win.webContents.setZoomLevel(Math.min(3, win.webContents.getZoomLevel() + 0.5));
    } else if (ctrl && input.key === '-') {
      e.preventDefault();
      win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5));
    } else if (ctrl && input.key === '0') {
      e.preventDefault();
      win.webContents.setZoomLevel(0);
    }
  });

  // Крестик — свернуть в трей (как Discord); выйти — из меню трея
  win.on('close', (e) => {
    saveBounds();
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('closed', () => {
    win = null;
  });

  // Непрочитанное: заголовок вкладки «(3) Vicinity» → мигание на панели задач, пока окно не в фокусе
  win.on('page-title-updated', (_e, title) => {
    if (/^\(\d+\)/.test(title) && !win.isFocused()) win.flashFrame(true);
  });
  win.on('focus', () => win.flashFrame(false));
}

function createTray() {
  tray = new Tray(fs.existsSync(iconPng()) ? trayIcon(currentIcon()) : nativeImage.createFromPath(asset('tray.png')));
  tray.setToolTip('Vicinity');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Vicinity', click: showWindow },
      { type: 'separator' },
      {
        label: 'Запускать вместе с Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { type: 'separator' },
      {
        label: 'Выйти',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
}

// ── Микрофон, камера, уведомления — только для самого Vicinity ──
const ALLOWED = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'display-capture', 'speaker-selection']);
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(sameOrigin(wc.getURL()) && ALLOWED.has(permission)));
  ses.setPermissionCheckHandler((wc, permission, origin) => (origin === ORIGIN || (wc && sameOrigin(wc.getURL()))) && ALLOWED.has(permission));

  // Показ экрана: своё окно выбора (экран или окно), со звуком системы для целого экрана
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      const chosen = await pickSource(sources);
      if (!chosen) return callback({});
      callback(chosen.id.startsWith('screen:') ? { video: chosen, audio: 'loopback' } : { video: chosen });
    } catch {
      callback({});
    }
  });
}

// ── Окно выбора источника для показа экрана ──
let picker = null;
function pickSource(sources) {
  if (picker) picker.finish(null);
  return new Promise((resolve) => {
    const list = sources.map((s) => ({
      id: s.id,
      name: s.name,
      screen: s.id.startsWith('screen:'),
      thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }));
    const pw = new BrowserWindow({
      parent: win ?? undefined,
      modal: !!win,
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Показ экрана',
      backgroundColor: '#161920',
      show: false,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    pw.removeMenu();
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      picker = null;
      resolve(sources.find((s) => s.id === id) ?? null);
      if (!pw.isDestroyed()) pw.close();
    };
    picker = { list, finish, wc: pw.webContents };
    pw.on('closed', () => finish(null));
    pw.once('ready-to-show', () => pw.show());
    void pw.loadFile(path.join(__dirname, 'picker.html'));
  });
}
ipcMain.handle('picker:list', (e) => (picker && e.sender === picker.wc ? picker.list : []));
ipcMain.on('picker:choose', (e, id) => {
  if (picker && e.sender === picker.wc) picker.finish(typeof id === 'string' ? id : null);
});
ipcMain.on('offline:retry', () => {
  if (win) void win.loadURL(START_URL);
});

// ── Автообновление: новые версии лежат на сервере (/download/latest.yml) ──
function setupUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    autoUpdater.on('update-downloaded', () => {
      if (!win) return;
      win.webContents
        .executeJavaScript("window.dispatchEvent(new CustomEvent('vicinity-desktop-update'))", true)
        .catch(() => {});
    });
    ipcMain.on('update:install', () => {
      quitting = true;
      autoUpdater.quitAndInstall();
    });
    check();
    setInterval(check, 4 * 60 * 60 * 1000);
  } catch {
    /* без автообновления */
  }
}

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  /* живём в трее */
});

app.whenReady().then(() => {
  setupPermissions();
  createTray();
  createWindow();
  setupUpdates();
});
