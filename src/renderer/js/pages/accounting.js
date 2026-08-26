/* حسابداری: دفتر روزنامه، دفتر کل، تراز آزمایشی، سود و زیان، ارزش افزوده */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  async function render(view) {
    let tab = 'journal';
    let range = global.U.presetRange('month');
    const box = h('div');

    const tabs = global.UI.tabs([
      { key: 'journal', title: 'دفتر روزنامه' },
      { key: 'ledger', title: 'دفتر کل / معین' },
      { key: 'trial', title: 'تراز آزمایشی' },
      { key: 'pl', title: 'سود و زیان' },
      { key: 'vat', title: 'ارزش افزوده' },
      { key: 'accounts', title: 'کدینگ حساب‌ها' },
    ], (k) => { tab = k; load(); });

    const fromInput = global.UI.dateInput({ value: range.from, onChange: (v) => { range.from = v; load(); } });
    const toInput = global.UI.dateInput({ value: range.to, onChange: (v) => { range.to = v; load(); } });
    const presets = global.UI.chips([
      { key: 'month', title: 'این ماه' },
      { key: 'lastMonth', title: 'ماه قبل' },
      { key: 'year', title: 'امسال' },
      { key: 'all', title: 'کل دوره‌ها' },
    ], 'month', (k) => {
      range = global.U.presetRange(k);
      fromInput.value = range.from;
      toInput.value = range.to;
      load();
    });

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [
      tabs.el,
      h('div', { class: 'body' }, [
        h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, [
          presets.el,
          global.UI.field('از تاریخ', fromInput),
          global.UI.field('تا تاریخ', toInput),
        ]),
        box,
      ]),
    ]));

    const load = guard(async () => {
      box.innerHTML = '';
      box.appendChild(global.UI.loading());
      if (tab === 'journal') await drawJournal();
      else if (tab === 'ledger') await drawLedger();
      else if (tab === 'trial') await drawTrial();
      else if (tab === 'pl') await drawPL();
      else if (tab === 'vat') await drawVat();
      else await drawAccounts();
    });

    async function drawJournal() {
      const data = await call('reports.journal', { from: range.from, to: range.to, limit: 200 });
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c3', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد اسناد' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.total) }), h('small', { text: 'سند' })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'جمع بدهکار' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.sums.debit) })])]),
        h('div', { class: 'stat ' + (data.sums.debit === data.sums.credit ? 'ok' : 'bad') }, [
          h('div', { class: 'label', text: 'جمع بستانکار' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.sums.credit) })]),
          h('div', { class: 'sub', text: data.sums.debit === data.sums.credit ? '✔ دفاتر متوازن است' : '✖ عدم توازن!' }),
        ]),
      ]));
      const wrap = h('div');
      for (const e of data.rows) {
        wrap.appendChild(h('div', { class: 'panel', style: 'margin-bottom:10px' }, [
          h('header', {}, [
            h('h2', { style: 'font-size:13px', text: `${e.entry_no} — ${fmt.date(e.date)}` }),
            h('span', { class: 'tag mute', text: global.U.label('refType', e.ref_type) }),
            h('div', { class: 'spacer' }),
            h('span', { class: 'muted', style: 'font-size:12.5px', text: e.description }),
          ]),
          h('div', { class: 'body tight' }, [
            global.UI.table({
              columns: [
                { title: 'کد حساب', key: 'account_code', type: 'center', width: '90px' },
                { title: 'نام حساب', key: 'account_name' },
                { title: 'طرف حساب', render: (r) => r.party_name || '—' },
                { title: 'شرح', key: 'description' },
                { title: 'بدهکار', key: 'debit', type: 'money' },
                { title: 'بستانکار', key: 'credit', type: 'money' },
              ],
              rows: e.lines,
              footer: {
                description: 'جمع سند',
                debit: e.lines.reduce((a, x) => a + x.debit, 0),
                credit: e.lines.reduce((a, x) => a + x.credit, 0),
              },
            }),
          ]),
        ]));
      }
      if (!data.rows.length) wrap.appendChild(h('div', { class: 'empty', text: 'سندی در این بازه ثبت نشده است.' }));
      box.appendChild(wrap);
    }

    async function drawLedger() {
      const accounts = await call('reports.accounts');
      const select = global.UI.select(
        accounts.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })), '101', () => refresh(),
      );
      const tableBox = h('div');
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, [
        h('div', { class: 'field', style: 'min-width:320px' }, [h('label', { text: 'انتخاب حساب' }), select]),
        h('button', {
          class: 'btn sm',
          style: 'margin-bottom:4px',
          text: '🖨 چاپ دفتر معین',
          onclick: guard(async () => {
            const led = await call('reports.ledger', { code: select.value, from: range.from, to: range.to });
            const html = global.Documents.report({
              title: `دفتر معین حساب ${led.account.code} — ${led.account.name}`,
              subtitle: range.from ? `از ${fmt.date(range.from)} تا ${fmt.date(range.to)}` : 'کل دوره‌ها',
              columns: [
                { title: 'تاریخ', key: 'date', type: 'date' },
                { title: 'سند', key: 'entry_no', type: 'center' },
                { title: 'شرح', key: 'entry_desc' },
                { title: 'بدهکار', key: 'debit', type: 'money' },
                { title: 'بستانکار', key: 'credit', type: 'money' },
                { title: 'مانده', key: 'balance', type: 'money' },
              ],
              rows: led.rows,
              totals: { entry_desc: 'مانده پایان دوره', balance: led.closing },
            }, global.U.state.settings);
            await global.Documents.print(html, 'دفتر معین', 'a4');
          }),
        }),
      ]));
      box.appendChild(tableBox);

      const refresh = guard(async () => {
        tableBox.innerHTML = '';
        tableBox.appendChild(global.UI.loading());
        const led = await call('reports.ledger', { code: select.value, from: range.from, to: range.to });
        tableBox.innerHTML = '';
        tableBox.appendChild(h('div', { class: 'grid c3', style: 'margin-bottom:12px' }, [
          h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'مانده اول دوره' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(led.opening) })])]),
          h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد گردش' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(led.rows.length) }), h('small', { text: 'ردیف' })])]),
          h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'مانده پایان دوره' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(led.closing) })])]),
        ]));
        tableBox.appendChild(global.UI.table({
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'سند', key: 'entry_no', type: 'center' },
            { title: 'شرح', key: 'entry_desc' },
            { title: 'طرف حساب', render: (r) => r.party_name || '—' },
            { title: 'بدهکار', key: 'debit', type: 'money' },
            { title: 'بستانکار', key: 'credit', type: 'money' },
            { title: 'مانده', key: 'balance', type: 'money' },
          ],
          rows: led.rows,
          empty: 'گردشی برای این حساب ثبت نشده است.',
          footer: {
            entry_desc: 'جمع',
            debit: led.rows.reduce((a, x) => a + x.debit, 0),
            credit: led.rows.reduce((a, x) => a + x.credit, 0),
            balance: led.closing,
          },
        }));
      });
      await refresh();
    }

    async function drawTrial() {
      const tb = await call('reports.trialBalance', { from: range.from, to: range.to });
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c3', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'جمع گردش بدهکار' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(tb.totals.debit) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'جمع گردش بستانکار' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(tb.totals.credit) })])]),
        h('div', { class: 'stat ' + (tb.balanced ? 'ok' : 'bad') }, [
          h('div', { class: 'label', text: 'وضعیت توازن' }),
          h('div', { class: 'value', style: 'font-size:17px' }, [h('span', { text: tb.balanced ? '✔ متوازن' : '✖ نامتوازن' })]),
        ]),
      ]));
      box.appendChild(h('div', { class: 'inline', style: 'margin-bottom:10px' }, [
        h('button', {
          class: 'btn sm',
          text: '🖨 چاپ تراز آزمایشی',
          onclick: guard(async () => {
            const html = global.Documents.report({
              title: 'تراز آزمایشی',
              subtitle: range.from ? `از ${fmt.date(range.from)} تا ${fmt.date(range.to)}` : 'کل دوره‌ها',
              columns: [
                { title: 'کد', key: 'code', type: 'center' },
                { title: 'نام حساب', key: 'name' },
                { title: 'گردش بدهکار', key: 'debit', type: 'money' },
                { title: 'گردش بستانکار', key: 'credit', type: 'money' },
                { title: 'مانده بدهکار', key: 'debitBalance', type: 'money' },
                { title: 'مانده بستانکار', key: 'creditBalance', type: 'money' },
              ],
              rows: tb.rows,
              totals: {
                debit: tb.totals.debit, credit: tb.totals.credit,
                debitBalance: tb.totals.debitBalance, creditBalance: tb.totals.creditBalance,
              },
            }, global.U.state.settings);
            await global.Documents.print(html, 'تراز آزمایشی', 'a4');
          }),
        }),
      ]));
      box.appendChild(global.UI.table({
        columns: [
          { title: 'کد', key: 'code', type: 'center', width: '80px' },
          { title: 'نام حساب', key: 'name' },
          { title: 'نوع', type: 'center', render: (r) => global.U.label('accountType', r.type) },
          { title: 'گردش بدهکار', key: 'debit', type: 'money' },
          { title: 'گردش بستانکار', key: 'credit', type: 'money' },
          { title: 'مانده بدهکار', key: 'debitBalance', type: 'money' },
          { title: 'مانده بستانکار', key: 'creditBalance', type: 'money' },
        ],
        rows: tb.rows,
        empty: 'گردشی ثبت نشده است.',
        footer: {
          name: 'جمع کل',
          debit: tb.totals.debit,
          credit: tb.totals.credit,
          debitBalance: tb.totals.debitBalance,
          creditBalance: tb.totals.creditBalance,
        },
      }));
    }

    async function drawPL() {
      const pl = await call('reports.profitLoss', { from: range.from, to: range.to });
      const rows = [
        { item: 'فروش ناخالص', amount: pl.revenue, bold: true },
        { item: 'کسر: تخفیفات فروش', amount: -pl.discounts },
        { item: 'کسر: برگشت از فروش', amount: -pl.returns },
        { item: 'فروش خالص', amount: pl.netSales, bold: true },
        { item: 'کسر: بهای تمام‌شده کالای فروش‌رفته', amount: -pl.cogs },
        { item: 'سود ناخالص', amount: pl.grossProfit, bold: true },
      ]
        .concat(pl.expenseRows.map((x) => ({ item: `هزینه: ${x.name}`, amount: -x.amount })))
        .concat([{ item: 'جمع هزینه‌های عملیاتی', amount: -pl.operatingExpenses, bold: true }])
        .concat(pl.otherIncomeRows.map((x) => ({ item: `درآمد: ${x.name}`, amount: x.amount })))
        .concat([
          { item: 'جمع درآمدهای متفرقه', amount: pl.otherIncome, bold: true },
          { item: 'سود (زیان) خالص', amount: pl.netProfit, bold: true, final: true },
        ]);

      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'فروش خالص' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(pl.netSales) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'بهای تمام‌شده' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(pl.cogs) })])]),
        h('div', { class: 'stat ' + (pl.grossProfit >= 0 ? 'ok' : 'bad') }, [h('div', { class: 'label', text: 'سود ناخالص' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(pl.grossProfit) })])]),
        h('div', { class: 'stat ' + (pl.netProfit >= 0 ? 'ok' : 'bad') }, [h('div', { class: 'label', text: 'سود خالص' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(pl.netProfit) })])]),
      ]));
      box.appendChild(h('div', { class: 'inline', style: 'margin-bottom:10px' }, [
        h('button', {
          class: 'btn sm',
          text: '🖨 چاپ صورت سود و زیان',
          onclick: guard(async () => {
            const html = global.Documents.report({
              title: 'صورت سود و زیان',
              subtitle: range.from ? `از ${fmt.date(range.from)} تا ${fmt.date(range.to)}` : 'کل دوره‌ها',
              columns: [{ title: 'شرح', key: 'item' }, { title: 'مبلغ', key: 'amount', type: 'money' }],
              rows,
            }, global.U.state.settings);
            await global.Documents.print(html, 'صورت سود و زیان', 'a4');
          }),
        }),
      ]));
      box.appendChild(global.UI.table({
        columns: [
          { title: 'شرح', render: (r) => (r.bold ? h('b', { text: r.item }) : r.item) },
          {
            title: 'مبلغ',
            type: 'money',
            render: (r) => h('span', {
              class: (r.final ? (r.amount >= 0 ? 'pos' : 'neg') : ''),
              style: r.bold ? 'font-weight:700' : '',
              text: fmt.plain(r.amount),
            }),
          },
        ],
        rows,
      }));
    }

    async function drawVat() {
      const v = await call('reports.vat', { from: range.from, to: range.to });
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'ارزش افزوده فروش' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(v.outputVat) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'ارزش افزوده خرید' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(v.inputVat) })])]),
        h('div', { class: 'stat ' + (v.payable > 0 ? 'bad' : 'ok') }, [
          h('div', { class: 'label', text: 'مالیات قابل پرداخت' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(v.payable) })]),
        ]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'مبلغ مشمول فروش' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(v.sale.taxable - v.saleRet.taxable) })])]),
      ]));
      box.appendChild(global.UI.table({
        columns: [
          { title: 'شماره فاکتور', key: 'invoice_no', type: 'center' },
          { title: 'نوع', type: 'center', render: (r) => global.U.label('invoiceTypeShort', r.type) },
          { title: 'تاریخ', key: 'date', type: 'date' },
          { title: 'طرف حساب', key: 'party_name' },
          { title: 'مبلغ مشمول', key: 'taxable', type: 'money' },
          { title: 'نرخ', type: 'center', render: (r) => fmt.percent(r.vat_rate) },
          { title: 'ارزش افزوده', key: 'vat', type: 'money' },
          { title: 'مبلغ کل', key: 'total', type: 'money' },
        ],
        rows: v.details,
        empty: 'فاکتور مشمول ارزش افزوده‌ای در این بازه ثبت نشده است.',
        footer: {
          party_name: 'جمع',
          taxable: v.details.reduce((a, x) => a + x.taxable, 0),
          vat: v.details.reduce((a, x) => a + x.vat, 0),
          total: v.details.reduce((a, x) => a + x.total, 0),
        },
      }));
    }

    async function drawAccounts() {
      const accounts = await call('reports.accounts');
      const tb = await call('reports.trialBalance', {});
      const balances = {};
      for (const r of tb.rows) balances[r.code] = r.balance;
      box.innerHTML = '';
      box.appendChild(global.UI.table({
        columns: [
          { title: 'کد', key: 'code', type: 'center', width: '90px' },
          { title: 'نام حساب', render: (r) => (r.parent_code ? h('span', { style: 'padding-inline-start:18px', text: r.name }) : h('b', { text: r.name })) },
          { title: 'نوع', type: 'center', render: (r) => global.U.label('accountType', r.type) },
          { title: 'ماهیت', type: 'center', render: (r) => (r.normal_side === 'debit' ? 'بدهکار' : 'بستانکار') },
          { title: 'مانده', type: 'money', render: (r) => fmt.plain(balances[r.code] || 0) },
        ],
        rows: accounts,
      }));
    }

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.accounting = { title: 'حسابداری', render };
}(window));
