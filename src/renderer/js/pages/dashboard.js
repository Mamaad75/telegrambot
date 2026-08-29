'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;

  w.Pages = w.Pages || {};
  w.Pages.dashboard = {
    title: 'داشبورد',
    render: async function (root) {
      root.innerHTML =
        '<div id="rangeBar" class="mb"></div>' +
        '<div id="dashBody">' + U.loading() + '</div>';

      const bar = w.Comp.rangeBar({
        container: root.querySelector('#rangeBar'),
        kind: 'today',
        onChange: function (r) { load(r); }
      });
      load(bar.current());

      async function load(range) {
        const body = root.querySelector('#dashBody');
        const d = await API.safe('reports.dashboard', {
          from: range.from, to: range.to, label: range.label,
          trend_from: w.Jalali.isoAddDays(range.to, -13)
        });
        if (!d) { body.innerHTML = '<div class="alert error">بارگذاری داشبورد ناموفق بود.</div>'; return; }
        render(body, d, range);
      }

      function render(body, d, range) {
        const cur = U.cur();
        const banksHtml = d.bank_accounts.length
          ? d.bank_accounts.map(function (b) {
            return '<div class="totals-line"><span>' + (b.kind === 'pos' ? '💳 ' : '🏦 ') + U.esc(b.title) + '</span>' +
              '<span class="v">' + U.money(b.balance) + '</span></div>';
          }).join('')
          : '<div class="empty small">هنوز حساب بانکی ثبت نشده است. <a href="#" data-goto="banks">افزودن حساب</a></div>';

        body.innerHTML =
          '<div class="grid c4 mb">' +
          stat('فروش دوره', d.sales_total, 'accent', U.qty(d.sales_count) + ' فاکتور') +
          stat('خرید دوره', d.purchases_total, 'accent-orange', U.qty(d.purchases_count) + ' فاکتور') +
          stat('سود خالص دوره', d.profit, d.profit >= 0 ? 'accent-green' : 'accent-red',
            'سود ناخالص: ' + U.money(d.gross_profit)) +
          stat('ارزش موجودی انبار', d.inventory_value, 'accent', U.qty(d.inventory_qty) + ' قلم') +
          '</div>' +

          '<div class="grid c4 mb">' +
          stat('موجودی صندوق', d.cash, 'accent-green') +
          stat('مانده کارتخوان‌ها', d.pos, 'accent-green') +
          stat('مانده بانک‌ها', d.bank, 'accent-green') +
          stat('جمع نقدینگی', d.liquid_total, 'accent-green') +
          '</div>' +

          '<div class="grid c4 mb">' +
          '<div class="stat clickable accent-orange" data-goto="customers"><div class="label">💰 طلب از مشتریان</div>' +
          '<div class="value money">' + U.money(d.receivable) + '<small>' + U.esc(cur) + '</small></div></div>' +
          '<div class="stat clickable accent-red" data-goto="suppliers"><div class="label">📤 بدهی به تأمین‌کنندگان</div>' +
          '<div class="value money">' + U.money(d.payable) + '<small>' + U.esc(cur) + '</small></div></div>' +
          '<div class="stat clickable accent" data-goto="checks"><div class="label">🧿 چک‌های در جریان (دریافتی)</div>' +
          '<div class="value money">' + U.money(d.checks.open_received.s) + '</div>' +
          '<div class="sub">' + U.qty(d.checks.open_received.c) + ' فقره' +
          (d.checks.overdue_received.c ? ' • <span class="money-neg">' + U.qty(d.checks.overdue_received.c) + ' سررسید گذشته</span>' : '') + '</div></div>' +
          '<div class="stat clickable accent-red" data-goto="checks"><div class="label">🧾 چک‌های پرداختنی</div>' +
          '<div class="value money">' + U.money(d.checks.open_issued.s) + '</div>' +
          '<div class="sub">' + U.qty(d.checks.open_issued.c) + ' فقره' +
          (d.checks.due_soon.c ? ' • ' + U.qty(d.checks.due_soon.c) + ' نزدیک سررسید' : '') + '</div></div>' +
          '</div>' +

          '<div class="grid c3">' +
          '<div class="card" style="grid-column: span 2">' +
          '<div class="card-head"><h3>روند ۱۴ روز گذشته</h3><span class="spacer"></span>' +
          '<span class="small muted">فروش، خرید و سود روزانه</span></div>' +
          '<div class="card-body"><div id="trendChart"></div></div></div>' +

          '<div class="card"><div class="card-head"><h3>ترکیب دریافت‌ها</h3></div>' +
          '<div class="card-body"><div id="mixChart"></div></div></div>' +
          '</div>' +

          '<div class="grid c3">' +
          '<div class="card"><div class="card-head"><h3>مانده حساب‌ها</h3><span class="spacer"></span>' +
          '<button class="btn ghost sm" data-goto="banks">مدیریت</button></div>' +
          '<div class="card-body">' +
          '<div class="totals-line"><span>💵 صندوق</span><span class="v">' + U.money(d.cash) + '</span></div>' +
          banksHtml + '</div></div>' +

          '<div class="card"><div class="card-head"><h3>بدهکاران سررسید گذشته</h3><span class="spacer"></span>' +
          '<span class="tag ' + (d.overdue_receivables.length ? 'orange' : 'gray') + '">' + U.qty(d.overdue_receivables.length) + '</span></div>' +
          '<div class="card-body tight"><div class="table-wrap" style="max-height:260px;overflow-y:auto">' +
          '<table class="data compact"><tbody>' +
          (d.overdue_receivables.length ? d.overdue_receivables.map(function (r) {
            return '<tr class="clickable" data-invoice="' + r.id + '"><td class="name">' + U.esc(r.customer_name || 'متفرقه') + '</td>' +
              '<td class="small muted">' + U.esc(r.invoice_no) + '</td>' +
              '<td class="small">' + U.qty(r.days) + ' روز</td>' +
              '<td class="money bold">' + U.money(r.remaining) + '</td></tr>';
          }).join('') : U.emptyRow(4, 'بدهی معوقی وجود ندارد.', '✅')) +
          '</tbody></table></div></div></div>' +

          '<div class="card"><div class="card-head"><h3>کالاهای رو به اتمام</h3><span class="spacer"></span>' +
          '<span class="tag ' + (d.low_stock.length ? 'red' : 'gray') + '">' + U.qty(d.low_stock.length) + '</span></div>' +
          '<div class="card-body tight"><div class="table-wrap" style="max-height:260px;overflow-y:auto">' +
          '<table class="data compact"><tbody>' +
          (d.low_stock.length ? d.low_stock.map(function (p) {
            return '<tr><td class="name">' + U.esc(p.name) + '</td>' +
              '<td class="money-neg bold">' + U.qty(p.stock_qty) + ' ' + U.esc(p.unit) + '</td>' +
              '<td class="small muted">حداقل ' + U.qty(p.min_stock) + '</td></tr>';
          }).join('') : U.emptyRow(3, 'موجودی همه کالاها مناسب است.', '✅')) +
          '</tbody></table></div></div></div>' +
          '</div>' +

          '<div class="card"><div class="card-head"><h3>دسترسی سریع</h3></div><div class="card-body">' +
          '<div class="btn-group">' +
          '<button class="btn" data-goto="sales/new">🧾 فاکتور فروش جدید (F1)</button>' +
          '<button class="btn secondary" data-goto="purchases/new">📥 فاکتور خرید جدید</button>' +
          '<button class="btn secondary" data-goto="treasury">💵 ثبت دریافت / پرداخت</button>' +
          '<button class="btn secondary" data-goto="checks">🧿 مدیریت چک‌ها</button>' +
          '<button class="btn secondary" data-goto="cashbook">📒 ثبت هزینه</button>' +
          '<button class="btn secondary" data-goto="reports">📊 گزارش‌ها</button>' +
          '</div></div></div>';

        // نمودار روند
        const labels = d.trend.map(function (t) { return t.date_jalali.slice(5); });
        w.Charts.trend(body.querySelector('#trendChart'), labels, [
          { name: 'فروش', values: d.trend.map(function (t) { return t.sales; }), color: '#1f3a5f', type: 'bar' },
          { name: 'خرید', values: d.trend.map(function (t) { return t.purchases; }), color: '#b54708', type: 'bar' },
          { name: 'سود', values: d.trend.map(function (t) { return t.profit; }), color: '#067647', type: 'line' }
        ], { height: 235 });

        // ترکیب روش‌های دریافت
        const mix = (d.payment_mix || []).filter(function (m) { return m.direction === 'in'; });
        w.Charts.donut(body.querySelector('#mixChart'),
          mix.length ? mix.map(function (m) { return { label: m.method_label, value: m.total }; })
            : [{ label: 'بدون دریافت', value: 0 }], { size: 180 });

        body.addEventListener('click', function (e) {
          const g = e.target.closest('[data-goto]');
          if (g) { e.preventDefault(); App.go(g.dataset.goto); return; }
          const inv = e.target.closest('[data-invoice]');
          if (inv) App.go('sales', { focusId: parseInt(inv.dataset.invoice, 10) });
        });
      }

      function stat(label, value, cls, sub) {
        return '<div class="stat ' + (cls || '') + '"><div class="label">' + U.esc(label) + '</div>' +
          '<div class="value money">' + U.money(value) + '<small>' + U.esc(U.cur()) + '</small></div>' +
          (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
      }
    }
  };
})(window);
