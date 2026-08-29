'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  const TYPE_LABEL = { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه' };

  w.Pages.accounting = {
    title: 'دفاتر حسابداری',
    render: async function (root) {
      let tab = 'journal';
      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to, search: '', code: '', limit: 300 };
      let rows = [];
      const accounts = await API.call('accounting.accounts', {});

      root.innerHTML =
        '<div class="tabs">' +
        '<div class="tab active" data-tab="journal">دفتر روزنامه</div>' +
        '<div class="tab" data-tab="ledger">دفتر کل</div>' +
        '<div class="tab" data-tab="trial">تراز آزمایشی</div>' +
        '<div class="tab" data-tab="sheet">ترازنامه</div>' +
        '<div class="tab" data-tab="chart">کدینگ حساب‌ها</div>' +
        '<div class="tab" data-tab="health">بررسی سلامت</div>' +
        '</div>' +
        '<div class="toolbar" id="bar"></div>' +
        '<div id="body"></div>';

      root.querySelector('.tabs').addEventListener('click', function (e) {
        const t = e.target.closest('[data-tab]');
        if (!t) return;
        tab = t.dataset.tab;
        U.$$('.tab', root).forEach(function (x) { x.classList.toggle('active', x === t); });
        renderBar();
        load();
      });

      function renderBar() {
        const bar = root.querySelector('#bar');
        if (tab === 'chart' || tab === 'health') { bar.style.display = 'none'; return; }
        bar.style.display = '';
        bar.innerHTML =
          '<div id="rangeBar" style="width:100%"></div>' +
          (tab === 'journal'
            ? '<div class="field f-lg"><label>جست‌وجو در شرح سند</label><input type="search" id="q"></div>'
            : '') +
          (tab === 'ledger'
            ? '<div class="field f-md"><label>حساب</label><select id="acc">' +
              accounts.map(function (a) {
                return '<option value="' + a.code + '"' + (state.code === a.code ? ' selected' : '') + '>' +
                  w.Fmt.toFaDigits(a.code) + ' — ' + U.esc(a.name) + '</option>';
              }).join('') + '</select></div>'
            : '') +
          '<span class="spacer"></span>' +
          '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
          '<button class="btn secondary sm" data-export-print>چاپ</button>';

        w.Comp.rangeBar({
          container: bar.querySelector('#rangeBar'), kind: 'month',
          onChange: function (r) { state.from = r.from; state.to = r.to; load(); }
        });
        const q = bar.querySelector('#q');
        if (q) q.addEventListener('input', U.debounce(function () { state.search = this.value.trim(); load(); }, 250));
        const acc = bar.querySelector('#acc');
        if (acc) {
          if (!state.code) state.code = accounts[0] ? accounts[0].code : '101';
          acc.value = state.code;
          acc.addEventListener('change', function () { state.code = this.value; load(); });
        }
      }

      async function load() {
        const box = root.querySelector('#body');
        box.innerHTML = U.loading();

        if (tab === 'journal') {
          const entries = await API.call('accounting.journal', state);
          rows = [];
          let html = '<div class="card"><div class="card-body tight"><div class="table-wrap">' +
            '<table class="data compact"><thead><tr><th>سند</th><th>تاریخ</th><th class="name">شرح</th>' +
            '<th>کد حساب</th><th class="name">نام حساب</th><th>بدهکار</th><th>بستانکار</th></tr></thead><tbody>';
          if (!entries.length) html += U.emptyRow(7, 'سندی در این بازه ثبت نشده است.', '📚');
          entries.forEach(function (e) {
            e.lines.forEach(function (l, i) {
              rows.push({
                entry_no: e.entry_no, date_j: U.jalali(e.date), entry_desc: e.description,
                account_code: l.account_code, account_name: l.account_name, debit: l.debit, credit: l.credit
              });
              html += '<tr' + (i === 0 ? ' style="border-top:2px solid var(--line)"' : '') + '>' +
                '<td>' + (i === 0 ? '<b>' + w.Fmt.toFaDigits(e.entry_no) + '</b>' : '') + '</td>' +
                '<td>' + (i === 0 ? U.esc(U.jalali(e.date)) : '') + '</td>' +
                '<td class="name small">' + (i === 0 ? U.esc(e.description) : '<span class="muted">' + U.esc(l.description || '') + '</span>') + '</td>' +
                '<td class="small">' + w.Fmt.toFaDigits(l.account_code) + '</td>' +
                '<td class="name">' + U.esc(l.account_name) + '</td>' +
                '<td class="money">' + (l.debit ? U.money(l.debit) : '') + '</td>' +
                '<td class="money">' + (l.credit ? U.money(l.credit) : '') + '</td></tr>';
            });
          });
          const td = rows.reduce(function (a, r) { return a + r.debit; }, 0);
          const tc = rows.reduce(function (a, r) { return a + r.credit; }, 0);
          html += '</tbody><tfoot><tr><td colspan="5">جمع</td><td class="money">' + U.money(td) + '</td>' +
            '<td class="money">' + U.money(tc) + '</td></tr></tfoot></table></div></div></div>';
          box.innerHTML = html;

        } else if (tab === 'ledger') {
          const led = await API.call('accounting.ledger', { code: state.code, from: state.from, to: state.to });
          rows = led.rows.map(function (r) {
            return {
              date_j: U.jalali(r.date), entry_no: r.entry_no, description: r.description || r.entry_desc,
              ref_no: r.ref_no, debit: r.debit, credit: r.credit, balance: r.balance
            };
          });
          box.innerHTML =
            '<div class="grid c3 mb">' +
            '<div class="stat"><div class="label">حساب</div><div class="value" style="font-size:15px">' +
            U.esc(led.account ? led.account.name : '') + '</div></div>' +
            '<div class="stat"><div class="label">مانده ابتدای دوره</div><div class="value money">' + U.money(led.opening) + '</div></div>' +
            '<div class="stat accent"><div class="label">مانده پایان دوره</div><div class="value money">' + U.money(led.closing) + '</div></div></div>' +
            '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data compact"><thead><tr>' +
            '<th>تاریخ</th><th>سند</th><th class="name">شرح</th><th>مرجع</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th>' +
            '</tr></thead><tbody>' +
            '<tr><td colspan="6" class="name muted">مانده ابتدای دوره</td><td class="money bold">' + U.money(led.opening) + '</td></tr>' +
            (led.rows.length ? led.rows.map(function (r) {
              return '<tr><td>' + U.esc(U.jalali(r.date)) + '</td><td class="small">' + w.Fmt.toFaDigits(r.entry_no) + '</td>' +
                '<td class="name small">' + U.esc(r.description || r.entry_desc || '') + '</td>' +
                '<td class="small">' + U.esc(r.ref_no || '') + '</td>' +
                '<td class="money">' + (r.debit ? U.money(r.debit) : '') + '</td>' +
                '<td class="money">' + (r.credit ? U.money(r.credit) : '') + '</td>' +
                '<td class="money bold">' + U.money(r.balance) + '</td></tr>';
            }).join('') : '') +
            '</tbody><tfoot><tr><td colspan="6">مانده پایان دوره</td><td class="money">' + U.money(led.closing) + '</td></tr></tfoot>' +
            '</table></div></div></div>';

        } else if (tab === 'trial') {
          const tb = await API.call('accounting.trialBalance', { from: state.from, to: state.to });
          rows = tb;
          const sums = tb.reduce(function (a, r) {
            a.d += r.debit; a.c += r.credit; a.db += r.debit_balance; a.cb += r.credit_balance; return a;
          }, { d: 0, c: 0, db: 0, cb: 0 });
          box.innerHTML =
            '<div class="alert ' + (sums.d === sums.c ? 'success' : 'error') + '">' +
            (sums.d === sums.c
              ? 'تراز است: جمع بدهکار و بستانکار برابر است (' + U.money(sums.d) + ').'
              : 'هشدار: جمع بدهکار (' + U.money(sums.d) + ') با بستانکار (' + U.money(sums.c) + ') برابر نیست.') + '</div>' +
            '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data"><thead><tr>' +
            '<th>کد</th><th class="name">نام حساب</th><th>نوع</th><th>گردش بدهکار</th><th>گردش بستانکار</th>' +
            '<th>مانده بدهکار</th><th>مانده بستانکار</th></tr></thead><tbody>' +
            tb.map(function (r) {
              return '<tr><td>' + w.Fmt.toFaDigits(r.code) + '</td><td class="name">' + U.esc(r.name) + '</td>' +
                '<td class="small">' + U.esc(TYPE_LABEL[r.type] || r.type) + '</td>' +
                '<td class="money">' + U.money(r.debit) + '</td><td class="money">' + U.money(r.credit) + '</td>' +
                '<td class="money bold">' + (r.debit_balance ? U.money(r.debit_balance) : '') + '</td>' +
                '<td class="money bold">' + (r.credit_balance ? U.money(r.credit_balance) : '') + '</td></tr>';
            }).join('') +
            '</tbody><tfoot><tr><td colspan="3">جمع</td><td class="money">' + U.money(sums.d) + '</td>' +
            '<td class="money">' + U.money(sums.c) + '</td><td class="money">' + U.money(sums.db) + '</td>' +
            '<td class="money">' + U.money(sums.cb) + '</td></tr></tfoot></table></div></div></div>';

        } else if (tab === 'sheet') {
          const bs = await API.call('reports.balanceSheet', { to: state.to });
          rows = [];
          const section = function (title, list, extra) {
            let h = '<h4 style="font-size:13px;margin:12px 0 6px;color:var(--primary)">' + title + '</h4>' +
              '<table class="data compact"><tbody>';
            list.forEach(function (r) {
              if (r.balance === 0) return;
              rows.push({ group: title, name: r.name, balance: r.balance });
              h += '<tr><td class="name">' + U.esc(r.name) + '</td><td class="money">' + U.money(r.balance) + '</td></tr>';
            });
            if (extra) {
              rows.push({ group: title, name: extra.name, balance: extra.value });
              h += '<tr><td class="name">' + U.esc(extra.name) + '</td><td class="money">' + U.money(extra.value) + '</td></tr>';
            }
            return h + '</tbody></table>';
          };
          box.innerHTML =
            '<div class="alert ' + (bs.balanced ? 'success' : 'warn') + '">' +
            (bs.balanced ? 'ترازنامه تراز است.' : 'ترازنامه تراز نیست؛ از بخش «بررسی سلامت» وضعیت را ببینید.') +
            ' — تا تاریخ ' + U.esc(U.jalali(bs.to)) + '</div>' +
            '<div class="grid c2">' +
            '<div class="card"><div class="card-head"><h3>دارایی‌ها</h3><span class="spacer"></span>' +
            '<span class="bold money">' + U.money(bs.total_assets) + '</span></div><div class="card-body">' +
            section('دارایی‌ها', bs.assets) + '</div></div>' +
            '<div class="card"><div class="card-head"><h3>بدهی‌ها و سرمایه</h3><span class="spacer"></span>' +
            '<span class="bold money">' + U.money(bs.total_liabilities + bs.total_equity + bs.retained_earnings) + '</span></div>' +
            '<div class="card-body">' + section('بدهی‌ها', bs.liabilities) +
            section('سرمایه', bs.equity, { name: 'سود (زیان) انباشته دوره', value: bs.retained_earnings }) +
            '</div></div></div>';

        } else if (tab === 'chart') {
          rows = accounts.map(function (a) {
            return { code: a.code, name: a.name, type: TYPE_LABEL[a.type] || a.type, side: a.normal_side === 'debit' ? 'بدهکار' : 'بستانکار' };
          });
          box.innerHTML =
            '<div class="card"><div class="card-head"><h3>کدینگ حساب‌های سیستم</h3></div>' +
            '<div class="card-body tight"><table class="data"><thead><tr><th>کد</th><th class="name">نام حساب</th>' +
            '<th>نوع</th><th>ماهیت</th><th>مانده فعلی</th></tr></thead><tbody id="chartBody">' +
            accounts.map(function (a) {
              return '<tr data-code="' + a.code + '"><td class="bold">' + w.Fmt.toFaDigits(a.code) + '</td>' +
                '<td class="name">' + U.esc(a.name) + '</td>' +
                '<td>' + U.esc(TYPE_LABEL[a.type] || a.type) + '</td>' +
                '<td class="small">' + (a.normal_side === 'debit' ? 'بدهکار' : 'بستانکار') + '</td>' +
                '<td class="money" data-bal>—</td></tr>';
            }).join('') + '</tbody></table></div></div>' +
            '<div class="alert info">حساب ۵۰۱ (خرید کالا) در روش «موجودی دائمی» استفاده نمی‌شود؛ خریدها مستقیم به حساب ۱۰۶ (موجودی کالا) می‌رود ' +
            'و هنگام فروش به حساب ۵۰۳ (بهای تمام‌شده) منتقل می‌شود.</div>';
          for (const a of accounts) {
            const b = await API.call('accounting.balance', { code: a.code });
            const cell = box.querySelector('tr[data-code="' + a.code + '"] [data-bal]');
            if (cell) cell.textContent = U.money(b);
          }

        } else {
          const h = await API.call('app.integrity', {});
          rows = [];
          const acc = h.accounting;
          box.innerHTML =
            '<div class="grid c3 mb">' +
            '<div class="stat ' + (acc.trial_balanced ? 'accent-green' : 'accent-red') + '">' +
            '<div class="label">تراز دفتر</div><div class="value" style="font-size:15px">' +
            (acc.trial_balanced ? 'تراز است ✓' : 'ناتراز ✗') + '</div>' +
            '<div class="sub">بدهکار ' + U.money(acc.total_debit) + ' / بستانکار ' + U.money(acc.total_credit) + '</div></div>' +
            '<div class="stat ' + (acc.inventory_matches ? 'accent-green' : 'accent-red') + '">' +
            '<div class="label">تطابق انبار با حسابداری</div><div class="value" style="font-size:15px">' +
            (acc.inventory_matches ? 'هماهنگ ✓' : 'مغایرت ✗') + '</div>' +
            '<div class="sub">دفتر ' + U.money(acc.inventory_gl) + ' / انبار ' + U.money(acc.inventory_stock_value) + '</div></div>' +
            '<div class="stat ' + (h.database.ok ? 'accent-green' : 'accent-red') + '">' +
            '<div class="label">سلامت فایل پایگاه داده</div><div class="value" style="font-size:15px">' +
            (h.database.ok ? 'سالم ✓' : 'مشکل‌دار ✗') + '</div></div></div>' +
            (acc.unbalanced_entries.length
              ? '<div class="card"><div class="card-head"><h3>اسناد ناتراز</h3></div><div class="card-body tight">' +
                '<table class="data compact"><thead><tr><th>شماره</th><th>تاریخ</th><th class="name">شرح</th>' +
                '<th>بدهکار</th><th>بستانکار</th></tr></thead><tbody>' +
                acc.unbalanced_entries.map(function (e) {
                  return '<tr><td>' + w.Fmt.toFaDigits(e.entry_no) + '</td><td>' + U.esc(U.jalali(e.date)) + '</td>' +
                    '<td class="name">' + U.esc(e.description) + '</td><td class="money">' + U.money(e.d) + '</td>' +
                    '<td class="money">' + U.money(e.c) + '</td></tr>';
                }).join('') + '</tbody></table></div></div>'
              : '<div class="alert success">همه اسناد حسابداری تراز هستند و هیچ مغایرتی وجود ندارد.</div>');
        }

        U.enhance(box);
      }

      w.Comp.bindExport(root, function () {
        const map = {
          journal: {
            title: 'دفتر روزنامه', filename: 'journal', landscape: true,
            columns: [
              { header: 'سند', key: 'entry_no' }, { header: 'تاریخ', key: 'date_j' },
              { header: 'شرح', key: 'entry_desc', align: 'right' }, { header: 'کد حساب', key: 'account_code' },
              { header: 'نام حساب', key: 'account_name', align: 'right' },
              { header: 'بدهکار', key: 'debit', money: true }, { header: 'بستانکار', key: 'credit', money: true }
            ],
            totals: {
              entry_no: 'جمع',
              debit: rows.reduce(function (a, r) { return a + (r.debit || 0); }, 0),
              credit: rows.reduce(function (a, r) { return a + (r.credit || 0); }, 0)
            }
          },
          ledger: {
            title: 'دفتر کل', filename: 'ledger',
            columns: [
              { header: 'تاریخ', key: 'date_j' }, { header: 'سند', key: 'entry_no' },
              { header: 'شرح', key: 'description', align: 'right' }, { header: 'مرجع', key: 'ref_no' },
              { header: 'بدهکار', key: 'debit', money: true }, { header: 'بستانکار', key: 'credit', money: true },
              { header: 'مانده', key: 'balance', money: true }
            ]
          },
          trial: {
            title: 'تراز آزمایشی', filename: 'trial-balance',
            columns: [
              { header: 'کد', key: 'code' }, { header: 'نام حساب', key: 'name', align: 'right' },
              { header: 'گردش بدهکار', key: 'debit', money: true }, { header: 'گردش بستانکار', key: 'credit', money: true },
              { header: 'مانده بدهکار', key: 'debit_balance', money: true }, { header: 'مانده بستانکار', key: 'credit_balance', money: true }
            ],
            totals: {
              code: 'جمع',
              debit: rows.reduce(function (a, r) { return a + (r.debit || 0); }, 0),
              credit: rows.reduce(function (a, r) { return a + (r.credit || 0); }, 0)
            }
          },
          sheet: {
            title: 'ترازنامه', filename: 'balance-sheet',
            columns: [
              { header: 'گروه', key: 'group' }, { header: 'حساب', key: 'name', align: 'right' },
              { header: 'مبلغ', key: 'balance', money: true }
            ]
          },
          chart: {
            title: 'کدینگ حساب‌ها', filename: 'chart-of-accounts',
            columns: [
              { header: 'کد', key: 'code' }, { header: 'نام حساب', key: 'name', align: 'right' },
              { header: 'نوع', key: 'type' }, { header: 'ماهیت', key: 'side' }
            ]
          },
          health: { title: 'بررسی سلامت', filename: 'health', columns: [], rows: [] }
        };
        const cfg = map[tab] || map.journal;
        cfg.rows = rows;
        cfg.subtitle = 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to);
        return cfg;
      });

      renderBar();
      await load();
    }
  };
})(window);
