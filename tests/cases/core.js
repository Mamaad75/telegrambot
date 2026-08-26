'use strict';
/** سناریوهای اصلی حسابداری: فروش، خرید، برگشتی، هزینه، چک، انتقال و ... */
const t = require('../helper');
const accounting = require('../../src/main/services/accounting');
const products = require('../../src/main/services/products');
const parties = require('../../src/main/services/parties');
const invoices = require('../../src/main/services/invoices');
const payments = require('../../src/main/services/payments');
const checks = require('../../src/main/services/checks');
const cashbook = require('../../src/main/services/cashbook');
const settingsSvc = require('../../src/main/services/settings');
const inventory = require('../../src/main/services/inventory');

const D = '2026-05-10';

function setup() {
  const { db } = t.freshDb('core');
  cashbook.openingBalances(db, { date: '2026-05-01', 101: 100000000 });
  const p1 = products.create(db, { name: 'کالای آزمایشی', code: 'A1', barcode: '1111', sell_price: 3000000, buy_price: 2000000, unit: 'عدد' });
  const p2 = products.create(db, { name: 'کالای دوم', code: 'A2', sell_price: 500000, buy_price: 300000 });
  const cust = parties.create(db, { type: 'customer', name: 'مشتری آزمایشی', phone: '09120000000' });
  const supp = parties.create(db, { type: 'supplier', name: 'تأمین‌کننده آزمایشی' });
  // خرید ۱۰ عدد × ۲٬۰۰۰٬۰۰۰ نقدی
  invoices.create(db, {
    type: 'purchase', date: '2026-05-02', party_id: supp.id,
    items: [{ product_id: p1.id, qty: 10, unit_price: 2000000 }],
    payments: [{ method: 'cash', amount: 20000000 }],
  });
  return { db, p1, p2, cust, supp };
}

function balance(db, code) { return accounting.accountBalance(db, code).balance; }

module.exports = function run() {
  // ── الف: فروش نقدی ─────────────────────────────────────────────
  t.suite('الف) فروش نقدی + ارزش افزوده ۱۰٪ + بهای تمام‌شده');
  {
    const { db, p1, cust } = setup();
    const res = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 4, unit_price: 3000000 }],
      payments: [{ method: 'cash', amount: 13200000 }],
    });
    const inv = res.invoice;
    t.eq(inv.subtotal, 12000000, 'جمع کالاها = ۱۲٬۰۰۰٬۰۰۰');
    t.eq(inv.vat, 1200000, 'ارزش افزوده ۱۰٪ = ۱٬۲۰۰٬۰۰۰');
    t.eq(inv.total, 13200000, 'مبلغ نهایی = ۱۳٬۲۰۰٬۰۰۰');
    t.eq(inv.due, 0, 'مانده فاکتور صفر است');
    t.eq(inv.cogs, 8000000, 'بهای تمام‌شده = ۴ × ۲٬۰۰۰٬۰۰۰');
    t.eq(balance(db, '101'), 100000000 - 20000000 + 13200000, 'مانده صندوق درست است');
    t.eq(balance(db, '401'), 12000000, 'حساب فروش');
    t.eq(balance(db, '202'), 1200000, 'ارزش افزوده پرداختنی');
    t.eq(balance(db, '503'), 8000000, 'حساب بهای تمام‌شده');
    t.eq(balance(db, '106'), 12000000, 'موجودی کالا = ۶ عدد × ۲٬۰۰۰٬۰۰۰');
    t.eq(products.get(db, p1.id).stock, 6, 'موجودی انبار ۶ عدد');
    t.assertLedgerBalanced(db, 'فروش نقدی');
    t.assertInventoryMatches(db, 'فروش نقدی');
  }

  // ── ب/ج: کارتخوان و بانک ───────────────────────────────────────
  t.suite('ب و ج) فروش با کارتخوان و کارت‌به‌کارت');
  {
    const { db, p1, cust } = setup();
    invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 1, unit_price: 3000000 }],
      payments: [{ method: 'pos', amount: 3300000 }],
    });
    invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 1, unit_price: 3000000 }],
      payments: [{ method: 'bank', amount: 3300000 }],
    });
    t.eq(balance(db, '102'), 3300000, 'مانده کارتخوان');
    t.eq(balance(db, '103'), 3300000, 'مانده بانک');
    t.assertLedgerBalanced(db, 'کارتخوان/بانک');
    t.assertInventoryMatches(db, 'کارتخوان/بانک');
  }

  // ── د: فروش نسیه ───────────────────────────────────────────────
  t.suite('د) فروش نسیه و بدهکار شدن مشتری');
  {
    const { db, p1, cust } = setup();
    const res = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 2, unit_price: 3000000 }],
      payments: [],
    });
    t.eq(res.invoice.due, 6600000, 'کل فاکتور نسیه است');
    t.eq(accounting.partyBalance(db, cust.id), 6600000, 'مانده بدهکاری مشتری');
    t.eq(balance(db, '105'), 6600000, 'حساب‌های دریافتنی');
    t.throws(() => invoices.create(db, {
      type: 'sale', date: D, items: [{ product_id: p1.id, qty: 1, unit_price: 3000000 }], payments: [],
    }), 'فروش نسیه بدون مشتری رد می‌شود');
    t.assertLedgerBalanced(db, 'فروش نسیه');
  }

  // ── ه/و: چک و پرداخت ترکیبی ────────────────────────────────────
  t.suite('ه و و) فروش با چک و پرداخت ترکیبی');
  {
    const { db, p1, cust } = setup();
    const res = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id, vat_rate: 0,
      items: [{ product_id: p1.id, qty: 5, unit_price: 2000000 }],
      payments: [
        { method: 'cash', amount: 2000000 },
        { method: 'pos', amount: 5000000 },
        { method: 'check', amount: 3000000, check: { number: '123456', bank: 'ملت', due_date: '2026-06-10' } },
      ],
    });
    t.eq(res.invoice.total, 10000000, 'مبلغ کل ۱۰٬۰۰۰٬۰۰۰');
    t.eq(res.invoice.paid, 10000000, 'کل مبلغ تسویه شده');
    t.eq(res.invoice.due, 0, 'مانده صفر');
    t.eq(balance(db, '101'), 100000000 - 20000000 + 2000000, 'صندوق: ۲٬۰۰۰٬۰۰۰ افزوده شد');
    t.eq(balance(db, '102'), 5000000, 'کارتخوان: ۵٬۰۰۰٬۰۰۰');
    t.eq(balance(db, '104'), 3000000, 'اسناد دریافتنی: ۳٬۰۰۰٬۰۰۰');
    const chk = checks.list(db, {}).rows[0];
    t.eq(chk.amount, 3000000, 'چک با مبلغ درست ثبت شد');
    t.eq(chk.status, 'pending', 'وضعیت چک: در جریان');
    t.assertLedgerBalanced(db, 'پرداخت ترکیبی');

    // ── ق: وصول چک
    checks.changeStatus(db, chk.id, 'cleared', { date: '2026-06-10', account: '103' });
    t.eq(balance(db, '104'), 0, 'پس از وصول، اسناد دریافتنی صفر شد');
    t.eq(balance(db, '103'), 3000000, 'مبلغ چک به بانک منتقل شد');
    t.assertLedgerBalanced(db, 'وصول چک');
  }

  // ── ر: چک برگشتی ───────────────────────────────────────────────
  t.suite('ر) چک برگشتی');
  {
    const { db, p1, cust } = setup();
    invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id, vat_rate: 0,
      items: [{ product_id: p1.id, qty: 1, unit_price: 5000000 }],
      payments: [{ method: 'check', amount: 5000000, check: { number: '777', bank: 'صادرات', due_date: '2026-06-01' } }],
    });
    const chk = checks.list(db, {}).rows[0];
    checks.changeStatus(db, chk.id, 'returned', { date: '2026-06-02' });
    t.eq(balance(db, '104'), 0, 'اسناد دریافتنی صفر شد');
    t.eq(accounting.partyBalance(db, cust.id), 5000000, 'بدهی مشتری بازگشت');
    t.eq(checks.get(db, chk.id).check.status, 'returned', 'وضعیت چک: برگشتی');
    t.assertLedgerBalanced(db, 'چک برگشتی');
  }

  // ── ز/ح: خرید نقدی و نسیه ──────────────────────────────────────
  t.suite('ز و ح) خرید نقدی و نسیه');
  {
    const { db, p2, supp } = setup();
    invoices.create(db, {
      type: 'purchase', date: D, party_id: supp.id,
      items: [{ product_id: p2.id, qty: 20, unit_price: 300000 }],
      payments: [{ method: 'cash', amount: 6000000 }],
    });
    const credit = invoices.create(db, {
      type: 'purchase', date: D, party_id: supp.id,
      items: [{ product_id: p2.id, qty: 10, unit_price: 400000 }],
      payments: [],
    });
    t.eq(credit.invoice.due, 4000000, 'خرید نسیه: بدهی ۴٬۰۰۰٬۰۰۰');
    t.eq(accounting.partyBalance(db, supp.id), 4000000, 'مانده بستانکاری تأمین‌کننده');
    t.eq(products.get(db, p2.id).stock, 30, 'موجودی کالای دوم ۳۰ عدد');
    t.eq(products.get(db, p2.id).stock_value, 10000000, 'ارزش موجودی = ۶٬۰۰۰٬۰۰۰ + ۴٬۰۰۰٬۰۰۰');
    t.near(inventory.avgCost(products.get(db, p2.id)), 333333.33, 1, 'میانگین موزون بهای هر واحد');
    t.assertLedgerBalanced(db, 'خرید');
    t.assertInventoryMatches(db, 'خرید');

    // ── ن: پرداخت به تأمین‌کننده
    payments.create(db, { kind: 'payment', date: D, party_id: supp.id, lines: [{ method: 'cash', amount: 4000000 }] });
    t.eq(accounting.partyBalance(db, supp.id), 0, 'بدهی تأمین‌کننده تسویه شد');
    const inv = invoices.getFull(db, credit.invoice.id).invoice;
    t.eq(inv.due, 0, 'مانده فاکتور خرید صفر شد (تخصیص خودکار)');
    t.assertLedgerBalanced(db, 'پرداخت به تأمین‌کننده');
  }

  // ── ط: برگشت از فروش ───────────────────────────────────────────
  t.suite('ط) برگشت از فروش');
  {
    const { db, p1, cust } = setup();
    const sale = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 4, unit_price: 3000000 }],
      payments: [{ method: 'cash', amount: 13200000 }],
    });
    const ret = invoices.create(db, {
      type: 'sale_return', date: '2026-05-12', party_id: cust.id, ref_invoice_id: sale.invoice.id,
      items: [{ product_id: p1.id, qty: 1, unit_price: 3000000 }],
      payments: [{ method: 'cash', amount: 3300000 }],
    });
    t.eq(ret.invoice.total, 3300000, 'مبلغ برگشتی با ارزش افزوده');
    t.eq(products.get(db, p1.id).stock, 7, 'کالا به انبار بازگشت (۷ عدد)');
    t.eq(balance(db, '403'), 3000000, 'حساب برگشت از فروش');
    t.eq(balance(db, '202'), 1200000 - 300000, 'ارزش افزوده کاهش یافت');
    t.eq(balance(db, '503'), 8000000 - 2000000, 'بهای تمام‌شده برگشت خورد');
    t.eq(balance(db, '106'), 14000000, 'موجودی کالا = ۷ × ۲٬۰۰۰٬۰۰۰');
    t.eq(balance(db, '101'), 100000000 - 20000000 + 13200000 - 3300000, 'وجه نقد بازگردانده شد');
    t.assertLedgerBalanced(db, 'برگشت از فروش');
    t.assertInventoryMatches(db, 'برگشت از فروش');
  }

  // ── ی: برگشت از خرید ───────────────────────────────────────────
  t.suite('ی) برگشت از خرید');
  {
    const { db, p1, supp } = setup();
    const ret = invoices.create(db, {
      type: 'purchase_return', date: D, party_id: supp.id,
      items: [{ product_id: p1.id, qty: 2, unit_price: 2000000 }],
      payments: [{ method: 'cash', amount: 4000000 }],
    });
    t.eq(ret.invoice.total, 4000000, 'مبلغ برگشت از خرید');
    t.eq(products.get(db, p1.id).stock, 8, 'موجودی به ۸ عدد کاهش یافت');
    t.eq(balance(db, '106'), 16000000, 'ارزش موجودی کالا');
    t.eq(balance(db, '101'), 100000000 - 20000000 + 4000000, 'وجه نقد بازگشت');
    t.assertLedgerBalanced(db, 'برگشت از خرید');
    t.assertInventoryMatches(db, 'برگشت از خرید');
  }

  // ── ک/ل/م: هزینه، درآمد، انتقال ────────────────────────────────
  t.suite('ک و ل و م) هزینه، درآمد متفرقه و انتقال وجه');
  {
    const { db } = setup();
    const rent = db.prepare("SELECT id FROM categories WHERE kind='expense' AND name='اجاره'").get();
    cashbook.addExpense(db, { date: D, category_id: rent.id, amount: 5000000, method: 'cash', description: 'اجاره اردیبهشت' });
    t.eq(balance(db, '502-01'), 5000000, 'هزینه اجاره ثبت شد');
    t.eq(balance(db, '101'), 100000000 - 20000000 - 5000000, 'کاهش صندوق');

    const svc = db.prepare("SELECT id FROM categories WHERE kind='income' AND name='درآمد خدمات'").get();
    cashbook.addIncome(db, { date: D, category_id: svc.id, amount: 1500000, method: 'cash' });
    t.eq(balance(db, '402-01'), 1500000, 'درآمد خدمات ثبت شد');

    const before = accounting.profitLoss(db, {}).netProfit;
    cashbook.addTransfer(db, { date: D, from_code: '101', to_code: '103', amount: 10000000 });
    const after = accounting.profitLoss(db, {}).netProfit;
    t.eq(balance(db, '103'), 10000000, 'وجه به بانک منتقل شد');
    t.eq(before, after, 'انتقال وجه بر سود و زیان اثری ندارد');
    t.assertLedgerBalanced(db, 'هزینه/درآمد/انتقال');
  }

  // ── س: دریافت از مشتری ─────────────────────────────────────────
  t.suite('ن) دریافت از مشتری و تخصیص به فاکتور');
  {
    const { db, p1, cust } = setup();
    const sale = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id, vat_rate: 0,
      items: [{ product_id: p1.id, qty: 3, unit_price: 3000000 }], payments: [],
    });
    t.eq(accounting.partyBalance(db, cust.id), 9000000, 'بدهی مشتری ۹٬۰۰۰٬۰۰۰');
    payments.create(db, { kind: 'receipt', date: D, party_id: cust.id, lines: [{ method: 'cash', amount: 5000000 }] });
    t.eq(accounting.partyBalance(db, cust.id), 4000000, 'مانده بدهی مشتری کاهش یافت');
    t.eq(invoices.getFull(db, sale.invoice.id).invoice.due, 4000000, 'مانده فاکتور به‌روزرسانی شد');
    t.assertLedgerBalanced(db, 'دریافت از مشتری');
  }

  // ── ش: اصلاح موجودی ────────────────────────────────────────────
  t.suite('س) اصلاح موجودی انبار (انبارگردانی)');
  {
    const { db, p1 } = setup();
    products.adjustStock(db, { productId: p1.id, mode: 'set', qty: 9, date: D, description: 'انبارگردانی' });
    t.eq(products.get(db, p1.id).stock, 9, 'موجودی به ۹ اصلاح شد');
    t.eq(balance(db, '106'), 18000000, 'ارزش موجودی کالا اصلاح شد');
    t.eq(balance(db, '502-90'), 2000000, 'کسری انبار به حساب هزینه رفت');
    t.assertLedgerBalanced(db, 'اصلاح موجودی');
    t.assertInventoryMatches(db, 'اصلاح موجودی');
  }

  // ── جلوگیری از موجودی منفی ─────────────────────────────────────
  t.suite('کنترل موجودی منفی');
  {
    const { db, p1, cust } = setup();
    t.throws(() => invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 50, unit_price: 3000000 }],
      payments: [{ method: 'cash', amount: 165000000 }],
    }), 'فروش بیش از موجودی رد می‌شود');
    settingsSvc.set(db, { allow_negative_stock: '1' });
    const okRes = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id, vat_rate: 0,
      items: [{ product_id: p1.id, qty: 12, unit_price: 3000000 }],
      payments: [{ method: 'cash', amount: 36000000 }],
    });
    t.eq(okRes.invoice.total, 36000000, 'با فعال بودن تنظیمات، فروش منفی مجاز است');
    t.eq(products.get(db, p1.id).stock, -2, 'موجودی منفی شد');
    t.assertLedgerBalanced(db, 'موجودی منفی');
  }

  // ── ابطال فاکتور ───────────────────────────────────────────────
  t.suite('ابطال فاکتور و بازگشت کامل آثار آن');
  {
    const { db, p1, cust } = setup();
    const before = { cash: balance(db, '101'), stock: products.get(db, p1.id).stock };
    const sale = invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 3, unit_price: 3000000 }],
      payments: [{ method: 'cash', amount: 9900000 }],
    });
    invoices.voidInvoice(db, sale.invoice.id, 'اشتباه در ثبت');
    t.eq(balance(db, '101'), before.cash, 'وجه نقد به حالت قبل بازگشت');
    t.eq(products.get(db, p1.id).stock, before.stock, 'موجودی انبار به حالت قبل بازگشت');
    t.eq(balance(db, '401'), 0, 'حساب فروش صفر شد');
    t.eq(balance(db, '503'), 0, 'بهای تمام‌شده صفر شد');
    t.eq(invoices.getFull(db, sale.invoice.id).invoice.status, 'void', 'وضعیت فاکتور: ابطال‌شده');
    t.assertLedgerBalanced(db, 'ابطال فاکتور');
    t.assertInventoryMatches(db, 'ابطال فاکتور');
  }

  // ── تراکنش اتمی ────────────────────────────────────────────────
  t.suite('یکپارچگی داده: شکست عملیات نباید سند ناقص بگذارد');
  {
    const { db, p1, cust } = setup();
    const invBefore = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;
    const entBefore = db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c;
    const stockBefore = products.get(db, p1.id).stock;
    t.throws(() => invoices.create(db, {
      type: 'sale', date: D, party_id: cust.id,
      items: [{ product_id: p1.id, qty: 2, unit_price: 3000000 }, { product_id: 99999, qty: 1, unit_price: 100 }],
      payments: [{ method: 'cash', amount: 100 }],
    }), 'فاکتور با کالای نامعتبر رد می‌شود');
    t.eq(db.prepare('SELECT COUNT(*) c FROM invoices').get().c, invBefore, 'هیچ فاکتوری ثبت نشد');
    t.eq(db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c, entBefore, 'هیچ سندی ثبت نشد');
    t.eq(products.get(db, p1.id).stock, stockBefore, 'موجودی انبار دست‌نخورده ماند');
  }

  // ── سند نامتوازن ───────────────────────────────────────────────
  t.suite('رد کردن سند نامتوازن توسط موتور حسابداری');
  {
    const { db } = t.freshDb('unbalanced');
    t.throws(() => accounting.postEntry(db, {
      date: D, refType: 'manual', description: 'تست',
      lines: [{ account: '101', debit: 1000 }, { account: '401', credit: 900 }],
    }), 'سند نامتوازن ثبت نمی‌شود');
    t.eq(db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c, 0, 'سند ناقص در پایگاه داده باقی نماند');
  }
};
