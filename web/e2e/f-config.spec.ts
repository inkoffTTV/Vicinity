import { expect, test } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniqueName } from './helpers';

// Переопределения конфига из окружения (deploy/env.example → .env → docker-compose → бэкенд):
// VICINITY_TURN_SECRET, VICINITY_TURN_URLS, VICINITY_STUN_URLS, VICINITY_TRUSTED_PROXIES.
// Каждый тест поднимает свой бэкенд (тот же бинарник, что и у остальных e2e) с чистой базой.
const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = resolve(process.env.VICINITY_SERVER_BIN ?? join(root, 'build/backend/VicinityServer'));

interface Backend {
  api: string;
  stop: () => void;
}

const started: Backend[] = [];
test.afterEach(() => {
  for (const b of started.splice(0)) b.stop();
});

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => done(port));
    });
  });
}

/** Бэкенд с backend/config.json и заданными переменными окружения; ждёт, пока /auth/me ответит 401. */
async function startBackend(env: Record<string, string>): Promise<Backend> {
  expect(existsSync(bin), `VicinityServer not found at ${bin}`).toBe(true);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'vicinity-f-'));
  const config = JSON.parse(readFileSync(join(root, 'backend/config.json'), 'utf8'));
  config.listeners[0].port = port;
  config.app.log_level = 'WARN';
  delete config.app.log_path;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));

  const child: ChildProcess = spawn(bin, [], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  const backend: Backend = {
    api: `http://127.0.0.1:${port}/api/v1`,
    stop: () => {
      child.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
    },
  };
  started.push(backend);
  await expect
    .poll(async () => (await fetch(`${backend.api}/auth/me`).catch(() => null))?.status ?? 0, { timeout: 15_000 })
    .toBe(401);
  return backend;
}

async function iceServers(backend: Backend) {
  const r = await fetch(`${backend.api}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uniqueName('ice'), password: 'password123', display_name: 'ICE' }),
  });
  expect(r.status).toBe(201);
  const { user_id: userId, token } = await r.json();
  const ice = await fetch(`${backend.api}/rtc/ice`, { headers: { Authorization: `Bearer ${token}` } });
  expect(ice.status).toBe(200);
  return { userId: userId as number, servers: (await ice.json()).ice_servers as any[] };
}

/** 61 неудачный вход с X-Real-IP (лимит — 60 в минуту на IP), затем ответ на вход с другим X-Real-IP. */
async function loginFromAnotherIpAfterFlood(backend: Backend) {
  const login = (ip: string) =>
    fetch(`${backend.api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ username: 'nobody-here', password: 'wrong-password' }),
    }).then((r) => r.status);
  const flood: number[] = [];
  for (let i = 0; i < 61; i++) flood.push(await login('203.0.113.7'));
  expect(flood.at(-1)).toBe(429);
  return login('203.0.113.8');
}

test('TURN and STUN servers come from the environment, credentials are HMAC-SHA1 of the secret', async () => {
  const secret = 'f-config-turn-secret';
  const backend = await startBackend({
    VICINITY_TURN_SECRET: secret,
    VICINITY_TURN_URLS: 'turn:203.0.113.10:3478?transport=udp, turn:203.0.113.10:3478?transport=tcp,',
    VICINITY_STUN_URLS: ' stun:203.0.113.10:3478 ',
  });
  const { userId, servers } = await iceServers(backend);
  expect(servers).toHaveLength(2);
  expect(servers[0]).toEqual({ urls: ['stun:203.0.113.10:3478'] });

  const turn = servers[1];
  expect(turn.urls).toEqual(['turn:203.0.113.10:3478?transport=udp', 'turn:203.0.113.10:3478?transport=tcp']);
  const [expiry, uid] = String(turn.username).split(':').map(Number);
  expect(uid).toBe(userId);
  expect(Math.abs(expiry - (Date.now() / 1000 + 24 * 60 * 60))).toBeLessThan(120);
  // Так же учётку проверяет coturn с use-auth-secret / static-auth-secret
  expect(turn.credential).toBe(createHmac('sha1', secret).update(turn.username).digest('base64'));
});

test('empty variables keep config.json values: STUN only, X-Real-IP not trusted', async () => {
  const backend = await startBackend({
    VICINITY_TURN_SECRET: '',
    VICINITY_TURN_URLS: '',
    VICINITY_STUN_URLS: '',
    VICINITY_TRUSTED_PROXIES: '',
  });
  const { servers } = await iceServers(backend);
  expect(servers).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
  // Без доверенных прокси X-Real-IP игнорируется: весь поток с 127.0.0.1 упирается в один лимит
  expect(await loginFromAnotherIpAfterFlood(backend)).toBe(429);
});

test('VICINITY_TRUSTED_PROXIES makes the backend take the client IP from X-Real-IP', async () => {
  const backend = await startBackend({ VICINITY_TRUSTED_PROXIES: '127.0.0.1/32, ::1' });
  // Лимит считается по адресу из заголовка: другой клиент за тем же прокси не заблокирован
  expect(await loginFromAnotherIpAfterFlood(backend)).toBe(401);
});
