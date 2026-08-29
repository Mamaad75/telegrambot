'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  /**
   * فرم ثبت دریافت / پرداخت (با امکان پرداخت ترکیبی و ثبت چک)
   * opt: { direction, party_type, party_id, ref_type, ref_id, ref_no, amount, title }
   */
  async function paymentForm(opt) {
    const o = opt || {};
    const direction = o.direction || 'in';
    const partyType = o.party_type || (direction === 'in' ? 'customer' : 'supplier');
    const [parties, banks] = await Promise.all([
      API.call('party.list', { type: partyType, active: 1, limit: 1000, withBalance: false }),
      API.call('bank.list', { active: 1 })
    ]);

    // فاکتورهای باز برای انتخاب
    let invoices = [];
    if (o.party_id && !o.ref_id) {
      invoices = direction === 'in'
        ? await API.call('sales.list', { customer_id: o.party_id, limit: 100 })
        : await API.call('purchases.list', { supplier_id: o.party_id, limit: 100 });
      invoices = invoices.filter(function (i) { return i.remaining > 0; });
    }

    const body =
      '<div class="row">' +
      '<div class="field"><label class="req">' + (direction === 'in' ? 'مشتری' : 'تأمین‌کننده') + '</label>' +
      U.partySelect('party_id', parties, o.party_id, '— انتخاب کنید —') + '</div>' +
      U.dateField('date', U.today(), 'تاریخ') +
      '</div>' +
      (o.ref_no
        ? '<div class="alert info">این سند بابت فاکتور <b>' + U.esc(o.ref_no) + '</b> ثبت می‌شود.' +
          (o.amount ? ' مانده فاکتور: <b>' + U.moneyc(o.amount) + '</b>' : '') + '</div>'
        : '<div class="field" id="invBox"' + (invoices.length ? '' : ' style="display:none"') + '>' +
          '<label>بابت فاکتور (اختیاری)</label><select name="ref_id"><option value="">— علی‌الحساب / بدون فاکتور —</option>' +
          invoices.map(function (i) {
            return '<option value="' + i.id + '" data-remaining="' + i.remaining + '">' + U.esc(i.invoice_no) + ' — ' +
              U.esc(i.date_jalali) + ' — مانده ' + U.money(i.remaining) + '</option>';
          }).join('') + '</select></div>') +
      '<div class="field"><label>مبلغ کل سند</label><input type="text" name="amount" class="money" value="' + U.money(o.amount || 0) + '">' +
      '<div class="hint">مبلغ را وارد کنید و سپس روش(های) پرداخت را مشخص نمایید.</div></div>' +
      '<div class="card"><div class="card-head"><h3>روش‌های ' + (direction === 'in' ? 'دریافت' : 'پرداخت') + '</h3></div>' +
      '<div class="card-body"><div id="payEditor"></div></div></div>' +
      '<div class="field"><label>توضیحات</label><input type="text" name="note" value=""></div>';

    return U.modal({
      title: o.title || (direction === 'in' ? 'ثبت دریافت از مشتری' : 'ثبت پرداخت به تأمین‌کننده'),
      size: 'lg',
      body: body,
      buttons: [
        {
          label: 'ثبت سند', cls: 'btn', onClick: async function (m) {
            const partyId = U.val(m, 'party_id');
            if (!partyId) { U.toast('طرف حساب را انتخاب کنید.', 'warn'); return false; }
            const err = m.__payEditor.validate();
            if (err) { U.toast(err, 'warn'); return false; }
            const lines = m.__payEditor.getLines();
            if (!lines.length) { U.toast('حداقل یک روش پرداخت با مبلغ وارد کنید.', 'warn'); return false; }
            const refSel = m.querySelector('[name="ref_id"]');
            const data = {
              direction: direction,
              date: U.getDate(m, 'date'),
              party_type: partyType,
              party_id: parseInt(partyId, 10),
              ref_type: o.ref_type || (refSel && refSel.value ? (direction === 'in' ? 'sales_invoice' : 'purchase_invoice') : null),
              ref_id: o.ref_id || (refSel && refSel.value ? parseInt(refSel.value, 10) : null),
              ref_no: o.ref_no || null,
              note: U.val(m, 'note'),
              lines: lines
            };
            try {
              const saved = await API.call('payments.create', { data: data });
              U.toast('سند ' + saved.payment_no + ' ثبت شد.', 'success');
              return saved;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const editor = w.Comp.paymentEditor({
          container: m.querySelector('#payEditor'),
          direction: direction, banks: banks, total: o.amount || 0
        });
        m.__payEditor = editor;
        if (o.amount) editor.addRow(App.settings.default_payment_method || 'cash', o.amount);
        else editor.addRow();

        m.querySelector('[name="amount"]').addEventListener('input', function () {
          editor.setTarget(U.parseMoney(this.value));
        });
        const refSel = m.querySelector('[name="ref_id"]');
        if (refSel) {
          refSel.addEventListener('change', function () {
            const opt2 = this.options[this.selectedIndex];
            const rem = opt2 ? parseInt(opt2.dataset.remaining || '0', 10) : 0;
            if (rem) {
              m.querySelector('[name="amount"]').value = U.money(rem);
              editor.setTarget(rem);
            }
          });
        }
      }
    });
  }

  w.PaymentForm = paymentForm;

  w.Pages.treasury = {
    title: 'دریافت و پرداخت',
    render: async function (root) {
      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to, direction: '', method: '', search: '', limit: 200 };
      let rows = [];

      root.innerHTML =
        '<div class="toolbar"><div id="rangeBar" style="width:100%"></div>' +
        '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="شماره سند، طرف حساب یا فاکتور"></div>' +
        '<div class="field f-sm"><label>نوع</label><select id="dir"><option value="">همه</option>' +
        '<option value="in">دریافت</option><option value="out">پرداخت</option></select></div>' +
        '<div class="field f-sm"><label>روش</label><select id="mth"><option value="">همه</option>' +
        '<option value="cash">نقدی</option><option value="pos">کارتخوان</option><option value="bank">بانکی</option>' +
        '<option value="card">کارت به کارت</option><option value="check">چک</option></select></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn success" id="addIn">+ ثبت دریافت</button>' +
        '<button class="btn warn" id="addOut">+ ثبت پرداخت</button>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button></div>' +
        '<div class="grid c4 mb" id="sum"></div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
        '<th>شماره سند</th><th>تاریخ</th><th>نوع</th><th class="name">طرف حساب</th><th>روش‌ها</th>' +
        '<th>فاکتور مرتبط</th><th>مبلغ</th><th>عملیات</th></tr></thead><tbody></tbody></table></div></div></div>';

      w.Comp.rangeBar({
        container: root.querySelector('#rangeBar'), kind: 'month',
        onChange: function (r) { state.from = r.from; state.to = r.to; load(); }
      });

      async function load() {
        rows = await API.call('payments.list', state);
        const inSum = rows.filter(function (r) { return r.direction === 'in'; }).reduce(function (a, r) { return a + r.total; }, 0);
        const outSum = rows.filter(function (r) { return r.direction === 'out'; }).reduce(function (a, r) { return a + r.total; }, 0);
        const mix = await API.call('payments.breakdown', { from: state.from, to: state.to });
        const cashIn = mix.filter(function (m) { return m.direction === 'in' && m.method === 'cash'; }).reduce(function (a, m) { return a + m.total; }, 0);
        const checkIn = mix.filter(function (m) { return m.direction === 'in' && m.method === 'check'; }).reduce(function (a, m) { return a + m.total; }, 0);

        root.querySelector('#sum').innerHTML =
          '<div class="stat accent-green"><div class="label">جمع دریافت‌ها</div><div class="value money">' + U.money(inSum) + '</div></div>' +
          '<div class="stat accent-red"><div class="label">جمع پرداخت‌ها</div><div class="value money">' + U.money(outSum) + '</div></div>' +
          '<div class="stat accent"><div class="label">دریافت نقدی</div><div class="value money">' + U.money(cashIn) + '</div></div>' +
          '<div class="stat accent-orange"><div class="label">دریافت چکی</div><div class="value money">' + U.money(checkIn) + '</div></div>';

        const tb = root.querySelector('#tbl tbody');
        tb.innerHTML = rows.length ? rows.map(function (r) {
          return '<tr data-id="' + r.id + '" class="clickable">' +
            '<td class="bold">' + U.esc(r.payment_no) + '</td><td>' + U.esc(r.date_jalali) + '</td>' +
            '<td><span class="tag ' + (r.direction === 'in' ? 'green' : 'orange') + '">' + U.esc(r.direction_label) + '</span></td>' +
            '<td class="name">' + U.esc(r.party_name || '—') + '</td>' +
            '<td class="small">' + U.esc(r.methods) + '</td>' +
            '<td class="small">' + U.esc(r.ref_no || '—') + '</td>' +
            '<td class="money bold">' + U.money(r.total) + '</td>' +
            '<td class="actions"><button class="btn ghost sm" data-view>جزئیات</button>' +
            '<button class="btn ghost sm" data-del>حذف</button></td></tr>';
        }).join('') : U.emptyRow(8, 'سندی در این بازه ثبت نشده است.', '💵');
      }

      root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
      root.querySelector('#dir').addEventListener('change', function () { state.direction = this.value; load(); });
      root.querySelector('#mth').addEventListener('change', function () { state.method = this.value; load(); });
      root.querySelector('#addIn').addEventListener('click', async function () { if (await paymentForm({ direction: 'in' })) load(); });
      root.querySelector('#addOut').addEventListener('click', async function () { if (await paymentForm({ direction: 'out' })) load(); });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = parseInt(tr.dataset.id, 10);
        if (e.target.closest('[data-del]')) {
          if (!await U.confirm('این سند حذف شود؟', { danger: true, detail: 'سند حسابداری و چک‌های ثبت‌نشده مربوط نیز حذف می‌شود.' })) return;
          try { await API.call('payments.remove', { id: id }); U.toast('حذف شد.', 'success'); load(); }
          catch (err) { U.toast(err.message, 'error'); }
          return;
        }
        const p = await API.call('payments.get', { id: id });
        await U.modal({
          title: 'سند ' + p.payment_no,
          body:
            '<div class="kv mb"><span class="k">نوع</span><span class="v">' + U.esc(p.direction_label) + '</span>' +
            '<span class="k">تاریخ</span><span class="v">' + U.esc(p.date_jalali) + '</span>' +
            '<span class="k">طرف حساب</span><span class="v">' + U.esc(p.party_name || '—') + '</span>' +
            '<span class="k">فاکتور مرتبط</span><span class="v">' + U.esc(p.ref_no || '—') + '</span>' +
            '<span class="k">مبلغ کل</span><span class="v money">' + U.moneyc(p.total) + '</span>' +
            (p.note ? '<span class="k">توضیحات</span><span class="v">' + U.esc(p.note) + '</span>' : '') + '</div>' +
            '<table class="data compact"><thead><tr><th>روش</th><th>مبلغ</th><th>حساب</th><th>چک</th></tr></thead><tbody>' +
            p.lines.map(function (l) {
              return '<tr><td>' + U.esc(l.method_label) + '</td><td class="money">' + U.money(l.amount) + '</td>' +
                '<td>' + U.esc(l.bank_title || '—') + '</td>' +
                '<td>' + (l.check_code ? '<b>' + U.esc(l.check_code) + '</b><div class="small muted">سررسید ' + U.esc(U.jalali(l.due_date)) + ' — ' + U.esc(l.holder_name || '') + '</div>' : '—') + '</td></tr>';
            }).join('') + '</tbody></table>',
          buttons: [{ label: 'بستن', value: null, cls: 'secondary' }]
        });
      });

      w.Comp.bindExport(root, function () {
        return {
          title: 'دریافت‌ها و پرداخت‌ها', filename: 'payments',
          subtitle: 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to),
          columns: [
            { header: 'شماره سند', key: 'payment_no' }, { header: 'تاریخ', key: 'date_jalali' },
            { header: 'نوع', key: 'direction_label' }, { header: 'طرف حساب', key: 'party_name', align: 'right' },
            { header: 'روش‌ها', key: 'methods' }, { header: 'فاکتور', key: 'ref_no' },
            { header: 'مبلغ', key: 'total', money: true }
          ],
          rows: rows,
          totals: { payment_no: 'جمع', total: rows.reduce(function (a, r) { return a + r.total; }, 0) }
        };
      });

      await load();
    }
  };
})(window);
