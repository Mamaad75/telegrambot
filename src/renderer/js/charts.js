/* نمودارهای سبک بر پایه SVG (بدون کتابخانه بیرونی) */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = () => global.U.fmt;

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined) continue;
      n.setAttribute(k, String(v));
    }
    return n;
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const mag = 10 ** Math.floor(Math.log10(v));
    const norm = v / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function shortNumber(v) {
    const n = Math.abs(Number(v) || 0);
    let text;
    if (n >= 1e9) text = (v / 1e9).toFixed(1).replace(/\.0$/, '') + ' میلیارد';
    else if (n >= 1e6) text = (v / 1e6).toFixed(1).replace(/\.0$/, '') + ' م';
    else if (n >= 1e3) text = Math.round(v / 1e3) + ' هزار';
    else text = String(Math.round(v));
    return global.Money.toPersianDigits(text);
  }

  /**
   * نمودار خطی/مساحتی چندسری.
   * series: [{name, color, values:[number]}] ، labels: [string]
   */
  function line(options) {
    const width = options.width || 720;
    const height = options.height || 210;
    const pad = { top: 14, right: 12, bottom: 26, left: 52 };
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });
    const series = (options.series || []).filter((s) => s.values && s.values.length);
    const labels = options.labels || [];
    const count = Math.max(...series.map((s) => s.values.length), 1);
    const maxVal = niceMax(Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(v)))));
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const x = (i) => pad.left + (count === 1 ? plotW / 2 : (i * plotW) / (count - 1));
    const y = (v) => pad.top + plotH - (Math.max(0, v) / maxVal) * plotH;

    for (let g = 0; g <= 4; g += 1) {
      const gy = pad.top + (g * plotH) / 4;
      svg.appendChild(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy, stroke: '#e8eef4', 'stroke-width': 1 }));
      svg.appendChild(Object.assign(svgEl('text', {
        x: pad.left - 6, y: gy + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#8296aa',
      }), { textContent: shortNumber(maxVal - (g * maxVal) / 4) }));
    }

    series.forEach((s) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      if (s.fill !== false) {
        svg.appendChild(svgEl('polygon', {
          points: `${pad.left},${pad.top + plotH} ${pts} ${x(s.values.length - 1)},${pad.top + plotH}`,
          fill: s.color, opacity: 0.08,
        }));
      }
      svg.appendChild(svgEl('polyline', {
        points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
      s.values.forEach((v, i) => {
        if (count > 24 && i % 3 !== 0) return;
        const c = svgEl('circle', { cx: x(i), cy: y(v), r: 2.6, fill: '#fff', stroke: s.color, 'stroke-width': 1.6 });
        const title = svgEl('title');
        title.textContent = `${labels[i] || ''} — ${s.name}: ${fmt().plain(v)}`;
        c.appendChild(title);
        svg.appendChild(c);
      });
    });

    const step = Math.max(1, Math.ceil(count / 8));
    labels.forEach((lb, i) => {
      if (i % step !== 0 && i !== count - 1) return;
      svg.appendChild(Object.assign(svgEl('text', {
        x: x(i), y: height - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#8296aa',
      }), { textContent: lb }));
    });

    const wrap = global.U.h('div');
    wrap.appendChild(svg);
    if (options.legend !== false) {
      wrap.appendChild(global.U.h('div', { class: 'chart-legend' }, series.map((s) => global.U.h('span', {
        html: `<i style="background:${s.color}"></i>${global.U.esc(s.name)}`,
      }))));
    }
    return wrap;
  }

  /** نمودار میله‌ای افقی (مناسب دسته‌بندی‌های فارسی) */
  function bars(options) {
    const rows = (options.rows || []).slice(0, options.limit || 8);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    const wrap = global.U.h('div', { style: 'display:flex;flex-direction:column;gap:9px' });
    if (!rows.length) return global.U.h('div', { class: 'empty', text: 'داده‌ای برای نمایش نیست.' });
    for (const r of rows) {
      wrap.appendChild(global.U.h('div', {}, [
        global.U.h('div', { style: 'display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px' }, [
          global.U.h('span', { text: r.label }),
          global.U.h('span', { class: 'num muted', text: fmt().plain(r.value) }),
        ]),
        global.U.h('div', { style: 'height:9px;background:#eef2f7;border-radius:6px;overflow:hidden' }, [
          global.U.h('div', {
            style: `height:100%;width:${Math.max(2, (Math.abs(r.value) / max) * 100)}%;background:${r.color || '#1b4a7a'};border-radius:6px`,
          }),
        ]),
      ]));
    }
    return wrap;
  }

  /** نمودار حلقه‌ای برای سهم روش‌های پرداخت */
  function donut(options) {
    const size = options.size || 168;
    const rows = (options.rows || []).filter((r) => r.value > 0);
    const total = rows.reduce((a, r) => a + r.value, 0);
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
    const cx = size / 2; const cy = size / 2; const rOuter = size / 2 - 4; const rInner = rOuter * 0.62;
    if (!total) {
      svg.appendChild(svgEl('circle', { cx, cy, r: (rOuter + rInner) / 2, fill: 'none', stroke: '#eef2f7', 'stroke-width': rOuter - rInner }));
    } else {
      let angle = -Math.PI / 2;
      for (const r of rows) {
        const slice = (r.value / total) * Math.PI * 2;
        const end = angle + slice;
        const large = slice > Math.PI ? 1 : 0;
        const p = svgEl('path', {
          d: [
            `M ${cx + rOuter * Math.cos(angle)} ${cy + rOuter * Math.sin(angle)}`,
            `A ${rOuter} ${rOuter} 0 ${large} 1 ${cx + rOuter * Math.cos(end)} ${cy + rOuter * Math.sin(end)}`,
            `L ${cx + rInner * Math.cos(end)} ${cy + rInner * Math.sin(end)}`,
            `A ${rInner} ${rInner} 0 ${large} 0 ${cx + rInner * Math.cos(angle)} ${cy + rInner * Math.sin(angle)}`,
            'Z',
          ].join(' '),
          fill: r.color,
        });
        const title = svgEl('title');
        title.textContent = `${r.label}: ${fmt().plain(r.value)} (${Math.round((r.value / total) * 100)}٪)`;
        p.appendChild(title);
        svg.appendChild(p);
        angle = end;
      }
    }
    const center = svgEl('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', 'font-size': 13, fill: '#16212e', 'font-weight': '700' });
    center.textContent = shortNumber(total);
    svg.appendChild(center);

    return global.U.h('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' }, [
      svg,
      global.U.h('div', { style: 'flex:1;min-width:150px;display:flex;flex-direction:column;gap:6px' },
        rows.map((r) => global.U.h('div', { style: 'display:flex;justify-content:space-between;font-size:12.5px;gap:8px' }, [
          global.U.h('span', { html: `<i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${r.color};margin-inline-end:6px"></i>${global.U.esc(r.label)}` }),
          global.U.h('span', { class: 'num muted', text: fmt().plain(r.value) }),
        ]))),
    ]);
  }

  global.Charts = { line, bars, donut, shortNumber, COLORS: ['#1b4a7a', '#0d7f6d', '#b7791f', '#8e44ad', '#c0392b', '#2c7bb6', '#6b7c8f'] };
}(window));
