'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  async function adjustForm(product) {
    const body =
      '<div class="alert info">کالا: <b>' + U.esc(product.name) + '</b> — موجودی فعلی: <b>' +
      U.qty(product.stock_qty) + ' ' + U.esc(product.unit) + '</b> — ارزش: <b>' + U.moneyc(product.stock_value) + '</b></div>' +
      '<div class="row"><div class="field"><label>نوع اصلاح</label><select name="mode">' +
      '<option value="count">انبارگردانی (تعیین موجودی جدید)</option>' +
      '<option value="in">افزایش موجودی</option>' +
      '<option value="out">کاهش موجودی (ضایعات، مصرف داخلی)</option></select></div>' +
      U.dateField('date', U.today(), 'تاریخ') + '</div>' +
      '<div class="row"><div class="field"><label id="qtyLabel">موجودی شمارش‌شده</label>' +
      '<input type="text" name="qty" class="num" value="' + U.qty(product.stock_qty) + '"></div>' +
      '<div class="field" id="costField"><label>بهای هر واحد (برای افزایش)</label>' +
      '<input type="text" name="unit_cost" class="money" value="' + U.money(product.avg_cost || product.purchase_price) + '"></div></div>' +
      '<div class="field"><label>شرح</label><input type="text" name="description" value="اصلاح موجودی انبار"></div>' +
      '<div class="alert warn">اختلاف موجودی به عنوان کسری/اضافی انبار در حساب هزینه‌های عملیاتی ثبت می‌شود.</div>';

    return U.modal({
      title: 'اصلاح موجودی انبار',
      body: body,
      buttons: [
        {
          label: 'ثبت اصلاح', cls: 'btn', onClick: async function (m) {
            const mode = U.val(m, 'mode');
            const data = {
              product_id: product.id,
              date: U.getDate(m, 'date'),
              mode: mode,
              description: U.val(m, 'description'),
              unit_cost: U.valMoney(m, 'unit_cost')
            };
            if (mode === 'count') data.new_qty = U.valNum(m, 'qty');
            else data.qty = U.valNum(m, 'qty');
            try {
              const r = await API.call('inventory.adjust', { data: data });
              if (!r.changed) { U.toast('تغییری در موجودی ایجاد نشد.', 'warn'); return false; }
              U.toast('موجودی اصلاح شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        U.enhance(m);
        const sel = m.querySelector('[name="mode"]');
        const label = m.querySelector('#qtyLabel');
        const qtyInput = m.querySelector('[name="qty"]');
        sel.addEventListener('change', function () {
          if (this.value === 'count') { label.textContent = 'موجودی شمارش‌شده'; qtyInput.value = U.qty(product.stock_qty); }
          else if (this.value === 'in') { label.textContent = 'تعداد افزایش'; qtyInput.value = '0'; }
          else { label.textContent = 'تعداد کاهش'; qtyInput.value = '0'; }
          m.querySelector('#costField').style.display = this.value === 'out' ? 'none' : '';
        });
      }
    });
  }

  w.Pages.inventory = {
    title: 'انبار و موجودی',
    render: async function (root, ctx) {
      const range = w.Jalali.range('month');
      const state = { from: range.from, to: range.to, product_id: (ctx.params && ctx.params.productId) || '', move_type: '', limit: 500 };
      let tab = state.product_id ? 'moves' : 'stock';
      let valuation = [];
      let moves = [];

      root.innerHTML =
        '<div class="tabs">' +
        '<div class="tab' + (tab === 'stock' ? ' active' : '') + '" data-tab="stock">موجودی و ارزش انبار</div>' +
        '<div class="tab' + (tab === 'moves' ? ' active' : '') + '" data-tab="moves">گردش انبار (کاردکس)</div>' +
        '<div class="tab" data-tab="low">کالاهای رو به اتمام</div>' +
        '</div><div id="tabBody"></div>';

      root.querySelector('.tabs').addEventListener('click', function (e) {
        const t = e.target.closest('[data-tab]');
        if (!t) return;
        tab = t.dataset.tab;
        U.$$('.tab', root).forEach(function (x) { x.classList.toggle('active', x === t); });
        draw();
      });

      async function draw() {
        const box = root.querySelector('#tabBody');
        box.innerHTML = U.loading();
        if (tab === 'stock') await drawStock(box);
        else if (tab === 'moves') await drawMoves(box);
        else await drawLow(box);
        U.enhance(box);
      }

      async function drawStock(box) {
        valuation = await API.call('inventory.valuation', {});
        const total = valuation.reduce(function (a, r) { return a + r.stock_value; }, 0);
        const qty = valuation.reduce(function (a, r) { return a + r.stock_qty; }, 0);
        box.innerHTML =
          '<div class="toolbar"><div class="field f-lg"><label>جست‌وجو</label><input type="search" id="vq" placeholder="نام کالا"></div>' +
          '<span class="spacer"></span><button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
          '<button class="btn secondary sm" data-export-print>چاپ</button></div>' +
          '<div class="grid c3 mb">' +
          '<div class="stat accent"><div class="label">تعداد اقلام</div><div class="value">' + w.Fmt.toFaDigits(valuation.length) + '</div></div>' +
          '<div class="stat accent"><div class="label">مجموع تعداد موجودی</div><div class="value">' + U.qty(qty) + '</div></div>' +
          '<div class="stat accent-green"><div class="label">ارزش کل موجودی انبار</div><div class="value money">' + U.money(total) + '</div></div>' +
          '</div>' +
          '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="vtbl"><thead><tr>' +
          '<th>کد</th><th class="name">نام کالا</th><th>دسته</th><th>واحد</th><th>موجودی</th>' +
          '<th>بهای میانگین</th><th>ارزش موجودی</th><th>قیمت فروش</th><th>عملیات</th></tr></thead><tbody></tbody>' +
          '<tfoot><tr><td colspan="6">جمع</td><td class="money">' + U.money(total) + '</td><td colspan="2"></td></tr></tfoot></table></div></div></div>';

        function fill(filter) {
          const list = filter ? valuation.filter(function (r) { return (r.name + ' ' + (r.code || '')).indexOf(filter) !== -1; }) : valuation;
          box.querySelector('#vtbl tbody').innerHTML = list.length ? list.map(function (r) {
            return '<tr data-id="' + r.id + '"><td class="small">' + U.esc(r.code || '') + '</td>' +
              '<td class="name">' + U.esc(r.name) + '</td><td class="small">' + U.esc(r.category_name || '—') + '</td>' +
              '<td class="small">' + U.esc(r.unit) + '</td>' +
              '<td class="bold">' + U.qty(r.stock_qty) + '</td>' +
              '<td class="money">' + U.money(Math.round(r.avg_cost)) + '</td>' +
              '<td class="money bold">' + U.money(r.stock_value) + '</td>' +
              '<td class="money">' + U.money(r.sale_price) + '</td>' +
              '<td class="actions"><button class="btn ghost sm" data-kardex>کاردکس</button>' +
              '<button class="btn ghost sm" data-adjust>اصلاح</button></td></tr>';
          }).join('') : U.emptyRow(9, 'کالایی یافت نشد.', '🏬');
        }
        fill('');
        box.querySelector('#vq').addEventListener('input', U.debounce(function () { fill(this.value.trim()); }, 200));

        box.querySelector('#vtbl').addEventListener('click', async function (e) {
          const tr = e.target.closest('tr[data-id]');
          if (!tr) return;
          const id = parseInt(tr.dataset.id, 10);
          if (e.target.closest('[data-adjust]')) {
            const p = await API.call('products.get', { id: id });
            if (await adjustForm(p)) draw();
          } else if (e.target.closest('[data-kardex]')) {
            state.product_id = id;
            tab = 'moves';
            U.$$('.tab', root).forEach(function (x) { x.classList.toggle('active', x.dataset.tab === 'moves'); });
            draw();
          }
        });

        w.Comp.bindExport(box, function () {
          return {
            title: 'موجودی و ارزش انبار', filename: 'inventory',
            columns: [
              { header: 'کد', key: 'code' }, { header: 'نام کالا', key: 'name', align: 'right' },
              { header: 'واحد', key: 'unit' }, { header: 'موجودی', key: 'stock_qty' },
              { header: 'بهای میانگین', key: 'avg_cost', money: true }, { header: 'ارزش', key: 'stock_value', money: true }
            ],
            rows: valuation, totals: { name: 'جمع', stock_value: total }
          };
        });
      }

      async function drawMoves(box) {
        const products = await API.call('products.list', { limit: 1000, active: '' });
        box.innerHTML =
          '<div class="toolbar"><div id="rangeBar" style="width:100%"></div>' +
          '<div class="field f-lg"><label>کالا</label><select id="prod"><option value="">همه کالاها</option>' +
          products.map(function (p) {
            return '<option value="' + p.id + '"' + (String(state.product_id) === String(p.id) ? ' selected' : '') + '>' + U.esc(p.name) + '</option>';
          }).join('') + '</select></div>' +
          '<div class="field f-md"><label>نوع حرکت</label><select id="mtype"><option value="">همه</option>' +
          Object.keys(App.info.constants.move_types).map(function (k) {
            return '<option value="' + k + '">' + U.esc(App.info.constants.move_types[k]) + '</option>';
          }).join('') + '</select></div>' +
          '<span class="spacer"></span><button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
          '<button class="btn secondary sm" data-export-print>چاپ</button></div>' +
          '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="mtbl"><thead><tr>' +
          '<th>تاریخ</th><th class="name">کالا</th><th>نوع</th><th>ورود</th><th>خروج</th>' +
          '<th>بهای واحد</th><th>ارزش</th><th>موجودی پس از عملیات</th><th>مرجع</th><th class="name">شرح</th>' +
          '</tr></thead><tbody></tbody></table></div></div></div>';

        w.Comp.rangeBar({
          container: box.querySelector('#rangeBar'), kind: 'month',
          onChange: function (r) { state.from = r.from; state.to = r.to; loadMoves(); }
        });
        box.querySelector('#prod').addEventListener('change', function () { state.product_id = this.value; loadMoves(); });
        box.querySelector('#mtype').addEventListener('change', function () { state.move_type = this.value; loadMoves(); });

        async function loadMoves() {
          moves = await API.call('inventory.moves', state);
          box.querySelector('#mtbl tbody').innerHTML = moves.length ? moves.map(function (m) {
            return '<tr><td>' + U.esc(U.jalali(m.date)) + '</td>' +
              '<td class="name">' + U.esc(m.product_name) + '</td>' +
              '<td><span class="tag ' + (m.qty > 0 ? 'green' : 'orange') + '">' +
              U.esc(App.info.constants.move_types[m.move_type] || m.move_type) + '</span></td>' +
              '<td class="money-pos">' + (m.qty > 0 ? U.qty(m.qty) : '') + '</td>' +
              '<td class="money-neg">' + (m.qty < 0 ? U.qty(-m.qty) : '') + '</td>' +
              '<td class="money">' + U.money(Math.round(m.unit_cost)) + '</td>' +
              '<td class="money">' + U.money(m.value) + '</td>' +
              '<td class="bold">' + U.qty(m.balance_qty) + '</td>' +
              '<td class="small">' + U.esc(m.ref_no || '—') + '</td>' +
              '<td class="name small muted">' + U.esc(m.description || '') + '</td></tr>';
          }).join('') : U.emptyRow(10, 'گردشی در این بازه یافت نشد.', '📋');
        }
        await loadMoves();

        w.Comp.bindExport(box, function () {
          return {
            title: 'گردش انبار', filename: 'stock-moves', landscape: true,
            subtitle: 'از ' + U.jalali(state.from) + ' تا ' + U.jalali(state.to),
            columns: [
              { header: 'تاریخ', key: 'date_j' }, { header: 'کالا', key: 'product_name', align: 'right' },
              { header: 'نوع', key: 'type_label' }, { header: 'تعداد', key: 'qty' },
              { header: 'بهای واحد', key: 'unit_cost', money: true }, { header: 'ارزش', key: 'value', money: true },
              { header: 'موجودی', key: 'balance_qty' }, { header: 'مرجع', key: 'ref_no' }
            ],
            rows: moves.map(function (m) {
              return Object.assign({}, m, {
                date_j: U.jalali(m.date),
                type_label: App.info.constants.move_types[m.move_type] || m.move_type,
                unit_cost: Math.round(m.unit_cost)
              });
            })
          };
        });
      }

      async function drawLow(box) {
        const low = await API.call('inventory.lowStock', { limit: 500 });
        box.innerHTML =
          '<div class="card"><div class="card-head"><h3>کالاهایی که به حداقل موجودی رسیده‌اند</h3>' +
          '<span class="spacer"></span><span class="tag ' + (low.length ? 'red' : 'green') + '">' + w.Fmt.toFaDigits(low.length) + ' کالا</span></div>' +
          '<div class="card-body tight"><div class="table-wrap"><table class="data"><thead><tr>' +
          '<th>کد</th><th class="name">نام کالا</th><th>دسته</th><th>موجودی فعلی</th><th>حداقل</th><th>کمبود</th>' +
          '<th>قیمت خرید</th></tr></thead><tbody>' +
          (low.length ? low.map(function (p) {
            return '<tr><td class="small">' + U.esc(p.code || '') + '</td><td class="name">' + U.esc(p.name) + '</td>' +
              '<td class="small">' + U.esc(p.category_name || '—') + '</td>' +
              '<td class="money-neg bold">' + U.qty(p.stock_qty) + ' ' + U.esc(p.unit) + '</td>' +
              '<td>' + U.qty(p.min_stock) + '</td>' +
              '<td class="bold">' + U.qty(Math.max(0, p.min_stock - p.stock_qty)) + '</td>' +
              '<td class="money">' + U.money(p.purchase_price) + '</td></tr>';
          }).join('') : U.emptyRow(7, 'موجودی همه کالاها مناسب است.', '✅')) +
          '</tbody></table></div></div></div>';
      }

      await draw();
    }
  };
})(window);
