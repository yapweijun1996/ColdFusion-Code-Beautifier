/* PWA registration + force-reload-to-latest pipeline.
 *
 * Behavior:
 *   - Register ./sw.js on load.
 *   - Immediately call reg.update() to bypass HTTP-cache and get a fresh
 *     byte-compare of sw.js on every page load (register() alone can serve
 *     a CDN-cached sw.js and miss new deploys for up to the cache TTL).
 *   - When a new SW is found in 'installed' state WITH an existing controller
 *     (i.e. this is an UPDATE, not first install), send SKIP_WAITING so the
 *     new SW activates immediately without waiting for all tabs to close.
 *   - On 'controllerchange' fired by the new active SW, reload exactly once
 *     so the page picks up the latest assets.
 *   - promptIfWaiting handles the race where the SW was already 'waiting'
 *     before this page loaded; watchInstalling(reg) at registration time
 *     handles the race where the SW was already 'installing' before the
 *     updatefound listener was attached.
 *   - Optional manual check: window.checkForUpdate() — also runs every 60 min
 *     while tab is focused, and on every visibility restore.
 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  /* Send SKIP_WAITING only when a real update is in progress (existing
   * controller means this is an update, not first install). This prevents
   * triggering an unnecessary reload the very first time the SW installs. */
  function promptIfWaiting(reg) {
    if (reg.waiting && navigator.serviceWorker.controller) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  function watchInstalling(reg) {
    var sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', function () {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        sw.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      /* Force a network-bypass update check on every page load.
       * register() uses the browser's normal HTTP-cache path and may skip
       * the network entirely if sw.js was fetched within the cache TTL.
       * reg.update() always sends a conditional GET, so a newly deployed
       * sw.js is detected immediately — not after up to 60 min or a tab
       * switch. Errors are silently ignored; the next check will retry. */
      reg.update().catch(function () {});

      /* Handle the SW that was already 'waiting' or 'installing' before
       * this page's load event fired (e.g. a background update that
       * completed while the user was on the previous page). Without these
       * calls the updatefound-based path would miss such SWs entirely. */
      promptIfWaiting(reg);
      watchInstalling(reg);

      reg.addEventListener('updatefound', function () { watchInstalling(reg); });

      window.checkForUpdate = function () { return reg.update(); };
      setInterval(function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      }, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    }).catch(function (err) {
      console.warn('[pwa] SW registration failed:', err);
    });
  });
})();
