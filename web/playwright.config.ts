import { defineConfig, devices } from '@playwright/test';

// e2e: настоящий бэкенд (e2e/start-backend.mjs) + собранный веб-клиент через vite preview.
const backendPort = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const webPort = Number(process.env.VICINITY_E2E_WEB_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone', 'camera'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      url: `http://localhost:${backendPort}/api/v1/auth/me`,
      // 401 от /auth/me — признак живого сервера (Playwright считает 401 «готов»)
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run build && npx vite preview --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      env: { VICINITY_BACKEND: `http://localhost:${backendPort}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
