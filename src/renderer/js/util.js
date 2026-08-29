'use strict';
/* ابزارهای مشترک رابط کاربری: قالب‌بندی، پیام، مودال، انتخاب تاریخ شمسی */
(function (w) {
  const Fmt = w.Fmt;
  const Jalali = w.Jalali;

  const U = {};

  /* ------------------------------ DOM ------------------------------ */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.on = function (root, event, selector, handler) {
    root.addEventListener(event, function (e) {
      const t = e.target.closest(selector);
      if (t && root.contains(t)) handler.call(t, e, t);
    });
  };

  /* ------------------------------ قالب‌بندی ------------------------------ */
  U.money = function (n) { return Fmt.money(n); };
  U.qty = function (n) { return Fmt.qty(n); };
  U.parseMoney = function (s) { return Fmt.parseMoney(s); };
  U.parseQty = function (s) { return Fmt.parseQty(s); };
  U.words = function (n) { return Fmt.toWords(n); };
  U.jalali = function (iso) { return iso ? Jalali.isoToJalali(iso) : ''; };
  U.today = function () { return Jalali.todayIso(); };

  let currency = 'تومان';
  U.setCurrency = function (c) { currency = c || 'تومان'; };
  U.cur = function () { return currency; };
  U.moneyc = function (n) { return Fmt.money(n) + ' ' + currency; };

  /** مبلغ با رنگ بر اساس علامت */
  U.moneySigned = function (n) {
    const cls = n > 0 ? 'money-pos' : (n < 0 ? 'money-neg' : '');
    return '<span class="money ' + cls + '">' + Fmt.money(n) + '</span>';
  };

  /* ------------------------------ پیام ------------------------------ */
  U.toast = function (message, type, ms) {
    const box = U.$('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    const ico = { success: '✔', error: '✕', warn: '⚠' }[type] || 'ℹ';
    el.innerHTML = '<span class="t-ico">' + ico + '</span><span>' + U.esc(message) + '</span>';
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, ms || (type === 'error' ? 6000 : 3200));
  };

  /* ------------------------------ مودال ------------------------------ */
  U.modal = function (opt) {
    return new Promise(function (resolve) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const size = opt.size ? ' ' + opt.size : '';
      backdrop.innerHTML =
        '<div class="modal' + size + '">' +
        '<div class="modal-head"><h3>' + U.esc(opt.title || '') + '</h3><span class="spacer"></span>' +
        (opt.closable === false ? '' : '<span class="x" data-close>&times;</span>') + '</div>' +
        '<div class="modal-body">' + (opt.body || '') + '</div>' +
        (opt.buttons === null ? '' : '<div class="modal-foot"></div>') +
        '</div>';
      document.body.appendChild(backdrop);

      const modalEl = backdrop.querySelector('.modal');
      const foot = backdrop.querySelector('.modal-foot');
      let settled = false;
      const close = function (val) {
        if (settled) return;
        settled = true;
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = function (e) {
        if (e.key === 'Escape' && opt.closable !== false) close(null);
      };
      document.addEventListener('keydown', onKey);

      if (foot) {
        const buttons = opt.buttons || [{ label: 'بستن', value: null, cls: 'secondary' }];
        const spacer = document.createElement('span');
        spacer.className = 'spacer';
        let spacerAdded = false;
        buttons.forEach(function (b) {
          if (b.right && !spacerAdded) { foot.appendChild(spacer); spacerAdded = true; }
          const btn = document.createElement('button');
          btn.className = 'btn ' + (b.cls || 'secondary');
          btn.textContent = b.label;
          btn.addEventListener('click', function () {
            if (b.onClick) {
              const r = b.onClick(modalEl, close);
              if (r === false) return;
              if (r && typeof r.then === 'function') { r.then(function (v) { if (v !== false) close(v === undefined ? b.value : v); }); return; }
              close(r === undefined ? b.value : r);
            } else close(b.value);
          });
          foot.appendChild(btn);
        });
      }

      backdrop.addEventListener('mousedown', function (e) {
        if (e.target === backdrop && opt.closable !== false) close(null);
      });
      backdrop.addEventListener('click', function (e) {
        if (e.target.hasAttribute && e.target.hasAttribute('data-close')) close(null);
      });

      if (opt.onOpen) opt.onOpen(modalEl, close);
      const focusEl = modalEl.querySelector('[autofocus], input, select, textarea');
      if (focusEl) setTimeout(function () { focusEl.focus(); if (focusEl.select) focusEl.select(); }, 60);
    });
  };

  U.confirm = function (message, opt) {
    const o = opt || {};
    return U.modal({
      title: o.title || 'تأیید عملیات',
      size: 'sm',
      body: '<div style="font-size:13px;line-height:2">' + U.esc(message).replace(/\n/g, '<br>') + '</div>' +
        (o.detail ? '<div class="alert warn" style="margin-top:12px">' + U.esc(o.detail) + '</div>' : ''),
      buttons: [
        { label: o.confirmLabel || 'بله، انجام شود', value: true, cls: o.danger ? 'danger' : 'btn' },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ]
    }).then(function (v) { return v === true; });
  };

  U.alert = function (message, title, type) {
    return U.modal({
      title: title || 'پیام',
      size: 'sm',
      body: '<div class="alert ' + (type || 'info') + '" style="margin:0">' + U.esc(message).replace(/\n/g, '<br>') + '</div>',
      buttons: [{ label: 'بستن', value: true, cls: 'secondary' }]
    });
  };

  U.prompt = function (opt) {
    const o = opt || {};
    return U.modal({
      title: o.title || 'ورود اطلاعات',
      size: 'sm',
      body: '<div class="field"><label>' + U.esc(o.label || '') + '</label>' +
        '<input type="text" id="promptInput" value="' + U.esc(o.value || '') + '" autofocus></div>',
      buttons: [
        {
          label: o.okLabel || 'ثبت', cls: 'btn', onClick: function (m) {
            const v = m.querySelector('#promptInput').value.trim();
            if (!v && o.required !== false) { U.toast('مقدار را وارد کنید.', 'warn'); return false; }
            return v;
          }
        },
        { label: 'انصراف', value: null, cls: 'secondary' }
      ],
      onOpen: function (m, close) {
        m.querySelector('#promptInput').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            const v = this.value.trim();
            if (v || o.required === false) close(v);
          }
        });
      }
    });
  };

  /* ------------------------------ ورودی مبلغ ------------------------------ */
  /** جداکننده هزارگان زنده روی ورودی‌های دارای کلاس money */
  U.bindMoneyInputs = function (root) {
    U.$$('input.money', root || document).forEach(function (inp) {
      if (inp.__moneyBound) return;
      inp.__moneyBound = true;
      const format = function () {
        const raw = Fmt.toEnDigits(inp.value).replace(/[^0-9\-]/g, '');
        if (raw === '' || raw === '-') { inp.value = raw; return; }
        inp.value = Fmt.group(parseInt(raw, 10));
      };
      inp.addEventListener('input', function () {
        const pos = inp.value.length - inp.selectionStart;
        format();
        const np = Math.max(0, inp.value.length - pos);
        try { inp.setSelectionRange(np, np); } catch (e) { /* بی‌اهمیت */ }
      });
      inp.addEventListener('blur', format);
      format();
    });
  };

  U.val = function (root, name) {
    const el = root.querySelector('[name="' + name + '"]');
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked ? 1 : 0;
    return el.value;
  };
  U.valMoney = function (root, name) { return Fmt.parseMoney(U.val(root, name)); };
  U.valNum = function (root, name) { return Fmt.parseQty(U.val(root, name)); };

  /* ------------------------------ انتخاب تاریخ شمسی ------------------------------ */
  /**
   * ساخت HTML یک فیلد تاریخ. مقدار داخلی همیشه میلادی ISO است
   * و در ورودی به صورت شمسی نمایش داده می‌شود.
   */
  U.dateField = function (name, isoValue, label, extraClass) {
    const jv = isoValue ? Jalali.isoToJalali(isoValue) : '';
    return '<div class="field date-field ' + (extraClass || '') + '">' +
      (label ? '<label>' + U.esc(label) + '</label>' : '') +
      '<input type="text" class="date-input" name="' + name + '" data-iso="' + U.esc(isoValue || '') + '" ' +
      'value="' + U.esc(jv) + '" placeholder="۱۴۰۴/۰۱/۰۱" autocomplete="off">' +
      '<button type="button" class="cal-btn" tabindex="-1">📅</button></div>';
  };

  U.getDate = function (root, name) {
    const el = root.querySelector('[name="' + name + '"]');
    if (!el) return null;
    const iso = Jalali.jalaliToIso(el.value);
    return iso || el.dataset.iso || null;
  };

  U.setDate = function (root, name, iso) {
    const el = root.querySelector('[name="' + name + '"]');
    if (!el) return;
    el.dataset.iso = iso || '';
    el.value = iso ? Jalali.isoToJalali(iso) : '';
  };

  let openPicker = null;
  function closePicker() {
    if (openPicker) { openPicker.remove(); openPicker = null; }
  }
  document.addEventListener('mousedown', function (e) {
    if (openPicker && !openPicker.contains(e.target) && !e.target.closest('.date-field')) closePicker();
  });

  function buildPicker(input) {
    closePicker();
    const iso = Jalali.jalaliToIso(input.value) || input.dataset.iso || Jalali.todayIso();
    const p = iso.split('-');
    let cur = Jalali.toJalali(+p[0], +p[1], +p[2]);
    let viewY = cur.jy, viewM = cur.jm;

    const box = document.createElement('div');
    box.className = 'datepicker';

    function render() {
      const len = Jalali.jalaliMonthLength(viewY, viewM);
      const firstIso = Jalali.jalaliToIso(viewY + '/' + String(viewM).padStart(2, '0') + '/01');
      const d = new Date(firstIso + 'T00:00:00');
      const offset = (d.getDay() + 1) % 7; // شنبه = ۰
      const todayIso = Jalali.todayIso();
      const selIso = Jalali.jalaliToIso(input.value) || input.dataset.iso;
      let html = '<div class="dp-head">' +
        '<button type="button" data-nav="-1">›</button>' +
        '<span class="dp-title">' + Jalali.MONTHS[viewM - 1] + ' ' + Fmt.toFaDigits(viewY) + '</span>' +
        '<button type="button" data-nav="1">‹</button></div><div class="dp-grid">';
      ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].forEach(function (n) { html += '<div class="dow">' + n + '</div>'; });
      for (let i = 0; i < offset; i++) html += '<button class="empty" type="button"></button>';
      for (let day = 1; day <= len; day++) {
        const dIso = Jalali.jalaliToIso(viewY + '/' + String(viewM).padStart(2, '0') + '/' + String(day).padStart(2, '0'));
        const cls = (dIso === todayIso ? ' today' : '') + (dIso === selIso ? ' sel' : '');
        html += '<button type="button" class="' + cls + '" data-iso="' + dIso + '">' + Fmt.toFaDigits(day) + '</button>';
      }
      html += '</div><div class="dp-foot"><button type="button" data-today>امروز</button>' +
        '<button type="button" data-clear>پاک کردن</button></div>';
      box.innerHTML = html;
    }
    render();

    box.addEventListener('click', function (e) {
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        viewM += parseInt(nav.dataset.nav, 10);
        if (viewM > 12) { viewM = 1; viewY++; }
        if (viewM < 1) { viewM = 12; viewY--; }
        render();
        return;
      }
      const day = e.target.closest('[data-iso]');
      if (day) {
        input.dataset.iso = day.dataset.iso;
        input.value = Jalali.isoToJalali(day.dataset.iso);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
        return;
      }
      if (e.target.closest('[data-today]')) {
        const t = Jalali.todayIso();
        input.dataset.iso = t;
        input.value = Jalali.isoToJalali(t);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
      }
      if (e.target.closest('[data-clear]')) {
        input.dataset.iso = '';
        input.value = '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
      }
    });

    document.body.appendChild(box);
    const rect = input.getBoundingClientRect();
    const top = rect.bottom + 4;
    box.style.position = 'fixed';
    box.style.top = (top + 260 > window.innerHeight ? Math.max(8, rect.top - 268) : top) + 'px';
    box.style.right = (window.innerWidth - rect.right) + 'px';
    openPicker = box;
  }

  U.bindDateInputs = function (root) {
    U.$$('.date-field', root || document).forEach(function (f) {
      if (f.__dateBound) return;
      f.__dateBound = true;
      const input = f.querySelector('.date-input');
      const btn = f.querySelector('.cal-btn');
      if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); buildPicker(input); });
      input.addEventListener('focus', function () { buildPicker(input); });
      input.addEventListener('blur', function () {
        const iso = Jalali.jalaliToIso(input.value);
        if (iso) { input.dataset.iso = iso; input.value = Jalali.isoToJalali(iso); input.classList.remove('err'); }
        else if (input.value.trim() === '') { input.dataset.iso = ''; input.classList.remove('err'); }
        else input.classList.add('err');
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closePicker();
        if (e.key === 'Enter') { closePicker(); }
      });
    });
  };

  /* ------------------------------ بازه تاریخ ------------------------------ */
  U.rangeChips = function (active) {
    const list = [
      { k: 'today', l: 'امروز' }, { k: 'yesterday', l: 'دیروز' }, { k: 'week', l: 'این هفته' },
      { k: 'month', l: 'این ماه' }, { k: 'lastmonth', l: 'ماه گذشته' }, { k: 'year', l: 'امسال' },
      { k: 'custom', l: 'بازه دلخواه' }
    ];
    return '<div class="chips">' + list.map(function (r) {
      return '<span class="chip' + (r.k === active ? ' active' : '') + '" data-range="' + r.k + '">' + r.l + '</span>';
    }).join('') + '</div>';
  };
  U.range = function (kind) { return Jalali.range(kind); };

  /* ------------------------------ جدول خالی ------------------------------ */
  U.emptyRow = function (cols, text, icon) {
    return '<tr><td colspan="' + cols + '"><div class="empty"><div class="big">' + (icon || '📄') + '</div>' +
      U.esc(text || 'موردی یافت نشد.') + '</div></td></tr>';
  };

  U.loading = function (text) {
    return '<div class="loading"><span class="spinner"></span>' + U.esc(text || 'در حال بارگذاری...') + '</div>';
  };

  /* ------------------------------ انتخاب طرف‌حساب ------------------------------ */
  U.partySelect = function (name, list, selected, placeholder) {
    let html = '<select name="' + name + '"><option value="">' + U.esc(placeholder || '— انتخاب کنید —') + '</option>';
    list.forEach(function (p) {
      html += '<option value="' + p.id + '"' + (String(selected) === String(p.id) ? ' selected' : '') + '>' +
        U.esc(p.name) + (p.phone ? ' — ' + U.esc(p.phone) : '') + '</option>';
    });
    return html + '</select>';
  };

  U.bankSelect = function (name, list, selected, kindFilter) {
    const items = kindFilter ? list.filter(function (b) { return b.kind === kindFilter; }) : list;
    let html = '<select name="' + name + '"><option value="">— انتخاب حساب —</option>';
    items.forEach(function (b) {
      html += '<option value="' + b.id + '"' + (String(selected) === String(b.id) ? ' selected' : '') + '>' +
        U.esc(b.title) + (b.bank_name ? ' (' + U.esc(b.bank_name) + ')' : '') + '</option>';
    });
    return html + '</select>';
  };

  /** آماده‌سازی تمام ورودی‌های یک بخش */
  U.enhance = function (root) {
    U.bindDateInputs(root);
    U.bindMoneyInputs(root);
  };

  /** فوکوس روی اولین ورودی */
  U.focusFirst = function (root) {
    const el = root.querySelector('input:not([type=hidden]):not([disabled]), select');
    if (el) el.focus();
  };

  /** تبدیل خروجی جدول به ستون‌های چاپ/اکسل */
  U.tableExport = function (columns, rows, totals) {
    return { columns: columns, rows: rows, totals: totals || null };
  };

  U.debounce = function (fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 250);
    };
  };

  w.U = U;
})(window);
