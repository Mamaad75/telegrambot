'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  const STATUS_CLASS = {
    pending: 'blue', deposited: 'orange', cleared: 'green', paid: 'green', returned: 'red', cancelled: 'gray'
  };

  /* --------------------------- کارت جزئیات چک --------------------------- */
  async function checkCard(id) {
    const c = await API.call('checks.get', { id: id });
    if (!c) { U.toast('چک یافت نشد.', 'error'); return null; }
    const banks = await API.call('bank.list', { active: 1 });

    const events = c.events.map(function (e, i) {
      return '<tr><td>' + w.Fmt.toFaDigits(i + 1) + '</td><td>' + U.esc(e.date_jalali) + '</td>' +
        '<td><span class="tag ' + (STATUS_CLASS[e.status] || '') + '">' + U.esc(e.status_label) + '</span></td>' +
        '<td class="name small">' + U.esc(e.description || '') + '</td>' +
        '<td class="small muted">' + (e.journal_entry_id ? 'سند #' + w.Fmt.toFaDigits(e.journal_entry_id) : '—') + '</td></tr>';
    }).join('');

    const nextButtons = (c.allowed_next || []).map(function (s) {
      const label = App.info.constants.check_status[s] || s;
      const cls = s === 'cleared' || s === 'paid' ? 'success' : (s === 'returned' || s === 'cancelled' ? 'danger' : 'secondary');
      return '<button class="btn ' + cls + ' sm" data-status="' + s + '">' + U.esc(label) + '</button>';
    }).join('');

    const body =
      '<div class="grid c4 mb">' +
      '<div class="stat accent"><div class="label">کد یکتای چک</div><div class="value" style="font-size:15px;direction:ltr">' + U.esc(c.check_code) + '</div></div>' +
      '<div class="stat"><div class="label">مبلغ</div><div class="value money">' + U.money(c.amount) + '</div></div>' +
      '<div class="stat"><div class="label">سررسید</div><div class="value" style="font-size:15px">' + U.esc(c.due_date_jalali || '-') + '</div>' +
      (c.is_overdue ? '<div class="sub money-neg">سررسید گذشته</div>' : (c.days_to_due !== null && c.is_open ? '<div class="sub">' + w.Fmt.toFaDigits(c.days_to_due) + ' روز مانده</div>' : '')) + '</div>' +
      '<div class="stat ' + (c.status === 'returned' ? 'accent-red' : (c.status === 'cleared' || c.status === 'paid' ? 'accent-green' : 'accent-orange')) + '">' +
      '<div class="label">وضعیت</div><div class="value" style="font-size:15px">' + U.esc(c.status_label) + '</div></div>' +
      '</div>' +

      '<div class="card"><div class="card-body"><div class="kv">' +
      '<span class="k">نوع چک</span><span class="v">' + U.esc(c.direction_label) + '</span>' +
      '<span class="k">شماره چک</span><span class="v">' + U.esc(c.check_number || '—') + '</span>' +
      '<span class="k">شناسه صیادی</span><span class="v">' + U.esc(c.sayad_id || '—') + '</span>' +
      '<span class="k">بانک / شعبه</span><span class="v">' + U.esc(c.bank_name || '—') + (c.branch ? ' / ' + U.esc(c.branch) : '') + '</span>' +
      '<span class="k">' + (c.direction === 'received' ? 'دارنده / صاحب چک' : 'در وجه') + '</span><span class="v">' + U.esc(c.holder_name || '—') + '</span>' +
      '<span class="k">طرف حساب</span><span class="v">' + U.esc(c.party_name || '—') + '</span>' +
      '<span class="k">فاکتور مرتبط</span><span class="v">' + (c.ref_no ? U.esc(c.ref_no) + (c.invoice ? ' — ' + U.moneyc(c.invoice.total) : '') : '—') +
      (c.invoice ? ' <button class="btn ghost sm" data-open-invoice>مشاهده فاکتور</button>' : '') + '</span>' +
      '<span class="k">حساب بانکی</span><span class="v">' + U.esc(c.bank_account_title || '—') + '</span>' +
      '<span class="k">مبلغ به حروف</span><span class="v">' + U.esc(U.words(c.amount)) + ' ' + U.esc(U.cur()) + '</span>' +
      (c.note ? '<span class="k">توضیحات</span><span class="v">' + U.esc(c.note) + '</span>' : '') +
      '</div></div></div>' +

      (nextButtons ? '<div class="card"><div class="card-head"><h3>تغییر وضعیت</h3></div><div class="card-body">' +
        '<div class="row tight mb">' + U.dateField('statusDate', U.today(), 'تاریخ عملیات', 'f-sm') +
        '<div class="field"><label>حساب مقصد (برای وصول یا پرداخت)</label>' +
        '<select name="statusBank"><option value="">صندوق (نقدی)</option>' +
        banks.map(function (b) { return '<option value="' + b.id + '"' + (String(c.bank_account_id) === String(b.id) ? ' selected' : '') + '>' + U.esc(b.title) + '</option>'; }).join('') +
        '</select></div></div>' +
        '<div class="btn-group">' + nextButtons + '</div>' +
        '</div></div>' : '<div class="alert info">این چک در وضعیت نهایی است و تغییر وضعیت ندارد.</div>') +

      '<div class="card"><div class="card-head"><h3>تاریخچه</h3><span class="spacer"></span>' +
      (c.events.length > 1 ? '<button class="btn ghost sm" data-revert>بازگردانی آخرین وضعیت</button>' : '') + '</div>' +
      '<div class="card-body tight"><table class="data compact"><thead><tr><th>#</th><th>تاریخ</th><th>وضعیت</th>' +
      '<th class="name">شرح</th><th>سند حسابداری</th></tr></thead><tbody>' + events + '</tbody></table></div></div>';

    return U.modal({
      title: 'چک ' + c.check_code,
      size: 'lg',
      body: body,
      buttons: [
        { label: '🖨 چاپ شناسنامه چک', cls: 'secondary', onClick: function () { API.safe('print.check', { id: id }); return false; } },
        { label: 'ویرایش اطلاعات', cls: 'secondary', value: 'edit', right: true },
        { label: 'بستن', cls: 'ghost', value: null }
      ],
      onOpen: function (m, close) {
        U.enhance(m);
        m.addEventListener('click', async function (e) {
          const st = e.target.closest('[data-status]');
          if (st) {
            const status = st.dataset.status;
            const label = App.info.constants.check_status[status];
            const bankVal = m.querySelector('[name="statusBank"]') ? m.querySelector('[name="statusBank"]').value : '';
            if (!await U.confirm('وضعیت چک ' + c.check_code + ' به «' + label + '» تغییر کند؟')) return;
            try {
              await API.call('checks.changeStatus', {
                id: id,
                data: {
                  status: status,
                  date: U.getDate(m, 'statusDate') || U.today(),
                  bank_account_id: bankVal ? parseInt(bankVal, 10) : null,
                  method: bankVal ? 'bank' : 'cash'
                }
              });
              U.toast('وضعیت چک به «' + label + '» تغییر کرد.', 'success');
              close('changed');
            } catch (err) { U.toast(err.message, 'error'); }
            return;
          }
          if (e.target.closest('[data-revert]')) {
            if (!await U.confirm('آخرین تغییر وضعیت این چک بازگردانی شود؟', { danger: true, detail: 'سند حسابداری مربوط به آن نیز حذف می‌شود.' })) return;
            try {
              await API.call('checks.revert', { id: id });
              U.toast('وضعیت قبلی بازگردانده شد.', 'success');
              close('changed');
            } catch (err) { U.toast(err.message, 'error'); }
            return;
          }
          if (e.target.closest('[data-open-invoice]')) {
            close(null);
            App.go(c.ref_type === 'purchase_invoice' ? 'purchases' : 'sales', { focusId: c.ref_id });
          }
        });
      }
    });
  }

  async function editCheck(c) {
    return U.modal({
      title: 'ویرایش اطلاعات چک ' + c.check_code,
      body:
        '<div class="row"><div class="field"><label>شماره چک</label><input type="text" class="ltr" name="check_number" value="' + U.esc(c.check_number || '') + '"></div>' +
        '<div class="field"><label>شناسه صیادی</label><input type="text" class="ltr" name="sayad_id" value="' + U.esc(c.sayad_id || '') + '"></div></div>' +
        '<div class="row"><div class="field"><label>بانک</label><input type="text" name="bank_name" value="' + U.esc(c.bank_name || '') + '"></div>' +
        '<div class="field"><label>شعبه</label><input type="text" name="branch" value="' + U.esc(c.branch || '') + '"></div></div>' +
        '<div class="field"><label>نام دارنده / در وجه</label><input type="text" name="holder_name" value="' + U.esc(c.holder_name || '') + '"></div>' +
        '<div class="row">' + U.dateField('issue_date', c.issue_date, 'تاریخ صدور') + U.dateField('due_date', c.due_date, 'تاریخ سررسید') + '</div>' +
        '<div class="field"><label>توضیحات</label><textarea name="note">' + U.esc(c.note || '') + '</textarea></div>' +
        '<div class="alert info">مبلغ چک از سند مالی آن گرفته می‌شود و در این بخش قابل تغییر نیست.</div>',
      buttons: [
        {
          label: 'ذخیره', cls: 'btn', onClick: async function (m) {
            try {
              await API.call('checks.update', {
                id: c.id,
                data: {
                  check_number: U.val(m, 'check_number'), sayad_id: U.val(m, 'sayad_id'),
                  bank_name: U.val(m, 'bank_name'), branch: U.val(m, 'branch'),
                  holder_name: U.val(m, 'holder_name'),
                  issue_date: U.getDate(m, 'issue_date'), due_date: U.getDate(m, 'due_date'),
                  note: U.val(m, 'note')
                }
              });
              U.toast('اطلاعات چک به‌روزرسانی شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) { U.enhance(m); }
    });
  }

  /* --------------------------------- صفحه --------------------------------- */
  w.Pages.checks = {
    title: 'مدیریت چک‌ها',
    render: async function (root, ctx) {
      const state = { direction: '', status: '', search: '', overdue: false, order: 'due', limit: 200, offset: 0 };
      let rows = [];

      root.innerHTML =
        '<div class="toolbar">' +
        '<div class="field f-lg"><label>جست‌وجو (کد چک، نام دارنده، شماره فاکتور، شماره چک، صیادی)</label>' +
        '<input type="search" id="q" placeholder="مثلاً CHK-R-000012 یا نام دارنده یا شماره فاکتور"></div>' +
        '<div class="field f-sm"><label>نوع</label><select id="dir">' +
        '<option value="">همه</option><option value="received">دریافتی</option><option value="issued">صادره</option></select></div>' +
        '<div class="field f-md"><label>وضعیت</label><select id="st"><option value="">همه</option>' +
        Object.keys(App.info.constants.check_status).map(function (k) {
          return '<option value="' + k + '">' + U.esc(App.info.constants.check_status[k]) + '</option>';
        }).join('') + '</select></div>' +
        '<label class="checkbox" style="margin-bottom:7px"><input type="checkbox" id="ovd"> فقط سررسید گذشته</label>' +
        '<div class="field f-sm"><label>مرتب‌سازی</label><select id="ord">' +
        '<option value="due">سررسید</option><option value="id">جدیدترین</option></select></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button>' +
        '</div>' +
        '<div class="grid c5 mb" id="sum"></div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
        '<th>کد یکتا</th><th>نوع</th><th>شماره چک</th><th class="name">دارنده / صادرکننده</th>' +
        '<th class="name">طرف حساب</th><th>بانک</th><th>مبلغ</th><th>سررسید</th><th>فاکتور</th><th>وضعیت</th><th>عملیات</th>' +
        '</tr></thead><tbody></tbody></table></div></div></div>';

      async function loadSummary() {
        const s = await API.call('checks.summary', {});
        root.querySelector('#sum').innerHTML =
          '<div class="stat accent clickable" data-f="open-received"><div class="label">🧿 چک‌های دریافتی در جریان</div>' +
          '<div class="value money">' + U.money(s.open_received.s) + '</div><div class="sub">' + w.Fmt.toFaDigits(s.open_received.c) + ' فقره</div></div>' +
          '<div class="stat accent-red clickable" data-f="open-issued"><div class="label">🧾 چک‌های صادره در جریان</div>' +
          '<div class="value money">' + U.money(s.open_issued.s) + '</div><div class="sub">' + w.Fmt.toFaDigits(s.open_issued.c) + ' فقره</div></div>' +
          '<div class="stat accent-orange clickable" data-f="due-soon"><div class="label">⏰ نزدیک سررسید (' + w.Fmt.toFaDigits(s.reminder_days) + ' روز)</div>' +
          '<div class="value money">' + U.money(s.due_soon.s) + '</div><div class="sub">' + w.Fmt.toFaDigits(s.due_soon.c) + ' فقره</div></div>' +
          '<div class="stat accent-red clickable" data-f="overdue"><div class="label">⚠ سررسید گذشته</div>' +
          '<div class="value money">' + U.money(s.overdue_received.s + s.overdue_issued.s) + '</div>' +
          '<div class="sub">' + w.Fmt.toFaDigits(s.overdue_received.c + s.overdue_issued.c) + ' فقره</div></div>' +
          '<div class="stat clickable" data-f="returned"><div class="label">↩ برگشتی</div>' +
          '<div class="value money">' + U.money(s.returned.s) + '</div><div class="sub">' + w.Fmt.toFaDigits(s.returned.c) + ' فقره</div></div>';
      }

      async function load() {
        rows = await API.call('checks.list', state);
        const tb = root.querySelector('#tbl tbody');
        if (!rows.length) { tb.innerHTML = U.emptyRow(11, 'چکی با این شرایط یافت نشد.', '🧿'); return; }
        tb.innerHTML = rows.map(function (c) {
          return '<tr data-id="' + c.id + '" class="clickable' + (c.is_overdue ? '' : '') + '">' +
            '<td class="bold" style="direction:ltr">' + U.esc(c.check_code) + '</td>' +
            '<td><span class="tag ' + (c.direction === 'received' ? 'blue' : 'orange') + '">' + U.esc(c.direction_label) + '</span></td>' +
            '<td class="small">' + U.esc(c.check_number || '—') + '</td>' +
            '<td class="name">' + U.esc(c.holder_name || '—') + '</td>' +
            '<td class="name small">' + U.esc(c.party_name || '—') + '</td>' +
            '<td class="small">' + U.esc(c.bank_name || '—') + '</td>' +
            '<td class="money bold">' + U.money(c.amount) + '</td>' +
            '<td class="' + (c.is_overdue ? 'money-neg bold' : '') + '">' + U.esc(c.due_date_jalali || '—') +
            (c.is_overdue ? ' ⚠' : '') + '</td>' +
            '<td class="small">' + U.esc(c.ref_no || '—') + '</td>' +
            '<td><span class="tag ' + (STATUS_CLASS[c.status] || '') + '">' + U.esc(c.status_label) + '</span></td>' +
            '<td class="actions"><button class="btn ghost sm" data-open>مدیریت</button></td></tr>';
        }).join('');
      }

      root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
      root.querySelector('#dir').addEventListener('change', function () { state.direction = this.value; load(); });
      root.querySelector('#st').addEventListener('change', function () { state.status = this.value; load(); });
      root.querySelector('#ord').addEventListener('change', function () { state.order = this.value; load(); });
      root.querySelector('#ovd').addEventListener('change', function () { state.overdue = this.checked; load(); });

      root.querySelector('#sum').addEventListener('click', function (e) {
        const f = e.target.closest('[data-f]');
        if (!f) return;
        const k = f.dataset.f;
        state.overdue = false; state.direction = ''; state.status = '';
        if (k === 'open-received') { state.direction = 'received'; state.status = ['pending', 'deposited']; }
        if (k === 'open-issued') { state.direction = 'issued'; state.status = 'pending'; }
        if (k === 'overdue') state.overdue = true;
        if (k === 'returned') state.status = 'returned';
        if (k === 'due-soon') { state.status = ['pending', 'deposited']; }
        root.querySelector('#ovd').checked = state.overdue;
        root.querySelector('#dir').value = state.direction;
        root.querySelector('#st').value = typeof state.status === 'string' ? state.status : '';
        load();
      });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        await open(parseInt(tr.dataset.id, 10));
      });

      async function open(id) {
        const res = await checkCard(id);
        if (res === 'changed') { await load(); await loadSummary(); }
        else if (res === 'edit') {
          const c = await API.call('checks.get', { id: id });
          if (await editCheck(c)) { await load(); await open(id); }
        }
      }

      w.Comp.bindExport(root, function () {
        return {
          title: 'گزارش چک‌ها', filename: 'checks', landscape: true,
          columns: [
            { header: 'کد یکتا', key: 'check_code' }, { header: 'نوع', key: 'direction_label' },
            { header: 'شماره چک', key: 'check_number' }, { header: 'دارنده', key: 'holder_name', align: 'right' },
            { header: 'طرف حساب', key: 'party_name', align: 'right' }, { header: 'بانک', key: 'bank_name' },
            { header: 'مبلغ', key: 'amount', money: true }, { header: 'سررسید', key: 'due_date_jalali' },
            { header: 'فاکتور', key: 'ref_no' }, { header: 'وضعیت', key: 'status_label' }
          ],
          rows: rows,
          totals: { check_code: 'جمع', amount: rows.reduce(function (a, r) { return a + r.amount; }, 0) }
        };
      });

      await loadSummary();
      await load();
      if (ctx.params && ctx.params.focusId) open(ctx.params.focusId);
    }
  };

  w.CheckCard = checkCard;
})(window);
