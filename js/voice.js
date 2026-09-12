/**
 * voice.js — dictation for text fields.
 *
 * Uses the browser's own speech recognition, so nothing is sent to a server of
 * ours and there is no key to manage. Support is uneven: Chrome and Edge have
 * it, Firefox and iOS Safari do not, and an Android WebView does not either.
 * Where it is missing the microphone button simply never appears, and the field
 * behaves exactly as it always did.
 */
window.Voice = (function () {

  var Engine = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var active = null; // only one microphone at a time

  /** The engine exists in this browser at all. */
  function available() { return !!Engine; }

  /**
   * Recognition needs a secure context. `isSecureContext` is the right test:
   * checking for https alone wrongly excludes localhost and a file:// page
   * opened straight from disk, both of which Chrome treats as secure.
   */
  function secure() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return location.protocol === 'https:' || location.hostname === 'localhost';
  }

  function supported() { return available() && secure(); }

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
   * Returns null when the browser cannot do this, so callers can skip the UI.
   */
  function button(opts) {
    // No engine at all means no button: offering one that can never work is
    // worse than the field simply being a field.
    if (!available()) return null;

    var usable = secure();
    var btn = U.el('button', {
      type: 'button',
      class: 'mic' + (usable ? '' : ' is-blocked'),
      'aria-label': opts.label || 'Dictate',
      title: usable ? (opts.label || 'Dictate') : 'Dictation needs a secure page',
      html: MIC
    });

    btn.addEventListener('click', function () {
      if (!usable) {
        U.toast('Dictation needs a secure page. It works on your published https site, ' +
          'but not over plain http.', 'warn');
        return;
      }
      if (btn.classList.contains('is-listening')) { stop(); return; }
      start(btn, opts);
    });

    return btn;
  }

  function start(btn, opts) {
    stop(); // whatever was listening, stop it first

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
        'not-allowed': 'Microphone access was blocked. Allow it in the browser address bar, then try again.',
        'service-not-allowed': 'Microphone access was blocked for this site.',
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
