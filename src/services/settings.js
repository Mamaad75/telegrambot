'use strict';
/* تنظیمات برنامه و شماره‌گذاری اسناد */
const C = require('../shared/constants.js');

function all(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = Object.assign({}, C.DEFAULT_SETTINGS);
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function get(db, key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (r && r.value !== null && r.value !== undefined) return r.value;
  if (fallback !== undefined) return fallback;
  return C.DEFAULT_SETTINGS[key] !== undefined ? C.DEFAULT_SETTINGS[key] : null;
}

function getNumber(db, key, fallback) {
  const v = parseFloat(get(db, key, fallback));
  return isNaN(v) ? (fallback || 0) : v;
}

function getBool(db, key) {
  const v = get(db, key);
  return v === '1' || v === 1 || v === true || v === 'true';
}

function set(db, key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value === null || value === undefined ? '' : String(value));
  return true;
}

function setMany(db, obj) {
  const tx = db.transaction(function () {
    for (const k of Object.keys(obj)) set(db, k, obj[k]);
  });
  tx();
  return all(db);
}

/** شماره بعدی سند با پیشوند مشخص، به صورت اتمیک */
function nextNumber(db, counterName, prefix) {
  const pad = parseInt(get(db, 'number_padding', '5'), 10) || 5;
  db.prepare('INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(counterName);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(counterName);
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(counterName);
  const num = String(row.value).padStart(pad, '0');
  return (prefix || '') + '-' + num;
}

/** اطمینان از اینکه شمارنده حداقل تا مقدار داده‌شده جلو رفته است */
function bumpCounter(db, counterName, value) {
  db.prepare('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)')
    .run(counterName, value);
}

const DOC_COUNTERS = {
  sales_invoice: { counter: 'sales_invoice', prefixKey: 'sale_prefix' },
  purchase_invoice: { counter: 'purchase_invoice', prefixKey: 'purchase_prefix' },
  sales_return: { counter: 'sales_return', prefixKey: 'sale_return_prefix' },
  purchase_return: { counter: 'purchase_return', prefixKey: 'purchase_return_prefix' },
  receipt: { counter: 'receipt', prefixKey: 'receipt_prefix' },
  payment: { counter: 'payment', prefixKey: 'payment_prefix' },
  expense: { counter: 'expense', prefixKey: 'expense_prefix' },
  income: { counter: 'income', prefixKey: 'income_prefix' },
  transfer: { counter: 'transfer', prefixKey: 'transfer_prefix' }
};

function docNumber(db, docType) {
  const cfg = DOC_COUNTERS[docType];
  if (!cfg) throw new Error('نوع سند نامعتبر: ' + docType);
  return nextNumber(db, cfg.counter, get(db, cfg.prefixKey));
}

/** کد یکتای چک: CHK-R-000001 (دریافتی) یا CHK-P-000001 (صادره) */
function checkCode(db, direction) {
  const tag = direction === 'issued' ? 'P' : 'R';
  const counter = 'check_' + tag;
  db.prepare('INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(counter);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(counter);
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(counter);
  return 'CHK-' + tag + '-' + String(row.value).padStart(6, '0');
}

module.exports = {
  all: all, get: get, getNumber: getNumber, getBool: getBool,
  set: set, setMany: setMany,
  nextNumber: nextNumber, docNumber: docNumber, checkCode: checkCode, bumpCounter: bumpCounter
};
