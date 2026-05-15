/* ColdFusion Code Beautifier — Service Worker
 * Strategy:
 *   - HTML (navigation): network-first  → users always see latest source
 *   - JS / CSS / SVG / manifest: stale-while-revalidate
 *   - Bump CACHE_VERSION on every release to evict old assets
 */
const CACHE_VERSION = 'v7.1.2';
const CACHE_NAME    = 'cfbeautifier-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './manifest.webmanifest',
  './js/cf-tags.js',
  './js/sql-keywords.js',
  './js/sql-beautifier.js',
  './js/deep-format.js',
  './js/tag-utils.js',
  './js/toast.js',
  './js/clipboard.js',
  './js/pro-sql.js',
  './js/beautifier.js',
  './js/app.js',
  './js/pwa.js',
  './vendor/sql-formatter.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(
        /* `cache: 'reload'` bypasses the browser's HTTP cache so the SW
         * precache picks up fresh source on every install, not whatever
         * happened to be HTTP-cached when the user hard-reloaded. Without
         * this, bumping CACHE_VERSION evicts the SW cache but the new
         * cache is populated from the BROWSER cache — stale files leak
         * through and the version bump is a no-op. */
        PRECACHE_URLS.map((u) => new Request(u, { cache: 'reload' }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('cfbeautifier-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isHTMLRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isHTMLRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
