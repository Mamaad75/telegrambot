'use strict';
const { r } = require('../util/money');

function getAll(db) {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {};
  for (const x of rows) out[x.key] = x.value;
  return out;
}
function get(db, key, def = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : def;
}
function num(db, key, def = 0) {
  const v = Number(get(db, key, String(def)));
  return Number.isFinite(v) ? v : def;
}
function bool(db, key, def = false) {
  const v = get(db, key, def ? '1' : '0');
  return v === '1' || v === 'true';
}
function set(db, obj) {
  const stmt = db.prepare(`INSERT INTO settings(key,value) VALUES (?,?)
                           ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const run = db.transaction((o) => {
    for (const [k, v] of Object.entries(o)) stmt.run(k, v === null || v === undefined ? '' : String(v));
  });
  run(obj);
  return getAll(db);
}
/** نرخ ارزش افزوده فعال (درصد) */
function vatRate(db) {
  if (!bool(db, 'vat_enabled', true)) return 0;
  const v = num(db, 'vat_rate', 10);
  return v >= 0 && v <= 100 ? v : 0;
}
/** ساخت شماره فاکتور بعدی بر اساس پیشوند تنظیمات */
function nextInvoiceNo(db, type) {
  const prefixKey = { sale: 'sale_prefix', purchase: 'purchase_prefix', sale_return: 'sale_return_prefix', purchase_return: 'purchase_return_prefix' }[type];
  const prefix = get(db, prefixKey, '');
  const row = db.prepare('SELECT value FROM counters WHERE name=?').get(type);
  const next = (row ? row.value : 0) + 1;
  if (row) db.prepare('UPDATE counters SET value=? WHERE name=?').run(next, type);
  else db.prepare('INSERT INTO counters(name,value) VALUES (?,?)').run(type, next);
  return prefix + String(next).padStart(5, '0');
}
module.exports = { getAll, get, num, bool, set, vatRate, nextInvoiceNo, r };
