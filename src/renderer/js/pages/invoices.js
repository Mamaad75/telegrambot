/* فهرست و مدیریت فاکتورها */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  const TYPES = [
    { key: 'sale', title: 'فروش' },
    { key: 'purchase', title: 'خرید' },
    { key: 'sale_return', title: 'برگشت از فروش' },
    { key: 'purchase_return', title: 'برگشت از خرید' },
  ];

  async function showInvoice(id, reload) {
    const data = await call('invoices.get', { id });
    const inv = data.invoice;
    const s = global.U.state.settings;
    const content = h('div');

    content.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:14px' }, [
      h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'شماره فاکتور' }), h('div', { class: 'value', style: 'font-size:16px' }, [h('span', { text: inv.invoice_no })])]),
      h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تاریخ' }), h('div', { class: 'value', style: 'font-size:16px' }, [h('span', { text: fmt.date(inv.date) })])]),
      h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'مبلغ نهایی' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(inv.total) })])]),
      h('div', { class: 'stat ' + (inv.due > 0 ? 'bad' : 'ok') }, [h('div', { class: 'label', text: 'مانده' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(inv.due) })])]),
    ]));

    content.appendChild(global.UI.table({
      columns: [
        { title: 'کالا', key: 'product_name' },
        { title: 'تعداد', key: 'qty', type: 'qty' },
        { title: 'مبلغ واحد', key: 'unit_price', type: 'money' },
        { title: 'تخفیف', key: 'discount', type: 'money' },
        { title: 'مبلغ کل', key: 'line_total', type: 'money' },
        { title: 'بهای تمام‌شده', key: 'cost_total', type: 'money' },
      ],
      rows: data.items,
      footer: {
        product_name: 'جمع',
        line_total: data.items.reduce((a, x) => a + x.line_total, 0),
        cost_total: data.items.reduce((a, x) => a + x.cost_total, 0),
      },
    }));

    if (data.paymentLines.length) {
      content.appendChild(h('h4', { text: 'تسویه‌ها', style: 'margin:16px 0 6px' }));
      content.appendChild(global.UI.table({
        columns: [
          { title: 'روش', render: (r) => global.U.label('method', r.method), type: 'center' },
          { title: 'مبلغ', key: 'amount', type: 'money' },
          { title: 'چک', render: (r) => (r.check_number ? `${r.check_number} — ${r.check_bank || ''} (${fmt.date(r.check_due)})` : '—') },
        ],
        rows: data.paymentLines,
      }));
    }

    content.appendChild(h('h4', { text: 'اسناد حسابداری', style: 'margin:16px 0 6px' }));
    for (const e of data.entries) {
      content.appendChild(h('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:4px', text: `${e.entry_no} — ${e.description}` }));
      content.appendChild(global.UI.table({
        columns: [
          { title: 'کد', key: 'account', type: 'center', width: '70px' },
          { title: 'حساب', key: 'name' },
          { title: 'بدهکار', key: 'debit', type: 'money' },
          { title: 'بستانکار', key: 'credit', type: 'money' },
        ],
        rows: e.lines,
        footer: {
          name: 'جمع',
          debit: e.lines.reduce((a, x) => a + x.debit, 0),
          credit: e.lines.reduce((a, x) => a + x.credit, 0),
        },
      }));
      content.appendChild(h('div', { style: 'height:10px' }));
    }

    const buttons = [
      {
        label: '🖨 چاپ فاکتور',
        kind: 'primary',
        action: guard(async () => {
          await global.Documents.print(
            global.Documents.invoice(data, s, { size: s.print_size || 'a4' }),
            `${global.U.label('invoiceType', inv.type)} ${inv.invoice_no}`,
            s.print_size || 'a4',
          );
        }),
      },
      {
        label: '🧾 چاپ حرارتی',
        action: guard(async () => {
          await global.Documents.print(
            global.Documents.invoice(data, s, { size: 'thermal' }),
            `رسید ${inv.invoice_no}`, 'thermal',
          );
        }),
      },
    ];
    if (inv.status === 'posted' && (inv.type === 'sale' || inv.type === 'purchase')) {
      buttons.push({
        label: '↩ ثبت برگشتی',
        action: (api) => {
          api.close();
          global.App.go(inv.type === 'sale' ? 'sale_return' : 'purchase_return', { refInvoiceId: inv.id });
        },
      });
      buttons.push({
        label: '✖ ابطال فاکتور',
        kind: 'danger',
        action: guard(async (api) => {
          const okConfirm = await global.UI.confirm(
            `فاکتور ${inv.invoice_no} ابطال شود؟`,
            {
              danger: true,
              detail: 'موجودی انبار، اسناد حسابداری و تسویه‌های این فاکتور به طور کامل برگشت داده می‌شود.',
              okLabel: 'بله، ابطال کن',
            },
          );
          if (!okConfirm) return;
          await call('invoices.void', { id: inv.id, reason: '' });
          global.UI.toast('فاکتور ابطال شد.', 'ok');
          api.close();
          if (reload) reload();
        }),
      });
    }

    global.UI.modal({
      title: `${global.U.label('invoiceType', inv.type)} — ${inv.invoice_no}${inv.status === 'void' ? ' (ابطال‌شده)' : ''}`,
      size: 'wide',
      content,
      buttons,
      cancelLabel: 'بستن',
    });
  }

  async function render(view, params) {
    let type = (params && params.type) || 'sale';
    let range = global.U.presetRange('month');
    let query = '';
    let onlyUnpaid = false;

    const searchInput = h('input', { type: 'search', placeholder: 'شماره فاکتور، نام طرف حساب یا توضیحات...' });
    searchInput.addEventListener('input', global.U.debounce(() => { query = searchInput.value.trim(); load(); }, 300));
    const fromInput = global.UI.dateInput({ value: range.from, onChange: (v) => { range.from = v; load(); } });
    const toInput = global.UI.dateInput({ value: range.to, onChange: (v) => { range.to = v; load(); } });
    const unpaidCheck = h('input', { type: 'checkbox' });
    unpaidCheck.addEventListener('change', () => { onlyUnpaid = unpaidCheck.checked; load(); });

    const typeTabs = global.UI.tabs(TYPES, (k) => { type = k; load(); });
    typeTabs.active = type;
    const listBox = h('div');
    const summaryBox = h('div');

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [
      typeTabs.el,
      h('div', { class: 'body' }, [
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'field', style: 'flex:1;min-width:260px' }, [h('label', { text: 'جست‌وجو' }), searchInput]),
          global.UI.field('از تاریخ', fromInput),
          global.UI.field('تا تاریخ', toInput),
          h('label', { class: 'check', style: 'margin-bottom:8px' }, [unpaidCheck, h('span', { text: 'فقط دارای مانده' })]),
          h('button', { class: 'btn sm', style: 'margin-bottom:4px', text: 'کل دوره‌ها', onclick: () => { range = { from: '', to: '' }; fromInput.value = ''; toInput.value = ''; load(); } }),
        ]),
        summaryBox,
      ]),
    ]));
    view.appendChild(h('div', { class: 'panel' }, [h('div', { class: 'body tight' }, [listBox])]));

    const load = guard(async () => {
      listBox.innerHTML = '';
      listBox.appendChild(global.UI.loading());
      const data = await call('invoices.list', {
        type, from: range.from, to: range.to, q: query, onlyUnpaid, limit: 300,
      });
      summaryBox.innerHTML = '';
      summaryBox.appendChild(h('div', { class: 'grid c4', style: 'margin-top:12px' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد فاکتور' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.summary.c) }), h('small', { text: 'فقره' })])]),
        h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'مبلغ کل' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.summary.total) })])]),
        h('div', { class: 'stat ok' }, [h('div', { class: 'label', text: 'تسویه‌شده' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.summary.paid) })])]),
        h('div', { class: 'stat ' + (data.summary.due ? 'bad' : '') }, [h('div', { class: 'label', text: 'مانده' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.summary.due) })])]),
      ]));

      listBox.innerHTML = '';
      listBox.appendChild(global.UI.table({
        columns: [
          { title: 'شماره', key: 'invoice_no', type: 'center' },
          { title: 'تاریخ', key: 'date', type: 'date' },
          { title: 'طرف حساب', render: (r) => r.party_name || 'متفرقه' },
          { title: 'مبلغ کل', key: 'total', type: 'money' },
          { title: 'تخفیف', key: 'discount_total', type: 'money' },
          { title: 'ارزش افزوده', key: 'vat', type: 'money' },
          { title: 'پرداخت‌شده', key: 'paid', type: 'money' },
          { title: 'مانده', key: 'due', type: 'money' },
          {
            title: 'وضعیت',
            type: 'center',
            render: (r) => h('span', {
              class: 'tag ' + (r.status === 'void' ? 'bad' : (r.due > 0 ? 'warn' : 'ok')),
              text: r.status === 'void' ? 'ابطال‌شده' : (r.due > 0 ? 'دارای مانده' : 'تسویه'),
            }),
          },
          {
            title: '',
            type: 'center',
            width: '90px',
            render: (r) => h('button', { class: 'btn sm', text: 'مشاهده', onclick: () => showInvoice(r.id, load) }),
          },
        ],
        rows: data.rows,
        onRowClick: (r) => showInvoice(r.id, load),
        empty: 'فاکتوری در این بازه ثبت نشده است.',
        emptyIcon: '🧾',
        footer: {
          invoice_no: 'جمع',
          total: data.summary.total,
          paid: data.summary.paid,
          due: data.summary.due,
          vat: data.summary.vat,
          discount_total: data.summary.discount,
        },
      }));
    });

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.invoices = { title: 'فاکتورها', render, showInvoice };
}(window));
