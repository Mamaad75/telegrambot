'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  /** انتخاب فاکتور برای برگشت */
  async function pickInvoice(kind) {
    const isSale = kind === 'sale';
    const list = isSale
      ? await API.call('sales.list', { limit: 200 })
      : await API.call('purchases.list', { limit: 200 });

    return U.modal({
      title: isSale ? 'انتخاب فاکتور فروش برای برگشت' : 'انتخاب فاکتور خرید برای برگشت',
      size: 'lg',
      body:
        '<div class="field"><input type="search" id="invQ" placeholder="جست‌وجوی شماره فاکتور یا طرف حساب" autofocus></div>' +
        '<div class="table-wrap" style="max-height:420px;overflow-y:auto"><table class="data compact" id="invTbl"><thead><tr>' +
        '<th>شماره</th><th>تاریخ</th><th class="name">' + (isSale ? 'مشتری' : 'تأمین‌کننده') + '</th>' +
        '<th>مبلغ</th></tr></thead><tbody></tbody></table></div>',
      buttons: [{ label: 'انصراف', value: null, cls: 'secondary' }],
      onOpen: function (m, close) {
        function draw(filter) {
          const rows = filter
            ? list.filter(function (r) {
              const name = isSale ? (r.customer_name || '') : (r.supplier_name || '');
              return (r.invoice_no + ' ' + name).indexOf(filter) !== -1;
            })
            : list;
          m.querySelector('#invTbl tbody').innerHTML = rows.length ? rows.map(function (r) {
            return '<tr class="clickable" data-id="' + r.id + '"><td class="bold">' + U.esc(r.invoice_no) + '</td>' +
              '<td>' + U.esc(r.date_jalali) + '</td>' +
              '<td class="name">' + U.esc((isSale ? r.customer_name : r.supplier_name) || 'متفرقه') + '</td>' +
              '<td class="money">' + U.money(r.total) + '</td></tr>';
          }).join('') : U.emptyRow(4, 'فاکتوری یافت نشد.');
        }
        draw('');
        m.querySelector('#invQ').addEventListener('input', U.debounce(function () { draw(this.value.trim()); }, 200));
        m.querySelector('#invTbl').addEventListener('click', function (e) {
          const tr = e.target.closest('tr[data-id]');
          if (tr) close(parseInt(tr.dataset.id, 10));
        });
      }
    });
  }

  /** فرم ثبت برگشت */
  async function returnForm(kind, invoiceId) {
    const isSale = kind === 'sale';
    const inv = isSale
      ? await API.call('sales.get', { id: invoiceId })
      : await API.call('purchases.get', { id: invoiceId });
    if (!inv) { U.toast('فاکتور یافت نشد.', 'error'); return false; }

    const banks = await API.call('bank.list', { active: 1 });
    const items = inv.items.filter(function (it) { return it.qty - it.returned_qty > 1e-9; });
    if (!items.length) { U.toast('تمام اقلام این فاکتور قبلاً برگشت داده شده است.', 'warn'); return false; }

    const body =
      '<div class="alert info">فاکتور <b>' + U.esc(inv.invoice_no) + '</b> — ' +
      U.esc((isSale ? inv.customer_name : inv.supplier_name) || 'متفرقه') + ' — تاریخ ' + U.esc(inv.date_jalali) +
      ' — مبلغ ' + U.moneyc(inv.total) + '</div>' +
      '<div class="row">' + U.dateField('date', U.today(), 'تاریخ برگشت') +
      '<div class="field"><label>توضیحات</label><input type="text" name="note" placeholder="علت برگشت"></div></div>' +
      '<div class="table-wrap"><table class="data compact" id="retTbl"><thead><tr>' +
      '<th style="width:32px"><input type="checkbox" id="chkAll"></th><th class="name">کالا</th>' +
      '<th>فروخته/خریداری</th><th>قبلاً برگشتی</th><th>قابل برگشت</th>' +
      '<th style="width:96px">تعداد برگشت</th><th>مبلغ برگشتی</th></tr></thead><tbody>' +
      items.map(function (it) {
        const remaining = it.qty - it.returned_qty;
        const netUnit = it.qty > 0 ? it.net_total / it.qty : 0;
        return '<tr data-item="' + it.id + '" data-unit="' + netUnit + '">' +
          '<td><input type="checkbox" data-pick></td>' +
          '<td class="name">' + U.esc(it.name_snapshot) + '</td>' +
          '<td>' + U.qty(it.qty) + '</td>' +
          '<td>' + U.qty(it.returned_qty) + '</td>' +
          '<td class="bold">' + U.qty(remaining) + '</td>' +
          '<td><input type="text" class="num" data-qty value="0" data-max="' + remaining + '"></td>' +
          '<td class="money" data-amount>0</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card mt"><div class="card-body"><div id="retTotals"></div>' +
      '<label class="checkbox mt"><input type="checkbox" id="doRefund"> ' +
      (isSale ? 'همزمان وجه به مشتری برگردانده شود' : 'همزمان وجه از تأمین‌کننده دریافت شود') + '</label>' +
      '<div id="refundBox" style="display:none;margin-top:9px"></div>' +
      '</div></div>';

    return U.modal({
      title: isSale ? 'ثبت برگشت از فروش' : 'ثبت برگشت از خرید',
      size: 'xl',
      body: body,
      buttons: [
        {
          label: 'ثبت برگشت', cls: 'btn', onClick: async function (m) {
            const picked = [];
            U.$$('#retTbl tbody tr', m).forEach(function (tr) {
              const q = U.parseQty(tr.querySelector('[data-qty]').value);
              if (q > 0) picked.push({ item_id: parseInt(tr.dataset.item, 10), qty: q });
            });
            if (!picked.length) { U.toast('تعداد برگشتی حداقل یک کالا را وارد کنید.', 'warn'); return false; }
            const data = {
              invoice_id: inv.id,
              date: U.getDate(m, 'date'),
              note: U.val(m, 'note'),
              items: picked
            };
            if (m.querySelector('#doRefund').checked && m.__refund) {
              const err = m.__refund.validate();
              if (err) { U.toast(err, 'warn'); return false; }
              data.refund = m.__refund.getLines();
              if (!data.refund.length) { U.toast('روش استرداد وجه را مشخص کنید.', 'warn'); return false; }
            }
            try {
              const saved = isSale
                ? await API.call('returns.createSales', { data: data })
                : await API.call('returns.createPurchase', { data: data });
              U.toast('سند برگشت ' + saved.return_no + ' ثبت شد.', 'success');
              return saved;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const vatRate = inv.vat_rate || 0;

        function recalc() {
          let subtotal = 0;
          U.$$('#retTbl tbody tr', m).forEach(function (tr) {
            const max = parseFloat(tr.querySelector('[data-qty]').dataset.max);
            let q = U.parseQty(tr.querySelector('[data-qty]').value);
            if (q > max) { q = max; tr.querySelector('[data-qty]').value = U.qty(max); }
            const unit = parseFloat(tr.dataset.unit);
            const amount = Math.round(unit * q);
            tr.querySelector('[data-amount]').textContent = U.money(amount);
            subtotal += amount;
          });
          const vat = Math.round(subtotal * vatRate / 100);
          m.querySelector('#retTotals').innerHTML =
            '<div class="totals-line"><span>مبلغ کالاهای برگشتی</span><span class="v">' + U.money(subtotal) + '</span></div>' +
            (vat ? '<div class="totals-line"><span>مالیات برگشتی (' + w.Fmt.toFaDigits(vatRate) + '٪)</span><span class="v">' + U.money(vat) + '</span></div>' : '') +
            '<div class="totals-line grand"><span>جمع سند برگشت</span><span class="v">' + U.money(subtotal + vat) + '</span></div>';
          if (m.__refund) m.__refund.setTarget(subtotal + vat);
          return subtotal + vat;
        }

        m.querySelector('#retTbl').addEventListener('input', recalc);
        m.querySelector('#retTbl').addEventListener('change', function (e) {
          const pick = e.target.closest('[data-pick]');
          if (pick) {
            const tr = pick.closest('tr');
            const max = tr.querySelector('[data-qty]').dataset.max;
            tr.querySelector('[data-qty]').value = pick.checked ? U.qty(parseFloat(max)) : '0';
            recalc();
          }
        });
        m.querySelector('#chkAll').addEventListener('change', function () {
          const on = this.checked;
          U.$$('#retTbl tbody tr', m).forEach(function (tr) {
            tr.querySelector('[data-pick]').checked = on;
            tr.querySelector('[data-qty]').value = on ? U.qty(parseFloat(tr.querySelector('[data-qty]').dataset.max)) : '0';
          });
          recalc();
        });

        m.querySelector('#doRefund').addEventListener('change', function () {
          const box = m.querySelector('#refundBox');
          box.style.display = this.checked ? '' : 'none';
          if (this.checked && !m.__refund) {
            m.__refund = w.Comp.paymentEditor({
              container: box, direction: isSale ? 'out' : 'in', banks: banks, total: recalc()
            });
            m.__refund.addRow('cash', recalc());
          } else if (this.checked) {
            m.__refund.setTarget(recalc());
          }
        });

        recalc();
      }
    });
  }

  w.Pages.returns = {
    title: 'برگشت از فروش و خرید',
    render: async function (root) {
      let tab = 'sale';
      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to, search: '', limit: 200 };
      let rows = [];

      root.innerHTML =
        '<div class="tabs">' +
        '<div class="tab active" data-tab="sale">برگشت از فروش</div>' +
        '<div class="tab" data-tab="purchase">برگشت از خرید</div>' +
        '</div>' +
        '<div class="toolbar"><div id="rangeBar" style="width:100%"></div>' +
        '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="شماره سند، فاکتور یا طرف حساب"></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn" id="add">+ ثبت برگشت جدید</button>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button></div>' +
        '<div class="grid c3 mb" id="sum"></div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
        '<th>شماره سند</th><th>تاریخ</th><th>فاکتور مرتبط</th><th class="name">طرف حساب</th>' +
        '<th>مبلغ</th><th>مالیات</th><th>جمع</th><th>عملیات</th></tr></thead><tbody></tbody></table></div></div></div>';

      w.Comp.rangeBar({
        container: root.querySelector('#rangeBar'), kind: 'month',
        onChange: function (r) { state.from = r.from; state.to = r.to; load(); }
      });

      root.querySelector('.tabs').addEventListener('click', function (e) {
        const t = e.target.closest('[data-tab]');
        if (!t) return;
        tab = t.dataset.tab;
        U.$$('.tab', root).forEach(function (x) { x.classList.toggle('active', x === t); });
        load();
      });

      async function load() {
        rows = tab === 'sale'
          ? await API.call('returns.listSales', state)
          : await API.call('returns.listPurchase', state);
        const total = rows.reduce(function (a, r) { return a + r.total; }, 0);
        const sub = rows.reduce(function (a, r) { return a + r.subtotal; }, 0);
        root.querySelector('#sum').innerHTML =
          '<div class="stat accent"><div class="label">تعداد اسناد برگشت</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
          '<div class="stat accent-orange"><div class="label">مبلغ کالاهای برگشتی</div><div class="value money">' + U.money(sub) + '</div></div>' +
          '<div class="stat accent-red"><div class="label">جمع اسناد برگشت</div><div class="value money">' + U.money(total) + '</div></div>';

        const tb = root.querySelector('#tbl tbody');
        tb.innerHTML = rows.length ? rows.map(function (r) {
          return '<tr data-id="' + r.id + '"><td class="bold">' + U.esc(r.return_no) + '</td>' +
            '<td>' + U.esc(r.date_jalali) + '</td>' +
            '<td class="small">' + U.esc(r.invoice_no || '—') + '</td>' +
            '<td class="name">' + U.esc((tab === 'sale' ? r.customer_name : r.supplier_name) || 'متفرقه') + '</td>' +
            '<td class="money">' + U.money(r.subtotal) + '</td>' +
            '<td class="money">' + U.money(r.vat_amount) + '</td>' +
            '<td class="money bold">' + U.money(r.total) + '</td>' +
            '<td class="actions"><button class="btn ghost sm" data-view>جزئیات</button>' +
            '<button class="btn ghost sm" data-del>حذف</button></td></tr>';
        }).join('') : U.emptyRow(8, 'سند برگشتی در این بازه ثبت نشده است.', '↩️');
      }

      root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
      root.querySelector('#add').addEventListener('click', async function () {
        const invId = await pickInvoice(tab);
        if (!invId) return;
        if (await returnForm(tab, invId)) load();
      });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = parseInt(tr.dataset.id, 10);
        if (e.target.closest('[data-del]')) {
          if (!await U.confirm('این سند برگشت حذف شود؟', { danger: true, detail: 'موجودی انبار و سند حسابداری نیز برگشت داده می‌شود.' })) return;
          try {
            await API.call(tab === 'sale' ? 'returns.removeSales' : 'returns.removePurchase', { id: id });
            U.toast('حذف شد.', 'success');
            load();
          } catch (err) { U.toast(err.message, 'error'); }
          return;
        }
        const doc = await API.call(tab === 'sale' ? 'returns.getSales' : 'returns.getPurchase', { id: id });
        await U.modal({
          title: 'سند برگشت ' + doc.return_no,
          size: 'lg',
          body:
            '<div class="kv mb"><span class="k">تاریخ</span><span class="v">' + U.esc(doc.date_jalali) + '</span>' +
            '<span class="k">فاکتور مرتبط</span><span class="v">' + U.esc(doc.invoice_no || '—') + '</span>' +
            '<span class="k">طرف حساب</span><span class="v">' + U.esc((tab === 'sale' ? doc.customer_name : doc.supplier_name) || '—') + '</span>' +
            '<span class="k">جمع سند</span><span class="v money">' + U.moneyc(doc.total) + '</span>' +
            (doc.note ? '<span class="k">توضیحات</span><span class="v">' + U.esc(doc.note) + '</span>' : '') + '</div>' +
            '<table class="data compact"><thead><tr><th class="name">کالا</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ</th></tr></thead><tbody>' +
            doc.items.map(function (it) {
              return '<tr><td class="name">' + U.esc(it.name_snapshot) + '</td><td>' + U.qty(it.qty) + '</td>' +
                '<td class="money">' + U.money(it.unit_price) + '</td><td class="money">' + U.money(it.line_total) + '</td></tr>';
            }).join('') + '</tbody></table>' +
            (doc.payments && doc.payments.length
              ? '<h4 style="font-size:13px;margin:12px 0 6px">استرداد وجه</h4><table class="data compact"><tbody>' +
                doc.payments.map(function (p) {
                  return '<tr><td>' + U.esc(p.payment_no) + '</td><td>' + U.esc(p.methods) + '</td>' +
                    '<td class="money">' + U.money(p.total) + '</td></tr>';
                }).join('') + '</tbody></table>'
              : ''),
          buttons: [{ label: 'بستن', value: null, cls: 'secondary' }]
        });
      });

      w.Comp.bindExport(root, function () {
        return {
          title: tab === 'sale' ? 'گزارش برگشت از فروش' : 'گزارش برگشت از خرید',
          filename: tab === 'sale' ? 'sales-returns' : 'purchase-returns',
          subtitle: 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to),
          columns: [
            { header: 'شماره سند', key: 'return_no' }, { header: 'تاریخ', key: 'date_jalali' },
            { header: 'فاکتور', key: 'invoice_no' },
            { header: 'طرف حساب', key: tab === 'sale' ? 'customer_name' : 'supplier_name', align: 'right' },
            { header: 'مبلغ', key: 'subtotal', money: true }, { header: 'مالیات', key: 'vat_amount', money: true },
            { header: 'جمع', key: 'total', money: true }
          ],
          rows: rows,
          totals: { return_no: 'جمع', total: rows.reduce(function (a, r) { return a + r.total; }, 0) }
        };
      });

      await load();
    }
  };
})(window);
