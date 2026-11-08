import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Быстрые API-тесты без сборки веб-клиента: только бэкенд, запросы идут прямо в него.
// npx playwright test -c playwright.api.config.ts e2e/<spec>
const backendPort = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const servers = Array.isArray(base.webServer) ? base.webServer : [base.webServer!];

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${backendPort}` },
  webServer: [servers[0]],
});
