/**
 * api.js — the single channel between the browser and Apps Script.
 *
 * Requests are sent as POST with Content-Type text/plain so the browser
 * treats them as "simple" and skips the CORS preflight, which Apps Script
 * cannot answer. The body is still JSON.
 */
window.API = (function () {

  function url() {
    var u = window.APP_CONFIG.API_URL;
    if (!u || u.indexOf('PASTE_YOUR') === 0) {
      throw new Error('API URL is not set. Open js/config.js and paste your Apps Script Web App URL.');
    }
    return u;
  }

  function token() {
    var s = window.Auth && Auth.session();
    return s ? s.token : '';
  }

  /**
   * Calls one backend action.
   * Resolves with response.data, rejects with an Error carrying .code.
   */
  function call(action, payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, window.APP_CONFIG.TIMEOUT_MS);

    return fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: token(), payload: payload || {} }),
      redirect: 'follow',
      signal: controller.signal
    })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw wrap('The server returned ' + res.status + '. Check that the web app is deployed for "Anyone".', 'HTTP_' + res.status);
        return res.text();
      })
      .then(function (text) {
        var json;
        try { json = JSON.parse(text); }
        catch (e) {
          if (text.indexOf('<!DOCTYPE') > -1 || text.indexOf('Google Drive') > -1) {
            throw wrap('Apps Script asked for sign-in. Redeploy the web app with access set to "Anyone".', 'AUTH_WALL');
          }
          throw wrap('The server sent a response this app could not read.', 'BAD_RESPONSE');
        }
        if (!json.success) {
          if (json.errorCode === 'AUTH_REQUIRED') {
            if (window.Auth) Auth.expire(json.message);
          }
          throw wrap(json.message || 'Request failed.', json.errorCode || 'ERROR');
        }
        return json.data;
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (err && err.code) throw err;
        if (err && err.name === 'AbortError') throw wrap('The request took too long. Check your connection and try again.', 'TIMEOUT');
        throw wrap('Could not reach the server. Check your internet connection.', 'NETWORK');
      });
  }

  function wrap(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /** Login is the one call made without a token. */
  function login(username, password) {
    return fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'authenticateUser', payload: { username: username, password: password } }),
      redirect: 'follow'
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var json;
        try { json = JSON.parse(text); }
        catch (e) { throw wrap('Could not read the server response. Check the API URL and deployment access.', 'BAD_RESPONSE'); }
        if (!json.success) throw wrap(json.message, json.errorCode);
        return json.data;
      })
      .catch(function (err) {
        if (err && err.code) throw err;
        throw wrap('Could not reach the server. Check your internet connection and the API URL.', 'NETWORK');
      });
  }

  return { call: call, login: login };
})();
