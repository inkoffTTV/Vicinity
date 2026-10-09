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
import './styles.css';
import './theme.css';
import './profile.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
