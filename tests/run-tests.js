'use strict';
/*
 * آزمون خودکار موتور حسابداری.
 * سناریوهای A تا Y به علاوه آزمون صحت حسابداری اجرا و پس از هر عملیات بررسی می‌شود که
 * «جمع بدهکار = جمع بستانکار» و حساب موجودی کالا با ارزش واقعی انبار برابر باشد.
 *
 * اجرا:  npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const connection = require('../src/db/connection.js');
const settings = require('../src/services/settings.js');
const products = require('../src/services/products.js');
const parties = require('../src/services/parties.js');
const bankAccounts = require('../src/services/bankAccounts.js');
const sales = require('../src/services/sales.js');
const purchases = require('../src/services/purchases.js');
const returns = require('../src/services/returns.js');
const payments = require('../src/services/payments.js');
const checks = require('../src/services/checks.js');
const cashbook = require('../src/services/cashbook.js');
const inventory = require('../src/services/inventory.js');
const reports = require('../src/services/reports.js');
const journal = require('../src/services/journal.js');
const backup = require('../src/services/backup.js');
const excel = require('../src/services/excel.js');
const C = require('../src/shared/constants.js');
const Jalali = require('../src/shared/jalali.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shopacc-test-'));
const DB_FILE = path.join(TMP, 'test.db');

let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else {
    failed++;
    failures.push(name + (detail ? ' → ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'انتظار ' + expected + ' ولی ' + actual);
}

function section(title) { console.log('\n' + title); }

/** پس از هر عملیات: تراز بودن کل دفتر و تطابق انبار با حساب ۱۰۶ */
function assertIntegrity(db, label) {
  const r = reports.integrity(db);
  ok('تراز حسابداری پس از ' + label, r.trial_balanced && r.unbalanced_entries.length === 0,
    'بدهکار ' + r.total_debit + ' / بستانکار ' + r.total_credit + ' / اسناد ناتراز ' + r.unbalanced_entries.length);
  ok('تطابق انبار با حساب ۱۰۶ پس از ' + label, r.inventory_matches,
    'دفتر ' + r.inventory_gl + ' / انبار ' + r.inventory_stock_value);
  return r;
}

function bal(db, code, opt) { return journal.accountBalance(db, code, opt || {}); }

async function main() {
  console.log('پایگاه داده آزمون: ' + DB_FILE);
  const db = connection.open(DB_FILE);

  const D = '2025-06-01';   // تاریخ پایه آزمون
  const D2 = '2025-06-02';
  const D3 = '2025-06-03';

  section('۰) آماده‌سازی');
  settings.setMany(db, { vat_rate: '10', allow_negative_stock: '0', shop_name: 'فروشگاه آزمون', currency: 'تومان' });
  eq('نرخ مالیات پیش‌فرض', settings.getNumber(db, 'vat_rate'), 10);

  const bankAcc = bankAccounts.create(db, {
    title: 'حساب جاری ملت', kind: 'bank', bank_name: 'ملت', branch: 'مرکزی',
    account_number: '1234567890', card_number: '6104-3378-1234-5678',
    iban: 'IR820540102680020817909002', owner_name: 'مالک فروشگاه', opening_balance: 0, date: D
  });
  ok('ساخت حساب بانکی', !!bankAcc.id);
  eq('شماره کارت نرمال‌سازی شد', bankAcc.card_number, '6104337812345678');
  eq('شبا نرمال‌سازی شد', bankAcc.iban, 'IR820540102680020817909002');

  const posAcc = bankAccounts.create(db, { title: 'کارتخوان صندوق', kind: 'pos', bank_name: 'ملت', date: D });
  ok('ساخت کارتخوان', posAcc.kind === 'pos');

  const bank2 = bankAccounts.create(db, {
    title: 'حساب پس‌انداز صادرات', kind: 'bank', bank_name: 'صادرات',
    account_number: '9876543210', card_number: '6037991122334455', opening_balance: 5000000, date: D
  });
  eq('مانده اولیه حساب دوم', bankAccounts.get(db, bank2.id).balance, 5000000);
  ok('چند حساب بانکی همزمان', bankAccounts.list(db, {}).length === 3);

  // سرمایه اولیه نقدی ۱۰۰٬۰۰۰٬۰۰۰
  cashbook.createCapital(db, { date: D, amount: 100000000, method: 'cash', description: 'سرمایه اولیه نقدی' });
  eq('موجودی صندوق اولیه', bal(db, C.ACC.CASH), 100000000);
  assertIntegrity(db, 'آماده‌سازی');

  const cust = parties.create(db, 'customer', { name: 'مشتری یک', phone: '09120000001' });
  const cust2 = parties.create(db, 'customer', { name: 'مشتری دو', phone: '09120000002' });
  const sup = parties.create(db, 'supplier', { name: 'تأمین‌کننده الف', phone: '09130000001' });
  ok('ساخت مشتری و تأمین‌کننده', !!cust.id && !!sup.id);

  const p1 = products.create(db, { name: 'کالای آزمون', code: 'K-0001', barcode: '6260001112223', unit: 'عدد', sale_price: 3000000, purchase_price: 2000000, min_stock: 2 });
  const p2 = products.create(db, { name: 'کالای دوم', code: 'K-0002', sale_price: 500000, purchase_price: 300000 });
  ok('ساخت کالا', !!p1.id && !!p2.id);

  section('G) خرید نقدی');
  const purch1 = purchases.create(db, {
    date: D, supplier_id: sup.id, items: [{ product_id: p1.id, qty: 10, unit_price: 2000000 }],
    payments: [{ method: 'cash', amount: 20000000 }]
  });
  eq('مبلغ فاکتور خرید', purch1.total, 20000000);
  eq('موجودی کالا پس از خرید', products.get(db, p1.id).stock_qty, 10);
  eq('ارزش انبار پس از خرید', products.get(db, p1.id).stock_value, 20000000);
  eq('صندوق پس از خرید نقدی', bal(db, C.ACC.CASH), 80000000);
  eq('مانده تأمین‌کننده صفر', parties.balance(db, 'supplier', sup.id), 0);
  assertIntegrity(db, 'خرید نقدی');

  section('H) خرید نسیه');
  const purch2 = purchases.create(db, {
    date: D, supplier_id: sup.id, items: [{ product_id: p2.id, qty: 20, unit_price: 300000 }], payments: []
  });
  eq('مبلغ خرید نسیه', purch2.total, 6000000);
  eq('بدهی به تأمین‌کننده', parties.balance(db, 'supplier', sup.id), 6000000);
  eq('حساب پرداختنی', bal(db, C.ACC.PAYABLE), 6000000);
  assertIntegrity(db, 'خرید نسیه');

  section('A) فروش نقدی');
  const s1 = sales.create(db, {
    date: D, customer_id: cust.id, items: [{ product_id: p1.id, qty: 4, unit_price: 3000000 }],
    payments: [{ method: 'cash', amount: 13200000 }]
  });
  eq('مبلغ مشمول مالیات', s1.taxable, 12000000);
  eq('مالیات ۱۰٪', s1.vat_amount, 1200000);
  eq('مبلغ نهایی فاکتور', s1.total, 13200000);
  eq('بهای تمام‌شده فروش', s1.cogs, 8000000);
  eq('موجودی پس از فروش', products.get(db, p1.id).stock_qty, 6);
  eq('صندوق پس از فروش نقدی', bal(db, C.ACC.CASH), 93200000);
  eq('مانده مشتری صفر', parties.balance(db, 'customer', cust.id), 0);
  assertIntegrity(db, 'فروش نقدی');

  section('B) فروش با کارتخوان');
  const s2 = sales.create(db, {
    date: D, customer_id: cust.id, items: [{ product_id: p2.id, qty: 2, unit_price: 500000 }],
    payments: [{ method: 'pos', amount: 1100000, bank_account_id: posAcc.id }]
  });
  eq('مانده کارتخوان', bal(db, C.ACC.POS, { bank_account_id: posAcc.id }), 1100000);
  eq('جمع فاکتور کارتخوان', s2.total, 1100000);
  assertIntegrity(db, 'فروش با کارتخوان');

  section('C) فروش با واریز بانکی');
  const s3 = sales.create(db, {
    date: D, customer_id: cust.id, items: [{ product_id: p2.id, qty: 1, unit_price: 500000 }],
    payments: [{ method: 'bank', amount: 550000, bank_account_id: bankAcc.id }]
  });
  eq('مانده حساب بانکی', bal(db, C.ACC.BANK, { bank_account_id: bankAcc.id }), 550000);
  ok('تفکیک مانده هر حساب بانکی', bankAccounts.get(db, bank2.id).balance === 5000000);
  assertIntegrity(db, 'فروش بانکی');

  section('D) فروش نسیه');
  const s4 = sales.create(db, {
    date: D2, customer_id: cust2.id, items: [{ product_id: p1.id, qty: 1, unit_price: 3000000 }], payments: []
  });
  eq('بدهی مشتری نسیه', parties.balance(db, 'customer', cust2.id), 3300000);
  eq('مانده فاکتور نسیه', sales.get(db, s4.id).remaining, 3300000);
  assertIntegrity(db, 'فروش نسیه');

  section('E/P) فروش چکی و ثبت چک با کد یکتا');
  const s5 = sales.create(db, {
    date: D2, customer_id: cust.id, items: [{ product_id: p2.id, qty: 4, unit_price: 500000 }],
    payments: [{ method: 'check', amount: 2200000, check: { check_number: '123456', bank_name: 'سپه', holder_name: 'آقای رضایی', due_date: D3, sayad_id: '1234567890123456' } }]
  });
  const chk1 = sales.get(db, s5.id).checks[0];
  ok('کد یکتای چک ساخته شد', /^CHK-R-\d{6}$/.test(chk1.check_code), chk1.check_code);
  eq('چک به فاکتور متصل است', chk1.ref_no, s5.invoice_no);
  eq('حساب اسناد دریافتنی', bal(db, C.ACC.CHECKS_RECEIVABLE), 2200000);
  eq('مانده مشتری پس از فروش چکی', parties.balance(db, 'customer', cust.id), 0);
  assertIntegrity(db, 'فروش چکی');

  section('جست‌وجوی چک با کد / نام دارنده / شماره فاکتور');
  ok('یافتن چک با کد یکتا', checks.getByCode(db, chk1.check_code) !== null);
  ok('یافتن چک با نام دارنده', checks.list(db, { search: 'رضایی' }).length === 1);
  ok('یافتن چک با شماره فاکتور', checks.list(db, { search: s5.invoice_no }).length === 1);
  ok('یافتن چک با شماره چک', checks.list(db, { search: '123456' }).length >= 1);
  ok('یافتن چک با شناسه صیادی', checks.list(db, { search: '1234567890123456' }).length === 1);

  section('F) فروش با پرداخت ترکیبی');
  // فاکتور ۱۰٬۰۰۰٬۰۰۰ + مالیات ۱٬۰۰۰٬۰۰۰ = ۱۱٬۰۰۰٬۰۰۰ ؛ نقد ۲ + کارتخوان ۵ + چک ۴
  purchases.create(db, { date: D2, supplier_id: sup.id, items: [{ product_id: p1.id, qty: 10, unit_price: 2000000 }], payments: [{ method: 'cash', amount: 20000000 }] });
  const s6 = sales.create(db, {
    date: D2, customer_id: cust.id,
    items: [{ product_id: p1.id, qty: 4, unit_price: 2500000 }],
    payments: [
      { method: 'cash', amount: 2000000 },
      { method: 'pos', amount: 5000000, bank_account_id: posAcc.id },
      { method: 'check', amount: 4000000, check: { check_number: '778899', bank_name: 'ملی', holder_name: 'خانم احمدی', due_date: '2025-07-15' } }
    ]
  });
  eq('جمع فاکتور ترکیبی', s6.total, 11000000);
  const s6full = sales.get(db, s6.id);
  eq('تعداد ردیف‌های پرداخت', s6full.payments[0].payment_lines.length, 3);
  eq('مانده فاکتور ترکیبی', s6full.remaining, 0);
  eq('چک دوم ساخته شد', s6full.checks.length, 1);
  ok('کد یکتای چک دوم متفاوت است', s6full.checks[0].check_code !== chk1.check_code);
  assertIntegrity(db, 'پرداخت ترکیبی');

  section('N) دریافت از مشتری بابت فاکتور نسیه');
  const rec1 = payments.create(db, {
    direction: 'in', date: D3, party_type: 'customer', party_id: cust2.id,
    ref_type: 'sales_invoice', ref_id: s4.id,
    lines: [{ method: 'bank', amount: 2000000, bank_account_id: bankAcc.id }]
  });
  eq('مانده مشتری پس از دریافت', parties.balance(db, 'customer', cust2.id), 1300000);
  eq('مانده فاکتور پس از دریافت', sales.get(db, s4.id).remaining, 1300000);
  ok('شماره سند دریافت', /^RC-\d+$/.test(rec1.payment_no), rec1.payment_no);
  assertIntegrity(db, 'دریافت از مشتری');

  section('O) پرداخت به تأمین‌کننده');
  payments.create(db, {
    direction: 'out', date: D3, party_type: 'supplier', party_id: sup.id,
    ref_type: 'purchase_invoice', ref_id: purch2.id,
    lines: [{ method: 'cash', amount: 6000000 }]
  });
  eq('بدهی تأمین‌کننده تسویه شد', parties.balance(db, 'supplier', sup.id), 0);
  assertIntegrity(db, 'پرداخت به تأمین‌کننده');

  section('Q) وصول چک');
  const cashBefore = bal(db, C.ACC.CASH);
  const bankBefore = bal(db, C.ACC.BANK, { bank_account_id: bankAcc.id });
  checks.changeStatus(db, chk1.id, { status: 'deposited', date: D3, bank_account_id: bankAcc.id });
  eq('وضعیت پس از واگذاری', checks.get(db, chk1.id).status, 'deposited');
  checks.changeStatus(db, chk1.id, { status: 'cleared', date: D3, method: 'bank', bank_account_id: bankAcc.id });
  const chk1After = checks.get(db, chk1.id);
  eq('وضعیت چک وصول‌شده', chk1After.status, 'cleared');
  eq('بانک پس از وصول چک', bal(db, C.ACC.BANK, { bank_account_id: bankAcc.id }), bankBefore + 2200000);
  eq('اسناد دریافتنی پس از وصول', bal(db, C.ACC.CHECKS_RECEIVABLE), 4000000);
  ok('تاریخچه وضعیت چک ثبت شد', chk1After.events.length === 3);
  assertIntegrity(db, 'وصول چک');

  section('R) برگشت چک');
  const chk2 = s6full.checks[0];
  const custBalBefore = parties.balance(db, 'customer', cust.id);
  checks.changeStatus(db, chk2.id, { status: 'returned', date: D3 });
  eq('وضعیت چک برگشتی', checks.get(db, chk2.id).status, 'returned');
  eq('بدهی مشتری پس از برگشت چک', parties.balance(db, 'customer', cust.id), custBalBefore + 4000000);
  eq('اسناد دریافتنی پس از برگشت', bal(db, C.ACC.CHECKS_RECEIVABLE), 0);
  assertIntegrity(db, 'برگشت چک');

  section('چک صادره (پرداخت به تأمین‌کننده با چک)');
  const purch3 = purchases.create(db, {
    date: D3, supplier_id: sup.id, items: [{ product_id: p2.id, qty: 10, unit_price: 300000 }],
    payments: [{ method: 'check', amount: 3000000, check: { check_number: '555000', bank_name: 'ملت', holder_name: 'فروشگاه آزمون', due_date: '2025-08-01', bank_account_id: bankAcc.id } }]
  });
  const issued = purchases.get(db, purch3.id).checks[0];
  ok('کد یکتای چک صادره', /^CHK-P-\d{6}$/.test(issued.check_code), issued.check_code);
  eq('اسناد پرداختنی', bal(db, C.ACC.CHECKS_PAYABLE), 3000000);
  assertIntegrity(db, 'چک صادره');

  checks.changeStatus(db, issued.id, { status: 'paid', date: '2025-08-01', method: 'bank', bank_account_id: bankAcc.id });
  eq('وضعیت چک صادره', checks.get(db, issued.id).status, 'paid');
  eq('اسناد پرداختنی پس از پاس شدن', bal(db, C.ACC.CHECKS_PAYABLE), 0);
  assertIntegrity(db, 'پاس شدن چک صادره');

  section('I) برگشت از فروش');
  const s1full = sales.get(db, s1.id);
  const invBefore = inventory.totalValue(db).value;
  const sret = returns.createSalesReturn(db, {
    date: D3, invoice_id: s1.id, items: [{ item_id: s1full.items[0].id, qty: 1 }]
  });
  eq('مبلغ برگشت از فروش', sret.subtotal, 3000000);
  eq('مالیات برگشتی', sret.vat_amount, 300000);
  eq('بهای تمام‌شده برگشتی', sret.cogs, 2000000);
  eq('ارزش انبار پس از برگشت', inventory.totalValue(db).value, invBefore + 2000000);
  eq('بستانکاری مشتری بابت برگشت', parties.balance(db, 'customer', cust.id), custBalBefore + 4000000 - 3300000);
  assertIntegrity(db, 'برگشت از فروش');

  section('J) برگشت از خرید');
  const purch1full = purchases.get(db, purch1.id);
  const pret = returns.createPurchaseReturn(db, {
    date: D3, invoice_id: purch1.id, items: [{ item_id: purch1full.items[0].id, qty: 2 }]
  });
  eq('مبلغ برگشت از خرید', pret.subtotal, 4000000);
  eq('طلب از تأمین‌کننده', parties.balance(db, 'supplier', sup.id), -4000000);
  assertIntegrity(db, 'برگشت از خرید');

  section('K) هزینه');
  const cashBeforeExp = bal(db, C.ACC.CASH);
  const rentCat = db.prepare('SELECT id FROM expense_categories WHERE name=?').get('اجاره');
  cashbook.createExpense(db, { date: D3, category_id: rentCat.id, amount: 5000000, method: 'cash', description: 'اجاره خرداد' });
  eq('صندوق پس از هزینه', bal(db, C.ACC.CASH), cashBeforeExp - 5000000);
  eq('حساب هزینه عملیاتی', bal(db, C.ACC.OPERATING_EXPENSE) >= 5000000, true);
  assertIntegrity(db, 'ثبت هزینه');

  section('L) درآمد متفرقه');
  const incCat = db.prepare('SELECT id FROM income_categories WHERE name=?').get('درآمد خدمات');
  cashbook.createIncome(db, { date: D3, category_id: incCat.id, amount: 1500000, method: 'cash', description: 'خدمات نصب' });
  eq('حساب درآمد متفرقه', bal(db, C.ACC.OTHER_INCOME), 1500000);
  assertIntegrity(db, 'ثبت درآمد');

  section('M) انتقال از صندوق به بانک');
  const cashBeforeTr = bal(db, C.ACC.CASH);
  const bankBeforeTr = bal(db, C.ACC.BANK, { bank_account_id: bankAcc.id });
  const plBeforeTr = reports.profitAndLoss(db, {}).net_profit;
  cashbook.createTransfer(db, { date: D3, from_kind: 'cash', to_kind: 'bank', to_bank_account_id: bankAcc.id, amount: 10000000, description: 'واریز به بانک' });
  eq('صندوق پس از انتقال', bal(db, C.ACC.CASH), cashBeforeTr - 10000000);
  eq('بانک پس از انتقال', bal(db, C.ACC.BANK, { bank_account_id: bankAcc.id }), bankBeforeTr + 10000000);
  eq('انتقال روی سود اثر ندارد', reports.profitAndLoss(db, {}).net_profit, plBeforeTr);
  assertIntegrity(db, 'انتقال وجه');

  section('انتقال از کارتخوان به بانک');
  const posBefore = bal(db, C.ACC.POS, { bank_account_id: posAcc.id });
  cashbook.createTransfer(db, { date: D3, from_kind: 'pos', from_bank_account_id: posAcc.id, to_kind: 'bank', to_bank_account_id: bankAcc.id, amount: 1000000, fee: 5000 });
  eq('کارتخوان پس از انتقال', bal(db, C.ACC.POS, { bank_account_id: posAcc.id }), posBefore - 1005000);
  assertIntegrity(db, 'انتقال کارتخوان');

  section('S) اصلاح موجودی انبار');
  const p2Before = products.get(db, p2.id).stock_qty;
  inventory.adjust(db, { date: D3, product_id: p2.id, mode: 'out', qty: 1, description: 'ضایعات' });
  eq('موجودی پس از کاهش', products.get(db, p2.id).stock_qty, p2Before - 1);
  inventory.adjust(db, { date: D3, product_id: p2.id, mode: 'count', new_qty: 25, description: 'انبارگردانی' });
  eq('موجودی پس از انبارگردانی', products.get(db, p2.id).stock_qty, 25);
  assertIntegrity(db, 'اصلاح انبار');

  section('جلوگیری از موجودی منفی');
  let negErr = null;
  try {
    sales.create(db, { date: D3, customer_id: cust.id, items: [{ product_id: p1.id, qty: 9999, unit_price: 1000 }], payments: [] });
  } catch (e) { negErr = e.message; }
  ok('فروش بیش از موجودی رد شد', !!negErr && negErr.indexOf('کافی نیست') !== -1, negErr);
  assertIntegrity(db, 'رد فروش بدون موجودی');

  section('بازگشت کامل تراکنش هنگام خطا');
  const invCountBefore = db.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c;
  const entryCountBefore = db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c;
  try {
    sales.create(db, {
      date: D3, customer_id: cust.id,
      items: [{ product_id: p2.id, qty: 1, unit_price: 500000 }, { product_id: p1.id, qty: 9999, unit_price: 1000 }],
      payments: [{ method: 'cash', amount: 100 }]
    });
  } catch (e) { /* انتظار خطا */ }
  eq('هیچ فاکتور ناقصی ثبت نشد', db.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c, invCountBefore);
  eq('هیچ سند ناقصی ثبت نشد', db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c, entryCountBefore);
  assertIntegrity(db, 'بازگشت تراکنش');

  section('حذف فاکتور و برگشت کامل انبار/حسابداری');
  const tempSale = sales.create(db, {
    date: D3, customer_id: cust.id, items: [{ product_id: p2.id, qty: 2, unit_price: 500000 }],
    payments: [{ method: 'cash', amount: 1100000 }]
  });
  const stockBeforeDel = products.get(db, p2.id).stock_qty;
  const cashBeforeDel = bal(db, C.ACC.CASH);
  sales.remove(db, tempSale.id);
  eq('موجودی پس از حذف فاکتور', products.get(db, p2.id).stock_qty, stockBeforeDel + 2);
  eq('صندوق پس از حذف فاکتور', bal(db, C.ACC.CASH), cashBeforeDel - 1100000);
  eq('فاکتور حذف شد', sales.get(db, tempSale.id), null);
  assertIntegrity(db, 'حذف فاکتور');

  section('T/U/V) مالیات، بهای تمام‌شده و سود و زیان');
  const vat = reports.vatReport(db, {});
  eq('مالیات خروجی = مالیات فروش منهای برگشت', vat.output_vat, vat.sales.vat - vat.sales_returns.vat);
  ok('گزارش مالیات با دفتر هماهنگ است', vat.net_vat === vat.ledger_balance, 'گزارش ' + vat.net_vat + ' / دفتر ' + vat.ledger_balance);

  const pl = reports.profitAndLoss(db, {});
  eq('سود ناخالص = فروش خالص - بهای تمام‌شده', pl.gross_profit, pl.net_sales - pl.cogs);
  eq('سود خالص = سود ناخالص - هزینه + درآمد', pl.net_profit, pl.gross_profit - pl.operating_expenses + pl.other_income);

  const bs = reports.balanceSheet(db, {});
  ok('ترازنامه تراز است', bs.balanced, 'دارایی ' + bs.total_assets + ' / بدهی+سرمایه ' + (bs.total_liabilities + bs.total_equity + bs.retained_earnings));

  section('داشبورد');
  const dash = reports.dashboard(db, { from: D, to: D3, today: D3 });
  ok('داشبورد مانده‌ها را برمی‌گرداند', typeof dash.cash === 'number' && typeof dash.inventory_value === 'number');
  ok('داشبورد چک‌ها را نشان می‌دهد', dash.checks && typeof dash.checks.open_received.s === 'number');
  ok('روند فروش تولید شد', Array.isArray(dash.trend) && dash.trend.length > 0);

  section('W) خروجی اکسل');
  const xlsxPath = path.join(TMP, 'export.xlsx');
  const xr = await excel.exportAll(db, xlsxPath, {});
  ok('فایل اکسل ساخته شد', fs.existsSync(xlsxPath) && fs.statSync(xlsxPath).size > 5000,
    fs.existsSync(xlsxPath) ? fs.statSync(xlsxPath).size + ' بایت' : 'ساخته نشد');
  ok('تعداد شیت‌های اکسل', xr.sheets >= 20, 'تعداد: ' + xr.sheets);

  section('X) پشتیبان‌گیری');
  const backupDir = path.join(TMP, 'backups');
  const bk = backup.create(db, backupDir, 'test');
  ok('فایل پشتیبان ساخته شد', fs.existsSync(bk.file));
  const ver = backup.verify(bk.file);
  ok('فایل پشتیبان سالم است', ver.ok, ver.error || '');
  ok('فهرست پشتیبان‌ها', backup.list(backupDir).length >= 1);

  section('Y) بازیابی');
  const salesCountBefore = db.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c;
  const trialBefore = reports.integrity(db).total_debit;
  // یک فاکتور جدید بعد از پشتیبان ثبت می‌کنیم تا اثر بازیابی مشخص شود
  sales.create(db, { date: D3, customer_id: cust.id, items: [{ product_id: p2.id, qty: 1, unit_price: 500000 }], payments: [{ method: 'cash', amount: 550000 }] });
  eq('فاکتور بعد از پشتیبان ثبت شد', db.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c, salesCountBefore + 1);
  const res = backup.restore(bk.file, { safetyDir: backupDir });
  ok('بازیابی انجام شد', res.ok);
  const db2 = connection.get();
  eq('وضعیت پس از بازیابی به لحظه پشتیبان برگشت', db2.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c, salesCountBefore);
  eq('تراز پس از بازیابی', reports.integrity(db2).total_debit, trialBefore);
  assertIntegrity(db2, 'بازیابی');

  /* ------------------------------------------------------------------ */
  section('۳۸) آزمون صحت حسابداری (سناریوی مرجع)');
  connection.close();
  const sanityFile = path.join(TMP, 'sanity.db');
  const sdb = connection.open(sanityFile);
  settings.setMany(sdb, { vat_rate: '10' });
  cashbook.createCapital(sdb, { date: D, amount: 100000000, method: 'cash', description: 'سرمایه اولیه' });
  const sp = products.create(sdb, { name: 'کالا', sale_price: 3000000, purchase_price: 2000000 });
  const ssup = parties.create(sdb, 'supplier', { name: 'تأمین‌کننده' });
  const scust = parties.create(sdb, 'customer', { name: 'مشتری' });
  purchases.create(sdb, { date: D, supplier_id: ssup.id, items: [{ product_id: sp.id, qty: 10, unit_price: 2000000 }], payments: [{ method: 'cash', amount: 20000000 }] });
  sales.create(sdb, { date: D, customer_id: scust.id, items: [{ product_id: sp.id, qty: 4, unit_price: 3000000 }], payments: [{ method: 'cash', amount: 13200000 }] });
  const rc = sdb.prepare('SELECT id FROM expense_categories WHERE name=?').get('اجاره');
  cashbook.createExpense(sdb, { date: D, category_id: rc.id, amount: 5000000, method: 'cash', description: 'اجاره' });

  const spl = reports.profitAndLoss(sdb, {});
  eq('صندوق نهایی', journal.accountBalance(sdb, C.ACC.CASH, {}), 88200000);
  eq('موجودی کالا (تعداد)', products.get(sdb, sp.id).stock_qty, 6);
  eq('ارزش موجودی کالا', journal.accountBalance(sdb, C.ACC.INVENTORY, {}), 12000000);
  eq('فروش خالص', spl.net_sales, 12000000);
  eq('مالیات پرداختنی', journal.accountBalance(sdb, C.ACC.VAT_PAYABLE, {}), 1200000);
  eq('بهای تمام‌شده', spl.cogs, 8000000);
  eq('سود ناخالص', spl.gross_profit, 4000000);
  eq('هزینه', spl.operating_expenses, 5000000);
  eq('سود خالص', spl.net_profit, -1000000);
  const sbs = reports.balanceSheet(sdb, {});
  ok('ترازنامه سناریوی مرجع تراز است', sbs.balanced,
    'دارایی ' + sbs.total_assets + ' / بدهی ' + sbs.total_liabilities + ' / سرمایه ' + sbs.total_equity + ' / سود انباشته ' + sbs.retained_earnings);
  assertIntegrity(sdb, 'سناریوی مرجع');

  connection.close();

  /* ------------------------------------------------------------------ */
  console.log('\n' + '='.repeat(60));
  console.log('نتیجه: ' + passed + ' موفق، ' + failed + ' ناموفق');
  if (failed) {
    console.log('\nموارد ناموفق:');
    for (const f of failures) console.log('  - ' + f);
  }
  console.log('='.repeat(60));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* بی‌اهمیت */ }
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('\nخطای اجرای آزمون:');
  console.error(e);
  process.exit(1);
});
