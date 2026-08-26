'use strict';
/** سناریوی صحت‌سنجی حسابداری (بند ۳۸ درخواست) و گزارش‌های مالی */
const t = require('../helper');
const accounting = require('../../src/main/services/accounting');
const products = require('../../src/main/services/products');
const parties = require('../../src/main/services/parties');
const invoices = require('../../src/main/services/invoices');
const cashbook = require('../../src/main/services/cashbook');
const reports = require('../../src/main/services/reports');
const inventory = require('../../src/main/services/inventory');

module.exports = function run() {
  t.suite('سناریوی صحت‌سنجی: صندوق ۱۰۰٬۰۰۰٬۰۰۰ / خرید ۱۰×۲٬۰۰۰٬۰۰۰ / فروش ۴×۳٬۰۰۰٬۰۰۰ / هزینه ۵٬۰۰۰٬۰۰۰');
  const { db } = t.freshDb('sanity');
  const bal = (code) => accounting.accountBalance(db, code).balance;

  // ۱) سرمایه اولیه
  cashbook.openingBalances(db, { date: '2026-01-01', 101: 100000000 });
  t.eq(bal('101'), 100000000, 'موجودی اولیه صندوق ۱۰۰٬۰۰۰٬۰۰۰');
  t.eq(bal('301'), 100000000, 'حساب سرمایه ۱۰۰٬۰۰۰٬۰۰۰');

  // ۲) خرید ۱۰ عدد × ۲٬۰۰۰٬۰۰۰ نقدی
  const p = products.create(db, { name: 'کالای سناریو', code: 'S1', buy_price: 2000000, sell_price: 3000000 });
  const supplier = parties.create(db, { type: 'supplier', name: 'تأمین‌کننده سناریو' });
  invoices.create(db, {
    type: 'purchase', date: '2026-01-05', party_id: supplier.id,
    items: [{ product_id: p.id, qty: 10, unit_price: 2000000 }],
    payments: [{ method: 'cash', amount: 20000000 }],
  });
  t.eq(bal('101'), 80000000, 'پس از خرید، صندوق = ۸۰٬۰۰۰٬۰۰۰');
  t.eq(bal('106'), 20000000, 'موجودی کالا = ۲۰٬۰۰۰٬۰۰۰');
  t.eq(products.get(db, p.id).stock, 10, 'تعداد موجودی = ۱۰');

  // ۳) فروش ۴ عدد × ۳٬۰۰۰٬۰۰۰ با ۱۰٪ ارزش افزوده
  const customer = parties.create(db, { type: 'customer', name: 'مشتری سناریو' });
  const sale = invoices.create(db, {
    type: 'sale', date: '2026-01-10', party_id: customer.id,
    items: [{ product_id: p.id, qty: 4, unit_price: 3000000 }],
    payments: [{ method: 'cash', amount: 13200000 }],
  });
  t.eq(sale.invoice.taxable, 12000000, 'مبلغ مشمول فروش = ۱۲٬۰۰۰٬۰۰۰');
  t.eq(sale.invoice.vat, 1200000, 'ارزش افزوده = ۱٬۲۰۰٬۰۰۰');
  t.eq(sale.invoice.total, 13200000, 'مبلغ کل فاکتور = ۱۳٬۲۰۰٬۰۰۰');
  t.eq(bal('101'), 93200000, 'صندوق پس از فروش = ۹۳٬۲۰۰٬۰۰۰');
  t.eq(bal('401'), 12000000, 'فروش = ۱۲٬۰۰۰٬۰۰۰');
  t.eq(bal('202'), 1200000, 'ارزش افزوده پرداختنی = ۱٬۲۰۰٬۰۰۰');
  t.eq(bal('503'), 8000000, 'بهای تمام‌شده = ۸٬۰۰۰٬۰۰۰ (۴ × ۲٬۰۰۰٬۰۰۰)');
  t.eq(bal('106'), 12000000, 'موجودی کالا = ۱۲٬۰۰۰٬۰۰۰ (۶ عدد)');
  t.eq(products.get(db, p.id).stock, 6, 'موجودی باقی‌مانده = ۶ عدد');

  // ۴) هزینه اجاره ۵٬۰۰۰٬۰۰۰
  const rent = db.prepare("SELECT id FROM categories WHERE kind='expense' AND name='اجاره'").get();
  cashbook.addExpense(db, { date: '2026-01-15', category_id: rent.id, amount: 5000000, method: 'cash', description: 'اجاره' });
  t.eq(bal('101'), 88200000, 'صندوق پس از هزینه = ۸۸٬۲۰۰٬۰۰۰');
  t.eq(bal('502-01'), 5000000, 'هزینه اجاره = ۵٬۰۰۰٬۰۰۰');

  // ۵) صورت سود و زیان
  const pl = accounting.profitLoss(db, {});
  t.eq(pl.revenue, 12000000, 'درآمد فروش = ۱۲٬۰۰۰٬۰۰۰');
  t.eq(pl.discounts, 0, 'تخفیف = ۰');
  t.eq(pl.returns, 0, 'برگشت از فروش = ۰');
  t.eq(pl.netSales, 12000000, 'فروش خالص = ۱۲٬۰۰۰٬۰۰۰');
  t.eq(pl.cogs, 8000000, 'بهای تمام‌شده = ۸٬۰۰۰٬۰۰۰');
  t.eq(pl.grossProfit, 4000000, 'سود ناخالص = ۴٬۰۰۰٬۰۰۰');
  t.eq(pl.operatingExpenses, 5000000, 'هزینه‌های عملیاتی = ۵٬۰۰۰٬۰۰۰');
  t.eq(pl.netProfit, -1000000, 'سود خالص = زیان ۱٬۰۰۰٬۰۰۰');

  // ۶) تراز و توازن نهایی
  const tb = accounting.trialBalance(db, {});
  t.ok(tb.balanced, 'تراز آزمایشی متوازن است');
  const assets = bal('101') + bal('102') + bal('103') + bal('104') + bal('105') + bal('106');
  const liabilities = bal('201') + bal('202') + bal('203');
  const equity = bal('301') - bal('302') + pl.netProfit;
  t.eq(assets, liabilities + equity, 'معادله حسابداری: دارایی = بدهی + سرمایه', `${assets} = ${liabilities} + ${equity}`);
  t.assertLedgerBalanced(db, 'سناریوی کامل');
  t.assertInventoryMatches(db, 'سناریوی کامل');

  // ۷) گزارش ارزش افزوده
  const vat = accounting.vatReport(db, {});
  t.eq(vat.outputVat, 1200000, 'ارزش افزوده فروش در گزارش');
  t.eq(vat.payable, 1200000, 'مالیات قابل پرداخت');

  // ۸) داشبورد
  t.suite('گزارش‌ها و داشبورد');
  const dash = reports.dashboard(db, { from: '2026-01-01', to: '2026-01-31' });
  t.eq(dash.sales.total, 13200000, 'داشبورد: فروش دوره');
  t.eq(dash.purchases.total, 20000000, 'داشبورد: خرید دوره');
  t.eq(dash.treasury.cash, 88200000, 'داشبورد: مانده صندوق');
  t.eq(dash.inventory.value, 12000000, 'داشبورد: ارزش موجودی انبار');
  t.eq(dash.profit.gross, 4000000, 'داشبورد: سود ناخالص');
  t.eq(dash.profit.net, -1000000, 'داشبورد: سود خالص');
  t.ok(dash.series.length === 31, 'داشبورد: نمودار روزانه ۳۱ روز دارد', 'روزها: ' + dash.series.length);

  const salesRep = reports.salesReport(db, { type: 'sale' });
  t.eq(salesRep.summary.total, 13200000, 'گزارش فروش: جمع کل');
  t.eq(salesRep.summary.profit, 4000000, 'گزارش فروش: سود ناخالص');
  t.eq(salesRep.byProduct.length, 1, 'گزارش فروش به تفکیک کالا');

  const daily = reports.dailySummary(db, '2026-01-10');
  t.eq(daily.sales.total, 13200000, 'خلاصه روزانه: فروش روز');

  const ledger = accounting.ledger(db, '101', {});
  t.eq(ledger.closing, 88200000, 'دفتر معین صندوق: مانده پایانی');

  const statement = accounting.partyStatement(db, customer.id, {});
  t.eq(statement.closing, 0, 'صورت‌حساب مشتری نقدی: مانده صفر');

  const balances = reports.partyBalances(db, 'supplier');
  t.eq(balances.total, 0, 'مانده تأمین‌کنندگان صفر است (خرید نقدی بود)');

  // ۹) میانگین موزون پس از خرید دوم با قیمت متفاوت
  t.suite('بهای تمام‌شده با میانگین موزون');
  invoices.create(db, {
    type: 'purchase', date: '2026-01-20', party_id: supplier.id,
    items: [{ product_id: p.id, qty: 4, unit_price: 3000000 }],
    payments: [{ method: 'cash', amount: 12000000 }],
  });
  const prod = products.get(db, p.id);
  t.eq(prod.stock, 10, 'موجودی ۱۰ عدد (۶ + ۴)');
  t.eq(prod.stock_value, 24000000, 'ارزش موجودی = ۱۲٬۰۰۰٬۰۰۰ + ۱۲٬۰۰۰٬۰۰۰');
  t.eq(Math.round(inventory.avgCost(prod)), 2400000, 'میانگین موزون = ۲٬۴۰۰٬۰۰۰');
  const sale2 = invoices.create(db, {
    type: 'sale', date: '2026-01-21', party_id: customer.id, vat_rate: 0,
    items: [{ product_id: p.id, qty: 5, unit_price: 3500000 }],
    payments: [{ method: 'cash', amount: 17500000 }],
  });
  t.eq(sale2.invoice.cogs, 12000000, 'بهای تمام‌شده فروش دوم = ۵ × ۲٬۴۰۰٬۰۰۰');
  t.eq(products.get(db, p.id).stock_value, 12000000, 'ارزش موجودی باقی‌مانده = ۱۲٬۰۰۰٬۰۰۰');
  t.assertInventoryMatches(db, 'میانگین موزون');
  t.assertLedgerBalanced(db, 'میانگین موزون');
};
