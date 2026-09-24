/**
 * dashboard.js — management view.
 *
 * The lane strip across the top answers the only question management asks
 * first: how many units came back, and where did they end up. Every figure
 * is a quantity; transaction count is shown separately and never as a
 * substitute for it.
 */
Views.dashboard = (function () {

  function render(host) {
    U.clear(host);

    var head = U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Returns overview' }),
        U.el('p', { id: 'dash-period', text: 'Loading…' })
      ]),
      U.el('div', { class: 'view__actions' }, [
        App.dateFilter(STATE.filters, function () { load(); }),
        App.exportButton('returns')
      ])
    ]);
    host.appendChild(head);

    var body = U.el('div', { id: 'dash-body' });
    host.appendChild(body);
    load();
  }

  function load() {
    var body = U.$('#dash-body');
    U.skeleton(body, 6);
    API.call('getDashboardData', App.filterPayload({ grain: grainFor(STATE.filters.range) }))
      .then(function (d) { paint(body, d); })
      .catch(function (err) {
        U.empty(body, 'Dashboard could not load', err.message);
      });
  }

  function grainFor(range) {
    if (range === 'this_year' || range === 'all') return 'month';
    if (range === 'last_30') return 'day';
    return 'day';
  }

  function paint(body, d) {
    U.clear(body);
    var k = d.kpi;
    var note = U.$('#dash-period');
    if (note) {
      note.textContent = k.returnTxns + ' return' + (k.returnTxns === 1 ? '' : 's') +
        ' holding ' + U.num(k.returnQty) + ' unit' + (k.returnQty === 1 ? '' : 's');
    }

    body.appendChild(lane(k));
    body.appendChild(pendingTiles(d.pending, k));
    if (d.scans) body.appendChild(scanTiles(d.scans));

    var split = U.el('div', { class: 'split' });
    split.appendChild(trendPanel(d.trend));
    split.appendChild(sourcePanel(d.sources));
    body.appendChild(split);

    var split2 = U.el('div', { class: 'split split--even' });
    split2.appendChild(rankPanel('Most returned products', d.topProducts, 'Ranked by returned quantity.'));
    split2.appendChild(rankPanel('Repair and damage hotspots', d.hotspots, 'Products that need operational attention.'));
    body.appendChild(split2);
  }

  /* ---------------------------------------------------------- lane strip */

  function lane(k) {
    var wrap = U.el('div', { class: 'lane' });

    var first = U.el('div', { class: 'lane__stage' }, [
      U.el('div', { class: 'lane__label', text: 'Units received' }),
      U.el('div', { class: 'lane__value', text: U.num(k.returnQty) }),
      U.el('div', { class: 'lane__sub', text: k.returnTxns + ' returns' })
    ]);
    if (k.unclassifiedQty > 0) {
      first.appendChild(U.el('div', { class: 'lane__sub', text: k.unclassifiedQty + ' not inspected yet' }));
    }
    wrap.appendChild(first);

    wrap.appendChild(stage('ok', 'Good stock', k.okQty, k.okPct, 'Back to sellable inventory'));
    wrap.appendChild(stage('repair', 'Needs repair', k.repairQty, k.repairPct, 'Fixable in the repair bay'));
    wrap.appendChild(stage('damage', 'Damaged', k.damagedQty, k.damagePct, 'Written down or rebuilt'));
    wrap.appendChild(stage('production', 'To production', k.productionQty, k.productionPct, 'Counted inside damaged, not added to it'));
    return wrap;
  }

  function stage(kind, label, qty, pctValue, note) {
    return U.el('div', { class: 'lane__stage lane__stage--' + kind }, [
      U.el('div', { class: 'lane__label', text: label }),
      U.el('div', { class: 'lane__value', text: U.num(qty) }),
      U.el('div', { class: 'lane__pct', text: U.pct(pctValue) + ' of units' }),
      U.el('div', { class: 'lane__meter' }, [U.el('i', { style: 'width:' + Math.min(100, pctValue) + '%' })]),
      U.el('div', { class: 'lane__note', text: note })
    ]);
  }

  /* --------------------------------------------------------------- tiles */

  function pendingTiles(p, k) {
    var tiles = U.el('div', { class: 'tiles' });

    tiles.appendChild(tile('Waiting for inspection', p.inspectionQty, 'units received, not yet checked',
      p.inspectionQty > 0 ? 'warn' : '', function () { App.go('pending'); }));
    tiles.appendChild(tile('Repair pending', p.repairQty, 'units still in the repair queue',
      p.repairQty > 0 ? 'warn' : '', function () { App.go('repair'); }));
    tiles.appendChild(tile('Production pending', p.productionQty, 'units with production',
      p.productionQty > 0 ? 'warn' : '', function () { App.go('production'); }));
    tiles.appendChild(tile('Quality rate', U.pct(k.okPct), 'units returned in good condition', '', null, true));
    tiles.appendChild(tile('Return transactions', k.returnTxns, 'separate returns in this period', '', function () { App.go('returns'); }));

    return tiles;
  }

  /* ----------------------------------------------------- scanned parcels */

  /*
   * Scans are tracking IDs only — no product, quantity or source — so they
   * never enter the unit figures above. They get their own row instead, with
   * the one number that needs action: parcels scanned whose return has not
   * been entered yet (matched on Order ID = tracking ID).
   */
  function scanTiles(s) {
    var wrap = U.el('div', {});
    var tiles = U.el('div', { class: 'tiles' });
    tiles.appendChild(tile('Parcels scanned', s.inRange, 'tracking IDs scanned in this period', '', function () { App.go('scan'); }));
    tiles.appendChild(tile('Scanned today', s.today, 'tracking IDs scanned today', '', function () { App.go('scan'); }));
    tiles.appendChild(tile('Scanned, return not entered', s.withoutReturn, 'no return with this tracking ID as Order ID',
      s.withoutReturn > 0 ? 'warn' : '', Auth.can('canCreateReturn') ? function () { App.go('new-return'); } : null));
    wrap.appendChild(tiles);

    if (s.recentWithoutReturn && s.recentWithoutReturn.length) {
      var panel = U.el('div', { class: 'panel', style: 'margin-bottom:16px' });
      panel.appendChild(U.el('div', { class: 'panel__head' }, [
        U.el('h2', { text: 'Scanned parcels waiting for a return entry' }),
        U.el('span', { class: 'panel__note', text: 'Latest ' + s.recentWithoutReturn.length + ' of ' + s.withoutReturn })
      ]));
      var list = U.el('ul', { class: 'rank' });
      s.recentWithoutReturn.forEach(function (r) {
        list.appendChild(U.el('li', {}, [
          U.el('div', { class: 'rank__name' }, [
            document.createTextNode(r.trackingId),
            U.el('span', { class: 'sku', text: (r.scannedBy || '') + (r.scannedAt ? ' · ' + r.scannedAt : '') })
          ])
        ]));
      });
      var body = U.el('div', { class: 'panel__body panel__body--flush' });
      body.appendChild(list);
      panel.appendChild(body);
      wrap.appendChild(panel);
    }
    return wrap;
  }

  function tile(label, value, sub, kind, onClick, raw) {
    var node = U.el('div', {
      class: 'tile' + (kind ? ' tile--' + kind : '') + (onClick ? ' tile--action' : ''),
      tabindex: onClick ? '0' : null,
      role: onClick ? 'button' : null
    }, [
      U.el('div', { class: 'tile__label', text: label }),
      U.el('div', { class: 'tile__value', text: raw ? value : U.num(value) }),
      U.el('div', { class: 'tile__sub', text: sub })
    ]);
    if (onClick) {
      node.addEventListener('click', onClick);
      node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    }
    return node;
  }

  /* -------------------------------------------------------------- panels */

  function trendPanel(trend) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Return trend' }),
      U.el('span', { class: 'panel__note', text: 'Quantity by status over time' })
    ]));
    var body = U.el('div', { class: 'panel__body panel__body--flush', style: 'padding:14px 8px 0' });
    panel.appendChild(body);
    Charts.stackedBars(body, trend, { emptyHint: 'Save a return to see the trend build up.' });
    return panel;
  }

  function sourcePanel(sources) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Where returns came from' }),
      U.el('button', { class: 'btn btn--ghost btn--sm', onclick: function () { App.go('analytics'); } }, ['Details'])
    ]));
    var body = U.el('div', { class: 'panel__body panel__body--flush', style: 'padding:10px 8px 0' });
    panel.appendChild(body);
    Charts.horizontalBars(body, sources.slice(0, 8), { labelKey: 'source', emptyHint: 'No returns in this period.' });
    return panel;
  }

  function rankPanel(title, rows, note) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: title }),
      U.el('span', { class: 'panel__note', text: note })
    ]));
    var body = U.el('div', { class: 'panel__body panel__body--flush' });

    if (!rows || !rows.length) {
      U.empty(body, 'Nothing to show yet.', 'Returns saved in this period will appear here.');
      panel.appendChild(body);
      return panel;
    }

    var max = Math.max.apply(null, rows.map(function (r) { return r.returnQty; })) || 1;
    var list = U.el('ul', { class: 'rank' });
    rows.forEach(function (r) {
      var total = r.returnQty || 1;
      list.appendChild(U.el('li', {}, [
        U.el('div', { class: 'rank__name' }, [
          document.createTextNode(r.productName || r.source || ''),
          U.el('span', { class: 'sku', text: r.sku || '' })
        ]),
        U.el('div', { class: 'rank__qty', text: U.num(r.returnQty) }),
        U.el('div', { class: 'rank__bar', style: 'width:' + Math.max(6, (r.returnQty / max) * 100) + '%' }, [
          U.el('i', { class: 'ok', style: 'width:' + (r.okQty / total * 100) + '%' }),
          U.el('i', { class: 'repair', style: 'width:' + (r.repairQty / total * 100) + '%' }),
          U.el('i', { class: 'damage', style: 'width:' + (r.damagedQty / total * 100) + '%' })
        ])
      ]));
    });
    body.appendChild(list);
    panel.appendChild(body);
    return panel;
  }

  return { render: render };
})();
