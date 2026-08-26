'use strict';
/**
 * پشتیبان‌گیری، بازیابی و بررسی سلامت پایگاه داده.
 * پشتیبان‌گیری با دستور VACUUM INTO انجام می‌شود که یک تصویر یکپارچه و فشرده
 * از پایگاه داده می‌سازد و در حین کار برنامه هم ایمن است.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { AppError } = require('../util/errors');
const connection = require('../db/connection');
const settings = require('./settings');
const { LATEST_VERSION } = require('../db/migrations');
const { todayIso } = require('../util/jalali');

function stamp(d) {
  const x = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}-${p(x.getHours())}${p(x.getMinutes())}${p(x.getSeconds())}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** ساخت فایل پشتیبان */
function createBackup(db, destDir, label) {
  ensureDir(destDir);
  const name = `myshop-backup-${label ? label + '-' : ''}${stamp()}.sqlite`;
  const dest = path.join(destDir, name);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  db.prepare('VACUUM INTO ?').run(dest);
  const size = fs.statSync(dest).size;
  return { file: dest, name, size, createdAt: new Date().toISOString() };
}

function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, file: path.join(dir, f), size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

/** حذف پشتیبان‌های قدیمی و نگهداری n نسخه آخر */
function pruneBackups(dir, keep = 30) {
  const files = listBackups(dir);
  const removed = [];
  for (const f of files.slice(keep)) {
    try { fs.unlinkSync(f.file); removed.push(f.name); } catch (_) { /* نادیده */ }
  }
  return removed;
}

/** بررسی سلامت پایگاه داده و صحت حسابداری */
function integrityCheck(db) {
  const sqlite = db.pragma('integrity_check');
  const sqliteOk = sqlite.length === 1 && sqlite[0].integrity_check === 'ok';
  const fk = db.pragma('foreign_key_check');
  const unbalanced = db.prepare(`
    SELECT e.id, e.entry_no, SUM(l.debit) d, SUM(l.credit) c
    FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
    GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`).all();
  const totals = db.prepare('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines').get();
  const stockValue = db.prepare('SELECT COALESCE(SUM(stock_value),0) v FROM products').get().v;
  const inventoryAccount = db.prepare(`SELECT COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0) v
                                       FROM journal_lines WHERE account_code='106'`).get().v;
  const orphanLines = db.prepare(`SELECT COUNT(*) c FROM journal_lines l
    WHERE NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=l.entry_id)`).get().c;
  const orphanItems = db.prepare(`SELECT COUNT(*) c FROM invoice_items ii
    WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id=ii.invoice_id)`).get().c;

  const problems = [];
  if (!sqliteOk) problems.push('ساختار فایل پایگاه داده مشکل دارد: ' + JSON.stringify(sqlite));
  if (fk.length) problems.push(`${fk.length} ارجاع نامعتبر بین جدول‌ها یافت شد.`);
  if (unbalanced.length) problems.push(`${unbalanced.length} سند حسابداری نامتوازن است.`);
  if (totals.d !== totals.c) problems.push(`جمع بدهکار (${totals.d}) با جمع بستانکار (${totals.c}) برابر نیست.`);
  if (stockValue !== inventoryAccount) problems.push(`ارزش انبار (${stockValue}) با مانده حساب موجودی کالا (${inventoryAccount}) اختلاف دارد.`);
  if (orphanLines) problems.push(`${orphanLines} ردیف سند بدون سند اصلی.`);
  if (orphanItems) problems.push(`${orphanItems} ردیف فاکتور بدون فاکتور اصلی.`);

  return {
    ok: problems.length === 0,
    problems,
    details: {
      sqlite: sqliteOk ? 'ok' : sqlite,
      totalDebit: totals.d,
      totalCredit: totals.c,
      stockValue,
      inventoryAccount,
      entries: db.prepare('SELECT COUNT(*) c FROM journal_entries').get().c,
      invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c,
      products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
      version: db.pragma('user_version', { simple: true }),
    },
  };
}

/** بررسی اینکه فایل انتخاب‌شده یک پشتیبان معتبر است */
function inspectBackupFile(file) {
  if (!fs.existsSync(file)) throw new AppError('فایل پشتیبان یافت نشد.', 'NO_FILE');
  let probe;
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true });
  } catch (e) {
    throw new AppError('فایل انتخاب‌شده یک پایگاه داده معتبر نیست.', 'BAD_BACKUP', e.message);
  }
  try {
    const tables = probe.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((x) => x.name);
    const required = ['settings', 'accounts', 'journal_entries', 'journal_lines', 'products', 'invoices'];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) {
      throw new AppError('فایل انتخاب‌شده پشتیبان این نرم‌افزار نیست (جدول‌های ' + missing.join('، ') + ' وجود ندارد).', 'BAD_BACKUP');
    }
    const version = probe.pragma('user_version', { simple: true });
    if (version > LATEST_VERSION) {
      throw new AppError('این پشتیبان با نسخه جدیدتری از نرم‌افزار ساخته شده است. ابتدا نرم‌افزار را به‌روزرسانی کنید.', 'NEWER_BACKUP');
    }
    const integrity = probe.pragma('integrity_check');
    if (!(integrity.length === 1 && integrity[0].integrity_check === 'ok')) {
      throw new AppError('فایل پشتیبان آسیب دیده است و قابل بازیابی نیست.', 'CORRUPT_BACKUP');
    }
    return {
      version,
      invoices: probe.prepare('SELECT COUNT(*) c FROM invoices').get().c,
      products: probe.prepare('SELECT COUNT(*) c FROM products').get().c,
      entries: probe.prepare('SELECT COUNT(*) c FROM journal_entries').get().c,
      shopName: (probe.prepare(`SELECT value FROM settings WHERE key='shop_name'`).get() || {}).value || '',
      size: fs.statSync(file).size,
    };
  } finally {
    probe.close();
  }
}

/**
 * بازیابی پشتیبان.
 * پیش از جایگزینی، از وضعیت فعلی یک نسخه ایمنی گرفته می‌شود.
 */
function restoreBackup(file, opts = {}) {
  const info = inspectBackupFile(file);
  const db = connection.get();
  const dbFile = connection.file();
  const safetyDir = opts.safetyDir || path.join(path.dirname(dbFile), 'backups');
  const safety = createBackup(db, safetyDir, 'before-restore');

  connection.close();
  for (const suffix of ['-wal', '-shm']) {
    const f = dbFile + suffix;
    if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch (_) { /* نادیده */ } }
  }
  try {
    fs.copyFileSync(file, dbFile);
  } catch (e) {
    fs.copyFileSync(safety.file, dbFile); // بازگرداندن وضعیت قبلی
    connection.open(dbFile);
    throw new AppError('بازیابی ناموفق بود؛ وضعیت قبلی بازگردانده شد.', 'RESTORE_FAILED', e.message);
  }
  const reopened = connection.open(dbFile);
  const check = integrityCheck(reopened.db);
  return { restored: true, info, safetyBackup: safety, migration: reopened.migration, check };
}

/** پشتیبان‌گیری خودکار بر اساس تنظیمات */
function autoBackup(db, defaultDir) {
  if (!settings.bool(db, 'auto_backup', true)) return { skipped: true, reason: 'غیرفعال' };
  const days = Math.max(1, settings.num(db, 'auto_backup_days', 1));
  const last = settings.get(db, 'last_auto_backup', '');
  const today = todayIso();
  if (last) {
    const diff = (new Date(today) - new Date(last)) / 86400000;
    if (diff < days) return { skipped: true, reason: 'زمان پشتیبان‌گیری بعدی نرسیده است', last };
  }
  const dir = settings.get(db, 'backup_dir', '') || defaultDir;
  const result = createBackup(db, dir, 'auto');
  settings.set(db, { last_auto_backup: today });
  pruneBackups(dir, 30);
  return { skipped: false, ...result };
}

// ── ورود اطلاعات از نسخه قدیمی ───────────────────────────────────

/** جست‌وجوی پایگاه داده نسخه قبلی برنامه در مسیرهای متداول */
function findLegacyDatabases(candidateDirs) {
  const found = [];
  for (const dir of candidateDirs) {
    if (!dir) continue;
    for (const name of ['shop.sqlite', 'shop.db', 'accounting.sqlite']) {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > 0) {
          const probe = new Database(file, { readonly: true, fileMustExist: true });
          const tables = probe.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((x) => x.name);
          const counts = {};
          for (const t of ['products', 'parties', 'invoices', 'checks', 'transactions']) {
            if (tables.includes(t)) counts[t] = probe.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
          }
          probe.close();
          if (tables.includes('products') || tables.includes('invoices')) {
            found.push({ file, counts, size: fs.statSync(file).size });
          }
        }
      } catch (_) { /* فایل نامعتبر، نادیده گرفته می‌شود */ }
    }
  }
  return found;
}

/**
 * ورود اطلاعات از پایگاه داده نسخه قدیمی.
 * کالاها، طرف حساب‌ها، تنظیمات و چک‌ها منتقل می‌شوند و فاکتورهای قدیمی به عنوان
 * «اسناد بایگانی» ذخیره می‌گردند تا با حسابداری جدید تداخل نکنند.
 */
function importLegacy(file, opts = {}) {
  const db = connection.get();
  const src = new Database(file, { readonly: true, fileMustExist: true });
  const products = require('./products');
  const parties = require('./parties');
  try {
    const tables = src.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((x) => x.name);
    const has = (t) => tables.includes(t);
    const report = { products: 0, parties: 0, checks: 0, documents: 0, settings: 0, skipped: [] };
    const date = opts.date || todayIso();

    const run = db.transaction(() => {
      if (has('settings')) {
        const rows = src.prepare('SELECT key,value FROM settings').all();
        const allow = ['shop_name', 'shop_phone', 'shop_address', 'vat_rate'];
        const patch = {};
        for (const r of rows) if (allow.includes(r.key) && r.value) patch[r.key] = r.value;
        if (Object.keys(patch).length) { settings.set(db, patch); report.settings = Object.keys(patch).length; }
      }

      const productMap = {};
      if (has('products')) {
        for (const p of src.prepare('SELECT * FROM products').all()) {
          const exists = p.code
            ? db.prepare('SELECT id FROM products WHERE code=? AND code<>?').get(String(p.code), '')
            : db.prepare('SELECT id FROM products WHERE name=?').get(String(p.name || ''));
          if (exists) { productMap[p.id] = exists.id; report.skipped.push('کالای تکراری: ' + p.name); continue; }
          const created = products.create(db, {
            name: String(p.name || 'کالای بدون نام'),
            code: String(p.code || ''),
            buy_price: p.buy_price || 0,
            sell_price: p.sell_price || 0,
            min_stock: p.min_stock || 0,
            stock: p.stock || 0,
            opening_cost: p.buy_price || 0,
            date,
          });
          productMap[p.id] = created.id;
          report.products += 1;
        }
      }

      if (has('parties')) {
        for (const p of src.prepare('SELECT * FROM parties').all()) {
          const type = p.type === 'supplier' ? 'supplier' : 'customer';
          const exists = db.prepare('SELECT id FROM parties WHERE type=? AND name=?').get(type, String(p.name || ''));
          if (exists) continue;
          parties.create(db, {
            type,
            name: String(p.name || 'بدون نام'),
            phone: String(p.phone || ''),
            national_id: String(p.national_id || ''),
            address: String(p.address || ''),
            notes: String(p.notes || ''),
          });
          report.parties += 1;
        }
      }

      if (has('checks')) {
        const ins = db.prepare(`INSERT INTO checks
          (kind,number,bank,branch,party_id,party_name,amount,issue_date,due_date,status,doc_type,doc_id,notes,created_at)
          VALUES (?,?,?,'',NULL,?,?,?,?,'pending','legacy',NULL,?,?)`);
        for (const c of src.prepare('SELECT * FROM checks').all()) {
          ins.run(c.kind === 'paid' ? 'paid' : 'received', String(c.number || ''), String(c.bank || ''),
            String(c.party || ''), Math.max(0, Math.round(c.amount || 0)),
            String(c.issue_date || date), String(c.due_date || date),
            'منتقل‌شده از نسخه قبلی — نیازمند تعیین تکلیف', new Date().toISOString());
          report.checks += 1;
        }
      }

      if (has('invoices')) {
        const items = has('invoice_items')
          ? src.prepare('SELECT * FROM invoice_items WHERE invoice_id=?')
          : null;
        const ins = db.prepare(`INSERT INTO legacy_documents
          (kind,invoice_no,date,party,subtotal,discount,vat,total,method,notes,items_json,imported_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const inv of src.prepare('SELECT * FROM invoices').all()) {
          const its = items ? items.all(inv.id) : [];
          ins.run(String(inv.type || ''), String(inv.invoice_no || ''), String(inv.date || ''),
            String(inv.party || ''), Math.round(inv.subtotal || 0), Math.round(inv.discount || 0),
            Math.round(inv.vat || 0), Math.round(inv.total || 0), String(inv.payment_method || ''),
            String(inv.notes || ''), JSON.stringify(its), new Date().toISOString());
          report.documents += 1;
        }
      }
      settings.set(db, { legacy_imported: '1', legacy_imported_at: new Date().toISOString(), legacy_source: file });
    });
    run();
    return report;
  } finally {
    src.close();
  }
}

module.exports = {
  createBackup, listBackups, pruneBackups, integrityCheck, inspectBackupFile,
  restoreBackup, autoBackup, findLegacyDatabases, importLegacy, ensureDir,
};
