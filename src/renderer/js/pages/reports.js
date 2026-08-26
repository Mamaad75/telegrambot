/* مرکز گزارش‌ها و خروجی اکسل */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  const REPORTS = [
    { key: 'sales', title: 'گزارش فروش', icon: '🧾', group: 'فروش و خرید' },
    { key: 'purchases', title: 'گزارش خرید', icon: '📦', group: 'فروش و خرید' },
    { key: 'sale_returns', title: 'برگشت از فروش', icon: '↩️', group: 'فروش و خرید' },
    { key: 'purchase_returns', title: 'برگشت از خرید', icon: '↪️', group: 'فروش و خرید' },
    { key: 'byProduct', title: 'فروش به تفکیک کالا', icon: '🏷', group: 'فروش و خرید' },
    { key: 'byParty', title: 'فروش به تفکیک مشتری', icon: '👤', group: 'فروش و خرید' },
    { key: 'inventory', title: 'موجودی و ارزش انبار', icon: '🏬', group: 'انبار' },
    { key: 'movements', title: 'گردش انبار', icon: '🔄', group: 'انبار' },
    { key: 'lowStock', title: 'کالاهای کمبود موجودی', icon: '⚠️', group: 'انبار' },
    { key: 'customers', title: 'مانده مشتریان', icon: '🧑‍💼', group: 'طرف حساب' },
    { key: 'suppliers', title: 'مانده تأمین‌کنندگان', icon: '🚚', group: 'طرف حساب' },
    { key: 'overdue', title: 'مطالبات معوق', icon: '⏰', group: 'طرف حساب' },
    { key: 'cash', title: 'گردش صندوق', icon: '💵', group: 'مالی' },
    { key: 'pos', title: 'گردش کارتخوان', icon: '💳', group: 'مالی' },
    { key: 'bank', title: 'گردش بانک', icon: '🏦', group: 'مالی' },
    { key: 'checks', title: 'گزارش چک‌ها', icon: '📑', group: 'مالی' },
    { key: 'expenses', title: 'گزارش هزینه‌ها', icon: '📉', group: 'مالی' },
    { key: 'incomes', title: 'گزارش درآمدها', icon: '📈', group: 'مالی' },
    { key: 'daily', title: 'خلاصه مالی روزانه', icon: '📅', group: 'مالی' },
    { key: 'profitLoss', title: 'سود و زیان', icon: '💹', group: 'حسابداری' },
    { key: 'trial', title: 'تراز آزمایشی', icon: '⚖️', group: 'حسابداری' },
    { key: 'journal', title: 'دفتر روزنامه', icon: '📘', group: 'حسابداری' },
    { key: 'vat', title: 'گزارش ارزش افزوده', icon: '🧮', group: 'حسابداری' },
  ];

  async function render(view) {
    let current = 'sales';
    let range = global.U.presetRange('month');
    const resultBox = h('div');
    const titleEl = h('h2', { text: 'گزارش فروش' });

    const fromInput = global.UI.dateInput({ value: range.from, onChange: (v) => { range.from = v; run(); } });
    const toInput = global.UI.dateInput({ value: range.to, onChange: (v) => { range.to = v; run(); } });
    const presets = global.UI.chips([
      { key: 'today', title: 'امروز' },
      { key: 'week', title: 'این هفته' },
      { key: 'month', title: 'این ماه' },
      { key: 'lastMonth', title: 'ماه قبل' },
      { key: 'year', title: 'امسال' },
      { key: 'all', title: 'کل دوره‌ها' },
    ], 'month', (k) => {
      range = global.U.presetRange(k);
      fromInput.value = range.from;
      toInput.value = range.to;
      run();
    });

    const menu = h('div');
    const groups = {};
    for (const r of REPORTS) (groups[r.group] = groups[r.group] || []).push(r);
    for (const [group, items] of Object.entries(groups)) {
      menu.appendChild(h('div', { class: 'muted', style: 'font-size:11.5px;margin:12px 0 5px', text: group }));
      for (const r of items) {
        menu.appendChild(h('button', {
          class: 'nav-item',
          style: 'color:var(--ink);background:transparent',
          dataset: { key: r.key },
          onclick: () => { current = r.key; titleEl.textContent = r.title; markActive(); run(); },
        }, [h('span', { class: 'ic', text: r.icon }), h('span', { text: r.title })]));
      }
    }
    function markActive() {
      menu.querySelectorAll('.nav-item').forEach((b) => {
        const on = b.dataset.key === current;
        b.style.background = on ? 'var(--brand-soft)' : 'transparent';
        b.style.color = on ? 'var(--brand)' : 'var(--ink)';
        b.style.fontWeight = on ? '700' : '400';
      });
    }
    markActive();

    view.innerHTML = '';
    view.appendChild(h('div', { style: 'display:grid;grid-template-columns:250px minmax(0,1fr);gap:14px;align-items:start' }, [
      h('div', { class: 'panel', style: 'position:sticky;top:0' }, [
        h('header', {}, [h('h2', { text: 'گزارش‌ها' })]),
        h('div', { class: 'body', style: 'padding-top:0' }, [menu]),
      ]),
      h('div', {}, [
        h('div', { class: 'panel' }, [
          h('header', {}, [
            titleEl,
            h('div', { class: 'spacer' }),
            h('button', {
              class: 'btn success sm',
              text: '📊 خروجی اکسل کامل',
              onclick: guard(async () => {
                const res = await call('excel.export', { from: range.from, to: range.to });
                if (res.canceled) return;
                global.UI.toast('فایل اکسل ذخیره شد: ' + res.file, 'ok', 6000);
              }),
            }),
            h('button', { class: 'btn sm', text: '🖨 چاپ گزارش', onclick: () => printCurrent() }),
          ]),
          h('div', { class: 'body' }, [
            h('div', { class: 'toolbar' }, [
              presets.el,
              global.UI.field('از تاریخ', fromInput),
              global.UI.field('تا تاریخ', toInput),
            ]),
          ]),
        ]),
        resultBox,
      ]),
    ]));

    let printSpec = null;

    const printCurrent = guard(async () => {
      if (!printSpec) { global.UI.toast('این گزارش قابلیت چاپ ندارد.', 'warn'); return; }
      const html = global.Documents.report(printSpec, global.U.state.settings);
      await global.Documents.print(html, printSpec.title, 'a4');
    });

    function periodText() {
      return range.from ? `از ${fmt.date(range.from)} تا ${fmt.date(range.to)}` : 'کل دوره‌ها';
    }

    function show(spec, extra) {
      printSpec = spec;
      resultBox.innerHTML = '';
      if (extra) resultBox.appendChild(extra);
      resultBox.appendChild(h('div', { class: 'panel' }, [
        h('div', { class: 'body tight' }, [
          global.UI.table({
            columns: spec.columns.map((c) => ({ title: c.title, key: c.key, type: c.type, render: c.render })),
            rows: spec.rows,
            empty: 'داده‌ای برای این گزارش وجود ندارد.',
            footer: spec.totals,
          }),
        ]),
      ]));
    }

    function statRow(items) {
      return h('div', { class: 'grid c4', style: 'margin-bottom:14px' }, items.map((s) => h('div', { class: 'stat ' + (s.tone || '') }, [
        h('div', { class: 'label', text: s.label }),
        h('div', { class: 'value num' }, [h('span', { text: typeof s.value === 'number' ? fmt.plain(s.value) : s.value })]),
        s.sub ? h('div', { class: 'sub', text: s.sub }) : null,
      ])));
    }

    const run = guard(async () => {
      resultBox.innerHTML = '';
      resultBox.appendChild(global.UI.loading());
      const opts = { from: range.from, to: range.to };

      if (current === 'sales' || current === 'purchases' || current === 'sale_returns' || current === 'purchase_returns') {
        const type = { sales: 'sale', purchases: 'purchase', sale_returns: 'sale_return', purchase_returns: 'purchase_return' }[current];
        const data = await call('reports.sales', { ...opts, type });
        show({
          title: REPORTS.find((r) => r.key === current).title,
          subtitle: periodText(),
          columns: [
            { title: 'شماره', key: 'invoice_no', type: 'center' },
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'طرف حساب', key: 'party_name' },
            { title: 'جمع کالاها', key: 'subtotal', type: 'money' },
            { title: 'تخفیف', key: 'discount_total', type: 'money' },
            { title: 'ارزش افزوده', key: 'vat', type: 'money' },
            { title: 'مبلغ کل', key: 'total', type: 'money' },
            { title: 'مانده', key: 'due', type: 'money' },
          ],
          rows: data.rows,
          totals: {
            invoice_no: 'جمع',
            subtotal: data.summary.subtotal,
            discount_total: data.summary.discount,
            vat: data.summary.vat,
            total: data.summary.total,
            due: data.summary.due,
          },
        }, statRow([
          { label: 'تعداد فاکتور', value: data.summary.count },
          { label: 'مبلغ کل', value: data.summary.total, tone: 'brand' },
          { label: 'بهای تمام‌شده', value: data.summary.cogs },
          { label: 'سود ناخالص', value: data.summary.profit, tone: data.summary.profit >= 0 ? 'ok' : 'bad' },
        ]));
      } else if (current === 'byProduct' || current === 'byParty') {
        const data = await call('reports.sales', { ...opts, type: 'sale' });
        const rows = current === 'byProduct' ? data.byProduct : data.byParty;
        show({
          title: REPORTS.find((r) => r.key === current).title,
          subtitle: periodText(),
          columns: current === 'byProduct' ? [
            { title: 'کالا', key: 'product_name' },
            { title: 'تعداد فروش', key: 'qty', type: 'qty' },
            { title: 'مبلغ فروش', key: 'amount', type: 'money' },
            { title: 'بهای تمام‌شده', key: 'cost', type: 'money' },
            { title: 'سود ناخالص', type: 'money', key: 'profit', render: (r) => fmt.plain(r.amount - r.cost) },
          ] : [
            { title: 'مشتری', key: 'party_name' },
            { title: 'تعداد فاکتور', key: 'count', type: 'center' },
            { title: 'مبلغ کل', key: 'total', type: 'money' },
            { title: 'مانده', key: 'due', type: 'money' },
          ],
          rows: rows.map((r) => ({ ...r, profit: (r.amount || 0) - (r.cost || 0) })),
          totals: current === 'byProduct'
            ? {
              product_name: 'جمع',
              amount: rows.reduce((a, x) => a + x.amount, 0),
              cost: rows.reduce((a, x) => a + x.cost, 0),
              profit: rows.reduce((a, x) => a + (x.amount - x.cost), 0),
            }
            : { party_name: 'جمع', total: rows.reduce((a, x) => a + x.total, 0), due: rows.reduce((a, x) => a + x.due, 0) },
        });
      } else if (current === 'inventory') {
        const data = await call('inventory.valuation');
        show({
          title: 'موجودی و ارزش انبار',
          subtitle: `ارزش کل: ${fmt.plain(data.totals.value)} ${global.U.state.currency}`,
          columns: [
            { title: 'کالا', key: 'name' },
            { title: 'کد', key: 'code', type: 'center' },
            { title: 'موجودی', key: 'stock', type: 'qty' },
            { title: 'بهای میانگین', key: 'avg_cost', type: 'money', render: (r) => Math.round(r.avg_cost) },
            { title: 'ارزش', key: 'stock_value', type: 'money' },
          ],
          rows: data.rows,
          totals: { name: 'جمع', stock_value: data.totals.value },
        }, statRow([
          { label: 'ارزش کل موجودی', value: data.totals.value, tone: 'brand' },
          { label: 'تعداد اقلام', value: data.totals.count },
          { label: 'مجموع تعداد', value: fmt.qty(data.totals.qty) },
        ]));
      } else if (current === 'movements') {
        const data = await call('inventory.movements', { ...opts, limit: 1000 });
        show({
          title: 'گردش انبار',
          subtitle: periodText(),
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'کالا', key: 'product_name' },
            { title: 'نوع', key: 'type', render: (r) => global.U.label('movement', r.type) },
            { title: 'تعداد', key: 'qty', type: 'qty' },
            { title: 'ارزش', key: 'value', type: 'money' },
            { title: 'موجودی پس از گردش', key: 'balance_qty', type: 'qty' },
            { title: 'شرح', key: 'description' },
          ],
          rows: data.rows,
        });
      } else if (current === 'lowStock') {
        const rows = await call('inventory.lowStock');
        show({
          title: 'کالاهای کمبود موجودی',
          columns: [
            { title: 'کالا', key: 'name' },
            { title: 'موجودی', key: 'stock', type: 'qty' },
            { title: 'حداقل موجودی', key: 'min_stock', type: 'qty' },
            { title: 'کسری', key: 'gap', type: 'qty', render: (r) => Math.max(0, r.min_stock - r.stock) },
          ],
          rows: rows.map((r) => ({ ...r, gap: Math.max(0, r.min_stock - r.stock) })),
        });
      } else if (current === 'customers' || current === 'suppliers') {
        const type = current === 'customers' ? 'customer' : 'supplier';
        const data = await call('reports.partyBalances', { type });
        show({
          title: current === 'customers' ? 'مانده حساب مشتریان' : 'مانده حساب تأمین‌کنندگان',
          columns: [
            { title: 'نام', key: 'name' },
            { title: 'تلفن', key: 'phone', type: 'center' },
            { title: 'مانده', key: 'balance', type: 'money' },
          ],
          rows: data.withBalance,
          totals: { name: 'جمع', balance: data.total },
        }, statRow([
          { label: 'جمع مانده', value: data.total, tone: 'brand' },
          { label: 'تعداد دارای مانده', value: data.withBalance.length },
        ]));
      } else if (current === 'overdue') {
        const data = await call('reports.overdue', { days: 30 });
        show({
          title: 'مطالبات معوق (بیش از ۳۰ روز)',
          columns: [
            { title: 'شماره فاکتور', key: 'invoice_no', type: 'center' },
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'مشتری', key: 'party_name' },
            { title: 'مبلغ فاکتور', key: 'total', type: 'money' },
            { title: 'مانده', key: 'due', type: 'money' },
          ],
          rows: data.rows,
          totals: { invoice_no: 'جمع', due: data.total },
        });
      } else if (current === 'cash' || current === 'pos' || current === 'bank') {
        const code = { cash: '101', pos: '102', bank: '103' }[current];
        const led = await call('reports.treasury', { code, ...opts });
        show({
          title: `گردش ${led.account.name}`,
          subtitle: periodText(),
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'سند', key: 'entry_no', type: 'center' },
            { title: 'شرح', key: 'entry_desc' },
            { title: 'دریافت', key: 'debit', type: 'money' },
            { title: 'پرداخت', key: 'credit', type: 'money' },
            { title: 'مانده', key: 'balance', type: 'money' },
          ],
          rows: led.rows,
          totals: { entry_desc: 'جمع', debit: led.inflow, credit: led.outflow, balance: led.closing },
        }, statRow([
          { label: 'مانده اول دوره', value: led.opening },
          { label: 'جمع دریافت', value: led.inflow, tone: 'ok' },
          { label: 'جمع پرداخت', value: led.outflow, tone: 'bad' },
          { label: 'مانده پایان دوره', value: led.closing, tone: 'brand' },
        ]));
      } else if (current === 'checks') {
        const data = await call('checks.list', { limit: 1000 });
        show({
          title: 'گزارش چک‌ها',
          columns: [
            { title: 'نوع', key: 'kind', type: 'center', render: (r) => global.U.label('checkKind', r.kind) },
            { title: 'شماره', key: 'number', type: 'center' },
            { title: 'بانک', key: 'bank' },
            { title: 'طرف حساب', key: 'party_name' },
            { title: 'مبلغ', key: 'amount', type: 'money' },
            { title: 'سررسید', key: 'due_date', type: 'date' },
            { title: 'وضعیت', key: 'status', type: 'center', render: (r) => global.U.label('checkStatus', r.status) },
          ],
          rows: data.rows,
          totals: { party_name: 'جمع', amount: data.summary.total },
        });
      } else if (current === 'expenses' || current === 'incomes') {
        const data = await call(current === 'expenses' ? 'cashbook.expenses' : 'cashbook.incomes', { ...opts, limit: 1000 });
        show({
          title: current === 'expenses' ? 'گزارش هزینه‌ها' : 'گزارش درآمدها',
          subtitle: periodText(),
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'دسته', key: 'category_name' },
            { title: 'مبلغ', key: 'amount', type: 'money' },
            { title: 'روش', key: 'method', type: 'center', render: (r) => global.U.label('method', r.method) },
            { title: 'شرح', key: 'description' },
          ],
          rows: data.rows,
          totals: { category_name: 'جمع', amount: data.summary.total },
        }, statRow([
          { label: 'جمع مبلغ', value: data.summary.total, tone: current === 'expenses' ? 'bad' : 'ok' },
          { label: 'تعداد سند', value: data.summary.c },
        ]));
      } else if (current === 'daily') {
        const d = await call('reports.daily', { date: range.to || global.U.todayIso() });
        const rows = [
          { item: 'فروش', amount: d.sales.total },
          { item: 'برگشت از فروش', amount: -d.salesReturns.total },
          { item: 'خرید', amount: d.purchases.total },
          { item: 'برگشت از خرید', amount: -d.purchaseReturns.total },
          { item: 'هزینه‌ها', amount: d.expenses },
          { item: 'درآمد متفرقه', amount: d.incomes },
          { item: 'سود ناخالص روز', amount: d.profitLoss.grossProfit },
          { item: 'سود خالص روز', amount: d.profitLoss.netProfit },
        ];
        show({
          title: `خلاصه مالی روز ${fmt.date(d.date)}`,
          columns: [{ title: 'شرح', key: 'item' }, { title: 'مبلغ', key: 'amount', type: 'money' }],
          rows,
        }, statRow([
          { label: 'مانده صندوق', value: d.treasury.cash },
          { label: 'مانده کارتخوان', value: d.treasury.pos },
          { label: 'مانده بانک', value: d.treasury.bank },
          { label: 'سود خالص روز', value: d.profitLoss.netProfit, tone: d.profitLoss.netProfit >= 0 ? 'ok' : 'bad' },
        ]));
      } else if (current === 'profitLoss') {
        const pl = await call('reports.profitLoss', opts);
        const rows = [
          { item: 'فروش ناخالص', amount: pl.revenue },
          { item: 'کسر: تخفیفات فروش', amount: -pl.discounts },
          { item: 'کسر: برگشت از فروش', amount: -pl.returns },
          { item: 'فروش خالص', amount: pl.netSales },
          { item: 'کسر: بهای تمام‌شده', amount: -pl.cogs },
          { item: 'سود ناخالص', amount: pl.grossProfit },
        ].concat(pl.expenseRows.map((x) => ({ item: 'هزینه: ' + x.name, amount: -x.amount })))
          .concat([{ item: 'جمع هزینه‌های عملیاتی', amount: -pl.operatingExpenses }])
          .concat(pl.otherIncomeRows.map((x) => ({ item: 'درآمد: ' + x.name, amount: x.amount })))
          .concat([{ item: 'سود (زیان) خالص', amount: pl.netProfit }]);
        show({
          title: 'صورت سود و زیان',
          subtitle: periodText(),
          columns: [{ title: 'شرح', key: 'item' }, { title: 'مبلغ', key: 'amount', type: 'money' }],
          rows,
        }, statRow([
          { label: 'فروش خالص', value: pl.netSales, tone: 'brand' },
          { label: 'سود ناخالص', value: pl.grossProfit, tone: pl.grossProfit >= 0 ? 'ok' : 'bad' },
          { label: 'هزینه‌ها', value: pl.operatingExpenses },
          { label: 'سود خالص', value: pl.netProfit, tone: pl.netProfit >= 0 ? 'ok' : 'bad' },
        ]));
      } else if (current === 'trial') {
        const tb = await call('reports.trialBalance', opts);
        show({
          title: 'تراز آزمایشی',
          subtitle: periodText(),
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
            code: 'جمع',
            debit: tb.totals.debit,
            credit: tb.totals.credit,
            debitBalance: tb.totals.debitBalance,
            creditBalance: tb.totals.creditBalance,
          },
        });
      } else if (current === 'journal') {
        const data = await call('reports.journal', { ...opts, limit: 500 });
        const rows = [];
        for (const e of data.rows) {
          for (const l of e.lines) {
            rows.push({
              entry_no: e.entry_no, date: e.date, description: e.description,
              account: `${l.account_code} — ${l.account_name}`, debit: l.debit, credit: l.credit,
            });
          }
        }
        show({
          title: 'دفتر روزنامه',
          subtitle: periodText(),
          columns: [
            { title: 'سند', key: 'entry_no', type: 'center' },
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'شرح', key: 'description' },
            { title: 'حساب', key: 'account' },
            { title: 'بدهکار', key: 'debit', type: 'money' },
            { title: 'بستانکار', key: 'credit', type: 'money' },
          ],
          rows,
          totals: { description: 'جمع', debit: data.sums.debit, credit: data.sums.credit },
        });
      } else if (current === 'vat') {
        const v = await call('reports.vat', opts);
        show({
          title: 'گزارش مالیات بر ارزش افزوده',
          subtitle: periodText(),
          columns: [
            { title: 'شماره فاکتور', key: 'invoice_no', type: 'center' },
            { title: 'نوع', key: 'type', type: 'center', render: (r) => global.U.label('invoiceTypeShort', r.type) },
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'طرف حساب', key: 'party_name' },
            { title: 'مبلغ مشمول', key: 'taxable', type: 'money' },
            { title: 'ارزش افزوده', key: 'vat', type: 'money' },
          ],
          rows: v.details,
          totals: {
            party_name: 'جمع',
            taxable: v.details.reduce((a, x) => a + x.taxable, 0),
            vat: v.details.reduce((a, x) => a + x.vat, 0),
          },
        }, statRow([
          { label: 'ارزش افزوده فروش', value: v.outputVat },
          { label: 'ارزش افزوده خرید', value: v.inputVat },
          { label: 'قابل پرداخت', value: v.payable, tone: v.payable > 0 ? 'bad' : 'ok' },
        ]));
      }
    });

    await run();
  }

  global.Pages = global.Pages || {};
  global.Pages.reports = { title: 'گزارش‌ها', render };
}(window));
