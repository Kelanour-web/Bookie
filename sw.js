const CACHE = 'bookie-v1';

const FILES = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// When installed: save the app's files for offline use
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return cache.addAll(FILES);
        })
    );
});

// On every request: try the internet first, fall back to the saved copy
self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') { return; }

    event.respondWith(
        fetch(event.request)
            .then(function (response) {
                const copy = response.clone();
                caches.open(CACHE).then(function (cache) {
                    cache.put(event.request, copy);
                });
                return response;
            })
            .catch(function () {
                return caches.match(event.request);
            })
    );
});