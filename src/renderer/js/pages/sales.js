'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  /* ============================ نمایش فاکتور ============================ */
  async function viewInvoice(id) {
    const inv = await API.call('sales.get', { id: id });
    if (!inv) { U.toast('فاکتور یافت نشد.', 'error'); return; }
    const rows = inv.items.map(function (it, i) {
      return '<tr><td>' + w.Fmt.toFaDigits(i + 1) + '</td><td class="name">' + U.esc(it.name_snapshot) + '</td>' +
        '<td>' + U.qty(it.qty) + ' ' + U.esc(it.unit || '') + '</td>' +
        '<td class="money">' + U.money(it.unit_price) + '</td>' +
        '<td class="money">' + U.money(it.discount) + '</td>' +
        '<td class="money">' + U.money(it.line_total) + '</td>' +
        (it.returned_qty ? '<td class="money-neg small">' + U.qty(it.returned_qty) + ' برگشتی</td>' : '<td></td>') + '</tr>';
    }).join('');

    let payRows = '';
    inv.payments.forEach(function (p) {
      (p.payment_lines || []).forEach(function (l) {
        payRows += '<tr><td>' + U.esc(App.info.constants.pay_method_label[l.method] || l.method) + '</td>' +
          '<td class="money">' + U.money(l.amount) + '</td><td>' + U.esc(p.date_jalali) + '</td>' +
          '<td class="small muted">' + U.esc(p.payment_no) + '</td></tr>';
      });
    });
    const checkRows = inv.checks.map(function (c) {
      return '<tr><td><b>' + U.esc(c.check_code) + '</b></td><td>' + U.esc(c.check_number || '-') + '</td>' +
        '<td class="name">' + U.esc(c.holder_name || '') + '</td>' +
        '<td class="money">' + U.money(c.amount) + '</td><td>' + U.esc(c.due_date_jalali) + '</td>' +
        '<td><span class="tag ' + statusClass(c.status) + '">' + U.esc(c.status_label) + '</span></td>' +
        '<td><button class="btn ghost sm" data-check="' + c.id + '">مدیریت چک</button></td></tr>';
    }).join('');

    return U.modal({
      title: 'فاکتور فروش ' + inv.invoice_no,
      size: 'xl',
      body:
        '<div class="grid c4 mb">' +
        '<div class="stat"><div class="label">مشتری</div><div class="value" style="font-size:14px">' + U.esc(inv.customer_name || 'متفرقه') + '</div></div>' +
        '<div class="stat"><div class="label">تاریخ</div><div class="value" style="font-size:14px">' + U.esc(inv.date_jalali) + '</div></div>' +
        '<div class="stat accent"><div class="label">مبلغ کل</div><div class="value money">' + U.money(inv.total) + '</div></div>' +
        '<div class="stat ' + (inv.remaining > 0 ? 'accent-red' : 'accent-green') + '"><div class="label">مانده</div>' +
        '<div class="value money">' + U.money(inv.remaining) + '</div></div></div>' +

        '<table class="data mb"><thead><tr><th>ردیف</th><th class="name">کالا</th><th>تعداد</th>' +
        '<th>قیمت واحد</th><th>تخفیف</th><th>مبلغ</th><th></th></tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="5">جمع مشمول مالیات</td><td class="money">' + U.money(inv.taxable) + '</td><td></td></tr>' +
        (inv.vat_amount ? '<tr><td colspan="5">مالیات (' + w.Fmt.toFaDigits(inv.vat_rate) + '٪)</td><td class="money">' + U.money(inv.vat_amount) + '</td><td></td></tr>' : '') +
        '<tr><td colspan="5">مبلغ نهایی</td><td class="money">' + U.money(inv.total) + '</td><td></td></tr></tfoot></table>' +

        (payRows ? '<h4 style="margin:12px 0 6px;font-size:13px">پرداخت‌ها</h4><table class="data compact mb"><thead><tr>' +
          '<th>روش</th><th>مبلغ</th><th>تاریخ</th><th>سند</th></tr></thead><tbody>' + payRows + '</tbody></table>' : '') +

        (checkRows ? '<h4 style="margin:12px 0 6px;font-size:13px">چک‌های این فاکتور</h4><table class="data compact mb"><thead><tr>' +
          '<th>کد یکتا</th><th>شماره چک</th><th class="name">دارنده</th><th>مبلغ</th><th>سررسید</th><th>وضعیت</th><th></th>' +
          '</tr></thead><tbody>' + checkRows + '</tbody></table>' : '') +

        (inv.returns.length ? '<div class="alert warn">برای این فاکتور ' + w.Fmt.toFaDigits(inv.returns.length) +
          ' سند برگشت به مبلغ ' + U.moneyc(inv.returned_total) + ' ثبت شده است.</div>' : '') +
        (inv.note ? '<div class="alert info">' + U.esc(inv.note) + '</div>' : ''),
      buttons: [
        { label: '🖨 چاپ A5', cls: 'btn', onClick: function () { API.safe('print.invoice', { id: id, type: 'sale', size: 'a5' }); return false; } },
        { label: 'چاپ A4', cls: 'secondary', onClick: function () { API.safe('print.invoice', { id: id, type: 'sale', size: 'a4' }); return false; } },
        { label: 'فیش حرارتی', cls: 'secondary', onClick: function () { API.safe('print.invoice', { id: id, type: 'sale', size: 'thermal' }); return false; } },
        { label: 'ثبت دریافت', cls: 'success', value: 'pay', right: true },
        { label: 'ویرایش', cls: 'secondary', value: 'edit' },
        { label: 'حذف', cls: 'danger', value: 'delete' },
        { label: 'بستن', cls: 'ghost', value: null }
      ],
      onOpen: function (m, close) {
        m.addEventListener('click', function (e) {
          const c = e.target.closest('[data-check]');
          if (c) { close(null); App.go('checks', { focusId: parseInt(c.dataset.check, 10) }); }
        });
      }
    });
  }

  function statusClass(s) {
    return { pending: 'blue', deposited: 'orange', cleared: 'green', paid: 'green', returned: 'red', cancelled: 'gray' }[s] || '';
  }

  /* ============================ فرم فاکتور ============================ */
  async function invoiceForm(root, existing) {
    const [customers, banks, settings] = await Promise.all([
      API.call('party.list', { type: 'customer', active: 1, limit: 1000, withBalance: false }),
      API.call('bank.list', { active: 1 }),
      API.call('settings.all', {})
    ]);

    let items = [];
    let seq = 0;
    if (existing) {
      items = existing.items.map(function (it) {
        return {
          id: ++seq, product_id: it.product_id, name: it.name_snapshot, unit: it.unit,
          qty: it.qty, unit_price: it.unit_price, discount: it.discount, stock: null
        };
      });
    }

    root.innerHTML =
      '<div class="toolbar">' +
      '<div class="field f-md"><label class="req">مشتری</label>' + U.partySelect('customer_id', customers, existing ? existing.customer_id : '', '— مشتری متفرقه (نقدی) —') + '</div>' +
      U.dateField('date', existing ? existing.date : U.today(), 'تاریخ فاکتور', 'f-sm') +
      '<div class="field f-sm"><label>نرخ مالیات (٪)</label><input type="text" name="vat_rate" class="num" value="' +
      U.esc(existing ? existing.vat_rate : settings.vat_rate) + '"></div>' +
      '<span class="spacer"></span>' +
      '<button class="btn secondary" id="newCustomer">+ مشتری جدید</button>' +
      '</div>' +

      '<div class="invoice-layout">' +
      '<div>' +
      '<div class="card"><div class="card-head"><h3>اقلام فاکتور</h3><span class="spacer"></span>' +
      '<span class="small muted">جست‌وجو یا اسکن بارکد، سپس Enter</span></div>' +
      '<div class="card-body">' +
      '<div class="suggest mb"><input type="text" id="prodSearch" placeholder="نام کالا، کد یا بارکد را وارد کنید... (F4)" autocomplete="off"></div>' +
      '<div class="table-wrap"><table class="data items-table" id="itemsTbl"><thead><tr>' +
      '<th style="width:34px">#</th><th class="name">کالا</th><th style="width:96px">تعداد</th>' +
      '<th style="width:124px">قیمت واحد</th><th style="width:112px">تخفیف</th>' +
      '<th style="width:120px">مبلغ</th><th style="width:34px"></th></tr></thead><tbody></tbody></table></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-head"><h3>توضیحات</h3></div><div class="card-body">' +
      '<textarea name="note" placeholder="توضیحات فاکتور (اختیاری)">' + U.esc(existing ? (existing.note || '') : '') + '</textarea></div></div>' +
      '</div>' +

      '<div class="totals-box">' +
      '<div class="card"><div class="card-head"><h3>جمع فاکتور</h3></div><div class="card-body">' +
      '<div class="field"><label>تخفیف کل فاکتور</label><input type="text" name="invoice_discount" class="money" value="' +
      U.money(existing ? existing.invoice_discount : 0) + '"></div>' +
      '<div id="totalsBox"></div></div></div>' +

      '<div class="card"><div class="card-head"><h3>نحوه پرداخت</h3></div>' +
      '<div class="card-body"><div id="payEditor"></div></div></div>' +

      '<div class="btn-group mb">' +
      '<button class="btn lg" id="save">' + (existing ? 'ثبت تغییرات' : 'ثبت فاکتور') + ' (Ctrl+S)</button>' +
      '<button class="btn secondary" id="savePrint">ثبت و چاپ</button>' +
      '<button class="btn ghost" id="cancel">انصراف</button>' +
      '</div>' +
      '</div></div>';

    const form = root;
    U.enhance(root);

    const payEditor = w.Comp.paymentEditor({
      container: root.querySelector('#payEditor'),
      direction: 'in',
      banks: banks,
      total: 0
    });

    /* ---------- اقلام ---------- */
    function drawItems() {
      const tb = root.querySelector('#itemsTbl tbody');
      if (!items.length) {
        tb.innerHTML = U.emptyRow(7, 'هنوز کالایی اضافه نشده است.', '🛒');
      } else {
        tb.innerHTML = items.map(function (it, i) {
          const line = Math.round(it.qty * it.unit_price) - it.discount;
          return '<tr data-row="' + it.id + '">' +
            '<td>' + w.Fmt.toFaDigits(i + 1) + '</td>' +
            '<td class="name">' + U.esc(it.name) +
            (it.stock !== null && it.stock !== undefined ? '<div class="small muted">موجودی: ' + U.qty(it.stock) + ' ' + U.esc(it.unit || '') + '</div>' : '') + '</td>' +
            '<td><input type="text" class="num" data-f="qty" value="' + U.qty(it.qty) + '"></td>' +
            '<td><input type="text" class="money" data-f="price" value="' + U.money(it.unit_price) + '"></td>' +
            '<td><input type="text" class="money" data-f="disc" value="' + U.money(it.discount) + '"></td>' +
            '<td class="money bold">' + U.money(line) + '</td>' +
            '<td><button type="button" class="del" data-del>×</button></td></tr>';
        }).join('');
      }
      U.bindMoneyInputs(tb);
      calc();
    }

    function readItems() {
      U.$$('#itemsTbl tbody tr[data-row]', root).forEach(function (tr) {
        const it = items.find(function (x) { return x.id === parseInt(tr.dataset.row, 10); });
        if (!it) return;
        it.qty = U.parseQty(tr.querySelector('[data-f="qty"]').value);
        it.unit_price = U.parseMoney(tr.querySelector('[data-f="price"]').value);
        it.discount = U.parseMoney(tr.querySelector('[data-f="disc"]').value);
      });
    }

    function calc() {
      readItems();
      let subtotal = 0, lineDiscount = 0;
      items.forEach(function (it) {
        subtotal += Math.round(it.qty * it.unit_price);
        lineDiscount += it.discount;
      });
      const invDisc = U.valMoney(form, 'invoice_discount');
      const taxable = Math.max(0, subtotal - lineDiscount - invDisc);
      const rate = U.valNum(form, 'vat_rate') || 0;
      const vat = Math.round(taxable * rate / 100);
      const total = taxable + vat;

      root.querySelector('#totalsBox').innerHTML =
        '<div class="totals-line"><span>جمع کل</span><span class="v">' + U.money(subtotal) + '</span></div>' +
        (lineDiscount ? '<div class="totals-line"><span>تخفیف ردیف‌ها</span><span class="v money-neg">' + U.money(lineDiscount) + '</span></div>' : '') +
        (invDisc ? '<div class="totals-line"><span>تخفیف فاکتور</span><span class="v money-neg">' + U.money(invDisc) + '</span></div>' : '') +
        '<div class="totals-line"><span>مبلغ مشمول مالیات</span><span class="v">' + U.money(taxable) + '</span></div>' +
        (vat ? '<div class="totals-line"><span>مالیات ' + w.Fmt.toFaDigits(rate) + '٪</span><span class="v">' + U.money(vat) + '</span></div>' : '') +
        '<div class="totals-line grand"><span>قابل پرداخت</span><span class="v">' + U.money(total) + '</span></div>' +
        '<div class="small muted center" style="margin-top:6px">' + U.esc(U.words(total)) + ' ' + U.esc(U.cur()) + '</div>';

      // ردیف‌های جدول را به‌روز کن
      U.$$('#itemsTbl tbody tr[data-row]', root).forEach(function (tr) {
        const it = items.find(function (x) { return x.id === parseInt(tr.dataset.row, 10); });
        if (it) tr.children[5].textContent = U.money(Math.round(it.qty * it.unit_price) - it.discount);
      });

      payEditor.setTarget(total);
      return { subtotal: subtotal, taxable: taxable, vat: vat, total: total };
    }

    function addProduct(p) {
      const existingRow = items.find(function (x) { return x.product_id === p.id; });
      if (existingRow) {
        existingRow.qty += 1;
        drawItems();
        focusQty(existingRow.id);
        return;
      }
      const it = {
        id: ++seq, product_id: p.id, name: p.name, unit: p.unit,
        qty: 1, unit_price: p.sale_price, discount: 0, stock: p.stock_qty
      };
      items.push(it);
      drawItems();
      focusQty(it.id);
    }

    function focusQty(id) {
      const el = root.querySelector('tr[data-row="' + id + '"] [data-f="qty"]');
      if (el) { el.focus(); el.select(); }
    }

    w.Comp.productPicker(root.querySelector('#prodSearch'), addProduct, {
      onCreate: async function (term) {
        const created = await w.ProductForm({ name: term });
        if (created) U.toast('کالا ثبت شد؛ دوباره جست‌وجو کنید.', 'success');
      }
    });

    root.querySelector('#itemsTbl').addEventListener('input', calc);
    root.querySelector('#itemsTbl').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        root.querySelector('#prodSearch').focus();
      }
    });
    root.querySelector('#itemsTbl').addEventListener('click', function (e) {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      readItems();
      const id = parseInt(del.closest('tr').dataset.row, 10);
      items = items.filter(function (x) { return x.id !== id; });
      drawItems();
    });
    root.querySelector('[name="invoice_discount"]').addEventListener('input', calc);
    root.querySelector('[name="vat_rate"]').addEventListener('input', calc);

    root.querySelector('#newCustomer').addEventListener('click', async function () {
      const created = await w.PartyForm('customer', null);
      if (created) {
        const list = await API.call('party.list', { type: 'customer', active: 1, limit: 1000, withBalance: false });
        const sel = root.querySelector('[name="customer_id"]');
        sel.innerHTML = U.partySelect('customer_id', list, created.id, '— مشتری متفرقه (نقدی) —')
          .replace(/^<select[^>]*>/, '').replace(/<\/select>$/, '');
        sel.value = created.id;
      }
    });

    root.querySelector('#cancel').addEventListener('click', function () { App.go('sales'); });

    async function save(andPrint) {
      const t = calc();
      if (!items.length) { U.toast('حداقل یک کالا به فاکتور اضافه کنید.', 'warn'); return; }
      for (const it of items) {
        if (!(it.qty > 0)) { U.toast('تعداد کالای «' + it.name + '» نامعتبر است.', 'warn'); return; }
      }
      const payErr = payEditor.validate();
      if (payErr) { U.toast(payErr, 'warn'); return; }
      const payLines = payEditor.getLines();
      const paid = payLines.reduce(function (a, l) { return a + l.amount; }, 0);
      if (paid > t.total) { U.toast('مبلغ پرداختی از مبلغ فاکتور بیشتر است.', 'warn'); return; }
      const customerId = U.val(form, 'customer_id');
      if (paid < t.total && !customerId) {
        U.toast('برای فاکتور نسیه یا پرداخت ناقص باید مشتری انتخاب شود.', 'warn');
        return;
      }

      const data = {
        date: U.getDate(form, 'date'),
        customer_id: customerId ? parseInt(customerId, 10) : null,
        vat_rate: U.valNum(form, 'vat_rate'),
        invoice_discount: U.valMoney(form, 'invoice_discount'),
        note: U.val(form, 'note'),
        items: items.map(function (it) {
          return { product_id: it.product_id, qty: it.qty, unit_price: it.unit_price, discount: it.discount };
        }),
        payments: payLines
      };

      const btn = root.querySelector('#save');
      btn.disabled = true;
      try {
        const saved = existing
          ? await API.call('sales.update', { id: existing.id, data: data })
          : await API.call('sales.create', { data: data });
        U.toast('فاکتور ' + saved.invoice_no + ' ثبت شد.', 'success');
        if (andPrint) await API.safe('print.invoice', { id: saved.id, type: 'sale' });
        App.go('sales');
      } catch (e) {
        U.toast(e.message, 'error');
        btn.disabled = false;
      }
    }

    root.querySelector('#save').addEventListener('click', function () { save(false); });
    root.querySelector('#savePrint').addEventListener('click', function () { save(true); });

    const keyHandler = function (e) {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
      if (e.key === 'F4') { e.preventDefault(); root.querySelector('#prodSearch').focus(); }
    };
    document.addEventListener('keydown', keyHandler);
    const observer = new MutationObserver(function () {
      if (!document.body.contains(root.querySelector('#prodSearch'))) {
        document.removeEventListener('keydown', keyHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('content'), { childList: true });

    drawItems();
    if (existing) payEditor.clear();
    root.querySelector('#prodSearch').focus();
  }

  /* ============================ فهرست فاکتورها ============================ */
  w.Pages.sales = {
    title: 'فاکتورهای فروش',
    render: async function (root, ctx) {
      if (ctx.sub === 'new') { App.setTitle('فاکتور فروش جدید'); return invoiceForm(root, null); }
      if (ctx.sub === 'edit' && ctx.id) {
        App.setTitle('ویرایش فاکتور فروش');
        const inv = await API.call('sales.get', { id: ctx.id });
        if (!inv) { U.toast('فاکتور یافت نشد.', 'error'); App.go('sales'); return; }
        return invoiceForm(root, inv);
      }

      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to, search: '', customer_id: '', limit: 100, offset: 0 };
      let rows = [];

      const customers = await API.call('party.list', { type: 'customer', limit: 1000, withBalance: false });

      root.innerHTML =
        '<div class="toolbar">' +
        '<div id="rangeBar" style="width:100%"></div>' +
        '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="شماره فاکتور، مشتری یا توضیحات"></div>' +
        '<div class="field f-md"><label>مشتری</label>' + U.partySelect('customer_id', customers, '', 'همه مشتریان') + '</div>' +
        '<span class="spacer"></span>' +
        '<button class="btn" id="add">+ فاکتور فروش جدید</button>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button>' +
        '</div>' +
        '<div class="grid c4 mb" id="sum"></div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
        '<th>شماره</th><th>تاریخ</th><th class="name">مشتری</th><th>مبلغ کل</th><th>تخفیف</th><th>مالیات</th>' +
        '<th>پرداخت شده</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody></tbody></table></div></div>' +
        '<div class="card-head"><span class="small muted" id="cnt"></span><span class="spacer"></span>' +
        '<button class="btn ghost sm" id="more">نمایش بیشتر</button></div></div>';

      w.Comp.rangeBar({
        container: root.querySelector('#rangeBar'), kind: 'month',
        onChange: function (r) { state.from = r.from; state.to = r.to; load(); }
      });

      async function load(append) {
        if (!append) state.offset = 0;
        const list = await API.call('sales.list', state);
        rows = append ? rows.concat(list) : list;
        draw();
        const totals = rows.reduce(function (a, r) {
          a.total += r.total; a.paid += r.paid; a.remaining += r.remaining; a.vat += r.vat_amount; return a;
        }, { total: 0, paid: 0, remaining: 0, vat: 0 });
        root.querySelector('#sum').innerHTML =
          '<div class="stat accent"><div class="label">جمع فروش</div><div class="value money">' + U.money(totals.total) + '</div>' +
          '<div class="sub">' + w.Fmt.toFaDigits(rows.length) + ' فاکتور</div></div>' +
          '<div class="stat accent-green"><div class="label">دریافت شده</div><div class="value money">' + U.money(totals.paid) + '</div></div>' +
          '<div class="stat accent-red"><div class="label">مانده طلب</div><div class="value money">' + U.money(totals.remaining) + '</div></div>' +
          '<div class="stat"><div class="label">مالیات</div><div class="value money">' + U.money(totals.vat) + '</div></div>';
        root.querySelector('#cnt').textContent = 'نمایش ' + w.Fmt.toFaDigits(rows.length) + ' فاکتور';
        root.querySelector('#more').style.display = list.length === state.limit ? '' : 'none';
      }

      function draw() {
        const tb = root.querySelector('#tbl tbody');
        if (!rows.length) { tb.innerHTML = U.emptyRow(10, 'فاکتوری در این بازه یافت نشد.', '🧾'); return; }
        tb.innerHTML = rows.map(function (r) {
          const paidPct = r.total ? Math.round(r.paid * 100 / r.total) : 100;
          const tag = r.remaining <= 0 ? '<span class="tag green">تسویه</span>'
            : (r.paid > 0 ? '<span class="tag orange">' + w.Fmt.toFaDigits(paidPct) + '٪ پرداخت</span>' : '<span class="tag red">نسیه</span>');
          return '<tr data-id="' + r.id + '" class="clickable">' +
            '<td class="bold">' + U.esc(r.invoice_no) + '</td>' +
            '<td>' + U.esc(r.date_jalali) + '</td>' +
            '<td class="name">' + U.esc(r.customer_name || 'متفرقه') + '</td>' +
            '<td class="money bold">' + U.money(r.total) + '</td>' +
            '<td class="money">' + U.money(r.line_discount + r.invoice_discount) + '</td>' +
            '<td class="money">' + U.money(r.vat_amount) + '</td>' +
            '<td class="money">' + U.money(r.paid) + '</td>' +
            '<td class="money ' + (r.remaining > 0 ? 'money-neg bold' : '') + '">' + U.money(r.remaining) + '</td>' +
            '<td>' + tag + '</td>' +
            '<td class="actions"><button class="btn ghost sm" data-view>نمایش</button>' +
            '<button class="btn ghost sm" data-print>چاپ</button></td></tr>';
        }).join('');
      }

      root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
      root.querySelector('[name="customer_id"]').addEventListener('change', function () { state.customer_id = this.value; load(); });
      root.querySelector('#add').addEventListener('click', function () { App.go('sales/new'); });
      root.querySelector('#more').addEventListener('click', function () { state.offset += state.limit; load(true); });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = parseInt(tr.dataset.id, 10);
        if (e.target.closest('[data-print]')) { API.safe('print.invoice', { id: id, type: 'sale' }); return; }
        await openInvoice(id);
      });

      async function openInvoice(id) {
        const action = await viewInvoice(id);
        if (action === 'edit') App.go('sales/edit/' + id);
        else if (action === 'delete') {
          if (await U.confirm('این فاکتور به طور کامل حذف شود؟', {
            danger: true,
            detail: 'موجودی انبار، سند حسابداری، پرداخت‌ها و چک‌های ثبت‌نشده این فاکتور نیز برگشت داده می‌شود.'
          })) {
            try {
              await API.call('sales.remove', { id: id });
              U.toast('فاکتور حذف شد.', 'success');
              load();
            } catch (err) { U.toast(err.message, 'error'); }
          }
        } else if (action === 'pay') {
          const inv = await API.call('sales.get', { id: id });
          const done = await w.PaymentForm({
            direction: 'in', party_type: 'customer', party_id: inv.customer_id,
            ref_type: 'sales_invoice', ref_id: inv.id, ref_no: inv.invoice_no,
            amount: inv.remaining, title: 'دریافت بابت فاکتور ' + inv.invoice_no
          });
          if (done) load();
        }
      }

      w.Comp.bindExport(root, function () {
        return {
          title: 'گزارش فروش', filename: 'sales',
          subtitle: 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to),
          columns: [
            { header: 'شماره', key: 'invoice_no' }, { header: 'تاریخ', key: 'date_jalali' },
            { header: 'مشتری', key: 'customer_name', align: 'right' },
            { header: 'مبلغ کل', key: 'total', money: true }, { header: 'مالیات', key: 'vat_amount', money: true },
            { header: 'پرداخت‌شده', key: 'paid', money: true }, { header: 'مانده', key: 'remaining', money: true }
          ],
          rows: rows,
          totals: {
            invoice_no: 'جمع',
            total: rows.reduce(function (a, r) { return a + r.total; }, 0),
            vat_amount: rows.reduce(function (a, r) { return a + r.vat_amount; }, 0),
            paid: rows.reduce(function (a, r) { return a + r.paid; }, 0),
            remaining: rows.reduce(function (a, r) { return a + r.remaining; }, 0)
          }
        };
      });

      await load();
      if (ctx.params && ctx.params.focusId) openInvoice(ctx.params.focusId);
    }
  };

  w.SalesView = viewInvoice;
  w.statusClass = statusClass;
})(window);
