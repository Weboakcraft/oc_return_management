/**
 * config.js — the only file you edit after deploying the backend.
 * No secret belongs here: this file is public on GitHub Pages.
 */
window.APP_CONFIG = {
  // Paste the Apps Script Web App /exec URL from Deploy > New deployment.
  API_URL: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',

  // Where the login page lives, relative to app.html.
  LOGIN_PAGE: 'index.html',
  APP_PAGE: 'app.html',

  // Local storage keys.
  STORE_KEY: 'returndesk.session',

  // Client-side request timeout in milliseconds.
  TIMEOUT_MS: 45000
};
