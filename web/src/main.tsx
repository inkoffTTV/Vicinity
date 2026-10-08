import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
// Автостатус «Не активен» при простое
import './lib/idle';
// Оформление (тема, акцент, шрифт) — до первой отрисовки, без вспышки другой темы
import './lib/prefs';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
