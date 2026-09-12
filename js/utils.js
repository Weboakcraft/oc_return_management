/**
 * utils.js — small DOM and formatting helpers shared by every module.
 */
window.U = (function () {

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  /** yyyy-mm-dd to the format chosen in Settings. */
  function fmtDate(value, pattern) {
    if (!value) return '';
    var s = String(value).substring(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    var p = pattern || (window.STATE && STATE.settings && STATE.settings.dateFormat) || 'dd-MM-yyyy';
    return p.replace('yyyy', m[1]).replace('MM', m[2]).replace('dd', m[3]);
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function num(v) { return Number(v || 0).toLocaleString('en-IN'); }
  function pct(v) { return (Math.round(Number(v || 0) * 100) / 100) + '%'; }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 250);
    };
  }

  /* ------------------------------------------------------------- toasts */

  function toast(message, kind) {
    var host = $('#toasts');
    if (!host) { host = el('div', { id: 'toasts', class: 'toasts' }); document.body.appendChild(host); }
    var node = el('div', { class: 'toast' + (kind ? ' toast--' + kind : ''), role: 'status', text: message });
    host.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transition = 'opacity .3s';
      setTimeout(function () { node.remove(); }, 300);
    }, kind === 'error' ? 6000 : 3600);
  }

  /* -------------------------------------------------------------- modal */

  function modal(opts) {
    var backdrop = el('div', { class: 'modal-backdrop' });
    var box = el('div', { class: 'modal' + (opts.wide ? ' modal--wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    var body = el('div', { class: 'modal__body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);

    var foot = el('div', { class: 'modal__foot' });
    (opts.actions || []).forEach(function (a) {
      foot.appendChild(el('button', {
        class: 'btn ' + (a.class || ''), type: 'button',
        onclick: function (e) { a.onClick(close, e.currentTarget); }
      }, [a.label]));
    });

    box.appendChild(el('div', { class: 'modal__head' }, [
      el('h2', { text: opts.title || '' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Close', onclick: function () { close(); } }, ['✕'])
    ]));
    box.appendChild(body);
    if ((opts.actions || []).length) box.appendChild(foot);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    function close() {
      backdrop.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(); });

    var focusable = box.querySelector('input, select, textarea, button');
    if (focusable) focusable.focus();
    return { close: close, body: body, box: box };
  }

  /** Confirmation dialog for anything destructive or irreversible. */
  function confirm(opts) {
    return new Promise(function (resolve) {
      // The answer is recorded first and handed over in onClose, which every
      // exit runs through — the buttons, the ✕, Escape and the backdrop. A
      // promise settles once, so resolving inside the button handler as well
      // would be the second call and would be thrown away: the dialog would
      // then always read as Cancel, whatever was clicked.
      var answer = false;
      modal({
        title: opts.title || 'Confirm',
        body: el('p', { text: opts.message }),
        actions: [
          {
            label: opts.cancelLabel || 'Cancel',
            onClick: function (close) { answer = false; close(); }
          },
          {
            label: opts.confirmLabel || 'Confirm',
            class: opts.danger ? 'btn--danger' : 'btn--primary',
            onClick: function (close) { answer = true; close(); }
          }
        ],
        onClose: function () { resolve(answer); }
      });
    });
  }

  /* ------------------------------------------------------------ loading */

  function busy(button, on) {
    if (!button) return;
    button.disabled = !!on;
    button.classList.toggle('is-busy', !!on);
  }

  function skeleton(host, rows) {
    clear(host);
    var wrap = el('div', { class: 'loading-rows', style: 'padding:16px' });
    for (var i = 0; i < (rows || 4); i++) {
      wrap.appendChild(el('div', { class: 'skeleton', style: 'width:' + (60 + (i % 3) * 15) + '%' }));
    }
    host.appendChild(wrap);
  }

  function empty(host, title, hint) {
    clear(host);
    host.appendChild(el('div', { class: 'empty' }, [
      el('strong', { text: title }),
      hint ? el('span', { text: hint }) : null
    ]));
  }

  /* ------------------------------------------------------------- export */

  function downloadCsv(filename, csv) {
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function statusClass(status) {
    var s = String(status || '').toLowerCase();
    if (s.indexOf('ok') === 0 || s === 'completed' || s.indexOf('completed') > -1) return 'badge--ok';
    if (s.indexOf('repair') > -1) return 'badge--repair';
    if (s.indexOf('production') > -1) return 'badge--production';
    if (s.indexOf('damag') > -1) return 'badge--damage';
    return '';
  }

  function ageClass(days) {
    if (days > 15) return 'age age--late';
    if (days > 7) return 'age age--warn';
    return 'age';
  }

  return {
    el: el, esc: esc, $: $, $$: $$, clear: clear, fmtDate: fmtDate, today: today,
    num: num, pct: pct, debounce: debounce, toast: toast, modal: modal, confirm: confirm,
    busy: busy, skeleton: skeleton, empty: empty, downloadCsv: downloadCsv,
    statusClass: statusClass, ageClass: ageClass
  };
})();
