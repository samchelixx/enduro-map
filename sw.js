const CACHE_NAME = 'enduro-map-v5';
const ASSETS = [
    '/',
    '/index.html',
    '/index.css',
    '/app.js',
    '/icon.svg',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    // Немедленно активировать новый SW
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    // Перехватить все вкладки сразу
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Map tiles — только сеть
    if (url.hostname.includes('google.com') || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
        event.respondWith(fetch(event.request).catch(() => new Response('', { status: 408 })));
        return;
    }

    // Все остальное — СЕТЬ В ПЕРВУЮ ОЧЕРЕДЬ, потом кеш
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
