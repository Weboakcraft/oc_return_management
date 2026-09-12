/**
 * admin.js — master data and system administration.
 * Deactivation is used instead of deletion everywhere, so history stays
 * readable and old returns keep pointing at something real.
 */
Views.admin = (function () {

  var tab = 'users';

  var TABS = [
    ['users', 'Users'], ['products', 'Products'], ['sources', 'Sources'],
    ['statuses', 'Statuses'], ['departments', 'Departments'],
    ['settings', 'Settings'], ['quality', 'Data quality'], ['audit', 'Audit log']
  ];

  function render(host) {
    U.clear(host);
    if (!Auth.can('canAdmin')) {
      U.empty(host, 'Administrator access only.', 'Ask an administrator if you need access to this section.');
      return;
    }

    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Administration' }),
        U.el('p', { text: 'Everything the app offers staff is configured here.' })
      ]),
      U.el('div', { class: 'view__actions', id: 'admin-actions' })
    ]));

    var panel = U.el('div', { class: 'panel' });
    var tabs = U.el('div', { class: 'tabs' });
    TABS.forEach(function (t) {
      tabs.appendChild(U.el('button', {
        class: tab === t[0] ? 'is-active' : '',
        onclick: function (e) {
          tab = t[0];
          U.$$('button', tabs).forEach(function (b) { b.classList.toggle('is-active', b === e.currentTarget); });
          load();
        }
      }, [t[1]]));
    });
    panel.appendChild(tabs);
    panel.appendChild(U.el('div', { id: 'admin-body', class: 'panel__body panel__body--flush' }));
    host.appendChild(panel);
    load();
  }

  function refreshMasters() {
    return API.call('getBootstrap', {}).then(function (data) {
      STATE.products = data.products;
      STATE.sources = data.sources;
      STATE.employees = data.employees;
      STATE.statuses = data.statuses;
      STATE.departments = data.departments;
      STATE.settings = data.settings;
    });
  }

  function load() {
    var body = U.$('#admin-body');
    var actions = U.$('#admin-actions');
    U.clear(actions);
    U.skeleton(body, 4);

    if (tab === 'users') return loadUsers(body, actions);
    if (tab === 'products') return loadProducts(body, actions);
    if (tab === 'sources') return loadSources(body, actions);
    if (tab === 'statuses') return loadStatuses(body, actions);
    if (tab === 'departments') return loadDepartments(body, actions);
    if (tab === 'settings') return loadSettings(body);
    if (tab === 'quality') return loadQuality(body);
    return loadAudit(body, actions);
  }

  /* --------------------------------------------------------------- users */

  function loadUsers(body, actions) {
    actions.appendChild(U.el('button', { class: 'btn btn--primary', onclick: function () { userForm(null); } }, ['Add user']));
    API.call('getEmployees', { includeInactive: true }).then(function (d) {
      U.clear(body);
      body.appendChild(table(
        ['Name', 'Username', 'Department', 'Role', 'Last sign-in', 'Status', ''],
        d.rows.map(function (r) {
          return [
            r.name, mono(r.username), r.department || '—', App.roleLabel(r.role),
            r.lastLogin ? r.lastLogin.substring(0, 16) : 'Never',
            badge(r.active),
            U.el('button', { class: 'btn btn--sm', onclick: function () { userForm(r, d.roles); } }, ['Edit'])
          ];
        })
      ));
    }).catch(function (e) { U.empty(body, 'Could not load users', e.message); });
  }

  function userForm(user, roles) {
    var f = {};
    var body = U.el('div');
    f.name = textField(body, 'Full name', user ? user.name : '');
    f.username = textField(body, 'Username', user ? user.username : '');
    f.department = selectField(body, 'Department', STATE.departments.map(function (d) { return [d.name, d.name]; }), user ? user.department : '');
    f.role = selectField(body, 'Role', (roles || ['ADMIN', 'RETURN_OPERATOR', 'REPAIR_TEAM', 'PRODUCTION', 'MANAGEMENT']).map(function (r) {
      return [r, App.roleLabel(r)];
    }), user ? user.role : '');
    f.password = textField(body, user ? 'New password (leave blank to keep the current one)' : 'Password', '', 'password');
    body.appendChild(U.el('p', { class: 'hint', text: 'Passwords are hashed on the server with a per-user salt. Nobody, including an administrator, can read them back.' }));

    var activeWrap = U.el('div', { class: 'field' });
    var active = U.el('input', { type: 'checkbox', checked: user ? user.active : true, style: 'width:auto;min-height:auto' });
    activeWrap.appendChild(U.el('label', { class: 'row', style: 'font-weight:400' }, [active, U.el('span', { text: 'Account is active' })]));
    body.appendChild(activeWrap);

    U.modal({
      title: user ? 'Edit ' + user.name : 'Add user',
      body: body,
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Save user', class: 'btn--primary', onClick: function (close, button) {
            var payload = {
              employeeId: user ? user.employeeId : '',
              name: f.name.value.trim(), username: f.username.value.trim(),
              department: f.department.value, role: f.role.value, active: active.checked
            };
            if (f.password.value) payload.password = f.password.value;
            save('saveEmployee', payload, close, button);
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ products */

  function loadProducts(body, actions) {
    actions.appendChild(U.el('button', { class: 'btn btn--primary', onclick: function () { productForm(null); } }, ['Add product']));
    API.call('getProducts', { includeInactive: true }).then(function (d) {
      U.clear(body);
      var search = U.el('input', { type: 'search', placeholder: 'Filter by name or SKU', 'aria-label': 'Filter products' });
      body.appendChild(U.el('div', { class: 'panel__body', style: 'padding:12px 16px' }, [search]));
      var holder = U.el('div');
      body.appendChild(holder);

      function paint(term) {
        U.clear(holder);
        var t = (term || '').toLowerCase();
        var rows = d.rows.filter(function (r) {
          return !t || r.name.toLowerCase().indexOf(t) > -1 || String(r.sku).toLowerCase().indexOf(t) > -1;
        });
        if (!rows.length) { U.empty(holder, 'No product matches that.', ''); return; }
        holder.appendChild(table(
          ['Product', 'SKU', 'Category', 'Sub category', 'Status', ''],
          rows.map(function (r) {
            return [
              r.name, mono(r.sku), r.category || '—', r.subCategory || '—', badge(r.active),
              U.el('button', { class: 'btn btn--sm', onclick: function () { productForm(r); } }, ['Edit'])
            ];
          })
        ));
      }
      search.addEventListener('input', U.debounce(function () { paint(search.value); }, 200));
      paint('');
    }).catch(function (e) { U.empty(body, 'Could not load products', e.message); });
  }

  function productForm(product) {
    var body = U.el('div');
    var name = textField(body, 'Product name', product ? product.name : '');
    var sku = textField(body, 'SKU', product ? product.sku : '');
    var category = textField(body, 'Category', product ? product.category : '');
    var sub = textField(body, 'Sub category', product ? product.subCategory : '');
    var image = textField(body, 'Image URL (optional)', product ? product.imageUrl : '');
    var activeWrap = U.el('div', { class: 'field' });
    var active = U.el('input', { type: 'checkbox', checked: product ? product.active : true, style: 'width:auto;min-height:auto' });
    activeWrap.appendChild(U.el('label', { class: 'row', style: 'font-weight:400' }, [active, U.el('span', { text: 'Available for new returns' })]));
    body.appendChild(activeWrap);

    U.modal({
      title: product ? 'Edit ' + product.name : 'Add product',
      body: body,
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Save product', class: 'btn--primary', onClick: function (close, button) {
            save('saveProduct', {
              productId: product ? product.productId : '',
              name: name.value.trim(), sku: sku.value.trim(),
              category: category.value.trim(), subCategory: sub.value.trim(),
              imageUrl: image.value.trim(), active: active.checked
            }, close, button);
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------- sources */

  function loadSources(body, actions) {
    actions.appendChild(U.el('button', { class: 'btn btn--primary', onclick: function () { sourceForm(null); } }, ['Add source']));
    API.call('getSources', { includeInactive: true }).then(function (d) {
      U.clear(body);
      body.appendChild(U.el('p', { class: 'small muted', style: 'padding:14px 16px 0',
        text: 'Renaming a source updates every past return so reports stay consistent.' }));
      body.appendChild(table(
        ['Source', 'Order', 'Status', ''],
        d.rows.map(function (r) {
          return [
            r.name, r.sortOrder, badge(r.active),
            U.el('button', { class: 'btn btn--sm', onclick: function () { sourceForm(r); } }, ['Edit'])
          ];
        })
      ));
    }).catch(function (e) { U.empty(body, 'Could not load sources', e.message); });
  }

  function sourceForm(source) {
    var body = U.el('div');
    var name = textField(body, 'Source name', source ? source.name : '');
    var order = textField(body, 'Sort order', source ? source.sortOrder : '', 'number');
    var activeWrap = U.el('div', { class: 'field' });
    var active = U.el('input', { type: 'checkbox', checked: source ? source.active : true, style: 'width:auto;min-height:auto' });
    activeWrap.appendChild(U.el('label', { class: 'row', style: 'font-weight:400' }, [active, U.el('span', { text: 'Offered on the return form' })]));
    body.appendChild(activeWrap);

    U.modal({
      title: source ? 'Edit ' + source.name : 'Add source',
      body: body,
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Save source', class: 'btn--primary', onClick: function (close, button) {
            save('saveSource', {
              sourceId: source ? source.sourceId : '', name: name.value.trim(),
              sortOrder: Number(order.value || 0), active: active.checked
            }, close, button);
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ statuses */

  function loadStatuses(body, actions) {
    actions.appendChild(U.el('button', { class: 'btn btn--primary', onclick: function () { statusForm(null); } }, ['Add status']));
    API.call('getStatuses', { includeInactive: true }).then(function (d) {
      U.clear(body);
      body.appendChild(U.el('p', { class: 'small muted', style: 'padding:14px 16px 0',
        text: 'Statuses that drive the workflow can be reordered or hidden, but not renamed.' }));
      var rows = [];
      Object.keys(d.groups).forEach(function (group) {
        d.groups[group].forEach(function (s) {
          rows.push([
            group, s.name, s.sortOrder, badge(s.active),
            U.el('button', {
              class: 'btn btn--sm',
              onclick: function () { statusForm({ statusId: s.statusId, group: group, name: s.name, sortOrder: s.sortOrder, active: s.active }); }
            }, ['Edit'])
          ]);
        });
      });
      body.appendChild(table(['Group', 'Status', 'Order', 'Active', ''], rows));
    }).catch(function (e) { U.empty(body, 'Could not load statuses', e.message); });
  }

  function statusForm(status) {
    var body = U.el('div');
    var group = textField(body, 'Group', status ? status.group : '');
    var name = textField(body, 'Status name', status ? status.name : '');
    var order = textField(body, 'Sort order', status ? status.sortOrder : '', 'number');
    var activeWrap = U.el('div', { class: 'field' });
    var active = U.el('input', { type: 'checkbox', checked: status ? status.active : true, style: 'width:auto;min-height:auto' });
    activeWrap.appendChild(U.el('label', { class: 'row', style: 'font-weight:400' }, [active, U.el('span', { text: 'In use' })]));
    body.appendChild(activeWrap);

    U.modal({
      title: status ? 'Edit status' : 'Add status',
      body: body,
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Save status', class: 'btn--primary', onClick: function (close, button) {
            save('saveStatus', {
              statusId: status ? status.statusId : '', group: group.value.trim(),
              name: name.value.trim(), sortOrder: Number(order.value || 0), active: active.checked
            }, close, button);
          }
        }
      ]
    });
  }

  /* --------------------------------------------------------- departments */

  function loadDepartments(body, actions) {
    actions.appendChild(U.el('button', { class: 'btn btn--primary', onclick: function () { departmentForm(null); } }, ['Add department']));
    API.call('getDepartments', { includeInactive: true }).then(function (d) {
      U.clear(body);
      body.appendChild(table(
        ['Department', 'Status', ''],
        d.rows.map(function (r) {
          return [r.name, badge(r.active), U.el('button', { class: 'btn btn--sm', onclick: function () { departmentForm(r); } }, ['Edit'])];
        })
      ));
    }).catch(function (e) { U.empty(body, 'Could not load departments', e.message); });
  }

  function departmentForm(dept) {
    var body = U.el('div');
    var name = textField(body, 'Department name', dept ? dept.name : '');
    var activeWrap = U.el('div', { class: 'field' });
    var active = U.el('input', { type: 'checkbox', checked: dept ? dept.active : true, style: 'width:auto;min-height:auto' });
    activeWrap.appendChild(U.el('label', { class: 'row', style: 'font-weight:400' }, [active, U.el('span', { text: 'In use' })]));
    body.appendChild(activeWrap);

    U.modal({
      title: dept ? 'Edit department' : 'Add department',
      body: body,
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Save department', class: 'btn--primary', onClick: function (close, button) {
            save('saveDepartment', {
              departmentId: dept ? dept.departmentId : '', name: name.value.trim(), active: active.checked
            }, close, button);
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ settings */

  function loadSettings(body) {
    API.call('getSettings', {}).then(function (d) {
      U.clear(body);
      var wrap = U.el('div', { class: 'panel__body' });
      var inputs = {};
      d.rows.forEach(function (r) {
        var input = U.el('input', { type: 'text', value: r.Value, id: 'set-' + r.Key });
        inputs[r.Key] = input;
        wrap.appendChild(U.el('div', { class: 'field' }, [
          U.el('label', { for: 'set-' + r.Key, text: prettyKey(r.Key) }),
          input,
          r.Description ? U.el('div', { class: 'hint', text: r.Description }) : null
        ]));
      });

      var btn = U.el('button', { class: 'btn btn--primary' }, ['Save settings']);
      btn.addEventListener('click', function () {
        var payload = {};
        Object.keys(inputs).forEach(function (k) { payload[k] = inputs[k].value; });
        U.busy(btn, true);
        API.call('saveSettings', { settings: payload }).then(function () {
          U.toast('Settings saved');
          return refreshMasters();
        }).catch(function (e) { U.toast(e.message, 'error'); })
          .then(function () { U.busy(btn, false); });
      });
      wrap.appendChild(btn);
      body.appendChild(wrap);
    }).catch(function (e) { U.empty(body, 'Could not load settings', e.message); });
  }

  function prettyKey(key) {
    return String(key).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /* -------------------------------------------------------- data quality */

  function loadQuality(body) {
    API.call('getDataQuality', {}).then(function (d) {
      U.clear(body);
      if (!d.total) {
        U.empty(body, 'No data problems found.', 'Quantities balance, references resolve and dates are valid.');
        return;
      }
      var tiles = U.el('div', { class: 'tiles', style: 'padding:16px 16px 0' });
      Object.keys(d.summary).forEach(function (k) {
        tiles.appendChild(U.el('div', { class: 'tile tile--alert' }, [
          U.el('div', { class: 'tile__label', text: k }),
          U.el('div', { class: 'tile__value', text: String(d.summary[k]) })
        ]));
      });
      body.appendChild(tiles);
      body.appendChild(table(
        ['Problem', 'Record', 'Detail'],
        d.issues.map(function (i) { return [i.type, mono(i.recordId), i.detail]; })
      ));
    }).catch(function (e) { U.empty(body, 'Could not run the data check', e.message); });
  }

  /* ----------------------------------------------------------- audit log */

  function loadAudit(body, actions) {
    var btn = App.exportButton('audit');
    if (btn) actions.appendChild(btn);
    API.call('getAuditLogs', App.filterPayload({ limit: 200 })).then(function (d) {
      U.clear(body);
      body.appendChild(U.el('p', { class: 'small muted', style: 'padding:14px 16px 0',
        text: 'Showing the ' + d.rows.length + ' most recent of ' + d.total + ' entries.' }));
      if (!d.rows.length) { U.empty(body, 'No audit entries yet.', ''); return; }
      body.appendChild(table(
        ['When', 'User', 'Action', 'Module', 'Record', 'Field', 'Before', 'After'],
        d.rows.map(function (r) {
          return [
            String(r.Timestamp).substring(0, 19), r.User, r.Action, r.Module,
            mono(r.Record_ID), r.Field_Name || '—', r.Old_Value || '—', r.New_Value || r.Remarks || '—'
          ];
        })
      ));
    }).catch(function (e) { U.empty(body, 'Could not load the audit log', e.message); });
  }

  /* ------------------------------------------------------------- helpers */

  function save(action, payload, close, button) {
    U.busy(button, true);
    API.call(action, payload).then(function (d) {
      U.toast('Saved');
      return refreshMasters().then(function () { close(); load(); });
    }).catch(function (e) { U.toast(e.message, 'error'); })
      .then(function () { U.busy(button, false); });
  }

  function textField(host, label, value, type) {
    var id = 'f' + Math.random().toString(36).slice(2);
    var input = U.el('input', { type: type || 'text', id: id, value: value === undefined || value === null ? '' : value });
    host.appendChild(U.el('div', { class: 'field' }, [U.el('label', { for: id, text: label }), input]));
    return input;
  }

  function selectField(host, label, options, value) {
    var id = 'f' + Math.random().toString(36).slice(2);
    var sel = U.el('select', { id: id });
    sel.appendChild(U.el('option', { value: '' }, ['Choose one']));
    options.forEach(function (o) {
      sel.appendChild(U.el('option', { value: o[0], selected: String(o[0]) === String(value) }, [o[1]]));
    });
    host.appendChild(U.el('div', { class: 'field' }, [U.el('label', { for: id, text: label }), sel]));
    return sel;
  }

  function badge(active) {
    return U.el('span', { class: 'badge ' + (active ? 'badge--ok' : ''), text: active ? 'Active' : 'Inactive' });
  }

  function mono(v) { return U.el('span', { class: 'mono small', text: String(v || '') }); }

  function table(headers, rows) {
    var t = U.el('table', { class: 'grid' });
    t.appendChild(U.el('thead', {}, [U.el('tr', {}, headers.map(function (h) { return U.el('th', {}, [h]); }))]));
    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(U.el('tr', {}, r.map(function (c, i) {
        var cell = U.el('td', { 'data-label': headers[i] || '' });
        cell.appendChild(typeof c === 'object' && c !== null && c.nodeType ? c : document.createTextNode(String(c === null || c === undefined ? '' : c)));
        return cell;
      })));
    });
    t.appendChild(tbody);
    return U.el('div', { class: 'table-wrap' }, [t]);
  }

  return { render: render };
})();
