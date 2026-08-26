/* مدیریت چک‌ها */
(function (global) {
  'use strict';
  const { h, fmt, call, guard } = global.U;

  const NEXT_STATUS = {
    received: {
      pending: [['deposited', 'واگذاری به بانک'], ['cleared', 'وصول شد'], ['returned', 'برگشت خورد'], ['cancelled', 'ابطال']],
      deposited: [['cleared', 'وصول شد'], ['returned', 'برگشت خورد']],
      returned: [['deposited', 'واگذاری مجدد'], ['cleared', 'وصول شد'], ['cancelled', 'ابطال']],
      cleared: [], cancelled: [],
    },
    paid: {
      pending: [['paid', 'پاس شد'], ['returned', 'برگشت خورد'], ['cancelled', 'ابطال']],
      deposited: [['paid', 'پاس شد'], ['returned', 'برگشت خورد']],
      returned: [['paid', 'پاس شد'], ['cancelled', 'ابطال']],
      paid: [], cancelled: [],
    },
  };

  function statusTag(c) {
    const cls = { pending: 'info', deposited: 'info', cleared: 'ok', paid: 'ok', returned: 'bad', cancelled: 'mute' }[c.status] || 'mute';
    const late = ['pending', 'deposited'].includes(c.status) && c.due_date && c.due_date < global.U.todayIso();
    return h('span', { class: 'tag ' + (late ? 'bad' : cls), text: late ? 'سررسید گذشته' : global.U.label('checkStatus', c.status) });
  }

  function changeStatusModal(check, target, targetLabel, onSaved) {
    const dateInput = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const account = global.UI.select([
      { value: '103', label: 'بانک' },
      { value: '101', label: 'صندوق' },
      { value: '102', label: 'کارتخوان' },
    ], '103');
    const notes = h('input', { type: 'text', placeholder: 'توضیحات (اختیاری)' });
    const needsAccount = target === 'cleared' || target === 'paid';

    global.UI.modal({
      title: `${targetLabel} — چک ${check.number}`,
      size: 'narrow',
      content: h('div', {}, [
        h('div', { class: 'stat', style: 'margin-bottom:12px' }, [
          h('div', { class: 'label', text: `${global.U.label('checkKind', check.kind)} — ${check.party_name || ''}` }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(check.amount) }), h('small', { text: global.U.state.currency })]),
          h('div', { class: 'sub', text: `سررسید: ${fmt.date(check.due_date)}` }),
        ]),
        global.UI.field('تاریخ عملیات', dateInput),
        needsAccount ? h('div', { style: 'margin-top:10px' }, [
          global.UI.field(check.kind === 'received' ? 'واریز به حساب' : 'برداشت از حساب', account),
        ]) : null,
        h('div', { style: 'height:10px' }),
        global.UI.field('توضیحات', notes),
      ]),
      buttons: [{
        label: 'ثبت',
        kind: 'primary',
        action: guard(async (api) => {
          await call('checks.changeStatus', {
            id: check.id, status: target, date: dateInput.value,
            account: needsAccount ? account.value : undefined, notes: notes.value.trim(),
          });
          global.UI.toast('وضعیت چک به‌روزرسانی شد و سند حسابداری ثبت گردید.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  function newCheckModal(onSaved) {
    const kind = global.UI.select([
      { value: 'received', label: 'چک دریافتی از مشتری' },
      { value: 'paid', label: 'چک پرداختی به تأمین‌کننده' },
    ], 'received', () => { party = null; drawParty(); });
    const number = h('input', { type: 'text', class: 'num' });
    const bank = h('input', { type: 'text' });
    const amount = global.UI.moneyInput({});
    const issue = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const due = global.UI.dateInput({ value: global.U.todayIso(), clearable: false });
    const notes = h('input', { type: 'text', placeholder: 'بابت...' });
    let party = null;
    const partyBox = h('div');
    function drawParty() {
      partyBox.innerHTML = '';
      if (party) {
        partyBox.appendChild(h('div', { class: 'inline' }, [
          h('b', { text: party.name }),
          h('button', { class: 'btn sm ghost', text: 'تغییر', onclick: () => { party = null; drawParty(); } }),
        ]));
      } else {
        const picker = global.UI.autocomplete({
          placeholder: 'جست‌وجوی طرف حساب...',
          fetch: (q) => call('parties.search', { type: kind.value === 'received' ? 'customer' : 'supplier', q, limit: 12 }, { silent: true }),
          render: (r) => ({ title: r.name, meta: r.phone || '' }),
          onPick: (r) => { party = r; drawParty(); },
        });
        partyBox.appendChild(picker.el);
      }
    }
    drawParty();

    global.UI.modal({
      title: 'ثبت دستی چک',
      content: h('div', {}, [
        h('div', { class: 'form-row c2' }, [
          global.UI.field('نوع چک', kind),
          global.UI.field('طرف حساب *', partyBox),
        ]),
        h('div', { class: 'form-row c3' }, [
          global.UI.field('شماره چک', number),
          global.UI.field('بانک', bank),
          global.UI.field('مبلغ *', amount),
        ]),
        h('div', { class: 'form-row c2' }, [
          global.UI.field('تاریخ صدور', issue),
          global.UI.field('تاریخ سررسید', due),
        ]),
        global.UI.field('توضیحات', notes),
        h('div', { class: 'hint', style: 'margin-top:8px', text: 'برای چکی که همراه فاکتور دریافت/پرداخت می‌شود، از خود فاکتور استفاده کنید؛ این فرم برای ثبت چک‌های خارج از فاکتور است.' }),
      ]),
      buttons: [{
        label: 'ثبت چک',
        kind: 'primary',
        action: guard(async (api) => {
          if (!party) { global.UI.toast('طرف حساب را انتخاب کنید.', 'warn'); return; }
          if (amount.value <= 0) { global.UI.toast('مبلغ نامعتبر است.', 'warn'); return; }
          await call('checks.create', {
            kind: kind.value, number: number.value.trim(), bank: bank.value.trim(),
            party_id: party.id, amount: amount.value,
            issue_date: issue.value, due_date: due.value, notes: notes.value.trim(),
          });
          global.UI.toast('چک ثبت شد.', 'ok');
          api.close();
          if (onSaved) onSaved();
        }),
      }],
    });
  }

  async function showHistory(id) {
    const data = await call('checks.get', { id });
    global.UI.modal({
      title: `تاریخچه چک ${data.check.number}`,
      content: global.UI.table({
        columns: [
          { title: 'تاریخ', key: 'date', type: 'date' },
          { title: 'از وضعیت', type: 'center', render: (r) => global.U.label('checkStatus', r.from_status) || '—' },
          { title: 'به وضعیت', type: 'center', render: (r) => global.U.label('checkStatus', r.to_status) },
          { title: 'توضیحات', key: 'notes' },
        ],
        rows: data.events,
      }),
      cancelLabel: 'بستن',
    });
  }

  async function render(view) {
    let filter = { kind: '', status: '', q: '', open: false, overdue: false };
    const listBox = h('div');
    const statsBox = h('div');

    const kindSelect = global.UI.select([
      { value: '', label: 'همه' }, { value: 'received', label: 'دریافتی' }, { value: 'paid', label: 'پرداختی' },
    ], '', (v) => { filter.kind = v; load(); });
    const statusSelect = global.UI.select([
      { value: '', label: 'همه وضعیت‌ها' },
      { value: 'pending', label: 'در جریان' },
      { value: 'deposited', label: 'واگذار به بانک' },
      { value: 'cleared', label: 'وصول‌شده' },
      { value: 'paid', label: 'پرداخت‌شده' },
      { value: 'returned', label: 'برگشتی' },
      { value: 'cancelled', label: 'ابطال‌شده' },
    ], '', (v) => { filter.status = v; load(); });
    const searchInput = h('input', { type: 'search', placeholder: 'شماره چک، بانک یا طرف حساب...' });
    searchInput.addEventListener('input', global.U.debounce(() => { filter.q = searchInput.value.trim(); load(); }, 250));
    const openCheck = h('input', { type: 'checkbox' });
    openCheck.addEventListener('change', () => { filter.open = openCheck.checked; load(); });
    const overdueCheck = h('input', { type: 'checkbox' });
    overdueCheck.addEventListener('change', () => { filter.overdue = overdueCheck.checked; load(); });

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [
      h('header', {}, [
        h('h2', { text: 'چک‌ها' }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', text: '+ ثبت چک', onclick: () => newCheckModal(load) }),
      ]),
      h('div', { class: 'body' }, [
        h('div', { class: 'toolbar' }, [
          h('div', { class: 'field', style: 'flex:1;min-width:220px' }, [h('label', { text: 'جست‌وجو' }), searchInput]),
          global.UI.field('نوع', kindSelect),
          global.UI.field('وضعیت', statusSelect),
          h('label', { class: 'check', style: 'margin-bottom:8px' }, [openCheck, h('span', { text: 'فقط باز' })]),
          h('label', { class: 'check', style: 'margin-bottom:8px' }, [overdueCheck, h('span', { text: 'سررسید گذشته' })]),
        ]),
        statsBox,
      ]),
    ]));
    view.appendChild(h('div', { class: 'panel' }, [h('div', { class: 'body tight' }, [listBox])]));

    const load = guard(async () => {
      listBox.innerHTML = '';
      listBox.appendChild(global.UI.loading());
      const [data, reminders] = await Promise.all([
        call('checks.list', { ...filter, limit: 500 }),
        call('checks.reminders', { days: 7 }),
      ]);
      statsBox.innerHTML = '';
      statsBox.appendChild(h('div', { class: 'grid c4', style: 'margin-top:12px' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تعداد در نمایش' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.total) }), h('small', { text: 'فقره' })])]),
        h('div', { class: 'stat brand' }, [h('div', { class: 'label', text: 'جمع مبلغ' }), h('div', { class: 'value num' }, [h('span', { text: fmt.plain(data.summary.total) })])]),
        h('div', { class: 'stat ' + (reminders.overdue.length ? 'bad' : 'ok') }, [
          h('div', { class: 'label', text: 'سررسید گذشته' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(reminders.overdue.length) }), h('small', { text: 'فقره' })]),
          h('div', { class: 'sub', text: `مبلغ: ${fmt.plain(reminders.totals.overdueReceived + reminders.totals.overduePaid)}` }),
        ]),
        h('div', { class: 'stat warn' }, [
          h('div', { class: 'label', text: 'سررسید ۷ روز آینده' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(reminders.upcoming.length) }), h('small', { text: 'فقره' })]),
          h('div', { class: 'sub', text: `مبلغ: ${fmt.plain(reminders.totals.upcomingReceived + reminders.totals.upcomingPaid)}` }),
        ]),
      ]));

      listBox.innerHTML = '';
      listBox.appendChild(global.UI.table({
        columns: [
          { title: 'نوع', type: 'center', render: (r) => h('span', { class: 'tag ' + (r.kind === 'received' ? 'info' : 'warn'), text: global.U.label('checkKind', r.kind) }) },
          { title: 'شماره چک', key: 'number', type: 'center' },
          { title: 'بانک', key: 'bank' },
          { title: 'طرف حساب', key: 'party_name' },
          { title: 'مبلغ', key: 'amount', type: 'money' },
          { title: 'صدور', key: 'issue_date', type: 'date' },
          { title: 'سررسید', key: 'due_date', type: 'date' },
          { title: 'وضعیت', type: 'center', render: statusTag },
          {
            title: 'عملیات',
            type: 'center',
            width: '260px',
            render: (r) => {
              const actions = (NEXT_STATUS[r.kind] || {})[r.status] || [];
              return h('div', { class: 'row-actions' }, actions.map(([target, label]) => h('button', {
                class: 'btn sm' + (target === 'cleared' || target === 'paid' ? ' success' : (target === 'returned' || target === 'cancelled' ? ' danger' : '')),
                text: label,
                onclick: () => changeStatusModal(r, target, label, load),
              })).concat([
                h('button', { class: 'btn sm ghost', text: 'تاریخچه', onclick: () => showHistory(r.id) }),
              ]));
            },
          },
        ],
        rows: data.rows,
        empty: 'چکی ثبت نشده است.',
        emptyIcon: '📑',
        footer: { party_name: 'جمع', amount: data.summary.total },
      }));
    });

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.checks = { title: 'چک‌ها', render };
}(window));
