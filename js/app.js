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

var NAV = [
  { key: 'dashboard', label: 'Dashboard', route: 'dashboard' },
  { key: 'new-return', label: 'New return', route: 'new-return' },
  { key: 'returns', label: 'Returns', route: 'returns' },
  { key: 'pending', label: 'Pending', route: 'pending' },
  { key: 'repair', label: 'Repair', route: 'repair' },
  { key: 'production', label: 'Production', route: 'production' },
  { key: 'analytics', label: 'Analytics', route: 'analytics' },
  { key: 'reports', label: 'Reports', route: 'reports' },
  { key: 'admin', label: 'Admin', route: 'admin' }
];

window.App = (function () {

  function boot() {
    if (!Auth.requireSession()) return;
    var s = Auth.session();
    STATE.user = s.user;
    STATE.permissions = s.permissions || { nav: [] };
    STATE.filters.range = 'this_month';

    renderChrome();
    U.skeleton(U.$('#view'), 5);

    API.call('getBootstrap', {}).then(function (data) {
      STATE.settings = data.settings || {};
      STATE.products = data.products || [];
      STATE.sources = data.sources || [];
      STATE.employees = data.employees || [];
      STATE.statuses = data.statuses || {};
      STATE.departments = data.departments || [];
      STATE.permissions = data.permissions || STATE.permissions;
      STATE.user = data.user || STATE.user;
      STATE.filters.range = STATE.settings.dashboardDefaultRange || 'this_month';

      renderChrome();
      window.addEventListener('hashchange', route);
      route();
    }).catch(function (err) {
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

  /* ------------------------------------------------------------- chrome */

  function renderChrome() {
    var rail = U.$('#rail-nav');
    U.clear(rail);
    var allowed = STATE.permissions.nav || [];
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
  }

  function roleLabel(role) {
    return String(role || '').replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function setActiveNav(key) {
    U.$$('.rail__link').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === key);
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

    var allowed = STATE.permissions.nav || [];
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
    setActiveNav: setActiveNav, closeRail: closeRail
  };
})();
