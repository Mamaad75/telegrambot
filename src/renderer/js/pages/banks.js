'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  function formatCard(c) {
    if (!c) return '—';
    return String(c).replace(/(\d{4})(?=\d)/g, '$1-');
  }

  async function bankForm(existing) {
    const b = existing || {};
    const body =
      '<div class="row"><div class="field"><label class="req">عنوان حساب</label>' +
      '<input type="text" name="title" value="' + U.esc(b.title || '') + '" placeholder="مثلاً حساب جاری فروشگاه" autofocus></div>' +
      '<div class="field"><label>نوع</label><select name="kind">' +
      '<option value="bank"' + (b.kind !== 'pos' ? ' selected' : '') + '>حساب بانکی</option>' +
      '<option value="pos"' + (b.kind === 'pos' ? ' selected' : '') + '>کارتخوان (POS)</option>' +
      '</select><div class="hint">کارتخوان جدا از حساب بانکی نگهداری می‌شود و بعداً با «انتقال وجه» به بانک منتقل می‌شود.</div></div></div>' +

      '<div class="row"><div class="field"><label>نام بانک</label><input type="text" name="bank_name" value="' + U.esc(b.bank_name || '') + '"></div>' +
      '<div class="field"><label>شعبه</label><input type="text" name="branch" value="' + U.esc(b.branch || '') + '"></div></div>' +

      '<div class="row"><div class="field"><label>شماره حساب</label>' +
      '<input type="text" name="account_number" class="ltr" value="' + U.esc(b.account_number || '') + '"></div>' +
      '<div class="field"><label>شماره کارت</label>' +
      '<input type="text" name="card_number" class="ltr" value="' + U.esc(b.card_number || '') + '" placeholder="۱۶ رقم" maxlength="25"></div></div>' +

      '<div class="row"><div class="field"><label>شماره شبا</label>' +
      '<input type="text" name="iban" class="ltr" value="' + U.esc(b.iban || '') + '" placeholder="IR..."></div>' +
      '<div class="field"><label>نام صاحب حساب</label><input type="text" name="owner_name" value="' + U.esc(b.owner_name || '') + '"></div></div>' +

      (existing
        ? '<div class="alert info">مانده فعلی این حساب: <b>' + U.moneyc(b.balance) + '</b><br>' +
          'برای تغییر مانده از اسناد دریافت/پرداخت یا انتقال وجه استفاده کنید.</div>'
        : '<div class="row"><div class="field"><label>مانده اولیه</label>' +
          '<input type="text" name="opening_balance" class="money" value="0">' +
          '<div class="hint">موجودی فعلی حساب؛ به‌عنوان سرمایه اولیه ثبت می‌شود.</div></div>' +
          U.dateField('date', U.today(), 'تاریخ مانده اولیه') + '</div>') +

      '<div class="field"><label>توضیحات</label><input type="text" name="note" value="' + U.esc(b.note || '') + '"></div>' +
      '<div class="row"><label class="checkbox"><input type="checkbox" name="is_default"' + (b.is_default ? ' checked' : '') + '> حساب پیش‌فرض این نوع</label>' +
      '<label class="checkbox"><input type="checkbox" name="active"' + (b.active === 0 ? '' : ' checked') + '> فعال</label></div>';

    return U.modal({
      title: existing ? 'ویرایش حساب: ' + b.title : 'حساب بانکی / کارتخوان جدید',
      size: 'lg',
      body: body,
      buttons: [
        {
          label: 'ذخیره', cls: 'btn', onClick: async function (m) {
            const data = {
              title: U.val(m, 'title').trim(),
              kind: U.val(m, 'kind'),
              bank_name: U.val(m, 'bank_name'),
              branch: U.val(m, 'branch'),
              account_number: U.val(m, 'account_number'),
              card_number: U.val(m, 'card_number'),
              iban: U.val(m, 'iban'),
              owner_name: U.val(m, 'owner_name'),
              note: U.val(m, 'note'),
              is_default: U.val(m, 'is_default'),
              active: U.val(m, 'active')
            };
            if (!data.title) { U.toast('عنوان حساب را وارد کنید.', 'warn'); return false; }
            if (!existing) {
              data.opening_balance = U.valMoney(m, 'opening_balance');
              data.date = U.getDate(m, 'date');
            }
            try {
              const saved = existing
                ? await API.call('bank.update', { id: existing.id, data: data })
                : await API.call('bank.create', { data: data });
              U.toast('حساب ذخیره شد.', 'success');
              return saved;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) { U.enhance(m); }
    });
  }

  async function statement(id) {
    const range = w.Jalali.range('month');
    const body = '<div id="stRange" class="mb"></div><div id="stBody">' + U.loading() + '</div>';
    return U.modal({
      title: 'گردش حساب',
      size: 'xl',
      body: body,
      buttons: [
        { label: 'چاپ', cls: 'secondary', onClick: function (m) { doPrint(); return false; } },
        { label: 'بستن', cls: 'ghost', value: null }
      ],
      onOpen: function (m) {
        let cur = range;
        let data = null;
        w.Comp.rangeBar({
          container: m.querySelector('#stRange'), kind: 'month',
          onChange: function (r) { cur = r; load(); }
        });
        async function load() {
          const box = m.querySelector('#stBody');
          box.innerHTML = U.loading();
          data = await API.call('bank.statement', { id: id, from: cur.from, to: cur.to });
          m.querySelector('.modal-head h3').textContent = 'گردش حساب: ' + data.account.title;
          box.innerHTML =
            '<div class="grid c3 mb">' +
            '<div class="stat"><div class="label">مانده ابتدای دوره</div><div class="value money">' + U.money(data.opening) + '</div></div>' +
            '<div class="stat accent"><div class="label">تعداد گردش</div><div class="value">' + w.Fmt.toFaDigits(data.rows.length) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">مانده پایان دوره</div><div class="value money">' + U.money(data.closing) + '</div></div></div>' +
            '<div class="table-wrap"><table class="data compact"><thead><tr><th>تاریخ</th><th class="name">شرح</th>' +
            '<th>مرجع</th><th>واریز</th><th>برداشت</th><th>مانده</th></tr></thead><tbody>' +
            (data.rows.length ? data.rows.map(function (r) {
              return '<tr><td>' + U.esc(U.jalali(r.date)) + '</td>' +
                '<td class="name">' + U.esc(r.description || r.entry_desc || '') + '</td>' +
                '<td class="small">' + U.esc(r.ref_no || '') + '</td>' +
                '<td class="money money-pos">' + (r.debit ? U.money(r.debit) : '') + '</td>' +
                '<td class="money money-neg">' + (r.credit ? U.money(r.credit) : '') + '</td>' +
                '<td class="money bold">' + U.money(r.balance) + '</td></tr>';
            }).join('') : U.emptyRow(6, 'گردشی در این بازه وجود ندارد.')) + '</tbody></table></div>';
        }
        function doPrint() {
          if (!data) return;
          API.safe('print.report', {
            title: 'گردش حساب ' + data.account.title,
            subtitle: 'از ' + U.jalali(cur.from) + ' تا ' + U.jalali(cur.to) + ' — مانده ابتدای دوره: ' + U.money(data.opening),
            columns: [
              { header: 'تاریخ', key: 'date_j' }, { header: 'شرح', key: 'desc', align: 'right' },
              { header: 'مرجع', key: 'ref_no' }, { header: 'واریز', key: 'debit', money: true },
              { header: 'برداشت', key: 'credit', money: true }, { header: 'مانده', key: 'balance', money: true }
            ],
            rows: data.rows.map(function (r) {
              return { date_j: U.jalali(r.date), desc: r.description || r.entry_desc, ref_no: r.ref_no, debit: r.debit, credit: r.credit, balance: r.balance };
            }),
            totals: { desc: 'مانده پایان دوره', balance: data.closing },
            filename: 'bank-statement'
          });
        }
        load();
      }
    });
  }

  w.Pages.banks = {
    title: 'حساب‌های بانکی و کارتخوان',
    render: async function (root) {
      root.innerHTML =
        '<div class="toolbar">' +
        '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="عنوان، بانک، شماره حساب یا کارت"></div>' +
        '<div class="field f-sm"><label>نوع</label><select id="kind"><option value="">همه</option>' +
        '<option value="bank">حساب بانکی</option><option value="pos">کارتخوان</option></select></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn" id="add">+ حساب جدید</button>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button>' +
        '</div>' +
        '<div class="grid c4 mb" id="sum"></div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
        '<th class="name">عنوان</th><th>نوع</th><th>بانک</th><th>شماره حساب</th><th>شماره کارت</th><th>شبا</th>' +
        '<th>صاحب حساب</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody></tbody></table></div></div></div>' +
        '<div class="alert info">مانده هر حساب مستقیماً از دفتر حسابداری محاسبه می‌شود؛ بنابراین همیشه با اسناد مالی هماهنگ است.</div>';

      const state = { search: '', kind: '' };
      let rows = [];

      async function load() {
        rows = await API.call('bank.list', state);
        const bal = await API.call('bank.balances', {});
        root.querySelector('#sum').innerHTML =
          '<div class="stat accent-green"><div class="label">💵 موجودی صندوق (نقد)</div><div class="value money">' + U.money(bal.cash) + '</div></div>' +
          '<div class="stat accent"><div class="label">💳 جمع کارتخوان‌ها</div><div class="value money">' + U.money(bal.pos) + '</div></div>' +
          '<div class="stat accent"><div class="label">🏦 جمع حساب‌های بانکی</div><div class="value money">' + U.money(bal.bank) + '</div></div>' +
          '<div class="stat accent-green"><div class="label">جمع کل نقدینگی</div><div class="value money">' + U.money(bal.total) + '</div></div>';

        const tb = root.querySelector('#tbl tbody');
        tb.innerHTML = rows.length ? rows.map(function (b) {
          return '<tr data-id="' + b.id + '">' +
            '<td class="name"><b>' + U.esc(b.title) + '</b>' + (b.is_default ? ' <span class="tag blue">پیش‌فرض</span>' : '') + '</td>' +
            '<td><span class="tag ' + (b.kind === 'pos' ? 'orange' : 'blue') + '">' + U.esc(b.kind_label) + '</span></td>' +
            '<td>' + U.esc(b.bank_name || '—') + (b.branch ? '<div class="small muted">' + U.esc(b.branch) + '</div>' : '') + '</td>' +
            '<td class="small" style="direction:ltr">' + U.esc(b.account_number || '—') + '</td>' +
            '<td class="small" style="direction:ltr">' + U.esc(formatCard(b.card_number)) + '</td>' +
            '<td class="small" style="direction:ltr">' + U.esc(b.iban || '—') + '</td>' +
            '<td class="small">' + U.esc(b.owner_name || '—') + '</td>' +
            '<td class="money bold ' + (b.balance < 0 ? 'money-neg' : '') + '">' + U.money(b.balance) + '</td>' +
            '<td><span class="tag ' + (b.active ? 'green' : 'gray') + '">' + (b.active ? 'فعال' : 'غیرفعال') + '</span></td>' +
            '<td class="actions">' +
            '<button class="btn ghost sm" data-stmt>گردش</button>' +
            '<button class="btn ghost sm" data-edit>ویرایش</button>' +
            '<button class="btn ghost sm" data-del>حذف</button></td></tr>';
        }).join('') : U.emptyRow(10, 'هنوز حساب بانکی یا کارتخوانی ثبت نشده است.', '🏦');
      }

      root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
      root.querySelector('#kind').addEventListener('change', function () { state.kind = this.value; load(); });
      root.querySelector('#add').addEventListener('click', async function () { if (await bankForm(null)) load(); });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = parseInt(tr.dataset.id, 10);
        if (e.target.closest('[data-stmt]')) { await statement(id); return; }
        if (e.target.closest('[data-edit]')) {
          const b = await API.call('bank.get', { id: id });
          if (await bankForm(b)) load();
          return;
        }
        if (e.target.closest('[data-del]')) {
          const b = rows.find(function (x) { return x.id === id; });
          if (!await U.confirm('حساب «' + b.title + '» حذف شود؟', { danger: true })) return;
          try { await API.call('bank.remove', { id: id }); U.toast('حساب حذف شد.', 'success'); load(); }
          catch (err) {
            if (await U.confirm(err.message + '\n\nآیا حساب غیرفعال شود؟')) {
              await API.safe('bank.deactivate', { id: id });
              load();
            }
          }
        }
      });

      w.Comp.bindExport(root, function () {
        return {
          title: 'حساب‌های بانکی و کارتخوان', filename: 'bank-accounts', landscape: true,
          columns: [
            { header: 'عنوان', key: 'title', align: 'right' }, { header: 'نوع', key: 'kind_label' },
            { header: 'بانک', key: 'bank_name' }, { header: 'شماره حساب', key: 'account_number' },
            { header: 'شماره کارت', key: 'card_number' }, { header: 'شبا', key: 'iban' },
            { header: 'صاحب حساب', key: 'owner_name' }, { header: 'مانده', key: 'balance', money: true }
          ],
          rows: rows,
          totals: { title: 'جمع', balance: rows.reduce(function (a, r) { return a + r.balance; }, 0) }
        };
      });

      await load();
    }
  };

  w.BankForm = bankForm;
})(window);
