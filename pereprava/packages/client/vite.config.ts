import { defineConfig } from 'vite';

// Сервер игры для `npm run dev`: /ws проксируется на packages/server (порт 8787)
export default defineConfig({
  // Относительные пути: та же сборка работает в корне сайта и внутри Vicinity (/activities/pereprava/)
  base: './',
  server: {
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/health': 'http://localhost:8787' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
