/* مشتریان و تأمین‌کنندگان */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  function editParty(type, party, onSaved) {
    const isNew = !party;
    const p = party || {};
    const label = type === 'customer' ? 'مشتری' : 'تأمین‌کننده';
    const name = h('input', { type: 'text', value: p.name || '' });
    const phone = h('input', { type: 'text', class: 'num', value: p.phone || '' });
    const nid = h('input', { type: 'text', class: 'num', value: p.national_id || '' });
    const address = h('input', { type: 'text', value: p.address || '' });
    const notes = h('textarea', { rows: 2, value: p.notes || '' });
    const opening = global.UI.moneyInput({ value: 0, hideHint: true });
    const active = h('input', { type: 'checkbox' });
    active.checked = isNew ? true : !!p.active;

    global.UI.modal({
      title: isNew ? `${label} جدید` : `ویرایش ${label}`,
      content: h('div', {}, [
        h('div', { class: 'form-row c2' }, [
          global.UI.field('نام / عنوان *', name),
          global.UI.field('تلفن', phone),
        ]),
        h('div', { class: 'form-row c2' }, [
          global.UI.field('کد / شناسه ملی', nid),
          global.UI.field('نشانی', address),
        ]),
        isNew ? global.UI.field(
          type === 'customer' ? 'مانده بدهی اول دوره' : 'مانده طلب اول دوره',
          opening,
          'اگر این شخص از قبل بدهکار/بستانکار است، مبلغ را وارد کنید',
        ) : null,
        h('div', { style: 'height:10px' }),
        global.UI.field('یادداشت', notes),
        h('label', { class: 'check', style: 'margin-top:10px' }, [active, h('span', { text: 'فعال' })]),
      ]),
      buttons: [{
        label: 'ذخیره',
        kind: 'primary',
        action: guard(async (api) => {
          if (!name.value.trim()) { global.UI.toast('نام الزامی است.', 'warn'); return; }
          const payload = {
            type,
            name: name.value.trim(),
            phone: phone.value.trim(),
            national_id: nid.value.trim(),
            address: address.value.trim(),
            notes: notes.value.trim(),
            active: active.checked ? 1 : 0,
          };
          if (isNew) {
            payload.opening_balance = opening.value;
            await call('parties.create', payload);
          } else {
            await call('parties.update', { id: p.id, ...payload });
          }
          global.UI.toast('ذخیره شد.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  function settleModal(party, onSaved) {
    const isCustomer = party.type === 'customer';
    const kind = isCustomer ? 'receipt' : 'payment';
    const amount = global.UI.moneyInput({ value: Math.max(0, party.balance) });
    const method = global.UI.select([
      { value: 'cash', label: 'نقدی' },
      { value: 'pos', label: 'کارتخوان' },
      { value: 'bank', label: 'بانک / کارت‌به‌کارت' },
      { value: 'check', label: 'چک' },
    ], 'cash', (v) => { checkBox.hidden = v !== 'check'; });
    const dateInput = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const desc = h('input', { type: 'text', placeholder: 'شرح (اختیاری)' });
    const chkNumber = h('input', { type: 'text', placeholder: 'شماره چک' });
    const chkBank = h('input', { type: 'text', placeholder: 'بانک' });
    const chkDue = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const checkBox = h('div', { hidden: true, style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px' }, [
      chkNumber, chkBank, chkDue.el,
    ]);

    global.UI.modal({
      title: `${isCustomer ? 'دریافت از' : 'پرداخت به'} ${party.name}`,
      size: 'narrow',
      content: h('div', {}, [
        h('div', { class: 'stat', style: 'margin-bottom:12px' }, [
          h('div', { class: 'label', text: isCustomer ? 'مانده بدهی مشتری' : 'مانده بدهی ما' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(party.balance) }), h('small', { text: global.U.state.currency })]),
        ]),
        global.UI.field('مبلغ', amount),
        h('div', { class: 'form-row c2', style: 'margin-top:10px' }, [
          global.UI.field('روش', method),
          global.UI.field('تاریخ', dateInput),
        ]),
        checkBox,
        h('div', { style: 'height:10px' }),
        global.UI.field('شرح', desc),
      ]),
      buttons: [{
        label: 'ثبت سند',
        kind: 'primary',
        action: guard(async (api) => {
          if (amount.value <= 0) { global.UI.toast('مبلغ باید بزرگ‌تر از صفر باشد.', 'warn'); return; }
          if (method.value === 'check' && !chkNumber.value.trim()) { global.UI.toast('شماره چک را وارد کنید.', 'warn'); return; }
          await call('payments.create', {
            kind,
            party_id: party.id,
            date: dateInput.value,
            description: desc.value.trim(),
            lines: [{
              method: method.value,
              amount: amount.value,
              check: method.value === 'check'
                ? { number: chkNumber.value.trim(), bank: chkBank.value.trim(), due_date: chkDue.value }
                : undefined,
            }],
          });
          global.UI.toast('سند ثبت شد.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  async function showProfile(id, onChanged) {
    const data = await call('parties.profile', { id });
    const p = data.party;
    const s = global.U.state.settings;
    const content = h('div');

    content.appendChild(h('div', { class: 'grid c4', style: 'margin-bottom:14px' }, [
      h('div', { class: 'stat' }, [h('div', { class: 'label', text: p.type === 'customer' ? 'جمع خرید مشتری' : 'جمع خرید از او' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.totals.invoiced) })])]),
      h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'جمع برگشتی' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.totals.returned) })])]),
      h('div', { class: 'stat ok' }, [h('div', { class: 'label', text: p.type === 'customer' ? 'جمع دریافتی' : 'جمع پرداختی' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.totals.payments) })])]),
      h('div', { class: 'stat ' + (p.balance > 0 ? 'bad' : 'ok') }, [
        h('div', { class: 'label', text: p.type === 'customer' ? 'مانده طلب ما' : 'مانده بدهی ما' }),
        h('div', { class: 'value num' }, [h('span', { text: fmt.plain(p.balance) })]),
      ]),
    ]));

    const tabBox = h('div');
    const tabs = global.UI.tabs([
      { key: 'statement', title: 'صورت‌حساب' },
      { key: 'invoices', title: 'فاکتورها' },
      { key: 'payments', title: 'دریافت/پرداخت' },
      { key: 'checks', title: 'چک‌ها' },
    ], (k) => drawTab(k));
    content.appendChild(tabs.el);
    content.appendChild(tabBox);

    function drawTab(k) {
      tabBox.innerHTML = '';
      if (k === 'statement') {
        tabBox.appendChild(global.UI.table({
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'سند', key: 'entry_no', type: 'center' },
            { title: 'شرح', key: 'description' },
            { title: 'بدهکار', key: 'debit', type: 'money' },
            { title: 'بستانکار', key: 'credit', type: 'money' },
            { title: 'مانده', key: 'balance', type: 'money' },
          ],
          rows: data.statement.rows,
          empty: 'گردشی ثبت نشده است.',
        }));
      } else if (k === 'invoices') {
        tabBox.appendChild(global.UI.table({
          columns: [
            { title: 'نوع', type: 'center', render: (r) => global.U.label('invoiceTypeShort', r.type) },
            { title: 'شماره', key: 'invoice_no', type: 'center' },
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'مبلغ', key: 'total', type: 'money' },
            { title: 'مانده', key: 'due', type: 'money' },
            { title: '', type: 'center', render: (r) => h('button', { class: 'btn sm', text: 'مشاهده', onclick: () => global.Pages.invoices.showInvoice(r.id) }) },
          ],
          rows: data.invoices,
          empty: 'فاکتوری ثبت نشده است.',
        }));
      } else if (k === 'payments') {
        tabBox.appendChild(global.UI.table({
          columns: [
            { title: 'تاریخ', key: 'date', type: 'date' },
            { title: 'نوع', type: 'center', render: (r) => (r.kind === 'receipt' ? 'دریافت' : 'پرداخت') },
            { title: 'مبلغ', key: 'amount', type: 'money' },
            { title: 'شرح', key: 'description' },
            { title: 'وضعیت', type: 'center', render: (r) => h('span', { class: 'tag ' + (r.status === 'void' ? 'bad' : 'ok'), text: r.status === 'void' ? 'ابطال' : 'ثبت‌شده' }) },
          ],
          rows: data.payments,
          empty: 'سندی ثبت نشده است.',
        }));
      } else {
        tabBox.appendChild(global.UI.table({
          columns: [
            { title: 'نوع', type: 'center', render: (r) => global.U.label('checkKind', r.kind) },
            { title: 'شماره', key: 'number', type: 'center' },
            { title: 'بانک', key: 'bank' },
            { title: 'مبلغ', key: 'amount', type: 'money' },
            { title: 'سررسید', key: 'due_date', type: 'date' },
            { title: 'وضعیت', type: 'center', render: (r) => h('span', { class: 'tag mute', text: global.U.label('checkStatus', r.status) }) },
          ],
          rows: data.checks,
          empty: 'چکی ثبت نشده است.',
        }));
      }
    }
    drawTab('statement');

    global.UI.modal({
      title: `${p.type === 'customer' ? 'پرونده مشتری' : 'پرونده تأمین‌کننده'} — ${p.name}`,
      size: 'wide',
      content,
      buttons: [
        {
          label: p.type === 'customer' ? '💵 دریافت از مشتری' : '💵 پرداخت به تأمین‌کننده',
          kind: 'success',
          action: (api) => { api.close(); settleModal(p, onChanged); },
        },
        {
          label: '🖨 چاپ صورت‌حساب',
          kind: 'primary',
          action: guard(async () => {
            await global.Documents.print(
              global.Documents.statement(data, s, {}),
              `صورت‌حساب ${p.name}`, 'a4',
            );
          }),
        },
        { label: '✎ ویرایش', action: (api) => { api.close(); editParty(p.type, p, onChanged); } },
      ],
      cancelLabel: 'بستن',
    });
  }

  function makePage(type) {
    const label = type === 'customer' ? 'مشتریان' : 'تأمین‌کنندگان';
    const single = type === 'customer' ? 'مشتری' : 'تأمین‌کننده';
    return {
      title: label,
      async render(view) {
        let query = ''; let showInactive = false;
        const searchInput = h('input', { type: 'search', placeholder: 'نام یا شماره تلفن...' });
        searchInput.addEventListener('input', global.U.debounce(() => { query = searchInput.value.trim(); load(); }, 250));
        const inactiveCheck = h('input', { type: 'checkbox' });
        inactiveCheck.addEventListener('change', () => { showInactive = inactiveCheck.checked; load(); });
        const listBox = h('div');
        const statsBox = h('div');

        view.innerHTML = '';
        view.appendChild(h('div', { class: 'panel' }, [
          h('header', {}, [
            h('h2', { text: label }),
            h('div', { class: 'spacer' }),
            h('button', { class: 'btn primary', text: `+ ${single} جدید`, onclick: () => editParty(type, null, load) }),
          ]),
          h('div', { class: 'body' }, [
            h('div', { class: 'toolbar' }, [
              h('div', { class: 'field', style: 'flex:1;min-width:260px' }, [h('label', { text: 'جست‌وجو' }), searchInput]),
              h('label', { class: 'check', style: 'margin-bottom:8px' }, [inactiveCheck, h('span', { text: 'نمایش غیرفعال‌ها' })]),
            ]),
            statsBox,
          ]),
        ]));
        view.appendChild(h('div', { class: 'panel' }, [h('div', { class: 'body tight' }, [listBox])]));

        const load = guard(async () => {
          listBox.innerHTML = '';
          listBox.appendChild(global.UI.loading());
          const data = await call('parties.list', { type, q: query, onlyActive: !showInactive, limit: 500 });
          const totalBalance = data.rows.reduce((a, x) => a + (x.balance || 0), 0);
          statsBox.innerHTML = '';
          statsBox.appendChild(h('div', { class: 'grid c3', style: 'margin-top:12px' }, [
            h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.total) }), h('small', { text: 'نفر' })])]),
            h('div', { class: 'stat ' + (totalBalance > 0 ? 'brand' : '') }, [
              h('div', { class: 'label', text: type === 'customer' ? 'جمع طلب از مشتریان' : 'جمع بدهی به تأمین‌کنندگان' }),
              h('div', { class: 'value num' }, [h('span', { text: fmt.plain(totalBalance) })]),
            ]),
            h('div', { class: 'stat' }, [
              h('div', { class: 'label', text: 'دارای مانده' }),
              h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.rows.filter((x) => x.balance).length) }), h('small', { text: 'نفر' })]),
            ]),
          ]));

          listBox.innerHTML = '';
          listBox.appendChild(global.UI.table({
            columns: [
              {
                title: 'نام',
                render: (r) => h('div', {}, [
                  h('b', { text: r.name }),
                  r.active ? null : h('span', { class: 'tag mute', style: 'margin-inline-start:6px', text: 'غیرفعال' }),
                  r.address ? h('div', { class: 'muted', style: 'font-size:11.5px', text: r.address }) : null,
                ]),
              },
              { title: 'تلفن', key: 'phone', type: 'center' },
              { title: 'کد/شناسه ملی', key: 'national_id', type: 'center' },
              {
                title: type === 'customer' ? 'مانده بدهکاری' : 'مانده بستانکاری',
                type: 'money',
                render: (r) => h('span', { class: r.balance > 0 ? 'neg' : (r.balance < 0 ? 'pos' : 'muted'), text: fmt.plain(r.balance) }),
              },
              {
                title: 'عملیات',
                type: 'center',
                width: '230px',
                render: (r) => h('div', { class: 'row-actions' }, [
                  h('button', { class: 'btn sm', text: 'پرونده', onclick: () => showProfile(r.id, load) }),
                  h('button', { class: 'btn sm success', text: type === 'customer' ? 'دریافت' : 'پرداخت', onclick: () => settleModal(r, load) }),
                  h('button', { class: 'btn sm', text: '✎', onclick: () => editParty(type, r, load) }),
                  h('button', {
                    class: 'btn sm danger',
                    text: '✕',
                    onclick: guard(async () => {
                      const okC = await global.UI.confirm(`«${r.name}» حذف شود؟`, {
                        danger: true, detail: 'در صورت وجود سابقه مالی، فقط غیرفعال می‌شود.',
                      });
                      if (!okC) return;
                      const res = await call('parties.remove', { id: r.id });
                      global.UI.toast(res.deleted ? 'حذف شد.' : 'غیرفعال شد (دارای سابقه مالی است).', 'ok');
                      load();
                    }),
                  }),
                ]),
              },
            ],
            rows: data.rows,
            onRowClick: (r) => showProfile(r.id, load),
            empty: `${single}ی ثبت نشده است.`,
            emptyIcon: '👥',
            footer: { name: 'جمع', balance: totalBalance },
          }));
        });

        await load();
      },
    };
  }

  global.Pages = global.Pages || {};
  global.Pages.customers = makePage('customer');
  global.Pages.suppliers = makePage('supplier');
  global.Pages.partiesShared = { showProfile, editParty, settleModal };
}(window));
