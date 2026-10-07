import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev-режиме все запросы к API/WS/загрузкам проксируются на бэкенд.
// Адрес бэкенда можно переопределить: VICINITY_BACKEND=http://host:8080 npm run dev
const backend = process.env.VICINITY_BACKEND ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
