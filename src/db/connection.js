'use strict';
/*
 * اتصال به پایگاه داده SQLite + اجرای مهاجرت‌ها + داده‌های پایه
 * پایگاه داده هرگز داخل پوشه نصب برنامه ذخیره نمی‌شود؛ محل آن userData ویندوز است.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const C = require('../shared/constants.js');

let db = null;
let dbPath = null;

/** اجرای فایل‌های مهاجرت به ترتیب شماره */
function runMigrations(conn) {
  conn.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)');
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.sql'); }).sort();
  const applied = new Set(conn.prepare('SELECT version FROM schema_migrations').all().map(function (r) { return r.version; }));
  const insert = conn.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime(\'now\',\'localtime\'))');
  for (const f of files) {
    const version = parseInt(f.slice(0, 3), 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const tx = conn.transaction(function () {
      conn.exec(sql);
      insert.run(version);
    });
    tx();
  }
}

/** درج داده‌های پایه (چارت حساب‌ها، تنظیمات پیش‌فرض، دسته‌ها) */
function seed(conn) {
  const tx = conn.transaction(function () {
    const accStmt = conn.prepare(
      'INSERT INTO accounts (code, name, type, normal_side, is_system, sort_order, active) VALUES (?,?,?,?,1,?,1) ' +
      'ON CONFLICT(code) DO UPDATE SET name=excluded.name, type=excluded.type, normal_side=excluded.normal_side, sort_order=excluded.sort_order');
    for (const a of C.CHART) accStmt.run(a.code, a.name, a.type, a.normal_side, a.sort_order);

    const setStmt = conn.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
    for (const k of Object.keys(C.DEFAULT_SETTINGS)) setStmt.run(k, C.DEFAULT_SETTINGS[k]);

    const expCat = conn.prepare('INSERT INTO expense_categories (name, active) VALUES (?, 1) ON CONFLICT(name) DO NOTHING');
    for (const n of C.DEFAULT_EXPENSE_CATEGORIES) expCat.run(n);

    const incCat = conn.prepare('INSERT INTO income_categories (name, active) VALUES (?, 1) ON CONFLICT(name) DO NOTHING');
    for (const n of C.DEFAULT_INCOME_CATEGORIES) incCat.run(n);

    const cat = conn.prepare('INSERT INTO categories (name, active) VALUES (?, 1) ON CONFLICT(name) DO NOTHING');
    cat.run('عمومی');
  });
  tx();
}

function applyPragmas(conn) {
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('synchronous = FULL');
  conn.pragma('busy_timeout = 8000');
}

/** باز کردن پایگاه داده در مسیر مشخص */
function open(file, options) {
  const opts = options || {};
  if (db) close();
  dbPath = file;
  if (file !== ':memory:') {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(file, { verbose: opts.verbose || null });
  applyPragmas(db);
  runMigrations(db);
  seed(db);
  return db;
}

function get() {
  if (!db) throw new Error('پایگاه داده باز نشده است.');
  return db;
}

function getPath() { return dbPath; }

function close() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* بی‌اهمیت */ }
    db.close();
  }
  db = null;
}

/** بررسی سلامت پایگاه داده */
function integrityCheck(conn) {
  const c = conn || get();
  const r = c.pragma('integrity_check');
  const ok = r.length === 1 && r[0].integrity_check === 'ok';
  const fk = c.pragma('foreign_key_check');
  return { ok: ok && fk.length === 0, integrity: r, foreignKeys: fk };
}

module.exports = { open, get, getPath, close, integrityCheck, runMigrations, seed, applyPragmas };
