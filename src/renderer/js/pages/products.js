'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  async function productForm(product) {
    const [cats, units, nextCode] = await Promise.all([
      API.call('products.categories', {}),
      API.call('products.units', {}),
      product ? Promise.resolve(null) : API.call('products.nextCode', {})
    ]);
    const p = product || {};
    const body =
      '<div class="row"><div class="field"><label class="req">نام کالا</label>' +
      '<input type="text" name="name" value="' + U.esc(p.name || '') + '" autofocus></div></div>' +
      '<div class="row"><div class="field"><label>کد کالا</label>' +
      '<input type="text" name="code" class="ltr" value="' + U.esc(p.code || nextCode || '') + '"></div>' +
      '<div class="field"><label>بارکد</label><input type="text" name="barcode" class="ltr" value="' + U.esc(p.barcode || '') + '" placeholder="با بارکدخوان اسکن کنید"></div>' +
      '</div>' +
      '<div class="row"><div class="field"><label>دسته‌بندی</label><select name="category_id">' +
      '<option value="">— بدون دسته —</option>' +
      cats.map(function (c) {
        return '<option value="' + c.id + '"' + (String(p.category_id) === String(c.id) ? ' selected' : '') + '>' + U.esc(c.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>واحد</label><select name="unit">' +
      units.map(function (u) {
        return '<option value="' + U.esc(u) + '"' + ((p.unit || 'عدد') === u ? ' selected' : '') + '>' + U.esc(u) + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="row"><div class="field"><label>قیمت خرید</label><input type="text" name="purchase_price" class="money" value="' + U.money(p.purchase_price || 0) + '"></div>' +
      '<div class="field"><label>قیمت فروش</label><input type="text" name="sale_price" class="money" value="' + U.money(p.sale_price || 0) + '"></div>' +
      '<div class="field"><label>حداقل موجودی</label><input type="text" name="min_stock" class="num" value="' + U.qty(p.min_stock || 0) + '"></div></div>' +
      (product
        ? '<div class="alert info">موجودی فعلی: <b>' + U.qty(p.stock_qty) + ' ' + U.esc(p.unit) + '</b> — ارزش: <b>' + U.moneyc(p.stock_value) +
          '</b><br>برای تغییر موجودی از بخش «انبار و موجودی» استفاده کنید تا سند حسابداری صحیح صادر شود.</div>'
        : '<div class="row"><div class="field"><label>موجودی اولیه</label><input type="text" name="opening_qty" class="num" value="0"></div>' +
          '<div class="field"><label>بهای تمام‌شده هر واحد</label><input type="text" name="opening_cost" class="money" value="0">' +
          '<div class="hint">اگر خالی بماند، قیمت خرید استفاده می‌شود.</div></div></div>') +
      '<div class="field"><label>توضیحات</label><textarea name="description">' + U.esc(p.description || '') + '</textarea></div>' +
      '<label class="checkbox"><input type="checkbox" name="active"' + (p.active === 0 ? '' : ' checked') + '> کالا فعال است</label>';

    return U.modal({
      title: product ? 'ویرایش کالا: ' + product.name : 'کالای جدید',
      size: 'lg',
      body: body,
      buttons: [
        {
          label: 'ذخیره', cls: 'btn', onClick: async function (m) {
            const data = {
              name: U.val(m, 'name').trim(),
              code: U.val(m, 'code').trim(),
              barcode: U.val(m, 'barcode').trim(),
              category_id: U.val(m, 'category_id') || null,
              unit: U.val(m, 'unit'),
              purchase_price: U.valMoney(m, 'purchase_price'),
              sale_price: U.valMoney(m, 'sale_price'),
              min_stock: U.valNum(m, 'min_stock'),
              description: U.val(m, 'description'),
              active: U.val(m, 'active')
            };
            if (!data.name) { U.toast('نام کالا الزامی است.', 'warn'); return false; }
            if (!product) {
              data.opening_qty = U.valNum(m, 'opening_qty');
              data.opening_cost = U.valMoney(m, 'opening_cost');
            }
            try {
              if (product) await API.call('products.update', { id: product.id, data: data });
              else await API.call('products.create', { data: data });
              U.toast('کالا ذخیره شد.', 'success');
              return true;
            } catch (e) { U.toast(e.message, 'error'); return false; }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) { U.enhance(m); }
    });
  }

  async function categoriesModal() {
    async function body() {
      const cats = await API.call('products.categories', {});
      return '<div class="row tight mb"><input type="text" id="newCat" placeholder="نام دسته جدید">' +
        '<button class="btn sm" id="addCat" style="flex:0 0 auto">افزودن</button></div>' +
        '<table class="data"><thead><tr><th class="name">نام دسته</th><th>تعداد کالا</th><th>عملیات</th></tr></thead><tbody>' +
        (cats.length ? cats.map(function (c) {
          return '<tr><td class="name">' + U.esc(c.name) + '</td><td>' + U.qty(c.product_count) + '</td>' +
            '<td class="actions"><button class="btn ghost sm" data-edit="' + c.id + '" data-name="' + U.esc(c.name) + '">ویرایش</button>' +
            '<button class="btn ghost sm" data-del="' + c.id + '">حذف</button></td></tr>';
        }).join('') : U.emptyRow(3, 'دسته‌ای ثبت نشده است.')) + '</tbody></table>';
    }
    const html = await body();
    return U.modal({
      title: 'دسته‌بندی کالاها',
      body: html,
      buttons: [{ label: 'بستن', value: true, cls: 'secondary' }],
      onOpen: function (m) {
        const refresh = async function () { m.querySelector('.modal-body').innerHTML = await body(); };
        m.addEventListener('click', async function (e) {
          if (e.target.id === 'addCat') {
            const v = m.querySelector('#newCat').value.trim();
            if (!v) return;
            await API.safe('products.createCategory', { name: v });
            await refresh();
          }
          const ed = e.target.closest('[data-edit]');
          if (ed) {
            const name = await U.prompt({ title: 'ویرایش دسته', label: 'نام دسته', value: ed.dataset.name });
            if (name) { await API.safe('products.updateCategory', { id: parseInt(ed.dataset.edit, 10), name: name }); await refresh(); }
          }
          const del = e.target.closest('[data-del]');
          if (del) {
            if (await U.confirm('این دسته حذف شود؟', { danger: true })) {
              const r = await API.safe('products.removeCategory', { id: parseInt(del.dataset.del, 10) });
              if (r) await refresh();
            }
          }
        });
      }
    });
  }

  w.Pages.products = {
    title: 'کالاها',
    render: async function (root, ctx) {
      const state = { search: '', category_id: '', active: '1', order: 'name', lowStock: false, offset: 0, limit: 100 };

      root.innerHTML =
        '<div class="toolbar">' +
        '<div class="field f-lg"><label>جست‌وجو</label><input type="search" id="q" placeholder="نام، کد یا بارکد"></div>' +
        '<div class="field f-md"><label>دسته</label><select id="cat"><option value="">همه</option></select></div>' +
        '<div class="field f-sm"><label>وضعیت</label><select id="act"><option value="1">فعال</option><option value="0">غیرفعال</option><option value="">همه</option></select></div>' +
        '<div class="field f-sm"><label>مرتب‌سازی</label><select id="ord">' +
        '<option value="name">نام</option><option value="stock">موجودی</option><option value="price">قیمت</option><option value="newest">جدیدترین</option></select></div>' +
        '<label class="checkbox" style="margin-bottom:7px"><input type="checkbox" id="low"> فقط رو به اتمام</label>' +
        '<span class="spacer"></span>' +
        '<button class="btn" id="add">+ کالای جدید</button>' +
        '<button class="btn secondary" id="cats">دسته‌بندی‌ها</button>' +
        '<button class="btn secondary sm" data-export-excel>خروجی اکسل</button>' +
        '<button class="btn secondary sm" data-export-print>چاپ</button>' +
        '</div>' +
        '<div class="card"><div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl">' +
        '<thead><tr><th>کد</th><th class="name">نام کالا</th><th>دسته</th><th>واحد</th>' +
        '<th>موجودی</th><th>بهای میانگین</th><th>قیمت خرید</th><th>قیمت فروش</th><th>ارزش موجودی</th><th>وضعیت</th><th>عملیات</th>' +
        '</tr></thead><tbody></tbody></table></div></div>' +
        '<div class="card-head"><span class="small muted" id="cnt"></span><span class="spacer"></span>' +
        '<button class="btn ghost sm" id="more">نمایش بیشتر</button></div></div>';

      const cats = await API.call('products.categories', {});
      root.querySelector('#cat').innerHTML = '<option value="">همه</option>' +
        cats.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.name) + '</option>'; }).join('');

      let rows = [];

      async function load(append) {
        if (!append) state.offset = 0;
        const list = await API.call('products.list', state);
        rows = append ? rows.concat(list) : list;
        const total = await API.call('products.count', { search: state.search, active: state.active });
        root.querySelector('#cnt').textContent = 'نمایش ' + w.Fmt.toFaDigits(rows.length) + ' از ' + w.Fmt.toFaDigits(total) + ' کالا';
        root.querySelector('#more').style.display = rows.length < total ? '' : 'none';
        draw();
      }

      function draw() {
        const tb = root.querySelector('#tbl tbody');
        if (!rows.length) { tb.innerHTML = U.emptyRow(11, 'کالایی یافت نشد.', '📦'); return; }
        tb.innerHTML = rows.map(function (p) {
          const low = p.min_stock > 0 && p.stock_qty <= p.min_stock;
          return '<tr data-id="' + p.id + '">' +
            '<td class="small">' + U.esc(p.code || '') + '</td>' +
            '<td class="name"><b>' + U.esc(p.name) + '</b>' + (p.barcode ? '<div class="small muted">' + U.esc(p.barcode) + '</div>' : '') + '</td>' +
            '<td class="small">' + U.esc(p.category_name || '—') + '</td>' +
            '<td class="small">' + U.esc(p.unit) + '</td>' +
            '<td class="' + (low ? 'money-neg bold' : '') + '">' + U.qty(p.stock_qty) + (low ? ' ⚠' : '') + '</td>' +
            '<td class="money">' + U.money(p.avg_cost) + '</td>' +
            '<td class="money">' + U.money(p.purchase_price) + '</td>' +
            '<td class="money bold">' + U.money(p.sale_price) + '</td>' +
            '<td class="money">' + U.money(p.stock_value) + '</td>' +
            '<td><span class="tag ' + (p.active ? 'green' : 'gray') + '">' + (p.active ? 'فعال' : 'غیرفعال') + '</span></td>' +
            '<td class="actions">' +
            '<button class="btn ghost sm" data-edit>ویرایش</button>' +
            '<button class="btn ghost sm" data-card>کاردکس</button>' +
            '<button class="btn ghost sm" data-del>حذف</button></td></tr>';
        }).join('');
      }

      const doSearch = U.debounce(function () { state.search = root.querySelector('#q').value.trim(); load(); }, 250);
      root.querySelector('#q').addEventListener('input', doSearch);
      root.querySelector('#cat').addEventListener('change', function () { state.category_id = this.value; load(); });
      root.querySelector('#act').addEventListener('change', function () { state.active = this.value; load(); });
      root.querySelector('#ord').addEventListener('change', function () { state.order = this.value; load(); });
      root.querySelector('#low').addEventListener('change', function () { state.lowStock = this.checked; load(); });
      root.querySelector('#more').addEventListener('click', function () { state.offset += state.limit; load(true); });
      root.querySelector('#add').addEventListener('click', async function () { if (await productForm(null)) load(); });
      root.querySelector('#cats').addEventListener('click', async function () {
        await categoriesModal();
        const c = await API.call('products.categories', {});
        root.querySelector('#cat').innerHTML = '<option value="">همه</option>' +
          c.map(function (x) { return '<option value="' + x.id + '">' + U.esc(x.name) + '</option>'; }).join('');
        load();
      });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = parseInt(tr.dataset.id, 10);
        if (e.target.closest('[data-edit]')) {
          const p = await API.call('products.get', { id: id });
          if (await productForm(p)) load();
        } else if (e.target.closest('[data-card]')) {
          App.go('inventory', { productId: id });
        } else if (e.target.closest('[data-del]')) {
          const p = rows.find(function (x) { return x.id === id; });
          if (!await U.confirm('کالای «' + p.name + '» حذف شود؟', { danger: true, detail: 'اگر کالا در اسناد استفاده شده باشد، حذف نمی‌شود و می‌توانید آن را غیرفعال کنید.' })) return;
          try {
            await API.call('products.remove', { id: id });
            U.toast('کالا حذف شد.', 'success');
            load();
          } catch (err) {
            if (await U.confirm(err.message + '\n\nآیا کالا غیرفعال شود؟')) {
              await API.safe('products.deactivate', { id: id });
              load();
            }
          }
        }
      });

      w.Comp.bindExport(root, function () {
        return {
          title: 'فهرست کالاها', filename: 'products',
          columns: [
            { header: 'کد', key: 'code' }, { header: 'نام کالا', key: 'name', align: 'right' },
            { header: 'دسته', key: 'category_name' }, { header: 'واحد', key: 'unit' },
            { header: 'موجودی', key: 'stock_qty' }, { header: 'قیمت خرید', key: 'purchase_price', money: true },
            { header: 'قیمت فروش', key: 'sale_price', money: true }, { header: 'ارزش موجودی', key: 'stock_value', money: true }
          ],
          rows: rows,
          totals: { name: 'جمع', stock_value: rows.reduce(function (a, r) { return a + r.stock_value; }, 0) }
        };
      });

      await load();
      if (ctx.params && ctx.params.focusId) {
        const p = await API.call('products.get', { id: ctx.params.focusId });
        if (p) productForm(p).then(function (r) { if (r) load(); });
      }
    }
  };

  w.ProductForm = productForm;
})(window);
