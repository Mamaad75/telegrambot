/* انبار: ارزش موجودی، گردش انبار و کمبودها */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  async function render(view) {
    let tab = 'valuation';
    const box = h('div');
    const tabs = global.UI.tabs([
      { key: 'valuation', title: 'موجودی و ارزش انبار' },
      { key: 'movements', title: 'گردش انبار' },
      { key: 'low', title: 'کمبود موجودی' },
    ], (k) => { tab = k; load(); });

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [tabs.el, h('div', { class: 'body' }, [box])]));

    const load = guard(async () => {
      box.innerHTML = '';
      box.appendChild(global.UI.loading());
      if (tab === 'valuation') await drawValuation();
      else if (tab === 'movements') await drawMovements();
      else await drawLow();
    });

    async function drawValuation() {
      const data = await call('inventory.valuation');
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c3', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'ارزش کل موجودی' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.totals.value) }), h('small', { text: global.U.state.currency })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد اقلام' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.totals.count) }), h('small', { text: 'قلم' })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'مجموع تعداد' }), h('div', { class: 'value num' }, [h('span', { text: fmt.qty(data.totals.qty) })])]),
      ]));
      box.appendChild(h('div', { class: 'inline', style: 'margin-bottom:10px' }, [
        h('button', {
          class: 'btn sm',
          text: '🖨 چاپ گزارش موجودی',
          onclick: guard(async () => {
            const html = global.Documents.report({
              title: 'گزارش موجودی و ارزش انبار',
              subtitle: `ارزش کل: ${fmt.plain(data.totals.value)} ${global.U.state.currency}`,
              columns: [
                { title: 'کالا', key: 'name' },
                { title: 'کد', key: 'code', type: 'center' },
                { title: 'موجودی', key: 'stock', type: 'qty' },
                { title: 'بهای میانگین', key: 'avg_cost', type: 'money' },
                { title: 'ارزش', key: 'stock_value', type: 'money' },
              ],
              rows: data.rows,
              totals: { stock_value: data.totals.value },
            }, global.U.state.settings);
            await global.Documents.print(html, 'گزارش موجودی انبار', 'a4');
          }),
        }),
      ]));
      box.appendChild(global.UI.table({
        columns: [
          { title: 'کالا', key: 'name' },
          { title: 'کد', key: 'code', type: 'center' },
          { title: 'واحد', key: 'unit', type: 'center' },
          { title: 'موجودی', key: 'stock', type: 'qty' },
          { title: 'بهای میانگین', type: 'money', render: (r) => fmt.plain(Math.round(r.avg_cost)) },
          { title: 'ارزش موجودی', key: 'stock_value', type: 'money' },
          { title: 'حداقل', key: 'min_stock', type: 'qty' },
          {
            title: 'وضعیت',
            type: 'center',
            render: (r) => (r.min_stock > 0 && r.stock <= r.min_stock
              ? h('span', { class: 'tag warn', text: 'نیاز به سفارش' })
              : h('span', { class: 'tag ok', text: 'عادی' })),
          },
        ],
        rows: data.rows,
        empty: 'کالایی ثبت نشده است.',
        footer: { name: 'جمع', stock_value: data.totals.value },
      }));
    }

    async function drawMovements() {
      const range = global.U.presetRange('month');
      const fromInput = global.UI.dateInput({ value: range.from, onChange: (v) => { range.from = v; refresh(); } });
      const toInput = global.UI.dateInput({ value: range.to, onChange: (v) => { range.to = v; refresh(); } });
      const productPicker = global.UI.autocomplete({
        placeholder: 'همه کالاها — برای فیلتر، کالا را انتخاب کنید',
        fetch: (q) => call('products.search', { q, limit: 12 }, { silent: true }),
        render: (r) => ({ title: r.name, meta: fmt.qty(r.stock) }),
        onPick: (r) => { selected = r; productPicker.input.value = r.name; refresh(); },
        keepText: true,
      });
      let selected = null;
      const tableBox = h('div');
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, [
        h('div', { class: 'field', style: 'flex:1;min-width:240px' }, [h('label', { text: 'کالا' }), productPicker.el]),
        global.UI.field('از تاریخ', fromInput),
        global.UI.field('تا تاریخ', toInput),
        h('button', {
          class: 'btn sm',
          style: 'margin-bottom:4px',
          text: 'حذف فیلتر کالا',
          onclick: () => { selected = null; productPicker.input.value = ''; refresh(); },
        }),
      ]));
      box.appendChild(tableBox);

      const refresh = guard(async () => {
        tableBox.innerHTML = '';
        tableBox.appendChild(global.UI.loading());
        const data = await call('inventory.movements', {
          from: range.from, to: range.to, productId: selected ? selected.id : null, limit: 500,
        });
        tableBox.innerHTML = '';
        tableBox.appendChild(global.UI.table({
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'کالا', key: 'product_name' },
            { title: 'نوع', type: 'center', render: (r) => h('span', { class: 'tag ' + (r.qty > 0 ? 'ok' : 'warn'), text: global.U.label('movement', r.type) }) },
            { title: 'تعداد', key: 'qty', type: 'qty' },
            { title: 'بهای واحد', type: 'money', render: (r) => fmt.plain(Math.round(r.unit_cost)) },
            { title: 'ارزش', key: 'value', type: 'money' },
            { title: 'موجودی پس از گردش', key: 'balance_qty', type: 'qty' },
            { title: 'ارزش موجودی', key: 'balance_value', type: 'money' },
            { title: 'شرح', key: 'description' },
          ],
          rows: data.rows,
          empty: 'گردشی در این بازه ثبت نشده است.',
          emptyIcon: '🔄',
        }));
      });
      await refresh();
    }

    async function drawLow() {
      const rows = await call('inventory.lowStock');
      box.innerHTML = '';
      box.appendChild(global.UI.table({
        columns: [
          { title: 'کالا', key: 'name' },
          { title: 'کد', key: 'code', type: 'center' },
          { title: 'موجودی', key: 'stock', type: 'qty' },
          { title: 'حداقل موجودی', key: 'min_stock', type: 'qty' },
          { title: 'کسری', type: 'qty', render: (r) => fmt.qty(Math.max(0, r.min_stock - r.stock)) },
          { title: 'قیمت فروش', key: 'sell_price', type: 'money' },
          {
            title: '',
            type: 'center',
            render: (r) => h('button', { class: 'btn sm primary', text: 'ثبت خرید', onclick: () => global.App.go('purchase') }),
          },
        ],
        rows,
        empty: 'همه کالاها موجودی کافی دارند.',
        emptyIcon: '✅',
      }));
    }

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.inventory = { title: 'انبار', render };
}(window));
