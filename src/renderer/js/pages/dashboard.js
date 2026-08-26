/* صفحه داشبورد */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  const RANGES = [
    { key: 'today', title: 'امروز' },
    { key: 'yesterday', title: 'دیروز' },
    { key: 'week', title: 'این هفته' },
    { key: 'month', title: 'این ماه' },
    { key: 'year', title: 'امسال' },
    { key: 'custom', title: 'بازه دلخواه' },
  ];

  function stat(label, value, opts) {
    const o = opts || {};
    return h('div', { class: 'stat ' + (o.tone || '') }, [
      h('div', { class: 'label' }, [o.icon ? h('span', { text: o.icon }) : null, h('span', { text: label })]),
      h('div', { class: 'value num' }, [
        h('span', { text: typeof value === 'number' ? fmt.plain(value) : value }),
        o.unit === false ? null : h('small', { text: global.U.state.currency }),
      ]),
      o.sub ? h('div', { class: 'sub', text: o.sub }) : null,
    ]);
  }

  async function render(view) {
    let range = 'today';
    let custom = { from: global.U.todayIso(), to: global.U.todayIso() };

    const chipBar = global.UI.chips(RANGES, range, guard(async (k) => {
      range = k;
      if (k === 'custom') { customBox.hidden = false; } else { customBox.hidden = true; await load(); }
    }));
    const fromInput = global.UI.dateInput({ value: custom.from, onChange: (v) => { custom.from = v; } });
    const toInput = global.UI.dateInput({ value: custom.to, onChange: (v) => { custom.to = v; } });
    const customBox = h('div', { class: 'inline', hidden: true, style: 'margin-top:10px' }, [
      global.UI.field('از تاریخ', fromInput),
      global.UI.field('تا تاریخ', toInput),
      h('button', { class: 'btn primary sm', text: 'نمایش', style: 'margin-top:20px', onclick: guard(() => load()) }),
    ]);

    const body = h('div');
    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [
      h('div', { class: 'body' }, [
        h('div', { class: 'inline', style: 'justify-content:space-between' }, [
          chipBar.el,
          h('button', { class: 'btn sm', text: '↻ به‌روزرسانی', onclick: guard(() => load()) }),
        ]),
        customBox,
      ]),
    ]));
    view.appendChild(body);

    const load = guard(async () => {
      body.innerHTML = '';
      body.appendChild(global.UI.loading('در حال محاسبه...'));
      const payload = range === 'custom' ? { from: custom.from, to: custom.to } : { range };
      const d = await call('reports.dashboard', payload);
      body.innerHTML = '';
      draw(body, d);
    });

    await load();
  }

  function draw(body, d) {
    const cur = global.U.state.currency;
    const netProfit = d.profit.net;

    // ── شاخص‌های اصلی
    body.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:16px' }, [
      stat('فروش دوره', d.sales.total, { icon: '🧾', tone: 'brand', sub: `${fmt.plain(d.sales.count)} فاکتور` }),
      stat('خرید دوره', d.purchases.total, { icon: '📦', sub: `${fmt.plain(d.purchases.count)} فاکتور` }),
      stat('سود ناخالص دوره', d.profit.gross, { icon: '📈', tone: d.profit.gross >= 0 ? 'ok' : 'bad', sub: `بهای تمام‌شده: ${fmt.plain(d.profit.cogs)}` }),
      stat('سود خالص دوره', netProfit, { icon: '💰', tone: netProfit >= 0 ? 'ok' : 'bad', sub: `هزینه‌ها: ${fmt.plain(d.profit.expenses)}` }),
    ]));

    // ── موجودی نقدی
    body.appendChild(h('div', { class: 'grid c5', style: 'margin-bottom:16px' }, [
      stat('صندوق', d.treasury.cash, { icon: '💵' }),
      stat('کارتخوان', d.treasury.pos, { icon: '💳' }),
      stat('بانک', d.treasury.bank, { icon: '🏦' }),
      stat('چک‌های نزد ما', d.treasury.checksReceivable, { icon: '📑' }),
      stat('ارزش موجودی انبار', d.inventory.value, { icon: '🏬', sub: `${fmt.plain(d.inventory.count)} قلم کالا` }),
    ]));

    body.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:16px' }, [
      stat('طلب از مشتریان', d.receivable, { icon: '🧑‍💼', tone: d.receivable > 0 ? 'brand' : '' }),
      stat('بدهی به تأمین‌کنندگان', d.payable, { icon: '🚚', tone: d.payable > 0 ? 'bad' : '' }),
      stat('مطالبات معوق', d.overdueReceivables.total, {
        icon: '⏰',
        tone: d.overdueReceivables.total > 0 ? 'bad' : '',
        sub: `فاکتورهای بیش از ${fmt.plain(d.overdueReceivables.days)} روز`,
      }),
      stat('چک‌های سررسید گذشته', (d.checks.totals.overdueReceived + d.checks.totals.overduePaid), {
        icon: '⚠️',
        tone: d.checks.overdue.length ? 'bad' : '',
        sub: `${fmt.plain(d.checks.overdue.length)} فقره`,
      }),
    ]));

    // ── نمودارها
    const labels = d.series.map((x) => fmt.date(x.date).slice(5));
    body.appendChild(h('div', { class: 'grid c2' }, [
      h('div', { class: 'panel', style: 'margin:0' }, [
        h('header', {}, [h('h2', { text: 'روند فروش، خرید و سود' })]),
        h('div', { class: 'body' }, [
          global.Charts.line({
            labels,
            series: [
              { name: 'فروش', color: '#1b4a7a', values: d.series.map((x) => x.sales) },
              { name: 'خرید', color: '#b7791f', values: d.series.map((x) => x.purchases) },
              { name: 'سود ناخالص', color: '#0d7f6d', values: d.series.map((x) => x.profit) },
            ],
          }),
        ]),
      ]),
      h('div', { class: 'panel', style: 'margin:0' }, [
        h('header', {}, [h('h2', { text: 'سهم روش‌های دریافت' })]),
        h('div', { class: 'body' }, [
          global.Charts.donut({
            rows: d.methods.map((m, i) => ({
              label: global.U.label('method', m.method),
              value: m.amount,
              color: global.Charts.COLORS[i % global.Charts.COLORS.length],
            })),
          }),
        ]),
      ]),
    ]));

    // ── پرفروش‌ها و هشدارها
    body.appendChild(h('div', { class: 'grid c2' }, [
      h('div', { class: 'panel', style: 'margin:0' }, [
        h('header', {}, [h('h2', { text: 'پرفروش‌ترین کالاهای دوره' })]),
        h('div', { class: 'body' }, [
          global.Charts.bars({
            rows: d.topProducts.map((p) => ({ label: p.product_name, value: p.amount })),
          }),
        ]),
      ]),
      h('div', { class: 'panel', style: 'margin:0' }, [
        h('header', {}, [
          h('h2', { text: 'کالاهای نیازمند سفارش' }),
          h('div', { class: 'spacer' }),
          h('span', { class: 'tag ' + (d.lowStock.length ? 'warn' : 'ok'), text: `${fmt.plain(d.lowStock.length)} کالا` }),
        ]),
        h('div', { class: 'body tight' }, [
          global.UI.table({
            columns: [
              { title: 'کالا', key: 'name' },
              { title: 'موجودی', key: 'stock', type: 'qty' },
              { title: 'حداقل', key: 'min_stock', type: 'qty' },
            ],
            rows: d.lowStock.slice(0, 8),
            empty: 'همه کالاها موجودی کافی دارند.',
            emptyIcon: '✅',
          }),
        ]),
      ]),
    ]));

    // ── چک‌های نزدیک سررسید
    const upcoming = d.checks.overdue.concat(d.checks.upcoming);
    body.appendChild(h('div', { class: 'panel' }, [
      h('header', {}, [
        h('h2', { text: 'چک‌های سررسید گذشته و نزدیک (۷ روز آینده)' }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn sm', text: 'مدیریت چک‌ها', onclick: () => global.App.go('checks') }),
      ]),
      h('div', { class: 'body tight' }, [
        global.UI.table({
          columns: [
            { title: 'نوع', key: 'kind', type: 'center', render: (r) => h('span', { class: 'tag ' + (r.kind === 'received' ? 'info' : 'warn'), text: global.U.label('checkKind', r.kind) }) },
            { title: 'شماره', key: 'number', type: 'center' },
            { title: 'بانک', key: 'bank' },
            { title: 'طرف حساب', key: 'party_name' },
            { title: 'مبلغ', key: 'amount', type: 'money' },
            { title: 'سررسید', key: 'due_date', type: 'date' },
            {
              title: 'وضعیت',
              key: 'status',
              type: 'center',
              render: (r) => {
                const late = r.due_date < d.overdueReceivables.rows.length ? false : r.due_date < global.U.todayIso();
                return h('span', { class: 'tag ' + (late ? 'bad' : 'mute'), text: late ? 'سررسید گذشته' : global.U.label('checkStatus', r.status) });
              },
            },
          ],
          rows: upcoming,
          empty: 'چکی در این بازه وجود ندارد.',
          emptyIcon: '📑',
        }),
      ]),
    ]));
  }

  global.Pages = global.Pages || {};
  global.Pages.dashboard = { title: 'داشبورد', render };
}(window));
