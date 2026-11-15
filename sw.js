// Service worker da Lumi: notificações e funcionamento offline básico.
const CACHE = 'lumi-v6';
const SHELL = ['./', 'index.html', 'styles.css', 'lumi-face.css', 'lumi.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro (para pegar versões novas); cache se estiver sem internet.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});

self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data.json(); } catch { p = { title: 'Lumi', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(p.title || 'Lumi', {
    body: p.body || '',
    tag: p.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: p.alarm ? [400, 150, 400, 150, 400] : [200, 80, 200],
    requireInteraction: Boolean(p.alarm),
    renotify: true,
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});
