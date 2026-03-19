// KodSpot Admin — Service Worker
// Strategy: Network-first with offline shell fallback.
// NEVER serves stale API data. Only caches the app shell for offline resilience.

var CACHE_NAME = 'kodspot-admin-v1';
var SHELL_ASSETS = [
  '/admin.html',
  '/admin.js'
];

// Install: pre-cache the minimal app shell
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old caches, take control immediately
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
            .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: network-first for EVERYTHING
// Only fall back to cache when network is completely unavailable
self.addEventListener('fetch', function (e) {
  var req = e.request;

  // Skip non-GET, skip API calls entirely (never cache them)
  if (req.method !== 'GET') return;
  if (req.url.indexOf('/api/') !== -1) return;

  // Skip cross-origin requests (fonts, analytics, razorpay, etc.)
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Only handle admin app resources — don't interfere with menu or other pages
  if (url.pathname.indexOf('/admin') !== 0) return;

  e.respondWith(
    fetch(req).then(function (response) {
      // Got network response — update cache in background for shell assets
      if (response.ok && isShellAsset(req.url)) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, clone);
        });
      }
      return response;
    }).catch(function () {
      // Network failed — serve from cache if available
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        // For navigation requests, serve the cached admin shell
        if (req.mode === 'navigate') {
          return caches.match('/admin.html');
        }
        // Nothing cached — let the browser show its default error
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

function isShellAsset(url) {
  for (var i = 0; i < SHELL_ASSETS.length; i++) {
    if (url.endsWith(SHELL_ASSETS[i])) return true;
  }
  return false;
}
