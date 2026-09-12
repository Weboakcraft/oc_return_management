/**
 * reports.js — the operational reports management asks for by name.
 * Each one respects the date filter, and export sends exactly what is on
 * screen, not the whole table.
 */
Views.reports = (function () {

  var REPORTS = [
    { key: 'daily', label: 'Daily returns', dataset: 'returns', hint: 'Quantity by day' },
    { key: 'weekly', label: 'Weekly returns', dataset: 'returns', hint: 'Quantity by week' },
    { key: 'monthly', label: 'Monthly returns', dataset: 'returns', hint: 'Quantity by month' },
    { key: 'item', label: 'Item returns', dataset: 'items', hint: 'Product by product' },
    { key: 'source', label: 'Source returns', dataset: 'sources', hint: 'Marketplace by marketplace' },
    { key: 'repair_pending', label: 'Repair pending', dataset: 'repair', hint: 'Outstanding repair work' },
    { key: 'production_pending', label: 'Production pending', dataset: 'production', hint: 'Outstanding rebuilds' },
    { key: 'employee', label: 'Employee processing', dataset: 'employees', hint: 'Units handled per person' },
    { key: 'damage', label: 'Damage analysis', dataset: 'items', hint: 'Where damage concentrates' }
  ];

  var current = 'daily';

  function render(host) {
    U.clear(host);
    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Reports' }),
        U.el('p', { text: 'Pick a report, set the period, export what you see.' })
      ]),
      U.el('div', { class: 'view__actions' }, [
        App.dateFilter(STATE.filters, function () { load(); }),
        U.el('span', { id: 'report-export' })
      ])
    ]));

    var picker = U.el('div', { class: 'filters' });
    var sel = U.el('select', { 'aria-label': 'Report' });
    REPORTS.forEach(function (r) {
      sel.appendChild(U.el('option', { value: r.key, selected: current === r.key }, [r.label]));
    });
    sel.addEventListener('change', function () { current = sel.value; load(); });
    picker.appendChild(U.el('div', { class: 'field field--wide' }, [U.el('label', { text: 'Report' }), sel]));
    picker.appendChild(U.el('div', { class: 'field' }, [
      U.el('label', { text: 'About this report' }),
      U.el('div', { class: 'hint', id: 'report-hint' })
    ]));
    host.appendChild(picker);

    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { id: 'report-title', text: '' }),
      U.el('span', { class: 'panel__note', id: 'report-summary' })
    ]));
    panel.appendChild(U.el('div', { class: 'panel__body panel__body--flush', id: 'report-body' }));
    host.appendChild(panel);
    load();
  }

  function meta() { return REPORTS.filter(function (r) { return r.key === current; })[0]; }

  function load() {
    var body = U.$('#report-body');
    var m = meta();
    U.$('#report-title').textContent = m.label;
    U.$('#report-hint').textContent = m.hint;
    var exportHost = U.$('#report-export');
    U.clear(exportHost);
    var btn = App.exportButton(m.dataset);
    if (btn) exportHost.appendChild(btn);

    U.skeleton(body, 5);
    API.call('getReport', App.filterPayload({ type: current }))
      .then(function (d) { paint(body, d); })
      .catch(function (err) { U.empty(body, 'Could not run this report', err.message); });
  }

  function paint(body, d) {
    U.clear(body);
    var summary = U.$('#report-summary');
    if (d.totals && d.totals.returnQty !== undefined) {
      summary.textContent = U.num(d.totals.returnQty) + ' units · OK ' + U.pct(d.totals.okPct) +
        ' · Repair ' + U.pct(d.totals.repairPct) + ' · Damaged ' + U.pct(d.totals.damagePct);
    } else if (d.total !== undefined) {
      summary.textContent = d.total + ' job(s)';
    } else {
      summary.textContent = '';
    }

    if (current === 'daily' || current === 'weekly' || current === 'monthly') {
      if (!d.rows.length) { U.empty(body, 'No returns in this period.', 'Try a wider date range.'); return; }
      var chartHost = U.el('div', { style: 'padding:14px 8px 0' });
      body.appendChild(chartHost);
      Charts.stackedBars(chartHost, d.rows, {});
      body.appendChild(table(
        ['Period', 'Returns', 'Units', 'OK', 'Repair', 'Damaged', 'Production'],
        d.rows.map(function (r) {
          return [r.period, r.returnTxns, r.returnQty, r.okQty, r.repairQty, r.damagedQty, r.productionQty];
        })
      ));
      return;
    }

    if (current === 'item' || current === 'damage') {
      if (!d.rows.length) { U.empty(body, 'No product data in this period.', ''); return; }
      body.appendChild(table(
        ['Product', 'SKU', 'Units', 'OK', 'Repair', 'Damaged', 'Production', 'Damage %'],
        d.rows.map(function (r) {
          return [r.productName, r.sku, r.returnQty, r.okQty, r.repairQty, r.damagedQty, r.productionQty, U.pct(r.damagePct)];
        })
      ));
      return;
    }

    if (current === 'source') {
      body.appendChild(table(
        ['Source', 'Returns', 'Units', 'OK', 'Repair', 'Damaged', 'OK %', 'Damage %'],
        d.rows.map(function (r) {
          return [r.source, r.returnTxns, r.returnQty, r.okQty, r.repairQty, r.damagedQty, U.pct(r.okPct), U.pct(r.damagePct)];
        })
      ));
      return;
    }

    if (current === 'employee') {
      body.appendChild(table(
        ['Employee', 'Department', 'Returns', 'Units', 'OK', 'Repair', 'Damaged', 'Pending inspection'],
        d.rows.map(function (r) {
          return [r.employeeName, r.department || '—', r.returnTxns, r.returnQty, r.okQty, r.repairQty, r.damagedQty, r.pendingInspectionQty];
        })
      ));
      return;
    }

    // repair_pending / production_pending
    if (!d.rows.length) {
      U.empty(body, current === 'repair_pending' ? 'No pending repairs.' : 'No pending production items.', 'Nothing outstanding in this period.');
      return;
    }
    summary.textContent = d.totals.pending + ' unit(s) outstanding across ' + d.total + ' job(s)';
    body.appendChild(table(
      ['Job', 'Return', 'Product', 'SKU', 'Sent', 'Done', 'Pending', 'Status', 'Waiting days'],
      d.rows.map(function (r) {
        return [r.id, r.returnId, r.productName, r.sku, r.quantitySent, r.completedQty, r.pendingQty, r.status, r.ageingDays];
      })
    ));
  }

  function table(headers, rows) {
    var t = U.el('table', { class: 'grid' });
    t.appendChild(U.el('thead', {}, [U.el('tr', {}, headers.map(function (h, i) {
      return U.el('th', { class: i >= 2 ? 'num' : '' }, [h]);
    }))]));
    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(U.el('tr', {}, r.map(function (c, i) {
        return U.el('td', { 'data-label': headers[i], class: i >= 2 ? 'num' : '' }, [String(c)]);
      })));
    });
    t.appendChild(tbody);
    return U.el('div', { class: 'table-wrap' }, [t]);
  }

  return { render: render };
})();
