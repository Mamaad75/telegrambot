'use strict';
/*
 * آزمون دودی (Smoke Test) رابط کاربری.
 * برنامه واقعی را در یک پوشه داده موقت اجرا می‌کند، راه‌اندازی اولیه را انجام می‌دهد،
 * چند سند واقعی ثبت می‌کند و سپس همه صفحه‌ها را باز کرده و خطاهای کنسول را گزارش می‌دهد.
 *
 * اجرا:  xvfb-run -a npx electron tests/smoke.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shopacc-smoke-'));
const SHOT_DIR = process.env.SMOKE_SHOTS || path.join(TMP, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
app.setPath('userData', TMP);

const problems = [];
const notes = [];

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitForWindow() {
  for (let i = 0; i < 100; i++) {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) return wins[0];
    await wait(150);
  }
  throw new Error('پنجره اصلی ساخته نشد.');
}

function attachListeners(win) {
  win.webContents.on('console-message', function (_e, level, message, line, sourceId) {
    if (level >= 2) problems.push('کنسول [' + level + '] ' + message + ' (' + sourceId + ':' + line + ')');
  });
  win.webContents.on('render-process-gone', function (_e, d) {
    problems.push('فرآیند نمایش از کار افتاد: ' + JSON.stringify(d));
  });
  win.webContents.on('preload-error', function (_e, p, err) {
    problems.push('خطای preload: ' + p + ' — ' + err.message);
  });
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), img.toPNG());
}

/** اجرای کد در رابط کاربری و برگرداندن نتیجه */
async function run(win, code) {
  return win.webContents.executeJavaScript('(async function(){' + code + '})()', true);
}

async function main() {
  require('../src/main/main.js');
  await app.whenReady();
  const win = await waitForWindow();
  attachListeners(win);
  await new Promise(function (r) { win.webContents.once('did-finish-load', r); });
  await wait(900);

  /* ---------- ۱) راه‌اندازی اولیه ---------- */
  const hasWizard = await run(win, 'return !!document.querySelector("#setupSave");');
  if (!hasWizard) problems.push('صفحه راه‌اندازی اولیه نمایش داده نشد.');
  await shot(win, '01-setup');

  await run(win, `
    document.querySelector('[name="shop_name"]').value = 'سوپرمارکت آفتاب';
    document.querySelector('[name="shop_phone"]').value = '02133445566';
    document.querySelector('[name="shop_address"]').value = 'تهران، خیابان اصلی، پلاک ۱۲';
    const c = document.querySelector('[name="opening_cash"]');
    c.value = '100,000,000';
    return true;
  `);
  await run(win, 'document.querySelector("#setupSave").click(); return true;');
  await new Promise(function (r) { win.webContents.once('did-finish-load', r); });
  await wait(1200);

  const booted = await run(win, 'return !!document.querySelector("#sidebar .nav a");');
  if (!booted) problems.push('پس از راه‌اندازی اولیه، برنامه بالا نیامد.');
  notes.push('راه‌اندازی اولیه: ' + (booted ? 'موفق' : 'ناموفق'));

  /* ---------- ۲) ثبت داده واقعی از طریق همان API رابط کاربری ---------- */
  const seed = await run(win, `
    const call = async function (ch, p) {
      const r = await window.api.call(ch, p || {});
      if (!r.ok) throw new Error(ch + ': ' + r.error);
      return r.data;
    };
    const bank = await call('bank.create', { data: {
      title: 'حساب جاری ملت', kind: 'bank', bank_name: 'ملت', branch: 'مرکزی',
      account_number: '1234567890', card_number: '6104337812345678',
      iban: 'IR820540102680020817909002', owner_name: 'رضا محمدی', is_default: 1, opening_balance: 25000000
    }});
    const pos = await call('bank.create', { data: { title: 'کارتخوان صندوق', kind: 'pos', bank_name: 'ملت', is_default: 1 }});
    const bank2 = await call('bank.create', { data: {
      title: 'حساب پس‌انداز صادرات', kind: 'bank', bank_name: 'صادرات',
      account_number: '9876543210', card_number: '6037991122334455', opening_balance: 5000000
    }});
    const cust = await call('party.create', { type: 'customer', data: { name: 'آقای کریمی', phone: '09121234567', address: 'تهران' }});
    const cust2 = await call('party.create', { type: 'customer', data: { name: 'فروشگاه پارس', phone: '09129876543' }});
    const sup = await call('party.create', { type: 'supplier', data: { name: 'پخش سراسری آریا', phone: '02177889900' }});
    const p1 = await call('products.create', { data: { name: 'روغن مایع سرخ‌کردنی ۱.۸ لیتری', barcode: '6260100200301', unit: 'عدد', purchase_price: 180000, sale_price: 235000, min_stock: 10 }});
    const p2 = await call('products.create', { data: { name: 'برنج ایرانی درجه یک ۱۰ کیلویی', barcode: '6260100200302', unit: 'کیسه', purchase_price: 1450000, sale_price: 1790000, min_stock: 5 }});
    const p3 = await call('products.create', { data: { name: 'شکر بسته‌بندی ۹۰۰ گرمی', unit: 'بسته', purchase_price: 42000, sale_price: 56000, min_stock: 20 }});

    // خرید نقدی و نسیه
    await call('purchases.create', { data: {
      supplier_id: sup.id,
      items: [{ product_id: p1.id, qty: 60, unit_price: 180000 }, { product_id: p3.id, qty: 100, unit_price: 42000 }],
      payments: [{ method: 'cash', amount: 15000000 }]
    }});
    await call('purchases.create', { data: {
      supplier_id: sup.id, items: [{ product_id: p2.id, qty: 30, unit_price: 1450000 }], payments: []
    }});

    // فروش نقدی
    const s1 = await call('sales.create', { data: {
      customer_id: cust.id, vat_rate: 10,
      items: [{ product_id: p1.id, qty: 4, unit_price: 235000 }, { product_id: p3.id, qty: 6, unit_price: 56000 }],
      payments: [{ method: 'cash', amount: 1403600 }]
    }});

    // فروش با پرداخت ترکیبی: نقد + کارتخوان + چک
    const s2 = await call('sales.create', { data: {
      customer_id: cust2.id, vat_rate: 10,
      items: [{ product_id: p2.id, qty: 5, unit_price: 2000000 }],
      payments: [
        { method: 'cash', amount: 2000000 },
        { method: 'pos', amount: 5000000, bank_account_id: pos.id },
        { method: 'check', amount: 4000000, check: {
            check_number: '778899', bank_name: 'ملی', holder_name: 'خانم احمدی',
            sayad_id: '1234567890123456', due_date: window.Jalali.isoAddDays(window.Jalali.todayIso(), 30)
        }}
      ]
    }});

    // فروش نسیه
    await call('sales.create', { data: {
      customer_id: cust.id, vat_rate: 10,
      items: [{ product_id: p1.id, qty: 8, unit_price: 235000 }], payments: []
    }});

    // هزینه و درآمد
    const ec = (await call('expenses.categories')).find(function (c) { return c.name === 'اجاره'; });
    await call('expenses.create', { data: { category_id: ec.id, amount: 12000000, method: 'cash', description: 'اجاره ماه جاری' }});
    const ic = (await call('incomes.categories'))[0];
    await call('incomes.create', { data: { category_id: ic.id, amount: 800000, method: 'cash', description: 'کارمزد خدمات' }});

    // انتقال وجه
    await call('transfers.create', { data: { from_kind: 'pos', from_bank_account_id: pos.id, to_kind: 'bank', to_bank_account_id: bank.id, amount: 3000000, fee: 5000 }});

    const s2full = await call('sales.get', { id: s2.id });
    const health = await call('app.integrity');
    return {
      invoice1: s1.invoice_no, invoice2: s2.invoice_no,
      checkCode: s2full.checks[0] ? s2full.checks[0].check_code : null,
      checkRef: s2full.checks[0] ? s2full.checks[0].ref_no : null,
      remaining2: s2full.remaining,
      balanced: health.accounting.trial_balanced,
      invMatch: health.accounting.inventory_matches,
      checkId: s2full.checks[0] ? s2full.checks[0].id : null
    };
  `).catch(function (e) { problems.push('ثبت داده آزمایشی ناموفق: ' + e.message); return null; });

  if (seed) {
    notes.push('فاکتور نقدی: ' + seed.invoice1);
    notes.push('فاکتور پرداخت ترکیبی: ' + seed.invoice2 + ' — مانده ' + seed.remaining2);
    notes.push('کد یکتای چک: ' + seed.checkCode + ' — متصل به فاکتور ' + seed.checkRef);
    if (!seed.balanced) problems.push('دفتر حسابداری پس از ثبت داده تراز نیست.');
    if (!seed.invMatch) problems.push('حساب موجودی کالا با ارزش انبار برابر نیست.');
    if (seed.remaining2 !== 0) problems.push('مانده فاکتور پرداخت ترکیبی صفر نشد.');
    if (!seed.checkCode) problems.push('چک فاکتور ساخته نشد.');
  }

  /* ---------- ۳) جست‌وجوی چک با کد، نام دارنده و شماره فاکتور ---------- */
  const findings = await run(win, `
    const call = async function (ch, p) { const r = await window.api.call(ch, p || {}); if (!r.ok) throw new Error(r.error); return r.data; };
    const byCode = await call('checks.list', { search: '${seed ? seed.checkCode : ''}' });
    const byHolder = await call('checks.list', { search: 'احمدی' });
    const byInvoice = await call('checks.list', { search: '${seed ? seed.checkRef : ''}' });
    const bySayad = await call('checks.list', { search: '1234567890123456' });
    return { byCode: byCode.length, byHolder: byHolder.length, byInvoice: byInvoice.length, bySayad: bySayad.length };
  `).catch(function (e) { problems.push('جست‌وجوی چک ناموفق: ' + e.message); return null; });
  if (findings) {
    notes.push('جست‌وجوی چک — با کد: ' + findings.byCode + '، با نام دارنده: ' + findings.byHolder +
      '، با شماره فاکتور: ' + findings.byInvoice + '، با شناسه صیادی: ' + findings.bySayad);
    if (!findings.byCode || !findings.byHolder || !findings.byInvoice || !findings.bySayad) {
      problems.push('یکی از روش‌های جست‌وجوی چک نتیجه نداد.');
    }
  }

  /* ---------- ۴) تسویه چک از طریق همان مسیر رابط کاربری ---------- */
  if (seed && seed.checkId) {
    const settled = await run(win, `
      const call = async function (ch, p) { const r = await window.api.call(ch, p || {}); if (!r.ok) throw new Error(r.error); return r.data; };
      const banks = await call('bank.list', { active: 1 });
      const b = banks.find(function (x) { return x.kind === 'bank'; });
      await call('checks.changeStatus', { id: ${seed.checkId}, data: { status: 'deposited', bank_account_id: b.id } });
      const c = await call('checks.changeStatus', { id: ${seed.checkId}, data: { status: 'cleared', method: 'bank', bank_account_id: b.id } });
      const h = await call('app.integrity');
      return { status: c.status, events: c.events.length, balanced: h.accounting.trial_balanced };
    `).catch(function (e) { problems.push('تغییر وضعیت چک ناموفق: ' + e.message); return null; });
    if (settled) {
      notes.push('چک پس از واگذاری و وصول: وضعیت «' + settled.status + '» با ' + settled.events + ' رویداد ثبت‌شده');
      if (settled.status !== 'cleared') problems.push('وضعیت چک به وصول‌شده تغییر نکرد.');
      if (!settled.balanced) problems.push('پس از وصول چک، دفتر تراز نیست.');
    }
  }

  /* ---------- ۵) باز کردن تمام صفحه‌ها ---------- */
  const routes = ['dashboard', 'sales', 'sales/new', 'purchases', 'purchases/new', 'returns',
    'products', 'inventory', 'treasury', 'checks', 'banks', 'cashbook',
    'customers', 'suppliers', 'reports', 'accounting', 'settings', 'backup'];
  for (const r of routes) {
    const before = problems.length;
    await run(win, 'window.App.go("' + r + '"); return true;');
    await wait(r === 'reports' || r === 'accounting' ? 1500 : 800);
    const rendered = await run(win, `
      const c = document.getElementById('content');
      return { html: c.innerHTML.length, err: !!c.querySelector('.alert.error'), loading: c.innerHTML.indexOf('spinner') !== -1 };
    `);
    if (rendered.err) problems.push('صفحه «' + r + '» با خطا رندر شد.');
    if (rendered.html < 200) problems.push('صفحه «' + r + '» خالی است.');
    if (rendered.loading) problems.push('صفحه «' + r + '» در حالت بارگذاری مانده است.');
    if (problems.length === before) notes.push('صفحه ' + r + ': سالم');
    await shot(win, 'page-' + r.replace(/\//g, '-'));
  }

  /* ---------- ۵.۱) پنجره درون‌ریزی کالا از PDF/اکسل ---------- */
  {
    const before = problems.length;
    await run(win, 'window.App.go("products"); return true;');
    await wait(900);
    const hasBtn = await run(win, "return !!document.getElementById('importBtn');");
    if (!hasBtn) problems.push('دکمه درون‌ریزی در صفحه کالاها نیست.');
    else {
      await run(win, "document.getElementById('importBtn').click(); return true;");
      await wait(900);
      const st = await run(win, `
        const bd = document.querySelector('.modal-backdrop');
        if (!bd) return { open: false };
        return {
          open: true,
          pick: !!bd.querySelector('#pick'),
          tpl: !!bd.querySelector('#tpl'),
          title: (bd.querySelector('.modal-head h3') || {}).textContent || '',
          catalogs: bd.querySelectorAll('[data-builtin]').length,
          err: !!bd.querySelector('.alert.error')
        };
      `);
      if (!st.open) problems.push('پنجره درون‌ریزی باز نشد.');
      else {
        if (!st.pick) problems.push('دکمه انتخاب فایل در پنجره درون‌ریزی نیست.');
        if (!st.tpl) problems.push('دکمه فایل نمونه اکسل در پنجره درون‌ریزی نیست.');
        if (st.err) problems.push('پنجره درون‌ریزی با خطا رندر شد.');
        if (st.catalogs < 1) problems.push('کاتالوگ همراه برنامه در پنجره درون‌ریزی نمایش داده نشد.');
        await shot(win, 'import-wizard');
      }
      await run(win, "const b=document.querySelector('.modal-backdrop'); if(b){const x=b.querySelector('[data-close]'); if(x) x.click(); else b.remove();} return true;");
      await wait(400);
      const stillOpen = await run(win, "return !!document.querySelector('.modal-backdrop');");
      if (stillOpen) problems.push('پنجره درون‌ریزی بسته نشد.');
    }
    if (problems.length === before) notes.push('پنجره درون‌ریزی کالا از PDF/اکسل: سالم');
  }

  /* ---------- ۶) بررسی زیربخش‌های گزارش‌ها ---------- */
  await run(win, 'window.App.go("reports"); return true;');
  await wait(1200);
  const repKeys = ['pl', 'daily', 'sales', 'purchases', 'products', 'vat', 'receivable', 'payable', 'checks', 'inventory', 'cash', 'expenses'];
  for (const k of repKeys) {
    const before = problems.length;
    await run(win, `
      const sel = document.querySelector('#rep');
      sel.value = '${k}';
      sel.dispatchEvent(new Event('change'));
      return true;
    `);
    await wait(700);
    const st = await run(win, `
      const b = document.getElementById('repBody');
      return { len: b.innerHTML.length, err: !!b.querySelector('.alert.error'), loading: b.innerHTML.indexOf('spinner') !== -1 };
    `);
    if (st.err || st.len < 150 || st.loading) problems.push('گزارش «' + k + '» درست نمایش داده نشد.');
    if (problems.length === before) notes.push('گزارش ' + k + ': سالم');
  }
  await shot(win, 'reports-detail');

  /* ---------- ۷) زیربخش‌های دفاتر حسابداری ---------- */
  await run(win, 'window.App.go("accounting"); return true;');
  await wait(1200);
  for (const t of ['journal', 'ledger', 'trial', 'sheet', 'chart', 'health']) {
    const before = problems.length;
    await run(win, 'document.querySelector(\'[data-tab="' + t + '"]\').click(); return true;');
    await wait(900);
    const st = await run(win, `
      const b = document.getElementById('body');
      return { len: b.innerHTML.length, err: !!b.querySelector('.alert.error'), loading: b.innerHTML.indexOf('spinner') !== -1 };
    `);
    if (st.err || st.len < 150 || st.loading) problems.push('بخش حسابداری «' + t + '» درست نمایش داده نشد.');
    if (problems.length === before) notes.push('دفتر ' + t + ': سالم');
  }
  await shot(win, 'accounting-health');

  /* ---------- ۸) پشتیبان‌گیری از مسیر رابط کاربری ---------- */
  const bk = await run(win, `
    const call = async function (ch, p) { const r = await window.api.call(ch, p || {}); if (!r.ok) throw new Error(r.error); return r.data; };
    const made = await call('backup.create', { tag: 'smoke' });
    const list = await call('backup.list');
    const v = await call('backup.verify', { file: made.file });
    return { name: made.name, count: list.items.length, ok: v.ok, stats: v.stats };
  `).catch(function (e) { problems.push('پشتیبان‌گیری ناموفق: ' + e.message); return null; });
  if (bk) {
    notes.push('پشتیبان ساخته شد: ' + bk.name + ' (سالم: ' + bk.ok + '، ' + bk.stats.sales + ' فاکتور فروش)');
    if (!bk.ok) problems.push('فایل پشتیبان ساخته‌شده سالم نیست.');
  }

  /* ---------- ۹) چاپ فاکتور و ساخت PDF ---------- */
  try {
    const templates = require('../src/print/templates.js');
    const printing = require('../src/main/printing.js');
    const connection = require('../src/db/connection.js');
    const salesSvc = require('../src/services/sales.js');
    const settingsSvc = require('../src/services/settings.js');
    const db = connection.get();
    const inv = salesSvc.getByNumber(db, seed.invoice2);
    const st = settingsSvc.all(db);
    const htmlA4 = templates.invoiceSheet({ settings: st, invoice: inv, type: 'sale', paper: 'a4' });
    const htmlA5 = templates.invoiceSheet({ settings: st, invoice: inv, type: 'sale', paper: 'a5' });
    const htmlTh = templates.invoiceThermal({ settings: st, invoice: inv, type: 'sale' });
    const pdfA4 = path.join(SHOT_DIR, 'invoice-a4.pdf');
    const pdfA5 = path.join(SHOT_DIR, 'invoice-a5.pdf');
    const pdfTh = path.join(SHOT_DIR, 'invoice-thermal.pdf');
    await printing.toPdf(htmlA4, pdfA4, { pageSize: 'A4' });
    await printing.toPdf(htmlA5, pdfA5, { pageSize: 'A5' });
    await printing.toPdf(htmlTh, pdfTh, { thermal: true });
    const sizeA4 = fs.statSync(pdfA4).size;
    notes.push('PDF فاکتور A4 ساخته شد (' + sizeA4 + ' بایت)، A5 (' + fs.statSync(pdfA5).size +
      ' بایت) و فیش حرارتی (' + fs.statSync(pdfTh).size + ' بایت)');
    if (sizeA4 < 3000) problems.push('فایل PDF فاکتور بیش از حد کوچک است.');
    if (fs.statSync(pdfA5).size < 3000) problems.push('فایل PDF فاکتور A5 بیش از حد کوچک است.');

    // ابعاد واقعی صفحه PDF را از MediaBox می‌خوانیم (واحد: point، هر اینچ ۷۲ point)
    function pageMm(file) {
      const txt = fs.readFileSync(file, 'latin1');
      const m = txt.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
      if (!m) return null;
      return { w: Math.round(parseFloat(m[1]) / 72 * 25.4), h: Math.round(parseFloat(m[2]) / 72 * 25.4) };
    }
    const dimA4 = pageMm(pdfA4);
    const dimA5 = pageMm(pdfA5);
    if (!dimA4 || Math.abs(dimA4.w - 210) > 2 || Math.abs(dimA4.h - 297) > 2) {
      problems.push('اندازه صفحه PDF فاکتور A4 درست نیست: ' + JSON.stringify(dimA4));
    }
    if (!dimA5 || Math.abs(dimA5.w - 148) > 2 || Math.abs(dimA5.h - 210) > 2) {
      problems.push('اندازه صفحه PDF فاکتور A5 درست نیست: ' + JSON.stringify(dimA5));
    }
    if (dimA4 && dimA5) {
      notes.push('ابعاد صفحه: A4 = ' + dimA4.w + '×' + dimA4.h + ' میلی‌متر، A5 = ' + dimA5.w + '×' + dimA5.h + ' میلی‌متر');
    }

    // فاکتور معمولی باید در یک برگ A5 جا شود
    function pageCount(file) {
      const txt = fs.readFileSync(file, 'latin1');
      return (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
    }
    const pagesA5 = pageCount(pdfA5);
    if (pagesA5 > 1) problems.push('فاکتور در یک برگ A5 جا نشد (' + pagesA5 + ' صفحه).');
    else notes.push('فاکتور ' + inv.items.length + ' ردیفی در یک برگ A5 جا شد');

    // اندازه پیش‌فرض برنامه باید A5 باشد
    if (st.print_size !== 'a5') problems.push('اندازه پیش‌فرض چاپ A5 نیست: ' + st.print_size);
    else notes.push('اندازه پیش‌فرض چاپ فاکتور: A5');

    // پیش‌نمایش چاپ برای اسکرین‌شات
    const pw = printing.preview(htmlA4, { title: 'پیش‌نمایش', defaultName: inv.invoice_no });
    await new Promise(function (r) { pw.webContents.once('did-finish-load', r); });
    await wait(700);
    const img = await pw.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'print-preview.png'), img.toPNG());
    pw.destroy();
  } catch (e) {
    problems.push('چاپ/PDF ناموفق: ' + e.message);
  }

  /* ---------- ۱۰) خروجی اکسل ---------- */
  try {
    const excel = require('../src/services/excel.js');
    const connection = require('../src/db/connection.js');
    const xlsxPath = path.join(SHOT_DIR, 'export.xlsx');
    const r = await excel.exportAll(connection.get(), xlsxPath, {});
    notes.push('اکسل ساخته شد با ' + r.sheets + ' شیت (' + fs.statSync(xlsxPath).size + ' بایت)');
    if (r.sheets < 20) problems.push('تعداد شیت‌های اکسل کمتر از انتظار است.');
  } catch (e) {
    problems.push('خروجی اکسل ناموفق: ' + e.message);
  }

  /* ---------- گزارش ---------- */
  console.log('\n' + '='.repeat(66));
  console.log('گزارش آزمون رابط کاربری');
  console.log('='.repeat(66));
  notes.forEach(function (n) { console.log('  • ' + n); });
  console.log('-'.repeat(66));
  if (problems.length) {
    console.log('ایرادهای یافت‌شده (' + problems.length + '):');
    problems.forEach(function (p) { console.log('  ✗ ' + p); });
  } else {
    console.log('  ✓ هیچ خطایی یافت نشد.');
  }
  console.log('تصاویر: ' + SHOT_DIR);
  console.log('='.repeat(66));

  app.exit(problems.length ? 1 : 0);
}

main().catch(function (e) {
  console.error('خطای اجرای آزمون:', e);
  app.exit(2);
});
