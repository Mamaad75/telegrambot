'use strict';
/*
 * لایه ارتباط امن بین رابط کاربری و پردازش اصلی.
 * رابط کاربری هیچ دسترسی مستقیمی به Node یا SQLite ندارد؛ فقط می‌تواند
 * کانال‌های ثبت‌شده در این فایل را صدا بزند.
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');

const connection = require('../db/connection.js');
const settings = require('../services/settings.js');
const products = require('../services/products.js');
const parties = require('../services/parties.js');
const bankAccounts = require('../services/bankAccounts.js');
const inventory = require('../services/inventory.js');
const sales = require('../services/sales.js');
const purchases = require('../services/purchases.js');
const returns = require('../services/returns.js');
const payments = require('../services/payments.js');
const checks = require('../services/checks.js');
const cashbook = require('../services/cashbook.js');
const reports = require('../services/reports.js');
const journal = require('../services/journal.js');
const backup = require('../services/backup.js');
const excel = require('../services/excel.js');
const importer = require('../services/importer.js');
const templates = require('../print/templates.js');
const printing = require('./printing.js');
const paths = require('./paths.js');
const logger = require('./logger.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

function db() { return connection.get(); }

function shopSettings() { return settings.all(db()); }

/* ------------------------------ فهرست کانال‌ها ------------------------------ */
const handlers = {
  /* --------- عمومی --------- */
  'app.info': function () {
    const p = paths.get();
    return {
      version: app.getVersion(),
      name: app.getName(),
      db_file: p.dbFile,
      backup_dir: settings.get(db(), 'backup_dir') || p.backupDir,
      export_dir: p.exportDir,
      log_file: p.logFile,
      portable: p.portable,
      today: Jalali.todayIso(),
      today_jalali: Jalali.isoToJalali(Jalali.todayIso()),
      today_long: Jalali.longDate(Jalali.todayIso()),
      constants: {
        pay_methods: C.PAY_METHODS,
        pay_method_label: C.PAY_METHOD_LABEL,
        check_status: C.CHECK_STATUS,
        check_direction: C.CHECK_DIRECTION,
        move_types: C.MOVE_TYPES,
        accounts: C.ACC
      }
    };
  },
  'app.integrity': function () {
    return { accounting: reports.integrity(db()), database: connection.integrityCheck(db()) };
  },
  'app.openPath': function (p) { shell.openPath(p.path); return true; },
  'app.showItem': function (p) { shell.showItemInFolder(p.path); return true; },

  /* --------- تنظیمات --------- */
  'settings.all': function () { return settings.all(db()); },
  'settings.save': function (p) { return settings.setMany(db(), p.values || {}); },
  'settings.pickLogo': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: 'انتخاب لوگوی فروشگاه',
      filters: [{ name: 'تصویر', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    const buf = fs.readFileSync(file);
    if (buf.length > 1024 * 1024) throw new Error('حجم تصویر لوگو نباید بیشتر از ۱ مگابایت باشد.');
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : (ext === 'gif' ? 'image/gif' : (ext === 'bmp' ? 'image/bmp' : 'image/jpeg'));
    const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
    settings.set(db(), 'shop_logo', dataUrl);
    return dataUrl;
  },

  /* --------- حساب‌های بانکی و کارتخوان --------- */
  'bank.list': function (p) { return bankAccounts.list(db(), p || {}); },
  'bank.get': function (p) { return bankAccounts.get(db(), p.id); },
  'bank.create': function (p) { return bankAccounts.create(db(), p.data); },
  'bank.update': function (p) { return bankAccounts.update(db(), p.id, p.data); },
  'bank.remove': function (p) { return bankAccounts.remove(db(), p.id); },
  'bank.deactivate': function (p) { return bankAccounts.deactivate(db(), p.id); },
  'bank.statement': function (p) { return bankAccounts.statement(db(), p.id, p); },
  'bank.balances': function (p) { return bankAccounts.balances(db(), p ? p.to : null); },

  /* --------- مشتری و تأمین‌کننده --------- */
  'party.list': function (p) { return parties.list(db(), p.type, p); },
  'party.get': function (p) { return parties.get(db(), p.type, p.id); },
  'party.create': function (p) { return parties.create(db(), p.type, p.data); },
  'party.update': function (p) { return parties.update(db(), p.type, p.id, p.data); },
  'party.remove': function (p) { return parties.remove(db(), p.type, p.id); },
  'party.deactivate': function (p) { return parties.deactivate(db(), p.type, p.id); },
  'party.statement': function (p) { return parties.statement(db(), p.type, p.id, p); },
  'party.summary': function (p) { return parties.summary(db(), p.type, p.id, p); },
  'party.balances': function (p) { return parties.balances(db(), p.type, p); },

  /* --------- کالا --------- */
  'products.list': function (p) { return products.list(db(), p || {}); },
  'products.count': function (p) { return products.count(db(), p || {}); },
  'products.get': function (p) { return products.get(db(), p.id); },
  'products.search': function (p) { return products.quickSearch(db(), p.term, p.limit); },
  'products.byBarcode': function (p) { return products.findByBarcode(db(), p.barcode); },
  'products.create': function (p) { return products.create(db(), p.data); },
  'products.update': function (p) { return products.update(db(), p.id, p.data); },
  'products.remove': function (p) { return products.remove(db(), p.id); },
  'products.deactivate': function (p) { return products.deactivate(db(), p.id); },
  'products.nextCode': function () { return products.nextCode(db()); },
  'products.categories': function () { return products.categories(db()); },
  'products.createCategory': function (p) { return products.createCategory(db(), p.name); },
  'products.updateCategory': function (p) { return products.updateCategory(db(), p.id, p.name); },
  'products.removeCategory': function (p) { return products.removeCategory(db(), p.id); },
  'products.units': function () { return products.units(db()); },

  /* --------- انبار --------- */
  'inventory.moves': function (p) { return inventory.moves(db(), p || {}); },
  'inventory.adjust': function (p) { return inventory.adjust(db(), p.data); },
  'inventory.valuation': function () { return inventory.valuation(db()); },
  'inventory.lowStock': function (p) { return inventory.lowStock(db(), p ? p.limit : 100); },
  'inventory.total': function () { return inventory.totalValue(db()); },

  /* --------- فاکتور فروش --------- */
  'sales.create': function (p) { return sales.create(db(), p.data); },
  'sales.update': function (p) { return sales.update(db(), p.id, p.data); },
  'sales.get': function (p) { return sales.get(db(), p.id); },
  'sales.byNumber': function (p) { return sales.getByNumber(db(), p.no); },
  'sales.list': function (p) { return sales.list(db(), p || {}); },
  'sales.count': function (p) { return sales.count(db(), p || {}); },
  'sales.remove': function (p) { return sales.remove(db(), p.id); },

  /* --------- فاکتور خرید --------- */
  'purchases.create': function (p) { return purchases.create(db(), p.data); },
  'purchases.update': function (p) { return purchases.update(db(), p.id, p.data); },
  'purchases.get': function (p) { return purchases.get(db(), p.id); },
  'purchases.byNumber': function (p) { return purchases.getByNumber(db(), p.no); },
  'purchases.list': function (p) { return purchases.list(db(), p || {}); },
  'purchases.remove': function (p) { return purchases.remove(db(), p.id); },

  /* --------- برگشتی‌ها --------- */
  'returns.createSales': function (p) { return returns.createSalesReturn(db(), p.data); },
  'returns.getSales': function (p) { return returns.getSalesReturn(db(), p.id); },
  'returns.listSales': function (p) { return returns.listSalesReturns(db(), p || {}); },
  'returns.removeSales': function (p) { return returns.removeSalesReturn(db(), p.id); },
  'returns.createPurchase': function (p) { return returns.createPurchaseReturn(db(), p.data); },
  'returns.getPurchase': function (p) { return returns.getPurchaseReturn(db(), p.id); },
  'returns.listPurchase': function (p) { return returns.listPurchaseReturns(db(), p || {}); },
  'returns.removePurchase': function (p) { return returns.removePurchaseReturn(db(), p.id); },

  /* --------- دریافت و پرداخت --------- */
  'payments.create': function (p) { return payments.create(db(), p.data); },
  'payments.get': function (p) { return payments.get(db(), p.id); },
  'payments.list': function (p) { return payments.list(db(), p || {}); },
  'payments.remove': function (p) { return payments.remove(db(), p.id); },
  'payments.breakdown': function (p) { return payments.methodBreakdown(db(), p || {}); },

  /* --------- چک --------- */
  'checks.list': function (p) { return checks.list(db(), p || {}); },
  'checks.get': function (p) { return checks.get(db(), p.id); },
  'checks.byCode': function (p) { return checks.getByCode(db(), p.code); },
  'checks.changeStatus': function (p) { return checks.changeStatus(db(), p.id, p.data); },
  'checks.revert': function (p) { return checks.revertLastEvent(db(), p.id); },
  'checks.update': function (p) { return checks.update(db(), p.id, p.data); },
  'checks.remove': function (p) { return checks.remove(db(), p.id); },
  'checks.summary': function () { return checks.summary(db()); },
  'checks.reminders': function (p) { return checks.reminders(db(), p ? p.days : null); },

  /* --------- هزینه، درآمد، انتقال، سرمایه --------- */
  'expenses.create': function (p) { return cashbook.createExpense(db(), p.data); },
  'expenses.list': function (p) { return cashbook.listExpenses(db(), p || {}); },
  'expenses.get': function (p) { return cashbook.getExpense(db(), p.id); },
  'expenses.remove': function (p) { return cashbook.removeExpense(db(), p.id); },
  'expenses.categories': function () { return cashbook.expenseCategories(db()); },
  'expenses.createCategory': function (p) { return cashbook.createExpenseCategory(db(), p.name); },
  'expenses.removeCategory': function (p) { return cashbook.removeExpenseCategory(db(), p.id); },
  'incomes.create': function (p) { return cashbook.createIncome(db(), p.data); },
  'incomes.list': function (p) { return cashbook.listIncomes(db(), p || {}); },
  'incomes.remove': function (p) { return cashbook.removeIncome(db(), p.id); },
  'incomes.categories': function () { return cashbook.incomeCategories(db()); },
  'incomes.createCategory': function (p) { return cashbook.createIncomeCategory(db(), p.name); },
  'transfers.create': function (p) { return cashbook.createTransfer(db(), p.data); },
  'transfers.list': function (p) { return cashbook.listTransfers(db(), p || {}); },
  'transfers.remove': function (p) { return cashbook.removeTransfer(db(), p.id); },
  'capital.create': function (p) { return cashbook.createCapital(db(), p.data); },
  'capital.list': function (p) { return cashbook.listCapital(db(), p || {}); },
  'capital.remove': function (p) { return cashbook.removeCapital(db(), p.id); },

  /* --------- گزارش‌ها --------- */
  'reports.dashboard': function (p) { return reports.dashboard(db(), p || {}); },
  'reports.pl': function (p) { return reports.profitAndLoss(db(), p || {}); },
  'reports.vat': function (p) { return reports.vatReport(db(), p || {}); },
  'reports.trend': function (p) { return reports.trend(db(), p || {}); },
  'reports.sales': function (p) { return reports.salesReport(db(), p || {}); },
  'reports.purchases': function (p) { return reports.purchasesReport(db(), p || {}); },
  'reports.topProducts': function (p) { return reports.topProducts(db(), p || {}); },
  'reports.daily': function (p) { return reports.dailySummary(db(), p || {}); },
  'reports.balanceSheet': function (p) { return reports.balanceSheet(db(), p || {}); },
  'reports.partyBalances': function (p) { return reports.partyBalances(db(), p.type, p); },

  /* --------- حسابداری --------- */
  'accounting.accounts': function () { return db().prepare('SELECT * FROM accounts ORDER BY sort_order').all(); },
  'accounting.journal': function (p) { return journal.journal(db(), p || {}); },
  'accounting.ledger': function (p) { return journal.ledger(db(), p.code, p || {}); },
  'accounting.trialBalance': function (p) { return journal.trialBalance(db(), p || {}); },
  'accounting.balance': function (p) { return journal.accountBalance(db(), p.code, p || {}); },

  /* --------- اکسل --------- */
  'excel.exportAll': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dir = paths.get().exportDir;
    const suggested = 'گزارش-کامل-' + Jalali.isoToJalali(Jalali.todayIso()).replace(/\//g, '-') + '.xlsx';
    const res = await dialog.showSaveDialog(win, {
      title: 'ذخیره خروجی اکسل',
      defaultPath: path.join(dir, suggested),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = await excel.exportAll(db(), res.filePath, p || {});
    return out;
  },
  'excel.exportTable': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
      title: 'ذخیره خروجی اکسل',
      defaultPath: path.join(paths.get().exportDir, (p.filename || 'report') + '.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    return await excel.exportTable(res.filePath, p.sheet || 'گزارش', p.columns, p.rows, p.totals);
  },

  /* --------- درون‌ریزی کالا از PDF / اکسل --------- */
  'import.pickFile': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: 'انتخاب فایل لیست کالا',
      filters: [
        { name: 'فایل‌های پشتیبانی‌شده', extensions: ['pdf', 'xlsx', 'xlsm', 'xls', 'csv'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls'] },
        { name: 'CSV', extensions: ['csv'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  },
  'import.builtins': function () {
    return importer.builtins();
  },
  'import.preview': async function (p) {
    const file = p.builtin ? importer.builtinPath(p.builtin) : p.file;
    return await importer.preview(db(), file, p.options || {});
  },
  'import.commit': function (p) {
    const r = importer.commit(db(), p.rows || [], p.options || {});
    db().prepare('INSERT INTO activity_log (action, ref_type, detail) VALUES (?,?,?)')
      .run('درون‌ریزی کالا', 'import',
        'ثبت ' + r.created + ' / به‌روزرسانی ' + r.updated + ' / رد ' + r.skipped);
    return r;
  },
  'import.template': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
      title: 'ذخیره فایل نمونه درون‌ریزی',
      defaultPath: path.join(paths.get().exportDir, 'نمونه-ورود-کالا.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    return await importer.template(res.filePath);
  },

  /* --------- پشتیبان‌گیری --------- */
  'backup.create': function (p) {
    const dir = (p && p.dir) || settings.get(db(), 'backup_dir') || paths.get().backupDir;
    const r = backup.create(db(), dir, p && p.tag);
    backup.prune(dir, parseInt(settings.get(db(), 'backup_keep', '30'), 10) || 30);
    return r;
  },
  'backup.list': function (p) {
    const dir = (p && p.dir) || settings.get(db(), 'backup_dir') || paths.get().backupDir;
    return { dir: dir, items: backup.list(dir) };
  },
  'backup.verify': function (p) { return backup.verify(p.file); },
  'backup.restore': function (p) {
    const r = backup.restore(p.file, { safetyDir: settings.get(db(), 'backup_dir') || paths.get().backupDir });
    return r;
  },
  'backup.remove': function (p) { return backup.remove(p.file); },
  'backup.chooseDir': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { title: 'انتخاب پوشه پشتیبان', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    settings.set(db(), 'backup_dir', res.filePaths[0]);
    return res.filePaths[0];
  },
  'backup.chooseFile': async function (p, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: 'انتخاب فایل پشتیبان',
      defaultPath: settings.get(db(), 'backup_dir') || paths.get().backupDir,
      filters: [{ name: 'پایگاه داده', extensions: ['db', 'sqlite', 'sqlite3'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  },

  /* --------- چاپ --------- */
  'print.invoice': function (p, event) {
    const type = p.type === 'purchase' ? 'purchase' : 'sale';
    const inv = type === 'sale' ? sales.get(db(), p.id) : purchases.get(db(), p.id);
    if (!inv) throw new Error('فاکتور یافت نشد.');
    const st = shopSettings();
    const thermal = (p.size || st.print_size) === 'thermal';
    const html = thermal
      ? templates.invoiceThermal({ settings: st, invoice: inv, type: type })
      : templates.invoiceA4({ settings: st, invoice: inv, type: type });
    printing.preview(html, {
      title: 'پیش‌نمایش ' + (type === 'sale' ? 'فاکتور فروش' : 'فاکتور خرید') + ' ' + inv.invoice_no,
      defaultName: inv.invoice_no,
      parent: BrowserWindow.fromWebContents(event.sender),
      thermal: thermal,
      width: thermal ? 420 : 900
    });
    return true;
  },
  'print.statement': function (p, event) {
    const st = parties.statement(db(), p.type, p.id, p);
    const html = templates.statement({ settings: shopSettings(), statement: st, from: p.from, to: p.to });
    printing.preview(html, {
      title: 'صورت‌حساب ' + st.party.name,
      defaultName: 'statement-' + st.party.id,
      parent: BrowserWindow.fromWebContents(event.sender)
    });
    return true;
  },
  'print.check': function (p, event) {
    const c = checks.get(db(), p.id);
    if (!c) throw new Error('چک یافت نشد.');
    const html = templates.checkSheet({ settings: shopSettings(), check: c });
    printing.preview(html, { title: 'چک ' + c.check_code, defaultName: c.check_code, parent: BrowserWindow.fromWebContents(event.sender) });
    return true;
  },
  'print.report': function (p, event) {
    const html = templates.genericReport({
      settings: shopSettings(), title: p.title, subtitle: p.subtitle,
      columns: p.columns, rows: p.rows, totals: p.totals
    });
    printing.preview(html, {
      title: p.title, defaultName: p.filename || 'report',
      landscape: !!p.landscape, parent: BrowserWindow.fromWebContents(event.sender)
    });
    return true;
  },
  'print.direct': function (p, event) {
    const type = p.type === 'purchase' ? 'purchase' : 'sale';
    const inv = type === 'sale' ? sales.get(db(), p.id) : purchases.get(db(), p.id);
    if (!inv) throw new Error('فاکتور یافت نشد.');
    const st = shopSettings();
    const thermal = (p.size || st.print_size) === 'thermal';
    const html = thermal
      ? templates.invoiceThermal({ settings: st, invoice: inv, type: type })
      : templates.invoiceA4({ settings: st, invoice: inv, type: type });
    return printing.printDirect(html, { silent: !!p.silent });
  }
};

/** ثبت همه کانال‌ها */
function register() {
  ipcMain.handle('api', async function (event, message) {
    const channel = message && message.channel;
    const payload = (message && message.payload) || {};
    const fn = Object.prototype.hasOwnProperty.call(handlers, channel) ? handlers[channel] : null;
    if (!fn) {
      logger.warn('کانال ناشناخته: ' + channel);
      return { ok: false, error: 'عملیات ناشناخته: ' + channel };
    }
    try {
      const data = await fn(payload, event);
      return { ok: true, data: data === undefined ? null : data };
    } catch (e) {
      logger.error('خطا در کانال ' + channel + ': ' + e.message, e);
      return { ok: false, error: e.message || 'خطای نامشخص در انجام عملیات.' };
    }
  });

  // کانال‌های پنجره چاپ
  ipcMain.handle('print-window:print', function (event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    return printing.printFromWindow(win);
  });
  ipcMain.handle('print-window:save-pdf', function (event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    return printing.savePdfFromWindow(win, paths.get().exportDir);
  });
  ipcMain.handle('print-window:close', function (event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
    return true;
  });
}

module.exports = { register: register, handlers: handlers };
