import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Тесты целых матчей бот против бота идут по нескольку секунд — запас по времени
  test: { include: ['packages/*/test/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
