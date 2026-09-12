/**
 * voice.js — dictation for text fields.
 *
 * Two engines, picked automatically:
 *
 *   Browser  — the Web Speech API (Chrome and Edge). Nothing is sent to a
 *              server of ours and there is no key to manage.
 *   Android  — the packaged app runs inside a WebView, and a WebView has no
 *              Web Speech API even though `webkitSpeechRecognition` appears to
 *              exist; every attempt ends in "not-allowed". So inside the APK we
 *              talk to Android's own recogniser through the Capacitor
 *              SpeechRecognition plugin instead, and ask for the microphone
 *              permission the proper way.
 *
 * Where neither engine exists the microphone button simply never appears and
 * the field behaves exactly as it always did.
 */
window.Voice = (function () {

  var Engine = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var active = null;        // web engine currently listening
  var nativeSession = null; // native session currently listening

  /* ------------------------------------------------------------- engines */

  /** The Capacitor bridge, but only when we are really running natively. */
  function bridge() {
    var C = window.Capacitor;
    if (!C) return null;
    var isNative = typeof C.isNativePlatform === 'function' ? C.isNativePlatform() : !!C.isNative;
    return isNative ? C : null;
  }

  /** The native plugin handle, looked up once and remembered. */
  var nativePlugin = (function () {
    var found, looked = false;
    return function () {
      if (looked) return found;
      looked = true;
      var C = bridge();
      if (!C) return (found = null);
      try {
        found = typeof C.registerPlugin === 'function'
          ? C.registerPlugin('SpeechRecognition')
          : (C.Plugins || {}).SpeechRecognition || null;
      } catch (e) { found = null; }
      if (found && typeof found.start !== 'function') found = null;
      return found;
    };
  })();

  function available() { return !!Engine || !!nativePlugin(); }

  /**
   * The web engine needs a secure context. `isSecureContext` is the right test:
   * checking for https alone wrongly excludes localhost and a file:// page
   * opened straight from disk, both of which Chrome treats as secure. The
   * native engine does not care, so this only gates the web path.
   */
  function secure() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return location.protocol === 'https:' || location.hostname === 'localhost';
  }

  function supported() { return !!nativePlugin() || (!!Engine && secure()); }

  function language() {
    return (window.STATE && STATE.settings && STATE.settings.voiceLanguage) ||
      navigator.language || 'en-IN';
  }

  var MIC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<rect x="9" y="3" width="6" height="11" rx="3"></rect>' +
    '<path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>';

  /**
   * Builds a microphone button.
   * opts: { onText(finalText), onInterim(text), label }
   * Returns null when the device cannot do this, so callers can skip the UI.
   */
  function button(opts) {
    if (!available()) return null;

    var usable = !!nativePlugin() || secure();
    var btn = U.el('button', {
      type: 'button',
      class: 'mic' + (usable ? '' : ' is-blocked'),
      'aria-label': opts.label || 'Dictate',
      title: usable ? (opts.label || 'Dictate') : 'Dictation needs a secure page',
      html: MIC
    });

    btn.addEventListener('click', function () {
      if (btn.classList.contains('is-listening')) { stop(); return; }
      if (!usable) {
        U.toast('Dictation needs a secure page. It works on your published https site, ' +
          'but not over plain http.', 'warn');
        return;
      }
      if (nativePlugin()) startNative(btn, opts);
      else start(btn, opts);
    });

    return btn;
  }

  /* -------------------------------------------------------- native engine */

  /**
   * Android's recogniser, through the Capacitor plugin.
   *
   * With partialResults on, `start()` resolves straight away and the words
   * arrive as `partialResults` events; the final pass arrives the same way and
   * is then followed by a `listeningState` of "stopped". So we keep the latest
   * text we heard and hand it over once listening ends.
   */
  function startNative(btn, opts) {
    stop();

    var P = nativePlugin();
    var heard = '';
    var done = false;
    var handles = [];
    var timer = null;
    var session = {};

    btn.classList.add('is-listening');
    btn.setAttribute('aria-label', 'Listening. Tap to stop.');
    var hint = showHint(btn, 'Listening…');

    session.stop = function () {
      try { P.stop(); } catch (e) { }
      setTimeout(function () { finish(); }, 300);
    };
    nativeSession = session;

    function keep(data) {
      var text = data && data.matches && data.matches[0];
      if (!text) return;
      heard = text;
      if (opts.onInterim) opts.onInterim(text);
      if (hint) hint.textContent = text;
    }

    function cleanup() {
      btn.classList.remove('is-listening');
      btn.setAttribute('aria-label', opts.label || 'Dictate');
      if (hint) { hint.remove(); hint = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      handles.forEach(function (h) { try { if (h && h.remove) h.remove(); } catch (e) { } });
      handles = [];
      try { P.removeAllListeners(); } catch (e) { }
      if (nativeSession === session) nativeSession = null;
    }

    /** Ends the session. A message means something went wrong; say that instead. */
    function finish(message, tone) {
      if (done) return;
      done = true;
      cleanup();
      if (message) { U.toast(message, tone || 'error'); return; }
      var text = heard.trim();
      if (text) opts.onText(text);
      else U.toast('Nothing was picked up. Try again, or type the name.', 'warn');
    }

    Promise.resolve()
      .then(function () { return P.available ? P.available() : { available: true }; })
      .then(function (a) {
        if (a && a.available === false) throw new Error('__unavailable__');
        return P.checkPermissions ? P.checkPermissions() : null;
      })
      .then(function (state) {
        if (state && state.speechRecognition === 'granted') return state;
        return P.requestPermissions ? P.requestPermissions() : { speechRecognition: 'granted' };
      })
      .then(function (state) {
        if (state && state.speechRecognition && state.speechRecognition !== 'granted') {
          throw new Error('__denied__');
        }
        return Promise.all([
          P.addListener('partialResults', keep),
          P.addListener('listeningState', function (s) {
            if (s && s.status === 'stopped') setTimeout(function () { finish(); }, 300);
          })
        ]);
      })
      .then(function (hs) {
        handles = hs || [];
        if (done) return null;
        // A safety net: if the recogniser never reports back, close the session.
        timer = setTimeout(function () { try { P.stop(); } catch (e) { } }, 15000);
        return P.start({
          language: language(),
          maxResults: 3,
          partialResults: true,
          popup: false
        });
      })
      .then(function (res) {
        // Only reached when the plugin returns the matches directly.
        if (res && res.matches && res.matches.length) { keep(res); finish(); }
      })
      .catch(function (e) {
        var code = (e && e.message) || '';
        if (code === '__denied__') {
          finish('Microphone permission is off for this app. Open Settings → Apps → ' +
            'Return Desk → Permissions and allow Microphone.', 'error');
        } else if (code === '__unavailable__') {
          finish('This phone has no speech recognition service installed. Type the name instead.', 'warn');
        } else if (/no match|didn.t catch/i.test(code)) {
          finish('Nothing was picked up. Try again, a little closer to the microphone.', 'warn');
        } else {
          finish('Dictation could not start. ' + (code || 'Try again in a moment.'), 'error');
        }
      });
  }

  /* ----------------------------------------------------------- web engine */

  function start(btn, opts) {
    stop();

    var rec = new Engine();
    rec.lang = language();
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.continuous = false;

    var finalText = '';
    var settled = false;

    btn.classList.add('is-listening');
    btn.setAttribute('aria-label', 'Listening. Tap to stop.');
    var hint = showHint(btn, 'Listening…');

    rec.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim && opts.onInterim) opts.onInterim(interim);
      if (hint) hint.textContent = (finalText + interim).trim() || 'Listening…';
    };

    rec.onerror = function (event) {
      settled = true;
      finish();
      var messages = {
        'not-allowed': 'Microphone access was blocked. Allow the microphone for this app, then try again.',
        'service-not-allowed': 'Microphone access was blocked for this app.',
        'no-speech': 'Nothing was picked up. Try again, a little closer to the microphone.',
        'audio-capture': 'No microphone was found on this device.',
        'network': 'Speech recognition needs a connection and could not reach the service.',
        'aborted': ''
      };
      var message = messages[event.error];
      if (message === undefined) message = 'Dictation stopped unexpectedly. Type the name instead.';
      if (message) U.toast(message, 'error');
    };

    rec.onend = function () {
      finish();
      if (settled) return;
      settled = true;
      var text = finalText.trim();
      if (text) opts.onText(text);
      else U.toast('Nothing was picked up. Try again, or type the name.', 'warn');
    };

    function finish() {
      btn.classList.remove('is-listening');
      btn.setAttribute('aria-label', opts.label || 'Dictate');
      if (hint) { hint.remove(); hint = null; }
      if (active === rec) active = null;
    }

    try {
      rec.start();
      active = rec;
    } catch (e) {
      finish();
      U.toast('Dictation could not start. Try again in a moment.', 'error');
    }
  }

  function stop() {
    if (nativeSession) {
      var s = nativeSession;
      nativeSession = null;
      s.stop();
      return;
    }
    if (!active) return;
    try { active.abort(); } catch (e) { }
    active = null;
  }

  /** A small live region under the field showing what is being heard. */
  function showHint(btn, text) {
    var field = btn.closest('.field') || btn.parentElement;
    if (!field) return null;
    var hint = U.el('div', { class: 'mic-hint', role: 'status', 'aria-live': 'polite', text: text });
    field.appendChild(hint);
    return hint;
  }

  /**
   * Cleans up dictated text for matching against product names and SKUs.
   * People say "oak dc zero zero one" for OAK-DC-001, so the comparison drops
   * everything that is not a letter or a digit on both sides.
   */
  function normalise(text) {
    var spoken = {
      zero: '0', one: '1', two: '2', three: '3', four: '4',
      five: '5', six: '6', seven: '7', eight: '8', nine: '9',
      dash: '', hyphen: '', 'double': ''
    };
    return String(text || '')
      .toLowerCase()
      .split(/\s+/)
      .map(function (word) {
        var clean = word.replace(/[^a-z0-9]/g, '');
        return spoken[clean] !== undefined ? spoken[clean] : clean;
      })
      .join(' ')
      .trim();
  }

  /** Strips everything but letters and digits, for SKU comparison. */
  function squash(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  return { supported: supported, button: button, stop: stop, normalise: normalise, squash: squash };
})();
