const CACHE_NAME = 'enduro-map-v11';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME && k !== 'enduro-tiles-v1').map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Map tiles caching (Cache First for Google Map tiles)
    if (url.hostname.includes('google.com') && url.pathname.includes('/vt/')) {
        event.respondWith(
            caches.open('enduro-tiles-v1').then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    return fetch(event.request).then(networkResponse => {
                        if (networkResponse.ok) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => new Response('', { status: 408 }));
                });
            })
        );
        return;
    }

    // Standard Google resources (Fonts, etc.) — Network only
    if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
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
