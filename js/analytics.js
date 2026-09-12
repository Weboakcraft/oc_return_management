/**
 * analytics.js — item, source, trend and employee analysis.
 * Every column is a quantity or a quantity-derived percentage. Transaction
 * counts appear in their own column so the two are never confused.
 */
Views.analytics = (function () {

  var tab = 'items';
  var itemSort = 'return_qty';
  var grain = 'day';

  function render(host) {
    U.clear(host);
    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Analytics' }),
        U.el('p', { text: 'Quantity-based analysis across products, sources, time and staff.' })
      ]),
      U.el('div', { class: 'view__actions' }, [
        App.dateFilter(STATE.filters, function () { load(); }),
        U.el('span', { id: 'analytics-export' })
      ])
    ]));

    var panel = U.el('div', { class: 'panel' });
    var tabs = U.el('div', { class: 'tabs' });
    [['items', 'Products'], ['sources', 'Sources'], ['trends', 'Trends'], ['employees', 'Staff']].forEach(function (t) {
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
    panel.appendChild(U.el('div', { id: 'analytics-body', class: 'panel__body panel__body--flush' }));
    host.appendChild(panel);
    load();
  }

  function load() {
    var body = U.$('#analytics-body');
    U.skeleton(body, 5);
    setExport();
    if (tab === 'items') return loadItems(body);
    if (tab === 'sources') return loadSources(body);
    if (tab === 'trends') return loadTrends(body);
    return loadEmployees(body);
  }

  function setExport() {
    var host = U.$('#analytics-export');
    if (!host) return;
    U.clear(host);
    var map = { items: 'items', sources: 'sources', employees: 'employees', trends: 'returns' };
    var btn = App.exportButton(map[tab]);
    if (btn) host.appendChild(btn);
  }

  /* --------------------------------------------------------------- items */

  function loadItems(body) {
    API.call('getItemAnalytics', App.filterPayload({ sort: itemSort })).then(function (d) {
      U.clear(body);
      if (!d.rows.length) { U.empty(body, 'No product data for this period.', 'Change the date range to see more.'); return; }

      var controls = U.el('div', { class: 'panel__body row', style: 'padding:12px 16px' });
      var sel = U.el('select', { style: 'width:auto', 'aria-label': 'Sort products by' });
      [
        ['return_qty', 'Highest return quantity'], ['damaged_qty', 'Highest damaged quantity'],
        ['repair_qty', 'Highest repair quantity'], ['ok_qty', 'Highest OK quantity'],
        ['damage_pct_desc', 'Highest damage %'], ['repair_pct_desc', 'Highest repair %'],
        ['ok_pct_desc', 'Highest OK %'], ['ok_pct_asc', 'Lowest OK %']
      ].forEach(function (o) {
        sel.appendChild(U.el('option', { value: o[0], selected: itemSort === o[0] }, [o[1]]));
      });
      sel.addEventListener('change', function () { itemSort = sel.value; load(); });
      controls.appendChild(U.el('span', { class: 'small muted', text: 'Sort by' }));
      controls.appendChild(sel);
      body.appendChild(controls);

      var chartHost = U.el('div', { style: 'padding:0 8px' });
      body.appendChild(chartHost);
      Charts.horizontalBars(chartHost, d.rows.slice(0, 10).map(function (r) {
        return { label: r.productName, okQty: r.okQty, repairQty: r.repairQty, damagedQty: r.damagedQty };
      }), { labelKey: 'label' });

      body.appendChild(grid(
        ['Product', 'SKU', 'Returns', 'Units', 'OK', 'Repair', 'Damaged', 'Production', 'OK %', 'Repair %', 'Damage %'],
        d.rows.map(function (r) {
          return [
            r.productName, mono(r.sku), num(r.returnTxns), num(r.returnQty), num(r.okQty),
            num(r.repairQty), num(r.damagedQty), num(r.productionQty),
            num(U.pct(r.okPct)), num(U.pct(r.repairPct)), num(U.pct(r.damagePct))
          ];
        })
      ));
    }).catch(function (err) { U.empty(body, 'Could not load product analytics', err.message); });
  }

  /* ------------------------------------------------------------- sources */

  function loadSources(body) {
    API.call('getSourceAnalytics', App.filterPayload({})).then(function (d) {
      U.clear(body);
      var active = d.rows.filter(function (r) { return r.returnQty > 0; });
      if (!active.length) { U.empty(body, 'No returns from any source in this period.', ''); return; }

      var chartHost = U.el('div', { style: 'padding:14px 8px 0' });
      body.appendChild(chartHost);
      Charts.horizontalBars(chartHost, active.map(function (r) {
        return { label: r.source, okQty: r.okQty, repairQty: r.repairQty, damagedQty: r.damagedQty };
      }), { labelKey: 'label' });

      body.appendChild(grid(
        ['Source', 'Returns', 'Units', 'OK', 'Repair', 'Damaged', 'Production', 'OK %', 'Repair %', 'Damage %', 'Quality rate'],
        d.rows.map(function (r) {
          return [
            r.source, num(r.returnTxns), num(r.returnQty), num(r.okQty), num(r.repairQty),
            num(r.damagedQty), num(r.productionQty), num(U.pct(r.okPct)), num(U.pct(r.repairPct)),
            num(U.pct(r.damagePct)), num(U.pct(r.qualityRate))
          ];
        })
      ));
    }).catch(function (err) { U.empty(body, 'Could not load source analytics', err.message); });
  }

  /* -------------------------------------------------------------- trends */

  function loadTrends(body) {
    API.call('getTrendAnalytics', App.filterPayload({ grain: grain })).then(function (d) {
      U.clear(body);

      var controls = U.el('div', { class: 'panel__body row', style: 'padding:12px 16px' });
      var sel = U.el('select', { style: 'width:auto', 'aria-label': 'Group by' });
      [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].forEach(function (o) {
        sel.appendChild(U.el('option', { value: o[0], selected: grain === o[0] }, [o[1]]));
      });
      sel.addEventListener('change', function () { grain = sel.value; load(); });
      controls.appendChild(U.el('span', { class: 'small muted', text: 'Group by' }));
      controls.appendChild(sel);
      body.appendChild(controls);

      body.appendChild(U.el('h3', { text: 'Return quantity by status', style: 'padding:4px 16px 0' }));
      var c1 = U.el('div', { style: 'padding:0 8px' });
      body.appendChild(c1);
      Charts.stackedBars(c1, d.trend, {});

      body.appendChild(U.el('h3', { text: 'Total returned units', style: 'padding:10px 16px 0' }));
      var c2 = U.el('div', { style: 'padding:0 8px' });
      body.appendChild(c2);
      Charts.line(c2, d.trend, { key: 'returnQty' });

      if (d.sourceTrend && d.sourceTrend.sources.length) {
        body.appendChild(U.el('h3', { text: 'Units by source', style: 'padding:10px 16px 0' }));
        body.appendChild(grid(
          ['Period'].concat(d.sourceTrend.sources),
          d.sourceTrend.rows.map(function (row) {
            return [row.period].concat(d.sourceTrend.sources.map(function (s) { return num(row[s] || 0); }));
          })
        ));
      }
    }).catch(function (err) { U.empty(body, 'Could not load trends', err.message); });
  }

  /* ----------------------------------------------------------- employees */

  function loadEmployees(body) {
    API.call('getEmployeePerformance', App.filterPayload({})).then(function (d) {
      U.clear(body);
      if (!d.rows.length) { U.empty(body, 'No staff activity in this period.', ''); return; }
      body.appendChild(U.el('p', { class: 'small muted', style: 'padding:14px 16px 0',
        text: 'Volume is measured in units handled, not the number of entries made.' }));
      body.appendChild(grid(
        ['Employee', 'Department', 'Returns', 'Units', 'OK', 'Repair', 'Damaged', 'Awaiting inspection', 'Repair pending'],
        d.rows.map(function (r) {
          return [
            r.employeeName, r.department || '—', num(r.returnTxns), num(r.returnQty), num(r.okQty),
            num(r.repairQty), num(r.damagedQty), num(r.pendingInspectionQty), num(r.pendingRepairQty)
          ];
        })
      ));
    }).catch(function (err) { U.empty(body, 'Could not load staff analytics', err.message); });
  }

  /* --------------------------------------------------------------- table */

  function num(v) { return { num: true, value: String(v) }; }
  function mono(v) { return { mono: true, value: String(v) }; }

  function grid(headers, rows) {
    var table = U.el('table', { class: 'grid' });
    table.appendChild(U.el('thead', {}, [U.el('tr', {}, headers.map(function (h, i) {
      return U.el('th', { class: i > 1 ? 'num' : '' }, [h]);
    }))]));
    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(U.el('tr', {}, r.map(function (cell, i) {
        var value = cell && cell.value !== undefined ? cell.value : cell;
        var cls = cell && cell.num ? 'num' : (cell && cell.mono ? 'mono' : '');
        return U.el('td', { 'data-label': headers[i], class: cls }, [String(value)]);
      })));
    });
    table.appendChild(tbody);
    return U.el('div', { class: 'table-wrap' }, [table]);
  }

  return { render: render };
})();
