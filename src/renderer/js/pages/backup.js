'use strict';
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  function fileSize(b) {
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' مگابایت';
    if (b > 1024) return (b / 1024).toFixed(0) + ' کیلوبایت';
    return b + ' بایت';
  }

  w.Pages.backup = {
    title: 'پشتیبان‌گیری و بازیابی',
    render: async function (root) {
      const info = await API.call('app.info', {});

      root.innerHTML =
        '<div class="grid c3 mb" id="sum"></div>' +
        '<div class="card"><div class="card-head"><h3>عملیات</h3></div><div class="card-body">' +
        '<div class="btn-group">' +
        '<button class="btn" id="makeBackup">💾 ساخت نسخه پشتیبان جدید</button>' +
        '<button class="btn secondary" id="restoreFile">📂 بازیابی از فایل دیگر</button>' +
        '<button class="btn secondary" id="changeDir">تغییر پوشه پشتیبان</button>' +
        '<button class="btn secondary" id="openDir">باز کردن پوشه</button>' +
        '<button class="btn secondary" id="checkHealth">بررسی سلامت پایگاه داده</button>' +
        '</div>' +
        '<div class="alert info mt">' +
        'پوشه فعلی پشتیبان: <span style="direction:ltr;display:inline-block" id="dirLabel">' + U.esc(info.backup_dir) + '</span><br>' +
        'پیش از هر بازیابی، یک نسخه ایمنی از وضعیت فعلی به‌طور خودکار گرفته می‌شود؛ بنابراین بازیابی هرگز اطلاعات فعلی را برای همیشه از بین نمی‌برد.' +
        '</div></div></div>' +
        '<div class="card"><div class="card-head"><h3>نسخه‌های پشتیبان موجود</h3><span class="spacer"></span>' +
        '<span class="small muted" id="cnt"></span></div>' +
        '<div class="card-body tight"><div class="table-wrap"><table class="data" id="tbl"><thead><tr>' +
        '<th class="name">نام فایل</th><th>تاریخ</th><th>حجم</th><th>عملیات</th></tr></thead><tbody></tbody></table></div></div></div>';

      async function load() {
        const r = await API.call('backup.list', {});
        root.querySelector('#dirLabel').textContent = r.dir;
        root.querySelector('#cnt').textContent = w.Fmt.toFaDigits(r.items.length) + ' نسخه';
        const totalSize = r.items.reduce(function (a, x) { return a + x.size; }, 0);
        const last = r.items[0];
        root.querySelector('#sum').innerHTML =
          '<div class="stat accent"><div class="label">تعداد نسخه‌های پشتیبان</div><div class="value">' + w.Fmt.toFaDigits(r.items.length) + '</div></div>' +
          '<div class="stat accent-green"><div class="label">آخرین پشتیبان</div><div class="value" style="font-size:15px">' +
          (last ? U.esc(last.mtime_jalali) : 'ندارد') + '</div>' +
          (last ? '<div class="sub">' + U.esc(fileSize(last.size)) + '</div>' : '') + '</div>' +
          '<div class="stat"><div class="label">حجم کل پشتیبان‌ها</div><div class="value" style="font-size:15px">' +
          U.esc(fileSize(totalSize)) + '</div></div>';

        root.querySelector('#tbl tbody').innerHTML = r.items.length ? r.items.map(function (b) {
          return '<tr data-file="' + U.esc(b.file) + '">' +
            '<td class="name small" style="direction:ltr">' + U.esc(b.name) + '</td>' +
            '<td>' + U.esc(b.mtime_jalali) + '</td>' +
            '<td class="small">' + U.esc(fileSize(b.size)) + '</td>' +
            '<td class="actions">' +
            '<button class="btn ghost sm" data-verify>بررسی</button>' +
            '<button class="btn secondary sm" data-restore>بازیابی</button>' +
            '<button class="btn ghost sm" data-del>حذف</button></td></tr>';
        }).join('') : U.emptyRow(4, 'هنوز نسخه پشتیبانی ساخته نشده است.', '💾');
      }

      async function doRestore(file) {
        const v = await API.safe('backup.verify', { file: file });
        if (!v) return;
        if (!v.ok) { U.alert(v.error, 'فایل پشتیبان معتبر نیست', 'error'); return; }
        const ok = await U.confirm(
          'اطلاعات فعلی برنامه با محتوای این نسخه پشتیبان جایگزین شود؟',
          {
            danger: true,
            confirmLabel: 'بله، بازیابی کن',
            detail: 'محتوای نسخه پشتیبان: ' +
              w.Fmt.toFaDigits(v.stats.products) + ' کالا، ' +
              w.Fmt.toFaDigits(v.stats.sales) + ' فاکتور فروش، ' +
              w.Fmt.toFaDigits(v.stats.purchases) + ' فاکتور خرید، ' +
              w.Fmt.toFaDigits(v.stats.checks) + ' چک، ' +
              w.Fmt.toFaDigits(v.stats.entries) + ' سند حسابداری.\n' +
              'پیش از بازیابی، یک نسخه ایمنی از وضعیت فعلی ساخته می‌شود.'
          });
        if (!ok) return;
        try {
          const r = await API.call('backup.restore', { file: file });
          await U.alert('بازیابی با موفقیت انجام شد.\nنسخه ایمنی وضعیت قبلی: ' +
            (r.safety_backup ? r.safety_backup.name : '—'), 'بازیابی موفق', 'success');
          location.reload();
        } catch (e) { U.toast(e.message, 'error'); }
      }

      root.querySelector('#makeBackup').addEventListener('click', async function () {
        this.disabled = true;
        const r = await API.safe('backup.create', { tag: 'manual' });
        this.disabled = false;
        if (r) { U.toast('نسخه پشتیبان ساخته شد: ' + r.name, 'success'); load(); }
      });

      root.querySelector('#restoreFile').addEventListener('click', async function () {
        const file = await API.safe('backup.chooseFile', {});
        if (file) doRestore(file);
      });

      root.querySelector('#changeDir').addEventListener('click', async function () {
        const dir = await API.safe('backup.chooseDir', {});
        if (dir) { U.toast('پوشه پشتیبان تغییر کرد.', 'success'); load(); }
      });

      root.querySelector('#openDir').addEventListener('click', async function () {
        const r = await API.call('backup.list', {});
        API.safe('app.openPath', { path: r.dir });
      });

      root.querySelector('#checkHealth').addEventListener('click', async function () {
        const h = await API.safe('app.integrity', {});
        if (!h) return;
        const acc = h.accounting;
        U.modal({
          title: 'بررسی سلامت',
          size: 'sm',
          body:
            '<div class="alert ' + (acc.ok && h.database.ok ? 'success' : 'warn') + '">' +
            (acc.ok && h.database.ok ? 'همه چیز سالم است.' : 'در بررسی، موردی یافت شد که نیاز به توجه دارد.') + '</div>' +
            '<div class="kv">' +
            '<span class="k">جمع بدهکار</span><span class="v money">' + U.money(acc.total_debit) + '</span>' +
            '<span class="k">جمع بستانکار</span><span class="v money">' + U.money(acc.total_credit) + '</span>' +
            '<span class="k">اسناد ناتراز</span><span class="v">' + w.Fmt.toFaDigits(acc.unbalanced_entries.length) + '</span>' +
            '<span class="k">حساب موجودی کالا</span><span class="v money">' + U.money(acc.inventory_gl) + '</span>' +
            '<span class="k">ارزش واقعی انبار</span><span class="v money">' + U.money(acc.inventory_stock_value) + '</span>' +
            '<span class="k">فایل پایگاه داده</span><span class="v">' + (h.database.ok ? 'سالم ✓' : 'مشکل‌دار ✗') + '</span>' +
            '</div>',
          buttons: [{ label: 'بستن', value: null, cls: 'secondary' }]
        });
      });

      root.querySelector('#tbl').addEventListener('click', async function (e) {
        const tr = e.target.closest('tr[data-file]');
        if (!tr) return;
        const file = tr.dataset.file;
        if (e.target.closest('[data-verify]')) {
          const v = await API.safe('backup.verify', { file: file });
          if (!v) return;
          U.alert(v.ok
            ? 'فایل سالم است.\n' +
              w.Fmt.toFaDigits(v.stats.products) + ' کالا، ' +
              w.Fmt.toFaDigits(v.stats.sales) + ' فاکتور فروش، ' +
              w.Fmt.toFaDigits(v.stats.purchases) + ' فاکتور خرید، ' +
              w.Fmt.toFaDigits(v.stats.checks) + ' چک، ' +
              w.Fmt.toFaDigits(v.stats.entries) + ' سند حسابداری.'
            : v.error, 'بررسی نسخه پشتیبان', v.ok ? 'success' : 'error');
        } else if (e.target.closest('[data-restore]')) {
          doRestore(file);
        } else if (e.target.closest('[data-del]')) {
          if (!await U.confirm('این فایل پشتیبان حذف شود؟', { danger: true })) return;
          await API.safe('backup.remove', { file: file });
          U.toast('حذف شد.', 'success');
          load();
        }
      });

      await load();
    }
  };
})(window);
