'use strict';
/*
 * آزمون درون‌ریزی کالا از فایل PDF و اکسل — از مسیر واقعی برنامه.
 * برنامه را با پوشه داده موقت اجرا می‌کند، فایل‌ها را از همان کانال رابط کاربری
 * پیش‌نمایش و ثبت می‌کند و درستی قیمت‌ها و موجودی را بررسی می‌نماید.
 *
 * اجرا:  PDF_DIR=<pathدرون‌ریزی> xvfb-run -a npx electron tests/import-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shopacc-import-'));
app.setPath('userData', TMP);

const PDF_DIR = process.env.PDF_DIR || '';
const OUT_DIR = process.env.OUT_DIR || TMP;

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'انتظار ' + b + ' ولی ' + a); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  require('../src/main/main.js');
  await app.whenReady();
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await wait(150); }
  await new Promise(function (r) { win.webContents.once('did-finish-load', r); });
  await wait(800);

  const problems = [];
  win.webContents.on('console-message', function (_e, level, message) {
    if (level >= 2) problems.push(message);
  });

  // راه‌اندازی اولیه
  await win.webContents.executeJavaScript(`(async function(){
    const r = await window.api.call('settings.save', { values: {
      shop_name: 'فروشگاه قطعات', currency: 'تومان', vat_rate: '10', setup_done: '1'
    }});
    return r.ok;
  })()`, true);
  win.webContents.reload();
  await new Promise(function (r) { win.webContents.once('did-finish-load', r); });
  await wait(1000);

  const connection = require('../src/db/connection.js');
  const importer = require('../src/services/importer.js');
  const productsSvc = require('../src/services/products.js');
  const inventorySvc = require('../src/services/inventory.js');
  const reportsSvc = require('../src/services/reports.js');
  const db = connection.get();

  const pdfs = PDF_DIR && fs.existsSync(PDF_DIR)
    ? fs.readdirSync(PDF_DIR).filter(function (f) { return f.endsWith('.pdf'); }).map(function (f) { return path.join(PDF_DIR, f); })
    : [];

  console.log('\n۱) پیش‌نمایش فایل‌های PDF');
  ok('فایل PDF برای آزمون موجود است', pdfs.length > 0, 'PDF_DIR=' + PDF_DIR);

  let mainList = null, proList = null;
  for (const f of pdfs) {
    const pv = await importer.preview(db, f, {});
    const name = path.basename(f);
    ok('خواندن ' + name.slice(0, 12) + '…: ' + pv.summary.total + ' ردیف', pv.summary.total > 0);
    ok('  ساختار لیست قیمت شناسایی شد', pv.meta.strategy === 'price-list', pv.meta.strategy);
    ok('  همه ردیف‌ها نام و قیمت دارند',
      pv.rows.every(function (r) { return r.name && r.purchase_price > 0; }));
    // قیمت فروش باید بدون مالیات باشد: خرید × (۱+سود)
    const mk = pv.options.markup;
    const bad = pv.rows.filter(function (r) {
      const expect = Math.round(r.purchase_price * (1 + mk / 100));
      return Math.abs(expect - r.sale_price) > 2;
    });
    ok('  قیمت فروش = خرید × (۱+' + mk + '٪) و بدون مالیات', bad.length === 0,
      bad.length ? bad.length + ' ردیف مغایر، نمونه: ' + JSON.stringify(bad[0]) : '');
    if (pv.summary.total > 50) mainList = { file: f, pv: pv };
    else proList = { file: f, pv: pv };
  }

  console.log('\n۲) ثبت کالاها در پایگاه داده');
  ok('لیست اصلی پیدا شد', !!mainList);
  ok('لیست کاتاباکس پرو پیدا شد', !!proList);

  // فقط لیست ۲۰٪ (جدیدتر) را وارد می‌کنیم
  const list20 = pdfs.filter(function (f) { return /1020/.test(path.basename(f)); });
  ok('دو فایل با سود ۲۰٪ موجود است', list20.length === 2, 'یافت: ' + list20.length);

  let totalCreated = 0;
  for (const f of list20) {
    const pv = await importer.preview(db, f, {});
    const r = importer.commit(db, pv.rows, {
      update_existing: true, default_unit: 'عدد', skip_errors: false
    });
    totalCreated += r.created;
    ok('ثبت ' + path.basename(f).slice(0, 12) + '…: ' + r.created + ' جدید، ' + r.updated + ' به‌روز',
      r.errors.length === 0, JSON.stringify(r.errors.slice(0, 2)));
  }
  eq('جمع کالاهای ثبت‌شده', totalCreated, 110);
  eq('تعداد کالا در پایگاه داده', productsSvc.count(db, {}), 110);

  console.log('\n۳) بررسی صحت داده ثبت‌شده');
  const tiba = db.prepare('SELECT * FROM products WHERE code=?').get('30104009');
  ok('کالای «کاتاليست تيبا» ثبت شد', !!tiba, 'کد 30104009');
  if (tiba) {
    eq('  قیمت خرید تیبا', tiba.purchase_price, 88740000);
    eq('  قیمت فروش تیبا (بدون مالیات)', tiba.sale_price, 106488000);
    ok('  با مالیات ۱۰٪ برابر لیست قیمت می‌شود (۱۱۷٬۱۳۶٬۸۰۰)',
      Math.round(tiba.sale_price * 1.1) === 117136800, String(Math.round(tiba.sale_price * 1.1)));
  }
  const pro = db.prepare('SELECT * FROM products WHERE code=?').get('30206023');
  ok('کالای «کاتاباکس 118 پرو 4000» ثبت شد', !!pro);
  if (pro) eq('  قیمت خرید', pro.purchase_price, 555557000);

  eq('موجودی اولیه صفر است (فقط تعریف کالا)', inventorySvc.totalValue(db).value, 0);
  const health = reportsSvc.integrity(db);
  ok('دفتر حسابداری دست‌نخورده و تراز است', health.trial_balanced && health.inventory_matches);

  console.log('\n۴) درون‌ریزی مجدد همان فایل (به‌روزرسانی، نه تکرار)');
  const pv2 = await importer.preview(db, list20[0], {});
  eq('  همه ردیف‌ها «موجود» تشخیص داده شدند', pv2.summary.new, 0);
  const r2 = importer.commit(db, pv2.rows, { update_existing: true, skip_errors: false });
  eq('  کالای جدیدی ساخته نشد', r2.created, 0);
  ok('  کالاها به‌روزرسانی شدند', r2.updated > 0, String(r2.updated));
  eq('  تعداد کل کالا تغییر نکرد', productsSvc.count(db, {}), 110);

  console.log('\n۵) تبدیل واحد پول (ریال به تومان)');
  const pvRial = await importer.preview(db, list20[0], { divisor: 10 });
  const tibaRow = pvRial.rows.find(function (r) { return r.code === '30104009'; });
  ok('  قیمت با تقسیم بر ۱۰ محاسبه شد', tibaRow && tibaRow.purchase_price === 8874000,
    tibaRow ? String(tibaRow.purchase_price) : 'ردیف پیدا نشد');

  console.log('\n۶) درون‌ریزی از اکسل');
  const xlsxPath = path.join(OUT_DIR, 'test-products.xlsx');
  await importer.template(xlsxPath);
  ok('فایل نمونه اکسل ساخته شد', fs.existsSync(xlsxPath));

  // ساخت یک اکسل واقعی با ستون‌های فارسی
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('کالاها');
  ws.addRow(['نام کالا', 'کد کالا', 'بارکد', 'واحد', 'قیمت خرید', 'قیمت فروش', 'حداقل موجودی']);
  ws.addRow(['فیلتر روغن پراید', 'FLT-001', '6260999000011', 'عدد', 120000, 165000, 10]);
  ws.addRow(['فیلتر هوا پژو ۴۰۵', 'FLT-002', '6260999000012', 'عدد', 180000, 245000, 8]);
  ws.addRow(['کاتاليست تيبا (AM)', '30104009', '', 'عدد', 90000000, 108000000, 3]); // کالای موجود
  const realXlsx = path.join(OUT_DIR, 'import-sample.xlsx');
  await wb.xlsx.writeFile(realXlsx);

  const pvx = await importer.preview(db, realXlsx, {});
  eq('  ردیف‌های اکسل خوانده شد', pvx.summary.total, 3);
  eq('  دو کالای جدید', pvx.summary.new, 2);
  eq('  یک کالای موجود', pvx.summary.update, 1);
  ok('  ستون‌ها درست تشخیص داده شدند',
    pvx.meta.detected_columns.indexOf('name') !== -1 &&
    pvx.meta.detected_columns.indexOf('purchase_price') !== -1 &&
    pvx.meta.detected_columns.indexOf('barcode') !== -1,
    JSON.stringify(pvx.meta.detected_columns));

  const rx = importer.commit(db, pvx.rows, { update_existing: true, skip_errors: false });
  eq('  دو کالای جدید ثبت شد', rx.created, 2);
  eq('  یک کالا به‌روزرسانی شد', rx.updated, 1);
  const filt = db.prepare('SELECT * FROM products WHERE code=?').get('FLT-001');
  ok('  کالای اکسل با بارکد ثبت شد', filt && filt.barcode === '6260999000011');
  eq('  قیمت کالای موجود به‌روزرسانی شد',
    db.prepare('SELECT sale_price FROM products WHERE code=?').get('30104009').sale_price, 108000000);

  console.log('\n۷) CSV');
  const csvPath = path.join(OUT_DIR, 'import-sample.csv');
  fs.writeFileSync(csvPath, 'نام کالا,کد کالا,قیمت خرید,قیمت فروش\nشمع خودرو NGK,SPK-01,95000,130000\nتسمه تایم,BLT-01,850000,1150000\n', 'utf8');
  const pvc = await importer.preview(db, csvPath, {});
  eq('  ردیف‌های CSV خوانده شد', pvc.summary.total, 2);
  const rc = importer.commit(db, pvc.rows, { update_existing: true, skip_errors: false });
  eq('  کالاهای CSV ثبت شدند', rc.created, 2);

  console.log('\n۷.۱) کاتالوگ‌های همراه برنامه');
  const builtins = importer.builtins();
  ok('فهرست کاتالوگ‌ها خوانده شد', builtins.length >= 2, 'تعداد: ' + builtins.length);
  ok('  هر کاتالوگ عنوان و تعداد دارد',
    builtins.every(function (c) { return c.title && c.count > 0; }),
    JSON.stringify(builtins.map(function (c) { return c.title + ':' + c.count; })));
  ok('  هر دو تیر سود ۲۰٪ و ۱۲٪ موجود است',
    builtins.some(function (c) { return c.markup === 20; }) &&
    builtins.some(function (c) { return c.markup === 12; }),
    JSON.stringify(builtins.map(function (c) { return c.markup; })));

  // کاتالوگ‌های همراه برنامه همان کالاهای PDF هستند؛ باید «به‌روزرسانی» تشخیص داده شوند نه جدید
  const big20 = builtins.filter(function (c) { return c.markup === 20; })
    .sort(function (a, b) { return b.count - a.count; })[0];
  const pvb = await importer.preview(db, importer.builtinPath(big20.id), {});
  eq('  تعداد ردیف کاتالوگ برابر فهرست است', pvb.summary.total, big20.count);
  eq('  همه ردیف‌ها کالای موجود تشخیص داده شدند', pvb.summary.new, 0);
  const beforeB = productsSvc.count(db, {});
  const rb = importer.commit(db, pvb.rows, { update_existing: true, skip_errors: false });
  eq('  کالای جدیدی ساخته نشد', rb.created, 0);
  eq('  تعداد کالا تغییر نکرد', productsSvc.count(db, {}), beforeB);

  // کاتالوگ ۱۲٪ همان کالاها با قیمت فروش پایین‌تر است
  const small12 = builtins.filter(function (c) { return c.markup === 12; })
    .sort(function (a, b) { return b.count - a.count; })[0];
  const pv12 = await importer.preview(db, importer.builtinPath(small12.id), {});
  const rowTiba = pv12.rows.filter(function (r) { return r.code === '30104009'; })[0];
  ok('  کاتالوگ ۱۲٪ همان کالا را دارد', !!rowTiba, JSON.stringify(pv12.rows.slice(0, 1)));
  if (rowTiba) {
    eq('  قیمت خرید یکسان است', rowTiba.purchase_price, 88740000);
    eq('  قیمت فروش با سود ۱۲٪', rowTiba.sale_price, Math.round(88740000 * 1.12));
  }
  let guarded = false;
  try { importer.builtinPath('../../../etc/passwd'); } catch (e) { guarded = true; }
  ok('  شناسه نامعتبر کاتالوگ رد می‌شود', guarded);

  console.log('\n۸) وضعیت نهایی');
  eq('تعداد کل کالاها', productsSvc.count(db, {}), 114);
  const health2 = reportsSvc.integrity(db);
  ok('حسابداری همچنان سالم و تراز است', health2.ok, JSON.stringify({
    balanced: health2.trial_balanced, inv: health2.inventory_matches
  }));
  ok('هیچ خطای کنسولی رخ نداد', problems.length === 0, problems.slice(0, 3).join(' | '));

  // خروجی اکسل کاتالوگ برای تحویل به کاربر
  if (mainList) {
    const cat = new ExcelJS.Workbook();
    const cs = cat.addWorksheet('کالاها', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    cs.columns = [
      { header: 'نام کالا', key: 'name', width: 46 },
      { header: 'کد کالا', key: 'code', width: 14 },
      { header: 'واحد', key: 'unit', width: 10 },
      { header: 'قیمت خرید', key: 'purchase_price', width: 18 },
      { header: 'قیمت فروش', key: 'sale_price', width: 18 },
      { header: 'حداقل موجودی', key: 'min_stock', width: 14 },
      { header: 'موجودی اولیه', key: 'opening_qty', width: 14 }
    ];
    const h = cs.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Tahoma', size: 10 };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    h.height = 22;
    for (const p of db.prepare('SELECT name, code, unit, purchase_price, sale_price, min_stock FROM products ORDER BY code').all()) {
      cs.addRow({ name: p.name, code: p.code, unit: p.unit, purchase_price: p.purchase_price, sale_price: p.sale_price, min_stock: p.min_stock, opening_qty: 0 });
    }
    cs.getColumn('purchase_price').numFmt = '#,##0';
    cs.getColumn('sale_price').numFmt = '#,##0';
    const catPath = path.join(OUT_DIR, 'کاتالوگ-کالاها.xlsx');
    await cat.xlsx.writeFile(catPath);
    console.log('  کاتالوگ اکسل ساخته شد: ' + catPath);
  }

  console.log('\n' + '='.repeat(60));
  console.log('نتیجه: ' + passed + ' موفق، ' + failed + ' ناموفق');
  if (failed) { console.log('\nموارد ناموفق:'); failures.forEach(function (f) { console.log('  - ' + f); }); }
  console.log('='.repeat(60));
  app.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('خطای اجرای آزمون:', e); app.exit(2); });
