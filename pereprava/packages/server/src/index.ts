// Сервер Переправы: HTTP (/health) и WebSocket (/ws). Авторитарный: симуляция идёт здесь,
// клиенты присылают только приказы и выбор в лобби.
//   PORT        — порт (по умолчанию 8787)
//   PUBLIC_URL  — адрес игры для ссылок-приглашений (https://pereprava.example.ru)
//   MAX_ROOMS   — сколько комнат одновременно (по умолчанию 50)
import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, Command } from '@pereprava/shared';
import { Client } from './client';
import { isMode, Room } from './room';

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL ?? '';
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 50);
const started = Date.now();

const rooms = new Map<string, Room>();
const byToken = new Map<string, Client>();
let nextClientId = 1;

const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_ABC[randomInt(CODE_ABC.length)];
    if (!rooms.has(s)) return s;
  }
}

// Управляющие символы и угловые скобки из имени убираем
// eslint-disable-next-line no-control-regex
const BAD_NAME_CHARS = /[\u0000-\u001f<>]/g;
const cleanName = (v: unknown) =>
  (typeof v === 'string' ? v.replace(BAD_NAME_CHARS, '').trim().slice(0, 16) : '') || 'Игрок';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);

/** Проверка приказа: только известные поля и числа — всё прочее отбрасываем */
function cleanCommand(c: unknown): Command | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  switch (o.c) {
    case 'move':
      return num(o.x) && num(o.z) ? { c: 'move', x: o.x, z: o.z } : null;
    case 'amove':
      return num(o.x) && num(o.z) ? { c: 'amove', x: o.x, z: o.z } : null;
    case 'attack':
      return int(o.id) ? { c: 'attack', id: o.id } : null;
    case 'stop':
      return { c: 'stop' };
    case 'cast':
      if (!int(o.slot) || o.slot < 0 || o.slot > 3) return null;
      return num(o.x) && num(o.z)
        ? { c: 'cast', slot: o.slot, x: o.x, z: o.z, id: int(o.id) ? o.id : undefined }
        : { c: 'cast', slot: o.slot };
    case 'buy':
      return typeof o.item === 'string' && o.item.length < 32 ? { c: 'buy', item: o.item } : null;
    case 'sell':
      return int(o.slot) ? { c: 'sell', slot: o.slot } : null;
    case 'use':
      if (!int(o.slot) || o.slot < 0 || o.slot > 5) return null;
      return num(o.x) && num(o.z) ? { c: 'use', slot: o.slot, x: o.x, z: o.z } : { c: 'use', slot: o.slot };
    case 'ping':
      return num(o.x) && num(o.z)
        ? { c: 'ping', x: o.x, z: o.z, kind: o.kind === 'danger' || o.kind === 'go' ? o.kind : 'look' }
        : null;
    default:
      return null;
  }
}

function handle(c: Client, m: ClientMsg) {
  const room = c.room;
  switch (m.t) {
    case 'create': {
      if (!isMode(m.mode)) return;
      room?.leave(c);
      if (rooms.size >= MAX_ROOMS)
        return c.send({ t: 'error', text: 'Сервер занят: все комнаты заняты, попробуйте позже' });
      const r = new Room(newCode(), m.mode, c, (x) => rooms.delete(x.code));
      if (typeof m.difficulty === 'string')
        r.difficulty = m.difficulty in { easy: 1, normal: 1, hard: 1 } ? m.difficulty : 'normal';
      rooms.set(r.code, r);
      r.join(c);
      return;
    }
    case 'join': {
      const code = typeof m.code === 'string' ? m.code.trim().toUpperCase() : '';
      const r = rooms.get(code);
      if (!r) return c.send({ t: 'error', text: 'Комната не найдена — проверьте код' });
      if (room && room !== r) room.leave(c);
      const err = r.join(c);
      if (err) c.send({ t: 'error', text: err });
      return;
    }
    case 'leave':
      room?.leave(c);
      c.send({ t: 'room', room: null });
      return;
    case 'pick':
      if (typeof m.hero === 'string') room?.pick(c, m.hero);
      return;
    case 'team':
      if (m.team === 0 || m.team === 1) room?.switchTeam(c, m.team);
      return;
    case 'ready':
      room?.setReady(c, !!m.ready);
      return;
    case 'mode':
      if (isMode(m.mode)) room?.setMode(c, m.mode);
      return;
    case 'difficulty':
      if (typeof m.difficulty === 'string') room?.setDifficulty(c, m.difficulty);
      return;
    case 'start':
      // «Ещё раз» после матча
      room?.rematch(c);
      return;
    case 'cmd': {
      const cmd = cleanCommand(m.cmd);
      if (cmd && room) room.command(c, int(m.seq) ? m.seq : 0, cmd);
      return;
    }
    case 'ping':
      if (num(m.ts)) c.send({ t: 'pong', ts: m.ts });
      return;
  }
}

function attach(ws: WebSocket) {
  let client: Client | null = null;
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (!client) {
      if (m.t !== 'hello') return;
      // Возвращение по токену: тот же игрок, та же комната
      const known = typeof m.token === 'string' ? byToken.get(m.token) : undefined;
      if (known) {
        known.ws?.close(4000, 'Вход с другой вкладки');
        client = known;
        client.ws = ws;
        client.name = cleanName(m.name);
      } else {
        client = new Client(nextClientId++, randomBytes(18).toString('base64url'), cleanName(m.name));
        client.ws = ws;
        byToken.set(client.token, client);
      }
      client.lastSeen = Date.now();
      client.send({ t: 'welcome', id: client.id, token: client.token, name: client.name });
      if (client.room) {
        client.send({ t: 'room', room: client.room.info() });
        client.room.reconnected(client);
      } else client.send({ t: 'room', room: null });
      return;
    }
    if (!client.allow()) return;
    client.lastSeen = Date.now();
    handle(client, m);
  });
  ws.on('close', () => {
    if (!client || client.ws !== ws) return;
    client.ws = null;
    client.lastSeen = Date.now();
    client.room?.disconnected(client);
  });
  ws.on('error', () => ws.close());
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(
      JSON.stringify({
        ok: true,
        uptime: Math.round((Date.now() - started) / 1000),
        rooms: rooms.size,
        maxRooms: MAX_ROOMS,
        players: [...byToken.values()].filter((c) => c.online).length,
        publicUrl: PUBLIC_URL || undefined,
      }),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Не найдено');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: { threshold: 512 } });
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws));
});

// Уборка: забытые игроки без комнаты и сокета, пустые комнаты
setInterval(() => {
  const now = Date.now();
  for (const [token, c] of byToken) if (!c.online && !c.room && now - c.lastSeen > 10 * 60_000) byToken.delete(token);
  for (const r of rooms.values())
    if (r.state !== 'game' && !r.humans && now - r.lastActive > 60_000) rooms.delete(r.code);
}, 30_000).unref();

server.listen(PORT, () => console.log(`Переправа: сервер на порту ${PORT}, комнат не больше ${MAX_ROOMS}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    for (const r of rooms.values()) r.stop();
    server.close();
    process.exit(0);
  });
