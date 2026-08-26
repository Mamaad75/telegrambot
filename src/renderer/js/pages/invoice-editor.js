/* ویرایشگر مشترک فاکتور: فروش، خرید و برگشتی‌ها */
(function (global) {
  'use strict';
  const { h, fmt, call, guard, parseNumber } = global.U;

  const CONFIG = {
    sale: { title: 'فاکتور فروش', party: 'customer', partyLabel: 'مشتری', priceField: 'sell_price', moneyIn: true },
    purchase: { title: 'فاکتور خرید', party: 'supplier', partyLabel: 'تأمین‌کننده', priceField: 'buy_price', moneyIn: false },
    sale_return: { title: 'برگشت از فروش', party: 'customer', partyLabel: 'مشتری', priceField: 'sell_price', moneyIn: false },
    purchase_return: { title: 'برگشت از خرید', party: 'supplier', partyLabel: 'تأمین‌کننده', priceField: 'buy_price', moneyIn: true },
  };

  const METHODS = [
    { value: 'cash', label: 'نقدی' },
    { value: 'pos', label: 'کارتخوان' },
    { value: 'bank', label: 'بانک / کارت‌به‌کارت' },
    { value: 'check', label: 'چک' },
  ];

  function create(type, view, options) {
    const cfg = CONFIG[type];
    const opts = options || {};
    const settings = global.U.state.settings;
    const st = {
      date: global.U.todayIso(),
      party: null,
      items: [],
      discountInvoice: 0,
      vatRate: (type === 'sale' || type === 'sale_return') ? Number(settings.vat_rate || 10) : 0,
      notes: '',
      payments: [],
      refInvoiceId: opts.refInvoiceId || null,
      invoiceNo: '',
    };
    if (settings.vat_enabled === '0') st.vatRate = 0;

    // ── محاسبات
    function totals() {
      let subtotal = 0; let discountLines = 0;
      for (const it of st.items) {
        const gross = Math.round(it.qty * it.unit_price);
        subtotal += gross;
        discountLines += Math.min(it.discount || 0, gross);
      }
      const maxInv = Math.max(0, subtotal - discountLines);
      const discInv = Math.min(st.discountInvoice || 0, maxInv);
      const discountTotal = discountLines + discInv;
      const taxable = subtotal - discountTotal;
      const vat = Math.round((taxable * st.vatRate) / 100);
      const total = taxable + vat;
      const paid = st.payments.reduce((a, p) => a + (p.amount || 0), 0);
      return { subtotal, discountLines, discInv, discountTotal, taxable, vat, total, paid, due: total - paid };
    }

    // ── عناصر
    const dateInput = global.UI.dateInput({ value: st.date, clearable: false, onChange: (v) => { st.date = v; } });
    const invoiceNoInput = h('input', { type: 'text', placeholder: 'خودکار' });
    const notesInput = h('textarea', { placeholder: 'توضیحات فاکتور (اختیاری)', rows: 2 });
    notesInput.addEventListener('input', () => { st.notes = notesInput.value; });

    const partyBox = h('div');
    const partyPicker = global.UI.autocomplete({
      placeholder: `جست‌وجوی ${cfg.partyLabel} بر اساس نام یا تلفن...`,
      fetch: (q) => call('parties.search', { type: cfg.party, q, limit: 12 }, { silent: true }),
      render: (r) => ({ title: r.name, meta: r.phone || '' }),
      onPick: (r) => { st.party = r; drawParty(); },
      onEnterEmpty: guard(async (text) => { if (text) await quickCreateParty(text); }),
    });

    async function quickCreateParty(name) {
      const nameInput = h('input', { type: 'text', value: name || '' });
      const phoneInput = h('input', { type: 'text', class: 'num' });
      const addrInput = h('input', { type: 'text' });
      global.UI.modal({
        title: `افزودن ${cfg.partyLabel} جدید`,
        size: 'narrow',
        content: h('div', {}, [
          global.UI.field('نام *', nameInput),
          h('div', { style: 'height:10px' }),
          global.UI.field('تلفن', phoneInput),
          h('div', { style: 'height:10px' }),
          global.UI.field('نشانی', addrInput),
        ]),
        buttons: [{
          label: 'ثبت',
          kind: 'primary',
          action: guard(async (api) => {
            if (!nameInput.value.trim()) { global.UI.toast('نام الزامی است.', 'warn'); return; }
            const p = await call('parties.create', {
              type: cfg.party, name: nameInput.value.trim(),
              phone: phoneInput.value.trim(), address: addrInput.value.trim(),
            });
            st.party = p;
            drawParty();
            api.close();
            global.UI.toast('طرف حساب ثبت شد.', 'ok');
          }),
        }],
      });
    }

    function drawParty() {
      partyBox.innerHTML = '';
      if (st.party) {
        partyBox.appendChild(h('div', { class: 'inline', style: 'justify-content:space-between;background:#f6f9fc;border:1px solid var(--line);border-radius:9px;padding:8px 12px' }, [
          h('div', {}, [
            h('b', { text: st.party.name }),
            h('span', { class: 'muted', text: st.party.phone ? ' — ' + st.party.phone : '' }),
            st.party.balance ? h('span', {
              class: 'tag ' + (st.party.balance > 0 ? 'warn' : 'ok'),
              style: 'margin-inline-start:8px',
              text: (cfg.party === 'customer' ? 'بدهکار: ' : 'بستانکار: ') + fmt.plain(Math.abs(st.party.balance)),
            }) : null,
          ]),
          h('button', { class: 'btn sm ghost', text: 'تغییر', onclick: () => { st.party = null; drawParty(); } }),
        ]));
      } else {
        partyBox.appendChild(h('div', { class: 'inline' }, [
          h('div', { style: 'flex:1' }, [partyPicker.el]),
          h('button', { class: 'btn sm', text: '+ جدید', onclick: () => quickCreateParty('') }),
        ]));
        partyBox.appendChild(h('div', { class: 'hint', text: type === 'sale' ? 'برای فروش نقدی می‌توانید مشتری را خالی بگذارید.' : '' }));
      }
    }

    // ── ورود کالا
    const qtyInput = h('input', { type: 'text', class: 'num', value: '1' });
    const priceInput = h('input', { type: 'text', class: 'num', value: '' });
    const discInput = h('input', { type: 'text', class: 'num', value: '' });
    let pendingProduct = null;
    const pendingBox = h('div', { class: 'hint' });

    const productPicker = global.UI.autocomplete({
      placeholder: 'نام، کد یا بارکد کالا (F2) — Enter برای افزودن',
      fetch: (q) => call('products.search', { q, limit: 15 }, { silent: true }),
      render: (r) => ({
        title: r.name,
        meta: `${fmt.plain(r[cfg.priceField])} | موجودی: ${fmt.qty(r.stock)}`,
      }),
      onPick: (r) => {
        pendingProduct = r;
        priceInput.value = fmt.raw(r[cfg.priceField]);
        pendingBox.innerHTML = `کالای انتخاب‌شده: <b>${global.U.esc(r.name)}</b> — موجودی: ${fmt.qty(r.stock)} ${global.U.esc(r.unit || '')}`;
        qtyInput.focus();
        qtyInput.select();
      },
      onEnterEmpty: guard(async (text) => {
        if (!text) return;
        const found = await call('products.byBarcode', { code: text }, { silent: true });
        if (found) {
          pendingProduct = found;
          priceInput.value = fmt.raw(found[cfg.priceField]);
          addLine();
          productPicker.clear();
          productPicker.focus();
        } else {
          global.UI.toast('کالایی با این بارکد یافت نشد.', 'warn');
        }
      }),
    });

    function addLine() {
      if (!pendingProduct) { global.UI.toast('ابتدا کالا را انتخاب کنید.', 'warn'); productPicker.focus(); return; }
      const qty = parseNumber(qtyInput.value) || 1;
      const price = parseNumber(priceInput.value);
      const discount = parseNumber(discInput.value);
      if (qty <= 0) { global.UI.toast('تعداد باید بزرگ‌تر از صفر باشد.', 'warn'); return; }
      const existing = st.items.find((x) => x.product_id === pendingProduct.id && x.unit_price === price && !x.discount && !discount);
      if (existing) existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
      else {
        st.items.push({
          product_id: pendingProduct.id,
          name: pendingProduct.name,
          unit: pendingProduct.unit,
          stock: pendingProduct.stock,
          qty,
          unit_price: price,
          discount,
        });
      }
      pendingProduct = null;
      pendingBox.textContent = '';
      qtyInput.value = '1';
      priceInput.value = '';
      discInput.value = '';
      productPicker.clear();
      productPicker.focus();
      redraw();
    }

    for (const input of [qtyInput, priceInput, discInput]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addLine(); }
      });
    }

    const itemsBox = h('div');
    function drawItems() {
      itemsBox.innerHTML = '';
      itemsBox.appendChild(global.UI.table({
        columns: [
          { title: '#', type: 'center', width: '46px', render: (r, i) => String(i + 1) },
          { title: 'کالا', render: (r) => h('div', {}, [h('b', { text: r.name }), h('div', { class: 'muted', style: 'font-size:11.5px', text: r.unit || '' })]) },
          {
            title: 'تعداد',
            type: 'qty',
            render: (r, i) => {
              const inp = h('input', { type: 'text', class: 'num', value: fmt.raw(r.qty), style: 'width:74px;padding:4px 7px' });
              inp.addEventListener('change', () => {
                const v = parseNumber(inp.value);
                if (v <= 0) { st.items.splice(i, 1); } else { r.qty = v; }
                redraw();
              });
              return inp;
            },
          },
          {
            title: 'مبلغ واحد',
            type: 'money',
            render: (r) => {
              const inp = h('input', { type: 'text', class: 'num', value: fmt.raw(r.unit_price), style: 'width:110px;padding:4px 7px' });
              inp.addEventListener('change', () => { r.unit_price = parseNumber(inp.value); redraw(); });
              return inp;
            },
          },
          {
            title: 'تخفیف ردیف',
            type: 'money',
            render: (r) => {
              const inp = h('input', { type: 'text', class: 'num', value: r.discount ? fmt.raw(r.discount) : '', placeholder: '۰', style: 'width:100px;padding:4px 7px' });
              inp.addEventListener('change', () => { r.discount = parseNumber(inp.value); redraw(); });
              return inp;
            },
          },
          { title: 'مبلغ کل', type: 'money', render: (r) => fmt.plain(Math.max(0, Math.round(r.qty * r.unit_price) - (r.discount || 0))) },
          {
            title: '',
            type: 'center',
            width: '48px',
            render: (r, i) => h('button', {
              class: 'btn sm danger', text: '✕', title: 'حذف ردیف',
              onclick: () => { st.items.splice(i, 1); redraw(); },
            }),
          },
        ],
        rows: st.items,
        empty: 'هنوز کالایی اضافه نشده است. کالا را جست‌وجو کنید یا بارکد را اسکن کنید.',
        emptyIcon: '🛒',
      }));
    }

    // ── تسویه
    const paymentsBox = h('div');
    function drawPayments() {
      paymentsBox.innerHTML = '';
      st.payments.forEach((p, i) => {
        const amountInput = h('input', { type: 'text', class: 'num', value: p.amount ? fmt.raw(p.amount) : '' });
        amountInput.addEventListener('input', () => { p.amount = parseNumber(amountInput.value); drawSummary(); });
        amountInput.addEventListener('change', () => { amountInput.value = p.amount ? fmt.raw(p.amount) : ''; });
        const row = h('div', { class: 'pay-line' }, [
          global.UI.select(METHODS, p.method, (v) => {
            p.method = v;
            drawPayments();
            drawSummary();
          }),
          amountInput,
          h('button', { class: 'btn sm ghost', text: '✕', onclick: () => { st.payments.splice(i, 1); drawPayments(); drawSummary(); } }),
        ]);
        paymentsBox.appendChild(row);
        if (p.method === 'check') {
          p.check = p.check || { number: '', bank: '', due_date: st.date };
          const num = h('input', { type: 'text', placeholder: 'شماره چک', value: p.check.number });
          num.addEventListener('input', () => { p.check.number = num.value; });
          const bank = h('input', { type: 'text', placeholder: 'بانک', value: p.check.bank });
          bank.addEventListener('input', () => { p.check.bank = bank.value; });
          const due = global.UI.dateInput({ value: p.check.due_date, clearable: false, onChange: (v) => { p.check.due_date = v; } });
          paymentsBox.appendChild(h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:-2px 0 10px;padding:8px;background:#f6f9fc;border-radius:8px' }, [
            num, bank, due.el,
          ]));
        }
      });
      paymentsBox.appendChild(h('button', {
        class: 'btn sm block', text: '+ افزودن روش پرداخت',
        onclick: () => {
          const t = totals();
          st.payments.push({ method: st.payments.length ? 'pos' : (global.U.state.settings.default_payment_method || 'cash'), amount: Math.max(0, t.due) });
          drawPayments();
          drawSummary();
        },
      }));
    }

    // ── جمع‌ها
    const summaryBox = h('div');
    const discountInvoiceInput = h('input', { type: 'text', class: 'num', placeholder: '۰' });
    discountInvoiceInput.addEventListener('input', () => { st.discountInvoice = parseNumber(discountInvoiceInput.value); drawSummary(); });
    discountInvoiceInput.addEventListener('change', () => {
      discountInvoiceInput.value = st.discountInvoice ? fmt.raw(st.discountInvoice) : '';
    });
    const vatInput = h('input', { type: 'text', class: 'num', value: String(st.vatRate) });
    vatInput.addEventListener('input', () => { st.vatRate = Math.max(0, Math.min(100, parseNumber(vatInput.value))); drawSummary(); });

    function drawSummary() {
      const t = totals();
      summaryBox.innerHTML = '';
      summaryBox.appendChild(h('div', { class: 'summary-list' }, [
        h('div', {}, [h('span', { text: 'جمع کالاها' }), h('b', { class: 'num', text: fmt.plain(t.subtotal) })]),
        h('div', {}, [h('span', { text: 'تخفیف ردیف‌ها' }), h('b', { class: 'num', text: fmt.plain(t.discountLines) })]),
        h('div', {}, [h('span', { text: 'تخفیف فاکتور' }), h('b', { class: 'num', text: fmt.plain(t.discInv) })]),
        h('div', {}, [h('span', { text: 'مبلغ مشمول' }), h('b', { class: 'num', text: fmt.plain(t.taxable) })]),
        h('div', {}, [h('span', { text: `ارزش افزوده (${fmt.plain(st.vatRate)}٪)` }), h('b', { class: 'num', text: fmt.plain(t.vat) })]),
        h('div', { class: 'grand' }, [h('span', { text: 'مبلغ نهایی' }), h('b', { class: 'num', text: fmt.plain(t.total) })]),
        h('div', {}, [h('span', { text: 'تسویه‌شده' }), h('b', { class: 'num', text: fmt.plain(t.paid) })]),
        h('div', {}, [
          h('span', { text: t.due >= 0 ? (type === 'sale' || type === 'purchase_return' ? 'مانده (نسیه)' : 'مانده قابل پرداخت') : 'اضافه پرداخت' }),
          h('b', { class: 'num ' + (t.due > 0 ? 'neg' : ''), text: fmt.plain(Math.abs(t.due)) }),
        ]),
      ]));
      summaryBox.appendChild(h('div', { class: 'money-hint', style: 'margin-top:6px', text: t.total ? global.Money.numberToPersianWords(t.total) + ' ' + global.U.state.currency : '' }));
    }

    function redraw() { drawItems(); drawSummary(); }

    // ── ثبت
    function payload() {
      const t = totals();
      return {
        type,
        date: st.date,
        invoice_no: invoiceNoInput.value.trim(),
        party_id: st.party ? st.party.id : null,
        items: st.items.map((x) => ({
          product_id: x.product_id, qty: x.qty, unit_price: x.unit_price, discount: x.discount || 0,
        })),
        discount_invoice: t.discInv,
        vat_rate: st.vatRate,
        notes: st.notes,
        ref_invoice_id: st.refInvoiceId,
        payments: st.payments
          .filter((p) => p.amount > 0)
          .map((p) => ({ method: p.method, amount: p.amount, check: p.check })),
      };
    }

    const save = guard(async (andPrint) => {
      if (!st.items.length) { global.UI.toast('فاکتور باید حداقل یک ردیف کالا داشته باشد.', 'warn'); return; }
      const t = totals();
      if (t.due < 0) { global.UI.toast('مجموع پرداخت‌ها از مبلغ فاکتور بیشتر است.', 'warn'); return; }
      if (t.due > 0 && !st.party) {
        global.UI.toast(`برای بخش نسیه باید ${cfg.partyLabel} انتخاب شود.`, 'warn');
        return;
      }
      for (const p of st.payments) {
        if (p.method === 'check' && p.amount > 0 && (!p.check || !p.check.number)) {
          global.UI.toast('شماره چک را وارد کنید.', 'warn');
          return;
        }
      }
      const result = await call('invoices.create', payload());
      global.UI.toast(`${cfg.title} شماره ${result.invoice.invoice_no} ثبت شد.`, 'ok');
      if (andPrint) {
        const s = global.U.state.settings;
        await global.Documents.print(
          global.Documents.invoice(result, s, { size: s.print_size || 'a4' }),
          `${cfg.title} ${result.invoice.invoice_no}`,
          s.print_size || 'a4',
        );
      }
      reset();
      if (opts.onSaved) opts.onSaved(result);
    });

    function reset() {
      st.items = [];
      st.payments = [];
      st.discountInvoice = 0;
      st.notes = '';
      st.party = null;
      st.refInvoiceId = null;
      st.invoiceNo = '';
      notesInput.value = '';
      discountInvoiceInput.value = '';
      invoiceNoInput.value = '';
      pendingProduct = null;
      pendingBox.textContent = '';
      drawParty();
      drawPayments();
      redraw();
      loadNextNo();
      productPicker.focus();
    }

    const loadNextNo = guard(async () => {
      const next = await call('invoices.nextNo', { type }, { silent: true });
      invoiceNoInput.placeholder = next || 'خودکار';
    });

    // ── چیدمان
    view.innerHTML = '';
    const left = h('div', {}, [
      h('div', { class: 'panel' }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'form-row c3' }, [
            global.UI.field('تاریخ', dateInput),
            global.UI.field('شماره فاکتور', invoiceNoInput, 'خالی بگذارید تا خودکار شماره‌گذاری شود'),
            global.UI.field(cfg.partyLabel, partyBox),
          ]),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('header', {}, [
          h('h2', { text: 'افزودن کالا' }),
          h('div', { class: 'spacer' }),
          h('span', { class: 'muted', style: 'font-size:12px', html: '<span class="kbd">F2</span> جست‌وجو · <span class="kbd">Enter</span> افزودن · <span class="kbd">F4</span> ثبت' }),
        ]),
        h('div', { class: 'body' }, [
          h('div', { class: 'form-row c4' }, [
            global.UI.field('کالا / بارکد', productPicker),
            global.UI.field('تعداد', qtyInput),
            global.UI.field('مبلغ واحد', priceInput),
            global.UI.field('تخفیف ردیف', discInput),
          ]),
          h('div', { class: 'inline' }, [
            h('button', { class: 'btn primary', text: '+ افزودن به فاکتور', onclick: () => addLine() }),
            pendingBox,
          ]),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('header', {}, [h('h2', { text: 'اقلام فاکتور' })]),
        h('div', { class: 'body tight' }, [itemsBox]),
      ]),
    ]);

    const right = h('div', { style: 'position:sticky;top:0' }, [
      h('div', { class: 'panel' }, [
        h('header', {}, [h('h2', { text: 'جمع فاکتور' })]),
        h('div', { class: 'body' }, [
          h('div', { class: 'form-row c2' }, [
            global.UI.field('تخفیف کل فاکتور', discountInvoiceInput),
            global.UI.field('نرخ ارزش افزوده (٪)', vatInput),
          ]),
          summaryBox,
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('header', {}, [h('h2', { text: cfg.moneyIn ? 'دریافت‌ها' : 'پرداخت‌ها' })]),
        h('div', { class: 'body' }, [
          paymentsBox,
          h('div', { class: 'hint', style: 'margin-top:8px', text: 'باقیمانده مبلغ به صورت نسیه در حساب طرف حساب ثبت می‌شود.' }),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('div', { class: 'body' }, [
          global.UI.field('توضیحات', notesInput),
          h('div', { style: 'height:12px' }),
          h('button', { class: 'btn success block', style: 'margin-bottom:8px', text: '✔ ثبت فاکتور (F4)', onclick: () => save(false) }),
          h('button', { class: 'btn primary block', style: 'margin-bottom:8px', text: '🖨 ثبت و چاپ', onclick: () => save(true) }),
          h('button', { class: 'btn ghost block', text: 'پاک کردن فرم', onclick: () => reset() }),
        ]),
      ]),
    ]);

    view.appendChild(h('div', { class: 'invoice-layout' }, [left, right]));

    drawParty();
    drawPayments();
    redraw();
    loadNextNo();
    setTimeout(() => productPicker.focus(), 60);

    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); productPicker.focus(); }
      if (e.key === 'F4' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) { e.preventDefault(); save(false); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); save(true); }
    };
    document.addEventListener('keydown', onKey);
    global.App.onLeave(() => document.removeEventListener('keydown', onKey));

    // ── بارگذاری از فاکتور اصلی (برای برگشتی)
    async function loadFromInvoice(invoiceId) {
      const data = await call('invoices.returnable', { id: invoiceId });
      st.refInvoiceId = invoiceId;
      st.party = data.invoice.party_id ? await call('parties.get', { id: data.invoice.party_id }) : null;
      st.vatRate = data.invoice.vat_rate;
      vatInput.value = String(st.vatRate);
      st.items = data.items.map((it) => ({
        product_id: it.product_id,
        name: it.product_name,
        unit: it.unit,
        qty: it.remaining_qty,
        unit_price: it.unit_price,
        discount: 0,
      }));
      st.notes = `برگشت فاکتور ${data.invoice.invoice_no}`;
      notesInput.value = st.notes;
      drawParty();
      redraw();
      global.UI.toast(`اقلام فاکتور ${data.invoice.invoice_no} بارگذاری شد. تعداد برگشتی را اصلاح کنید.`, 'ok', 5000);
    }

    return { state: st, reset, save, loadFromInvoice, totals };
  }

  global.InvoiceEditor = { create, CONFIG };
}(window));
