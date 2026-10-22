// Мост для веб-клиента: он узнаёт, что запущен в приложении, и может поставить скачанное обновление
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
});
