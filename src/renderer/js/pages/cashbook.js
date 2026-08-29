'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  function methodSelect(name, banks, selected, includeCheck) {
    const methods = [
      { k: 'cash', l: 'نقدی (صندوق)' },
      { k: 'pos', l: 'کارتخوان' },
      { k: 'bank', l: 'بانکی' },
      { k: 'card', l: 'کارت به کارت' }
    ];
    if (includeCheck) methods.push({ k: 'check', l: 'چک' });
    return '<select name="' + name + '">' + methods.map(function (m) {
      return '<option value="' + m.k + '"' + (m.k === selected ? ' selected' : '') + '>' + m.l + '</option>';
    }).join('') + '</select>';
  }

  /* ------------------------------- هزینه ------------------------------- */
  async function expenseForm(banks, cats) {
    const body =
      '<div class="row">' + U.dateField('date', U.today(), 'تاریخ') +
      '<div class="field"><label class="req">دسته هزینه</label><select name="category_id">' +
      cats.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.name) + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div class="row"><div class="field"><label class="req">مبلغ</label>' +
      '<input type="text" name="amount" class="money" value="0" autofocus></div>' +
      '<div class="field"><label>روش پرداخت</label>' + methodSelect('method', banks, 'cash', true) + '</div></div>' +
      '<div class="field" id="bankField" style="display:none"><label>حساب</label>' + U.bankSelect('bank_account_id', banks, '') + '</div>' +
      '<div class="pay-check-box" id="checkBox" style="display:none">' +
      '<div class="row tight"><div class="field"><label>شماره چک</label><input type="text" class="ltr" name="check_number"></div>' +
      '<div class="field"><label>بانک</label><input type="text" name="check_bank"></div></div>' +
      '<div class="row tight"><div class="field"><label>در وجه</label><input type="text" name="check_holder"></div>' +
      U.dateField('check_due', U.today(), 'سررسید') + '</div></div>' +
      '<div class="field"><label>شرح</label><input type="text" name="description" placeholder="مثلاً اجاره شهریور"></div>';

    return U.modal({
      title: 'ثبت هزینه',
      body: body,
      buttons: [
        {
          label: 'ثبت هزینه', cls: 'btn', onClick: async function (m) {
            const amount = U.valMoney(m, 'amount');
            if (amount <= 0) { U.toast('مبلغ را وارد کنید.', 'warn'); return false; }
            const method = U.val(m, 'method');
            const data = {
              date: U.getDate(m, 'date'),
              category_id: parseInt(U.val(m, 'category_id'), 10) || null,
              amount: amount, method: method,
              bank_account_id: parseInt(U.val(m, 'bank_account_id'), 10) || null,
              description: U.val(m, 'description')
            };
            if (method === 'check') {
              data.check = {
                check_number: U.val(m, 'check_number'), bank_name: U.val(m, 'check_bank'),
                holder_name: U.val(m, 'check_holder'), due_date: U.getDate(m, 'check_due')
              };
              if (!data.check.due_date) { U.toast('تاریخ سررسید چک را وارد کنید.', 'warn'); return false; }
            }
            try {
              await API.call('expenses.create', { data: data });
              U.toast('هزینه ثبت شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const sel = m.querySelector('[name="method"]');
        const toggle = function () {
          m.querySelector('#bankField').style.display = (sel.value === 'cash' || sel.value === 'check') ? 'none' : '';
          m.querySelector('#checkBox').style.display = sel.value === 'check' ? '' : 'none';
        };
        sel.addEventListener('change', toggle);
        toggle();
      }
    });
  }

  /* ------------------------------- درآمد ------------------------------- */
  async function incomeForm(banks, cats) {
    return U.modal({
      title: 'ثبت درآمد متفرقه',
      body:
        '<div class="row">' + U.dateField('date', U.today(), 'تاریخ') +
        '<div class="field"><label class="req">دسته درآمد</label><select name="category_id">' +
        cats.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.name) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="row"><div class="field"><label class="req">مبلغ</label><input type="text" name="amount" class="money" value="0" autofocus></div>' +
        '<div class="field"><label>روش دریافت</label>' + methodSelect('method', banks, 'cash', false) + '</div></div>' +
        '<div class="field" id="bankField" style="display:none"><label>حساب</label>' + U.bankSelect('bank_account_id', banks, '') + '</div>' +
        '<div class="field"><label>شرح</label><input type="text" name="description"></div>',
      buttons: [
        {
          label: 'ثبت درآمد', cls: 'btn', onClick: async function (m) {
            const amount = U.valMoney(m, 'amount');
            if (amount <= 0) { U.toast('مبلغ را وارد کنید.', 'warn'); return false; }
            try {
              await API.call('incomes.create', {
                data: {
                  date: U.getDate(m, 'date'),
                  category_id: parseInt(U.val(m, 'category_id'), 10) || null,
                  amount: amount, method: U.val(m, 'method'),
                  bank_account_id: parseInt(U.val(m, 'bank_account_id'), 10) || null,
                  description: U.val(m, 'description')
                }
              });
              U.toast('درآمد ثبت شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const sel = m.querySelector('[name="method"]');
        const toggle = function () { m.querySelector('#bankField').style.display = sel.value === 'cash' ? 'none' : ''; };
        sel.addEventListener('change', toggle);
        toggle();
      }
    });
  }

  /* ------------------------------- انتقال ------------------------------- */
  async function transferForm(banks) {
    const kindSel = function (name, val) {
      return '<select name="' + name + '">' +
        '<option value="cash"' + (val === 'cash' ? ' selected' : '') + '>صندوق (نقد)</option>' +
        '<option value="pos"' + (val === 'pos' ? ' selected' : '') + '>کارتخوان</option>' +
        '<option value="bank"' + (val === 'bank' ? ' selected' : '') + '>حساب بانکی</option></select>';
    };
    return U.modal({
      title: 'انتقال وجه بین حساب‌ها',
      body:
        '<div class="row">' + U.dateField('date', U.today(), 'تاریخ') +
        '<div class="field"><label class="req">مبلغ</label><input type="text" name="amount" class="money" value="0" autofocus></div></div>' +
        '<div class="row"><div class="field"><label>از</label>' + kindSel('from_kind', 'cash') + '</div>' +
        '<div class="field" id="fromBankField" style="display:none"><label>حساب مبدأ</label>' + U.bankSelect('from_bank_account_id', banks, '') + '</div></div>' +
        '<div class="row"><div class="field"><label>به</label>' + kindSel('to_kind', 'bank') + '</div>' +
        '<div class="field" id="toBankField"><label>حساب مقصد</label>' + U.bankSelect('to_bank_account_id', banks, '') + '</div></div>' +
        '<div class="row"><div class="field"><label>کارمزد (اختیاری)</label><input type="text" name="fee" class="money" value="0"></div>' +
        '<div class="field"><label>شرح</label><input type="text" name="description" value="انتقال وجه"></div></div>' +
        '<div class="alert info">انتقال وجه هیچ اثری بر سود و زیان ندارد؛ فقط مانده حساب‌ها جابه‌جا می‌شود.</div>',
      buttons: [
        {
          label: 'ثبت انتقال', cls: 'btn', onClick: async function (m) {
            const amount = U.valMoney(m, 'amount');
            if (amount <= 0) { U.toast('مبلغ را وارد کنید.', 'warn'); return false; }
            try {
              await API.call('transfers.create', {
                data: {
                  date: U.getDate(m, 'date'), amount: amount, fee: U.valMoney(m, 'fee'),
                  from_kind: U.val(m, 'from_kind'),
                  from_bank_account_id: parseInt(U.val(m, 'from_bank_account_id'), 10) || null,
                  to_kind: U.val(m, 'to_kind'),
                  to_bank_account_id: parseInt(U.val(m, 'to_bank_account_id'), 10) || null,
                  description: U.val(m, 'description')
                }
              });
              U.toast('انتقال ثبت شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const sync = function () {
          m.querySelector('#fromBankField').style.display = U.val(m, 'from_kind') === 'cash' ? 'none' : '';
          m.querySelector('#toBankField').style.display = U.val(m, 'to_kind') === 'cash' ? 'none' : '';
        };
        m.querySelector('[name="from_kind"]').addEventListener('change', sync);
        m.querySelector('[name="to_kind"]').addEventListener('change', sync);
        sync();
      }
    });
  }

  /* ------------------------------- سرمایه ------------------------------- */
  async function capitalForm(banks) {
    return U.modal({
      title: 'آورده یا برداشت مالک',
      body:
        '<div class="row"><div class="field"><label>نوع</label><select name="kind">' +
        '<option value="in">آورده نقدی (افزایش سرمایه)</option>' +
        '<option value="out">برداشت شخصی</option></select></div>' +
        U.dateField('date', U.today(), 'تاریخ') + '</div>' +
        '<div class="row"><div class="field"><label class="req">مبلغ</label><input type="text" name="amount" class="money" value="0" autofocus></div>' +
        '<div class="field"><label>از/به حساب</label>' + methodSelect('method', banks, 'cash', false) + '</div></div>' +
        '<div class="field" id="bankField" style="display:none"><label>حساب</label>' + U.bankSelect('bank_account_id', banks, '') + '</div>' +
        '<div class="field"><label>شرح</label><input type="text" name="description"></div>',
      buttons: [
        {
          label: 'ثبت', cls: 'btn', onClick: async function (m) {
            const amount = U.valMoney(m, 'amount');
            if (amount <= 0) { U.toast('مبلغ را وارد کنید.', 'warn'); return false; }
            try {
              await API.call('capital.create', {
                data: {
                  kind: U.val(m, 'kind'), date: U.getDate(m, 'date'), amount: amount,
                  method: U.val(m, 'method'),
                  bank_account_id: parseInt(U.val(m, 'bank_account_id'), 10) || null,
                  description: U.val(m, 'description')
                }
              });
              U.toast('سند ثبت شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const sel = m.querySelector('[name="method"]');
        const toggle = function () { m.querySelector('#bankField').style.display = sel.value === 'cash' ? 'none' : ''; };
        sel.addEventListener('change', toggle);
        toggle();
      }
    });
  }

  /* -------------------------------- صفحه -------------------------------- */
  w.Pages.cashbook = {
    title: 'هزینه، درآمد و انتقال',
    render: async function (root) {
      let tab = 'expenses';
      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to, search: '', limit: 300 };
      let rows = [];
      const banks = await API.call('bank.list', { active: 1 });

      root.innerHTML =
        '<div class="tabs">' +
        '<div class="tab active" data-tab="expenses">هزینه‌ها</div>' +
        '<div class="tab" data-tab="incomes">درآمدهای متفرقه</div>' +
        '<div class="tab" data-tab="transfers">انتقال وجه</div>' +
        '<div class="tab" data-tab="capital">سرمایه و برداشت</div>' +
        '</div>' +
        '<div class="toolbar"><div id="rangeBar" style="width:100%"></div>' +
        '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="شرح یا شماره سند"></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn" id="add">+ ثبت جدید</button>' +
        '<button class="btn secondary" id="cats">مدیریت دسته‌ها</button>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button></div>' +
        '<div class="grid c3 mb" id="sum"></div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead></thead><tbody></tbody></table></div></div></div>';

      w.Comp.rangeBar({
        container: root.querySelector('#rangeBar'), kind: 'month',
        onChange: function (r) { state.from = r.from; state.to = r.to; load(); }
      });

      root.querySelector('.tabs').addEventListener('click', function (e) {
        const t = e.target.closest('[data-tab]');
        if (!t) return;
        tab = t.dataset.tab;
        U.$$('.tab', root).forEach(function (x) { x.classList.toggle('active', x === t); });
        root.querySelector('#cats').style.display = (tab === 'expenses' || tab === 'incomes') ? '' : 'none';
        load();
      });

      async function load() {
        const head = root.querySelector('#tbl thead');
        const tb = root.querySelector('#tbl tbody');

        if (tab === 'expenses') {
          rows = await API.call('expenses.list', state);
          const total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
          const byCat = {};
          rows.forEach(function (r) { const k = r.category_name || 'بدون دسته'; byCat[k] = (byCat[k] || 0) + r.amount; });
          const top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0];
          root.querySelector('#sum').innerHTML =
            '<div class="stat accent"><div class="label">تعداد اسناد</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
            '<div class="stat accent-red"><div class="label">جمع هزینه‌های دوره</div><div class="value money">' + U.money(total) + '</div></div>' +
            '<div class="stat accent-orange"><div class="label">بیشترین دسته</div><div class="value" style="font-size:15px">' +
            U.esc(top || '—') + '</div>' + (top ? '<div class="sub money">' + U.money(byCat[top]) + '</div>' : '') + '</div>';
          head.innerHTML = '<tr><th>شماره سند</th><th>تاریخ</th><th>دسته</th><th class="name">شرح</th>' +
            '<th>روش پرداخت</th><th>حساب</th><th>مبلغ</th><th>عملیات</th></tr>';
          tb.innerHTML = rows.length ? rows.map(function (r) {
            return '<tr data-id="' + r.id + '"><td class="small">' + U.esc(r.doc_no) + '</td>' +
              '<td>' + U.esc(r.date_jalali) + '</td><td>' + U.esc(r.category_name || '—') + '</td>' +
              '<td class="name">' + U.esc(r.description || '—') + '</td>' +
              '<td class="small">' + U.esc(r.method_label) + '</td>' +
              '<td class="small">' + U.esc(r.bank_title || '—') + '</td>' +
              '<td class="money bold">' + U.money(r.amount) + '</td>' +
              '<td class="actions"><button class="btn ghost sm" data-del>حذف</button></td></tr>';
          }).join('') : U.emptyRow(8, 'هزینه‌ای در این بازه ثبت نشده است.', '📒');

        } else if (tab === 'incomes') {
          rows = await API.call('incomes.list', state);
          const total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
          root.querySelector('#sum').innerHTML =
            '<div class="stat accent"><div class="label">تعداد اسناد</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">جمع درآمدهای متفرقه</div><div class="value money">' + U.money(total) + '</div></div>' +
            '<div class="stat"><div class="label">میانگین هر سند</div><div class="value money">' +
            U.money(rows.length ? Math.round(total / rows.length) : 0) + '</div></div>';
          head.innerHTML = '<tr><th>شماره سند</th><th>تاریخ</th><th>دسته</th><th class="name">شرح</th>' +
            '<th>روش دریافت</th><th>حساب</th><th>مبلغ</th><th>عملیات</th></tr>';
          tb.innerHTML = rows.length ? rows.map(function (r) {
            return '<tr data-id="' + r.id + '"><td class="small">' + U.esc(r.doc_no) + '</td>' +
              '<td>' + U.esc(r.date_jalali) + '</td><td>' + U.esc(r.category_name || '—') + '</td>' +
              '<td class="name">' + U.esc(r.description || '—') + '</td>' +
              '<td class="small">' + U.esc(r.method_label) + '</td>' +
              '<td class="small">' + U.esc(r.bank_title || '—') + '</td>' +
              '<td class="money bold">' + U.money(r.amount) + '</td>' +
              '<td class="actions"><button class="btn ghost sm" data-del>حذف</button></td></tr>';
          }).join('') : U.emptyRow(8, 'درآمدی در این بازه ثبت نشده است.', '💰');

        } else if (tab === 'transfers') {
          rows = await API.call('transfers.list', state);
          const total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
          const fees = rows.reduce(function (a, r) { return a + r.fee; }, 0);
          root.querySelector('#sum').innerHTML =
            '<div class="stat accent"><div class="label">تعداد انتقال</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
            '<div class="stat accent"><div class="label">جمع مبالغ منتقل‌شده</div><div class="value money">' + U.money(total) + '</div></div>' +
            '<div class="stat accent-orange"><div class="label">جمع کارمزدها</div><div class="value money">' + U.money(fees) + '</div></div>';
          head.innerHTML = '<tr><th>شماره سند</th><th>تاریخ</th><th>از</th><th>به</th>' +
            '<th>مبلغ</th><th>کارمزد</th><th class="name">شرح</th><th>عملیات</th></tr>';
          const kindLabel = { cash: 'صندوق', pos: 'کارتخوان', bank: 'بانک' };
          tb.innerHTML = rows.length ? rows.map(function (r) {
            return '<tr data-id="' + r.id + '"><td class="small">' + U.esc(r.doc_no) + '</td>' +
              '<td>' + U.esc(r.date_jalali) + '</td>' +
              '<td>' + U.esc(r.from_title || kindLabel[r.from_kind] || r.from_kind) + '</td>' +
              '<td>' + U.esc(r.to_title || kindLabel[r.to_kind] || r.to_kind) + '</td>' +
              '<td class="money bold">' + U.money(r.amount) + '</td>' +
              '<td class="money">' + U.money(r.fee) + '</td>' +
              '<td class="name small">' + U.esc(r.description || '—') + '</td>' +
              '<td class="actions"><button class="btn ghost sm" data-del>حذف</button></td></tr>';
          }).join('') : U.emptyRow(8, 'انتقالی در این بازه ثبت نشده است.', '🔁');

        } else {
          rows = await API.call('capital.list', state);
          const inSum = rows.reduce(function (a, r) { return a + r.contribution; }, 0);
          const outSum = rows.reduce(function (a, r) { return a + r.draw; }, 0);
          root.querySelector('#sum').innerHTML =
            '<div class="stat accent-green"><div class="label">جمع آورده مالک</div><div class="value money">' + U.money(inSum) + '</div></div>' +
            '<div class="stat accent-red"><div class="label">جمع برداشت شخصی</div><div class="value money">' + U.money(outSum) + '</div></div>' +
            '<div class="stat accent"><div class="label">خالص سرمایه ثبت‌شده</div><div class="value money">' + U.money(inSum - outSum) + '</div></div>';
          head.innerHTML = '<tr><th>تاریخ</th><th class="name">شرح</th><th>آورده</th><th>برداشت</th><th>عملیات</th></tr>';
          tb.innerHTML = rows.length ? rows.map(function (r) {
            return '<tr data-id="' + r.id + '"><td>' + U.esc(r.date_jalali) + '</td>' +
              '<td class="name">' + U.esc(r.description || '—') + '</td>' +
              '<td class="money money-pos">' + (r.contribution ? U.money(r.contribution) : '') + '</td>' +
              '<td class="money money-neg">' + (r.draw ? U.money(r.draw) : '') + '</td>' +
              '<td class="actions"><button class="btn ghost sm" data-del>حذف</button></td></tr>';
          }).join('') : U.emptyRow(5, 'سندی ثبت نشده است.', '🏛');
        }
      }

      root.querySelector('#q').addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));

      root.querySelector('#add').addEventListener('click', async function () {
        let done = false;
        if (tab === 'expenses') done = await expenseForm(banks, await API.call('expenses.categories', {}));
        else if (tab === 'incomes') done = await incomeForm(banks, await API.call('incomes.categories', {}));
        else if (tab === 'transfers') done = await transferForm(banks);
        else done = await capitalForm(banks);
        if (done) load();
      });

      root.querySelector('#cats').addEventListener('click', async function () {
        const isExp = tab === 'expenses';
        async function body() {
          const list = isExp ? await API.call('expenses.categories', {}) : await API.call('incomes.categories', {});
          return '<div class="row tight mb"><input type="text" id="newCat" placeholder="نام دسته جدید">' +
            '<button class="btn sm" id="addCat" style="flex:0 0 auto">افزودن</button></div>' +
            '<table class="data"><thead><tr><th class="name">نام</th><th>تعداد سند</th>' + (isExp ? '<th>عملیات</th>' : '') + '</tr></thead><tbody>' +
            list.map(function (c) {
              return '<tr><td class="name">' + U.esc(c.name) + '</td><td>' + w.Fmt.toFaDigits(c.usage_count) + '</td>' +
                (isExp ? '<td class="actions"><button class="btn ghost sm" data-del="' + c.id + '">حذف</button></td>' : '') + '</tr>';
            }).join('') + '</tbody></table>';
        }
        await U.modal({
          title: isExp ? 'دسته‌های هزینه' : 'دسته‌های درآمد',
          body: await body(),
          buttons: [{ label: 'بستن', value: true, cls: 'secondary' }],
          onOpen: function (m) {
            const refresh = async function () { m.querySelector('.modal-body').innerHTML = await body(); };
            m.addEventListener('click', async function (e) {
              if (e.target.id === 'addCat') {
                const v = m.querySelector('#newCat').value.trim();
                if (!v) return;
                await API.safe(isExp ? 'expenses.createCategory' : 'incomes.createCategory', { name: v });
                await refresh();
              }
              const del = e.target.closest('[data-del]');
              if (del && isExp) {
                if (await U.confirm('این دسته حذف شود؟', { danger: true })) {
                  const r = await API.safe('expenses.removeCategory', { id: parseInt(del.dataset.del, 10) });
                  if (r) await refresh();
                }
              }
            });
          }
        });
        load();
      });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const del = e.target.closest('[data-del]');
        if (!del) return;
        const id = parseInt(del.closest('tr').dataset.id, 10);
        if (!await U.confirm('این سند حذف شود؟', { danger: true, detail: 'سند حسابداری مربوط نیز حذف می‌شود.' })) return;
        const channel = { expenses: 'expenses.remove', incomes: 'incomes.remove', transfers: 'transfers.remove', capital: 'capital.remove' }[tab];
        try { await API.call(channel, { id: id }); U.toast('حذف شد.', 'success'); load(); }
        catch (err) { U.toast(err.message, 'error'); }
      });

      w.Comp.bindExport(root, function () {
        const titles = { expenses: 'گزارش هزینه‌ها', incomes: 'گزارش درآمدها', transfers: 'گزارش انتقال وجه', capital: 'سرمایه و برداشت' };
        const colsMap = {
          expenses: [
            { header: 'شماره سند', key: 'doc_no' }, { header: 'تاریخ', key: 'date_jalali' },
            { header: 'دسته', key: 'category_name' }, { header: 'شرح', key: 'description', align: 'right' },
            { header: 'روش', key: 'method_label' }, { header: 'مبلغ', key: 'amount', money: true }
          ],
          incomes: [
            { header: 'شماره سند', key: 'doc_no' }, { header: 'تاریخ', key: 'date_jalali' },
            { header: 'دسته', key: 'category_name' }, { header: 'شرح', key: 'description', align: 'right' },
            { header: 'روش', key: 'method_label' }, { header: 'مبلغ', key: 'amount', money: true }
          ],
          transfers: [
            { header: 'شماره سند', key: 'doc_no' }, { header: 'تاریخ', key: 'date_jalali' },
            { header: 'مبلغ', key: 'amount', money: true }, { header: 'کارمزد', key: 'fee', money: true },
            { header: 'شرح', key: 'description', align: 'right' }
          ],
          capital: [
            { header: 'تاریخ', key: 'date_jalali' }, { header: 'شرح', key: 'description', align: 'right' },
            { header: 'آورده', key: 'contribution', money: true }, { header: 'برداشت', key: 'draw', money: true }
          ]
        };
        return {
          title: titles[tab], filename: tab,
          subtitle: 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to),
          columns: colsMap[tab], rows: rows,
          totals: tab === 'capital' ? null : { doc_no: 'جمع', amount: rows.reduce(function (a, r) { return a + (r.amount || 0); }, 0) }
        };
      });

      await load();
    }
  };
})(window);
