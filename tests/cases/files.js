'use strict';
/** آزمون خروجی اکسل، پشتیبان‌گیری، بازیابی و داده نمایشی */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const t = require('../helper');
const connection = require('../../src/main/db/connection');
const excel = require('../../src/main/services/excel');
const backup = require('../../src/main/services/backup');
const demo = require('../../src/main/services/demo');
const accounting = require('../../src/main/services/accounting');
const products = require('../../src/main/services/products');
const invoices = require('../../src/main/services/invoices');
const parties = require('../../src/main/services/parties');
const cashbook = require('../../src/main/services/cashbook');
const settings = require('../../src/main/services/settings');

const EXPECTED_SHEETS = [
  'فروش', 'خرید', 'برگشت از فروش', 'برگشت از خرید', 'ریز اقلام فاکتور', 'کالاها',
  'موجودی انبار', 'گردش انبار', 'مشتریان', 'تأمین‌کنندگان', 'مانده مشتریان',
  'مانده تأمین‌کنندگان', 'گردش صندوق', 'گردش کارتخوان', 'گردش بانک', 'چک‌ها',
  'هزینه‌ها', 'درآمدها', 'دریافت و پرداخت', 'دفتر روزنامه', 'دفتر کل',
  'کدینگ حساب‌ها', 'سود و زیان', 'ارزش افزوده',
];

module.exports = function run() {
  // ── داده نمایشی ────────────────────────────────────────────
  t.suite('ساخت داده نمایشی');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myshop-files-'));
  const dbFile = path.join(dir, 'demo.sqlite');
  const { db } = connection.open(dbFile);
  const res = demo.generate(db);
  t.ok(!res.skipped, 'داده نمایشی ساخته شد');
  const counts = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    invoices: db.prepare("SELECT COUNT(*) c FROM invoices WHERE type='sale'").get().c,
    entries: db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c,
  };
  t.ok(counts.products >= 10, 'کالاهای نمونه ساخته شدند', 'تعداد: ' + counts.products);
  t.ok(counts.invoices > 50, 'فاکتورهای فروش نمونه ساخته شدند', 'تعداد: ' + counts.invoices);
  t.ok(counts.entries > 100, 'اسناد حسابداری نمونه ساخته شدند', 'تعداد: ' + counts.entries);
  t.assertLedgerBalanced(db, 'داده نمایشی');
  t.assertInventoryMatches(db, 'داده نمایشی');
  const pl = accounting.profitLoss(db, {});
  t.ok(pl.netSales > 0, 'داده نمایشی فروش دارد');
  t.ok(pl.cogs > 0, 'داده نمایشی بهای تمام‌شده دارد');

  // ── خروجی اکسل ─────────────────────────────────────────────
  t.suite('خروجی اکسل چندشیتی');
  const xlsxFile = path.join(dir, 'report.xlsx');
  const buf = excel.build(db, {});
  fs.writeFileSync(xlsxFile, buf);
  t.ok(buf.length > 5000, 'فایل اکسل ساخته شد', buf.length + ' بایت');

  let pythonOk = true;
  let sheetNames = [];
  try {
    const out = execFileSync('python3', ['-c', `
import zipfile, json, sys
try:
    import openpyxl
except ImportError:
    print(json.dumps({"skip": True})); sys.exit(0)
z = zipfile.ZipFile(${JSON.stringify(xlsxFile)})
bad = z.testzip()
wb = openpyxl.load_workbook(${JSON.stringify(xlsxFile)})
ws = wb['فروش']
rows = list(ws.iter_rows(values_only=True))
numeric = sum(1 for r in rows for c in r if isinstance(c, (int, float)))
print(json.dumps({"zip_ok": bad is None, "sheets": wb.sheetnames, "sale_rows": len(rows), "numeric_cells": numeric}, ensure_ascii=False))
`], { encoding: 'utf8' });
    const info = JSON.parse(out.trim());
    if (info.skip) { pythonOk = false; } else {
      sheetNames = info.sheets;
      t.ok(info.zip_ok, 'ساختار فایل اکسل سالم است');
      t.ok(info.sale_rows > 5, 'شیت فروش دارای ردیف داده است', 'ردیف‌ها: ' + info.sale_rows);
      t.ok(info.numeric_cells > 10, 'مبالغ به صورت عدد (نه متن) ذخیره شده‌اند', 'سلول عددی: ' + info.numeric_cells);
    }
  } catch (e) {
    pythonOk = false;
    t.ok(false, 'بررسی فایل اکسل با openpyxl', e.message.slice(0, 120));
  }
  if (pythonOk && sheetNames.length) {
    const missing = EXPECTED_SHEETS.filter((n) => !sheetNames.includes(n));
    t.ok(missing.length === 0, `همه ${EXPECTED_SHEETS.length} شیت موردنیاز در فایل اکسل وجود دارد`, 'کمبود: ' + missing.join('، '));
  }

  // ── پشتیبان‌گیری ───────────────────────────────────────────
  t.suite('پشتیبان‌گیری، بازیابی و بررسی سلامت');
  const backupDir = path.join(dir, 'backups');
  const b1 = backup.createBackup(db, backupDir, 'test');
  t.ok(fs.existsSync(b1.file), 'فایل پشتیبان ساخته شد');
  t.ok(b1.size > 10000, 'حجم پشتیبان منطقی است', b1.size + ' بایت');
  const list = backup.listBackups(backupDir);
  t.eq(list.length, 1, 'پشتیبان در فهرست دیده می‌شود');

  const info = backup.inspectBackupFile(b1.file);
  t.eq(info.invoices, db.prepare('SELECT COUNT(*) c FROM invoices').get().c, 'تعداد فاکتورهای پشتیبان با اصل برابر است');
  t.throws(() => backup.inspectBackupFile(path.join(dir, 'nope.sqlite')), 'فایل ناموجود رد می‌شود');
  const junk = path.join(dir, 'junk.sqlite');
  fs.writeFileSync(junk, 'این یک پایگاه داده نیست');
  t.throws(() => backup.inspectBackupFile(junk), 'فایل نامعتبر رد می‌شود');

  const check = backup.integrityCheck(db);
  t.ok(check.ok, 'بررسی سلامت پایگاه داده موفق بود', check.problems.join(' | '));

  // تغییر داده و سپس بازیابی
  const beforeCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  products.create(db, { name: 'کالای پس از پشتیبان', code: 'AFTER1', buy_price: 1000, sell_price: 2000 });
  t.eq(db.prepare('SELECT COUNT(*) c FROM products').get().c, beforeCount + 1, 'کالای جدید پس از پشتیبان ثبت شد');

  const restored = backup.restoreBackup(b1.file, { safetyDir: path.join(dir, 'safety') });
  t.ok(restored.restored, 'بازیابی انجام شد');
  t.ok(fs.existsSync(restored.safetyBackup.file), 'پیش از بازیابی، نسخه ایمنی ساخته شد');
  const db2 = connection.get();
  t.eq(db2.prepare('SELECT COUNT(*) c FROM products').get().c, beforeCount, 'پس از بازیابی، وضعیت به لحظه پشتیبان بازگشت');
  t.eq(db2.prepare("SELECT COUNT(*) c FROM products WHERE code='AFTER1'").get().c, 0, 'کالای بعد از پشتیبان دیگر وجود ندارد');
  t.ok(restored.check.ok, 'سلامت پایگاه داده پس از بازیابی تأیید شد');
  t.assertLedgerBalanced(db2, 'پس از بازیابی');

  // پشتیبان‌گیری خودکار
  settings.set(db2, { auto_backup: '1', auto_backup_days: '1', last_auto_backup: '' });
  const auto1 = backup.autoBackup(db2, backupDir);
  t.ok(!auto1.skipped, 'پشتیبان‌گیری خودکار در اولین اجرا انجام شد');
  const auto2 = backup.autoBackup(db2, backupDir);
  t.ok(auto2.skipped, 'پشتیبان‌گیری خودکار دوباره در همان روز انجام نمی‌شود');

  connection.close();

  // ── انتقال از نسخه قدیمی ───────────────────────────────────
  t.suite('انتقال اطلاعات از نسخه قبلی برنامه');
  const legacyFile = path.join(dir, 'shop.sqlite');
  const Database = require('better-sqlite3');
  const legacy = new Database(legacyFile);
  legacy.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, code TEXT, buy_price INTEGER, sell_price INTEGER, stock INTEGER, min_stock INTEGER);
    CREATE TABLE parties(id INTEGER PRIMARY KEY, type TEXT, name TEXT, phone TEXT, national_id TEXT, address TEXT, notes TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE invoices(id INTEGER PRIMARY KEY, type TEXT, invoice_no TEXT, party TEXT, date TEXT, subtotal INTEGER, discount INTEGER, vat INTEGER, total INTEGER, payment_method TEXT, notes TEXT);
    CREATE TABLE invoice_items(id INTEGER PRIMARY KEY, invoice_id INTEGER, product_id INTEGER, qty INTEGER, unit_price INTEGER, total INTEGER);
    CREATE TABLE checks(id INTEGER PRIMARY KEY, kind TEXT, number TEXT, bank TEXT, amount INTEGER, issue_date TEXT, due_date TEXT, party TEXT, status TEXT);
    INSERT INTO products(name,code,buy_price,sell_price,stock,min_stock) VALUES ('کالای قدیمی','OLD1',5000,8000,7,2);
    INSERT INTO parties(type,name,phone,national_id,address,notes) VALUES ('customer','مشتری قدیمی','0912','','','');
    INSERT INTO settings(key,value) VALUES ('shop_name','فروشگاه قدیمی'),('vat_rate','9');
    INSERT INTO invoices(type,invoice_no,party,date,subtotal,discount,vat,total,payment_method,notes)
      VALUES ('sale','1001','مشتری قدیمی','2025-01-01',80000,0,8000,88000,'cash','');
    INSERT INTO invoice_items(invoice_id,product_id,qty,unit_price,total) VALUES (1,1,10,8000,80000);
    INSERT INTO checks(kind,number,bank,amount,issue_date,due_date,party,status)
      VALUES ('received','555','ملت',500000,'2025-01-01','2025-03-01','مشتری قدیمی','pending');
  `);
  legacy.close();

  const targetFile = path.join(dir, 'fresh.sqlite');
  connection.open(targetFile);
  const found = backup.findLegacyDatabases([dir]);
  t.eq(found.length, 1, 'پایگاه داده نسخه قبلی پیدا شد');
  const imported = backup.importLegacy(legacyFile, { date: '2026-01-01' });
  t.eq(imported.products, 1, 'کالای نسخه قبلی منتقل شد');
  t.eq(imported.parties, 1, 'طرف حساب نسخه قبلی منتقل شد');
  t.eq(imported.checks, 1, 'چک نسخه قبلی منتقل شد');
  t.eq(imported.documents, 1, 'فاکتور قدیمی به بایگانی منتقل شد');
  const fresh = connection.get();
  const migrated = fresh.prepare("SELECT * FROM products WHERE code='OLD1'").get();
  t.eq(migrated.stock, 7, 'موجودی کالای منتقل‌شده درست است');
  t.eq(migrated.stock_value, 35000, 'ارزش موجودی اول دوره = ۷ × ۵٬۰۰۰');
  t.eq(settings.get(fresh, 'shop_name'), 'فروشگاه قدیمی', 'نام فروشگاه منتقل شد');
  t.assertLedgerBalanced(fresh, 'پس از انتقال از نسخه قبلی');
  t.assertInventoryMatches(fresh, 'پس از انتقال از نسخه قبلی');
  connection.close();

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* نادیده */ }
};
