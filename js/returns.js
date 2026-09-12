/**
 * returns.js — return entry, list, detail and inspection.
 *
 * The entry form is the screen staff use most, so it is built around one
 * rule: you cannot save until every returned unit has been accounted for.
 * The remaining counter says exactly how many units are still unassigned.
 */

/* ============================================================ shared parts */

var ReturnParts = (function () {

  /**
   * Ranks products against typed or dictated text.
   *
   * Dictation is why this is not a plain substring filter: someone saying
   * "oak dc zero zero one" should still land on OAK-DC-001, so SKUs are
   * compared with every separator stripped out of both sides.
   */
  function matchProducts(term) {
    var raw = String(term || '').trim().toLowerCase();
    if (!raw) return STATE.products.slice(0, 30);

    var spoken = window.Voice ? Voice.normalise(raw) : raw;
    var squashed = spoken.replace(/[^a-z0-9]/g, '');
    var words = spoken.split(/\s+/).filter(Boolean);

    return STATE.products.map(function (p) {
      var name = String(p.name).toLowerCase();
      var sku = String(p.sku).toLowerCase();
      var skuSquashed = sku.replace(/[^a-z0-9]/g, '');
      var score = 0;

      if (squashed && skuSquashed === squashed) score = 100;
      else if (squashed.length > 2 && skuSquashed.indexOf(squashed) > -1) score = 70;
      else if (name === spoken) score = 90;
      else if (name.indexOf(raw) > -1 || sku.indexOf(raw) > -1) score = 55;
      else if (words.length && words.every(function (w) { return name.indexOf(w) > -1; })) score = 40;
      else if (words.some(function (w) { return w.length > 2 && name.indexOf(w) > -1; })) score = 15;

      return { product: p, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 30)
      .map(function (x) { return x.product; });
  }

  /** Searchable product picker. Products come from STATE, never hard-coded. */
  function productPicker(onPick, initial) {
    var wrap = U.el('div', { class: 'picker' });
    var input = U.el('input', {
      type: 'text', class: 'input', placeholder: 'Search product or SKU',
      autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-label': 'Product'
    });
    if (initial) input.value = initial.name + ' · ' + initial.sku;
    var list = U.el('div', { class: 'picker__list hidden' });
    var activeIndex = -1;
    var matches = [];

    function search(term) {
      matches = matchProducts(term);
      U.clear(list);
      if (!matches.length) {
        list.appendChild(U.el('div', { class: 'picker__empty', text: 'No product matches that. Ask an administrator to add it.' }));
      }
      matches.forEach(function (p, i) {
        list.appendChild(U.el('div', {
          class: 'picker__opt' + (i === activeIndex ? ' is-active' : ''),
          role: 'option',
          onmousedown: function (e) { e.preventDefault(); choose(p); }
        }, [
          document.createTextNode(p.name),
          U.el('span', { class: 'sku', text: p.sku + (p.category ? ' · ' + p.category : '') })
        ]));
      });
      open(true);
    }

    function open(on) {
      list.classList.toggle('hidden', !on);
      input.setAttribute('aria-expanded', on ? 'true' : 'false');
    }

    function choose(p) {
      input.value = p.name + ' · ' + p.sku;
      open(false);
      Validate.mark(input, null);
      onPick(p);
    }

    input.addEventListener('focus', function () { search(''); });
    input.addEventListener('input', function () { activeIndex = -1; onPick(null); search(input.value); });
    input.addEventListener('blur', function () { setTimeout(function () { open(false); }, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex += e.key === 'ArrowDown' ? 1 : -1;
        if (activeIndex < 0) activeIndex = matches.length - 1;
        if (activeIndex >= matches.length) activeIndex = 0;
        search(input.value);
      } else if (e.key === 'Enter' && activeIndex > -1 && matches[activeIndex]) {
        e.preventDefault();
        choose(matches[activeIndex]);
      } else if (e.key === 'Escape') open(false);
    });

    /**
     * Handles a dictated product name. One clear match is selected outright,
     * because making someone confirm the only possible answer is busywork.
     * Anything else opens the list with the results already filtered.
     */
    function acceptDictation(text) {
      input.value = text;
      activeIndex = -1;
      search(text);

      if (matches.length === 1) {
        choose(matches[0]);
        U.toast('Heard "' + text + '" — selected ' + matches[0].name);
      } else if (matches.length > 1) {
        U.toast('Heard "' + text + '" — ' + matches.length + ' products match, pick one.');
        input.focus();
      } else {
        U.toast('Heard "' + text + '", but no product matches. Edit the text or type it.', 'warn');
        input.focus();
      }
    }

    var row = U.el('div', { class: 'picker__row' }, [input]);
    var mic = window.Voice && (!window.STATE || STATE.settings.featureVoice !== false)
      ? Voice.button({ label: 'Say the product name', onText: acceptDictation })
      : null;
    if (mic) row.appendChild(mic);

    wrap.appendChild(row);
    wrap.appendChild(list);
    return { node: wrap, input: input, dictate: acceptDictation };
  }

  /**
   * The quantity control. Below two units it shows one status choice; above
   * that it shows three boxes and a live remaining counter.
   * Returns { node, refresh, read, setQty }.
   */
  function quantityEditor(state, onChange) {
    var host = U.el('div');
    var controls = U.el('div');
    var prodHost = U.el('div');
    host.appendChild(controls);
    host.appendChild(prodHost);
    var lastDamaged = -1;

    function read() { return state; }

    function refresh() {
      U.clear(controls);
      var host = controls; // controls are rebuilt; production is painted separately
      var qty = Number(state.returnQty || 0);

      if (qty === 1) {
        // One unit: a single status is all that is needed.
        var group = U.el('div', { class: 'status-choice' });
        [['OK Return', 'ok'], ['Repair Needed', 'repair'], ['Damaged Return', 'damage']].forEach(function (opt, i) {
          var id = 'st-' + Math.random().toString(36).slice(2) + i;
          var radio = U.el('input', {
            type: 'radio', name: 'status-' + state.uid, id: id, value: opt[0],
            checked: state.status === opt[0]
          });
          radio.addEventListener('change', function () {
            state.status = opt[0];
            state.okQty = opt[0] === 'OK Return' ? 1 : 0;
            state.repairQty = opt[0] === 'Repair Needed' ? 1 : 0;
            state.damagedQty = opt[0] === 'Damaged Return' ? 1 : 0;
            if (state.damagedQty === 0) state.productionQty = 0;
            refresh();
            onChange();
          });
          group.appendChild(radio);
          group.appendChild(U.el('label', { for: id, class: opt[1], text: opt[0] }));
        });
        host.appendChild(group);

      } else if (qty > 1) {
        var grid = U.el('div', { class: 'qty-split' });
        [['okQty', 'OK', 'ok'], ['repairQty', 'Repair', 'repair'], ['damagedQty', 'Damaged', 'damage']].forEach(function (f) {
          var input = U.el('input', {
            type: 'number', min: '0', step: '1', inputmode: 'numeric',
            value: state[f[0]] || 0, 'aria-label': f[1] + ' quantity'
          });
          input.addEventListener('input', function () {
            state[f[0]] = input.value === '' ? 0 : Number(input.value);
            if (f[0] === 'damagedQty' && Number(state.productionQty || 0) > Number(state.damagedQty || 0)) {
              state.productionQty = state.damagedQty;
            }
            paintRemaining();
            paintProduction();
            onChange();
          });
          grid.appendChild(U.el('div', { class: 'qty-box qty-box--' + f[2] }, [
            U.el('label', { text: f[1] }), input
          ]));
        });
        host.appendChild(grid);
        host.appendChild(U.el('div', { class: 'remaining', id: 'rem-' + state.uid }));
        paintRemaining();
      } else {
        host.appendChild(U.el('p', { class: 'hint muted', text: 'Enter how many units came back, then record their condition.' }));
      }

      paintProduction();
    }

    /**
     * Production is offered the moment a damaged unit is entered, and taken
     * away again when damage returns to zero. It is painted on its own so
     * typing in the damaged box never loses focus.
     */
    function paintProduction() {
      var damaged = Number(state.damagedQty || 0);
      if (damaged === lastDamaged) return;
      lastDamaged = damaged;
      U.clear(prodHost);
      if (damaged <= 0 || STATE.settings.featureProduction === false) return;

      var pInput = U.el('input', {
        type: 'number', min: '0', max: String(damaged), step: '1', inputmode: 'numeric',
        value: state.productionQty || 0, 'aria-label': 'Units going to production'
      });
      pInput.addEventListener('input', function () {
        state.productionQty = pInput.value === '' ? 0 : Number(pInput.value);
        Validate.mark(pInput, state.productionQty > Number(state.damagedQty || 0)
          ? 'Cannot be more than the ' + state.damagedQty + ' damaged unit(s).' : null);
        onChange();
      });

      prodHost.appendChild(U.el('div', { class: 'prod-toggle' }, [
        U.el('div', { class: 'row' }, [
          U.el('span', { text: 'Send to production' }),
          pInput,
          U.el('span', { class: 'small', text: 'of ' + damaged + ' damaged' })
        ]),
        U.el('div', { class: 'small', style: 'margin-top:6px', text: 'These units stay counted inside the damaged figure. They are never added on top of it.' })
      ]));
    }

    function paintRemaining() {
      var box = controls.querySelector('#rem-' + state.uid);
      if (!box) return;
      var check = Validate.item(Object.assign({ inspected: true }, state));
      var remaining = check.remaining;
      box.className = 'remaining' + (remaining === 0 ? ' is-balanced' : (remaining < 0 ? ' is-over' : ''));
      U.clear(box);
      if (remaining === 0) {
        box.appendChild(U.el('span', { text: 'All ' + state.returnQty + ' units accounted for.' }));
      } else if (remaining > 0) {
        box.appendChild(U.el('b', { text: String(remaining) }));
        box.appendChild(U.el('span', { text: ' unit' + (remaining === 1 ? '' : 's') + ' still to classify.' }));
      } else {
        box.appendChild(U.el('b', { text: String(Math.abs(remaining)) }));
        box.appendChild(U.el('span', { text: ' unit' + (remaining === -1 ? '' : 's') + ' more than came back. Reduce a quantity.' }));
      }
    }

    refresh();
    return { node: host, refresh: refresh, read: read, paintRemaining: paintRemaining };
  }

  return { productPicker: productPicker, quantityEditor: quantityEditor };
})();

/* ============================================================ entry form */

Views.newReturn = (function () {

  var lines = [];
  var header = {};
  var uid = 0;

  function render(host) {
    U.clear(host);
    lines = [];
    header = {
      orderId: '', returnDate: U.today(), receivedDate: U.today(),
      source: '', employeeId: (STATE.user || {}).employeeId || '', remarks: '', inspected: true
    };

    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'New return' }),
        U.el('p', { text: 'Record what came back and what condition it is in.' })
      ])
    ]));

    if (!Auth.can('canCreateReturn')) {
      U.empty(host, 'You do not have access to record returns.', 'Ask an administrator if this is wrong.');
      return;
    }

    var form = U.el('div', { class: 'panel' });
    var body = U.el('div', { class: 'panel__body' });
    form.appendChild(body);

    body.appendChild(headerFields());
    body.appendChild(U.el('div', { id: 'lines' }));
    body.appendChild(U.el('button', {
      class: 'btn', type: 'button', style: 'margin-bottom:14px',
      onclick: function () { addLine(); }
    }, ['Add another product']));

    body.appendChild(U.el('div', { class: 'field' }, [
      U.el('label', { for: 'ret-remarks', text: 'Remarks' }),
      U.el('textarea', { id: 'ret-remarks', placeholder: 'Anything the next person should know', oninput: function (e) { header.remarks = e.target.value; } })
    ]));

    var saveBtn = U.el('button', { class: 'btn btn--primary', type: 'button', id: 'save-return', disabled: true }, ['Save return']);
    saveBtn.addEventListener('click', function () { submit(saveBtn); });

    body.appendChild(U.el('div', { class: 'sticky-actions' }, [
      U.el('button', { class: 'btn', type: 'button', onclick: function () { render(host); } }, ['Clear form']),
      saveBtn
    ]));

    host.appendChild(form);
    addLine();
  }

  function headerFields() {
    var wrap = U.el('fieldset', { class: 'group' }, [U.el('legend', { text: 'Return details' })]);
    var grid = U.el('div', { class: 'field-grid' });

    var order = U.el('input', { type: 'text', id: 'f-order', placeholder: 'e.g. 404-1234567-8901234', autocomplete: 'off' });
    order.addEventListener('input', function () { header.orderId = order.value.trim(); validate(); });
    grid.appendChild(field('Ecommerce order ID' + (STATE.settings.requireOrderId ? '' : ' (optional)'), order, 'f-order'));

    var source = U.el('select', { id: 'f-source' });
    source.appendChild(U.el('option', { value: '' }, ['Choose a source']));
    STATE.sources.forEach(function (s) { source.appendChild(U.el('option', { value: s.name }, [s.name])); });
    source.addEventListener('change', function () { header.source = source.value; validate(); });
    grid.appendChild(field('Return source', source, 'f-source'));

    var date = U.el('input', { type: 'date', id: 'f-date', value: header.returnDate, max: U.today() });
    date.addEventListener('change', function () { header.returnDate = date.value; validate(); });
    grid.appendChild(field('Return date', date, 'f-date'));

    var emp = U.el('select', { id: 'f-emp' });
    STATE.employees.forEach(function (e) {
      emp.appendChild(U.el('option', { value: e.employeeId, selected: e.employeeId === header.employeeId }, [e.name + ' · ' + (e.department || '')]));
    });
    emp.addEventListener('change', function () { header.employeeId = emp.value; });
    grid.appendChild(field('Received by', emp, 'f-emp'));

    wrap.appendChild(grid);

    var chk = U.el('input', { type: 'checkbox', id: 'f-inspected', checked: true, style: 'width:auto;min-height:auto' });
    chk.addEventListener('change', function () {
      header.inspected = chk.checked;
      lines.forEach(function (l) { l.state.inspected = chk.checked; });
      paintLines();
      validate();
    });
    wrap.appendChild(U.el('div', { class: 'field' }, [
      U.el('label', { for: 'f-inspected', class: 'row', style: 'font-weight:400' }, [
        chk, U.el('span', { text: 'Inspect these items now' })
      ]),
      U.el('div', { class: 'hint', text: 'Leave this off to log the delivery first. The items will sit in Pending inspection until someone checks them.' })
    ]));

    return wrap;
  }

  function field(label, control, id) {
    return U.el('div', { class: 'field' }, [U.el('label', { for: id, text: label }), control]);
  }

  /* ------------------------------------------------------------ lines */

  function addLine() {
    uid++;
    lines.push({
      state: {
        uid: uid, productId: '', product: null, returnQty: 1, status: '',
        okQty: 0, repairQty: 0, damagedQty: 0, productionQty: 0, remarks: '',
        inspected: header.inspected
      }
    });
    paintLines();
    validate();
  }

  function removeLine(uidToRemove) {
    lines = lines.filter(function (l) { return l.state.uid !== uidToRemove; });
    if (!lines.length) addLine(); else { paintLines(); validate(); }
  }

  function paintLines() {
    var host = U.$('#lines');
    U.clear(host);
    lines.forEach(function (line, index) {
      host.appendChild(lineCard(line, index));
    });
  }

  function lineCard(line, index) {
    var s = line.state;
    var card = U.el('div', { class: 'item-card' });

    card.appendChild(U.el('div', { class: 'item-card__head' }, [
      U.el('strong', { text: 'Product ' + (index + 1) }),
      U.el('span', { class: 'spacer' }),
      lines.length > 1 ? U.el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: function () { removeLine(s.uid); }
      }, ['Remove']) : null
    ]));

    var grid = U.el('div', { class: 'field-grid' });

    var picker = ReturnParts.productPicker(function (p) {
      s.productId = p ? p.productId : '';
      s.product = p;
      validate();
    }, s.product);
    grid.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Product' }), picker.node]));
    line.pickerInput = picker.input;

    var qty = U.el('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', value: s.returnQty, 'aria-label': 'Return quantity' });
    qty.addEventListener('input', function () {
      s.returnQty = qty.value === '' ? '' : Number(qty.value);
      if (Number(s.returnQty) === 1) { s.okQty = 0; s.repairQty = 0; s.damagedQty = 0; s.status = ''; }
      if (Number(s.returnQty) > 1) s.status = '';
      s.productionQty = 0;
      editor.refresh();
      onLineChange();
    });
    grid.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Return quantity' }), qty]));
    line.qtyInput = qty;

    card.appendChild(grid);

    var editorHost = U.el('div', { class: 'field' });
    var gallery = null;

    // Quantity changes move the photo tabs: a line with no damaged units has
    // no damaged condition to photograph.
    function onLineChange() {
      validate();
      if (gallery) gallery.refresh();
    }

    var editor = ReturnParts.quantityEditor(s, onLineChange);
    if (s.inspected) {
      editorHost.appendChild(U.el('label', { text: 'Condition' }));
      editorHost.appendChild(editor.node);
    } else {
      editorHost.appendChild(U.el('p', { class: 'hint muted', text: 'Condition will be recorded during inspection.' }));
    }

    // Photographs belong with the condition: they are the evidence for it.
    if (window.Photos && Photos.enabled()) {
      var photoHost = U.el('div', { class: 'photo-block' });
      gallery = Photos.pendingStrip(photoHost, s);
      editorHost.appendChild(photoHost);
    }

    card.appendChild(editorHost);
    line.editor = editor;
    line.gallery = gallery;

    var remarks = U.el('input', { type: 'text', placeholder: 'Item note (optional)', value: s.remarks });
    remarks.addEventListener('input', function () { s.remarks = remarks.value; });
    card.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: 'Item note' }), remarks]));

    return card;
  }

  /* --------------------------------------------------------- validation */

  function validate() {
    var payloadLines = lines.map(function (l) {
      return Object.assign({}, l.state, { inspected: header.inspected });
    });
    var result = Validate.form(Object.assign({ requireOrderId: STATE.settings.requireOrderId }, header), payloadLines);

    lines.forEach(function (l, i) {
      var r = result.lines[i];
      if (l.pickerInput) Validate.mark(l.pickerInput, r.errors.productId || null);
      if (l.qtyInput) Validate.mark(l.qtyInput, r.errors.returnQty || null);
    });

    var btn = U.$('#save-return');
    if (btn) btn.disabled = !result.valid;
    return result;
  }

  function submit(button) {
    var result = validate();
    if (!result.valid) {
      var msg = result.errors.returnDate || result.errors.source || result.errors.orderId ||
        (result.lines.filter(function (r) { return r.message; })[0] || {}).message ||
        'Check the highlighted fields.';
      U.toast(msg, 'error');
      return;
    }

    var payload = {
      orderId: header.orderId,
      returnDate: header.returnDate,
      receivedDate: header.receivedDate,
      source: header.source,
      employeeId: header.employeeId,
      remarks: header.remarks,
      inspected: header.inspected,
      items: lines.map(function (l) {
        var s = l.state;
        return {
          productId: s.productId,
          returnQty: Number(s.returnQty),
          status: Number(s.returnQty) === 1 ? s.status : '',
          okQty: Number(s.okQty || 0),
          repairQty: Number(s.repairQty || 0),
          damagedQty: Number(s.damagedQty || 0),
          productionQty: Number(s.productionQty || 0),
          remarks: s.remarks
        };
      })
    };

    // Keep a reference before the form is rebuilt: photos live on these lines.
    var submitted = lines.slice();
    var photoCount = submitted.reduce(function (n, l) {
      return n + ((l.state.photos || []).length);
    }, 0);

    U.busy(button, true);
    API.call('createReturn', payload).then(function (data) {
      if (!photoCount) { finish(data, null); return null; }

      U.toast('Saved ' + data.returnId + '. Uploading ' + photoCount +
        ' photo' + (photoCount === 1 ? '' : 's') + '…');
      return Photos.uploadPending(submitted, data.items || []).then(function (result) {
        finish(data, result);
      });
    }).catch(function (err) {
      U.toast(err.message, 'error');
    }).then(function () { U.busy(button, false); });

    function finish(data, photoResult) {
      var message = 'Saved ' + data.returnId + ' — ' + data.totalQty + ' unit(s)';
      if (photoResult && photoResult.failed) {
        // The return is safe either way; say plainly which part did not land.
        U.toast(message + '. ' + photoResult.failed + ' of ' + photoResult.total +
          ' photos failed to upload — add them again from the return.', 'error');
      } else if (photoResult) {
        U.toast(message + ' with ' + photoResult.uploaded +
          ' photo' + (photoResult.uploaded === 1 ? '' : 's'));
      } else {
        U.toast(message);
      }
      var host = U.$('#view');
      render(host);
      host.insertBefore(savedBanner(data.returnId), host.children[1]);
    }
  }

  function savedBanner(returnId) {
    return U.el('div', { class: 'panel', style: 'border-color:var(--ok)' }, [
      U.el('div', { class: 'panel__body row' }, [
        U.el('div', {}, [
          U.el('strong', { text: 'Return saved' }),
          U.el('div', { class: 'small muted mono', text: returnId })
        ]),
        U.el('span', { class: 'spacer' }),
        U.el('button', {
          class: 'btn btn--sm', onclick: function () { location.hash = '#/return/' + encodeURIComponent(returnId); }
        }, ['Open it'])
      ])
    ]);
  }

  return { render: render };
})();

/* ====================================================== list and detail */

Views.returns = (function () {

  var filters = { q: '', source: '', productId: '', status: '', employeeId: '', page: 1 };

  function render(host) {
    U.clear(host);
    filters.page = 1;

    host.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Returns' }),
        U.el('p', { text: 'Every returned item, one row per product.' })
      ]),
      U.el('div', { class: 'view__actions' }, [
        App.dateFilter(STATE.filters, function () { filters.page = 1; load(); }),
        App.exportButton('returns', filterExtras())
      ])
    ]));

    host.appendChild(filterBar());
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Results' }),
      U.el('span', { class: 'panel__note', id: 'list-totals' })
    ]));
    panel.appendChild(U.el('div', { class: 'panel__body panel__body--flush', id: 'list-body' }));
    host.appendChild(panel);
    load();
  }

  function filterExtras() {
    return {
      q: filters.q, source: filters.source, productId: filters.productId,
      status: filters.status, employeeId: filters.employeeId
    };
  }

  function filterBar() {
    var bar = U.el('div', { class: 'filters' });

    var q = U.el('input', { type: 'search', placeholder: 'Return ID, order ID, SKU, product', 'aria-label': 'Search' });
    q.addEventListener('input', U.debounce(function () { filters.q = q.value.trim(); filters.page = 1; load(); }, 350));
    bar.appendChild(U.el('div', { class: 'field field--wide' }, [U.el('label', { text: 'Search' }), q]));

    bar.appendChild(select('Source', STATE.sources.map(function (s) { return [s.name, s.name]; }), function (v) {
      filters.source = v; filters.page = 1; load();
    }));
    bar.appendChild(select('Product', STATE.products.map(function (p) { return [p.productId, p.name]; }), function (v) {
      filters.productId = v; filters.page = 1; load();
    }));
    bar.appendChild(select('Status', statusOptions(), function (v) {
      filters.status = v; filters.page = 1; load();
    }));
    bar.appendChild(select('Handled by', STATE.employees.map(function (e) { return [e.employeeId, e.name]; }), function (v) {
      filters.employeeId = v; filters.page = 1; load();
    }));

    bar.appendChild(U.el('div', { class: 'filters__actions' }, [
      U.el('button', {
        class: 'btn', type: 'button', onclick: function () {
          filters = { q: '', source: '', productId: '', status: '', employeeId: '', page: 1 };
          App.route();
        }
      }, ['Clear filters'])
    ]));
    return bar;
  }

  function statusOptions() {
    var out = [];
    Object.keys(STATE.statuses || {}).forEach(function (group) {
      (STATE.statuses[group] || []).forEach(function (s) { out.push([s.name, s.name]); });
    });
    return out;
  }

  function select(label, options, onChange) {
    var sel = U.el('select');
    sel.appendChild(U.el('option', { value: '' }, ['All']));
    options.forEach(function (o) { sel.appendChild(U.el('option', { value: o[0] }, [o[1]])); });
    sel.addEventListener('change', function () { onChange(sel.value); });
    return U.el('div', { class: 'field' }, [U.el('label', { text: label }), sel]);
  }

  function load() {
    var body = U.$('#list-body');
    if (!body) return;
    U.skeleton(body, 5);
    API.call('getReturns', App.filterPayload(Object.assign({ page: filters.page }, filterExtras())))
      .then(function (d) { paint(body, d); })
      .catch(function (err) { U.empty(body, 'Could not load returns', err.message); });
  }

  function paint(body, d) {
    U.clear(body);
    var totals = U.$('#list-totals');
    if (totals) {
      totals.textContent = d.total + ' item rows · ' + U.num(d.totals.returnQty) + ' units · OK ' +
        U.pct(d.totals.okPct) + ' · Repair ' + U.pct(d.totals.repairPct) + ' · Damaged ' + U.pct(d.totals.damagePct);
    }

    if (!d.rows.length) {
      U.empty(body, 'No returns found for the selected period.', 'Widen the date range or clear a filter.');
      return;
    }

    var wrap = U.el('div', { class: 'table-wrap' });
    var table = U.el('table', { class: 'grid' });
    table.appendChild(U.el('thead', {}, [U.el('tr', {}, [
      th('Return'), th('Date'), th('Source'), th('Product'),
      th('Qty', 'num'), th('OK', 'num'), th('Repair', 'num'), th('Damaged', 'num'),
      th('Status'), th('Age', 'num')
    ])]));

    var tbody = U.el('tbody');
    d.rows.forEach(function (r) {
      tbody.appendChild(U.el('tr', {}, [
        td(U.el('button', {
          class: 'id', onclick: function () { location.hash = '#/return/' + encodeURIComponent(r.returnId); }
        }, [r.returnId]), 'Return', [U.el('span', { class: 'cell-sub', text: r.orderId || '—' })]),
        td(U.fmtDate(r.returnDate), 'Date'),
        td(r.source, 'Source'),
        td(r.productName, 'Product', [U.el('span', { class: 'cell-sub mono', text: r.sku })]),
        td(String(r.returnQty), 'Qty', null, 'num'),
        td(String(r.okQty), 'OK', null, 'num'),
        td(String(r.repairQty), 'Repair', null, 'num'),
        td(String(r.damagedQty) + (r.productionQty ? ' (' + r.productionQty + '→prod)' : ''), 'Damaged', null, 'num'),
        td(U.el('span', { class: 'badge ' + U.statusClass(r.status), text: r.status }), 'Status'),
        td(U.el('span', { class: U.ageClass(r.ageingDays), text: r.ageingDays + 'd' }), 'Age', null, 'num')
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);

    var pages = Math.ceil(d.total / d.pageSize);
    if (pages > 1) {
      body.appendChild(U.el('div', { class: 'pagination' }, [
        U.el('button', {
          class: 'btn btn--sm', disabled: d.page <= 1,
          onclick: function () { filters.page = d.page - 1; load(); }
        }, ['Previous']),
        U.el('span', { text: 'Page ' + d.page + ' of ' + pages }),
        U.el('button', {
          class: 'btn btn--sm', disabled: d.page >= pages,
          onclick: function () { filters.page = d.page + 1; load(); }
        }, ['Next'])
      ]));
    }
  }

  function th(label, cls) { return U.el('th', { class: cls || '' }, [label]); }
  function td(content, label, extra, cls) {
    var cell = U.el('td', { 'data-label': label || '', class: cls || '' });
    cell.appendChild(typeof content === 'string' ? document.createTextNode(content) : content);
    (extra || []).forEach(function (n) { cell.appendChild(n); });
    return cell;
  }

  /* ------------------------------------------------------------- detail */

  function detail(host, returnId) {
    U.clear(host);
    U.$('#topbar-title').textContent = 'Return ' + returnId;
    U.skeleton(host, 6);

    API.call('getReturn', { returnId: returnId }).then(function (d) {
      U.clear(host);
      host.appendChild(U.el('div', { class: 'view__head' }, [
        U.el('div', {}, [
          U.el('h1', { text: d.header.returnId }),
          U.el('p', { text: (d.header.orderId ? 'Order ' + d.header.orderId + ' · ' : '') + d.header.source + ' · ' + U.fmtDate(d.header.returnDate) })
        ]),
        U.el('div', { class: 'view__actions' }, [
          U.el('button', { class: 'btn', onclick: function () { location.hash = '#/returns'; } }, ['Back to returns']),
          Auth.can('canAdmin') && d.header.active ? U.el('button', {
            class: 'btn btn--danger', onclick: function () { cancelReturn(d.header.returnId, host); }
          }, ['Cancel return']) : null
        ])
      ]));

      host.appendChild(summaryPanel(d));
      host.appendChild(itemsPanel(d, host));
      if (window.Photos && Photos.enabled()) host.appendChild(photosPanel(d));
      if (d.repairs.length) host.appendChild(workPanel('Repair', d.repairs, 'Repair_ID', 'Repair_Status'));
      if (d.production.length) host.appendChild(workPanel('Production', d.production, 'Production_ID', 'Production_Status'));
      host.appendChild(timelinePanel(d.timeline));
    }).catch(function (err) {
      U.empty(host, 'Could not open this return', err.message);
    });
  }

  function summaryPanel(d) {
    var t = d.totals;
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Return information' }),
      U.el('span', { class: 'badge ' + U.statusClass(d.header.overallStatus), text: d.header.overallStatus })
    ]));

    var body = U.el('div', { class: 'panel__body' });
    var dl = U.el('dl', { class: 'detail-grid' });
    [
      ['Order ID', d.header.orderId || '—'],
      ['Source', d.header.source],
      ['Return date', U.fmtDate(d.header.returnDate)],
      ['Received by', d.header.employeeName],
      ['Inspection', d.header.inspectionStatus],
      ['Age', d.header.ageingDays + ' day(s)'],
      ['Recorded by', d.header.createdBy]
    ].forEach(function (pair) {
      dl.appendChild(U.el('dt', { text: pair[0] }));
      dl.appendChild(U.el('dd', { text: String(pair[1]) }));
    });
    body.appendChild(dl);

    body.appendChild(U.el('h3', { text: 'Inspection result', style: 'margin:18px 0 8px' }));
    body.appendChild(U.el('div', { class: 'qty-strip' }, [
      chip('Units returned', t.returnQty, ''),
      chip('OK', t.okQty, 'ok'),
      chip('Repair', t.repairQty, 'repair'),
      chip('Damaged', t.damagedQty, 'damage'),
      chip('To production', t.productionQty, 'production')
    ]));
    body.appendChild(U.el('p', { class: 'small muted', style: 'margin-top:10px',
      text: 'Production units are part of the damaged figure, not extra units.' }));

    if (d.header.remarks) {
      body.appendChild(U.el('p', { class: 'small', style: 'margin-top:10px', text: 'Remarks: ' + d.header.remarks }));
    }
    panel.appendChild(body);
    return panel;
  }

  function chip(label, value, kind) {
    return U.el('div', { class: 'qty-chip' + (kind ? ' qty-chip--' + kind : '') }, [
      U.el('span', { text: label }), U.el('b', { text: U.num(value) })
    ]);
  }

  function itemsPanel(d, host) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [U.el('h2', { text: 'Products in this return' })]));
    var body = U.el('div', { class: 'panel__body panel__body--flush' });
    var wrap = U.el('div', { class: 'table-wrap' });
    var table = U.el('table', { class: 'grid' });
    table.appendChild(U.el('thead', {}, [U.el('tr', {}, [
      th('Product'), th('Qty', 'num'), th('OK', 'num'), th('Repair', 'num'), th('Damaged', 'num'),
      th('Production', 'num'), th('Status'), th('')
    ])]));
    var tbody = U.el('tbody');

    d.items.forEach(function (item) {
      var action = null;
      if (item.status === 'Pending Inspection' && Auth.can('canInspect')) {
        action = U.el('button', {
          class: 'btn btn--sm btn--primary',
          onclick: function () { inspectModal(item, function () { detail(host, d.header.returnId); }); }
        }, ['Inspect']);
      } else if (Auth.can('canInspect') && item.status !== 'Cancelled') {
        action = U.el('button', {
          class: 'btn btn--sm btn--ghost',
          onclick: function () { correctModal(item, function () { detail(host, d.header.returnId); }); }
        }, ['Correct']);
      }

      tbody.appendChild(U.el('tr', {}, [
        td(item.productName, 'Product', [U.el('span', { class: 'cell-sub mono', text: item.sku })]),
        td(String(item.returnQty), 'Qty', null, 'num'),
        td(String(item.okQty), 'OK', null, 'num'),
        td(String(item.repairQty) + (item.repairPendingQty ? ' · ' + item.repairPendingQty + ' left' : ''), 'Repair', null, 'num'),
        td(String(item.damagedQty), 'Damaged', null, 'num'),
        td(String(item.productionQty) + (item.productionPendingQty ? ' · ' + item.productionPendingQty + ' left' : ''), 'Production', null, 'num'),
        td(U.el('span', { class: 'badge ' + U.statusClass(item.status), text: item.status }), 'Status'),
        td(action || document.createTextNode(''), '')
      ]));
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    panel.appendChild(body);
    return panel;
  }

  /**
   * Condition photos, one strip per product. Kept in its own panel rather than
   * squeezed into the items table, because a photo is worth looking at and a
   * table cell is not the place to do it.
   */
  function photosPanel(d) {
    var canEdit = d.header.active &&
      (Auth.can('canInspect') || Auth.can('canRepair') || Auth.can('canProduce'));

    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Condition photos' }),
      U.el('span', { class: 'panel__note', text: canEdit ? 'Up to ' + Photos.maxPerItem() + ' per product' : 'Read only' })
    ]));

    var body = U.el('div', { class: 'panel__body' });
    d.items.forEach(function (item, index) {
      var block = U.el('div', { class: 'photo-block' + (index ? ' photo-block--next' : '') });
      block.appendChild(U.el('div', { class: 'photo-head' }, [
        U.el('span', { class: 'photo-head__label', text: item.productName }),
        U.el('span', { class: 'photo-head__count mono small', text: item.sku })
      ]));
      var strip = U.el('div');
      block.appendChild(strip);
      Photos.itemStrip(strip, item, { canEdit: canEdit });
      body.appendChild(block);
    });

    panel.appendChild(body);
    return panel;
  }

  function workPanel(title, rows, idField, statusField) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [U.el('h2', { text: title + ' work' })]));
    var wrap = U.el('div', { class: 'table-wrap' });
    var table = U.el('table', { class: 'grid' });
    table.appendChild(U.el('thead', {}, [U.el('tr', {}, [
      th('Reference'), th('Product'), th('Sent', 'num'), th('Done', 'num'), th('Pending', 'num'),
      th('Status'), th('Assigned to')
    ])]));
    var tbody = U.el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(U.el('tr', {}, [
        td(U.el('span', { class: 'mono small', text: r[idField] }), 'Reference'),
        td(r.Product_Name, 'Product', [U.el('span', { class: 'cell-sub mono', text: r.SKU })]),
        td(String(r.Quantity_Sent), 'Sent', null, 'num'),
        td(String(r.Completed_Qty), 'Done', null, 'num'),
        td(String(r.Pending_Qty), 'Pending', null, 'num'),
        td(U.el('span', { class: 'badge ' + U.statusClass(r[statusField]), text: r[statusField] }), 'Status'),
        td(r.Assigned_To || '—', 'Assigned to')
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(U.el('div', { class: 'panel__body panel__body--flush' }, [wrap]));
    return panel;
  }

  function timelinePanel(events) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'panel__head' }, [
      U.el('h2', { text: 'Processing timeline' }),
      U.el('span', { class: 'panel__note', text: 'Every step, in the order it happened' })
    ]));
    var body = U.el('div', { class: 'panel__body' });
    if (!events.length) {
      U.empty(body, 'No events recorded yet.', '');
    } else {
      var list = U.el('ul', { class: 'timeline' });
      events.forEach(function (e) {
        list.appendChild(U.el('li', { class: 'is-done' }, [
          U.el('div', { class: 'timeline__event', text: e.event }),
          U.el('div', { class: 'timeline__meta', text: e.at + ' · ' + e.user }),
          e.notes ? U.el('div', { class: 'timeline__note', text: e.notes }) : null
        ]));
      });
      body.appendChild(list);
    }
    panel.appendChild(body);
    return panel;
  }

  /* ---------------------------------------------------------- inspection */

  function inspectModal(item, onDone) {
    var state = {
      uid: 'insp', returnQty: item.returnQty, status: '',
      okQty: 0, repairQty: 0, damagedQty: 0, productionQty: 0, inspected: true
    };
    openQtyModal('Inspect ' + item.productName, item, state, function (payload, close, button) {
      payload.returnItemId = item.returnItemId;
      U.busy(button, true);
      API.call('inspectReturnItem', payload).then(function () {
        U.toast('Inspection saved');
        close();
        onDone();
      }).catch(function (e) { U.toast(e.message, 'error'); })
        .then(function () { U.busy(button, false); });
    });
  }

  function correctModal(item, onDone) {
    var state = {
      uid: 'corr', returnQty: item.returnQty, status: '',
      okQty: item.okQty, repairQty: item.repairQty, damagedQty: item.damagedQty,
      productionQty: item.productionQty, inspected: true
    };
    openQtyModal('Correct ' + item.productName, item, state, function (payload, close, button) {
      payload.returnItemId = item.returnItemId;
      payload.returnQty = item.returnQty;
      U.confirm({
        title: 'Correct recorded quantities',
        message: 'This rewrites the inspection result and is recorded in the audit log. Continue?',
        confirmLabel: 'Save correction'
      }).then(function (yes) {
        if (!yes) return;
        U.busy(button, true);
        API.call('updateReturnItem', payload).then(function () {
          U.toast('Quantities corrected');
          close();
          onDone();
        }).catch(function (e) { U.toast(e.message, 'error'); })
          .then(function () { U.busy(button, false); });
      });
    });
  }

  function openQtyModal(title, item, state, onSubmit) {
    var body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted small', text: item.sku + ' · ' + item.returnQty + ' unit(s) returned' }));
    var editor = ReturnParts.quantityEditor(state, check);
    body.appendChild(editor.node);
    var remarks = U.el('input', { type: 'text', placeholder: 'Note (optional)', value: item.remarks || '' });
    body.appendChild(U.el('div', { class: 'field', style: 'margin-top:14px' }, [U.el('label', { text: 'Note' }), remarks]));

    var m = U.modal({
      title: title,
      body: body,
      actions: [
        { label: 'Cancel', onClick: function (close) { close(); } },
        {
          label: 'Save', class: 'btn--primary', onClick: function (close, button) {
            var r = Validate.item(state);
            if (!r.valid) { U.toast(r.message || 'Check the quantities.', 'error'); return; }
            onSubmit({
              status: Number(state.returnQty) === 1 ? state.status : '',
              okQty: Number(state.okQty || 0),
              repairQty: Number(state.repairQty || 0),
              damagedQty: Number(state.damagedQty || 0),
              productionQty: Number(state.productionQty || 0),
              remarks: remarks.value
            }, close, button);
          }
        }
      ]
    });

    function check() { /* remaining counter repaints itself */ }
    return m;
  }

  function cancelReturn(returnId, host) {
    var input = U.el('input', { type: 'text', placeholder: 'Why is this being cancelled?' });
    U.modal({
      title: 'Cancel ' + returnId,
      body: U.el('div', {}, [
        U.el('p', { text: 'The return stays in the database and the audit trail, but drops out of reports.' }),
        U.el('div', { class: 'field' }, [U.el('label', { text: 'Reason' }), input])
      ]),
      actions: [
        { label: 'Keep it', onClick: function (close) { close(); } },
        {
          label: 'Cancel return', class: 'btn--danger', onClick: function (close, button) {
            if (!input.value.trim()) { U.toast('Enter a reason first.', 'error'); return; }
            U.busy(button, true);
            API.call('deactivateReturn', { returnId: returnId, reason: input.value.trim() }).then(function () {
              U.toast('Return cancelled');
              close();
              detail(host, returnId);
            }).catch(function (e) { U.toast(e.message, 'error'); })
              .then(function () { U.busy(button, false); });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------- global search */

  function searchModal(q) {
    var body = U.el('div');
    U.skeleton(body, 3);
    var m = U.modal({ title: 'Results for "' + q + '"', body: body, wide: true });

    API.call('searchReturns', { q: q, limit: 40 }).then(function (d) {
      U.clear(body);
      if (!d.rows.length) {
        U.empty(body, 'Nothing matched that search.', 'Try a Return ID, order ID, SKU or product name.');
        return;
      }
      var table = U.el('table', { class: 'grid' });
      table.appendChild(U.el('thead', {}, [U.el('tr', {}, [th('Return'), th('Product'), th('Qty', 'num'), th('Status')])]));
      var tbody = U.el('tbody');
      d.rows.forEach(function (r) {
        tbody.appendChild(U.el('tr', {}, [
          td(U.el('button', {
            class: 'id', onclick: function () { m.close(); location.hash = '#/return/' + encodeURIComponent(r.returnId); }
          }, [r.returnId]), 'Return', [U.el('span', { class: 'cell-sub', text: U.fmtDate(r.returnDate) })]),
          td(r.productName, 'Product', [U.el('span', { class: 'cell-sub mono', text: r.sku })]),
          td(String(r.returnQty), 'Qty', null, 'num'),
          td(U.el('span', { class: 'badge ' + U.statusClass(r.status), text: r.status }), 'Status')
        ]));
      });
      table.appendChild(tbody);
      body.appendChild(U.el('div', { class: 'table-wrap' }, [table]));
    }).catch(function (err) { U.empty(body, 'Search failed', err.message); });
  }

  return { render: render, detail: detail, searchModal: searchModal };
})();
