/* اجزای رابط کاربری: پیام، پنجره، جدول، انتخاب تاریخ شمسی و جست‌وجوی خودکار */
(function (global) {
  'use strict';
  const { h, esc, fmt } = global.U ? global.U : {};

  // ── پیام‌ها ───────────────────────────────────────────────
  function toast(message, kind, ms) {
    const box = document.getElementById('toasts');
    const node = h('div', { class: 'toast ' + (kind || '') }, [
      h('span', { text: kind === 'ok' ? '✔' : (kind === 'bad' ? '✖' : (kind === 'warn' ? '!' : 'ℹ')) }),
      h('span', { text: message }),
    ]);
    box.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .2s';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 220);
    }, ms || (kind === 'bad' ? 6000 : 3200));
  }

  // ── پنجره ─────────────────────────────────────────────────
  let modalStack = [];

  function modal(options) {
    const opts = options || {};
    const content = h('div', { class: 'content' });
    if (typeof opts.content === 'string') content.innerHTML = opts.content;
    else if (opts.content) content.appendChild(opts.content);

    const footer = h('footer');
    const backdrop = h('div', { class: 'modal-backdrop' });
    const box = h('div', { class: 'modal ' + (opts.size || '') }, [
      h('header', {}, [
        h('h3', { text: opts.title || '' }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm', text: '✕', title: 'بستن (Esc)', onclick: () => requestClose() }),
      ]),
      content,
      footer,
    ]);
    backdrop.appendChild(box);

    const api = {
      el: box, content, footer, close, setBusy,
    };
    let busy = false;
    let closed = false;
    function setBusy(v) {
      busy = v;
      footer.querySelectorAll('button').forEach((b) => { b.disabled = v; });
    }
    /** بستن پنجره؛ فراخوانی از داخل عملیات همیشه مجاز است. */
    function close(result) {
      if (closed) return;
      closed = true;
      backdrop.remove();
      modalStack = modalStack.filter((m) => m !== api);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose(result);
    }
    /** بستن با درخواست کاربر (در حین انجام عملیات نادیده گرفته می‌شود) */
    function requestClose(result) {
      if (busy) return;
      close(result);
    }
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== api) return;
      if (e.key === 'Escape') { e.preventDefault(); requestClose(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && opts.buttons) {
        const primary = footer.querySelector('button.primary, button.success');
        if (primary) primary.click();
      }
    }

    for (const b of opts.buttons || []) {
      footer.appendChild(h('button', {
        class: 'btn ' + (b.kind || ''),
        text: b.label,
        onclick: async () => {
          if (!b.action) return requestClose();
          setBusy(true);
          try { await b.action(api); } finally { if (!closed) setBusy(false); }
          return undefined;
        },
      }));
    }
    if (!opts.hideCancel) {
      footer.appendChild(h('button', { class: 'btn ghost', text: opts.cancelLabel || 'انصراف', onclick: () => requestClose() }));
    }

    document.getElementById('modals').appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    modalStack.push(api);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) requestClose(); });
    setTimeout(() => {
      const focusable = content.querySelector('input,select,textarea,button');
      if (focusable) focusable.focus();
    }, 40);
    return api;
  }

  function confirm(message, options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: opts.title || 'تأیید عملیات',
        size: 'narrow',
        content: h('div', {}, [
          h('p', { text: message, style: 'margin:0 0 6px' }),
          opts.detail ? h('p', { class: 'muted', text: opts.detail, style: 'margin:0;font-size:12.5px' }) : null,
        ]),
        buttons: [{
          label: opts.okLabel || 'تأیید',
          kind: opts.danger ? 'danger' : 'primary',
          action: (api) => { done = true; api.close(); resolve(true); },
        }],
        cancelLabel: opts.cancelLabel || 'انصراف',
        onClose: () => { if (!done) resolve(false); },
      });
      return m;
    });
  }

  // ── جدول ──────────────────────────────────────────────────
  /**
   * ساخت جدول داده.
   * columns: [{title, key, type:'money'|'qty'|'date'|'text'|'center', render(row), width, footer}]
   */
  function table(options) {
    const cols = options.columns.filter(Boolean);
    const rows = options.rows || [];
    const wrap = h('div', { class: 'table-wrap' });
    if (!rows.length) {
      wrap.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big', text: options.emptyIcon || '📄' }),
        h('div', { text: options.empty || 'رکوردی برای نمایش وجود ندارد.' }),
      ]));
      return wrap;
    }
    const t = h('table', { class: 'grid-table' });
    const thead = h('thead');
    thead.appendChild(h('tr', {}, cols.map((c) => h('th', {
      class: c.type === 'money' || c.type === 'qty' ? 'num' : (c.type === 'center' || c.type === 'date' ? 'center' : ''),
      text: c.title,
      style: c.width ? `width:${c.width}` : null,
    }))));
    t.appendChild(thead);

    const tbody = h('tbody');
    rows.forEach((row, index) => {
      const tr = h('tr');
      if (options.onRowClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input')) return;
          options.onRowClick(row, index);
        });
      }
      for (const c of cols) {
        const td = h('td', {
          class: c.type === 'money' || c.type === 'qty' ? 'num' : (c.type === 'center' || c.type === 'date' ? 'center' : ''),
        });
        const raw = c.render ? c.render(row, index) : row[c.key];
        // خروجی render اگر رشته باشد نهایی است و دوباره قالب‌بندی نمی‌شود
        const needsFormat = !c.render || typeof raw === 'number';
        if (raw instanceof Node) td.appendChild(raw);
        else if (needsFormat && c.type === 'money') td.textContent = fmt.plain(raw);
        else if (needsFormat && c.type === 'qty') td.textContent = fmt.qty(raw);
        else if (needsFormat && c.type === 'date') td.textContent = fmt.date(raw);
        else td.textContent = raw === undefined || raw === null ? '' : String(raw);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);

    if (options.footer) {
      const tfoot = h('tfoot');
      tfoot.appendChild(h('tr', {}, cols.map((c) => h('td', {
        class: c.type === 'money' || c.type === 'qty' ? 'num' : '',
        text: options.footer[c.key] === undefined ? ''
          : (c.type === 'money' ? fmt.plain(options.footer[c.key])
            : (c.type === 'qty' ? fmt.qty(options.footer[c.key]) : String(options.footer[c.key]))),
      }))));
      t.appendChild(tfoot);
    }
    wrap.appendChild(t);
    return wrap;
  }

  // ── انتخاب تاریخ شمسی ─────────────────────────────────────
  /** ورودی تاریخ شمسی؛ مقدار داخلی همیشه میلادی ISO است. */
  function dateInput(options) {
    const opts = options || {};
    const input = h('input', {
      type: 'text', class: 'num', placeholder: '۱۴۰۴/۰۱/۰۱', dir: 'ltr',
      value: opts.value ? global.Money.toPersianDigits(global.Jalali.isoToJalali(opts.value)) : '',
      autocomplete: 'off',
    });
    const wrap = h('div', { class: 'autocomplete' }, [input]);
    let iso = opts.value || '';
    let popup = null;

    function setIso(v, silent) {
      iso = v || '';
      input.value = iso ? global.Money.toPersianDigits(global.Jalali.isoToJalali(iso)) : '';
      if (!silent && opts.onChange) opts.onChange(iso);
    }
    function commit() {
      const text = global.U.toLatinDigits(input.value).trim();
      if (!text) { setIso(''); return; }
      const parsed = global.Jalali.jalaliToIso(text.replace(/[-.]/g, '/'));
      if (parsed) setIso(parsed);
      else { toast('تاریخ وارد شده معتبر نیست.', 'warn'); setIso(iso); }
    }
    input.addEventListener('blur', () => setTimeout(() => { if (!popup) commit(); }, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); closePopup(); }
      if (e.key === 'ArrowDown' && !popup) { e.preventDefault(); openPopup(); }
      if (e.key === 'Escape') closePopup();
    });
    input.addEventListener('focus', () => openPopup());

    function closePopup() { if (popup) { popup.remove(); popup = null; } }

    function openPopup() {
      if (popup) return;
      const base = iso || global.Jalali.todayIso();
      const j = global.Jalali.toJalali(...base.split('-').map(Number));
      let viewY = j.jy; let viewM = j.jm;
      popup = h('div', { class: 'results', style: 'padding:10px;width:262px;left:auto;right:0' });
      function render() {
        popup.innerHTML = '';
        const head = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:8px' }, [
          h('button', { class: 'btn sm ghost', text: '‹', onclick: (e) => { e.stopPropagation(); viewM -= 1; if (viewM < 1) { viewM = 12; viewY -= 1; } render(); } }),
          h('div', {
            style: 'flex:1;text-align:center;font-weight:700;font-size:13px',
            text: `${global.Jalali.JALALI_MONTHS[viewM - 1]} ${global.Money.toPersianDigits(viewY)}`,
          }),
          h('button', { class: 'btn sm ghost', text: '›', onclick: (e) => { e.stopPropagation(); viewM += 1; if (viewM > 12) { viewM = 1; viewY += 1; } render(); } }),
        ]);
        popup.appendChild(head);
        const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center' });
        for (const d of ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']) {
          grid.appendChild(h('div', { text: d, style: 'font-size:11px;color:#6b7c8f;padding:3px 0' }));
        }
        const firstIso = global.Jalali.jalaliToIso(`${viewY}/${viewM}/1`);
        const [gy, gm, gd] = firstIso.split('-').map(Number);
        const startDay = (new Date(gy, gm - 1, gd).getDay() + 1) % 7;
        for (let i = 0; i < startDay; i += 1) grid.appendChild(h('div'));
        const len = global.Jalali.jalaliMonthLength(viewY, viewM);
        const todayJ = global.Jalali.isoToJalali(global.Jalali.todayIso());
        for (let d = 1; d <= len; d += 1) {
          const dayIso = global.Jalali.jalaliToIso(`${viewY}/${viewM}/${d}`);
          const isToday = todayJ === global.Jalali.isoToJalali(dayIso);
          const isSel = iso === dayIso;
          grid.appendChild(h('div', {
            text: global.Money.toPersianDigits(d),
            style: 'padding:5px 0;border-radius:6px;cursor:pointer;font-size:12.5px;'
              + (isSel ? 'background:#1b4a7a;color:#fff;' : (isToday ? 'background:#e8f0f8;color:#1b4a7a;font-weight:700;' : '')),
            onmousedown: (e) => { e.preventDefault(); setIso(dayIso); closePopup(); },
          }));
        }
        popup.appendChild(grid);
        popup.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [
          h('button', { class: 'btn sm block', text: 'امروز', onmousedown: (e) => { e.preventDefault(); setIso(global.Jalali.todayIso()); closePopup(); } }),
          opts.clearable === false ? null : h('button', { class: 'btn sm ghost', text: 'خالی', onmousedown: (e) => { e.preventDefault(); setIso(''); closePopup(); } }),
        ]));
      }
      render();
      wrap.appendChild(popup);
      const outside = (e) => {
        if (!wrap.contains(e.target)) { closePopup(); document.removeEventListener('mousedown', outside); }
      };
      setTimeout(() => document.addEventListener('mousedown', outside), 0);
    }

    return {
      el: wrap,
      input,
      get value() { return iso; },
      set value(v) { setIso(v, true); },
      focus: () => input.focus(),
    };
  }

  // ── جست‌وجوی خودکار ───────────────────────────────────────
  /**
   * فیلد جست‌وجو با فهرست پیشنهاد.
   * options: {placeholder, fetch(q)->rows, render(row)->{title,meta}, onPick(row), onEnterEmpty}
   */
  function autocomplete(options) {
    const opts = options || {};
    const input = h('input', {
      type: 'search', placeholder: opts.placeholder || 'جست‌وجو...', autocomplete: 'off',
    });
    const results = h('div', { class: 'results', hidden: true });
    const wrap = h('div', { class: 'autocomplete' }, [input, results]);
    let rows = []; let sel = -1; let open = false;

    function close() { open = false; results.hidden = true; sel = -1; }
    function draw() {
      results.innerHTML = '';
      if (!rows.length) {
        results.appendChild(h('div', { class: 'muted', text: 'موردی یافت نشد.' }));
      } else {
        rows.forEach((row, i) => {
          const info = opts.render ? opts.render(row) : { title: row.name, meta: '' };
          results.appendChild(h('div', {
            class: i === sel ? 'sel' : '',
            onmousedown: (e) => { e.preventDefault(); pick(i); },
          }, [
            h('span', { text: info.title }),
            h('span', { class: 'muted', text: info.meta || '' }),
          ]));
        });
      }
      results.hidden = false;
      open = true;
    }
    function pick(i) {
      const row = rows[i];
      if (!row) return;
      close();
      if (opts.keepText) input.value = (opts.render ? opts.render(row).title : row.name) || '';
      else input.value = '';
      if (opts.onPick) opts.onPick(row);
    }
    const search = global.U.debounce(async () => {
      const q = input.value.trim();
      if (opts.minChars && q.length < opts.minChars) { close(); return; }
      try {
        rows = (await opts.fetch(q)) || [];
        sel = rows.length ? 0 : -1;
        draw();
      } catch (_) { close(); }
    }, opts.delay || 180);

    input.addEventListener('input', search);
    input.addEventListener('focus', () => { if (opts.openOnFocus !== false) search(); });
    input.addEventListener('blur', () => setTimeout(close, 160));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { search(); return; } sel = Math.min(sel + 1, rows.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && sel >= 0) pick(sel);
        else if (opts.onEnterEmpty) opts.onEnterEmpty(input.value.trim());
      } else if (e.key === 'Escape') { close(); }
    });

    return { el: wrap, input, close, focus: () => input.focus(), clear: () => { input.value = ''; close(); } };
  }

  // ── فیلد مبلغ با نمایش حروف ───────────────────────────────
  function moneyInput(options) {
    const opts = options || {};
    const input = h('input', {
      type: 'text', class: 'num', inputmode: 'numeric', placeholder: opts.placeholder || '۰',
      value: opts.value ? global.Money.formatNumberFa(opts.value) : '',
    });
    const hint = h('div', { class: 'money-hint' });
    function update() {
      const v = global.U.parseNumber(input.value);
      hint.textContent = v ? global.Money.numberToPersianWords(v) + ' ' + global.U.state.currency : '';
      if (opts.onChange) opts.onChange(v);
    }
    input.addEventListener('input', () => {
      const caretEnd = input.selectionStart === input.value.length;
      const v = global.U.parseNumber(input.value);
      input.value = v ? global.Money.formatNumberFa(v) : '';
      if (caretEnd) input.setSelectionRange(input.value.length, input.value.length);
      update();
    });
    return {
      el: h('div', {}, [input, opts.hideHint ? null : hint]),
      input,
      get value() { return global.U.parseNumber(input.value); },
      set value(v) { input.value = v ? global.Money.formatNumberFa(v) : ''; update(); },
      focus: () => input.focus(),
    };
  }

  // ── فیلد کمکی ─────────────────────────────────────────────
  function field(labelText, control, hint) {
    return h('div', { class: 'field' }, [
      labelText ? h('label', { text: labelText }) : null,
      control instanceof Node ? control : (control && control.el) || null,
      hint ? h('div', { class: 'hint', text: hint }) : null,
    ]);
  }

  function tabs(items, onChange) {
    const bar = h('div', { class: 'tabs' });
    let active = items[0] && items[0].key;
    function draw() {
      bar.innerHTML = '';
      for (const it of items) {
        bar.appendChild(h('button', {
          class: it.key === active ? 'active' : '',
          text: it.title,
          onclick: () => { active = it.key; draw(); onChange(active); },
        }));
      }
    }
    draw();
    return { el: bar, get active() { return active; }, set active(v) { active = v; draw(); } };
  }

  function chips(items, value, onChange) {
    const bar = h('div', { class: 'chips' });
    let current = value;
    function draw() {
      bar.innerHTML = '';
      for (const it of items) {
        bar.appendChild(h('button', {
          class: 'chip' + (it.key === current ? ' active' : ''),
          text: it.title,
          onclick: () => { current = it.key; draw(); onChange(current); },
        }));
      }
    }
    draw();
    return { el: bar, get value() { return current; }, set value(v) { current = v; draw(); } };
  }

  function loading(text) {
    return h('div', { class: 'loading' }, [h('div', { class: 'spinner' }), h('div', { text: text || '' })]);
  }

  function select(options, value, onChange, attrs) {
    const s = h('select', attrs || {});
    for (const o of options) {
      s.appendChild(h('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) }));
    }
    if (onChange) s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  global.UI = { toast, modal, confirm, table, dateInput, autocomplete, moneyInput, field, tabs, chips, loading, select };
}(window));
