// Мост для веб-клиента: он узнаёт, что запущен в приложении, и может поставить скачанное обновление,
// сохранить и скопировать картинку
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vicinityDesktop', {
  platform: process.platform,
  installUpdate: () => ipcRenderer.send('update:install'),
  retry: () => ipcRenderer.send('offline:retry'),
  // Значок приложения из настроек: png 256×256 (data:) или null — исходный
  setIcon: (id, png) => ipcRenderer.send('icon:set', String(id), typeof png === 'string' ? png : null),
  // С версии 1.1.0: оверлей для игр (Настройки → Оверлей, меню трея, Ctrl+Shift+O)
  overlay: {
    get: () => ipcRenderer.invoke('overlay:get'),
    set: (patch) => ipcRenderer.send('overlay:set', patch),
    onChange: (fn) => {
      const h = (_e, prefs) => fn(prefs);
      ipcRenderer.on('overlay:changed', h);
      return () => ipcRenderer.removeListener('overlay:changed', h);
    },
  },
  // С версии 1.3.0: меню картинок — сохранить (диалог; true — сохранено, null — отмена, false — ошибка),
  // сохранить альбом (папка один раз; число сохранённых, -1 — отмена), скопировать
  saveImage: (url, name) => ipcRenderer.invoke('image:save', String(url), String(name)),
  copyImage: (url) => ipcRenderer.invoke('image:copy', String(url)),
  saveImages: (items) =>
    ipcRenderer.invoke(
      'images:save',
      (Array.isArray(items) ? items : []).slice(0, 100).map((i) => ({ url: String(i && i.url), name: String(i && i.name) })),
    ),
});
