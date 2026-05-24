const CACHE_NAME = 'enduro-map-v6';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Map tiles — network only
    if (url.hostname.includes('google.com') || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
        event.respondWith(fetch(event.request).catch(() => new Response('', { status: 408 })));
        return;
    }

    // Everything else — network first, cache fallback
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
