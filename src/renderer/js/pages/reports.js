'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  const REPORTS = [
    { k: 'pl', l: 'سود و زیان', icon: '📈' },
    { k: 'daily', l: 'خلاصه مالی روزانه', icon: '📅' },
    { k: 'sales', l: 'فروش', icon: '🧾' },
    { k: 'purchases', l: 'خرید', icon: '📥' },
    { k: 'products', l: 'پرفروش‌ترین کالاها', icon: '🏆' },
    { k: 'vat', l: 'مالیات بر ارزش افزوده', icon: '🏛' },
    { k: 'receivable', l: 'مانده مشتریان (بدهکاران)', icon: '👤' },
    { k: 'payable', l: 'مانده تأمین‌کنندگان', icon: '🚚' },
    { k: 'checks', l: 'چک‌ها', icon: '🧿' },
    { k: 'inventory', l: 'موجودی و ارزش انبار', icon: '🏬' },
    { k: 'cash', l: 'گردش خزانه', icon: '💵' },
    { k: 'expenses', l: 'هزینه‌ها به تفکیک دسته', icon: '📒' }
  ];

  w.Pages.reports = {
    title: 'مرکز گزارش‌ها',
    render: async function (root) {
      let current = 'pl';
      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to };
      let exportCfg = { title: '', columns: [], rows: [] };

      root.innerHTML =
        '<div class="toolbar">' +
        '<div class="field f-md"><label>گزارش</label><select id="rep">' +
        REPORTS.map(function (r) { return '<option value="' + r.k + '">' + r.icon + ' ' + U.esc(r.l) + '</option>'; }).join('') +
        '</select></div>' +
        '<div id="rangeBar" style="flex:1;min-width:340px"></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button>' +
        '<button class="btn" id="fullExcel">خروجی اکسل کامل برنامه</button>' +
        '</div><div id="repBody"></div>';

      w.Comp.rangeBar({
        container: root.querySelector('#rangeBar'), kind: 'month',
        onChange: function (r) { state.from = r.from; state.to = r.to; load(); }
      });

      root.querySelector('#rep').addEventListener('change', function () { current = this.value; load(); });
      root.querySelector('#fullExcel').addEventListener('click', async function () {
        this.disabled = true;
        const r = await API.safe('excel.exportAll', { from: state.from, to: state.to });
        this.disabled = false;
        if (r && !r.canceled) U.toast('فایل اکسل با ' + w.Fmt.toFaDigits(r.sheets) + ' شیت ذخیره شد.', 'success');
      });

      function table(cols, rows, totals) {
        return '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data"><thead><tr>' +
          cols.map(function (c) { return '<th' + (c.align === 'right' ? ' class="name"' : '') + '>' + U.esc(c.header) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          (rows.length ? rows.map(function (r) {
            return '<tr>' + cols.map(function (c) {
              const v = r[c.key];
              return '<td class="' + (c.align === 'right' ? 'name' : '') + (c.money ? ' money' : '') + '">' +
                (c.money ? U.money(v) : U.esc(v === null || v === undefined ? '' : v)) + '</td>';
            }).join('') + '</tr>';
          }).join('') : U.emptyRow(cols.length, 'داده‌ای برای این بازه وجود ندارد.')) +
          '</tbody>' +
          (totals ? '<tfoot><tr>' + cols.map(function (c) {
            const v = totals[c.key];
            return '<td class="' + (c.money ? 'money' : '') + '">' + (v === undefined || v === null ? '' : (c.money ? U.money(v) : U.esc(v))) + '</td>';
          }).join('') + '</tr></tfoot>' : '') +
          '</table></div></div></div>';
      }

      async function load() {
        const box = root.querySelector('#repBody');
        box.innerHTML = U.loading();
        const sub = 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to);

        if (current === 'pl') {
          const pl = await API.call('reports.pl', state);
          const trend = await API.call('reports.trend', state);
          const lines = [
            { label: 'فروش ناخالص (پس از تخفیف)', value: pl.gross_revenue },
            { label: 'برگشت از فروش', value: -pl.sales_returns },
            { label: 'فروش خالص', value: pl.net_sales, strong: true },
            { label: 'بهای تمام‌شده کالای فروش‌رفته', value: -pl.cogs },
            { label: 'سود ناخالص', value: pl.gross_profit, strong: true },
            { label: 'هزینه‌های عملیاتی', value: -pl.operating_expenses },
            { label: 'درآمد متفرقه', value: pl.other_income },
            { label: 'سود (زیان) خالص', value: pl.net_profit, grand: true }
          ];
          exportCfg = {
            title: 'صورت سود و زیان', filename: 'profit-loss', subtitle: sub,
            columns: [{ header: 'شرح', key: 'label', align: 'right' }, { header: 'مبلغ', key: 'value', money: true }],
            rows: lines.map(function (l) { return { label: l.label, value: l.value }; })
          };
          box.innerHTML =
            '<div class="grid c4 mb">' +
            '<div class="stat accent"><div class="label">فروش خالص</div><div class="value money">' + U.money(pl.net_sales) + '</div></div>' +
            '<div class="stat accent-orange"><div class="label">بهای تمام‌شده</div><div class="value money">' + U.money(pl.cogs) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">سود ناخالص</div><div class="value money">' + U.money(pl.gross_profit) + '</div>' +
            '<div class="sub">حاشیه سود ' + w.Fmt.toFaDigits(pl.margin) + '٪</div></div>' +
            '<div class="stat ' + (pl.net_profit >= 0 ? 'accent-green' : 'accent-red') + '"><div class="label">سود خالص</div>' +
            '<div class="value money">' + U.money(pl.net_profit) + '</div></div></div>' +
            '<div class="grid c2">' +
            '<div class="card"><div class="card-head"><h3>صورت سود و زیان</h3></div><div class="card-body">' +
            lines.map(function (l) {
              return '<div class="totals-line' + (l.grand ? ' grand' : '') + '">' +
                '<span' + (l.strong ? ' class="bold"' : '') + '>' + U.esc(l.label) + '</span>' +
                '<span class="v ' + (l.value < 0 ? 'money-neg' : '') + '">' + U.money(l.value) + '</span></div>';
            }).join('') +
            '<div class="small muted mt">مجموع تخفیف‌های اعطایی در دوره: ' + U.moneyc(pl.discounts) + '</div>' +
            '</div></div>' +
            '<div class="card"><div class="card-head"><h3>هزینه‌ها به تفکیک دسته</h3></div>' +
            '<div class="card-body"><div id="expChart"></div></div></div></div>' +
            '<div class="card"><div class="card-head"><h3>روند سود روزانه</h3></div><div class="card-body"><div id="plChart"></div></div></div>';

          w.Charts.barList(box.querySelector('#expChart'),
            pl.expense_by_category.length
              ? pl.expense_by_category.map(function (e) { return { label: e.name, value: e.total }; })
              : [{ label: 'بدون هزینه', value: 0 }]);
          w.Charts.trend(box.querySelector('#plChart'),
            trend.map(function (t) { return t.date_jalali.slice(5); }), [
              { name: 'فروش خالص', values: trend.map(function (t) { return t.sales_net; }), color: '#1f3a5f', type: 'bar' },
              { name: 'سود', values: trend.map(function (t) { return t.profit; }), color: '#067647', type: 'line' }
            ], { height: 220 });

        } else if (current === 'daily') {
          const d = await API.call('reports.daily', { date: state.to });
          exportCfg = {
            title: 'خلاصه مالی روز ' + d.date_jalali, filename: 'daily-summary', subtitle: d.date_long,
            columns: [{ header: 'شرح', key: 'label', align: 'right' }, { header: 'مبلغ', key: 'value', money: true }],
            rows: [
              { label: 'فروش', value: d.sales.t }, { label: 'خرید', value: d.purchases.t },
              { label: 'دریافت‌ها', value: d.receipts.t }, { label: 'پرداخت‌ها', value: d.payments.t },
              { label: 'هزینه', value: d.expenses.t }, { label: 'درآمد متفرقه', value: d.incomes.t },
              { label: 'سود خالص روز', value: d.profit },
              { label: 'مانده صندوق', value: d.balances.cash }, { label: 'مانده کارتخوان', value: d.balances.pos },
              { label: 'مانده بانک', value: d.balances.bank }
            ]
          };
          box.innerHTML =
            '<div class="alert info">خلاصه مالی ' + U.esc(d.date_long) + '</div>' +
            '<div class="grid c4 mb">' +
            '<div class="stat accent"><div class="label">فروش روز</div><div class="value money">' + U.money(d.sales.t) + '</div>' +
            '<div class="sub">' + w.Fmt.toFaDigits(d.sales.n) + ' فاکتور</div></div>' +
            '<div class="stat accent-orange"><div class="label">خرید روز</div><div class="value money">' + U.money(d.purchases.t) + '</div>' +
            '<div class="sub">' + w.Fmt.toFaDigits(d.purchases.n) + ' فاکتور</div></div>' +
            '<div class="stat accent-red"><div class="label">هزینه روز</div><div class="value money">' + U.money(d.expenses.t) + '</div></div>' +
            '<div class="stat ' + (d.profit >= 0 ? 'accent-green' : 'accent-red') + '"><div class="label">سود خالص روز</div>' +
            '<div class="value money">' + U.money(d.profit) + '</div></div></div>' +
            '<div class="grid c2">' +
            '<div class="card"><div class="card-head"><h3>گردش خزانه</h3></div><div class="card-body">' +
            '<div class="totals-line"><span>جمع دریافت‌ها</span><span class="v money-pos">' + U.money(d.receipts.t) + '</span></div>' +
            '<div class="totals-line"><span>جمع پرداخت‌ها</span><span class="v money-neg">' + U.money(d.payments.t) + '</span></div>' +
            '<div class="totals-line"><span>درآمد متفرقه</span><span class="v">' + U.money(d.incomes.t) + '</span></div>' +
            '<div class="totals-line"><span>مانده صندوق</span><span class="v">' + U.money(d.balances.cash) + '</span></div>' +
            '<div class="totals-line"><span>مانده کارتخوان‌ها</span><span class="v">' + U.money(d.balances.pos) + '</span></div>' +
            '<div class="totals-line grand"><span>مانده بانک‌ها</span><span class="v">' + U.money(d.balances.bank) + '</span></div>' +
            '</div></div>' +
            '<div class="card"><div class="card-head"><h3>ترکیب روش‌های دریافت و پرداخت</h3></div>' +
            '<div class="card-body"><div id="mixChart"></div></div></div></div>';
          const mixIn = d.payment_mix.filter(function (m) { return m.direction === 'in'; });
          w.Charts.donut(box.querySelector('#mixChart'),
            mixIn.length ? mixIn.map(function (m) { return { label: m.method_label, value: m.total }; }) : [{ label: 'بدون تراکنش', value: 0 }],
            { size: 190 });

        } else if (current === 'sales' || current === 'purchases') {
          const isSale = current === 'sales';
          const rep = isSale ? await API.call('reports.sales', state) : await API.call('reports.purchases', state);
          const cols = isSale
            ? [
              { header: 'شماره', key: 'invoice_no' }, { header: 'تاریخ', key: 'date_jalali' },
              { header: 'مشتری', key: 'customer_name', align: 'right' },
              { header: 'مبلغ مشمول', key: 'taxable', money: true }, { header: 'مالیات', key: 'vat_amount', money: true },
              { header: 'جمع', key: 'total', money: true }, { header: 'بهای تمام‌شده', key: 'cogs', money: true },
              { header: 'سود', key: 'profit', money: true }, { header: 'مانده', key: 'remaining', money: true }
            ]
            : [
              { header: 'شماره', key: 'invoice_no' }, { header: 'تاریخ', key: 'date_jalali' },
              { header: 'تأمین‌کننده', key: 'supplier_name', align: 'right' },
              { header: 'مبلغ', key: 'taxable', money: true }, { header: 'مالیات', key: 'vat_amount', money: true },
              { header: 'جمع', key: 'total', money: true }, { header: 'پرداخت‌شده', key: 'paid', money: true },
              { header: 'مانده', key: 'remaining', money: true }
            ];
          const totals = isSale
            ? { invoice_no: 'جمع', taxable: rep.totals.taxable, vat_amount: rep.totals.vat, total: rep.totals.total, cogs: rep.totals.cogs, profit: rep.totals.profit }
            : { invoice_no: 'جمع', taxable: rep.totals.taxable, vat_amount: rep.totals.vat, total: rep.totals.total, paid: rep.totals.paid };
          exportCfg = { title: isSale ? 'گزارش فروش' : 'گزارش خرید', filename: current, subtitle: sub, columns: cols, rows: rep.rows, totals: totals, landscape: true };
          box.innerHTML =
            '<div class="grid c4 mb">' +
            '<div class="stat accent"><div class="label">جمع ' + (isSale ? 'فروش' : 'خرید') + '</div><div class="value money">' + U.money(rep.totals.total) + '</div>' +
            '<div class="sub">' + w.Fmt.toFaDigits(rep.rows.length) + ' فاکتور</div></div>' +
            '<div class="stat"><div class="label">تخفیف</div><div class="value money">' + U.money(rep.totals.discount) + '</div></div>' +
            '<div class="stat"><div class="label">مالیات</div><div class="value money">' + U.money(rep.totals.vat) + '</div></div>' +
            (isSale
              ? '<div class="stat accent-green"><div class="label">سود ناخالص</div><div class="value money">' + U.money(rep.totals.profit) + '</div></div>'
              : '<div class="stat accent-red"><div class="label">مانده بدهی</div><div class="value money">' + U.money(rep.totals.total - rep.totals.paid) + '</div></div>') +
            '</div>' + table(cols, rep.rows, totals);

        } else if (current === 'products') {
          const rows = await API.call('reports.topProducts', { from: state.from, to: state.to, limit: 50 });
          const cols = [
            { header: 'نام کالا', key: 'name', align: 'right' }, { header: 'کد', key: 'code' },
            { header: 'تعداد فروش', key: 'qty' }, { header: 'مبلغ فروش', key: 'revenue', money: true },
            { header: 'بهای تمام‌شده', key: 'cost', money: true }, { header: 'سود', key: 'profit', money: true }
          ];
          exportCfg = { title: 'پرفروش‌ترین کالاها', filename: 'top-products', subtitle: sub, columns: cols, rows: rows };
          box.innerHTML =
            '<div class="grid c2 mb">' +
            '<div class="card"><div class="card-head"><h3>سهم فروش کالاها</h3></div><div class="card-body"><div id="topChart"></div></div></div>' +
            '<div class="card"><div class="card-head"><h3>سودآورترین کالاها</h3></div><div class="card-body"><div id="profChart"></div></div></div>' +
            '</div>' + table(cols, rows);
          w.Charts.barList(box.querySelector('#topChart'),
            rows.slice(0, 8).map(function (r) { return { label: r.name, value: r.revenue }; }));
          w.Charts.barList(box.querySelector('#profChart'),
            rows.slice().sort(function (a, b) { return b.profit - a.profit; }).slice(0, 8)
              .map(function (r) { return { label: r.name, value: r.profit }; }));

        } else if (current === 'vat') {
          const v = await API.call('reports.vat', state);
          const rows = [
            { label: 'فروش', base: v.sales.base, vat: v.sales.vat },
            { label: 'برگشت از فروش', base: -v.sales_returns.base, vat: -v.sales_returns.vat },
            { label: 'مالیات فروش (خروجی)', base: '', vat: v.output_vat },
            { label: 'خرید', base: v.purchases.base, vat: v.purchases.vat },
            { label: 'برگشت از خرید', base: -v.purchase_returns.base, vat: -v.purchase_returns.vat },
            { label: 'مالیات خرید (ورودی)', base: '', vat: v.input_vat },
            { label: 'مالیات قابل پرداخت', base: '', vat: v.net_vat }
          ];
          const cols = [
            { header: 'شرح', key: 'label', align: 'right' },
            { header: 'مبلغ پایه', key: 'base', money: true }, { header: 'مالیات', key: 'vat', money: true }
          ];
          exportCfg = { title: 'گزارش مالیات بر ارزش افزوده', filename: 'vat', subtitle: sub, columns: cols, rows: rows };
          box.innerHTML =
            '<div class="grid c3 mb">' +
            '<div class="stat accent"><div class="label">مالیات فروش (خروجی)</div><div class="value money">' + U.money(v.output_vat) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">مالیات خرید (ورودی)</div><div class="value money">' + U.money(v.input_vat) + '</div></div>' +
            '<div class="stat accent-red"><div class="label">مالیات قابل پرداخت</div><div class="value money">' + U.money(v.net_vat) + '</div></div>' +
            '</div>' + table(cols, rows) +
            '<div class="alert info">مانده حساب ۲۰۲ (مالیات بر ارزش افزوده) در دفتر: <b>' + U.moneyc(v.ledger_balance) + '</b></div>';

        } else if (current === 'receivable' || current === 'payable') {
          const type = current === 'receivable' ? 'customer' : 'supplier';
          const rows = (await API.call('reports.partyBalances', { type: type, nonZeroOnly: true }))
            .sort(function (a, b) { return b.balance - a.balance; });
          const cols = [
            { header: 'نام', key: 'name', align: 'right' }, { header: 'تلفن', key: 'phone' },
            { header: 'بدهکار', key: 'debit', money: true }, { header: 'بستانکار', key: 'credit', money: true },
            { header: 'مانده', key: 'balance', money: true }
          ];
          const total = rows.reduce(function (a, r) { return a + r.balance; }, 0);
          exportCfg = {
            title: current === 'receivable' ? 'مانده مشتریان' : 'مانده تأمین‌کنندگان',
            filename: current, subtitle: 'تا ' + U.jalali(state.to), columns: cols, rows: rows,
            totals: { name: 'جمع', balance: total }
          };
          box.innerHTML =
            '<div class="grid c3 mb">' +
            '<div class="stat accent"><div class="label">تعداد طرف‌حساب دارای مانده</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
            '<div class="stat accent-red"><div class="label">' + (current === 'receivable' ? 'جمع طلب ما' : 'جمع بدهی ما') + '</div>' +
            '<div class="value money">' + U.money(rows.filter(function (r) { return r.balance > 0; }).reduce(function (a, r) { return a + r.balance; }, 0)) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">' + (current === 'receivable' ? 'پیش‌دریافت' : 'پیش‌پرداخت') + '</div>' +
            '<div class="value money">' + U.money(-rows.filter(function (r) { return r.balance < 0; }).reduce(function (a, r) { return a + r.balance; }, 0)) + '</div></div>' +
            '</div>' + table(cols, rows, { name: 'جمع', balance: total });

        } else if (current === 'checks') {
          const rows = await API.call('checks.list', { limit: 1000, order: 'due' });
          const cols = [
            { header: 'کد یکتا', key: 'check_code' }, { header: 'نوع', key: 'direction_label' },
            { header: 'دارنده', key: 'holder_name', align: 'right' }, { header: 'طرف حساب', key: 'party_name', align: 'right' },
            { header: 'مبلغ', key: 'amount', money: true }, { header: 'سررسید', key: 'due_date_jalali' },
            { header: 'فاکتور', key: 'ref_no' }, { header: 'وضعیت', key: 'status_label' }
          ];
          const s = await API.call('checks.summary', {});
          exportCfg = { title: 'گزارش چک‌ها', filename: 'checks', subtitle: sub, columns: cols, rows: rows, landscape: true };
          box.innerHTML =
            '<div class="grid c4 mb">' +
            '<div class="stat accent"><div class="label">چک‌های دریافتی در جریان</div><div class="value money">' + U.money(s.open_received.s) + '</div>' +
            '<div class="sub">' + w.Fmt.toFaDigits(s.open_received.c) + ' فقره</div></div>' +
            '<div class="stat accent-red"><div class="label">چک‌های صادره در جریان</div><div class="value money">' + U.money(s.open_issued.s) + '</div>' +
            '<div class="sub">' + w.Fmt.toFaDigits(s.open_issued.c) + ' فقره</div></div>' +
            '<div class="stat accent-orange"><div class="label">سررسید گذشته</div>' +
            '<div class="value money">' + U.money(s.overdue_received.s + s.overdue_issued.s) + '</div></div>' +
            '<div class="stat"><div class="label">برگشتی</div><div class="value money">' + U.money(s.returned.s) + '</div></div>' +
            '</div>' + table(cols, rows, { check_code: 'جمع', amount: rows.reduce(function (a, r) { return a + r.amount; }, 0) });

        } else if (current === 'inventory') {
          const rows = await API.call('inventory.valuation', {});
          const cols = [
            { header: 'کد', key: 'code' }, { header: 'نام کالا', key: 'name', align: 'right' },
            { header: 'واحد', key: 'unit' }, { header: 'موجودی', key: 'stock_qty' },
            { header: 'بهای میانگین', key: 'avg_cost_r', money: true }, { header: 'ارزش موجودی', key: 'stock_value', money: true }
          ];
          const data = rows.map(function (r) { return Object.assign({}, r, { avg_cost_r: Math.round(r.avg_cost) }); });
          const total = rows.reduce(function (a, r) { return a + r.stock_value; }, 0);
          exportCfg = { title: 'ارزش موجودی انبار', filename: 'inventory', subtitle: 'تا امروز', columns: cols, rows: data, totals: { name: 'جمع', stock_value: total } };
          box.innerHTML =
            '<div class="grid c3 mb">' +
            '<div class="stat accent"><div class="label">تعداد اقلام</div><div class="value">' + w.Fmt.toFaDigits(rows.length) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">ارزش کل انبار</div><div class="value money">' + U.money(total) + '</div></div>' +
            '<div class="stat accent-orange"><div class="label">کالاهای رو به اتمام</div><div class="value">' +
            w.Fmt.toFaDigits((await API.call('inventory.lowStock', { limit: 999 })).length) + '</div></div>' +
            '</div>' + table(cols, data, { name: 'جمع', stock_value: total });

        } else if (current === 'cash') {
          const [cashLed, posLed, bankLed] = await Promise.all([
            API.call('accounting.ledger', { code: App.info.constants.accounts.CASH, from: state.from, to: state.to }),
            API.call('accounting.ledger', { code: App.info.constants.accounts.POS, from: state.from, to: state.to }),
            API.call('accounting.ledger', { code: App.info.constants.accounts.BANK, from: state.from, to: state.to })
          ]);
          const build = function (led, title) {
            return '<div class="card"><div class="card-head"><h3>' + title + '</h3><span class="spacer"></span>' +
              '<span class="small muted">مانده ابتدا ' + U.money(led.opening) + ' → پایان <b>' + U.money(led.closing) + '</b></span></div>' +
              '<div class="card-body tight"><div class="table-wrap" style="max-height:300px;overflow-y:auto">' +
              '<table class="data compact"><thead><tr><th>تاریخ</th><th class="name">شرح</th><th>واریز</th><th>برداشت</th><th>مانده</th></tr></thead><tbody>' +
              (led.rows.length ? led.rows.map(function (r) {
                return '<tr><td>' + U.esc(U.jalali(r.date)) + '</td><td class="name small">' + U.esc(r.description || r.entry_desc || '') + '</td>' +
                  '<td class="money money-pos">' + (r.debit ? U.money(r.debit) : '') + '</td>' +
                  '<td class="money money-neg">' + (r.credit ? U.money(r.credit) : '') + '</td>' +
                  '<td class="money bold">' + U.money(r.balance) + '</td></tr>';
              }).join('') : U.emptyRow(5, 'گردشی وجود ندارد.')) + '</tbody></table></div></div></div>';
          };
          const allRows = [];
          [['صندوق', cashLed], ['کارتخوان', posLed], ['بانک', bankLed]].forEach(function (p) {
            p[1].rows.forEach(function (r) {
              allRows.push({ group: p[0], date_j: U.jalali(r.date), desc: r.description || r.entry_desc, debit: r.debit, credit: r.credit, balance: r.balance });
            });
          });
          exportCfg = {
            title: 'گردش خزانه', filename: 'treasury', subtitle: sub,
            columns: [
              { header: 'حساب', key: 'group' }, { header: 'تاریخ', key: 'date_j' },
              { header: 'شرح', key: 'desc', align: 'right' }, { header: 'واریز', key: 'debit', money: true },
              { header: 'برداشت', key: 'credit', money: true }, { header: 'مانده', key: 'balance', money: true }
            ],
            rows: allRows, landscape: true
          };
          box.innerHTML = build(cashLed, '💵 صندوق') + build(posLed, '💳 کارتخوان‌ها') + build(bankLed, '🏦 حساب‌های بانکی');

        } else if (current === 'expenses') {
          const pl = await API.call('reports.pl', state);
          const cols = [
            { header: 'دسته هزینه', key: 'name', align: 'right' },
            { header: 'تعداد سند', key: 'n' }, { header: 'مبلغ', key: 'total', money: true }
          ];
          const total = pl.expense_by_category.reduce(function (a, r) { return a + r.total; }, 0);
          exportCfg = { title: 'هزینه‌ها به تفکیک دسته', filename: 'expenses-by-category', subtitle: sub, columns: cols, rows: pl.expense_by_category, totals: { name: 'جمع', total: total } };
          box.innerHTML =
            '<div class="grid c2 mb">' +
            '<div class="card"><div class="card-head"><h3>سهم هر دسته</h3></div><div class="card-body"><div id="expDonut"></div></div></div>' +
            '<div class="card"><div class="card-head"><h3>خلاصه</h3></div><div class="card-body">' +
            '<div class="totals-line"><span>تعداد دسته‌های دارای هزینه</span><span class="v">' + w.Fmt.toFaDigits(pl.expense_by_category.length) + '</span></div>' +
            '<div class="totals-line grand"><span>جمع هزینه‌های دوره</span><span class="v">' + U.money(total) + '</span></div>' +
            '</div></div></div>' + table(cols, pl.expense_by_category, { name: 'جمع', total: total });
          w.Charts.donut(box.querySelector('#expDonut'),
            pl.expense_by_category.length
              ? pl.expense_by_category.map(function (e) { return { label: e.name, value: e.total }; })
              : [{ label: 'بدون هزینه', value: 0 }], { size: 200 });
        }

        U.enhance(box);
      }

      w.Comp.bindExport(root, function () { return exportCfg; });
      await load();
    }
  };
})(window);
