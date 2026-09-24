/**
 * auth.js — session handling on the browser side.
 * The token is the only credential stored; passwords never touch storage.
 * Permissions kept here are for showing and hiding UI. The backend enforces
 * the real rules on every call.
 */
window.Auth = (function () {

  function read() {
    try {
      var raw = localStorage.getItem(window.APP_CONFIG.STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.token || !s.expiresAt) return null;
      if (new Date(s.expiresAt.replace(' ', 'T')) < new Date()) { clear(); return null; }
      return s;
    } catch (e) { return null; }
  }

  function save(data) {
    localStorage.setItem(window.APP_CONFIG.STORE_KEY, JSON.stringify({
      token: data.token,
      expiresAt: data.expiresAt,
      user: data.user,
      permissions: data.permissions
    }));
  }

  function clear() {
    localStorage.removeItem(window.APP_CONFIG.STORE_KEY);
    try { localStorage.removeItem('returndesk.bootstrap'); } catch (e) { }
    if (window.API && API.forget) API.forget();
  }

  function session() { return read(); }
  function user() { var s = read(); return s ? s.user : null; }
  function permissions() { var s = read(); return s ? s.permissions : { nav: [] }; }
  function can(key) { return !!(permissions() || {})[key]; }

  function signIn(username, password) {
    return API.login(username, password).then(function (data) {
      save(data);
      return data;
    });
  }

  function signOut() {
    var s = read();
    var done = function () { clear(); location.href = window.APP_CONFIG.LOGIN_PAGE; };
    if (!s) return done();
    API.call('logoutUser', { token: s.token }).then(done).catch(done);
  }

  /** Called when the backend reports the session is gone. */
  function expire(message) {
    clear();
    try { sessionStorage.setItem('returndesk.notice', message || 'Your session has ended. Sign in again.'); } catch (e) { }
    if (location.pathname.indexOf(window.APP_CONFIG.LOGIN_PAGE) === -1) {
      location.href = window.APP_CONFIG.LOGIN_PAGE;
    }
  }

  /** Guards the app page. Returns false if it redirected. */
  function requireSession() {
    if (read()) return true;
    location.href = window.APP_CONFIG.LOGIN_PAGE;
    return false;
  }

  return {
    session: session, user: user, permissions: permissions, can: can,
    signIn: signIn, signOut: signOut, expire: expire, requireSession: requireSession, clear: clear
  };
})();
