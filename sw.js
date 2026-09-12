/**
 * sw.js — offline shell for the installed app.
 *
 * The shell (HTML, CSS, JS, icons) is cached so the app opens instantly and
 * survives a dropped connection. API traffic is never cached: return data must
 * always come from the live spreadsheet, and a stale queue is worse than no
 * queue at all. Bump CACHE_VERSION whenever you publish a frontend change.
 */

var CACHE_VERSION = 'return-desk-v2';

var SHELL = [
  './',
  './index.html',
  './app.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/forms.css',
  './css/dashboard.css',
  './css/responsive.css',
  './js/config.js',
  './js/utils.js',
  './js/api.js',
  './js/auth.js',
  './js/validation.js',
  './js/charts.js',
  './js/voice.js',
  './js/photos.js',
  './js/app.js',
  './js/dashboard.js',
  './js/returns.js',
  './js/pending.js',
  './js/repair.js',
  './js/production.js',
  './js/analytics.js',
  './js/reports.js',
  './js/admin.js',
  './js/pwa.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/favicon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll fails the whole install if one file 404s, so add individually
      // and let a missing optional asset pass rather than breaking install.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE_VERSION ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Only GETs are cacheable, and only our own files.
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Apps Script, fonts: straight to network

  // Navigation: network first so a deployed update is picked up, cache as fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Everything else: cache first, refresh quietly in the background.
  event.respondWith(
    caches.match(request).then(function (hit) {
      var network = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(request, copy); });
        }
        return response;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});

// Lets the page tell a waiting worker to take over immediately.
self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
