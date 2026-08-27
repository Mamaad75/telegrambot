'use strict';
/** آزمون فهرست پیش‌فرض کالاها (لیست قیمت رسمی) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('../helper');
const connection = require('../../src/main/db/connection');
const { MIGRATIONS } = require('../../src/main/db/migrations');
const seed = require('../../src/main/db/seed-products.json');
const products = require('../../src/main/services/products');
const invoices = require('../../src/main/services/invoices');
const parties = require('../../src/main/services/parties');
const settings = require('../../src/main/services/settings');
const accounting = require('../../src/main/services/accounting');

module.exports = function run() {
  t.suite('فهرست پیش‌فرض کالاها');
  const { db } = t.freshDb('seed');

  const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  t.eq(count, seed.products.length, `همه ${seed.products.length} کالای پیش‌فرض ثبت شد`);
  t.eq(settings.get(db, 'seed_products_added'), String(seed.products.length), 'تعداد افزوده‌شده در تنظیمات ثبت شد');

  const codes = db.prepare('SELECT code FROM products').all().map((x) => x.code);
  t.eq(new Set(codes).size, codes.length, 'کد کالاها تکراری نیست');
  t.eq(db.prepare(`SELECT COUNT(*) c FROM products WHERE code=''`).get().c, 0, 'همه کالاها کد دارند');
  t.eq(db.prepare(`SELECT COUNT(*) c FROM products WHERE sell_price<=0`).get().c, 0, 'همه کالاها قیمت فروش دارند');
  t.eq(db.prepare(`SELECT COUNT(*) c FROM products WHERE buy_price<>0`).get().c, 0, 'قیمت خرید صفر است (باید هنگام خرید وارد شود)');
  t.eq(db.prepare(`SELECT COUNT(*) c FROM products WHERE stock<>0`).get().c, 0, 'موجودی اولیه صفر است');
  t.eq(db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c, 0, 'ثبت کالاهای پیش‌فرض هیچ سند حسابداری نمی‌سازد');

  const cats = db.prepare(`SELECT name FROM categories WHERE kind='product'`).all().map((x) => x.name);
  for (const c of seed.categories) t.ok(cats.includes(c), `دسته‌بندی «${c}» ساخته شد`);
  t.eq(db.prepare('SELECT COUNT(*) c FROM products WHERE category_id IS NULL').get().c, 0, 'همه کالاها دسته‌بندی دارند');

  // نمونه‌های شاخص از لیست قیمت
  const samples = [
    ['30104009', 'کاتالیست تیبا (AM)', 88740000],
    ['31204001', 'فلکسیبل EF7 قطر 49.5 در 170-دو سرلوله', 8498000],
    ['30429002', 'منبع انتهایی اگزوز بایک X7', 105400000],
    ['30602004', 'رینگ سیل R2', 980000],
    ['30206023', 'کاتاباکس پرو — کد 30206023', 555557000],
  ];
  for (const [code, name, price] of samples) {
    const p = db.prepare('SELECT * FROM products WHERE code=?').get(code);
    t.ok(!!p, `کالای ${code} موجود است`);
    if (p) {
      t.eq(p.name, name, `نام کالای ${code}`);
      t.eq(p.sell_price, price, `قیمت فروش کالای ${code} (پیش از ارزش افزوده)`);
    }
  }

  // جست‌وجو با کد و نام
  t.eq(products.search(db, '30104009', 5).length, 1, 'جست‌وجو با کد کالا نتیجه می‌دهد');
  t.ok(products.search(db, 'کاتالیست', 200).length > 30, 'جست‌وجو با نام فارسی نتیجه می‌دهد');
  t.ok(products.byBarcode(db, '30104009') !== null, 'یافتن کالا با کد از طریق بارکدخوان');

  // قیمت پیش از مالیات است: فاکتور فروش باید ۱۰٪ اضافه کند
  t.suite('قیمت پیش‌فرض پیش از ارزش افزوده است');
  const prod = db.prepare(`SELECT * FROM products WHERE code='30104009'`).get();
  const supplier = parties.create(db, { type: 'supplier', name: 'تأمین‌کننده' });
  const customer = parties.create(db, { type: 'customer', name: 'مشتری' });
  invoices.create(db, {
    type: 'purchase', date: '2026-05-01', party_id: supplier.id,
    items: [{ product_id: prod.id, qty: 2, unit_price: 70000000 }],
    payments: [{ method: 'cash', amount: 140000000 }],
  });
  const sale = invoices.create(db, {
    type: 'sale', date: '2026-05-02', party_id: customer.id,
    items: [{ product_id: prod.id, qty: 1, unit_price: prod.sell_price }],
    payments: [{ method: 'cash', amount: 97614000 }],
  });
  t.eq(sale.invoice.taxable, 88740000, 'مبلغ مشمول = قیمت لیست');
  t.eq(sale.invoice.vat, 8874000, 'ارزش افزوده ۱۰٪ محاسبه شد');
  t.eq(sale.invoice.total, 97614000, 'مبلغ نهایی = قیمت با ارزش افزوده در لیست قیمت رسمی');
  t.assertLedgerBalanced(db, 'فروش کالای پیش‌فرض');
  t.assertInventoryMatches(db, 'فروش کالای پیش‌فرض');

  // ارتقا از نسخه ۱ به ۲ نباید کالاهای کاربر را تغییر دهد
  t.suite('ارتقای پایگاه داده موجود بدون آسیب به داده کاربر');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myshop-seed-'));
  const file = path.join(dir, 'old.sqlite');
  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.pragma('journal_mode = WAL');
  MIGRATIONS[0].up(old);
  old.pragma('user_version = 1');
  const now = new Date().toISOString();
  old.prepare(`INSERT INTO products(name,code,barcode,unit,buy_price,sell_price,min_stock,stock,stock_value,description,active,created_at,updated_at)
               VALUES ('کالای خود فروشگاه','30104009','',' عدد',111,222,0,7,777,'',1,?,?)`).run(now, now);
  old.prepare(`INSERT INTO products(name,code,barcode,unit,buy_price,sell_price,min_stock,stock,stock_value,description,active,created_at,updated_at)
               VALUES ('کالای اختصاصی','ZZ-1','',' عدد',10,20,0,3,30,'',1,?,?)`).run(now, now);
  old.close();

  const { db: upgraded, migration } = connection.open(file);
  t.eq(migration.from, 1, 'پایگاه داده از نسخه ۱ ارتقا یافت');
  t.eq(migration.to, 2, 'به نسخه ۲ رسید');
  const kept = upgraded.prepare(`SELECT * FROM products WHERE code='30104009'`).get();
  t.eq(kept.name, 'کالای خود فروشگاه', 'کالای هم‌کد کاربر بازنویسی نشد');
  t.eq(kept.stock, 7, 'موجودی کالای کاربر دست‌نخورده ماند');
  t.eq(kept.sell_price, 222, 'قیمت کالای کاربر دست‌نخورده ماند');
  t.ok(!!upgraded.prepare(`SELECT id FROM products WHERE code='ZZ-1'`).get(), 'کالای اختصاصی کاربر حفظ شد');
  t.eq(upgraded.prepare('SELECT COUNT(*) c FROM products').get().c, seed.products.length + 1,
    'فقط کالاهای جدید افزوده شدند');
  t.eq(settings.get(upgraded, 'seed_products_added'), String(seed.products.length - 1), 'تعداد واقعی افزوده‌شده ثبت شد');
  connection.close();

  // اجرای دوباره مهاجرت‌ها نباید چیزی اضافه کند
  const { db: again, migration: m2 } = connection.open(file);
  t.eq(m2.applied.length, 0, 'مهاجرت دوباره اجرا نمی‌شود');
  t.eq(again.prepare('SELECT COUNT(*) c FROM products').get().c, seed.products.length + 1, 'تعداد کالاها ثابت ماند');
  connection.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* نادیده */ }
};
