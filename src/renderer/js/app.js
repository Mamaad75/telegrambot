'use strict';
/* پوسته برنامه: منو، مسیریابی، راه‌اندازی اولیه و اطلاعات مشترک */
(function (w) {
  const U = w.U;
  const API = w.API;

  const App = {
    info: null,
    settings: {},
    route: 'dashboard',
    params: {},
    cache: {}
  };

  const MENU = [
    { group: 'اصلی' },
    { route: 'dashboard', label: 'داشبورد', icon: '🏠' },
    { route: 'sales', label: 'فروش', icon: '🧾' },
    { route: 'purchases', label: 'خرید', icon: '📥' },
    { route: 'returns', label: 'برگشتی‌ها', icon: '↩️' },
    { group: 'انبار' },
    { route: 'products', label: 'کالاها', icon: '📦' },
    { route: 'inventory', label: 'انبار و موجودی', icon: '🏬' },
    { group: 'خزانه‌داری' },
    { route: 'treasury', label: 'دریافت و پرداخت', icon: '💵' },
    { route: 'checks', label: 'چک‌ها', icon: '🧿', badge: 'checks' },
    { route: 'banks', label: 'حساب‌های بانکی', icon: '🏦' },
    { route: 'cashbook', label: 'هزینه، درآمد، انتقال', icon: '📒' },
    { group: 'طرف‌حساب‌ها' },
    { route: 'customers', label: 'مشتریان', icon: '👤' },
    { route: 'suppliers', label: 'تأمین‌کنندگان', icon: '🚚' },
    { group: 'گزارش و حسابداری' },
    { route: 'reports', label: 'گزارش‌ها', icon: '📊' },
    { route: 'accounting', label: 'دفاتر حسابداری', icon: '📚' },
    { group: 'سیستم' },
    { route: 'settings', label: 'تنظیمات', icon: '⚙️' },
    { route: 'backup', label: 'پشتیبان‌گیری', icon: '💾' }
  ];

  function renderSidebar() {
    const logo = App.settings.shop_logo;
    U.$('#sidebar').innerHTML =
      '<div class="brand"><div class="logo">' +
      (logo ? '<img src="' + U.esc(logo) + '" alt="">' : '🧮') + '</div>' +
      '<div class="name">' + U.esc(App.settings.shop_name || 'حسابداری فروشگاه') + '</div></div>' +
      '<nav class="nav">' + MENU.map(function (m) {
        if (m.group) return '<div class="nav-group">' + U.esc(m.group) + '</div>';
        return '<a data-route="' + m.route + '"><span class="ico">' + m.icon + '</span>' +
          '<span>' + U.esc(m.label) + '</span>' +
          (m.badge ? '<span class="badge-count" data-badge="' + m.badge + '" hidden></span>' : '') + '</a>';
      }).join('') + '</nav>';

    U.$('#sidebar').addEventListener('click', function (e) {
      const a = e.target.closest('[data-route]');
      if (a) App.go(a.dataset.route);
    });
  }

  function markActive() {
    U.$$('#sidebar .nav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === App.route.split('/')[0]);
    });
  }

  async function refreshBadges() {
    const s = await API.safe('checks.summary', {}, true);
    if (!s) return;
    const el = U.$('[data-badge="checks"]');
    if (!el) return;
    const n = (s.due_soon.c || 0) + (s.overdue_received.c || 0) + (s.overdue_issued.c || 0);
    if (n > 0) { el.hidden = false; el.textContent = w.Fmt.toFaDigits(n); }
    else el.hidden = true;
  }

  App.go = function (route, params) {
    App.route = route || 'dashboard';
    App.params = params || {};
    markActive();
    render();
  };

  App.reload = function () { render(); };

  async function render() {
    const parts = App.route.split('/');
    const pageName = parts[0];
    const page = w.Pages[pageName];
    const content = U.$('#content');
    if (!page) {
      content.innerHTML = '<div class="empty"><div class="big">🚧</div>این بخش یافت نشد.</div>';
      return;
    }
    U.$('#pageTitle').textContent = page.title || '';
    content.innerHTML = U.loading();
    App.setTitle = function (t) { U.$('#pageTitle').textContent = t; };
    content.scrollTop = 0;
    try {
      await page.render(content, { sub: parts[1] || null, id: parts[2] ? parseInt(parts[2], 10) : null, params: App.params });
      U.enhance(content);
    } catch (e) {
      content.innerHTML = '<div class="alert error">خطا در نمایش صفحه: ' + U.esc(e.message) + '</div>';
      console.error(e);
    }
    refreshBadges();
  }

  /* ------------------------- راه‌اندازی اولیه ------------------------- */
  function setupWizard() {
    document.body.innerHTML =
      '<div class="setup-wrap"><div class="setup-card">' +
      '<h2>به نرم‌افزار حسابداری فروشگاه خوش آمدید</h2>' +
      '<p class="lead">برای شروع، چند اطلاعات پایه را وارد کنید. همه این موارد بعداً از بخش تنظیمات قابل تغییر است.</p>' +
      '<div id="setupForm">' +
      '<div class="field"><label class="req">نام فروشگاه</label><input type="text" name="shop_name" placeholder="مثلاً سوپرمارکت آفتاب" autofocus></div>' +
      '<div class="row"><div class="field"><label>تلفن</label><input type="text" name="shop_phone" class="ltr"></div>' +
      '<div class="field"><label>کد اقتصادی</label><input type="text" name="economic_code" class="ltr"></div></div>' +
      '<div class="field"><label>نشانی</label><input type="text" name="shop_address"></div>' +
      '<div class="row"><div class="field"><label>واحد پول</label><select name="currency">' +
      '<option value="تومان">تومان</option><option value="ریال">ریال</option></select></div>' +
      '<div class="field"><label>نرخ مالیات بر ارزش افزوده (٪)</label><input type="text" name="vat_rate" value="10" class="num"></div></div>' +
      '<div class="field"><label>موجودی نقدی فعلی صندوق</label><input type="text" name="opening_cash" class="money" value="0">' +
      '<div class="hint">اگر الان پول نقدی در صندوق دارید وارد کنید؛ به عنوان سرمایه اولیه ثبت می‌شود.</div></div>' +
      '<div class="field"><label class="checkbox"><input type="checkbox" name="demo"> ثبت چند نمونه کالا و مشتری برای آشنایی با برنامه</label></div>' +
      '<div class="alert info">پایگاه داده شما در پوشه اطلاعات کاربر ویندوز ذخیره می‌شود و با به‌روزرسانی برنامه پاک نمی‌شود.</div>' +
      '<button class="btn lg block" id="setupSave">شروع کار</button>' +
      '</div></div></div>';

    U.bindMoneyInputs(document);
    const form = U.$('#setupForm');
    U.$('#setupSave').addEventListener('click', async function () {
      const name = U.val(form, 'shop_name').trim();
      if (!name) { U.toast('نام فروشگاه را وارد کنید.', 'warn'); return; }
      this.disabled = true;
      this.textContent = 'در حال آماده‌سازی...';
      try {
        await API.call('settings.save', {
          values: {
            shop_name: name,
            shop_phone: U.val(form, 'shop_phone'),
            economic_code: U.val(form, 'economic_code'),
            shop_address: U.val(form, 'shop_address'),
            currency: U.val(form, 'currency'),
            vat_rate: String(U.valNum(form, 'vat_rate') || 0),
            setup_done: '1'
          }
        });
        const cash = U.valMoney(form, 'opening_cash');
        if (cash > 0) {
          await API.call('capital.create', { data: { amount: cash, method: 'cash', description: 'موجودی اولیه صندوق' } });
        }
        if (U.val(form, 'demo')) await createSampleData();
        location.reload();
      } catch (e) {
        U.toast(e.message, 'error');
        this.disabled = false;
        this.textContent = 'شروع کار';
      }
    });
  }

  async function createSampleData() {
    await API.call('bank.create', { data: { title: 'حساب اصلی فروشگاه', kind: 'bank', bank_name: 'ملت', is_default: 1 } });
    await API.call('bank.create', { data: { title: 'کارتخوان فروشگاه', kind: 'pos', bank_name: 'ملت', is_default: 1 } });
    await API.call('party.create', { type: 'customer', data: { name: 'مشتری نمونه', phone: '09120000000' } });
    await API.call('party.create', { type: 'supplier', data: { name: 'تأمین‌کننده نمونه', phone: '09130000000' } });
    await API.call('products.create', { data: { name: 'کالای نمونه ۱', unit: 'عدد', purchase_price: 50000, sale_price: 70000, min_stock: 5 } });
    await API.call('products.create', { data: { name: 'کالای نمونه ۲', unit: 'بسته', purchase_price: 120000, sale_price: 165000, min_stock: 3 } });
  }

  /* ------------------------------ شروع ------------------------------ */
  async function boot() {
    try {
      App.info = await API.call('app.info', {});
      App.settings = await API.call('settings.all', {});
    } catch (e) {
      document.body.innerHTML = '<div class="setup-wrap"><div class="setup-card">' +
        '<h2>خطا در اجرای برنامه</h2><p class="lead">' + U.esc(e.message) + '</p></div></div>';
      return;
    }

    if (App.settings.setup_done !== '1') { setupWizard(); return; }

    U.setCurrency(App.settings.currency);
    document.title = (App.settings.shop_name || 'حسابداری') + ' — نرم‌افزار حسابداری فروشگاهی';
    renderSidebar();
    U.$('#topDate').textContent = App.info.today_long;

    // جست‌وجوی سراسری
    const gs = U.$('#globalSearch');
    gs.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && this.value.trim()) globalSearch(this.value.trim());
      if (e.key === 'Escape') this.value = '';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'F1') { e.preventDefault(); App.go('sales/new'); }
      if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); gs.focus(); gs.select(); }
    });

    API.on('app:navigate', function (d) { App.go(d.route); });
    API.on('app:notice', function (d) {
      if (d.kind === 'checks') {
        U.toast(d.message, d.overdue ? 'warn' : '', 8000);
      }
    });

    App.go('dashboard');
  }

  /** جست‌وجوی سراسری: کالا، مشتری، فاکتور، چک */
  async function globalSearch(term) {
    const [prods, custs, sale, purchase, chks] = await Promise.all([
      API.safe('products.search', { term: term, limit: 8 }, true),
      API.safe('party.list', { type: 'customer', search: term, limit: 8, withBalance: false }, true),
      API.safe('sales.list', { search: term, limit: 8 }, true),
      API.safe('purchases.list', { search: term, limit: 8 }, true),
      API.safe('checks.list', { search: term, limit: 8 }, true)
    ]);

    let body = '';
    const sec = function (title, rows) {
      if (!rows || !rows.length) return '';
      return '<div style="margin-bottom:14px"><div class="bold" style="margin-bottom:5px">' + title + '</div>' +
        '<table class="data compact"><tbody>' + rows.join('') + '</tbody></table></div>';
    };

    body += sec('کالاها', (prods || []).map(function (p) {
      return '<tr class="clickable" data-go="products" data-id="' + p.id + '"><td class="name">' + U.esc(p.name) + '</td>' +
        '<td>' + U.esc(p.code || '') + '</td><td>موجودی: ' + U.qty(p.stock_qty) + '</td>' +
        '<td class="money">' + U.money(p.sale_price) + '</td></tr>';
    }));
    body += sec('مشتریان', (custs || []).map(function (c) {
      return '<tr class="clickable" data-go="customers" data-id="' + c.id + '"><td class="name">' + U.esc(c.name) + '</td>' +
        '<td>' + U.esc(c.phone || '') + '</td></tr>';
    }));
    body += sec('فاکتورهای فروش', (sale || []).map(function (s) {
      return '<tr class="clickable" data-go="sales" data-id="' + s.id + '"><td>' + U.esc(s.invoice_no) + '</td>' +
        '<td>' + U.esc(s.date_jalali) + '</td><td class="name">' + U.esc(s.customer_name || 'متفرقه') + '</td>' +
        '<td class="money">' + U.money(s.total) + '</td></tr>';
    }));
    body += sec('فاکتورهای خرید', (purchase || []).map(function (s) {
      return '<tr class="clickable" data-go="purchases" data-id="' + s.id + '"><td>' + U.esc(s.invoice_no) + '</td>' +
        '<td>' + U.esc(s.date_jalali) + '</td><td class="name">' + U.esc(s.supplier_name || '') + '</td>' +
        '<td class="money">' + U.money(s.total) + '</td></tr>';
    }));
    body += sec('چک‌ها', (chks || []).map(function (c) {
      return '<tr class="clickable" data-go="checks" data-id="' + c.id + '"><td>' + U.esc(c.check_code) + '</td>' +
        '<td class="name">' + U.esc(c.holder_name || c.party_name || '') + '</td>' +
        '<td>' + U.esc(c.due_date_jalali) + '</td><td class="money">' + U.money(c.amount) + '</td>' +
        '<td><span class="tag">' + U.esc(c.status_label) + '</span></td></tr>';
    }));

    if (!body) body = '<div class="empty"><div class="big">🔍</div>نتیجه‌ای برای «' + U.esc(term) + '» یافت نشد.</div>';

    U.modal({
      title: 'نتایج جست‌وجو: ' + term,
      size: 'lg',
      body: body,
      buttons: [{ label: 'بستن', value: null, cls: 'secondary' }],
      onOpen: function (m, close) {
        m.addEventListener('click', function (e) {
          const tr = e.target.closest('[data-go]');
          if (!tr) return;
          close(null);
          App.go(tr.dataset.go, { focusId: parseInt(tr.dataset.id, 10) });
        });
      }
    });
  }

  App.globalSearch = globalSearch;
  App.refreshSettings = async function () {
    App.settings = await API.call('settings.all', {});
    U.setCurrency(App.settings.currency);
    renderSidebar();
    markActive();
  };

  w.App = App;
  w.Pages = w.Pages || {};
  document.addEventListener('DOMContentLoaded', boot);
})(window);
