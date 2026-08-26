/* تنظیمات، پشتیبان‌گیری، انتقال داده و حالت نمایشی */
(function (global) {
  'use strict';
  const { h, fmt, call, guard, parseNumber } = global.U;

  async function render(view) {
    let tab = 'shop';
    const box = h('div');
    const tabs = global.UI.tabs([
      { key: 'shop', title: 'اطلاعات فروشگاه' },
      { key: 'invoice', title: 'فاکتور و مالیات' },
      { key: 'backup', title: 'پشتیبان‌گیری و بازیابی' },
      { key: 'data', title: 'داده‌ها و نگهداری' },
      { key: 'about', title: 'درباره برنامه' },
    ], (k) => { tab = k; load(); });

    view.innerHTML = '';
    view.appendChild(h('div', { class: 'panel' }, [tabs.el, h('div', { class: 'body' }, [box])]));

    const load = guard(async () => {
      box.innerHTML = '';
      box.appendChild(global.UI.loading());
      if (tab === 'shop') await drawShop();
      else if (tab === 'invoice') await drawInvoice();
      else if (tab === 'backup') await drawBackup();
      else if (tab === 'data') await drawData();
      else await drawAbout();
    });

    async function saveSettings(patch) {
      const s = await call('app.settings.set', patch);
      global.U.state.settings = s;
      global.U.state.currency = s.currency || 'تومان';
      global.App.refreshBrand();
      global.UI.toast('تنظیمات ذخیره شد.', 'ok');
      return s;
    }

    async function drawShop() {
      const s = await call('app.settings.get');
      const name = h('input', { type: 'text', value: s.shop_name || '' });
      const phone = h('input', { type: 'text', class: 'num', value: s.shop_phone || '' });
      const address = h('input', { type: 'text', value: s.shop_address || '' });
      const eco = h('input', { type: 'text', class: 'num', value: s.shop_economic_code || '' });
      const currency = global.UI.select([
        { value: 'تومان', label: 'تومان' }, { value: 'ریال', label: 'ریال' },
      ], s.currency || 'تومان');
      const logoPreview = h('div', {
        style: 'width:78px;height:78px;border-radius:12px;border:1px solid var(--line);display:grid;place-items:center;overflow:hidden;background:#f6f9fc',
      });
      function drawLogo(val) {
        logoPreview.innerHTML = '';
        if (val) logoPreview.appendChild(h('img', { src: val, style: 'width:100%;height:100%;object-fit:contain' }));
        else logoPreview.appendChild(h('span', { class: 'muted', text: 'بدون لوگو' }));
      }
      let logoValue = s.shop_logo || '';
      drawLogo(logoValue);
      const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none' });
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > 400 * 1024) { global.UI.toast('حجم تصویر باید کمتر از ۴۰۰ کیلوبایت باشد.', 'warn'); return; }
        const reader = new FileReader();
        reader.onload = () => { logoValue = String(reader.result); drawLogo(logoValue); };
        reader.readAsDataURL(file);
      });

      box.innerHTML = '';
      box.appendChild(h('div', { class: 'form-row c2' }, [
        global.UI.field('نام فروشگاه *', name),
        global.UI.field('تلفن', phone),
      ]));
      box.appendChild(h('div', { class: 'form-row c2' }, [
        global.UI.field('نشانی', address),
        global.UI.field('کد اقتصادی / شناسه مالیاتی', eco),
      ]));
      box.appendChild(h('div', { class: 'form-row c2' }, [
        global.UI.field('واحد پول', currency),
        h('div', { class: 'field' }, [
          h('label', { text: 'لوگوی فروشگاه (روی فاکتور چاپ می‌شود)' }),
          h('div', { class: 'inline' }, [
            logoPreview,
            h('button', { class: 'btn sm', text: 'انتخاب تصویر', onclick: () => fileInput.click() }),
            h('button', { class: 'btn sm ghost', text: 'حذف', onclick: () => { logoValue = ''; drawLogo(''); } }),
            fileInput,
          ]),
        ]),
      ]));
      box.appendChild(h('button', {
        class: 'btn primary',
        text: 'ذخیره تنظیمات',
        onclick: guard(() => saveSettings({
          shop_name: name.value.trim() || 'فروشگاه من',
          shop_phone: phone.value.trim(),
          shop_address: address.value.trim(),
          shop_economic_code: eco.value.trim(),
          currency: currency.value,
          shop_logo: logoValue,
        })),
      }));
    }

    async function drawInvoice() {
      const s = await call('app.settings.get');
      const vatEnabled = h('input', { type: 'checkbox' });
      vatEnabled.checked = s.vat_enabled !== '0';
      const vatRate = h('input', { type: 'text', class: 'num', value: s.vat_rate || '10' });
      const purchaseVat = h('input', { type: 'checkbox' });
      purchaseVat.checked = s.purchase_vat_deductible !== '0';
      const negative = h('input', { type: 'checkbox' });
      negative.checked = s.allow_negative_stock === '1';
      const lowAlert = h('input', { type: 'checkbox' });
      lowAlert.checked = s.low_stock_alert !== '0';
      const salePrefix = h('input', { type: 'text', value: s.sale_prefix || '' });
      const purchasePrefix = h('input', { type: 'text', value: s.purchase_prefix || '' });
      const saleReturnPrefix = h('input', { type: 'text', value: s.sale_return_prefix || '' });
      const purchaseReturnPrefix = h('input', { type: 'text', value: s.purchase_return_prefix || '' });
      const defaultMethod = global.UI.select([
        { value: 'cash', label: 'نقدی' }, { value: 'pos', label: 'کارتخوان' },
        { value: 'bank', label: 'بانک' }, { value: 'credit', label: 'نسیه' },
      ], s.default_payment_method || 'cash');
      const printSize = global.UI.select([
        { value: 'a4', label: 'A4 (چاپگر معمولی)' },
        { value: 'thermal', label: 'حرارتی ۸۰ میلی‌متر (رسید)' },
      ], s.print_size || 'a4');
      const footer = h('input', { type: 'text', value: s.print_footer || '' });

      box.innerHTML = '';
      box.appendChild(h('h3', { text: 'مالیات بر ارزش افزوده', style: 'margin:0 0 10px;font-size:14px' }));
      box.appendChild(h('div', { class: 'form-row c3' }, [
        h('div', { class: 'field' }, [h('label', { text: 'وضعیت' }), h('label', { class: 'check' }, [vatEnabled, h('span', { text: 'محاسبه ارزش افزوده در فاکتور فروش' })])]),
        global.UI.field('نرخ پیش‌فرض (٪)', vatRate),
        h('div', { class: 'field' }, [h('label', { text: 'ارزش افزوده خرید' }), h('label', { class: 'check' }, [purchaseVat, h('span', { text: 'قابل کسر از مالیات فروش' })])]),
      ]));
      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('h3', { text: 'شماره‌گذاری فاکتور', style: 'margin:0 0 10px;font-size:14px' }));
      box.appendChild(h('div', { class: 'form-row c4' }, [
        global.UI.field('پیشوند فروش', salePrefix),
        global.UI.field('پیشوند خرید', purchasePrefix),
        global.UI.field('پیشوند برگشت فروش', saleReturnPrefix),
        global.UI.field('پیشوند برگشت خرید', purchaseReturnPrefix),
      ]));
      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('h3', { text: 'فروش و انبار', style: 'margin:0 0 10px;font-size:14px' }));
      box.appendChild(h('div', { class: 'form-row c3' }, [
        global.UI.field('روش پرداخت پیش‌فرض', defaultMethod),
        h('div', { class: 'field' }, [h('label', { text: 'موجودی منفی' }), h('label', { class: 'check' }, [negative, h('span', { text: 'اجازه فروش بیش از موجودی' })])]),
        h('div', { class: 'field' }, [h('label', { text: 'هشدار موجودی' }), h('label', { class: 'check' }, [lowAlert, h('span', { text: 'نمایش هشدار کمبود موجودی' })])]),
      ]));
      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('h3', { text: 'چاپ', style: 'margin:0 0 10px;font-size:14px' }));
      box.appendChild(h('div', { class: 'form-row c2' }, [
        global.UI.field('اندازه پیش‌فرض چاپ فاکتور', printSize),
        global.UI.field('متن پایین فاکتور', footer),
      ]));
      box.appendChild(h('button', {
        class: 'btn primary',
        text: 'ذخیره تنظیمات',
        onclick: guard(() => saveSettings({
          vat_enabled: vatEnabled.checked ? '1' : '0',
          vat_rate: String(Math.max(0, Math.min(100, parseNumber(vatRate.value)))),
          purchase_vat_deductible: purchaseVat.checked ? '1' : '0',
          allow_negative_stock: negative.checked ? '1' : '0',
          low_stock_alert: lowAlert.checked ? '1' : '0',
          sale_prefix: salePrefix.value,
          purchase_prefix: purchasePrefix.value,
          sale_return_prefix: saleReturnPrefix.value,
          purchase_return_prefix: purchaseReturnPrefix.value,
          default_payment_method: defaultMethod.value,
          print_size: printSize.value,
          print_footer: footer.value,
        })),
      }));
    }

    async function drawBackup() {
      const [s, list] = await Promise.all([call('app.settings.get'), call('backup.list', {})]);
      const auto = h('input', { type: 'checkbox' });
      auto.checked = s.auto_backup !== '0';
      const days = h('input', { type: 'text', class: 'num', value: s.auto_backup_days || '1' });
      const dirLabel = h('code', { text: list.dir, style: 'font-size:12px;direction:ltr;display:inline-block' });

      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid c3', style: 'margin-bottom:14px' }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'label', text: 'تعداد پشتیبان‌ها' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(list.files.length) }), h('small', { text: 'فایل' })]),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'label', text: 'آخرین پشتیبان خودکار' }),
          h('div', { class: 'value', style: 'font-size:16px' }, [h('span', { text: s.last_auto_backup ? fmt.date(s.last_auto_backup) : 'هنوز انجام نشده' })]),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'label', text: 'حجم کل' }),
          h('div', { class: 'value num' }, [h('span', { text: fmt.plain(Math.round(list.files.reduce((a, f) => a + f.size, 0) / 1024)) }), h('small', { text: 'کیلوبایت' })]),
        ]),
      ]));

      box.appendChild(h('div', { class: 'inline', style: 'margin-bottom:14px' }, [
        h('button', {
          class: 'btn success',
          text: '💾 پشتیبان‌گیری فوری',
          onclick: guard(async () => {
            const res = await call('backup.create', { label: 'manual' });
            global.UI.toast('پشتیبان ساخته شد: ' + res.name, 'ok', 5000);
            load();
          }),
        }),
        h('button', {
          class: 'btn',
          text: '📂 تغییر پوشه پشتیبان',
          onclick: guard(async () => {
            const res = await call('backup.chooseDir');
            if (res.canceled) return;
            global.UI.toast('پوشه پشتیبان تغییر کرد.', 'ok');
            load();
          }),
        }),
        h('button', { class: 'btn', text: '🗂 باز کردن پوشه', onclick: guard(() => call('backup.openDir', {})) }),
        h('button', {
          class: 'btn danger',
          text: '♻️ بازیابی از فایل...',
          onclick: guard(async () => {
            const picked = await call('backup.chooseFile');
            if (picked.canceled) return;
            await restoreConfirm(picked.file, picked.info);
          }),
        }),
      ]));

      box.appendChild(h('div', { class: 'form-row c3' }, [
        h('div', { class: 'field' }, [h('label', { text: 'پشتیبان‌گیری خودکار' }), h('label', { class: 'check' }, [auto, h('span', { text: 'هنگام باز شدن برنامه' })])]),
        global.UI.field('فاصله (روز)', days),
        h('div', { class: 'field' }, [
          h('label', { text: 'پوشه پشتیبان' }),
          h('div', {}, [dirLabel]),
        ]),
      ]));
      box.appendChild(h('button', {
        class: 'btn primary',
        style: 'margin-bottom:16px',
        text: 'ذخیره تنظیمات پشتیبان',
        onclick: guard(() => saveSettings({
          auto_backup: auto.checked ? '1' : '0',
          auto_backup_days: String(Math.max(1, parseNumber(days.value) || 1)),
        })),
      }));

      box.appendChild(h('h3', { text: 'فایل‌های پشتیبان', style: 'margin:6px 0 8px;font-size:14px' }));
      box.appendChild(global.UI.table({
        columns: [
          { title: 'نام فایل', key: 'name' },
          { title: 'حجم (کیلوبایت)', type: 'money', render: (r) => Math.round(r.size / 1024) },
          { title: 'تاریخ ساخت', type: 'center', render: (r) => fmt.date(r.mtime.slice(0, 10)) + ' ' + r.mtime.slice(11, 16) },
          {
            title: '',
            type: 'center',
            render: (r) => h('button', {
              class: 'btn sm danger',
              text: 'بازیابی',
              onclick: guard(async () => {
                const info = await call('backup.inspect', { file: r.file });
                await restoreConfirm(r.file, info);
              }),
            }),
          },
        ],
        rows: list.files,
        empty: 'هنوز پشتیبانی ساخته نشده است.',
        emptyIcon: '💾',
      }));
    }

    async function restoreConfirm(file, info) {
      const okC = await global.UI.confirm('بازیابی این پشتیبان انجام شود؟', {
        danger: true,
        okLabel: 'بله، بازیابی کن',
        detail: `اطلاعات فعلی با محتوای پشتیبان جایگزین می‌شود. پیش از بازیابی، یک نسخه ایمنی از وضعیت فعلی ساخته می‌شود.\n`
          + `فروشگاه: ${info.shopName || '—'} | فاکتورها: ${info.invoices} | کالاها: ${info.products} | اسناد: ${info.entries}`,
      });
      if (!okC) return;
      const res = await call('backup.restore', { file });
      global.UI.toast(
        res.check.ok ? 'بازیابی با موفقیت انجام شد.' : 'بازیابی انجام شد ولی هشدارهایی وجود دارد: ' + res.check.problems.join(' | '),
        res.check.ok ? 'ok' : 'warn', 7000,
      );
    }

    async function drawData() {
      const [info, legacy, demoStatus] = await Promise.all([
        call('app.info'), call('legacy.find'), call('demo.status'),
      ]);
      box.innerHTML = '';

      box.appendChild(h('h3', { text: 'بررسی سلامت اطلاعات', style: 'margin:0 0 8px;font-size:14px' }));
      const integrityBox = h('div', { class: 'hint', text: 'برای بررسی توازن دفاتر و سلامت فایل پایگاه داده دکمه زیر را بزنید.' });
      box.appendChild(h('div', { class: 'inline', style: 'margin-bottom:10px' }, [
        h('button', {
          class: 'btn',
          text: '🔍 بررسی سلامت پایگاه داده',
          onclick: guard(async () => {
            const res = await call('backup.integrity');
            integrityBox.innerHTML = '';
            integrityBox.appendChild(h('div', { class: 'tag ' + (res.ok ? 'ok' : 'bad'), text: res.ok ? '✔ همه بررسی‌ها موفق بود' : '✖ مشکلاتی یافت شد' }));
            const details = [
              `جمع بدهکار: ${fmt.plain(res.details.totalDebit)}`,
              `جمع بستانکار: ${fmt.plain(res.details.totalCredit)}`,
              `ارزش انبار: ${fmt.plain(res.details.stockValue)}`,
              `مانده حساب موجودی کالا: ${fmt.plain(res.details.inventoryAccount)}`,
              `تعداد اسناد: ${fmt.plain(res.details.entries)}`,
              `تعداد فاکتورها: ${fmt.plain(res.details.invoices)}`,
            ];
            integrityBox.appendChild(h('ul', { style: 'margin:8px 0 0;padding-inline-start:18px' },
              details.concat(res.problems).map((t) => h('li', { text: t, style: 'font-size:12.5px' }))));
          }),
        }),
      ]));
      box.appendChild(integrityBox);

      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('h3', { text: 'انتقال اطلاعات از نسخه قبلی', style: 'margin:0 0 8px;font-size:14px' }));
      if (!legacy.length) {
        box.appendChild(h('div', { class: 'hint', text: 'پایگاه داده‌ای از نسخه قبلی برنامه پیدا نشد.' }));
      } else {
        for (const f of legacy) {
          box.appendChild(h('div', { class: 'inline', style: 'justify-content:space-between;border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:8px' }, [
            h('div', {}, [
              h('code', { text: f.file, style: 'font-size:11.5px;direction:ltr' }),
              h('div', { class: 'muted', style: 'font-size:12px', text: Object.entries(f.counts).map(([k, v]) => `${k}: ${v}`).join(' · ') }),
            ]),
            h('button', {
              class: 'btn sm primary',
              text: 'انتقال اطلاعات',
              onclick: guard(async () => {
                const okC = await global.UI.confirm('اطلاعات نسخه قبلی وارد شود؟', {
                  detail: 'کالاها، طرف حساب‌ها، تنظیمات و چک‌ها منتقل می‌شوند. فاکتورهای قدیمی به عنوان «اسناد بایگانی» ذخیره می‌گردند و در حسابداری جدید تأثیری ندارند.',
                });
                if (!okC) return;
                const res = await call('legacy.import', { file: f.file });
                global.UI.toast(`انتقال انجام شد: ${res.products} کالا، ${res.parties} طرف حساب، ${res.checks} چک، ${res.documents} سند بایگانی.`, 'ok', 8000);
                load();
              }),
            }),
          ]));
        }
      }
      box.appendChild(h('button', {
        class: 'btn sm',
        text: 'مشاهده اسناد بایگانی نسخه قبلی',
        onclick: guard(async () => {
          const docs = await call('legacy.documents');
          global.UI.modal({
            title: 'اسناد بایگانی نسخه قبلی',
            size: 'wide',
            content: global.UI.table({
              columns: [
                { title: 'نوع', key: 'kind', type: 'center' },
                { title: 'شماره', key: 'invoice_no', type: 'center' },
                { title: 'تاریخ', key: 'date', type: 'center' },
                { title: 'طرف حساب', key: 'party' },
                { title: 'مبلغ', key: 'total', type: 'money' },
                { title: 'روش', key: 'method', type: 'center' },
              ],
              rows: docs,
              empty: 'سند بایگانی وجود ندارد.',
            }),
            cancelLabel: 'بستن',
          });
        }),
      }));

      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('h3', { text: 'حالت نمایشی', style: 'margin:0 0 8px;font-size:14px' }));
      box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px', text: 'در حالت نمایشی، برنامه روی یک پایگاه داده جداگانه با اطلاعات نمونه کار می‌کند. اطلاعات واقعی فروشگاه دست‌نخورده باقی می‌ماند.' }));
      box.appendChild(h('div', { class: 'inline' }, [
        demoStatus.active
          ? h('button', {
            class: 'btn primary',
            text: '↩ بازگشت به اطلاعات واقعی فروشگاه',
            onclick: guard(async () => { await call('demo.disable'); }),
          })
          : h('button', {
            class: 'btn',
            text: '🎬 فعال‌سازی حالت نمایشی',
            onclick: guard(async () => {
              const okC = await global.UI.confirm('حالت نمایشی فعال شود؟', {
                detail: 'برنامه با اطلاعات نمونه باز می‌شود. اطلاعات واقعی شما تغییر نمی‌کند.',
              });
              if (!okC) return;
              await call('demo.enable');
            }),
          }),
      ]));

      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('h3', { text: 'مسیر فایل‌ها', style: 'margin:0 0 8px;font-size:14px' }));
      const paths = [
        ['پایگاه داده', info.dbFile],
        ['پوشه اطلاعات برنامه', info.userData],
        ['پوشه پشتیبان‌ها', info.backupDir],
        ['فایل گزارش خطا', info.logFile],
      ];
      for (const [label, p] of paths) {
        box.appendChild(h('div', { class: 'inline', style: 'justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0' }, [
          h('span', { text: label }),
          h('code', { text: p, style: 'font-size:11.5px;direction:ltr' }),
        ]));
      }
      box.appendChild(h('button', {
        class: 'btn sm',
        style: 'margin-top:10px',
        text: 'باز کردن پوشه اطلاعات',
        onclick: guard(() => call('app.openPath', { path: info.userData })),
      }));
    }

    async function drawAbout() {
      const info = await call('app.info');
      box.innerHTML = '';
      box.appendChild(h('div', { style: 'text-align:center;padding:20px 0' }, [
        h('div', { style: 'font-size:40px' , text: '🧾' }),
        h('h2', { text: 'نرم‌افزار حسابداری فروشگاه', style: 'margin:8px 0 4px' }),
        h('div', { class: 'muted', text: `نسخه ${info.version}` }),
      ]));
      box.appendChild(h('div', { class: 'grid c3' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'نسخه ساختار پایگاه داده' }), h('div', { class: 'value num' }, [h('span', { text: String(info.dbVersion) })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'نسخه Electron' }), h('div', { class: 'value', style: 'font-size:16px' }, [h('span', { text: info.electron })])]),
        h('div', { class: 'stat' }, [h('div', { class: 'label', text: 'تاریخ امروز' }), h('div', { class: 'value', style: 'font-size:16px' }, [h('span', { text: fmt.dateLong(info.today) })])]),
      ]));
      box.appendChild(h('div', { class: 'divider' }));
      box.appendChild(h('div', { class: 'muted', style: 'font-size:12.5px;line-height:2' }, [
        h('div', { text: '• روش قیمت‌گذاری انبار: میانگین موزون متحرک (Weighted Average Cost)' }),
        h('div', { text: '• همه اسناد بر پایه حسابداری دوطرفه ثبت می‌شوند و توازن هر سند پیش از ثبت بررسی می‌گردد.' }),
        h('div', { text: '• برنامه کاملاً آفلاین کار می‌کند و هیچ اطلاعاتی به بیرون ارسال نمی‌شود.' }),
        h('div', { text: '• کلیدهای میان‌بر: F2 جست‌وجوی کالا، F4 ثبت فاکتور، Ctrl+P ثبت و چاپ، Ctrl+B پشتیبان‌گیری.' }),
      ]));
    }

    await load();
  }

  global.Pages = global.Pages || {};
  global.Pages.settings = { title: 'تنظیمات', render };
}(window));
