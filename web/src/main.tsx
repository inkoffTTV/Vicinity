import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
// Автостатус «Не активен» при простое
import './lib/idle';
// Оформление (тема, акцент, шрифт) — до первой отрисовки, без вспышки другой темы
import './lib/prefs';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/unbounded/700.css';
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
