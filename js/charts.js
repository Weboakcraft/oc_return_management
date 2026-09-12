/**
 * charts.js — small SVG chart renderer.
 *
 * A charting library would be one more thing to load from a CDN for three
 * chart types, so the three are drawn here: a stacked bar, a line and a
 * horizontal bar. Colours come from the CSS custom properties, so the charts
 * always match the status palette used everywhere else.
 */
window.Charts = (function () {

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function niceMax(value) {
    if (value <= 5) return 5;
    var mag = Math.pow(10, Math.floor(Math.log10(value)));
    var step = mag / 2;
    return Math.ceil(value / step) * step;
  }

  function frame(host, width, height) {
    U.clear(host);
    var svg = svgEl('svg', {
      class: 'chart', viewBox: '0 0 ' + width + ' ' + height,
      preserveAspectRatio: 'xMidYMid meet', role: 'img'
    });
    host.appendChild(svg);
    return svg;
  }

  function axes(svg, pad, width, height, max, ticks) {
    var steps = ticks || 4;
    for (var i = 0; i <= steps; i++) {
      var v = (max / steps) * i;
      var y = height - pad.bottom - ((height - pad.top - pad.bottom) * (v / (max || 1)));
      svg.appendChild(svgEl('line', {
        class: i === 0 ? 'axis' : 'gridline',
        x1: pad.left, x2: width - pad.right, y1: y, y2: y
      }));
      var label = svgEl('text', { x: pad.left - 6, y: y + 4, 'text-anchor': 'end' });
      label.textContent = Math.round(v);
      svg.appendChild(label);
    }
  }

  function labelEvery(count, width) {
    var perLabel = 52;
    return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / perLabel))));
  }

  /**
   * Stacked bars of OK / Repair / Damaged per period.
   * rows: [{period, okQty, repairQty, damagedQty}]
   */
  function stackedBars(host, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) { U.empty(host, 'No data for this period.', opts.emptyHint || ''); return; }
    var width = 760, height = opts.height || 240;
    var pad = { top: 14, right: 12, bottom: 34, left: 38 };
    var svg = frame(host, width, height);

    var max = niceMax(Math.max.apply(null, rows.map(function (r) {
      return (r.okQty || 0) + (r.repairQty || 0) + (r.damagedQty || 0);
    })) || 1);
    axes(svg, pad, width, height, max);

    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var slot = plotW / rows.length;
    var barW = Math.max(3, Math.min(30, slot * 0.62));
    var every = labelEvery(rows.length, plotW);

    rows.forEach(function (r, i) {
      var x = pad.left + slot * i + (slot - barW) / 2;
      var y = height - pad.bottom;
      [['damagedQty', 'bar-damage'], ['repairQty', 'bar-repair'], ['okQty', 'bar-ok']].forEach(function (part) {
        var v = r[part[0]] || 0;
        if (!v) return;
        var h = (v / max) * plotH;
        y -= h;
        var rect = svgEl('rect', { class: part[1], x: x, y: y, width: barW, height: h });
        rect.appendChild(svgEl('title', {})).textContent =
          r.period + ' — ' + part[0].replace('Qty', '') + ': ' + v;
        svg.appendChild(rect);
      });

      if (i % every === 0) {
        var t = svgEl('text', { x: x + barW / 2, y: height - pad.bottom + 16, 'text-anchor': 'middle' });
        t.textContent = shortPeriod(r.period);
        svg.appendChild(t);
      }
    });

    legend(host, [['var(--ok)', 'OK'], ['var(--repair)', 'Repair'], ['var(--damage)', 'Damaged']]);
  }

  /** Single line of total return quantity per period. */
  function line(host, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) { U.empty(host, 'No data for this period.', opts.emptyHint || ''); return; }
    var width = 760, height = opts.height || 220;
    var pad = { top: 14, right: 14, bottom: 34, left: 38 };
    var svg = frame(host, width, height);

    var key = opts.key || 'returnQty';
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r[key] || 0; })) || 1);
    axes(svg, pad, width, height, max);

    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var step = rows.length > 1 ? plotW / (rows.length - 1) : 0;
    var points = rows.map(function (r, i) {
      return {
        x: pad.left + step * i + (rows.length === 1 ? plotW / 2 : 0),
        y: height - pad.bottom - ((r[key] || 0) / max) * plotH,
        r: r
      };
    });

    svg.appendChild(svgEl('path', {
      class: 'line-total',
      d: points.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ')
    }));

    var every = labelEvery(rows.length, plotW);
    points.forEach(function (p, i) {
      var dot = svgEl('circle', { class: 'dot', cx: p.x, cy: p.y, r: rows.length > 40 ? 1.8 : 3 });
      var title = svgEl('title', {});
      title.textContent = p.r.period + ' — ' + (p.r[key] || 0) + ' units';
      dot.appendChild(title);
      svg.appendChild(dot);
      if (i % every === 0) {
        var t = svgEl('text', { x: p.x, y: height - pad.bottom + 16, 'text-anchor': 'middle' });
        t.textContent = shortPeriod(p.r.period);
        svg.appendChild(t);
      }
    });
  }

  /** Horizontal bars, used for source and product comparisons. */
  function horizontalBars(host, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) { U.empty(host, 'Nothing to compare yet.', opts.emptyHint || ''); return; }
    var labelKey = opts.labelKey || 'label';
    var rowH = 30;
    var width = 760, height = rows.length * rowH + 24;
    var pad = { left: 130, right: 46 };
    var svg = frame(host, width, height);
    var max = Math.max.apply(null, rows.map(function (r) {
      return (r.okQty || 0) + (r.repairQty || 0) + (r.damagedQty || 0);
    })) || 1;
    var plotW = width - pad.left - pad.right;

    rows.forEach(function (r, i) {
      var y = i * rowH + 12;
      var label = svgEl('text', { x: pad.left - 10, y: y + 13, 'text-anchor': 'end' });
      label.textContent = truncate(String(r[labelKey] || ''), 20);
      svg.appendChild(label);

      var x = pad.left;
      [['okQty', 'bar-ok'], ['repairQty', 'bar-repair'], ['damagedQty', 'bar-damage']].forEach(function (part) {
        var v = r[part[0]] || 0;
        if (!v) return;
        var w = (v / max) * plotW;
        var rect = svgEl('rect', { class: part[1], x: x, y: y, width: Math.max(1, w), height: 17, rx: 1 });
        rect.appendChild(svgEl('title', {})).textContent = r[labelKey] + ' — ' + part[0].replace('Qty', '') + ': ' + v;
        svg.appendChild(rect);
        x += w;
      });

      var total = (r.okQty || 0) + (r.repairQty || 0) + (r.damagedQty || 0);
      var tot = svgEl('text', { x: x + 6, y: y + 13 });
      tot.textContent = total;
      svg.appendChild(tot);
    });

    legend(host, [['var(--ok)', 'OK'], ['var(--repair)', 'Repair'], ['var(--damage)', 'Damaged']]);
  }

  function legend(host, entries) {
    var wrap = U.el('div', { class: 'chart-legend' });
    entries.forEach(function (e) {
      wrap.appendChild(U.el('span', {}, [
        U.el('i', { style: 'background:' + e[0] }), e[1]
      ]));
    });
    host.appendChild(wrap);
  }

  function shortPeriod(p) {
    var s = String(p || '');
    if (/^\d{4}-\d{2}$/.test(s)) {
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return months[Number(s.slice(5, 7)) - 1] + " '" + s.slice(2, 4);
    }
    if (s.indexOf(' wk') > -1) return s.slice(8, 10) + '/' + s.slice(5, 7);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(8, 10) + '/' + s.slice(5, 7);
    return s;
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  return { stackedBars: stackedBars, line: line, horizontalBars: horizontalBars };
})();
