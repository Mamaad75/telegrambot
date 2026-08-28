'use strict';
/*
 * پشتیبان‌گیری و بازیابی امن پایگاه داده.
 * از دستور VACUUM INTO استفاده می‌شود که یک کپی سالم و فشرده از پایگاه داده می‌سازد
 * و هرگز فایل اصلی را خراب نمی‌کند. پیش از هر بازیابی، یک نسخه ایمنی از وضعیت فعلی گرفته می‌شود.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const connection = require('../db/connection.js');
const settings = require('./settings.js');
const Jalali = require('../shared/jalali.js');

function stamp() {
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  const j = Jalali.isoToJalali(Jalali.todayIso()).replace(/\//g, '-');
  return j + '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** ساخت نسخه پشتیبان؛ خروجی مسیر فایل */
function create(db, dir, tag) {
  ensureDir(dir);
  const name = 'backup_' + stamp() + (tag ? '_' + tag : '') + '.db';
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  db.prepare('VACUUM INTO ?').run(dest);
  const st = fs.statSync(dest);
  settings.set(db, 'last_backup_at', new Date().toISOString());
  settings.set(db, 'last_backup_file', dest);
  return { file: dest, name: name, size: st.size, created_at: new Date().toISOString() };
}

function list(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.db'); })
    .map(function (f) {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { name: f, file: full, size: st.size, mtime: st.mtime.toISOString(), mtime_jalali: Jalali.isoToJalali(st.mtime.toISOString().slice(0, 10)) };
    })
    .sort(function (a, b) { return b.mtime.localeCompare(a.mtime); });
}

/** بررسی سلامت یک فایل پشتیبان پیش از بازیابی */
function verify(file) {
  if (!fs.existsSync(file)) return { ok: false, error: 'فایل پشتیبان یافت نشد.' };
  let conn = null;
  try {
    conn = new Database(file, { readonly: true, fileMustExist: true });
    const chk = conn.pragma('integrity_check');
    if (!(chk.length === 1 && chk[0].integrity_check === 'ok')) {
      return { ok: false, error: 'فایل پشتیبان سالم نیست.' };
    }
    const t = conn.prepare('SELECT COUNT(*) c FROM sqlite_master WHERE type=\'table\' AND name IN (\'journal_entries\',\'journal_lines\',\'products\',\'settings\')').get().c;
    if (t < 4) return { ok: false, error: 'این فایل یک پایگاه داده معتبر این برنامه نیست.' };
    const stats = {
      products: conn.prepare('SELECT COUNT(*) c FROM products').get().c,
      sales: conn.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c,
      purchases: conn.prepare('SELECT COUNT(*) c FROM purchase_invoices').get().c,
      entries: conn.prepare('SELECT COUNT(*) c FROM journal_entries').get().c,
      checks: conn.prepare('SELECT COUNT(*) c FROM checks').get().c
    };
    return { ok: true, stats: stats };
  } catch (e) {
    return { ok: false, error: 'خواندن فایل پشتیبان ممکن نشد: ' + e.message };
  } finally {
    if (conn) { try { conn.close(); } catch (e) { /* بی‌اهمیت */ } }
  }
}

/**
 * بازیابی: ابتدا از وضعیت فعلی یک نسخه ایمنی گرفته می‌شود، سپس فایل جایگزین می‌گردد.
 * پس از بازیابی، اتصال دوباره باز شده و مهاجرت‌ها اجرا می‌شوند.
 */
function restore(file, opt) {
  const options = opt || {};
  const v = verify(file);
  if (!v.ok) throw new Error(v.error);

  const db = connection.get();
  const dbPath = connection.getPath();
  const safetyDir = options.safetyDir || path.join(path.dirname(dbPath), 'backups');
  let safety = null;
  try {
    safety = create(db, safetyDir, 'before-restore');
  } catch (e) {
    // اگر گرفتن نسخه ایمنی ممکن نبود، بازیابی انجام نمی‌شود
    throw new Error('گرفتن نسخه ایمنی پیش از بازیابی ممکن نشد: ' + e.message);
  }

  connection.close();
  const tmp = dbPath + '.restoring';
  fs.copyFileSync(file, tmp);
  // پاک‌سازی فایل‌های جانبی WAL
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) { try { fs.unlinkSync(dbPath + suffix); } catch (e) { /* بی‌اهمیت */ } }
  }
  fs.renameSync(tmp, dbPath);
  const reopened = connection.open(dbPath);
  const check = connection.integrityCheck(reopened);
  if (!check.ok) throw new Error('پایگاه داده بازیابی‌شده سالم نیست. نسخه ایمنی: ' + (safety ? safety.file : '-'));
  return { ok: true, safety_backup: safety, stats: v.stats };
}

function prune(dir, keep) {
  const files = list(dir);
  const k = keep || 30;
  const removed = [];
  for (let i = k; i < files.length; i++) {
    try { fs.unlinkSync(files[i].file); removed.push(files[i].name); } catch (e) { /* بی‌اهمیت */ }
  }
  return removed;
}

function remove(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

/** پشتیبان خودکار در صورت رسیدن موعد */
function autoBackup(db, dir) {
  if (!settings.getBool(db, 'auto_backup')) return null;
  const days = parseInt(settings.get(db, 'auto_backup_days', '1'), 10) || 1;
  const last = settings.get(db, 'last_backup_at', '');
  if (last) {
    const diff = (Date.now() - new Date(last).getTime()) / 86400000;
    if (diff < days) return null;
  }
  const r = create(db, dir, 'auto');
  prune(dir, parseInt(settings.get(db, 'backup_keep', '30'), 10) || 30);
  return r;
}

module.exports = { create: create, list: list, verify: verify, restore: restore, prune: prune, remove: remove, autoBackup: autoBackup, ensureDir: ensureDir };
