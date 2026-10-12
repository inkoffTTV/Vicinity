// Мост для веб-клиента: он узнаёт, что запущен в приложении, и может поставить скачанное обновление
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vicinityDesktop', {
  platform: process.platform,
  installUpdate: () => ipcRenderer.send('update:install'),
  retry: () => ipcRenderer.send('offline:retry'),
});
