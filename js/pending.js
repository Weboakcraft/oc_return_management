/**
 * pending.js — one screen that answers "what is still open".
 * Items are grouped by the stage that is actually holding them up, and
 * sorted oldest first so the slowest work surfaces on its own.
 */
Views.pending = (function () {

  var tab = 'inspection';
  var data = null;

  function render(host) {
    U.clear(host);
    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Pending returns' }),
        U.el('p', { text: 'Work that has not finished yet, oldest first.' })
      ]),
      U.el('div', { class: 'view__actions' }, [
        App.dateFilter(STATE.filters, function () { load(); })
      ])
    ]));

    host.appendChild(U.el('div', { id: 'ageing-strip' }));
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { id: 'pending-tabs', class: 'tabs' }));
    panel.appendChild(U.el('div', { class: 'panel__body panel__body--flush', id: 'pending-body' }));
    host.appendChild(panel);
    load();
  }

  function load() {
    var body = U.$('#pending-body');
    U.skeleton(body, 5);
    API.call('getPendingReturns', App.filterPayload({})).then(function (d) {
      data = d;
      paintAgeing();
      paintTabs();
      paintList();
    }).catch(function (err) { U.empty(body, 'Could not load pending work', err.message); });
  }

  function paintAgeing() {
    var host = U.$('#ageing-strip');
    U.clear(host);
    var strip = U.el('div', { class: 'ageing', style: 'margin-bottom:16px' });
    Object.keys(data.ageing).forEach(function (label) {
      var late = label === '8-15 Days' || label === '15+ Days';
      strip.appendChild(U.el('div', { class: late && data.ageing[label] ? 'is-late' : '' }, [
        U.el('span', { text: label }),
        U.el('b', { text: String(data.ageing[label]) })
      ]));
    });
    host.appendChild(strip);
  }

  function paintTabs() {
    var host = U.$('#pending-tabs');
    U.clear(host);
    [
      ['inspection', 'Pending inspection', data.counts.inspection, data.pendingQty.inspection],
      ['repair', 'Pending repair', data.counts.repair, data.pendingQty.repair],
      ['production', 'Pending production', data.counts.production, data.pendingQty.production],
      ['completed', 'Completed', data.counts.completed, null]
    ].forEach(function (t) {
      var btn = U.el('button', {
        class: tab === t[0] ? 'is-active' : '',
        onclick: function () { tab = t[0]; paintTabs(); paintList(); }
      }, [
        t[1],
        U.el('span', { class: 'count', text: String(t[2]) })
      ]);
      if (t[3] !== null && t[3] !== undefined) btn.title = t[3] + ' unit(s) outstanding';
      host.appendChild(btn);
    });
  }

  function paintList() {
    var body = U.$('#pending-body');
    U.clear(body);
    var rows = data.buckets[tab] || [];

    if (!rows.length) {
      var messages = {
        inspection: ['Nothing waiting for inspection.', 'Every received return has been checked.'],
        repair: ['No pending repairs.', 'The repair bay is clear for this period.'],
        production: ['No pending production items.', 'Nothing is waiting to be rebuilt.'],
        completed: ['No completed returns yet.', 'Finished work will collect here.']
      };
      U.empty(body, messages[tab][0], messages[tab][1]);
      return;
    }

    var table = U.el('table', { class: 'grid' });
    table.appendChild(U.el('thead', {}, [U.el('tr', {}, [
      cell('th', 'Return'), cell('th', 'Product'), cell('th', 'Source'),
      cell('th', 'Qty', 'num'), cell('th', 'Pending', 'num'), cell('th', 'Status'),
      cell('th', 'Employee'), cell('th', 'Age', 'num')
    ])]));

    var tbody = U.el('tbody');
    var empNames = {};
    STATE.employees.forEach(function (e) { empNames[e.employeeId] = e.name; });

    rows.forEach(function (r) {
      var pending = tab === 'repair' ? r.repairPendingQty
        : tab === 'production' ? r.productionPendingQty
          : tab === 'inspection' ? r.returnQty : 0;
      tbody.appendChild(U.el('tr', {}, [
        dataCell(U.el('button', {
          class: 'id', onclick: function () { location.hash = '#/return/' + encodeURIComponent(r.returnId); }
        }, [r.returnId]), 'Return', [U.el('span', { class: 'cell-sub', text: U.fmtDate(r.returnDate) })]),
        dataCell(r.productName, 'Product', [U.el('span', { class: 'cell-sub mono', text: r.sku })]),
        dataCell(r.source, 'Source'),
        dataCell(String(r.returnQty), 'Qty', null, 'num'),
        dataCell(String(pending), 'Pending', null, 'num'),
        dataCell(U.el('span', { class: 'badge ' + U.statusClass(r.status), text: r.status }), 'Status'),
        dataCell(empNames[r.employeeId] || '—', 'Employee'),
        dataCell(U.el('span', { class: U.ageClass(r.ageingDays), text: r.ageingDays + 'd' }), 'Age', null, 'num')
      ]));
    });
    table.appendChild(tbody);
    body.appendChild(U.el('div', { class: 'table-wrap' }, [table]));
  }

  function cell(tag, label, cls) { return U.el(tag, { class: cls || '' }, [label]); }
  function dataCell(content, label, extra, cls) {
    var node = U.el('td', { 'data-label': label, class: cls || '' });
    node.appendChild(typeof content === 'string' ? document.createTextNode(content) : content);
    (extra || []).forEach(function (n) { node.appendChild(n); });
    return node;
  }

  return { render: render };
})();
