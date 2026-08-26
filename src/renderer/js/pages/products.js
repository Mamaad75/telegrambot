/* مدیریت کالاها */
(function (global) {
  'use strict';
  const { h, fmt, call, guard, parseNumber } = global.U;

  async function editProduct(product, onSaved) {
    const isNew = !product;
    const p = product || {};
    const cats = await call('products.categories', { kind: 'product' });
    const name = h('input', { type: 'text', value: p.name || '' });
    const code = h('input', { type: 'text', value: p.code || '' });
    const barcode = h('input', { type: 'text', class: 'num', value: p.barcode || '' });
    const unit = h('input', { type: 'text', value: p.unit || 'عدد' });
    const buy = global.UI.moneyInput({ value: p.buy_price || 0, hideHint: true });
    const sell = global.UI.moneyInput({ value: p.sell_price || 0, hideHint: true });
    const minStock = h('input', { type: 'text', class: 'num', value: p.min_stock || 0 });
    const stock = h('input', { type: 'text', class: 'num', value: 0 });
    const desc = h('textarea', { rows: 2, value: p.description || '' });
    const active = h('input', { type: 'checkbox' });
    active.checked = isNew ? true : !!p.active;
    const category = global.UI.select(
      [{ value: '', label: '—' }].concat(cats.map((c) => ({ value: c.id, label: c.name }))),
      p.category_id || '',
    );

    const content = h('div', {}, [
      h('div', { class: 'form-row c2' }, [
        global.UI.field('نام کالا *', name),
        global.UI.field('دسته‌بندی', category),
      ]),
      h('div', { class: 'form-row c3' }, [
        global.UI.field('کد کالا', code),
        global.UI.field('بارکد', barcode, 'با بارکدخوان قابل اسکن است'),
        global.UI.field('واحد', unit),
      ]),
      h('div', { class: 'form-row c3' }, [
        global.UI.field('قیمت خرید', buy),
        global.UI.field('قیمت فروش', sell),
        global.UI.field('حداقل موجودی', minStock, 'برای هشدار کمبود موجودی'),
      ]),
      isNew ? h('div', { class: 'form-row c2' }, [
        global.UI.field('موجودی اولیه', stock, 'به عنوان «موجودی اول دوره» ثبت می‌شود'),
        h('div'),
      ]) : null,
      global.UI.field('توضیحات', desc),
      h('label', { class: 'check', style: 'margin-top:10px' }, [active, h('span', { text: 'کالای فعال' })]),
    ]);

    global.UI.modal({
      title: isNew ? 'کالای جدید' : 'ویرایش کالا',
      content,
      buttons: [{
        label: 'ذخیره',
        kind: 'primary',
        action: guard(async (api) => {
          if (!name.value.trim()) { global.UI.toast('نام کالا الزامی است.', 'warn'); return; }
          const payload = {
            name: name.value.trim(),
            code: code.value.trim(),
            barcode: barcode.value.trim(),
            category_id: category.value || null,
            unit: unit.value.trim() || 'عدد',
            buy_price: buy.value,
            sell_price: sell.value,
            min_stock: parseNumber(minStock.value),
            description: desc.value.trim(),
            active: active.checked ? 1 : 0,
          };
          if (isNew) {
            payload.stock = parseNumber(stock.value);
            payload.opening_cost = buy.value;
            await call('products.create', payload);
            global.UI.toast('کالا ثبت شد.', 'ok');
          } else {
            await call('products.update', { id: p.id, ...payload });
            global.UI.toast('کالا به‌روزرسانی شد.', 'ok');
          }
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  async function adjustStock(product, onSaved) {
    const mode = global.UI.select([
      { value: 'set', label: 'ثبت موجودی واقعی (انبارگردانی)' },
      { value: 'in', label: 'افزایش موجودی' },
      { value: 'out', label: 'کاهش موجودی' },
    ], 'set');
    const qty = h('input', { type: 'text', class: 'num', value: fmt.raw(product.stock) });
    const cost = global.UI.moneyInput({ value: Math.round(product.avg_cost || product.buy_price || 0), hideHint: true });
    const dateInput = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const desc = h('input', { type: 'text', placeholder: 'علت اصلاح (مثلاً ضایعات، مغایرت شمارش)' });
    mode.addEventListener('change', () => { qty.value = mode.value === 'set' ? fmt.raw(product.stock) : '1'; });

    global.UI.modal({
      title: `اصلاح موجودی — ${product.name}`,
      size: 'narrow',
      content: h('div', {}, [
        h('div', { class: 'stat', style: 'margin-bottom:12px' }, [
          h('div', { class: 'label', text: 'موجودی فعلی' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.qty(product.stock) }), h('small', { text: product.unit })]),
          h('div', { class: 'sub', text: `بهای میانگین: ${fmt.plain(product.avg_cost || 0)}` }),
        ]),
        global.UI.field('نوع اصلاح', mode),
        h('div', { style: 'height:10px' }),
        global.UI.field('تعداد', qty),
        h('div', { style: 'height:10px' }),
        global.UI.field('بهای هر واحد (برای افزایش)', cost),
        h('div', { style: 'height:10px' }),
        global.UI.field('تاریخ', dateInput),
        h('div', { style: 'height:10px' }),
        global.UI.field('شرح', desc),
      ]),
      buttons: [{
        label: 'ثبت اصلاح',
        kind: 'primary',
        action: guard(async (api) => {
          await call('products.adjust', {
            productId: product.id,
            mode: mode.value,
            qty: parseNumber(qty.value),
            unitCost: cost.value,
            date: dateInput.value,
            description: desc.value.trim() || 'اصلاح موجودی',
          });
          global.UI.toast('موجودی اصلاح شد و سند حسابداری ثبت گردید.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  async function render(view) {
    let query = ''; let sort = 'name'; let lowOnly = false; let showInactive = false;
    const searchInput = h('input', { type: 'search', placeholder: 'نام، کد یا بارکد کالا...' });
    searchInput.addEventListener('input', global.U.debounce(() => { query = searchInput.value.trim(); load(); }, 250));
    const sortSelect = global.UI.select([
      { value: 'name', label: 'نام کالا' },
      { value: 'stock', label: 'موجودی' },
      { value: 'sell', label: 'قیمت فروش' },
      { value: 'newest', label: 'جدیدترین' },
    ], sort, (v) => { sort = v; load(); });
    const lowCheck = h('input', { type: 'checkbox' });
    lowCheck.addEventListener('change', () => { lowOnly = lowCheck.checked; load(); });
    const inactiveCheck = h('input', { type: 'checkbox' });
    inactiveCheck.addEventListener('change', () => { showInactive = inactiveCheck.checked; load(); });

    const listBox = h('div');
    const statsBox = h('div');

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [
      h('header', {}, [
        h('h2', { text: 'کالاها' }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', text: '+ کالای جدید', onclick: () => editProduct(null, load) }),
      ]),
      h('div', { class: 'body' }, [
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'field', style: 'flex:1;min-width:240px' }, [h('label', { text: 'جست‌وجو' }), searchInput]),
          global.UI.field('مرتب‌سازی', sortSelect),
          h('label', { class: 'check', style: 'margin-bottom:8px' }, [lowCheck, h('span', { text: 'فقط کمبود موجودی' })]),
          h('label', { class: 'check', style: 'margin-bottom:8px' }, [inactiveCheck, h('span', { text: 'نمایش غیرفعال‌ها' })]),
        ]),
        statsBox,
      ]),
    ]));
    view.appendChild(h('div', { class: 'panel' }, [h('div', { class: 'body tight' }, [listBox])]));

    const load = guard(async () => {
      listBox.innerHTML = '';
      listBox.appendChild(global.UI.loading());
      const data = await call('products.list', {
        q: query, sort, lowStock: lowOnly, onlyActive: !showInactive, limit: 500,
      });
      const totalValue = data.rows.reduce((a, x) => a + x.stock_value, 0);
      statsBox.innerHTML = '';
      statsBox.appendChild(h('div', { class: 'grid c3', style: 'margin-top:12px' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد اقلام' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.total) }), h('small', { text: 'قلم' })])]),
        h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'ارزش موجودی (نمایش فعلی)' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(totalValue) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'کمبود موجودی' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.rows.filter((x) => x.min_stock > 0 && x.stock <= x.min_stock).length) }), h('small', { text: 'کالا' })])]),
      ]));

      listBox.innerHTML = '';
      listBox.appendChild(global.UI.table({
        columns: [
          {
            title: 'نام کالا',
            render: (r) => h('div', {}, [
              h('b', { text: r.name }),
              r.active ? null : h('span', { class: 'tag mute', style: 'margin-inline-start:6px', text: 'غیرفعال' }),
              h('div', { class: 'muted', style: 'font-size:11.5px', text: [r.code, r.barcode, r.category_name].filter(Boolean).join(' · ') }),
            ]),
          },
          { title: 'واحد', key: 'unit', type: 'center' },
          { title: 'قیمت خرید', key: 'buy_price', type: 'money' },
          { title: 'قیمت فروش', key: 'sell_price', type: 'money' },
          { title: 'بهای میانگین', key: 'avg_cost', type: 'money', render: (r) => fmt.plain(Math.round(r.avg_cost)) },
          {
            title: 'موجودی',
            type: 'qty',
            render: (r) => h('span', {
              class: r.min_stock > 0 && r.stock <= r.min_stock ? 'neg' : '',
              text: fmt.qty(r.stock),
            }),
          },
          { title: 'ارزش موجودی', key: 'stock_value', type: 'money' },
          {
            title: 'عملیات',
            type: 'center',
            width: '200px',
            render: (r) => h('div', { class: 'row-actions' }, [
              h('button', { class: 'btn sm', text: 'ویرایش', onclick: () => editProduct(r, load) }),
              h('button', { class: 'btn sm', text: 'اصلاح موجودی', onclick: () => adjustStock(r, load) }),
              h('button', {
                class: 'btn sm danger',
                text: '✕',
                title: 'حذف / غیرفعال‌سازی',
                onclick: guard(async () => {
                  const okC = await global.UI.confirm(`کالای «${r.name}» حذف شود؟`, {
                    danger: true,
                    detail: 'اگر این کالا در فاکتورها استفاده شده باشد، فقط غیرفعال می‌شود.',
                  });
                  if (!okC) return;
                  const res = await call('products.remove', { id: r.id });
                  global.UI.toast(res.deleted ? 'کالا حذف شد.' : 'کالا غیرفعال شد (در اسناد استفاده شده است).', 'ok');
                  load();
                }),
              }),
            ]),
          },
        ],
        rows: data.rows,
        empty: 'کالایی ثبت نشده است. با دکمه «کالای جدید» شروع کنید.',
        emptyIcon: '📦',
        footer: { name: 'جمع ارزش', stock_value: totalValue },
      }));
    });

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.products = { title: 'کالاها', render, editProduct, adjustStock };
}(window));
