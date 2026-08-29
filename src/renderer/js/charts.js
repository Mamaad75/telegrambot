'use strict';
/* نمودارهای سبک SVG — بدون هیچ کتابخانه خارجی تا برنامه کاملاً آفلاین بماند */
(function (w) {
  const U = w.U;
  const PALETTE = ['#1f3a5f', '#0f766e', '#b54708', '#175cd3', '#7a3ba8', '#067647', '#b42318', '#8a6d1f'];

  function niceMax(v) {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const n = v / base;
    const step = n <= 1 ? 1 : (n <= 2 ? 2 : (n <= 5 ? 5 : 10));
    return step * base;
  }

  function shortNum(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v));
  }

  /**
   * نمودار خطی/میله‌ای چند سری
   * series: [{ name, color, values: [] , type:'line'|'bar' }]
   */
  function trendChart(el, labels, series, opt) {
    const o = opt || {};
    const W = el.clientWidth || 620;
    const H = o.height || 220;
    const padTop = 14, padBottom = 30, padRight = 8, padLeft = 52;
    const innerW = Math.max(40, W - padLeft - padRight);
    const innerH = H - padTop - padBottom;

    let max = 0, min = 0;
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (v > max) max = v; if (v < min) min = v; });
    });
    const top = niceMax(max || 1);
    const bottom = min < 0 ? -niceMax(-min) : 0;
    const span = top - bottom || 1;
    const y = function (v) { return padTop + innerH - ((v - bottom) / span) * innerH; };
    const n = labels.length;
    const step = n > 1 ? innerW / (n - 1) : innerW;
    const xAt = function (i) { return padLeft + (n > 1 ? i * step : innerW / 2); };

    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">';
    // خطوط راهنما
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = bottom + (span * t / ticks);
      const yy = y(v);
      svg += '<line x1="' + padLeft + '" y1="' + yy + '" x2="' + (W - padRight) + '" y2="' + yy + '" stroke="#eef2f7" stroke-width="1"/>';
      svg += '<text x="' + (W - padRight) + '" y="' + (yy - 3) + '" font-size="9" fill="#8b98a8" text-anchor="end" direction="ltr">' + shortNum(v) + '</text>';
    }

    // میله‌ها
    const bars = series.filter(function (s) { return s.type === 'bar'; });
    if (bars.length) {
      const groupW = (step || innerW) * 0.62;
      const bw = Math.max(2, groupW / bars.length);
      bars.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          const x = xAt(i) - groupW / 2 + si * bw;
          const yy = y(Math.max(v, 0));
          const h = Math.abs(y(v) - y(0));
          svg += '<rect x="' + x + '" y="' + yy + '" width="' + Math.max(1, bw - 1) + '" height="' + Math.max(1, h) + '" fill="' + (s.color || PALETTE[si]) + '" opacity=".85" rx="2"><title>' + U.esc(labels[i] + ' — ' + s.name + ': ' + U.money(v)) + '</title></rect>';
        });
      });
    }

    // خطوط
    series.filter(function (s) { return s.type !== 'bar'; }).forEach(function (s, si) {
      const color = s.color || PALETTE[(si + bars.length) % PALETTE.length];
      let d = '';
      s.values.forEach(function (v, i) { d += (i ? ' L' : 'M') + xAt(i) + ',' + y(v); });
      if (s.fill !== false) {
        const area = d + ' L' + xAt(n - 1) + ',' + y(bottom) + ' L' + xAt(0) + ',' + y(bottom) + ' Z';
        svg += '<path d="' + area + '" fill="' + color + '" opacity=".08"/>';
      }
      svg += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      s.values.forEach(function (v, i) {
        svg += '<circle cx="' + xAt(i) + '" cy="' + y(v) + '" r="2.6" fill="#fff" stroke="' + color + '" stroke-width="1.8"><title>' + U.esc(labels[i] + ' — ' + s.name + ': ' + U.money(v)) + '</title></circle>';
      });
    });

    // برچسب محور افقی
    const labelStep = Math.max(1, Math.ceil(n / 10));
    labels.forEach(function (l, i) {
      if (i % labelStep !== 0 && i !== n - 1) return;
      svg += '<text x="' + xAt(i) + '" y="' + (H - 10) + '" font-size="9" fill="#8b98a8" text-anchor="middle">' + U.esc(l) + '</text>';
    });
    svg += '</svg>';

    let legend = '<div class="chart-legend">';
    series.forEach(function (s, si) {
      legend += '<span><span class="dot" style="background:' + (s.color || PALETTE[si % PALETTE.length]) + '"></span>' + U.esc(s.name) + '</span>';
    });
    legend += '</div>';

    el.innerHTML = svg + legend;
  }

  /** نمودار دایره‌ای (حلقه‌ای) */
  function donutChart(el, items, opt) {
    const o = opt || {};
    const size = o.size || 190;
    const r = size / 2 - 6;
    const inner = r * 0.6;
    const cx = size / 2, cy = size / 2;
    const total = items.reduce(function (a, i) { return a + Math.abs(i.value); }, 0);
    let svg = '<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">';
    if (!total) {
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#eef2f7" stroke-width="' + (r - inner) + '"/>';
      svg += '<text x="' + cx + '" y="' + (cy + 4) + '" font-size="11" fill="#8b98a8" text-anchor="middle">بدون داده</text>';
    } else {
      let angle = -Math.PI / 2;
      items.forEach(function (it, i) {
        const frac = Math.abs(it.value) / total;
        const a2 = angle + frac * Math.PI * 2;
        const large = frac > 0.5 ? 1 : 0;
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
        const xi2 = cx + inner * Math.cos(a2), yi2 = cy + inner * Math.sin(a2);
        const xi1 = cx + inner * Math.cos(angle), yi1 = cy + inner * Math.sin(angle);
        const color = it.color || PALETTE[i % PALETTE.length];
        svg += '<path d="M' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 +
          ' L' + xi2 + ',' + yi2 + ' A' + inner + ',' + inner + ' 0 ' + large + ' 0 ' + xi1 + ',' + yi1 + ' Z" fill="' + color + '">' +
          '<title>' + U.esc(it.label + ': ' + U.money(it.value) + ' (' + Math.round(frac * 100) + '٪)') + '</title></path>';
        angle = a2;
      });
      svg += '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="10" fill="#8b98a8" text-anchor="middle">جمع</text>';
      svg += '<text x="' + cx + '" y="' + (cy + 13) + '" font-size="12" font-weight="700" fill="#16202e" text-anchor="middle" direction="ltr">' + shortNum(total) + '</text>';
    }
    svg += '</svg>';

    let legend = '<div class="chart-legend">';
    items.forEach(function (it, i) {
      const pct = total ? Math.round(Math.abs(it.value) / total * 100) : 0;
      legend += '<span><span class="dot" style="background:' + (it.color || PALETTE[i % PALETTE.length]) + '"></span>' +
        U.esc(it.label) + ' (' + U.esc(String(pct)) + '٪)</span>';
    });
    legend += '</div>';
    el.innerHTML = '<div style="display:flex;justify-content:center">' + svg + '</div>' + legend;
  }

  /** میله افقی ساده برای رتبه‌بندی */
  function barList(el, items) {
    const max = items.reduce(function (a, i) { return Math.max(a, Math.abs(i.value)); }, 0) || 1;
    let html = '<div style="display:flex;flex-direction:column;gap:7px">';
    items.forEach(function (it, i) {
      const pct = Math.round(Math.abs(it.value) / max * 100);
      html += '<div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:2px">' +
        '<span>' + U.esc(it.label) + '</span><span class="money">' + U.money(it.value) + '</span></div>' +
        '<div style="height:7px;background:#eef2f7;border-radius:4px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + (it.color || PALETTE[i % PALETTE.length]) + ';border-radius:4px"></div>' +
        '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  w.Charts = { trend: trendChart, donut: donutChart, barList: barList, PALETTE: PALETTE };
})(window);
