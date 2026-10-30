/* Service Worker – bei JEDEM Release CACHE_VERSION erhoehen (muss zu APP_VERSION passen). */
'use strict';
const CACHE_VERSION = 'v1.6.2';
const CACHE = 'trainmaster-' + CACHE_VERSION;
const V = '?v=' + CACHE_VERSION.slice(1);
const DEV = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(self.location.hostname);
const PRECACHE = [
  '/offline',
  '/static/css/app.css' + V, '/static/css/pages.css' + V,
  '/static/js/theme.js' + V, '/static/js/core.js' + V, '/static/js/offline.js' + V,
  '/static/icons/logo.svg', '/static/icons/icon-192.png', '/static/icons/icon-512.png', '/static/icons/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;           // API nie cachen
  if (url.pathname.startsWith('/uploads/')) return;       // persoenliche Bilder nicht cachen

  // Lokale Entwicklung (localhost / Heimnetz): immer frisch laden, damit Aenderungen sofort sichtbar sind
  if (DEV) return;
  // Statische Dateien: Cache zuerst (versioniert ueber ?v=, Icons aendern sich kaum) -> schnelle Seitenwechsel
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })).catch(() => new Response('', { status: 503, statusText: 'Offline' })));
    return;
  }
  // Seiten: immer frisch vom Server (Login-Status, aktuelle Daten), offline -> Offline-Seite
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('/offline');
      return new Response('', { status: 503, statusText: 'Offline' });
    }))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});

/* Vorbereitet fuer Web-Push (derzeit ungenutzt) */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'TrainMaster', {
    body: data.body || '', icon: '/static/icons/icon-192.png', badge: '/static/icons/icon-192.png', data: { url: data.url || '/dashboard' },
  }));
});
