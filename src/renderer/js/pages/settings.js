'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  w.Pages.settings = {
    title: 'تنظیمات',
    render: async function (root) {
      const s = await API.call('settings.all', {});
      const info = await API.call('app.info', {});

      root.innerHTML =
        '<div class="grid c2">' +

        '<div class="card"><div class="card-head"><h3>🏪 مشخصات فروشگاه</h3></div><div class="card-body">' +
        '<div class="field"><label class="req">نام فروشگاه</label><input type="text" name="shop_name" value="' + U.esc(s.shop_name) + '"></div>' +
        '<div class="row"><div class="field"><label>تلفن</label><input type="text" name="shop_phone" class="ltr" value="' + U.esc(s.shop_phone) + '"></div>' +
        '<div class="field"><label>کد اقتصادی</label><input type="text" name="economic_code" class="ltr" value="' + U.esc(s.economic_code) + '"></div></div>' +
        '<div class="field"><label>نشانی</label><textarea name="shop_address">' + U.esc(s.shop_address) + '</textarea></div>' +
        '<div class="field"><label>لوگوی فروشگاه (روی فاکتور چاپ می‌شود)</label>' +
        '<div class="inline"><button class="btn secondary sm" id="pickLogo">انتخاب تصویر</button>' +
        '<button class="btn ghost sm" id="clearLogo">حذف لوگو</button>' +
        '<span id="logoPreview">' + (s.shop_logo ? '<img src="' + U.esc(s.shop_logo) + '" style="max-height:44px;border-radius:6px">' : '<span class="muted small">بدون لوگو</span>') + '</span>' +
        '</div><div class="hint">حداکثر حجم ۱ مگابایت. تصویر داخل پایگاه داده ذخیره می‌شود.</div></div>' +
        '</div></div>' +

        '<div class="card"><div class="card-head"><h3>💰 مالی و مالیات</h3></div><div class="card-body">' +
        '<div class="row"><div class="field"><label>واحد پول</label><select name="currency">' +
        '<option value="تومان"' + (s.currency === 'تومان' ? ' selected' : '') + '>تومان</option>' +
        '<option value="ریال"' + (s.currency === 'ریال' ? ' selected' : '') + '>ریال</option></select></div>' +
        '<div class="field"><label>نرخ مالیات بر ارزش افزوده (٪)</label><input type="text" name="vat_rate" class="num" value="' + U.esc(s.vat_rate) + '"></div></div>' +
        '<div class="field"><label>نحوه ثبت مالیات خرید</label><select name="purchase_vat_mode">' +
        '<option value="reclaim"' + (s.purchase_vat_mode === 'reclaim' ? ' selected' : '') + '>قابل تهاتر با مالیات فروش (حساب ۲۰۲)</option>' +
        '<option value="cost"' + (s.purchase_vat_mode === 'cost' ? ' selected' : '') + '>افزودن به بهای تمام‌شده کالا</option></select>' +
        '<div class="hint">اگر مؤدی مالیات بر ارزش افزوده هستید گزینه اول را انتخاب کنید.</div></div>' +
        '<div class="field"><label>روش پرداخت پیش‌فرض</label><select name="default_payment_method">' +
        ['cash', 'pos', 'bank', 'card', 'check'].map(function (k) {
          return '<option value="' + k + '"' + (s.default_payment_method === k ? ' selected' : '') + '>' +
            U.esc(App.info.constants.pay_method_label[k]) + '</option>';
        }).join('') + '</select></div>' +
        '<label class="checkbox"><input type="checkbox" name="allow_negative_stock"' + (s.allow_negative_stock === '1' ? ' checked' : '') + '>' +
        ' اجازه فروش بیشتر از موجودی (موجودی منفی)</label>' +
        '<div class="hint">در حالت عادی خاموش بماند تا از اشتباه در فروش جلوگیری شود.</div>' +
        '</div></div>' +

        '<div class="card"><div class="card-head"><h3>🔢 شماره‌گذاری اسناد</h3></div><div class="card-body">' +
        '<div class="row"><div class="field"><label>پیشوند فاکتور فروش</label><input type="text" name="sale_prefix" class="ltr" value="' + U.esc(s.sale_prefix) + '"></div>' +
        '<div class="field"><label>پیشوند فاکتور خرید</label><input type="text" name="purchase_prefix" class="ltr" value="' + U.esc(s.purchase_prefix) + '"></div></div>' +
        '<div class="row"><div class="field"><label>پیشوند برگشت از فروش</label><input type="text" name="sale_return_prefix" class="ltr" value="' + U.esc(s.sale_return_prefix) + '"></div>' +
        '<div class="field"><label>پیشوند برگشت از خرید</label><input type="text" name="purchase_return_prefix" class="ltr" value="' + U.esc(s.purchase_return_prefix) + '"></div></div>' +
        '<div class="row"><div class="field"><label>پیشوند سند دریافت</label><input type="text" name="receipt_prefix" class="ltr" value="' + U.esc(s.receipt_prefix) + '"></div>' +
        '<div class="field"><label>پیشوند سند پرداخت</label><input type="text" name="payment_prefix" class="ltr" value="' + U.esc(s.payment_prefix) + '"></div></div>' +
        '<div class="field"><label>تعداد ارقام شماره سند</label><input type="text" name="number_padding" class="num" value="' + U.esc(s.number_padding) + '"></div>' +
        '<div class="hint">کد یکتای چک‌ها همیشه به شکل CHK-R-000001 (دریافتی) و CHK-P-000001 (صادره) ساخته می‌شود.</div>' +
        '</div></div>' +

        '<div class="card"><div class="card-head"><h3>🖨 چاپ و یادآوری</h3></div><div class="card-body">' +
        '<div class="field"><label>اندازه پیش‌فرض چاپ فاکتور</label><select name="print_size">' +
        '<option value="a5"' + (s.print_size === 'a5' ? ' selected' : '') + '>A5 (نصف کاغذ A4)</option>' +
        '<option value="a4"' + (s.print_size === 'a4' ? ' selected' : '') + '>A4 (کاغذ معمولی)</option>' +
        '<option value="thermal"' + (s.print_size === 'thermal' ? ' selected' : '') + '>فیش حرارتی ۸۰ میلی‌متری</option></select></div>' +
        '<div class="hint">این اندازه هنگام زدن دکمه «چاپ فاکتور» استفاده می‌شود. ' +
        'در همان پنجره فاکتور هم می‌توانید هر بار اندازه دیگری را انتخاب کنید.</div>' +
        '<div class="field"><label>یادآوری چک چند روز قبل از سررسید</label>' +
        '<input type="text" name="check_reminder_days" class="num" value="' + U.esc(s.check_reminder_days) + '"></div>' +
        '<div class="alert info">هنگام اجرای برنامه، چک‌های نزدیک سررسید و سررسید گذشته به شما یادآوری می‌شود.</div>' +
        '</div></div>' +

        '<div class="card"><div class="card-head"><h3>💾 پشتیبان‌گیری خودکار</h3></div><div class="card-body">' +
        '<label class="checkbox"><input type="checkbox" name="auto_backup"' + (s.auto_backup === '1' ? ' checked' : '') + '>' +
        ' پشتیبان‌گیری خودکار فعال باشد</label>' +
        '<div class="row mt"><div class="field"><label>فاصله پشتیبان‌گیری (روز)</label>' +
        '<input type="text" name="auto_backup_days" class="num" value="' + U.esc(s.auto_backup_days) + '"></div>' +
        '<div class="field"><label>تعداد نسخه‌های نگهداری‌شده</label>' +
        '<input type="text" name="backup_keep" class="num" value="' + U.esc(s.backup_keep) + '"></div></div>' +
        '<div class="field"><label>پوشه پشتیبان</label>' +
        '<div class="inline"><input type="text" id="backupDir" value="' + U.esc(s.backup_dir || info.backup_dir) + '" readonly>' +
        '<button class="btn secondary sm" id="pickDir" style="flex:0 0 auto">تغییر</button></div></div>' +
        '</div></div>' +

        '<div class="card"><div class="card-head"><h3>ℹ اطلاعات برنامه</h3></div><div class="card-body">' +
        '<div class="kv">' +
        '<span class="k">نسخه برنامه</span><span class="v">' + U.esc(info.version) + '</span>' +
        '<span class="k">محل پایگاه داده</span><span class="v small" style="direction:ltr;word-break:break-all">' + U.esc(info.db_file) + '</span>' +
        '<span class="k">محل پشتیبان‌ها</span><span class="v small" style="direction:ltr;word-break:break-all">' + U.esc(info.backup_dir) + '</span>' +
        '<span class="k">فایل گزارش خطا</span><span class="v small" style="direction:ltr;word-break:break-all">' + U.esc(info.log_file) + '</span>' +
        '<span class="k">حالت اجرا</span><span class="v">' + (info.portable ? 'قابل حمل (Portable)' : 'نصب‌شده') + '</span>' +
        '<span class="k">تاریخ امروز</span><span class="v">' + U.esc(info.today_long) + '</span>' +
        '</div>' +
        '<div class="btn-group mt"><button class="btn secondary sm" id="openData">باز کردن پوشه داده‌ها</button>' +
        '<button class="btn secondary sm" id="openLog">نمایش فایل گزارش</button></div>' +
        '<div class="alert info mt">پایگاه داده و پشتیبان‌ها خارج از پوشه نصب برنامه ذخیره می‌شوند؛ ' +
        'بنابراین با به‌روزرسانی یا نصب مجدد برنامه، اطلاعات شما پاک نمی‌شود.</div>' +
        '</div></div>' +

        '</div>' +
        '<div class="btn-group"><button class="btn lg" id="save">ذخیره تنظیمات</button>' +
        '<button class="btn ghost" id="reload">بازگردانی مقادیر</button></div>';

      U.enhance(root);

      root.querySelector('#pickLogo').addEventListener('click', async function () {
        const url = await API.safe('settings.pickLogo', {});
        if (url) {
          root.querySelector('#logoPreview').innerHTML = '<img src="' + U.esc(url) + '" style="max-height:44px;border-radius:6px">';
          await App.refreshSettings();
          U.toast('لوگو ذخیره شد.', 'success');
        }
      });
      root.querySelector('#clearLogo').addEventListener('click', async function () {
        await API.safe('settings.save', { values: { shop_logo: '' } });
        root.querySelector('#logoPreview').innerHTML = '<span class="muted small">بدون لوگو</span>';
        await App.refreshSettings();
      });
      root.querySelector('#pickDir').addEventListener('click', async function () {
        const dir = await API.safe('backup.chooseDir', {});
        if (dir) { root.querySelector('#backupDir').value = dir; U.toast('پوشه پشتیبان تغییر کرد.', 'success'); }
      });
      root.querySelector('#openData').addEventListener('click', function () {
        API.safe('app.openPath', { path: info.db_file.replace(/[\\/][^\\/]+$/, '') });
      });
      root.querySelector('#openLog').addEventListener('click', function () {
        API.safe('app.showItem', { path: info.log_file });
      });
      root.querySelector('#reload').addEventListener('click', function () { App.reload(); });

      root.querySelector('#save').addEventListener('click', async function () {
        const keys = ['shop_name', 'shop_phone', 'economic_code', 'shop_address', 'currency', 'vat_rate',
          'purchase_vat_mode', 'default_payment_method', 'sale_prefix', 'purchase_prefix',
          'sale_return_prefix', 'purchase_return_prefix', 'receipt_prefix', 'payment_prefix',
          'number_padding', 'print_size', 'check_reminder_days', 'auto_backup_days', 'backup_keep'];
        const values = {};
        keys.forEach(function (k) { values[k] = U.val(root, k); });
        values.allow_negative_stock = U.val(root, 'allow_negative_stock') ? '1' : '0';
        values.auto_backup = U.val(root, 'auto_backup') ? '1' : '0';
        values.backup_dir = root.querySelector('#backupDir').value;
        if (!values.shop_name.trim()) { U.toast('نام فروشگاه الزامی است.', 'warn'); return; }
        this.disabled = true;
        try {
          await API.call('settings.save', { values: values });
          await App.refreshSettings();
          U.toast('تنظیمات ذخیره شد.', 'success');
        } catch (e) { U.toast(e.message, 'error'); }
        this.disabled = false;
      });
    }
  };
})(window);
