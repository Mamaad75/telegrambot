'use strict';
/** ثبت همه عملیات قابل فراخوانی از رابط کاربری */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');

const connection = require('./db/connection');
const logger = require('./util/logger');
const { AppError } = require('./util/errors');
const { CHANNELS } = require('../shared/channels');

const settings = require('./services/settings');
const products = require('./services/products');
const parties = require('./services/parties');
const invoices = require('./services/invoices');
const payments = require('./services/payments');
const checks = require('./services/checks');
const cashbook = require('./services/cashbook');
const inventory = require('./services/inventory');
const accounting = require('./services/accounting');
const reports = require('./services/reports');
const excel = require('./services/excel');
const backup = require('./services/backup');
const demo = require('./services/demo');
const { todayIso } = require('./util/jalali');

const db = () => connection.get();

function buildHandlers(ctx) {
  const H = {};

  // ── برنامه و تنظیمات ──────────────────────────────────────────
  H['app.info'] = () => ({
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    dbFile: connection.file(),
    dbVersion: db().pragma('user_version', { simple: true }),
    userData: ctx.paths.userData,
    backupDir: settings.get(db(), 'backup_dir', '') || ctx.paths.backups,
    logFile: logger.file(),
    demoMode: ctx.isDemo(),
    today: todayIso(),
    settings: settings.getAll(db()),
    accounts: db().prepare('SELECT * FROM accounts ORDER BY sort_order, code').all(),
  });
  H['app.paths'] = () => ({ ...ctx.paths, dbFile: connection.file() });
  H['app.settings.get'] = () => settings.getAll(db());
  H['app.settings.set'] = (p) => settings.set(db(), p || {});
  H['app.setup.complete'] = (p) => {
    const conn = db();
    settings.set(conn, {
      shop_name: p.shop_name || 'فروشگاه من',
      shop_phone: p.shop_phone || '',
      shop_address: p.shop_address || '',
      vat_rate: String(p.vat_rate === undefined ? 10 : p.vat_rate),
      currency: p.currency || 'تومان',
      setup_done: '1',
    });
    if (p.opening && (p.opening['101'] || p.opening['102'] || p.opening['103'])) {
      cashbook.openingBalances(conn, { ...p.opening, date: p.date || todayIso() });
    }
    return settings.getAll(conn);
  };
  H['app.log'] = (p) => { logger.error('خطای رابط کاربری: ' + (p && p.message), p && p.detail); return true; };
  H['app.openPath'] = (p) => shell.openPath(p && p.path ? p.path : ctx.paths.userData);

  // ── کالا ──────────────────────────────────────────────────────
  H['products.list'] = (p) => products.list(db(), p || {});
  H['products.get'] = (p) => products.get(db(), p.id);
  H['products.search'] = (p) => products.search(db(), p.q, p.limit);
  H['products.byBarcode'] = (p) => products.byBarcode(db(), p.code);
  H['products.create'] = (p) => connection.tx(() => products.create(db(), p));
  H['products.update'] = (p) => connection.tx(() => products.update(db(), p.id, p));
  H['products.remove'] = (p) => connection.tx(() => products.remove(db(), p.id));
  H['products.adjust'] = (p) => connection.tx(() => products.adjustStock(db(), p));
  H['products.categories'] = (p) => products.categories(db(), (p && p.kind) || 'product');
  H['products.addCategory'] = (p) => connection.tx(() => products.addCategory(db(), p.kind || 'product', p.name));
  H['inventory.valuation'] = () => ({ rows: inventory.valuationRows(db()), totals: inventory.totalValuation(db()) });
  H['inventory.lowStock'] = () => inventory.lowStock(db());
  H['inventory.movements'] = (p) => inventory.movements(db(), p || {});

  // ── طرف حساب ─────────────────────────────────────────────────
  H['parties.list'] = (p) => parties.list(db(), p || {});
  H['parties.get'] = (p) => parties.get(db(), p.id);
  H['parties.search'] = (p) => parties.search(db(), p.type, p.q, p.limit);
  H['parties.create'] = (p) => connection.tx(() => parties.create(db(), p));
  H['parties.update'] = (p) => connection.tx(() => parties.update(db(), p.id, p));
  H['parties.remove'] = (p) => connection.tx(() => parties.remove(db(), p.id));
  H['parties.profile'] = (p) => parties.profile(db(), p.id, p || {});
  H['parties.statement'] = (p) => accounting.partyStatement(db(), p.id, p || {});
  H['parties.opening'] = (p) => connection.tx(() => parties.setOpeningBalance(db(), p.id, p.amount, p.date));

  // ── فاکتور ───────────────────────────────────────────────────
  H['invoices.create'] = (p) => invoices.create(db(), p);
  H['invoices.get'] = (p) => invoices.getFull(db(), p.id);
  H['invoices.list'] = (p) => invoices.list(db(), p || {});
  H['invoices.void'] = (p) => invoices.voidInvoice(db(), p.id, p.reason);
  H['invoices.returnable'] = (p) => invoices.returnableItems(db(), p.id);
  H['invoices.nextNo'] = (p) => {
    const type = p && p.type ? p.type : 'sale';
    const prefixKey = {
      sale: 'sale_prefix', purchase: 'purchase_prefix',
      sale_return: 'sale_return_prefix', purchase_return: 'purchase_return_prefix',
    }[type];
    const row = db().prepare('SELECT value FROM counters WHERE name=?').get(type);
    return settings.get(db(), prefixKey, '') + String((row ? row.value : 0) + 1).padStart(5, '0');
  };

  // ── دریافت و پرداخت ──────────────────────────────────────────
  H['payments.create'] = (p) => payments.create(db(), p);
  H['payments.list'] = (p) => payments.list(db(), p || {});
  H['payments.get'] = (p) => payments.get(db(), p.id);
  H['payments.void'] = (p) => payments.voidPayment(db(), p.id);

  // ── چک ───────────────────────────────────────────────────────
  H['checks.list'] = (p) => checks.list(db(), p || {});
  H['checks.get'] = (p) => checks.get(db(), p.id);
  H['checks.create'] = (p) => checks.create(db(), p);
  H['checks.changeStatus'] = (p) => checks.changeStatus(db(), p.id, p.status, p);
  H['checks.reminders'] = (p) => checks.reminders(db(), (p && p.days) || 7);

  // ── صندوق ────────────────────────────────────────────────────
  H['cashbook.expense'] = (p) => cashbook.addExpense(db(), p);
  H['cashbook.income'] = (p) => cashbook.addIncome(db(), p);
  H['cashbook.transfer'] = (p) => cashbook.addTransfer(db(), p);
  H['cashbook.equity'] = (p) => cashbook.ownerEquity(db(), p);
  H['cashbook.opening'] = (p) => cashbook.openingBalances(db(), p);
  H['cashbook.expenses'] = (p) => cashbook.listExpenses(db(), p || {});
  H['cashbook.incomes'] = (p) => cashbook.listIncomes(db(), p || {});
  H['cashbook.transfers'] = (p) => cashbook.listTransfers(db(), p || {});
  H['cashbook.void'] = (p) => {
    const table = { expense: 'expenses', income: 'incomes', transfer: 'transfers' }[p.kind];
    if (!table) throw new AppError('نوع سند نامعتبر است.', 'BAD_DOC');
    return cashbook.voidDoc(db(), table, p.id);
  };

  // ── گزارش‌ها ─────────────────────────────────────────────────
  H['reports.dashboard'] = (p) => reports.dashboard(db(), p || {});
  H['reports.sales'] = (p) => reports.salesReport(db(), p || {});
  H['reports.journal'] = (p) => reports.journal(db(), p || {});
  H['reports.ledger'] = (p) => accounting.ledger(db(), p.code, p || {});
  H['reports.trialBalance'] = (p) => accounting.trialBalance(db(), p || {});
  H['reports.profitLoss'] = (p) => accounting.profitLoss(db(), p || {});
  H['reports.vat'] = (p) => accounting.vatReport(db(), p || {});
  H['reports.treasury'] = (p) => reports.treasuryReport(db(), p.code, p || {});
  H['reports.daily'] = (p) => reports.dailySummary(db(), p && p.date);
  H['reports.partyBalances'] = (p) => reports.partyBalances(db(), (p && p.type) || 'customer');
  H['reports.overdue'] = (p) => reports.overdueReceivables(db(), (p && p.days) || 30);
  H['reports.accounts'] = () => db().prepare('SELECT * FROM accounts ORDER BY sort_order, code').all();

  // ── خروجی اکسل ───────────────────────────────────────────────
  H['excel.export'] = async (p) => {
    const opts = p || {};
    const shopName = settings.get(db(), 'shop_name', 'فروشگاه');
    const defaultName = `گزارش-${shopName}-${todayIso()}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
    const target = await dialog.showSaveDialog(ctx.mainWindow(), {
      title: 'ذخیره خروجی اکسل',
      defaultPath: path.join(ctx.paths.documents, defaultName),
      filters: [{ name: 'فایل اکسل', extensions: ['xlsx'] }],
    });
    if (target.canceled || !target.filePath) return { canceled: true };
    const buf = excel.build(db(), opts);
    fs.writeFileSync(target.filePath, buf);
    return { canceled: false, file: target.filePath, size: buf.length };
  };

  // ── چاپ ──────────────────────────────────────────────────────
  H['print.document'] = (p) => ctx.printer.open(p || {});

  // ── پشتیبان‌گیری ─────────────────────────────────────────────
  H['backup.create'] = (p) => {
    const dir = (p && p.dir) || settings.get(db(), 'backup_dir', '') || ctx.paths.backups;
    backup.ensureDir(dir);
    const res = backup.createBackup(db(), dir, p && p.label);
    backup.pruneBackups(dir, 60);
    return res;
  };
  H['backup.list'] = (p) => {
    const dir = (p && p.dir) || settings.get(db(), 'backup_dir', '') || ctx.paths.backups;
    return { dir, files: backup.listBackups(dir) };
  };
  H['backup.inspect'] = (p) => backup.inspectBackupFile(p.file);
  H['backup.restore'] = (p) => {
    const res = backup.restoreBackup(p.file, { safetyDir: ctx.paths.backups });
    ctx.notifyReload();
    return res;
  };
  H['backup.integrity'] = () => backup.integrityCheck(db());
  H['backup.chooseDir'] = async () => {
    const res = await dialog.showOpenDialog(ctx.mainWindow(), {
      title: 'انتخاب پوشه پشتیبان', properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    settings.set(db(), { backup_dir: res.filePaths[0] });
    return { canceled: false, dir: res.filePaths[0] };
  };
  H['backup.chooseFile'] = async () => {
    const dir = settings.get(db(), 'backup_dir', '') || ctx.paths.backups;
    const res = await dialog.showOpenDialog(ctx.mainWindow(), {
      title: 'انتخاب فایل پشتیبان', defaultPath: dir,
      filters: [{ name: 'پشتیبان پایگاه داده', extensions: ['sqlite', 'db'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, file: res.filePaths[0], info: backup.inspectBackupFile(res.filePaths[0]) };
  };
  H['backup.openDir'] = (p) => {
    const dir = (p && p.dir) || settings.get(db(), 'backup_dir', '') || ctx.paths.backups;
    backup.ensureDir(dir);
    return shell.openPath(dir);
  };

  // ── انتقال اطلاعات نسخه قبلی ─────────────────────────────────
  H['legacy.find'] = () => backup.findLegacyDatabases(ctx.legacyDirs());
  H['legacy.import'] = (p) => backup.importLegacy(p.file, p || {});
  H['legacy.documents'] = () => db().prepare('SELECT * FROM legacy_documents ORDER BY date DESC, id DESC LIMIT 1000').all();

  // ── حالت نمایشی ──────────────────────────────────────────────
  H['demo.status'] = () => ({ active: ctx.isDemo(), file: ctx.paths.demoDb });
  H['demo.enable'] = () => { ctx.switchDb(true); return { active: true }; };
  H['demo.disable'] = () => { ctx.switchDb(false); return { active: false }; };

  return H;
}

function register(ctx) {
  const handlers = buildHandlers(ctx);
  const missing = CHANNELS.filter((c) => !handlers[c]);
  if (missing.length) logger.warn('کانال‌های بدون پیاده‌سازی: ' + missing.join(', '));

  for (const channel of CHANNELS) {
    const fn = handlers[channel];
    if (!fn) continue;
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const data = await fn(payload || {});
        return { ok: true, data };
      } catch (err) {
        const userFacing = err instanceof AppError || err.userFacing;
        logger.error(`خطا در ${channel}: ${err.message}`, err);
        return {
          ok: false,
          error: {
            message: userFacing ? err.message : 'خطای غیرمنتظره در انجام عملیات. جزئیات در فایل گزارش خطا ثبت شد.',
            code: err.code || 'INTERNAL',
            technical: String(err.message || ''),
          },
        };
      }
    });
  }
  return handlers;
}

module.exports = { register, buildHandlers };
