'use strict';
/** فهرست کانال‌های مجاز IPC — هم در فرایند اصلی و هم در preload استفاده می‌شود. */
const CHANNELS = [
  // برنامه و تنظیمات
  'app.info', 'app.settings.get', 'app.settings.set', 'app.setup.complete', 'app.log',
  'app.openPath', 'app.paths',
  // کالا و انبار
  'products.list', 'products.get', 'products.search', 'products.byBarcode',
  'products.create', 'products.update', 'products.remove', 'products.adjust',
  'products.categories', 'products.addCategory',
  'inventory.valuation', 'inventory.lowStock', 'inventory.movements',
  // طرف حساب
  'parties.list', 'parties.get', 'parties.search', 'parties.create', 'parties.update',
  'parties.remove', 'parties.profile', 'parties.statement', 'parties.opening',
  // فاکتور
  'invoices.create', 'invoices.get', 'invoices.list', 'invoices.void', 'invoices.returnable',
  'invoices.nextNo',
  // دریافت و پرداخت
  'payments.create', 'payments.list', 'payments.get', 'payments.void',
  // چک
  'checks.list', 'checks.get', 'checks.create', 'checks.changeStatus', 'checks.reminders',
  // صندوق، هزینه، درآمد، انتقال
  'cashbook.expense', 'cashbook.income', 'cashbook.transfer', 'cashbook.equity',
  'cashbook.opening', 'cashbook.expenses', 'cashbook.incomes', 'cashbook.transfers',
  'cashbook.void',
  // گزارش‌ها
  'reports.dashboard', 'reports.sales', 'reports.journal', 'reports.ledger',
  'reports.trialBalance', 'reports.profitLoss', 'reports.vat', 'reports.treasury',
  'reports.daily', 'reports.partyBalances', 'reports.accounts', 'reports.overdue',
  // خروجی اکسل و چاپ
  'excel.export', 'print.document',
  // پشتیبان‌گیری
  'backup.create', 'backup.list', 'backup.inspect', 'backup.restore', 'backup.integrity',
  'backup.chooseDir', 'backup.chooseFile', 'backup.openDir',
  'legacy.find', 'legacy.import', 'legacy.documents',
  // حالت نمایشی
  'demo.status', 'demo.enable', 'demo.disable',
];

module.exports = { CHANNELS };
