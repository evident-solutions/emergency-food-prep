/* Emergency Food Prep service worker: caches the app shell so it works offline.
   Bump CACHE_VERSION whenever any app file changes so clients pick up the update. */

const CACHE_VERSION = 'v9';
const CACHE_NAME = `survival-plan-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/styles.css',
  './js/app.js',
  './js/backupFile.js',
  './js/calculations.js',
  './js/dates.js',
  './js/defaults.js',
  './js/reminders.js',
  './js/spreadsheet.js',
  './js/storage.js',
  './js/ui.js',
  './js/validation.js',
  './js/xlsx.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('survival-plan-') && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Network-first so a refresh picks up new files. Fall back to the cache when offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Offline and not cached.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }),
  );
});
