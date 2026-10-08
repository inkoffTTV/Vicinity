import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// В dev-режиме все запросы к API/WS/загрузкам проксируются на бэкенд.
// Адрес бэкенда можно переопределить: VICINITY_BACKEND=http://host:8080 npm run dev
const backend = process.env.VICINITY_BACKEND ?? 'http://localhost:8080';

// Service worker (pwa/sw.js) собирается вместе с приложением: версия — хэш собранных файлов
// (новая сборка = новый sw.js = предложение обновиться), список ассетов — для предзагрузки в кэш.
function serviceWorker(): Plugin {
  return {
    name: 'vicinity-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/'))
        .sort()
        .map((f) => `/${f}`);
      const html = bundle['index.html'];
      const version = createHash('sha256')
        .update(assets.join('\n'))
        .update(html && html.type === 'asset' ? html.source : '')
        .digest('hex')
        .slice(0, 12);
      const source = readFileSync(new URL('./pwa/sw.js', import.meta.url), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
