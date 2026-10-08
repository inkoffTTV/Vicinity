// Service worker Vicinity. Сборка (vite.config.ts) подставляет номер версии и список ассетов.
// Из кэша — только оболочка приложения и хэшированные ассеты; API, WebSocket и загрузки
// всегда идут в сеть мимо кэша. Новая версия ждёт, пока пользователь не нажмёт «обновить».

const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/worklets/voice-processor.js',
];
const CACHE = `vicinity-${VERSION}`;
// Живые данные: никогда не кэшируются и не проходят через service worker
const LIVE = /^\/(api|uploads)\/|^\/ws$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...SHELL, ...ASSETS])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vicinity-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || LIVE.test(url.pathname)) return;

  // Страницы (любой адрес приложения — это index.html): сначала сеть, без сети — оболочка из кэша
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Хэшированные ассеты не меняются — из кэша, а чего нет — из сети с сохранением
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Остальная статика (иконки, манифест, worklet): сеть, без сети — кэш
  if (SHELL.includes(url.pathname))
    event.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error())));
});
