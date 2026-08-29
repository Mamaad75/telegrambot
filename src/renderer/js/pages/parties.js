'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  const LABEL = { customer: 'مشتری', supplier: 'تأمین‌کننده' };

  async function partyForm(type, existing) {
    const p = existing || {};
    const body =
      '<div class="row"><div class="field"><label class="req">نام</label>' +
      '<input type="text" name="name" value="' + U.esc(p.name || '') + '" autofocus></div>' +
      '<div class="field"><label>تلفن</label><input type="text" name="phone" class="ltr" value="' + U.esc(p.phone || '') + '"></div></div>' +
      '<div class="row"><div class="field"><label>کد ملی</label><input type="text" name="national_id" class="ltr" value="' + U.esc(p.national_id || '') + '"></div>' +
      '<div class="field"><label>کد اقتصادی</label><input type="text" name="economic_code" class="ltr" value="' + U.esc(p.economic_code || '') + '"></div></div>' +
      '<div class="field"><label>نشانی</label><textarea name="address">' + U.esc(p.address || '') + '</textarea></div>' +
      '<div class="field"><label>مانده اولیه' + (type === 'customer' ? ' (بدهی مشتری به ما)' : ' (بدهی ما به تأمین‌کننده)') + '</label>' +
      '<input type="text" name="opening_balance" class="money" value="' + U.money(p.opening_balance || 0) + '">' +
      '<div class="hint">اگر از قبل حسابی باز دارید، مبلغ آن را اینجا وارد کنید.</div></div>' +
      (existing ? '<div class="alert info">مانده فعلی: <b>' + U.moneyc(p.balance) + '</b></div>' : '') +
      '<div class="field"><label>توضیحات</label><input type="text" name="note" value="' + U.esc(p.note || '') + '"></div>' +
      '<label class="checkbox"><input type="checkbox" name="active"' + (p.active === 0 ? '' : ' checked') + '> فعال</label>';

    return U.modal({
      title: existing ? 'ویرایش ' + LABEL[type] + ': ' + p.name : LABEL[type] + ' جدید',
      body: body,
      buttons: [
        {
          label: 'ذخیره', cls: 'btn', onClick: async function (m) {
            const data = {
              name: U.val(m, 'name').trim(), phone: U.val(m, 'phone'),
              national_id: U.val(m, 'national_id'), economic_code: U.val(m, 'economic_code'),
              address: U.val(m, 'address'), note: U.val(m, 'note'),
              opening_balance: U.valMoney(m, 'opening_balance'), active: U.val(m, 'active')
            };
            if (!data.name) { U.toast('نام الزامی است.', 'warn'); return false; }
            try {
              const saved = existing
                ? await API.call('party.update', { type: type, id: existing.id, data: data })
                : await API.call('party.create', { type: type, data: data });
              U.toast('ذخیره شد.', 'success');
              return saved;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) { U.enhance(m); }
    });
  }

  async function partyCard(type, id) {
    const range = w.Jalali.range('year');
    return U.modal({
      title: 'پرونده ' + LABEL[type],
      size: 'xl',
      body: '<div id="pcRange" class="mb"></div><div id="pcBody">' + U.loading() + '</div>',
      buttons: [
        { label: '🖨 چاپ صورت‌حساب', cls: 'secondary', onClick: function (m) { m.__print(); return false; } },
        { label: 'ثبت ' + (type === 'customer' ? 'دریافت' : 'پرداخت'), cls: 'success', value: 'pay', right: true },
        { label: 'ویرایش', cls: 'secondary', value: 'edit' },
        { label: 'بستن', cls: 'ghost', value: null }
      ],
      onOpen: function (m) {
        let cur = range;
        let data = null;
        w.Comp.rangeBar({
          container: m.querySelector('#pcRange'), kind: 'year',
          onChange: function (r) { cur = r; load(); }
        });
        m.__print = function () {
          if (!data) return;
          API.safe('print.statement', { type: type, id: id, from: cur.from, to: cur.to });
        };
        async function load() {
          const box = m.querySelector('#pcBody');
          box.innerHTML = U.loading();
          const [st, sum] = await Promise.all([
            API.call('party.statement', { type: type, id: id, from: cur.from, to: cur.to }),
            API.call('party.summary', { type: type, id: id, from: cur.from, to: cur.to })
          ]);
          data = st;
          m.querySelector('.modal-head h3').textContent = 'پرونده ' + LABEL[type] + ': ' + st.party.name;
          const isCust = type === 'customer';
          box.innerHTML =
            '<div class="grid c4 mb">' +
            '<div class="stat"><div class="label">' + (isCust ? 'جمع خرید' : 'جمع فروش به ما') + '</div>' +
            '<div class="value money">' + U.money(isCust ? sum.total_sales : sum.total_purchases) + '</div>' +
            '<div class="sub">' + w.Fmt.toFaDigits(sum.invoices) + ' فاکتور</div></div>' +
            '<div class="stat"><div class="label">جمع ' + (isCust ? 'دریافتی' : 'پرداختی') + '</div>' +
            '<div class="value money">' + U.money(sum.total_payments) + '</div></div>' +
            '<div class="stat"><div class="label">برگشتی‌ها</div><div class="value money">' + U.money(sum.total_returns) + '</div></div>' +
            '<div class="stat ' + (sum.balance > 0 ? 'accent-red' : 'accent-green') + '"><div class="label">مانده حساب</div>' +
            '<div class="value money">' + U.money(sum.balance) + '</div>' +
            '<div class="sub">' + (sum.balance > 0 ? (isCust ? 'بدهکار به ما' : 'ما بدهکاریم') : (sum.balance < 0 ? 'بستانکار' : 'تسویه')) + '</div></div>' +
            '</div>' +
            '<div class="kv mb"><span class="k">تلفن</span><span class="v">' + U.esc(st.party.phone || '—') + '</span>' +
            '<span class="k">نشانی</span><span class="v">' + U.esc(st.party.address || '—') + '</span></div>' +
            '<h4 style="font-size:13px;margin:10px 0 6px">صورت‌حساب</h4>' +
            '<div class="table-wrap" style="max-height:380px;overflow-y:auto"><table class="data compact"><thead><tr>' +
            '<th>تاریخ</th><th class="name">شرح</th><th>مرجع</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead><tbody>' +
            '<tr><td colspan="5" class="name muted">مانده ابتدای دوره</td><td class="money bold">' + U.money(st.opening) + '</td></tr>' +
            (st.rows.length ? st.rows.map(function (r) {
              return '<tr><td>' + U.esc(r.date_jalali) + '</td><td class="name">' + U.esc(r.description || r.entry_desc || '') + '</td>' +
                '<td class="small">' + U.esc(r.ref_no || '') + '</td>' +
                '<td class="money">' + (r.debit ? U.money(r.debit) : '') + '</td>' +
                '<td class="money">' + (r.credit ? U.money(r.credit) : '') + '</td>' +
                '<td class="money bold">' + U.money(r.balance) + '</td></tr>';
            }).join('') : '') + '</tbody>' +
            '<tfoot><tr><td colspan="5">مانده پایان دوره</td><td class="money">' + U.money(st.closing) + '</td></tr></tfoot></table></div>';
        }
        load();
      }
    });
  }

  function buildPage(type) {
    return {
      title: type === 'customer' ? 'مشتریان' : 'تأمین‌کنندگان',
      render: async function (root, ctx) {
        const state = { type: type, search: '', active: '', limit: 500 };
        let rows = [];

        root.innerHTML =
          '<div class="toolbar">' +
          '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="نام، تلفن یا نشانی"></div>' +
          '<div class="field f-sm"><label>وضعیت</label><select id="act"><option value="">همه</option>' +
          '<option value="1">فعال</option><option value="0">غیرفعال</option></select></div>' +
          '<label class="checkbox" style="margin-bottom:7px"><input type="checkbox" id="debt"> فقط دارای مانده</label>' +
          '<span class="spacer"></span>' +
          '<button class="btn" id="add">+ ' + LABEL[type] + ' جدید</button>' +
          '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
          '<button class="btn secondary sm" data-export-print>چاپ</button>' +
          '</div>' +
          '<div class="grid c3 mb" id="sum"></div>' +
          '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
          '<th class="name">نام</th><th>تلفن</th><th class="name">نشانی</th><th>مانده حساب</th><th>وضعیت</th><th>عملیات</th>' +
          '</tr></thead><tbody></tbody></table></div></div></div>';

        async function load() {
          rows = await API.call('party.list', state);
          if (root.querySelector('#debt').checked) rows = rows.filter(function (r) { return r.balance !== 0; });
          const pos = rows.filter(function (r) { return r.balance > 0; }).reduce(function (a, r) { return a + r.balance; }, 0);
          const neg = rows.filter(function (r) { return r.balance < 0; }).reduce(function (a, r) { return a + r.balance; }, 0);
          root.querySelector('#sum').innerHTML =
            '<div class="stat accent"><div class="label">تعداد</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
            '<div class="stat accent-red"><div class="label">' + (type === 'customer' ? 'جمع طلب ما از مشتریان' : 'جمع بدهی ما به تأمین‌کنندگان') + '</div>' +
            '<div class="value money">' + U.money(pos) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">' + (type === 'customer' ? 'پیش‌دریافت از مشتریان' : 'پیش‌پرداخت به تأمین‌کنندگان') + '</div>' +
            '<div class="value money">' + U.money(-neg) + '</div></div>';

          const tb = root.querySelector('#tbl tbody');
          tb.innerHTML = rows.length ? rows.map(function (p) {
            return '<tr data-id="' + p.id + '" class="clickable">' +
              '<td class="name"><b>' + U.esc(p.name) + '</b></td>' +
              '<td class="small" style="direction:ltr">' + U.esc(p.phone || '—') + '</td>' +
              '<td class="name small muted">' + U.esc(p.address || '—') + '</td>' +
              '<td class="money bold ' + (p.balance > 0 ? 'money-neg' : (p.balance < 0 ? 'money-pos' : '')) + '">' + U.money(p.balance) + '</td>' +
              '<td><span class="tag ' + (p.active ? 'green' : 'gray') + '">' + (p.active ? 'فعال' : 'غیرفعال') + '</span></td>' +
              '<td class="actions"><button class="btn ghost sm" data-card>پرونده</button>' +
              '<button class="btn ghost sm" data-edit>ویرایش</button>' +
              '<button class="btn ghost sm" data-del>حذف</button></td></tr>';
          }).join('') : U.emptyRow(6, LABEL[type] + 'ی ثبت نشده است.', '👥');
        }

        root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
        root.querySelector('#act').addEventListener('change', function () { state.active = this.value; load(); });
        root.querySelector('#debt').addEventListener('change', load);
        root.querySelector('#add').addEventListener('click', async function () { if (await partyForm(type, null)) load(); });

        root.querySelector('#tbl').addEventListener('click', async function (e) {
          const tr = e.target.closest('tr[data-id]');
          if (!tr) return;
          const id = parseInt(tr.dataset.id, 10);
          if (e.target.closest('[data-edit]')) {
            const p = await API.call('party.get', { type: type, id: id });
            if (await partyForm(type, p)) load();
            return;
          }
          if (e.target.closest('[data-del]')) {
            const p = rows.find(function (x) { return x.id === id; });
            if (!await U.confirm('«' + p.name + '» حذف شود؟', { danger: true })) return;
            try { await API.call('party.remove', { type: type, id: id }); U.toast('حذف شد.', 'success'); load(); }
            catch (err) {
              if (await U.confirm(err.message + '\n\nآیا غیرفعال شود؟')) {
                await API.safe('party.deactivate', { type: type, id: id });
                load();
              }
            }
            return;
          }
          await openCard(id);
        });

        async function openCard(id) {
          const action = await partyCard(type, id);
          if (action === 'edit') {
            const p = await API.call('party.get', { type: type, id: id });
            if (await partyForm(type, p)) load();
          } else if (action === 'pay') {
            const done = await w.PaymentForm({
              direction: type === 'customer' ? 'in' : 'out',
              party_type: type, party_id: id
            });
            if (done) load();
          }
        }

        w.Comp.bindExport(root, function () {
          return {
            title: type === 'customer' ? 'فهرست مشتریان' : 'فهرست تأمین‌کنندگان',
            filename: type === 'customer' ? 'customers' : 'suppliers',
            columns: [
              { header: 'نام', key: 'name', align: 'right' }, { header: 'تلفن', key: 'phone' },
              { header: 'نشانی', key: 'address', align: 'right' }, { header: 'مانده', key: 'balance', money: true }
            ],
            rows: rows,
            totals: { name: 'جمع', balance: rows.reduce(function (a, r) { return a + r.balance; }, 0) }
          };
        });

        await load();
        if (ctx.params && ctx.params.focusId) openCard(ctx.params.focusId);
      }
    };
  }

  w.Pages.customers = buildPage('customer');
  w.Pages.suppliers = buildPage('supplier');
  w.PartyForm = partyForm;
  w.PartyCard = partyCard;
})(window);
