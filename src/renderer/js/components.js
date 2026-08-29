'use strict';
/* اجزای قابل استفاده مجدد: جست‌وجوی کالا، ویرایشگر پرداخت ترکیبی، نوار بازه تاریخ */
(function (w) {
  const U = w.U;
  const API = w.API;
  const Comp = {};

  /* ------------------------- جست‌وجوی کالا با پیشنهاد ------------------------- */
  Comp.productPicker = function (input, onPick, opt) {
    const options = opt || {};
    const wrap = input.closest('.suggest') || input.parentElement;
    let list = null;
    let items = [];
    let active = -1;

    function close() {
      if (list) { list.remove(); list = null; }
      active = -1;
    }

    function open(rows) {
      close();
      items = rows;
      list = document.createElement('div');
      list.className = 'suggest-list';
      if (!rows.length) {
        list.innerHTML = '<div class="empty-item">کالایی یافت نشد. برای ثبت کالای جدید کلید F2 را بزنید.</div>';
      } else {
        list.innerHTML = rows.map(function (p, i) {
          const low = p.min_stock > 0 && p.stock_qty <= p.min_stock;
          return '<div class="item" data-i="' + i + '">' +
            '<span class="s-name">' + U.esc(p.name) + '</span>' +
            '<span class="s-meta">' + U.esc(p.code || '') + (p.barcode ? ' | ' + U.esc(p.barcode) : '') + '</span>' +
            '<span class="s-stock ' + (low ? 'money-neg' : 'muted') + '">موجودی ' + U.qty(p.stock_qty) + ' ' + U.esc(p.unit || '') + '</span>' +
            '<span class="money bold">' + U.money(p.sale_price) + '</span></div>';
        }).join('');
      }
      wrap.appendChild(list);
      list.addEventListener('mousedown', function (e) {
        const it = e.target.closest('[data-i]');
        if (!it) return;
        e.preventDefault();
        pick(items[parseInt(it.dataset.i, 10)]);
      });
    }

    function pick(p) {
      if (!p) return;
      close();
      input.value = '';
      onPick(p);
    }

    function highlight(dir) {
      if (!list || !items.length) return;
      active = (active + dir + items.length) % items.length;
      U.$$('.item', list).forEach(function (el, i) { el.classList.toggle('active', i === active); });
      const el = list.querySelector('.item.active');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    const search = U.debounce(async function (term) {
      if (!term) { close(); return; }
      const rows = await API.safe('products.search', { term: term, limit: 15 }, true);
      if (rows) open(rows);
    }, 180);

    input.addEventListener('input', function () { search(this.value.trim()); });
    input.addEventListener('blur', function () { setTimeout(close, 160); });
    input.addEventListener('keydown', async function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0 && items[active]) { pick(items[active]); return; }
        const term = this.value.trim();
        if (!term) return;
        // بارکدخوان: مقدار کامل را با Enter می‌فرستد
        const exact = await API.safe('products.byBarcode', { barcode: term }, true);
        if (exact) { pick(exact); return; }
        const rows = await API.safe('products.search', { term: term, limit: 15 }, true);
        if (rows && rows.length === 1) pick(rows[0]);
        else if (rows) open(rows);
      } else if (e.key === 'F2' && options.onCreate) {
        e.preventDefault();
        options.onCreate(this.value.trim());
      }
    });

    return { close: close };
  };

  /* ------------------------- ویرایشگر پرداخت ترکیبی ------------------------- */
  /**
   * مدیریت ردیف‌های پرداخت یک فاکتور یا سند دریافت/پرداخت.
   * opt: { container, direction:'in'|'out', banks, total, allowCredit, partyName }
   */
  Comp.paymentEditor = function (opt) {
    const box = opt.container;
    const banks = opt.banks || [];
    const direction = opt.direction || 'in';
    let rows = [];
    let target = opt.total || 0;
    let seq = 0;

    const METHODS = [
      { k: 'cash', l: 'نقدی' },
      { k: 'pos', l: 'کارتخوان' },
      { k: 'bank', l: 'واریز بانکی' },
      { k: 'card', l: 'کارت به کارت' },
      { k: 'check', l: 'چک' }
    ];

    function rowHtml(r) {
      const needsBank = r.method === 'pos' || r.method === 'bank' || r.method === 'card';
      const kind = r.method === 'pos' ? 'pos' : 'bank';
      let html = '<div class="pay-row" data-row="' + r.id + '">' +
        '<select data-f="method">' + METHODS.map(function (m) {
          return '<option value="' + m.k + '"' + (m.k === r.method ? ' selected' : '') + '>' + m.l + '</option>';
        }).join('') + '</select>' +
        '<input type="text" class="money" data-f="amount" value="' + U.money(r.amount) + '" placeholder="مبلغ">' +
        (needsBank
          ? '<select data-f="bank">' + banks.filter(function (b) { return b.active; }).map(function (b) {
            const match = kind === 'pos' ? b.kind === 'pos' : true;
            if (!match && kind === 'pos') return '';
            return '<option value="' + b.id + '"' + (String(r.bank_account_id) === String(b.id) ? ' selected' : '') + '>' +
              U.esc(b.title) + '</option>';
          }).join('') + '</select>'
          : '<span class="muted small center">' + (r.method === 'check' ? 'مشخصات چک ↓' : '—') + '</span>') +
        '<button type="button" class="del" data-del title="حذف ردیف">×</button>' +
        '</div>';

      if (r.method === 'check') {
        html += '<div class="pay-check-box" data-checkbox="' + r.id + '">' +
          '<div class="row tight">' +
          '<div class="field"><label>شماره چک</label><input type="text" class="ltr" data-f="check_number" value="' + U.esc(r.check.check_number || '') + '"></div>' +
          '<div class="field"><label>بانک</label><input type="text" data-f="check_bank" value="' + U.esc(r.check.bank_name || '') + '"></div>' +
          '</div><div class="row tight">' +
          '<div class="field"><label class="req">' + (direction === 'in' ? 'نام صاحب/دارنده چک' : 'در وجه') + '</label>' +
          '<input type="text" data-f="check_holder" value="' + U.esc(r.check.holder_name || '') + '"></div>' +
          U.dateField('check_due_' + r.id, r.check.due_date || '', 'تاریخ سررسید') +
          '</div><div class="row tight">' +
          '<div class="field"><label>شناسه صیادی</label><input type="text" class="ltr" data-f="check_sayad" value="' + U.esc(r.check.sayad_id || '') + '"></div>' +
          (direction === 'out'
            ? '<div class="field"><label>از حساب</label>' + U.bankSelect('check_bank_acc_' + r.id, banks, r.check.bank_account_id, 'bank') + '</div>'
            : '<div class="field"><label>توضیح</label><input type="text" data-f="check_note" value="' + U.esc(r.check.note || '') + '"></div>') +
          '</div>' +
          '<div class="small muted">هنگام ثبت، یک کد یکتا به این چک اختصاص داده می‌شود و به فاکتور متصل می‌ماند.</div>' +
          '</div>';
      }
      return html;
    }

    function render() {
      let html = '';
      rows.forEach(function (r) { html += rowHtml(r); });
      html += '<div class="btn-group mt"><button type="button" class="btn secondary sm" data-add>+ افزودن روش پرداخت</button>' +
        '<button type="button" class="btn ghost sm" data-fill>پرداخت کامل</button></div>' +
        '<div id="paySummary" class="mt"></div>';
      box.innerHTML = html;
      U.enhance(box);
      updateSummary();
    }

    function updateSummary() {
      const paid = total();
      const remain = target - paid;
      const el = box.querySelector('#paySummary');
      if (!el) return;
      let cls = 'info', text;
      if (target === 0) { text = 'جمع پرداخت: ' + U.moneyc(paid); }
      else if (remain === 0) { cls = 'success'; text = 'پرداخت کامل شد.'; }
      else if (remain > 0) { cls = 'warn'; text = 'باقیمانده (نسیه): ' + U.moneyc(remain); }
      else { cls = 'error'; text = 'مبلغ پرداختی ' + U.moneyc(-remain) + ' بیشتر از مبلغ سند است.'; }
      el.innerHTML = '<div class="alert ' + cls + '" style="margin:0">' + U.esc(text) + '</div>';
    }

    function readRow(r) {
      const el = box.querySelector('[data-row="' + r.id + '"]');
      if (!el) return;
      r.method = el.querySelector('[data-f="method"]').value;
      r.amount = U.parseMoney(el.querySelector('[data-f="amount"]').value);
      const bank = el.querySelector('[data-f="bank"]');
      r.bank_account_id = bank ? parseInt(bank.value, 10) || null : null;
      const cb = box.querySelector('[data-checkbox="' + r.id + '"]');
      if (cb) {
        r.check = {
          check_number: cb.querySelector('[data-f="check_number"]').value.trim(),
          bank_name: cb.querySelector('[data-f="check_bank"]').value.trim(),
          holder_name: cb.querySelector('[data-f="check_holder"]').value.trim(),
          sayad_id: cb.querySelector('[data-f="check_sayad"]').value.trim(),
          due_date: U.getDate(cb, 'check_due_' + r.id),
          note: cb.querySelector('[data-f="check_note"]') ? cb.querySelector('[data-f="check_note"]').value.trim() : '',
          bank_account_id: cb.querySelector('[name="check_bank_acc_' + r.id + '"]')
            ? parseInt(cb.querySelector('[name="check_bank_acc_' + r.id + '"]').value, 10) || null : null
        };
      }
    }

    function readAll() { rows.forEach(readRow); }

    function total() {
      readAll();
      return rows.reduce(function (a, r) { return a + (r.amount || 0); }, 0);
    }

    function addRow(method, amount) {
      rows.push({
        id: ++seq,
        method: method || (w.App.settings.default_payment_method || 'cash'),
        amount: amount || 0,
        bank_account_id: null,
        check: {}
      });
      render();
    }

    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-add]')) { readAll(); addRow(); return; }
      if (e.target.closest('[data-fill]')) {
        readAll();
        const others = rows.reduce(function (a, r, i) { return i === rows.length - 1 ? a : a + r.amount; }, 0);
        if (!rows.length) addRow('cash', target);
        else { rows[rows.length - 1].amount = Math.max(0, target - others); render(); }
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        readAll();
        const id = parseInt(del.closest('[data-row]').dataset.row, 10);
        rows = rows.filter(function (r) { return r.id !== id; });
        render();
      }
    });

    box.addEventListener('change', function (e) {
      if (e.target.matches('[data-f="method"]')) {
        readAll();
        const id = parseInt(e.target.closest('[data-row]').dataset.row, 10);
        const r = rows.find(function (x) { return x.id === id; });
        if (r) r.method = e.target.value;
        render();
      } else updateSummary();
    });
    box.addEventListener('input', function (e) {
      if (e.target.matches('[data-f="amount"]')) updateSummary();
    });

    if (opt.startEmpty !== true) addRow();
    else render();

    return {
      addRow: addRow,
      setTarget: function (t) { target = t; updateSummary(); },
      total: total,
      getLines: function () {
        readAll();
        return rows.filter(function (r) { return r.amount > 0; }).map(function (r) {
          const line = { method: r.method, amount: r.amount, bank_account_id: r.bank_account_id };
          if (r.method === 'check') line.check = r.check;
          return line;
        });
      },
      validate: function () {
        readAll();
        for (const r of rows) {
          if (r.amount <= 0) continue;
          if (r.method === 'check') {
            if (!r.check.due_date) return 'تاریخ سررسید چک را وارد کنید.';
            if (!r.check.holder_name) return 'نام دارنده/صاحب چک را وارد کنید.';
          }
          if ((r.method === 'pos' || r.method === 'bank' || r.method === 'card') && !r.bank_account_id) {
            return 'برای روش پرداخت انتخاب‌شده باید حساب بانکی یا کارتخوان مشخص شود.';
          }
        }
        return null;
      },
      clear: function () { rows = []; render(); }
    };
  };

  /* ------------------------- نوار بازه تاریخ ------------------------- */
  Comp.rangeBar = function (opt) {
    const box = opt.container;
    let kind = opt.kind || 'month';
    let range = w.Jalali.range(kind);
    if (opt.from) range.from = opt.from;
    if (opt.to) range.to = opt.to;

    function render() {
      box.innerHTML = U.rangeChips(kind) +
        '<div class="row tight" id="customRange" style="max-width:340px;margin-top:8px;' + (kind === 'custom' ? '' : 'display:none') + '">' +
        U.dateField('rangeFrom', range.from, 'از تاریخ') + U.dateField('rangeTo', range.to, 'تا تاریخ') + '</div>';
      U.enhance(box);
    }

    box.addEventListener('click', function (e) {
      const chip = e.target.closest('[data-range]');
      if (!chip) return;
      kind = chip.dataset.range;
      if (kind !== 'custom') range = w.Jalali.range(kind);
      render();
      opt.onChange(current());
    });

    box.addEventListener('change', function (e) {
      if (e.target.matches('.date-input')) {
        range.from = U.getDate(box, 'rangeFrom') || range.from;
        range.to = U.getDate(box, 'rangeTo') || range.to;
        opt.onChange(current());
      }
    });

    function current() { return { from: range.from, to: range.to, kind: kind, label: range.label || 'بازه دلخواه' }; }

    render();
    return { current: current, render: render };
  };

  /* ------------------------- جدول با خروجی ------------------------- */
  Comp.exportButtons = function (getData, title, filename) {
    return '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
      '<button class="btn secondary sm" data-export-print>چاپ</button>';
  };

  Comp.bindExport = function (root, getPayload) {
    root.addEventListener('click', async function (e) {
      if (e.target.closest('[data-export-excel]')) {
        const p = getPayload();
        if (!p.rows.length) { U.toast('داده‌ای برای خروجی وجود ندارد.', 'warn'); return; }
        const r = await API.safe('excel.exportTable', {
          sheet: p.title, filename: p.filename || 'report',
          columns: p.columns, rows: p.rows, totals: p.totals
        });
        if (r && !r.canceled) U.toast('فایل اکسل ذخیره شد.', 'success');
      }
      if (e.target.closest('[data-export-print]')) {
        const p = getPayload();
        if (!p.rows.length) { U.toast('داده‌ای برای چاپ وجود ندارد.', 'warn'); return; }
        await API.safe('print.report', {
          title: p.title, subtitle: p.subtitle, columns: p.columns, rows: p.rows,
          totals: p.totals, filename: p.filename, landscape: p.landscape
        });
      }
    });
  };

  w.Comp = Comp;
})(window);
