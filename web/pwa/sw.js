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
// Живые данные и отдельные страницы (игры «Активностей», установщик): никогда не кэшируются
// и не проходят через service worker — иначе страница игры стала бы офлайн-оболочкой приложения
const LIVE = /^\/(api|uploads|activities|download)\/|^\/ws$/;

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

// Push с сервера (docs/API.md §14): {t:"msg"|"call", title, body, icon, tag, url}
self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') return;
  const call = data.t === 'call';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: typeof data.icon === 'string' && data.icon ? data.icon : '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    renotify: call,
    requireInteraction: call,
    vibrate: call ? [300, 150, 300, 150, 300] : [120],
    data: { url: typeof data.url === 'string' ? data.url : '/' },
    actions: call ? [{ action: 'open', title: 'Открыть' }] : [],
  };
  const title = typeof data.title === 'string' && data.title ? data.title : 'Vicinity';
  event.waitUntil(
    // Если приложение открыто и на экране — оно само покажет уведомление; дублировать не нужно
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (!call && list.some((c) => c.visibilityState === 'visible' && c.focused)) return;
      return self.registration.showNotification(title, options);
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const target = new URL(url, self.location.origin).href;
      const open = list.find((c) => 'focus' in c);
      if (open) {
        // Открытое окно: перейти к чату без перезагрузки — приложение слушает это сообщение
        open.postMessage({ type: 'open-url', url });
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
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
