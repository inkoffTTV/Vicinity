// Vicinity для Windows: окно с веб-клиентом, трей, уведомления, выбор экрана для показа и автообновление.
// Сам интерфейс — тот же веб-клиент с сервера, поэтому обновления дизайна приходят без переустановки.
const { app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://chat.13-143-162-211.sslip.io';
const ORIGIN = new URL(APP_URL).origin;
const START_URL = APP_URL + '/channels/@me';
const OVERLAY_URL = APP_URL + '/overlay';

app.setAppUserModelId('app.vicinity.desktop');
nativeTheme.themeSource = 'dark';

// Голос не должен «проседать», когда окно в фоне (alt-tab в игру): Chromium по умолчанию замедляет
// таймеры, понижает приоритет и считает перекрытое игрой окно скрытым — звук и сеть идут рывками,
// у собеседников это треск. Мессенджеру с голосом это не нужно (так же делает Discord)
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch(
  'disable-features',
  // Окно за игрой — не «перекрытое»; таймеры и WebSocket не душатся в фоне; процесс не переводится в EcoQoS
  ['CalculateNativeWinOcclusion', 'IntensiveWakeUpThrottling', 'AllowAggressiveThrottlingWithWebSocket', 'UseEcoQoSForBackgroundProcess'].join(','),
);

// Ссылки vicinity://invite/КОД (и https-ссылки на сайт) открывают приложение (1.2.0+).
// В разработке (electron .) Windows должна запускать electron с путём к приложению.
const PROTOCOL = 'vicinity';
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Второй запуск — показываем уже открытое окно (и открываем ссылку, с которой его запустили)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Экраны веб-клиента, которые можно открыть по ссылке (web/src/lib/routes.ts)
const APP_PATH = /^\/(?:(?:invite|gift|u|users|channels)\/|bots(?:\/|$))/;
// Параметр запуска бота: /bots/<username>?start=<payload> (docs/API.md §21.9) — единственный query, который передаём
const withStart = (u) => {
  const start = /^\/bots\/[A-Za-z0-9_@]+$/.test(u.pathname) ? u.searchParams.get('start') : null;
  return start && /^[A-Za-z0-9_-]{1,64}$/.test(start) ? `${u.pathname}?start=${start}` : u.pathname;
};

/** Путь экрана из ссылки: vicinity://invite/ABC → /invite/ABC, https://<сайт>/invite/ABC → /invite/ABC; иначе null */
function deepLinkPath(raw) {
  if (typeof raw !== 'string') return null;
  try {
    if (raw.toLowerCase().startsWith(PROTOCOL + '://')) {
      const rest = raw.slice(PROTOCOL.length + 3).replace(/^\/+/, '');
      const u = new URL('https://x/' + rest);
      return APP_PATH.test(u.pathname) ? withStart(u) : null;
    }
    const u = new URL(raw);
    return u.origin === ORIGIN && APP_PATH.test(u.pathname) ? withStart(u) : null;
  } catch {
    return null;
  }
}
const deepLinkFromArgv = (argv) => argv.map(deepLinkPath).find(Boolean) ?? null;

let win = null;
let tray = null;
let quitting = false;
let overlay = null;

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
// Ведро на открытие окон: 3 сразу, пополняется одним в секунду
let openTokens = 3;
let openAt = Date.now();
function openBudget() {
  const now = Date.now();
  openTokens = Math.min(3, openTokens + (now - openAt) / 1000);
  openAt = now;
  if (openTokens < 1) return false;
  openTokens -= 1;
  return true;
}

const openExternal = (url) => {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url);
};

// ── Контекстное меню текста (1.3.0) ──
function showTextMenu(wc, p) {
  if (!sameOrigin(wc.getURL())) return;
  const items = [];
  if (p.isEditable) {
    if (p.misspelledWord) {
      for (const word of (p.dictionarySuggestions || []).slice(0, 6)) items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      if (!items.length) items.push({ label: 'Нет вариантов', enabled: false });
      items.push({ label: 'Добавить в словарь', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    }
    const f = p.editFlags || {};
    items.push(
      { label: 'Вырезать', role: 'cut', enabled: !!f.canCut },
      { label: 'Копировать', role: 'copy', enabled: !!f.canCopy },
      { label: 'Вставить', role: 'paste', enabled: !!f.canPaste },
      { type: 'separator' },
      { label: 'Выделить всё', role: 'selectAll', enabled: !!f.canSelectAll },
    );
  } else {
    if (p.selectionText && p.selectionText.trim()) items.push({ label: 'Копировать', role: 'copy' });
    if (p.linkURL && /^https?:\/\//i.test(p.linkURL)) items.push({ label: 'Копировать ссылку', click: () => clipboard.writeText(p.linkURL) });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined });
}

// ── Картинки из меню веб-клиента: сохранить, сохранить альбом, скопировать (1.3.0) ──
// Скачивание идёт обычным downloadURL (с куками сессии), а путь заранее выбран: will-download ставит его без диалога
const pendingDownloads = new Map(); // адрес → очередь { file, resolve }
const MAX_IMAGE = 50 * 1024 * 1024;

/** Имя файла без путей и запрещённых в Windows символов */
function safeFileName(name) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 150);
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) || !clean ? 'image' + (clean ? '_' + clean : '') : clean;
}

// Картинки на сервере лежат как /uploads/attachments/<id>.<тип>, тип определён по содержимому файла
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Расширение картинки по её адресу на сервере; null — это не картинка */
function imageExt(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return IMAGE_EXTS.has(ext) ? ext : null;
  } catch {
    return null;
  }
}

/** Имя файла картинки: имя от отправителя, но расширение — настоящее, с сервера («фото.hta» → «фото.png») */
function imageFileName(name, url) {
  const ext = imageExt(url);
  const base = safeFileName(name).replace(/\.[^.]*$/, '') || 'image';
  return ext ? base + ext : null;
}

/** Свободное имя в папке: «фото.png», «фото (1).png»… */
function freePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let k = 0; k < 1000; k++) {
    const file = path.join(dir, k ? `${base} (${k})${ext}` : name);
    if (!fs.existsSync(file)) return file;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

function downloadTo(url, file) {
  return new Promise((resolve) => {
    const job = { file, resolve, timer: null };
    const queue = pendingDownloads.get(url) ?? [];
    queue.push(job);
    pendingDownloads.set(url, queue);
    // Скачивание так и не началось (сервер не ответил) — не ждём вечно
    job.timer = setTimeout(() => {
      const q = pendingDownloads.get(url);
      const i = q ? q.indexOf(job) : -1;
      if (i >= 0) q.splice(i, 1);
      if (q && !q.length) pendingDownloads.delete(url);
      resolve(false);
    }, 60_000);
    win.webContents.downloadURL(url);
  });
}

function setupDownloads(ses) {
  ses.on('will-download', (_e, item) => {
    const chain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
    const url = chain[0] || item.getURL();
    const queue = pendingDownloads.get(url);
    const job = queue && queue.shift();
    if (queue && !queue.length) pendingDownloads.delete(url);
    // Обычное скачивание (файл из ленты) — системный диалог «Сохранить как»
    if (!job) return;
    clearTimeout(job.timer);
    item.setSavePath(job.file);
    item.once('done', (_ev, state) => job.resolve(state === 'completed'));
  });
}

// Запрос от главного окна со страницы Vicinity и про картинку с того же сервера
const fromApp = (e) => !!win && e.sender === win.webContents && sameOrigin(e.sender.getURL());
const imageUrl = (url) => typeof url === 'string' && url.length < 2048 && sameOrigin(url) && !!imageExt(url);

// true — сохранено, null — отменено в диалоге, false — не удалось (сеть, таймаут, не картинка)
ipcMain.handle('image:save', async (e, url, name) => {
  if (!fromApp(e) || !imageUrl(url)) return false;
  const ext = imageExt(url);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить изображение',
    defaultPath: path.join(app.getPath('downloads'), imageFileName(name, url)),
    filters: [{ name: 'Изображение', extensions: [ext.slice(1)] }],
  });
  if (canceled || !filePath) return null;
  return downloadTo(url, filePath);
});

let albumDir = null;
ipcMain.handle('images:save', async (e, items) => {
  if (!fromApp(e) || !Array.isArray(items)) return 0;
  const list = items.slice(0, 100).filter((i) => i && imageUrl(i.url));
  if (!list.length) return 0;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Папка для изображений',
    defaultPath: albumDir ?? app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths || !filePaths[0]) return -1;
  albumDir = filePaths[0];
  let saved = 0;
  for (const i of list) if (await downloadTo(i.url, freePath(albumDir, imageFileName(i.name, i.url)))) saved++;
  return saved;
});

ipcMain.handle('image:copy', async (e, url) => {
  if (!fromApp(e) || !imageUrl(url)) return false;
  try {
    const res = await win.webContents.session.fetch(url);
    if (!res.ok || Number(res.headers.get('content-length') || 0) > MAX_IMAGE) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE) return false;
    // nativeImage понимает PNG и JPEG; webp и gif скопирует веб-клиент через canvas
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  } catch {
    return false;
  }
});

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
      backgroundThrottling: false,
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
  // Запуск по ссылке — сразу на нужный экран
  const first = deepLinkFromArgv(process.argv);
  void win.loadURL(first ? APP_URL + first : START_URL);

  // Ссылки на экраны Vicinity — в этом же окне; остальные — в браузер.
  // window.open приходит сюда из любого фрейма (и из мини-приложения бота), а блокировщика всплывающих окон, как в Chrome,
  // в Electron нет: не больше 3 открытий подряд и дальше одно в секунду — иначе страница завалила бы браузер вкладками
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!openBudget()) return { action: 'deny' };
    const p = deepLinkPath(url);
    if (p) openDeepLink(p);
    else openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (sameOrigin(url)) return;
    e.preventDefault();
    openExternal(url);
  });

  // Своё меню у картинок и людей рисует веб-клиент (preventDefault у contextmenu) — тогда этого события нет.
  // Здесь — системное меню для текста: поле ввода с подсказками орфографии, выделение, ссылка
  win.webContents.on('context-menu', (_e, p) => showTextMenu(win.webContents, p));

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

// ── Оверлей для игр: прозрачное окно поверх всего с участниками голоса, звонком и сообщениями ──
// Клики проходят сквозь него. Игры в эксклюзивном полноэкранном режиме рисуют мимо него —
// там нужен оконный режим без рамки (как у любого оверлея).
const overlayFile = () => path.join(app.getPath('userData'), 'overlay.json');
const OVERLAY_SIZE = { width: 360, height: 520 };
const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
function loadOverlay() {
  try {
    const o = JSON.parse(fs.readFileSync(overlayFile(), 'utf8'));
    return { enabled: !!o.enabled, corner: CORNERS.includes(o.corner) ? o.corner : 'top-right' };
  } catch {
    return { enabled: false, corner: 'top-right' };
  }
}
let overlayPrefs = null;
function saveOverlay(prefs) {
  overlayPrefs = prefs;
  try {
    fs.writeFileSync(overlayFile(), JSON.stringify(prefs));
  } catch {
    /* не страшно */
  }
}
function overlayBounds(corner) {
  const a = screen.getPrimaryDisplay().workArea;
  const { width, height } = OVERLAY_SIZE;
  const x = corner.endsWith('left') ? a.x + 8 : a.x + a.width - width - 8;
  const y = corner.startsWith('top') ? a.y + 8 : a.y + a.height - height - 8;
  return { x, y, width, height };
}
function applyOverlay() {
  const prefs = overlayPrefs ?? (overlayPrefs = loadOverlay());
  if (!prefs.enabled) {
    if (overlay && !overlay.isDestroyed()) overlay.close();
    overlay = null;
  } else if (!overlay || overlay.isDestroyed()) {
    overlay = new BrowserWindow({
      ...overlayBounds(prefs.corner),
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      title: 'Vicinity Overlay',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.removeMenu();
    overlay.once('ready-to-show', () => overlay && overlay.showInactive());
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlay.on('closed', () => {
      overlay = null;
    });
    void overlay.loadURL(OVERLAY_URL);
  } else {
    overlay.setBounds(overlayBounds(prefs.corner));
  }
  if (tray) createTrayMenu();
  if (win && !win.isDestroyed()) win.webContents.send('overlay:changed', prefs);
}
function setOverlay(patch) {
  const prefs = { ...(overlayPrefs ?? loadOverlay()), ...patch };
  if (!CORNERS.includes(prefs.corner)) prefs.corner = 'top-right';
  saveOverlay({ enabled: !!prefs.enabled, corner: prefs.corner });
  applyOverlay();
}
ipcMain.handle('overlay:get', (e) => (sameOrigin(e.sender.getURL()) ? overlayPrefs ?? loadOverlay() : null));
ipcMain.on('overlay:set', (e, patch) => {
  if (!win || e.sender !== win.webContents || !sameOrigin(e.sender.getURL()) || !patch || typeof patch !== 'object') return;
  const clean = {};
  if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled;
  if (typeof patch.corner === 'string') clean.corner = patch.corner;
  setOverlay(clean);
});

function createTrayMenu() {
  const prefs = overlayPrefs ?? loadOverlay();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Vicinity', click: showWindow },
      { type: 'separator' },
      {
        label: 'Оверлей в играх  (Ctrl+Shift+O)',
        type: 'checkbox',
        checked: prefs.enabled,
        click: (item) => setOverlay({ enabled: item.checked }),
      },
      {
        label: 'Угол оверлея',
        submenu: [
          ['top-right', 'Справа сверху'],
          ['top-left', 'Слева сверху'],
          ['bottom-right', 'Справа снизу'],
          ['bottom-left', 'Слева снизу'],
        ].map(([corner, label]) => ({ label, type: 'radio', checked: prefs.corner === corner, click: () => setOverlay({ corner }) })),
      },
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
}

function createTray() {
  tray = new Tray(fs.existsSync(iconPng()) ? trayIcon(currentIcon()) : nativeImage.createFromPath(asset('tray.png')));
  tray.setToolTip('Vicinity');
  createTrayMenu();
  tray.on('click', showWindow);
}

// ── Микрофон, камера, уведомления — только для самого Vicinity ──
const ALLOWED = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'display-capture', 'speaker-selection']);
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(sameOrigin(wc.getURL()) && ALLOWED.has(permission)));
  ses.setPermissionCheckHandler((wc, permission, origin) => (origin === ORIGIN || (wc && sameOrigin(wc.getURL()))) && ALLOWED.has(permission));
  setupDownloads(ses);
  // Подсказки орфографии для русского и английского (на Windows словари системные)
  try {
    const langs = ['ru', 'en-US'].filter((l) => ses.availableSpellCheckerLanguages.includes(l));
    if (langs.length) ses.setSpellCheckerLanguages(langs);
  } catch {
    /* словари по умолчанию */
  }

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

/** Открыть экран по ссылке в уже запущенном окне: веб-клиент сам переходит без перезагрузки (lib/router.ts) */
function openDeepLink(p) {
  showWindow();
  if (!win) return;
  const url = win.webContents.getURL();
  if (!sameOrigin(url)) {
    // Окно «Нет связи» или ещё не загрузилось — просто открыть адрес
    void win.loadURL(APP_URL + p);
    return;
  }
  win.webContents
    .executeJavaScript(`window.dispatchEvent(new CustomEvent('vicinity-open', { detail: ${JSON.stringify(p)} }))`, true)
    .catch(() => void win.loadURL(APP_URL + p));
}

app.on('second-instance', (_e, argv) => {
  const p = deepLinkFromArgv(argv);
  if (p && win) openDeepLink(p);
  else showWindow();
});
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
  applyOverlay();
  globalShortcut.register('CommandOrControl+Shift+O', () => setOverlay({ enabled: !(overlayPrefs ?? loadOverlay()).enabled }));
  screen.on('display-metrics-changed', () => overlay && applyOverlay());
});
app.on('will-quit', () => globalShortcut.unregisterAll());
