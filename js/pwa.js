/**
 * pwa.js — install, update and connection handling for the installed app.
 * Loaded by both pages. Everything here degrades quietly: a browser without
 * service worker support simply runs the app as a normal website.
 */
(function () {

  var deferredPrompt = null;

  /* ------------------------------------------------------------ install */

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  function showInstallButton() {
    var host = document.getElementById('install-slot');
    if (!host || host.dataset.ready === '1') return;
    host.dataset.ready = '1';
    host.classList.remove('hidden');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = host.dataset.buttonClass || 'btn btn--sm';
    btn.textContent = 'Install app';
    btn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === 'accepted') host.classList.add('hidden');
        deferredPrompt = null;
      });
    });
    host.appendChild(btn);
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    var host = document.getElementById('install-slot');
    if (host) host.classList.add('hidden');
    if (window.U) U.toast('Return Desk installed');
  });

  /* ----------------------------------------------------- service worker */

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {

        // A new version finished downloading while the app was open.
        reg.addEventListener('updatefound', function () {
          var incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', function () {
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              announceUpdate(reg);
            }
          });
        });
      }).catch(function () {
        // Offline support is optional; the app works without it.
      });

      var reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    });
  }

  function announceUpdate(reg) {
    var bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = '<span>A new version is ready.</span>';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload';
    btn.addEventListener('click', function () {
      if (reg.waiting) reg.waiting.postMessage('skip-waiting');
      else location.reload();
    });

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'ghost';
    dismiss.textContent = 'Later';
    dismiss.addEventListener('click', function () { bar.remove(); });

    bar.appendChild(btn);
    bar.appendChild(dismiss);
    document.body.appendChild(bar);
  }

  /* --------------------------------------------------------- connection */

  var offlineBar = null;

  function setOnline(online) {
    if (online) {
      if (offlineBar) { offlineBar.remove(); offlineBar = null; }
      return;
    }
    if (offlineBar) return;
    offlineBar = document.createElement('div');
    offlineBar.className = 'offline-bar';
    offlineBar.textContent = 'No connection. You can read what is already on screen, but saving will fail until you are back online.';
    document.body.appendChild(offlineBar);
  }

  window.addEventListener('online', function () { setOnline(true); });
  window.addEventListener('offline', function () { setOnline(false); });
  if (!navigator.onLine) setOnline(false);

})();
