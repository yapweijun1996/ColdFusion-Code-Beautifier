/* PWA registration + force-reload-to-latest pipeline.
 *
 * Behavior:
 *   - Register ./sw.js on load.
 *   - When a new SW is found in 'installed' state with an existing controller,
 *     ask it to skipWaiting (it already calls clients.claim on activate).
 *   - On 'controllerchange' fired by the new active SW, reload exactly once
 *     so the page picks up the latest assets.
 *   - Optional manual check: window.checkForUpdate() — also runs every 60 min
 *     while tab is focused.
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
      promptIfWaiting(reg);
      reg.addEventListener('updatefound', function () { watchInstalling(reg); });

      window.checkForUpdate = function () { return reg.update(); };
      setInterval(function () {
        if (document.visibilityState === 'visible') reg.update();
      }, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(function (err) {
      console.warn('[pwa] SW registration failed:', err);
    });
  });
})();
