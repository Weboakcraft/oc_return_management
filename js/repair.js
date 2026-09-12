/**
 * repair.js — the repair queue, and the shared queue view that production
 * reuses. Both screens do the same job: show outstanding units, let the team
 * record how many are finished, and never accept more than were sent.
 */

window.QueueView = (function () {

  /**
   * cfg: { key, title, subtitle, listAction, updateAction, canUpdate,
   *        emptyTitle, emptyHint, dataset }
   */
  function build(cfg) {
    var view = 'pending';
    var filters = { q: '', status: '' };

    function render(host) {
      U.clear(host);
      host.appendChild(U.el('div', { class: 'view__head' }, [
        U.el('div', {}, [
          U.el('h1', { text: cfg.title }),
          U.el('p', { text: cfg.subtitle })
        ]),
        U.el('div', { class: 'view__actions' }, [
          App.dateFilter(STATE.filters, function () { load(); }),
          App.exportButton(cfg.dataset)
        ])
      ]));

      host.appendChild(U.el('div', { class: 'tiles', id: cfg.key + '-tiles' }));

      var panel = U.el('div', { class: 'panel' });
      var tabs = U.el('div', { class: 'tabs' });
      [['pending', 'Outstanding'], ['completed', 'Finished'], ['all', 'Everything']].forEach(function (t) {
        tabs.appendChild(U.el('button', {
          class: view === t[0] ? 'is-active' : '', 'data-view': t[0],
          onclick: function (e) {
            view = t[0];
            U.$$('.tabs button', tabs).forEach(function (b) { b.classList.toggle('is-active', b === e.currentTarget); });
            load();
          }
        }, [t[1]]));
      });
      panel.appendChild(tabs);

      var search = U.el('input', { type: 'search', placeholder: 'Search product, SKU, return ID or assignee', 'aria-label': 'Search queue' });
      search.addEventListener('input', U.debounce(function () { filters.q = search.value.trim(); load(); }, 350));
      panel.appendChild(U.el('div', { class: 'panel__body', style: 'padding:12px 16px' }, [search]));

      panel.appendChild(U.el('div', { class: 'panel__body panel__body--flush', id: cfg.key + '-body' }));
      host.appendChild(panel);
      load();
    }

    function load() {
      var body = U.$('#' + cfg.key + '-body');
      if (!body) return;
      U.skeleton(body, 4);
      API.call(cfg.listAction, App.filterPayload({ view: view, q: filters.q, status: filters.status }))
        .then(function (d) { paintTiles(d); paint(body, d); })
        .catch(function (err) { U.empty(body, 'Could not load the queue', err.message); });
    }

    function paintTiles(d) {
      var host = U.$('#' + cfg.key + '-tiles');
      if (!host) return;
      U.clear(host);
      [
        ['Units sent', d.totals.sent, ''],
        ['Units finished', d.totals.completed, ''],
        ['Units outstanding', d.totals.pending, d.totals.pending > 0 ? 'warn' : ''],
        ['Open jobs', d.total, '']
      ].forEach(function (t) {
        host.appendChild(U.el('div', { class: 'tile' + (t[2] ? ' tile--' + t[2] : '') }, [
          U.el('div', { class: 'tile__label', text: t[0] }),
          U.el('div', { class: 'tile__value', text: U.num(t[1]) })
        ]));
      });
    }

    function paint(body, d) {
      U.clear(body);
      if (!d.rows.length) {
        U.empty(body, cfg.emptyTitle, cfg.emptyHint);
        return;
      }

      var table = U.el('table', { class: 'grid' });
      table.appendChild(U.el('thead', {}, [U.el('tr', {}, [
        th('Job'), th('Product'), th('Return'), th('Sent', 'num'), th('Done', 'num'),
        th('Left', 'num'), th('Status'), th('Assigned to'), th('Waiting', 'num'), th('')
      ])]));

      var tbody = U.el('tbody');
      d.rows.forEach(function (r) {
        var action = cfg.canUpdate() && r.pendingQty > 0
          ? U.el('button', { class: 'btn btn--sm btn--primary', onclick: function () { updateDialog(r, d.statuses); } }, ['Update'])
          : (cfg.canUpdate()
            ? U.el('button', { class: 'btn btn--sm btn--ghost', onclick: function () { updateDialog(r, d.statuses); } }, ['View'])
            : document.createTextNode(''));

        tbody.appendChild(U.el('tr', {}, [
          td(U.el('span', { class: 'mono small', text: r.id }), 'Job'),
          td(r.productName, 'Product', [U.el('span', { class: 'cell-sub mono', text: r.sku })]),
          td(U.el('button', {
            class: 'id', onclick: function () { location.hash = '#/return/' + encodeURIComponent(r.returnId); }
          }, [r.returnId]), 'Return'),
          td(String(r.quantitySent), 'Sent', null, 'num'),
          td(String(r.completedQty), 'Done', null, 'num'),
          td(String(r.pendingQty), 'Left', null, 'num'),
          td(U.el('span', { class: 'badge ' + U.statusClass(r.status), text: r.status }), 'Status'),
          td(r.assignedTo || '—', 'Assigned to'),
          td(U.el('span', { class: U.ageClass(r.ageingDays), text: r.ageingDays + 'd' }), 'Waiting', null, 'num'),
          td(action, '')
        ]));
      });
      table.appendChild(tbody);
      body.appendChild(U.el('div', { class: 'table-wrap' }, [table]));
    }

    function th(label, cls) { return U.el('th', { class: cls || '' }, [label]); }
    function td(content, label, extra, cls) {
      var node = U.el('td', { 'data-label': label, class: cls || '' });
      node.appendChild(typeof content === 'string' ? document.createTextNode(content) : content);
      (extra || []).forEach(function (n) { node.appendChild(n); });
      return node;
    }

    /* ------------------------------------------------------- update form */

    function updateDialog(row, statuses) {
      var readOnly = !cfg.canUpdate();
      var body = U.el('div');

      body.appendChild(U.el('p', { class: 'muted small', text: row.productName + ' · ' + row.sku + ' · from ' + row.returnId }));
      body.appendChild(U.el('div', { class: 'qty-strip', style: 'margin-bottom:16px' }, [
        chip('Sent', row.quantitySent), chip('Finished', row.completedQty), chip('Left', row.pendingQty)
      ]));

      var completed = U.el('input', {
        type: 'number', min: '0', max: String(row.quantitySent), step: '1', inputmode: 'numeric',
        value: row.completedQty, disabled: readOnly
      });
      var status = U.el('select', { disabled: readOnly });
      (statuses || []).forEach(function (s) {
        status.appendChild(U.el('option', { value: s, selected: s === row.status }, [s]));
      });
      var assigned = U.el('input', { type: 'text', value: row.assignedTo || '', placeholder: 'Who is doing this work', disabled: readOnly });
      var remarks = U.el('input', { type: 'text', value: row.remarks || '', placeholder: 'What was done', disabled: readOnly });

      completed.addEventListener('input', function () {
        var v = Validate.wholeQty(completed.value);
        if (v === null) Validate.mark(completed, 'Whole numbers only.');
        else if (v > row.quantitySent) Validate.mark(completed, 'Cannot be more than the ' + row.quantitySent + ' unit(s) sent.');
        else Validate.mark(completed, null);
      });

      body.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Units finished' }), completed]));
      body.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Status' }), status]));
      body.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Assigned to' }), assigned]));
      body.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Notes' }), remarks]));

      var actions = [{ label: readOnly ? 'Close' : 'Cancel', onClick: function (close) { close(); } }];
      if (!readOnly) {
        actions.push({
          label: 'Save update', class: 'btn--primary', onClick: function (close, button) {
            var v = Validate.wholeQty(completed.value);
            if (v === null || v > row.quantitySent) { U.toast('Check the finished quantity.', 'error'); return; }

            var finishing = v === row.quantitySent && row.completedQty !== v;
            var proceed = finishing
              ? U.confirm({
                title: 'Mark this ' + cfg.key + ' complete?',
                message: 'All ' + row.quantitySent + ' unit(s) will be recorded as finished and the return can close.',
                confirmLabel: 'Mark complete'
              })
              : Promise.resolve(true);

            proceed.then(function (yes) {
              if (!yes) return;
              U.busy(button, true);
              API.call(cfg.updateAction, {
                id: row.id, completedQty: v, status: status.value,
                assignedTo: assigned.value, remarks: remarks.value
              }).then(function (d) {
                U.toast(cfg.title + ' updated — ' + d.pendingQty + ' unit(s) left');
                close();
                load();
              }).catch(function (e) { U.toast(e.message, 'error'); })
                .then(function () { U.busy(button, false); });
            });
          }
        });
      }

      U.modal({ title: cfg.title + ' job ' + row.id, body: body, actions: actions });
    }

    function chip(label, value) {
      return U.el('div', { class: 'qty-chip' }, [U.el('span', { text: label }), U.el('b', { text: String(value) })]);
    }

    return { render: render };
  }

  return { build: build };
})();

Views.repair = QueueView.build({
  key: 'repair',
  title: 'Repair queue',
  subtitle: 'Units that can be brought back to sellable condition.',
  listAction: 'getRepairQueue',
  updateAction: 'updateRepairStatus',
  dataset: 'repair',
  canUpdate: function () { return Auth.can('canRepair'); },
  emptyTitle: 'No pending repairs.',
  emptyHint: 'Items marked as needing repair will appear here.'
});
