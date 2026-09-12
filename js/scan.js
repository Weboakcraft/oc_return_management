/**
 * scan.js — continuous barcode scanning for courier tracking IDs.
 *
 * How it is meant to be used: open the scanner once and keep it open. Every
 * barcode that comes into view is saved to the phone straight away and the
 * camera stays live for the next parcel. A code that has been scanned before —
 * today, last week, by this phone at all — is refused with a red flash and a
 * low buzz, and is not saved twice.
 *
 * The list lives on the phone, so scanning works with no signal at all. When
 * there is a connection, Upload sends everything that has not gone to the
 * spreadsheet yet and marks it off.
 *
 * Two engines:
 *   Android app — ML Kit through the Capacitor plugin. The camera preview is
 *                 drawn behind the WebView, so while scanning the page hides
 *                 itself (body.barcode-scanner-active) and only the overlay,
 *                 which carries .barcode-scanner-modal, stays visible.
 *   Browser     — the built-in BarcodeDetector over a <video> element, where
 *                 the browser has it. Otherwise the screen says so and the
 *                 list can still be typed into by hand.
 */
Views.scan = (function () {

  var STORE = 'returndesk.scans';
  var COOLDOWN_MS = 1800;   // the same code held in front of the lens is one scan
  var UPLOAD_BATCH = 200;

  var state = { items: [], index: {} };
  var loaded = false;
  var session = null;       // the scanner while it is running
  var filter = '';

  /* ------------------------------------------------------------- storage */

  function norm(id) { return String(id || '').trim().toUpperCase(); }

  function load() {
    state.items = [];
    state.index = {};
    try {
      var raw = localStorage.getItem(STORE);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.items instanceof Array) state.items = parsed.items;
    } catch (e) { state.items = []; }
    state.items.forEach(function (s) { state.index[norm(s.id)] = true; });
    loaded = true;
  }

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ v: 1, items: state.items }));
      return true;
    } catch (e) {
      U.toast('The phone has no room left to save scans. Upload the list, then clear it.', 'error');
      return false;
    }
  }

  function pending() { return state.items.filter(function (s) { return !s.up; }); }
  function todayCount() {
    var d = U.today();
    return state.items.filter(function (s) { return String(s.at || '').slice(0, 10) === d; }).length;
  }

  /**
   * Saves one code. Returns 'saved', 'duplicate', 'empty' or 'full' — the
   * caller turns that into the colour, the sound and the message.
   */
  function record(code) {
    if (!loaded) load();
    var id = String(code || '').trim();
    if (!id) return 'empty';
    if (state.index[norm(id)]) return 'duplicate';

    var row = {
      id: id,
      at: new Date().toISOString(),
      by: (window.STATE && STATE.user && (STATE.user.username || STATE.user.name)) || '',
      up: false
    };
    state.items.push(row);
    state.index[norm(id)] = true;
    if (!persist()) {
      state.items.pop();
      delete state.index[norm(id)];
      return 'full';
    }
    return 'saved';
  }

  function remove(id) {
    var k = norm(id);
    state.items = state.items.filter(function (s) { return norm(s.id) !== k; });
    delete state.index[k];
    persist();
  }

  /* ------------------------------------------------------ sound and buzz */

  var audio = null;

  function feedback(ok) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.type = ok ? 'sine' : 'square';
      osc.frequency.value = ok ? 1320 : 300;
      var len = ok ? 0.12 : 0.34;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + len);
      osc.start();
      osc.stop(audio.currentTime + len + 0.02);
    } catch (e) { }
    try { if (navigator.vibrate) navigator.vibrate(ok ? 35 : [80, 60, 80]); } catch (e) { }
  }

  /* ------------------------------------------------------------- engines */

  function bridge() {
    var C = window.Capacitor;
    if (!C) return null;
    var isNative = typeof C.isNativePlatform === 'function' ? C.isNativePlatform() : !!C.isNative;
    return isNative ? C : null;
  }

  var nativePlugin = (function () {
    var found, looked = false;
    return function () {
      if (looked) return found;
      looked = true;
      var C = bridge();
      if (!C) return (found = null);
      try {
        found = typeof C.registerPlugin === 'function'
          ? C.registerPlugin('BarcodeScanner')
          : (C.Plugins || {}).BarcodeScanner || null;
      } catch (e) { found = null; }
      if (found && typeof found.startScan !== 'function') found = null;
      return found;
    };
  })();

  function webDetector() {
    return typeof window.BarcodeDetector === 'function' ? window.BarcodeDetector : null;
  }

  function canScan() { return !!nativePlugin() || !!webDetector(); }

  /* ---------------------------------------------------------- the screen */

  function render(host) {
    if (!loaded) load();
    U.clear(host);

    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Scan tracking IDs' }),
        U.el('p', { text: 'The scanner stays open. Every code is saved as it is read, and one that has already been scanned is refused.' })
      ]),
      U.el('div', { class: 'view__actions' }, [
        U.el('button', { class: 'btn btn--primary', type: 'button', onclick: startScanning }, ['Start scanning']),
        U.el('button', { class: 'btn', type: 'button', onclick: typeOne }, ['Type one'])
      ])
    ]));

    host.appendChild(U.el('div', { class: 'tiles', id: 'scan-tiles' }));

    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Scanned' }),
      U.el('div', { class: 'row', style: 'margin-left:auto;gap:8px' }, [
        U.el('input', {
          type: 'search', class: 'input', id: 'scan-filter', value: filter,
          placeholder: 'Filter', 'aria-label': 'Filter scanned IDs',
          style: 'width:auto;min-height:36px',
          oninput: U.debounce(function (e) { filter = e.target.value; paintList(); }, 200)
        }),
        U.el('button', { class: 'btn btn--primary', type: 'button', id: 'scan-upload', onclick: upload }, ['Upload']),
        U.el('button', { class: 'btn', type: 'button', onclick: clearUploaded }, ['Clear uploaded'])
      ])
    ]));
    panel.appendChild(U.el('div', { class: 'panel__body panel__body--flush', id: 'scan-list' }));
    host.appendChild(panel);

    paint();
  }

  function paint() { paintTiles(); paintList(); }

  function paintTiles() {
    var host = U.$('#scan-tiles');
    if (!host) return;
    U.clear(host);
    [
      ['Total scanned', state.items.length, 'Everything saved on this phone'],
      ['Waiting to upload', pending().length, 'Not yet in the spreadsheet'],
      ['Today', todayCount(), 'Scanned since midnight']
    ].forEach(function (t) {
      host.appendChild(U.el('div', { class: 'tile' }, [
        U.el('div', { class: 'tile__label', text: t[0] }),
        U.el('div', { class: 'tile__value', text: U.num(t[1]) }),
        U.el('div', { class: 'muted small', text: t[2] })
      ]));
    });

    var btn = U.$('#scan-upload');
    if (btn) {
      var n = pending().length;
      btn.textContent = n ? 'Upload ' + n : 'Upload';
      btn.disabled = !n;
    }
  }

  function paintList() {
    var host = U.$('#scan-list');
    if (!host) return;
    U.clear(host);

    var q = norm(filter);
    var rows = state.items.slice().reverse().filter(function (s) {
      return !q || norm(s.id).indexOf(q) > -1;
    });

    if (!rows.length) {
      U.empty(host,
        state.items.length ? 'Nothing matches that.' : 'No scans yet.',
        state.items.length ? 'Clear the filter to see the rest.' : 'Tap Start scanning and point the camera at a label.');
      return;
    }

    var table = U.el('table', { class: 'grid' });
    var head = U.el('thead', {}, [U.el('tr', {}, [
      U.el('th', { text: 'Tracking ID' }),
      U.el('th', { text: 'Scanned' }),
      U.el('th', { text: 'In sheet' }),
      U.el('th', { text: '' })
    ])]);
    var body = U.el('tbody');

    rows.slice(0, 500).forEach(function (s) {
      body.appendChild(U.el('tr', {}, [
        U.el('td', { 'data-label': 'Tracking ID' }, [U.el('b', { class: 'mono', text: s.id })]),
        U.el('td', { 'data-label': 'Scanned', text: when(s.at) }),
        U.el('td', { 'data-label': 'In sheet' }, [
          U.el('span', { class: 'badge ' + (s.up ? 'badge--ok' : ''), text: s.up ? 'Uploaded' : 'Waiting' })
        ]),
        U.el('td', { 'data-label': '' }, [
          U.el('button', {
            class: 'btn btn--sm', type: 'button',
            onclick: function () {
              U.confirm({
                title: 'Remove scan',
                message: s.id + ' — remove it from this list? It can be scanned again afterwards.',
                confirmLabel: 'Remove', danger: true
              }).then(function (yes) { if (yes) { remove(s.id); paint(); } });
            }
          }, ['Remove'])
        ])
      ]));
    });

    table.appendChild(head);
    table.appendChild(body);
    host.appendChild(U.el('div', { class: 'table-wrap' }, [table]));

    if (rows.length > 500) {
      host.appendChild(U.el('p', { class: 'muted small', style: 'padding:10px 14px',
        text: 'Showing the latest 500 of ' + U.num(rows.length) + '. Use the filter to find an older one.' }));
    }
  }

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var day = U.fmtDate(iso.slice(0, 10));
    var t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return day + ' ' + t;
  }

  /* --------------------------------------------------------- the overlay */

  /**
   * The scanning overlay. It carries .barcode-scanner-modal because on Android
   * the rest of the page is hidden while the camera preview sits behind it.
   */
  function buildOverlay() {
    var count = U.el('b', { id: 'scan-count', text: U.num(state.items.length) });
    var banner = U.el('div', { class: 'scan-banner', id: 'scan-banner', role: 'status', 'aria-live': 'assertive' });
    var video = U.el('video', { id: 'scan-video', class: 'scan-video hidden', playsinline: 'true', muted: 'true' });

    var overlay = U.el('div', { class: 'scan-overlay barcode-scanner-modal', id: 'scan-overlay' }, [
      video,
      U.el('div', { class: 'scan-top' }, [
        U.el('span', { class: 'scan-top__count' }, ['Saved: ', count]),
        U.el('button', {
          class: 'scan-x', type: 'button', 'aria-label': 'Close the scanner',
          onclick: stopScanning
        }, ['✕'])
      ]),
      U.el('div', { class: 'scan-frame' }, [U.el('span', { class: 'scan-line' })]),
      banner,
      U.el('div', { class: 'scan-bottom' }, [
        U.el('button', { class: 'btn scan-torch', type: 'button', id: 'scan-torch', onclick: toggleTorch }, ['Torch']),
        U.el('button', { class: 'btn btn--primary scan-stop', type: 'button', onclick: stopScanning }, ['Stop'])
      ])
    ]);

    document.body.appendChild(overlay);
    return overlay;
  }

  function say(kind, title, detail) {
    var banner = U.$('#scan-banner');
    if (!banner) return;
    banner.className = 'scan-banner is-' + kind;
    U.clear(banner);
    banner.appendChild(U.el('strong', { text: title }));
    if (detail) banner.appendChild(U.el('span', { text: detail }));
  }

  /* ------------------------------------------------------------ scanning */

  function handle(code) {
    if (!session) return;
    var now = Date.now();
    var id = String(code || '').trim();
    if (!id) return;

    // The same label sitting in front of the lens fires again and again.
    if (norm(id) === session.lastCode && now - session.lastAt < COOLDOWN_MS) return;
    session.lastCode = norm(id);
    session.lastAt = now;

    var result = record(id);
    if (result === 'saved') {
      feedback(true);
      say('ok', id, 'Saved');
      var c = U.$('#scan-count');
      if (c) c.textContent = U.num(state.items.length);
    } else if (result === 'duplicate') {
      feedback(false);
      say('bad', id, 'Already scanned — not saved again');
    } else if (result === 'full') {
      feedback(false);
      say('bad', 'Storage full', 'Upload the list and clear it');
    }
  }

  function startScanning() {
    if (session) return;
    if (!canScan()) {
      U.toast('This device cannot open a camera scanner. Use the app on the phone, or add the ID with Type one.', 'warn');
      return;
    }
    session = { lastCode: '', lastAt: 0, native: !!nativePlugin(), torch: false, stopped: false };
    buildOverlay();
    say('idle', 'Point the camera at a label', 'The scanner stays open for the next one');
    document.body.classList.add('scan-open');

    if (session.native) startNative();
    else startWeb();
  }

  function startNative() {
    var P = nativePlugin();
    Promise.resolve()
      .then(function () { return P.isSupported ? P.isSupported() : { supported: true }; })
      .then(function (s) {
        if (s && s.supported === false) throw new Error('__unsupported__');
        return P.checkPermissions ? P.checkPermissions() : null;
      })
      .then(function (p) {
        if (p && p.camera === 'granted') return p;
        return P.requestPermissions ? P.requestPermissions() : { camera: 'granted' };
      })
      .then(function (p) {
        if (p && p.camera && p.camera !== 'granted' && p.camera !== 'limited') throw new Error('__denied__');
        return P.addListener('barcodeScanned', function (result) {
          handle(result && result.barcode && (result.barcode.rawValue || result.barcode.displayValue));
        });
      })
      .then(function (h) {
        if (!session) { try { h.remove(); } catch (e) { } return; }
        session.listener = h;
        document.body.classList.add('barcode-scanner-active');
        return P.startScan();
      })
      .catch(function (e) {
        var code = (e && e.message) || '';
        stopScanning();
        if (code === '__denied__') {
          U.toast('Camera permission is off for this app. Open Settings → Apps → Return Desk → Permissions and allow Camera.', 'error');
        } else if (code === '__unsupported__') {
          U.toast('This phone cannot run the barcode scanner.', 'error');
        } else {
          U.toast('The scanner could not start. ' + (code || 'Try again in a moment.'), 'error');
        }
      });
  }

  function startWeb() {
    var Detector = webDetector();
    var video = U.$('#scan-video');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (stream) {
        if (!session) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        session.stream = stream;
        video.classList.remove('hidden');
        video.srcObject = stream;
        video.play();
        var detector = new Detector();
        session.tick = setInterval(function () {
          if (!session || video.readyState < 2) return;
          detector.detect(video).then(function (found) {
            if (found && found.length) handle(found[0].rawValue);
          }).catch(function () { });
        }, 350);
      })
      .catch(function (e) {
        stopScanning();
        U.toast('The camera could not be opened. ' + ((e && e.message) || ''), 'error');
      });
  }

  function stopScanning() {
    var s = session;
    session = null;
    document.body.classList.remove('scan-open');
    document.body.classList.remove('barcode-scanner-active');

    if (s) {
      if (s.tick) clearInterval(s.tick);
      if (s.stream) { try { s.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } }
      if (s.listener) { try { s.listener.remove(); } catch (e) { } }
      var P = nativePlugin();
      if (P) {
        try { P.removeAllListeners(); } catch (e) { }
        try { P.stopScan(); } catch (e) { }
      }
    }

    var overlay = U.$('#scan-overlay');
    if (overlay) overlay.remove();
    paint();
  }

  function toggleTorch() {
    if (!session) return;
    var P = nativePlugin();
    if (P && P.toggleTorch) {
      P.toggleTorch().catch(function () { U.toast('This phone has no torch the scanner can use.', 'warn'); });
      return;
    }
    if (session.stream) {
      var track = session.stream.getVideoTracks()[0];
      session.torch = !session.torch;
      try { track.applyConstraints({ advanced: [{ torch: session.torch }] }); }
      catch (e) { U.toast('This camera has no torch.', 'warn'); }
    }
  }

  /* -------------------------------------------------------- typed entry */

  function typeOne() {
    var input = U.el('input', { class: 'input', placeholder: 'Tracking ID', 'aria-label': 'Tracking ID' });
    var note = U.el('p', { class: 'muted small', text: 'Use this when a label will not scan.' });
    U.modal({
      title: 'Add a tracking ID',
      body: U.el('div', { class: 'field' }, [input, note]),
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Add', class: 'btn--primary',
          onClick: function (close) {
            var result = record(input.value);
            if (result === 'empty') { U.toast('Type an ID first.', 'warn'); return; }
            if (result === 'duplicate') { feedback(false); U.toast(input.value.trim() + ' has already been scanned.', 'error'); return; }
            feedback(true);
            close();
            paint();
          }
        }
      ]
    });
    setTimeout(function () { input.focus(); }, 50);
  }

  /* ------------------------------------------------------------- upload */

  function upload() {
    var queue = pending();
    if (!queue.length) { U.toast('Everything has already been uploaded.', 'warn'); return; }

    var btn = U.$('#scan-upload');
    U.busy(btn, true);

    var batch = queue.slice(0, UPLOAD_BATCH);
    API.call('saveScans', {
      scans: batch.map(function (s) { return { trackingId: s.id, scannedAt: s.at, scannedBy: s.by }; })
    }).then(function (data) {
      var taken = {};
      (data && data.stored ? data.stored : batch.map(function (s) { return s.id; }))
        .forEach(function (id) { taken[norm(id)] = true; });
      // Anything the sheet already held counts as done too: it is stored.
      ((data && data.duplicates) || []).forEach(function (id) { taken[norm(id)] = true; });

      state.items.forEach(function (s) { if (taken[norm(s.id)]) s.up = true; });
      persist();
      paint();

      var dupes = ((data && data.duplicates) || []).length;
      U.toast('Uploaded ' + (batch.length - dupes) + ' of ' + batch.length +
        (dupes ? ' — ' + dupes + ' were already in the sheet' : '') +
        (queue.length > batch.length ? '. ' + (queue.length - batch.length) + ' still waiting, press Upload again.' : ''));
    }).catch(function (err) {
      var m = String((err && err.message) || '');
      if (/unknown action|not reachable|ROUTES|NOT_FOUND/i.test(m) || (err && err.code === 'NOT_FOUND')) {
        U.toast('The spreadsheet side of scanning is not installed yet. Add Scans.gs to Apps Script and redeploy — the list here is safe in the meantime.', 'error');
      } else {
        U.toast(m || 'The upload failed. The list is still saved on this phone.', 'error');
      }
    }).then(function () { U.busy(btn, false); });
  }

  function clearUploaded() {
    var done = state.items.filter(function (s) { return s.up; });
    if (!done.length) { U.toast('Nothing has been uploaded yet.', 'warn'); return; }
    U.confirm({
      title: 'Clear uploaded scans',
      message: 'Remove ' + done.length + ' scans that are already in the spreadsheet? They will no longer be checked for duplicates on this phone.',
      confirmLabel: 'Clear', danger: true
    }).then(function (yes) {
      if (!yes) return;
      state.items = state.items.filter(function (s) { return !s.up; });
      state.index = {};
      state.items.forEach(function (s) { state.index[norm(s.id)] = true; });
      persist();
      paint();
      U.toast('Cleared ' + done.length + ' scans.');
    });
  }

  return { render: render, stop: stopScanning };
})();
