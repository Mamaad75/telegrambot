'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('./migrations');

let db = null;
let dbFile = '';

/**
 * باز کردن پایگاه داده و اجرای مهاجرت‌ها.
 * @param {string} file مسیر کامل فایل پایگاه داده
 */
function open(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = FULL');   // ایمنی داده‌های حسابداری بر سرعت مقدم است
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 8000');
  const result = migrate(conn);
  db = conn;
  dbFile = file;
  return { db: conn, migration: result };
}

function get() {
  if (!db) throw new Error('پایگاه داده باز نشده است.');
  return db;
}

function file() { return dbFile; }

function close() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* بی‌اهمیت */ }
    db.close();
  }
  db = null;
}

/** اجرای یک تابع درون تراکنش؛ در صورت خطا کل عملیات برگشت می‌خورد. */
function tx(fn) {
  const conn = get();
  return conn.transaction(fn)();
}

module.exports = { open, get, file, close, tx };
