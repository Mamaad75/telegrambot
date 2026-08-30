'use strict';
/* درون‌ریزی کالا از فایل PDF، اکسل یا CSV — با پیش‌نمایش و تأیید پیش از ثبت */
(function (w) {
  const U = w.U, API = w.API, App = w.App;
  w.Pages = w.Pages || {};

  const STATUS_LABEL = { new: 'جدید', update: 'به‌روزرسانی', duplicate: 'تکراری' };
  const STATUS_CLASS = { new: 'green', update: 'orange', duplicate: 'gray' };

  async function importWizard() {
    let file = null;
    let builtin = null;
    let preview = null;
    let catalogs = [];
    try { catalogs = await API.call('import.builtins', {}); } catch (e) { catalogs = []; }
    let cats = await API.call('products.categories', {});
    let units = await API.call('products.units', {});
    const appSettings = App.settings || {};

    const body =
      '<div id="step1">' +
      '<div class="alert info">' +
      'می‌توانید فهرست کالاها را از <b>لیست قیمت PDF</b>، فایل <b>اکسل</b> یا <b>CSV</b> وارد کنید. ' +
      'هیچ چیزی بدون تأیید شما ثبت نمی‌شود؛ ابتدا پیش‌نمایش کامل را می‌بینید.' +
      '</div>' +
      '<div class="btn-group mb">' +
      '<button class="btn lg" id="pick">📂 انتخاب فایل</button>' +
      '<button class="btn secondary" id="tpl">دریافت فایل نمونه اکسل</button>' +
      '</div>' +
      (catalogs.length
        ? '<div class="card mb"><div class="card-head"><b>کاتالوگ‌های همراه برنامه</b></div>' +
          '<div class="card-body">' +
          '<div class="muted mb">لیست قیمت‌های آماده که همراه برنامه نصب شده‌اند. با یک کلیک پیش‌نمایش می‌شوند.</div>' +
          '<table class="table sm"><thead><tr>' +
          '<th>عنوان</th><th>تعداد کالا</th><th>درصد سود</th><th></th>' +
          '</tr></thead><tbody>' +
          catalogs.map(function (c) {
            return '<tr><td>' + U.esc(c.title) + '</td>' +
              '<td>' + U.esc(String(c.count)) + '</td>' +
              '<td>' + (c.markup ? U.esc(String(c.markup)) + '٪' : '—') + '</td>' +
              '<td><button class="btn sm secondary" data-builtin="' + U.esc(c.id) + '">پیش‌نمایش</button></td></tr>';
          }).join('') +
          '</tbody></table>' +
          '<div class="muted mt">قیمت فروش این کاتالوگ‌ها بدون مالیات ذخیره شده است؛ برنامه هنگام صدور فاکتور مالیات را اضافه می‌کند.</div>' +
          '</div></div>'
        : '') +
      '<div id="fileInfo"></div>' +
      '</div>' +
      '<div id="step2" style="display:none"></div>';

    return U.modal({
      title: 'درون‌ریزی کالا از فایل',
      size: 'xl',
      body: body,
      buttons: [
        {
          label: 'ثبت کالاها', cls: 'btn', right: true, onClick: async function (m) {
            if (!preview) { U.toast('ابتدا فایل را انتخاب و پیش‌نمایش کنید.', 'warn'); return false; }
            const chosen = m.__collectRows ? m.__collectRows(m) : [];
            if (!chosen.length) { U.toast('هیچ ردیفی برای ثبت انتخاب نشده است.', 'warn'); return false; }
            const opts = {
              update_existing: !!U.val(m, 'update_existing'),
              import_duplicates: false,
              skip_errors: !!U.val(m, 'skip_errors'),
              default_unit: U.val(m, 'default_unit') || 'عدد',
              category_id: parseInt(U.val(m, 'category_id'), 10) || null,
              update_category: !!U.val(m, 'update_category')
            };
            const btn = m.querySelector('.modal-foot .btn');
            if (btn) { btn.disabled = true; btn.textContent = 'در حال ثبت...'; }
            try {
              const r = await API.call('import.commit', { rows: chosen, options: opts });
              let msg = 'ثبت شد: ' + w.Fmt.toFaDigits(r.created) + ' کالای جدید';
              if (r.updated) msg += '، ' + w.Fmt.toFaDigits(r.updated) + ' به‌روزرسانی';
              if (r.skipped) msg += '، ' + w.Fmt.toFaDigits(r.skipped) + ' رد شده';
              U.toast(msg, 'success', 7000);
              if (r.errors && r.errors.length) {
                await U.alert('برخی ردیف‌ها ثبت نشدند:\n' +
                  r.errors.slice(0, 10).map(function (e) { return '• ' + e.name + ': ' + e.error; }).join('\n'),
                  'ردیف‌های ثبت‌نشده', 'warn');
              }
              return r;
            } catch (e) {
              U.toast(e.message, 'error');
              if (btn) { btn.disabled = false; btn.textContent = 'ثبت کالاها'; }
              return false;
            }
          }
        },
        { label: 'انصراف', value: false, cls: 'secondary' }
      ],
      onOpen: function (m) {
        const step1 = m.querySelector('#step1');
        const step2 = m.querySelector('#step2');

        m.querySelector('#tpl').addEventListener('click', async function () {
          const r = await API.safe('import.template', {});
          if (r && !r.canceled) U.toast('فایل نمونه ذخیره شد. ستون‌ها را پر کنید و همین‌جا وارد کنید.', 'success', 6000);
        });

        m.querySelector('#pick').addEventListener('click', async function () {
          const f = await API.safe('import.pickFile', {});
          if (!f) return;
          file = f;
          builtin = null;
          await runPreview(m, {});
        });

        U.$$('[data-builtin]', step1).forEach(function (b) {
          b.addEventListener('click', async function () {
            builtin = this.getAttribute('data-builtin');
            file = null;
            await runPreview(m, {});
          });
        });

        async function runPreview(m2, opts) {
          const step2b = m2.querySelector('#step2');
          step2b.style.display = '';
          step2b.innerHTML = U.loading('در حال خواندن فایل...');
          try {
            preview = await API.call('import.preview', { file: file, builtin: builtin, options: opts });
          } catch (e) {
            step2b.innerHTML = '<div class="alert error">' + U.esc(e.message) + '</div>';
            preview = null;
            return;
          }
          renderPreview(m2, step2b);
        }
        m.__runPreview = runPreview;

        function renderPreview(m2, box) {
          const p = preview;
          const o = p.options;
          const meta = p.meta;
          const isRial = /ریال/.test(meta.file) || o.divisor === 10;
          const currency = (App.settings && App.settings.currency) || 'تومان';

          box.innerHTML =
            '<div class="card"><div class="card-head"><h3>فایل خوانده شد</h3><span class="spacer"></span>' +
            '<span class="small muted">' + U.esc(meta.file) + '</span></div><div class="card-body">' +
            '<div class="grid c4 mb">' +
            '<div class="stat accent"><div class="label">کل ردیف‌ها</div><div class="value">' + w.Fmt.toFaDigits(p.summary.total) + '</div></div>' +
            '<div class="stat accent-green"><div class="label">کالای جدید</div><div class="value">' + w.Fmt.toFaDigits(p.summary.new) + '</div></div>' +
            '<div class="stat accent-orange"><div class="label">کالای موجود</div><div class="value">' + w.Fmt.toFaDigits(p.summary.update) + '</div></div>' +
            '<div class="stat"><div class="label">تکراری در فایل</div><div class="value">' + w.Fmt.toFaDigits(p.summary.duplicate) + '</div></div>' +
            '</div>' +

            (meta.kind === 'pdf'
              ? '<div class="alert ' + (meta.strategy === 'price-list' ? 'success' : 'warn') + '">' +
                (meta.strategy === 'price-list'
                  ? 'ساختار «لیست قیمت» شناسایی شد' +
                    (o.vat_rate ? ' — مالیات ' + w.Fmt.toFaDigits(o.vat_rate) + '٪' : '') +
                    (o.markup ? ' و درصد سود ' + w.Fmt.toFaDigits(o.markup) + '٪' : '') + '.'
                  : 'ساختار جدول شناسایی نشد؛ خطوط به‌صورت عمومی خوانده شدند. لطفاً پیش‌نمایش را با دقت بررسی کنید.') +
                ' (' + w.Fmt.toFaDigits(meta.pages || 0) + ' صفحه)</div>'
              : '<div class="alert success">برگه «' + U.esc(meta.sheet || '') + '» خوانده شد. ' +
                'ستون‌های شناسایی‌شده: ' + U.esc((meta.detected_columns || []).join('، ')) + '</div>') +

            '<div class="row">' +
            '<div class="field"><label>واحد مبلغ در فایل</label><select name="divisor">' +
            '<option value="1"' + (o.divisor === 1 ? ' selected' : '') + '>همان واحد برنامه (' + U.esc(currency) + ')</option>' +
            '<option value="10"' + (o.divisor === 10 ? ' selected' : '') + '>ریال — تقسیم بر ۱۰ به تومان</option>' +
            '</select><div class="hint">اگر قیمت‌های فایل به ریال است و واحد برنامه تومان، گزینه دوم را بزنید.</div></div>' +
            '<div class="field"><label>نرخ مالیات فایل (٪)</label>' +
            '<input type="text" name="vat_rate" class="num" value="' + U.esc(o.vat_rate || 0) + '"></div>' +
            '<div class="field"><label>درصد سود فایل (٪)</label>' +
            '<input type="text" name="markup" class="num" value="' + U.esc(o.markup || 0) + '"></div>' +
            '</div>' +

            '<label class="checkbox"><input type="checkbox" name="sale_includes_vat"' +
            (o.sale_includes_vat ? ' checked' : '') + '> ' +
            'ستون قیمت دوم شامل مالیات است؛ مالیات از آن کسر شود' +
            '</label>' +
            '<div class="hint" style="margin:2px 0 8px">برنامه هنگام صدور فاکتور خودش مالیات را اضافه می‌کند، ' +
            'بنابراین قیمت فروش کالا باید <b>بدون مالیات</b> ذخیره شود.</div>' +

            '<label class="checkbox"><input type="checkbox" name="sale_from_markup"' +
            (o.sale_from_markup ? ' checked' : '') + '> ' +
            'قیمت فروش از روی «قیمت خرید × درصد سود» محاسبه شود (به‌جای ستون دوم)</label>' +

            '<div class="btn-group mt"><button class="btn secondary sm" id="reapply">اعمال مجدد و پیش‌نمایش</button></div>' +
            '</div></div>' +

            '<div class="card"><div class="card-head"><h3>تنظیمات ثبت</h3></div><div class="card-body">' +
            '<div class="row">' +
            '<div class="field"><label>دسته‌بندی کالاهای وارد شده</label><select name="category_id">' +
            '<option value="">— بدون دسته —</option>' +
            cats.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.name) + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label>واحد پیش‌فرض</label><select name="default_unit">' +
            units.map(function (u) { return '<option value="' + U.esc(u) + '">' + U.esc(u) + '</option>'; }).join('') +
            '</select></div></div>' +
            '<label class="checkbox"><input type="checkbox" name="update_existing" checked> ' +
            'قیمت کالاهایی که از قبل وجود دارند به‌روزرسانی شود</label>' +
            '<label class="checkbox"><input type="checkbox" name="update_category"> ' +
            'دسته‌بندی کالاهای موجود هم تغییر کند</label>' +
            '<label class="checkbox"><input type="checkbox" name="skip_errors" checked> ' +
            'در صورت خطا در یک ردیف، بقیه ردیف‌ها ثبت شوند</label>' +
            '</div></div>' +

            '<div class="card"><div class="card-head"><h3>پیش‌نمایش ردیف‌ها</h3><span class="spacer"></span>' +
            '<label class="checkbox"><input type="checkbox" id="chkAll" checked> انتخاب همه</label></div>' +
            '<div class="card-body tight"><div class="table-wrap" style="max-height:340px;overflow-y:auto">' +
            '<table class="data compact" id="prevTbl"><thead><tr>' +
            '<th style="width:32px"></th><th>وضعیت</th><th>کد</th><th class="name">نام کالا</th>' +
            '<th>قیمت خرید</th><th>قیمت فروش</th><th class="name">توضیح</th>' +
            '</tr></thead><tbody>' +
            (p.rows.length ? p.rows.map(function (r, i) {
              return '<tr data-i="' + i + '">' +
                '<td><input type="checkbox" data-pick' + (r.status === 'duplicate' ? '' : ' checked') + '></td>' +
                '<td><span class="tag ' + (STATUS_CLASS[r.status] || '') + '">' + U.esc(STATUS_LABEL[r.status] || r.status) + '</span></td>' +
                '<td class="small">' + U.esc(r.code || '—') + '</td>' +
                '<td class="name">' + U.esc(r.name) + '</td>' +
                '<td class="money">' + U.money(r.purchase_price) + '</td>' +
                '<td class="money bold">' + U.money(r.sale_price) + '</td>' +
                '<td class="name small muted">' + U.esc(r.note || '') + '</td></tr>';
            }).join('') : U.emptyRow(7, 'ردیفی در این فایل پیدا نشد.', '📄')) +
            '</tbody></table></div></div></div>';

          U.enhance(box);

          box.querySelector('#reapply').addEventListener('click', async function () {
            await m2.__runPreview(m2, {
              divisor: parseInt(U.val(box, 'divisor'), 10) || 1,
              vat_rate: U.valNum(box, 'vat_rate'),
              markup: U.valNum(box, 'markup'),
              sale_includes_vat: !!U.val(box, 'sale_includes_vat'),
              sale_from_markup: !!U.val(box, 'sale_from_markup')
            });
          });

          const chkAll = box.querySelector('#chkAll');
          if (chkAll) {
            chkAll.addEventListener('change', function () {
              const on = this.checked;
              U.$$('#prevTbl [data-pick]', box).forEach(function (c) { c.checked = on; });
            });
          }
        }

        function collectRows(m2) {
          const out = [];
          U.$$('#prevTbl tbody tr[data-i]', m2).forEach(function (tr) {
            const pick = tr.querySelector('[data-pick]');
            if (!pick || !pick.checked) return;
            out.push(preview.rows[parseInt(tr.dataset.i, 10)]);
          });
          return out;
        }
        m.__collectRows = collectRows;
      }
    });
  }

  w.ImportWizard = importWizard;
})(window);
