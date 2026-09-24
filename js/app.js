/**
 * app.js — application shell: bootstrap, navigation, routing.
 *
 * Master data (products, sources, employees, statuses, settings) is loaded
 * once from the backend and kept in STATE. Nothing is hard-coded here.
 */

window.STATE = {
  settings: {},
  products: [],
  sources: [],
  employees: [],
  statuses: {},
  departments: [],
  permissions: { nav: [] },
  user: null,
  filters: { range: 'this_month', from: '', to: '' }
};

window.Views = {};

/**
 * The sections. `short` and `icon` are only used by the phone tab bar, where
 * the four or five sections people touch all day sit in reach of a thumb and
 * the rest stay one tap away under More.
 */
var NAV = [
  { key: 'dashboard', label: 'Dashboard', route: 'dashboard', short: 'Home', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
  { key: 'new-return', label: 'New return', route: 'new-return', short: 'New', icon: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 9v6M9 12h6"/>' },
  { key: 'scan', label: 'Scan tracking IDs', route: 'scan', short: 'Scan', icon: '<path d="M4 5.5v13M7.4 5.5v13M10.6 5.5v13M14 5.5v13M17.2 5.5v13M20 5.5v13"/>' },
  { key: 'returns', label: 'Returns', route: 'returns', short: 'Returns', icon: '<path d="M21 8.2 12 3.3 3 8.2v7.6l9 4.9 9-4.9z"/><path d="M3 8.2l9 4.9 9-4.9M12 13.1V21"/>' },
  { key: 'pending', label: 'Pending', route: 'pending', short: 'Pending', icon: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.3l3.2 2"/>' },
  { key: 'repair', label: 'Repair', route: 'repair', short: 'Repair', icon: '<path d="M20.3 5.6a4.8 4.8 0 0 1-6 6L7.6 18.3a2.2 2.2 0 1 1-3.1-3.1l6.7-6.7a4.8 4.8 0 0 1 6-6l-2.9 2.9 2.1 2.1z"/>' },
  { key: 'production', label: 'Production', route: 'production', short: 'Prod', icon: '<path d="M3 20.5V10l5.5 3.4V10L14 13.4V7l6.5 3.9v9.6z"/><path d="M3 20.5h18"/>' },
  { key: 'analytics', label: 'Analytics', route: 'analytics', short: 'Stats', icon: '<path d="M3.5 20.5h17"/><path d="M6.8 20.5v-6M12 20.5V5.5M17.2 20.5v-9"/>' },
  { key: 'reports', label: 'Reports', route: 'reports', short: 'Reports', icon: '<path d="M13.8 3H7.2A2.2 2.2 0 0 0 5 5.2v13.6A2.2 2.2 0 0 0 7.2 21h9.6a2.2 2.2 0 0 0 2.2-2.2V8.2z"/><path d="M13.8 3v5.2H19M9 13h6M9 17h4"/>' },
  { key: 'admin', label: 'Admin', route: 'admin', short: 'Admin', icon: '<path d="M12 3.2 19 6v6c0 4.1-2.9 7.2-7 9-4.1-1.8-7-4.9-7-9V6z"/><path d="M9.3 12.2l1.9 1.9 3.5-3.6"/>' }
];

/**
 * Sections that belong to the phone rather than the backend. The permission
 * list comes from the server and knows nothing about them, so they are added
 * here; scanning writes to this device and needs no server permission.
 */
var LOCAL_NAV = ['scan'];

var ICON_MORE = '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>';

/** Wraps icon path data in an SVG sized for the tab bar. */
function navIcon(paths) {
  return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    paths + '</svg>';
}

/** How many slots the phone tab bar has, More included. */
var TABS = 5;

window.App = (function () {

  /*
   * Master data is cached on the phone. Opening the app used to sit on a
   * skeleton until getBootstrap came back from Apps Script — two to four
   * seconds on every launch before a single button worked. Now the last copy
   * is drawn straight away and the fresh one replaces it when it lands. The
   * copy belongs to the session token, so another sign-in never sees it.
   */
  var BOOT_KEY = 'returndesk.bootstrap';
  var BOOT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

  function readBoot(token) {
    try {
      var c = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null');
      if (c && c.token === token && c.data && Date.now() - c.at < BOOT_MAX_AGE_MS) return c.data;
    } catch (e) { }
    return null;
  }

  function writeBoot(data) {
    var s = Auth.session();
    if (!s) return;
    try { localStorage.setItem(BOOT_KEY, JSON.stringify({ token: s.token, at: Date.now(), data: data })); } catch (e) { }
  }

  function applyBootstrap(data, first) {
    STATE.settings = data.settings || {};
    STATE.products = data.products || [];
    STATE.sources = data.sources || [];
    STATE.employees = data.employees || [];
    STATE.statuses = data.statuses || {};
    STATE.departments = data.departments || [];
    STATE.permissions = data.permissions || STATE.permissions;
    STATE.user = data.user || STATE.user;
    if (first) STATE.filters.range = STATE.settings.dashboardDefaultRange || 'this_month';
  }

  /** Stores fresh master data (from here or from Admin) and redraws the chrome. */
  function setBootstrap(data) {
    writeBoot(data);
    applyBootstrap(data, false);
    renderChrome();
    setActiveNav(currentKey());
  }

  function boot() {
    if (!Auth.requireSession()) return;
    var s = Auth.session();
    STATE.user = s.user;
    STATE.permissions = s.permissions || { nav: [] };
    STATE.filters.range = 'this_month';

    var started = false;
    function start() {
      if (started) return;
      started = true;
      renderChrome();
      window.addEventListener('hashchange', route);
      route();
    }

    var cached = readBoot(s.token);
    if (cached) {
      applyBootstrap(cached, true);
      start();
    } else {
      renderChrome();
      U.skeleton(U.$('#view'), 5);
    }

    API.call('getBootstrap', {}, { fresh: true }).then(function (data) {
      writeBoot(data);
      if (!started) {
        applyBootstrap(data, true);
        start();
        return;
      }
      var before = allowedNav().join(',');
      applyBootstrap(data, false);
      renderChrome();
      // Only redraw the screen if what this user may see has changed.
      if (allowedNav().join(',') !== before) route();
      else setActiveNav(currentKey());
    }).catch(function (err) {
      if (started) return;   // the cached copy is on screen and still usable
      U.clear(U.$('#view'));
      U.$('#view').appendChild(U.el('div', { class: 'panel' }, [
        U.el('div', { class: 'panel__body' }, [
          U.el('h2', { text: 'The app could not load its data' }),
          U.el('p', { class: 'muted', text: err.message }),
          U.el('button', { class: 'btn btn--primary', onclick: function () { location.reload(); } }, ['Try again'])
        ])
      ]));
    });
  }

  function currentKey() {
    var name = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
    return name === 'return' ? 'returns' : name;
  }

  /** The backend's list of sections, plus the ones this device owns. */
  function allowedNav() {
    var allowed = (STATE.permissions.nav || []).slice();
    LOCAL_NAV.forEach(function (k) { if (allowed.indexOf(k) === -1) allowed.push(k); });
    return allowed;
  }

  /* ------------------------------------------------------------- chrome */

  function renderChrome() {
    var rail = U.$('#rail-nav');
    U.clear(rail);
    var allowed = allowedNav();
    NAV.filter(function (n) { return allowed.indexOf(n.key) > -1; }).forEach(function (n) {
      rail.appendChild(U.el('a', {
        class: 'rail__link', href: '#/' + n.route, 'data-nav': n.key
      }, [n.label]));
    });

    var brand = U.$('#brand');
    U.clear(brand);
    brand.appendChild(U.el('strong', { text: STATE.settings.systemName || 'Return Desk' }));
    brand.appendChild(U.el('span', { text: STATE.settings.companyName || '' }));

    var who = U.$('#topbar-user');
    U.clear(who);
    if (STATE.user) {
      who.appendChild(U.el('b', { text: STATE.user.name }));
      who.appendChild(U.el('span', { text: roleLabel(STATE.user.role) }));
    }

    renderTabbar();
  }

  /**
   * The phone tab bar. Everything the user is allowed to see goes in, up to
   * the number of slots; if there are more sections than slots the last slot
   * becomes More, which opens the full list.
   */
  function renderTabbar() {
    var bar = U.$('#tabbar');
    if (!bar) return;
    U.clear(bar);

    var allowed = allowedNav();
    var items = NAV.filter(function (n) { return allowed.indexOf(n.key) > -1; });
    if (!items.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    var overflow = items.length > TABS;
    var shown = overflow ? items.slice(0, TABS - 1) : items;

    shown.forEach(function (n) {
      bar.appendChild(U.el('a', {
        class: 'tabbar__link',
        href: '#/' + n.route,
        'data-tab': n.key,
        html: navIcon(n.icon) + '<span class="tabbar__text">' + U.esc(n.short || n.label) + '</span>'
      }));
    });

    if (overflow) {
      bar.appendChild(U.el('button', {
        type: 'button',
        class: 'tabbar__link tabbar__more',
        'data-tab': '__more',
        'aria-label': 'More sections',
        html: navIcon(ICON_MORE) + '<span class="tabbar__text">More</span>',
        onclick: toggleRail
      }));
    }
  }

  function roleLabel(role) {
    return String(role || '').replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function setActiveNav(key) {
    U.$$('.rail__link').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === key);
    });

    // On the tab bar a section that lives under More lights up More instead.
    var tabs = U.$$('.tabbar__link');
    var onBar = tabs.some(function (t) { return t.getAttribute('data-tab') === key; });
    tabs.forEach(function (t) {
      var k = t.getAttribute('data-tab');
      t.classList.toggle('is-active', k === key || (!onBar && k === '__more'));
    });
  }

  /* -------------------------------------------------------------- router */

  function route() {
    var hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    var parts = hash.split('/');
    var name = parts[0];
    var arg = parts[1] ? decodeURIComponent(parts[1]) : null;

    if (name === 'return' && arg) {
      setActiveNav('returns');
      return Views.returns.detail(U.$('#view'), arg);
    }

    var allowed = allowedNav();
    if (allowed.indexOf(name) === -1) {
      name = allowed[0] || 'dashboard';
      location.hash = '#/' + name;
    }

    setActiveNav(name);
    closeRail();
    var host = U.$('#view');
    var view = Views[camel(name)];
    if (!view) { U.empty(host, 'That screen is not available.', 'Pick another section from the menu.'); return; }
    U.$('#topbar-title').textContent = (NAV.filter(function (n) { return n.key === name; })[0] || {}).label || '';
    view.render(host);
  }

  function camel(s) { return s.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }

  function go(route) { location.hash = '#/' + route; }

  /* --------------------------------------------------------- filter bar */

  /**
   * Builds the shared date filter. onChange fires whenever the period changes.
   * Every screen uses this so a period selected anywhere means the same thing.
   */
  function dateFilter(current, onChange) {
    var wrap = U.el('div', { class: 'row' });
    var select = U.el('select', { class: 'input', style: 'min-height:38px;width:auto', 'aria-label': 'Date range' });
    [
      ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'],
      ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'],
      ['last_30', 'Last 30 days'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom range']
    ].forEach(function (o) {
      select.appendChild(U.el('option', { value: o[0], selected: current.range === o[0] }, [o[1]]));
    });

    var from = U.el('input', { type: 'date', class: 'input', style: 'width:auto', value: current.from || '', 'aria-label': 'From date' });
    var to = U.el('input', { type: 'date', class: 'input', style: 'width:auto', value: current.to || '', 'aria-label': 'To date' });
    var customWrap = U.el('span', { class: 'row' + (current.range === 'custom' ? '' : ' hidden') }, [from, U.el('span', { class: 'muted small', text: 'to' }), to]);

    function emit() {
      current.range = select.value;
      current.from = from.value;
      current.to = to.value;
      customWrap.classList.toggle('hidden', select.value !== 'custom');
      if (select.value === 'custom' && (!from.value || !to.value)) return;
      onChange(current);
    }
    select.addEventListener('change', emit);
    from.addEventListener('change', emit);
    to.addEventListener('change', emit);

    wrap.appendChild(select);
    wrap.appendChild(customWrap);
    return wrap;
  }

  function filterPayload(extra) {
    var p = {
      range: STATE.filters.range,
      from: STATE.filters.from,
      to: STATE.filters.to
    };
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== '' && extra[k] !== null && extra[k] !== undefined) p[k] = extra[k];
    });
    return p;
  }

  /* -------------------------------------------------------- global search */

  function wireSearch() {
    var input = U.$('#global-search');
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = input.value.trim();
      if (!q) return;
      Views.returns.searchModal(q);
    });
  }

  /* ------------------------------------------------------------- drawer */

  function toggleRail() {
    var rail = U.$('#rail');
    var open = rail.classList.toggle('is-open');
    var scrim = U.$('#rail-scrim');
    if (open && !scrim) {
      scrim = U.el('div', { class: 'rail-scrim', id: 'rail-scrim', onclick: closeRail });
      document.body.appendChild(scrim);
    } else if (!open && scrim) scrim.remove();
  }

  function closeRail() {
    var rail = U.$('#rail');
    if (rail) rail.classList.remove('is-open');
    var scrim = U.$('#rail-scrim');
    if (scrim) scrim.remove();
  }

  /* --------------------------------------------------------- export util */

  function exportCurrent(dataset, extraFilters, button) {
    if (!STATE.settings.featureExport) { U.toast('Export is switched off in settings.', 'warn'); return; }
    U.busy(button, true);
    API.call('exportData', filterPayload(extraFilters || {})).then(function (data) {
      U.downloadCsv(data.filename, data.csv);
      U.toast('Exported ' + data.rowCount + ' rows');
    }).catch(function (e) {
      U.toast(e.message, 'error');
    }).then(function () { U.busy(button, false); });
  }

  function exportButton(dataset, extraFilters) {
    if (!STATE.settings.featureExport || !Auth.can('canExport')) return null;
    return U.el('button', {
      class: 'btn', type: 'button',
      onclick: function (e) {
        var f = Object.assign({ dataset: dataset }, extraFilters || {});
        exportCurrent(dataset, f, e.currentTarget);
      }
    }, ['Export CSV']);
  }

  /* --------------------------------------------------------------- init */

  document.addEventListener('DOMContentLoaded', function () {
    U.$('#menu-btn').addEventListener('click', toggleRail);
    U.$('#signout').addEventListener('click', function () {
      U.confirm({ title: 'Sign out', message: 'End this session and return to the sign-in screen?', confirmLabel: 'Sign out' })
        .then(function (yes) { if (yes) Auth.signOut(); });
    });
    wireSearch();
    boot();
  });

  return {
    route: route, go: go, dateFilter: dateFilter, filterPayload: filterPayload,
    exportButton: exportButton, exportCurrent: exportCurrent, roleLabel: roleLabel,
    setActiveNav: setActiveNav, closeRail: closeRail, setBootstrap: setBootstrap
  };
})();
