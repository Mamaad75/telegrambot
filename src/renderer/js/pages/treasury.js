/* صندوق، بانک، هزینه، درآمد و انتقال وجه */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  const METHODS = [
    { value: 'cash', label: 'صندوق (نقدی)' },
    { value: 'pos', label: 'کارتخوان' },
    { value: 'bank', label: 'بانک' },
  ];

  function docModal(kind, onSaved) {
    const isExpense = kind === 'expense';
    const title = isExpense ? 'ثبت هزینه' : 'ثبت درآمد متفرقه';
    const amount = global.UI.moneyInput({});
    const method = global.UI.select(METHODS, 'cash');
    const dateInput = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const desc = h('input', { type: 'text', placeholder: 'شرح' });
    const categorySelect = global.UI.select([], '');
    const newCatInput = h('input', { type: 'text', placeholder: 'نام دسته جدید' });

    const load = guard(async () => {
      const cats = await call('products.categories', { kind: isExpense ? 'expense' : 'income' });
      categorySelect.innerHTML = '';
      for (const c of cats) categorySelect.appendChild(h('option', { value: c.id, text: c.name }));
    });
    load();

    global.UI.modal({
      title,
      size: 'narrow',
      content: h('div', {}, [
        global.UI.field('مبلغ *', amount),
        h('div', { class: 'form-row c2', style: 'margin-top:10px' }, [
          global.UI.field(isExpense ? 'دسته هزینه' : 'دسته درآمد', categorySelect),
          global.UI.field(isExpense ? 'پرداخت از' : 'واریز به', method),
        ]),
        global.UI.field('تاریخ', dateInput),
        h('div', { style: 'height:10px' }),
        global.UI.field('شرح', desc),
        h('div', { class: 'divider' }),
        h('div', { class: 'inline' }, [
          h('div', { style: 'flex:1' }, [newCatInput]),
          h('button', {
            class: 'btn sm',
            text: '+ دسته جدید',
            onclick: guard(async () => {
              if (!newCatInput.value.trim()) return;
              await call('products.addCategory', { kind: isExpense ? 'expense' : 'income', name: newCatInput.value.trim() });
              newCatInput.value = '';
              await load();
              global.UI.toast('دسته جدید اضافه شد.', 'ok');
            }),
          }),
        ]),
      ]),
      buttons: [{
        label: 'ثبت',
        kind: 'primary',
        action: guard(async (api) => {
          if (amount.value <= 0) { global.UI.toast('مبلغ باید بزرگ‌تر از صفر باشد.', 'warn'); return; }
          await call(isExpense ? 'cashbook.expense' : 'cashbook.income', {
            amount: amount.value,
            category_id: categorySelect.value || null,
            method: method.value,
            date: dateInput.value,
            description: desc.value.trim(),
          });
          global.UI.toast('ثبت شد.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  function transferModal(onSaved) {
    const amount = global.UI.moneyInput({});
    const from = global.UI.select(METHODS, 'cash');
    const to = global.UI.select(METHODS, 'bank');
    const dateInput = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const desc = h('input', { type: 'text', placeholder: 'شرح (اختیاری)' });
    const codeOf = { cash: '101', pos: '102', bank: '103' };
    global.UI.modal({
      title: 'انتقال وجه بین حساب‌ها',
      size: 'narrow',
      content: h('div', {}, [
        global.UI.field('مبلغ *', amount),
        h('div', { class: 'form-row c2', style: 'margin-top:10px' }, [
          global.UI.field('از حساب', from),
          global.UI.field('به حساب', to),
        ]),
        global.UI.field('تاریخ', dateInput),
        h('div', { style: 'height:10px' }),
        global.UI.field('شرح', desc),
        h('div', { class: 'hint', style: 'margin-top:8px', text: 'انتقال وجه هیچ تأثیری بر سود و زیان ندارد.' }),
      ]),
      buttons: [{
        label: 'ثبت انتقال',
        kind: 'primary',
        action: guard(async (api) => {
          if (amount.value <= 0) { global.UI.toast('مبلغ نامعتبر است.', 'warn'); return; }
          if (from.value === to.value) { global.UI.toast('حساب مبدأ و مقصد یکسان است.', 'warn'); return; }
          await call('cashbook.transfer', {
            amount: amount.value, from_code: codeOf[from.value], to_code: codeOf[to.value],
            date: dateInput.value, description: desc.value.trim(),
          });
          global.UI.toast('انتقال ثبت شد.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  function equityModal(onSaved) {
    const amount = global.UI.moneyInput({});
    const kind = global.UI.select([
      { value: 'contribution', label: 'آورده مالک (افزایش سرمایه)' },
      { value: 'drawing', label: 'برداشت مالک' },
    ], 'contribution');
    const method = global.UI.select(METHODS, 'cash');
    const dateInput = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const desc = h('input', { type: 'text', placeholder: 'شرح' });
    global.UI.modal({
      title: 'آورده یا برداشت مالک',
      size: 'narrow',
      content: h('div', {}, [
        global.UI.field('نوع', kind),
        h('div', { style: 'height:10px' }),
        global.UI.field('مبلغ *', amount),
        h('div', { class: 'form-row c2', style: 'margin-top:10px' }, [
          global.UI.field('حساب', method),
          global.UI.field('تاریخ', dateInput),
        ]),
        global.UI.field('شرح', desc),
      ]),
      buttons: [{
        label: 'ثبت',
        kind: 'primary',
        action: guard(async (api) => {
          if (amount.value <= 0) { global.UI.toast('مبلغ نامعتبر است.', 'warn'); return; }
          await call('cashbook.equity', {
            kind: kind.value, amount: amount.value, method: method.value,
            date: dateInput.value, description: desc.value.trim(),
          });
          global.UI.toast('ثبت شد.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  async function render(view) {
    let tab = 'overview';
    let range = global.U.presetRange('month');
    const box = h('div');
    const tabs = global.UI.tabs([
      { key: 'overview', title: 'خلاصه و گردش' },
      { key: 'expenses', title: 'هزینه‌ها' },
      { key: 'incomes', title: 'درآمدها' },
      { key: 'transfers', title: 'انتقال‌ها' },
      { key: 'payments', title: 'دریافت و پرداخت' },
    ], (k) => { tab = k; load(); });

    const fromInput = global.UI.dateInput({ value: range.from, onChange: (v) => { range.from = v; load(); } });
    const toInput = global.UI.dateInput({ value: range.to, onChange: (v) => { range.to = v; load(); } });

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [
      h('header', {}, [
        h('h2', { text: 'صندوق و بانک' }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn danger sm', text: '− هزینه', onclick: () => docModal('expense', load) }),
        h('button', { class: 'btn success sm', text: '+ درآمد', onclick: () => docModal('income', load) }),
        h('button', { class: 'btn sm', text: '⇄ انتقال وجه', onclick: () => transferModal(load) }),
        h('button', { class: 'btn sm', text: 'آورده/برداشت', onclick: () => equityModal(load) }),
      ]),
      tabs.el,
      h('div', { class: 'body' }, [
        h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, [
          global.UI.field('از تاریخ', fromInput),
          global.UI.field('تا تاریخ', toInput),
          h('button', {
            class: 'btn sm',
            style: 'margin-bottom:4px',
            text: 'کل دوره‌ها',
            onclick: () => { range = { from: '', to: '' }; fromInput.value = ''; toInput.value = ''; load(); },
          }),
        ]),
        box,
      ]),
    ]));

    const load = guard(async () => {
      box.innerHTML = '';
      box.appendChild(global.UI.loading());
      if (tab === 'overview') await drawOverview();
      else if (tab === 'expenses') await drawSimple('cashbook.expenses', 'هزینه');
      else if (tab === 'incomes') await drawSimple('cashbook.incomes', 'درآمد');
      else if (tab === 'transfers') await drawTransfers();
      else await drawPayments();
    });

    async function drawOverview() {
      const [dash, cash, pos, bank] = await Promise.all([
        call('reports.dashboard', { range: 'month' }),
        call('reports.treasury', { code: '101', from: range.from, to: range.to }),
        call('reports.treasury', { code: '102', from: range.from, to: range.to }),
        call('reports.treasury', { code: '103', from: range.from, to: range.to }),
      ]);
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'مانده صندوق' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(dash.treasury.cash) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'مانده کارتخوان' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(dash.treasury.pos) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'مانده بانک' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(dash.treasury.bank) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'چک‌های نزد ما' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(dash.treasury.checksReceivable) })])]),
      ]));

      const sub = global.UI.tabs([
        { key: '101', title: 'گردش صندوق' },
        { key: '102', title: 'گردش کارتخوان' },
        { key: '103', title: 'گردش بانک' },
      ], (code) => drawLedger(code));
      const ledgerBox = h('div');
      box.appendChild(h('div', { class: 'panel', style: 'margin:0' }, [sub.el, h('div', { class: 'body tight' }, [ledgerBox])]));
      const data = { 101: cash, 102: pos, 103: bank };
      function drawLedger(code) {
        const led = data[code];
        ledgerBox.innerHTML = '';
        ledgerBox.appendChild(global.UI.table({
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'سند', key: 'entry_no', type: 'center' },
            { title: 'شرح', key: 'entry_desc' },
            { title: 'دریافت', key: 'debit', type: 'money' },
            { title: 'پرداخت', key: 'credit', type: 'money' },
            { title: 'مانده', key: 'balance', type: 'money' },
          ],
          rows: led.rows,
          empty: 'گردشی در این بازه ثبت نشده است.',
          emptyIcon: '💵',
          footer: { entry_desc: 'جمع', debit: led.inflow, credit: led.outflow, balance: led.closing },
        }));
      }
      drawLedger('101');
    }

    async function drawSimple(channel, label) {
      const data = await call(channel, { from: range.from, to: range.to, limit: 500 });
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c2', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat ' + (label === 'هزینه' ? 'bad' : 'ok') }, [
          h('div', { class: 'label', text: `جمع ${label} دوره` }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.summary.total) }), h('small', { text: global.U.state.currency })]),
        ]),
        h('div', { class: 'panel', style: 'margin:0' }, [
          h('div', { class: 'body' }, [global.Charts.bars({
            rows: data.byCategory.map((c) => ({ label: c.category_name, value: c.total })),
            limit: 6,
          })]),
        ]),
      ]));
      box.appendChild(global.UI.table({
        columns: [
          { title: 'تاریخ', key: 'date', type: 'date' },
          { title: 'دسته', key: 'category_name' },
          { title: 'مبلغ', key: 'amount', type: 'money' },
          { title: 'روش', type: 'center', render: (r) => global.U.label('method', r.method) },
          { title: 'شرح', key: 'description' },
          {
            title: 'وضعیت',
            type: 'center',
            render: (r) => (r.status === 'void'
              ? h('span', { class: 'tag bad', text: 'ابطال‌شده' })
              : h('button', {
                class: 'btn sm danger',
                text: 'ابطال',
                onclick: guard(async () => {
                  const okC = await global.UI.confirm('این سند ابطال شود؟', { danger: true, detail: 'سند حسابداری معکوس ثبت خواهد شد.' });
                  if (!okC) return;
                  await call('cashbook.void', { kind: label === 'هزینه' ? 'expense' : 'income', id: r.id });
                  global.UI.toast('سند ابطال شد.', 'ok');
                  load();
                }),
              })),
          },
        ],
        rows: data.rows,
        empty: `${label}ای در این بازه ثبت نشده است.`,
        emptyIcon: label === 'هزینه' ? '🧾' : '💰',
        footer: { category_name: 'جمع', amount: data.summary.total },
      }));
    }

    async function drawTransfers() {
      const data = await call('cashbook.transfers', { from: range.from, to: range.to });
      box.innerHTML = '';
      box.appendChild(global.UI.table({
        columns: [
          { title: 'تاریخ', key: 'date', type: 'date' },
          { title: 'از حساب', key: 'from_name' },
          { title: 'به حساب', key: 'to_name' },
          { title: 'مبلغ', key: 'amount', type: 'money' },
          { title: 'شرح', key: 'description' },
          {
            title: 'وضعیت',
            type: 'center',
            render: (r) => (r.status === 'void'
              ? h('span', { class: 'tag bad', text: 'ابطال‌شده' })
              : h('button', {
                class: 'btn sm danger',
                text: 'ابطال',
                onclick: guard(async () => {
                  const okC = await global.UI.confirm('این انتقال ابطال شود؟', { danger: true });
                  if (!okC) return;
                  await call('cashbook.void', { kind: 'transfer', id: r.id });
                  global.UI.toast('ابطال شد.', 'ok');
                  load();
                }),
              })),
          },
        ],
        rows: data.rows,
        empty: 'انتقالی ثبت نشده است.',
        emptyIcon: '⇄',
      }));
    }

    async function drawPayments() {
      const data = await call('payments.list', { from: range.from, to: range.to, limit: 500 });
      box.innerHTML = '';
      box.appendChild(global.UI.table({
        columns: [
          { title: 'تاریخ', key: 'date', type: 'date' },
          { title: 'نوع', type: 'center', render: (r) => h('span', { class: 'tag ' + (r.kind === 'receipt' ? 'ok' : 'warn'), text: r.kind === 'receipt' ? 'دریافت' : 'پرداخت' }) },
          { title: 'طرف حساب', key: 'party_name' },
          { title: 'مبلغ', key: 'amount', type: 'money' },
          { title: 'روش', type: 'center', render: (r) => (r.methods || '').split(',').map((m) => global.U.label('method', m)).join('، ') },
          { title: 'شرح', key: 'description' },
          {
            title: 'وضعیت',
            type: 'center',
            render: (r) => (r.status === 'void'
              ? h('span', { class: 'tag bad', text: 'ابطال‌شده' })
              : h('button', {
                class: 'btn sm danger',
                text: 'ابطال',
                onclick: guard(async () => {
                  const okC = await global.UI.confirm('این سند ابطال شود؟', { danger: true, detail: 'مانده حساب طرف حساب به حالت قبل بازمی‌گردد.' });
                  if (!okC) return;
                  await call('payments.void', { id: r.id });
                  global.UI.toast('سند ابطال شد.', 'ok');
                  load();
                }),
              })),
          },
        ],
        rows: data.rows,
        empty: 'سندی ثبت نشده است.',
        emptyIcon: '💳',
        footer: { party_name: 'جمع', amount: data.summary.total },
      }));
    }

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.treasury = { title: 'صندوق و بانک', render };
}(window));
