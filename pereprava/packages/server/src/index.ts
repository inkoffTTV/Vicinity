// Сервер Переправы: HTTP (/health) и WebSocket (/ws). Сетевая игра — фаза 2.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const started = Date.now();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - started) / 1000) }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`Переправа: сервер слушает порт ${PORT}`));
