'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const connection = require('../src/main/db/connection');

let passed = 0; let failed = 0; const failures = [];
let currentSuite = '';

function suite(name) { currentSuite = name; console.log('\n\x1b[1m▶ ' + name + '\x1b[0m'); }

function ok(cond, label, detail) {
  if (cond) { passed += 1; console.log('  \x1b[32m✓\x1b[0m ' + label); } else {
    failed += 1;
    failures.push(currentSuite + ' :: ' + label + (detail ? ' → ' + detail : ''));
    console.log('  \x1b[31m✗ ' + label + (detail ? ' → ' + detail : '') + '\x1b[0m');
  }
}

function eq(actual, expected, label) {
  const same = actual === expected;
  ok(same, label, same ? '' : `انتظار ${expected} ولی ${actual}`);
  return same;
}

function near(actual, expected, tol, label) {
  const same = Math.abs(actual - expected) <= tol;
  ok(same, label, same ? '' : `انتظار ~${expected} ولی ${actual}`);
}

function throws(fn, label) {
  try { fn(); ok(false, label, 'خطایی رخ نداد'); } catch (e) { ok(true, label + ' (' + e.message.slice(0, 60) + ')'); }
}

function freshDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myshop-test-'));
  const file = path.join(dir, (name || 'test') + '.sqlite');
  const { db } = connection.open(file);
  return { db, file, dir };
}

/** بررسی توازن تک‌تک اسناد و کل دفتر */
function assertLedgerBalanced(db, label) {
  const bad = db.prepare(`
    SELECT e.id, e.entry_no, SUM(l.debit) d, SUM(l.credit) c
    FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
    GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`).all();
  ok(bad.length === 0, label + ' — همه اسناد متوازن‌اند',
    bad.length ? `${bad.length} سند نامتوازن: ${JSON.stringify(bad.slice(0, 3))}` : '');
  const tot = db.prepare('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines').get();
  ok(tot.d === tot.c, label + ' — جمع کل بدهکار = بستانکار', tot.d === tot.c ? '' : `${tot.d} ≠ ${tot.c}`);
}

/** بررسی تطابق ارزش انبار با مانده حساب موجودی کالا */
function assertInventoryMatches(db, label) {
  const products = db.prepare('SELECT COALESCE(SUM(stock_value),0) v FROM products').get().v;
  const acc = db.prepare(`SELECT COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0) v
                          FROM journal_lines WHERE account_code='106'`).get().v;
  ok(products === acc, label + ' — ارزش انبار = مانده حساب موجودی کالا',
    products === acc ? '' : `انبار ${products} ≠ دفتر ${acc}`);
}

function summary() {
  console.log('\n' + '─'.repeat(64));
  console.log(`\x1b[1mنتیجه: ${passed} موفق، ${failed} ناموفق\x1b[0m`);
  if (failures.length) {
    console.log('\n\x1b[31mموارد ناموفق:\x1b[0m');
    for (const f of failures) console.log(' - ' + f);
  }
  console.log('─'.repeat(64));
  return failed === 0;
}

function counts() { return { passed, failed }; }

module.exports = { suite, ok, eq, near, throws, freshDb, assertLedgerBalanced, assertInventoryMatches, summary, counts };
