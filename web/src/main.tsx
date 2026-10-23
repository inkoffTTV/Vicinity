import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker, setOpenUrlHandler } from './lib/pwa';
import { parsePath, viewForRoute } from './lib/routes';
import { useStore } from './lib/store';
// Приложение для Android: уведомления и звонок в свёрнутом виде через мост WebView
import './lib/android';
// Автостатус «Не активен» при простое
import './lib/idle';
// Оформление (тема, акцент, шрифт) — до первой отрисовки, без вспышки другой темы
import './lib/prefs';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/jetbrains-mono/400.css';
// Шрифты стиля ника (lib/nameStyle.ts): файлы скачиваются, только когда шрифт встречается на экране
import '@fontsource/comfortaa/700.css';
import '@fontsource/oswald/600.css';
import '@fontsource/exo-2/700.css';
import '@fontsource/russo-one/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/lobster/400.css';
import '@fontsource/amatic-sc/700.css';
import '@fontsource/rubik-mono-one/400.css';
// Шрифты интерфейса (lib/fonts.ts): обычное начертание для текста
import '@fontsource/comfortaa/400.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/oswald/400.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/caveat/400.css';
import '@fontsource/unbounded/400.css';
import './tokens.css';
import './styles.css';
import './theme.css';
import './profile.css';
import './settings.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
// Щелчок по push-уведомлению при открытом окне — перейти к чату
setOpenUrlHandler((url) => {
  const r = parsePath(new URL(url, location.origin).pathname);
  const s = useStore.getState();
  const v = r && r.kind !== 'invite' ? viewForRoute(s, r) : null;
  if (v) s.open(v);
  else history.pushState(null, '', url);
});
