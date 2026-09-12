/**
 * config.js — the only file you edit after deploying the backend.
 * No secret belongs here: this file is public on GitHub Pages.
 */
window.APP_CONFIG = {
  // Paste the Apps Script Web App /exec URL from Deploy > New deployment.
  API_URL: 'https://script.google.com/macros/s/AKfycbxM41CRG_7KZDzFfhVkrpRxw6AkH9Gh154KdVb51fG1p72A2342h4tzrzhRx7ObkMra9g/exec',

  // Where the login page lives, relative to app.html.
  LOGIN_PAGE: 'index.html',
  APP_PAGE: 'app.html',

  // Local storage keys.
  STORE_KEY: 'returndesk.session',

  // Client-side request timeout in milliseconds.
  TIMEOUT_MS: 45000
};
