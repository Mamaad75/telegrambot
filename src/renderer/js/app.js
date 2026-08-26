/* راه‌اندازی برنامه، منو و مسیریابی صفحات */
(function (global) {
  'use strict';
  const { h, call, guard } = global.U;

  const NAV = [
    { group: '', items: [{ key: 'dashboard', title: 'داشبورد', icon: '📊' }] },
    {
      group: 'خرید و فروش',
      items: [
        { key: 'sale', title: 'فاکتور فروش', icon: '🧾' },
        { key: 'purchase', title: 'فاکتور خرید', icon: '📦' },
        { key: 'invoices', title: 'فهرست فاکتورها', icon: '📁' },
        { key: 'sale_return', title: 'برگشت از فروش', icon: '↩️' },
        { key: 'purchase_return', title: 'برگشت از خرید', icon: '↪️' },
      ],
    },
    {
      group: 'انبار و کالا',
      items: [
        { key: 'products', title: 'کالاها', icon: '🏷' },
        { key: 'inventory', title: 'انبار', icon: '🏬' },
      ],
    },
    {
      group: 'طرف حساب‌ها',
      items: [
        { key: 'customers', title: 'مشتریان', icon: '🧑‍💼' },
        { key: 'suppliers', title: 'تأمین‌کنندگان', icon: '🚚' },
      ],
    },
    {
      group: 'مالی',
      items: [
        { key: 'treasury', title: 'صندوق و بانک', icon: '💵' },
        { key: 'checks', title: 'چک‌ها', icon: '📑', badge: 'checks' },
        { key: 'accounting', title: 'حسابداری', icon: '📘' },
      ],
    },
    {
      group: '',
      items: [
        { key: 'reports', title: 'گزارش‌ها', icon: '📈' },
        { key: 'settings', title: 'تنظیمات', icon: '⚙️' },
      ],
    },
  ];

  let currentPage = null;
  let leaveHooks = [];
  const badges = {};

  function onLeave(fn) { leaveHooks.push(fn); }

  function drawNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    for (const g of NAV) {
      const wrap = h('div', { class: 'nav-group' });
      if (g.group) wrap.appendChild(h('span', { text: g.group }));
      for (const item of g.items) {
        const badgeCount = item.badge ? badges[item.badge] : 0;
        wrap.appendChild(h('button', {
          class: 'nav-item' + (currentPage === item.key ? ' active' : ''),
          dataset: { page: item.key },
          onclick: () => go(item.key),
        }, [
          h('span', { class: 'ic', text: item.icon }),
          h('span', { text: item.title }),
          badgeCount ? h('span', { class: 'badge', text: global.U.fmt.plain(badgeCount) }) : null,
        ]));
      }
      nav.appendChild(wrap);
    }
  }

  const go = guard(async (key, params) => {
    const page = global.Pages[key];
    if (!page) { global.UI.toast('صفحه یافت نشد: ' + key, 'bad'); return; }
    for (const fn of leaveHooks) { try { fn(); } catch (_) { /* نادیده */ } }
    leaveHooks = [];
    currentPage = key;
    drawNav();
    document.getElementById('pageTitle').textContent = page.title;
    const view = document.getElementById('view');
    view.innerHTML = '';
    view.appendChild(global.UI.loading());
    view.scrollTop = 0;
    try {
      view.innerHTML = '';
      await page.render(view, params || {});
    } catch (err) {
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'panel' }, [
        h('div', { class: 'body' }, [
          h('h3', { text: 'خطا در نمایش این بخش' }),
          h('p', { class: 'muted', text: (err && err.message) || 'خطای نامشخص' }),
          h('button', { class: 'btn primary', text: 'تلاش مجدد', onclick: () => go(key, params) }),
        ]),
      ]));
      if (!err.handled) {
        console.error(err);
        call('app.log', { message: String(err && err.message), detail: String(err && err.stack) }, { silent: true });
      }
    }
  });

  function refreshBrand() {
    const s = global.U.state.settings;
    document.getElementById('brandName').textContent = s.shop_name || 'حسابداری فروشگاه';
    const logo = document.getElementById('brandLogo');
    logo.innerHTML = '';
    if (s.shop_logo) logo.appendChild(h('img', { src: s.shop_logo, alt: '' }));
    else logo.textContent = (s.shop_name || 'ح').trim().charAt(0);
  }

  /** جست‌وجوی سراسری: کالا، مشتری، تأمین‌کننده و فاکتور */
  function buildGlobalSearch() {
    const holder = document.getElementById('globalSearch');
    const picker = global.UI.autocomplete({
      placeholder: 'جست‌وجوی سراسری (Ctrl+K): کالا، مشتری، فاکتور...',
      minChars: 2,
      openOnFocus: false,
      delay: 220,
      fetch: async (q) => {
        if (!q) return [];
        const [prods, customers, suppliers, invoices] = await Promise.all([
          call('products.search', { q, limit: 5 }, { silent: true }),
          call('parties.search', { type: 'customer', q, limit: 4 }, { silent: true }),
          call('parties.search', { type: 'supplier', q, limit: 3 }, { silent: true }),
          call('invoices.list', { q, limit: 5 }, { silent: true }),
        ]);
        return [].concat(
          prods.map((x) => ({ kind: 'product', row: x })),
          customers.map((x) => ({ kind: 'customer', row: x })),
          suppliers.map((x) => ({ kind: 'supplier', row: x })),
          (invoices.rows || []).map((x) => ({ kind: 'invoice', row: x })),
        );
      },
      render: (item) => {
        const r = item.row;
        if (item.kind === 'product') return { title: '🏷 ' + r.name, meta: `کالا · موجودی ${global.U.fmt.qty(r.stock)}` };
        if (item.kind === 'customer') return { title: '🧑‍💼 ' + r.name, meta: 'مشتری' + (r.phone ? ' · ' + r.phone : '') };
        if (item.kind === 'supplier') return { title: '🚚 ' + r.name, meta: 'تأمین‌کننده' + (r.phone ? ' · ' + r.phone : '') };
        return {
          title: '🧾 ' + r.invoice_no,
          meta: `${global.U.label('invoiceTypeShort', r.type)} · ${global.U.fmt.date(r.date)} · ${global.U.fmt.plain(r.total)}`,
        };
      },
      onPick: (item) => {
        if (item.kind === 'product') go('products');
        else if (item.kind === 'customer') global.Pages.partiesShared.showProfile(item.row.id);
        else if (item.kind === 'supplier') global.Pages.partiesShared.showProfile(item.row.id);
        else global.Pages.invoices.showInvoice(item.row.id);
      },
    });
    holder.appendChild(picker.el);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); picker.focus(); }
    });
  }

  function startClock() {
    const el = document.getElementById('clock');
    const tick = () => {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      el.textContent = `${global.Jalali.weekdayName(global.Jalali.todayIso())} ${global.Jalali.isoToJalaliLong(global.Jalali.todayIso())} — ${time}`;
    };
    tick();
    setInterval(tick, 20000);
  }

  const refreshBadges = guard(async () => {
    const rem = await call('checks.reminders', { days: 7 }, { silent: true });
    badges.checks = rem.overdue.length;
    drawNav();
  });

  // ── راه‌اندازی اولیه (اولین اجرا) ──────────────────────────
  function setupWizard(onDone) {
    let step = 0;
    const shopName = h('input', { type: 'text', placeholder: 'مثلاً سوپرمارکت میلاد' });
    const phone = h('input', { type: 'text', class: 'num' });
    const address = h('input', { type: 'text' });
    const vat = h('input', { type: 'text', class: 'num', value: '10' });
    const currency = global.UI.select([{ value: 'تومان', label: 'تومان' }, { value: 'ریال', label: 'ریال' }], 'تومان');
    const cash = global.UI.moneyInput({ hideHint: true });
    const bank = global.UI.moneyInput({ hideHint: true });
    const pos = global.UI.moneyInput({ hideHint: true });

    const steps = h('div', { class: 'steps' }, [h('span', { class: 'on' }), h('span'), h('span')]);
    const body = h('div');
    const footer = h('div', { class: 'inline', style: 'justify-content:space-between;margin-top:18px' });
    const card = h('div', { class: 'card' }, [
      h('h2', { text: 'خوش آمدید' }),
      h('p', { class: 'lead', text: 'برای شروع، چند اطلاعات ساده از فروشگاه شما لازم است.' }),
      steps, body, footer,
    ]);
    const overlay = h('div', { id: 'setup' }, [card]);
    document.body.appendChild(overlay);

    function draw() {
      steps.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i <= step));
      body.innerHTML = '';
      footer.innerHTML = '';
      if (step === 0) {
        body.appendChild(global.UI.field('نام فروشگاه *', shopName));
        body.appendChild(h('div', { style: 'height:12px' }));
        body.appendChild(h('div', { class: 'form-row c2' }, [
          global.UI.field('تلفن', phone),
          global.UI.field('واحد پول', currency),
        ]));
        body.appendChild(global.UI.field('نشانی', address));
      } else if (step === 1) {
        body.appendChild(global.UI.field('نرخ مالیات بر ارزش افزوده (٪)', vat, 'برای فاکتورهای فروش استفاده می‌شود و بعداً قابل تغییر است.'));
        body.appendChild(h('div', { class: 'hint', style: 'margin-top:10px', text: 'اگر مشمول ارزش افزوده نیستید، عدد صفر را وارد کنید.' }));
      } else {
        body.appendChild(h('p', { class: 'muted', style: 'margin-top:0', text: 'اگر در حال حاضر موجودی نقدی دارید، وارد کنید تا مانده حساب‌ها درست باشد. می‌توانید خالی بگذارید.' }));
        body.appendChild(h('div', { class: 'form-row c3' }, [
          global.UI.field('موجودی صندوق', cash),
          global.UI.field('موجودی بانک', bank),
          global.UI.field('مانده کارتخوان', pos),
        ]));
      }
      footer.appendChild(step > 0
        ? h('button', { class: 'btn', text: 'مرحله قبل', onclick: () => { step -= 1; draw(); } })
        : h('span'));
      footer.appendChild(h('button', {
        class: 'btn primary',
        text: step < 2 ? 'مرحله بعد' : 'شروع کار با برنامه',
        onclick: guard(async () => {
          if (step === 0 && !shopName.value.trim()) { global.UI.toast('نام فروشگاه را وارد کنید.', 'warn'); return; }
          if (step < 2) { step += 1; draw(); return; }
          const s = await call('app.setup.complete', {
            shop_name: shopName.value.trim(),
            shop_phone: phone.value.trim(),
            shop_address: address.value.trim(),
            vat_rate: global.U.parseNumber(vat.value),
            currency: currency.value,
            opening: { 101: cash.value, 103: bank.value, 102: pos.value },
          });
          global.U.state.settings = s;
          global.U.state.currency = s.currency || 'تومان';
          overlay.remove();
          refreshBrand();
          global.UI.toast('راه‌اندازی کامل شد. موفق باشید!', 'ok');
          onDone();
        }),
      }));
    }
    draw();
    setTimeout(() => shopName.focus(), 100);
  }

  // ── شروع برنامه ───────────────────────────────────────────
  const boot = guard(async () => {
    const info = await call('app.info');
    global.U.state.info = info;
    global.U.state.settings = info.settings;
    global.U.state.currency = info.settings.currency || 'تومان';
    document.getElementById('brandVersion').textContent = 'نسخه ' + info.version;
    document.getElementById('demoFlag').hidden = !info.demoMode;
    refreshBrand();
    startClock();
    buildGlobalSearch();
    drawNav();

    if (info.settings.setup_done !== '1') {
      setupWizard(() => { go('dashboard'); refreshBadges(); });
      return;
    }
    await go('dashboard');
    refreshBadges();
  });

  global.api.on('app:reload', () => window.location.reload());

  window.addEventListener('error', (e) => {
    call('app.log', { message: String(e.message), detail: String(e.error && e.error.stack) }, { silent: true });
  });
  window.addEventListener('unhandledrejection', (e) => {
    call('app.log', { message: 'Promise رد شد: ' + String(e.reason && e.reason.message), detail: String(e.reason && e.reason.stack) }, { silent: true });
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      const map = { 1: 'dashboard', 2: 'sale', 3: 'purchase', 4: 'products', 5: 'customers', 6: 'treasury', 7: 'checks', 8: 'reports' };
      if (map[e.key]) { e.preventDefault(); go(map[e.key]); }
    }
  });

  let booted = false;
  function bootOnce() { if (booted) return; booted = true; boot(); }

  global.App = { go, onLeave, refreshBrand, refreshBadges, boot: bootOnce };
  document.addEventListener('DOMContentLoaded', bootOnce);
  if (document.readyState !== 'loading') bootOnce();
}(window));
