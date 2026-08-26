'use strict';
/**
 * هزینه‌ها، درآمدهای متفرقه، انتقال بین حساب‌ها و آورده/برداشت مالک.
 */
const { AppError, assert } = require('../util/errors');
const { r } = require('../util/money');
const { todayIso } = require('../util/jalali');
const accounting = require('./accounting');

const ACC = accounting.ACC;
const PAY_ACCOUNTS = { cash: '101', pos: '102', bank: '103' };

function payAccount(method) {
  const acc = PAY_ACCOUNTS[method];
  if (!acc) throw new AppError('روش پرداخت نامعتبر است.', 'BAD_METHOD');
  return acc;
}

function categoryAccount(db, kind, categoryId, fallback) {
  if (categoryId) {
    const c = db.prepare('SELECT * FROM categories WHERE id=? AND kind=?').get(Number(categoryId), kind);
    if (!c) throw new AppError('دسته‌بندی یافت نشد.', 'NO_CATEGORY');
    return { code: c.account_code || fallback, name: c.name, id: c.id };
  }
  return { code: fallback, name: kind === 'expense' ? 'هزینه متفرقه' : 'درآمد متفرقه', id: null };
}

/** ثبت هزینه */
function addExpense(db, payload) {
  const run = db.transaction(() => {
    const amount = Math.max(0, r(payload.amount));
    assert(amount > 0, 'مبلغ هزینه باید بزرگ‌تر از صفر باشد.');
    const date = payload.date || todayIso();
    const method = payload.method || 'cash';
    const pay = payAccount(method);
    const cat = categoryAccount(db, 'expense', payload.category_id, '502-10');
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO expenses
      (date,category_id,category_name,account_code,amount,method,pay_account,description,status,entry_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,'posted',NULL,?)`)
      .run(date, cat.id, cat.name, cat.code, amount, method, pay, String(payload.description || ''), now);
    const id = Number(info.lastInsertRowid);
    const entryId = accounting.postEntry(db, {
      date, refType: 'expense', refId: id,
      description: `هزینه ${cat.name}${payload.description ? ' - ' + payload.description : ''}`,
      lines: [
        { account: cat.code, debit: amount, description: cat.name },
        { account: pay, credit: amount, description: accounting.METHOD_LABELS[method] },
      ],
    });
    db.prepare('UPDATE expenses SET entry_id=? WHERE id=?').run(entryId, id);
    return id;
  });
  const id = run();
  return db.prepare('SELECT * FROM expenses WHERE id=?').get(id);
}

/** ثبت درآمد متفرقه */
function addIncome(db, payload) {
  const run = db.transaction(() => {
    const amount = Math.max(0, r(payload.amount));
    assert(amount > 0, 'مبلغ درآمد باید بزرگ‌تر از صفر باشد.');
    const date = payload.date || todayIso();
    const method = payload.method || 'cash';
    const pay = payAccount(method);
    const cat = categoryAccount(db, 'income', payload.category_id, '402-02');
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO incomes
      (date,category_id,category_name,account_code,amount,method,pay_account,description,status,entry_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,'posted',NULL,?)`)
      .run(date, cat.id, cat.name, cat.code, amount, method, pay, String(payload.description || ''), now);
    const id = Number(info.lastInsertRowid);
    const entryId = accounting.postEntry(db, {
      date, refType: 'income', refId: id,
      description: `درآمد ${cat.name}${payload.description ? ' - ' + payload.description : ''}`,
      lines: [
        { account: pay, debit: amount, description: accounting.METHOD_LABELS[method] },
        { account: cat.code, credit: amount, description: cat.name },
      ],
    });
    db.prepare('UPDATE incomes SET entry_id=? WHERE id=?').run(entryId, id);
    return id;
  });
  const id = run();
  return db.prepare('SELECT * FROM incomes WHERE id=?').get(id);
}

/** انتقال وجه بین حساب‌های نقدی (بدون تأثیر بر سود و زیان) */
function addTransfer(db, payload) {
  const run = db.transaction(() => {
    const amount = Math.max(0, r(payload.amount));
    assert(amount > 0, 'مبلغ انتقال باید بزرگ‌تر از صفر باشد.');
    const from = String(payload.from_code || '');
    const to = String(payload.to_code || '');
    assert(['101', '102', '103'].includes(from), 'حساب مبدأ نامعتبر است.');
    assert(['101', '102', '103'].includes(to), 'حساب مقصد نامعتبر است.');
    assert(from !== to, 'حساب مبدأ و مقصد نباید یکسان باشند.');
    const date = payload.date || todayIso();
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO transfers(date,from_code,to_code,amount,description,status,entry_id,created_at)
      VALUES (?,?,?,?,?,'posted',NULL,?)`).run(date, from, to, amount, String(payload.description || ''), now);
    const id = Number(info.lastInsertRowid);
    const nameOf = (code) => db.prepare('SELECT name FROM accounts WHERE code=?').get(code).name;
    const entryId = accounting.postEntry(db, {
      date, refType: 'transfer', refId: id,
      description: `انتقال وجه از ${nameOf(from)} به ${nameOf(to)}`,
      lines: [
        { account: to, debit: amount, description: 'دریافت انتقال' },
        { account: from, credit: amount, description: 'ارسال انتقال' },
      ],
    });
    db.prepare('UPDATE transfers SET entry_id=? WHERE id=?').run(entryId, id);
    return id;
  });
  const id = run();
  return db.prepare('SELECT * FROM transfers WHERE id=?').get(id);
}

/** آورده یا برداشت مالک */
function ownerEquity(db, payload) {
  const run = db.transaction(() => {
    const amount = Math.max(0, r(payload.amount));
    assert(amount > 0, 'مبلغ باید بزرگ‌تر از صفر باشد.');
    const date = payload.date || todayIso();
    const pay = payAccount(payload.method || 'cash');
    const isDraw = payload.kind === 'drawing';
    const lines = isDraw
      ? [{ account: ACC.DRAWINGS, debit: amount, description: 'برداشت مالک' },
        { account: pay, credit: amount, description: 'خروج وجه' }]
      : [{ account: pay, debit: amount, description: 'ورود وجه' },
        { account: ACC.EQUITY, credit: amount, description: 'آورده مالک' }];
    return accounting.postEntry(db, {
      date, refType: isDraw ? 'drawing' : 'contribution', refId: null,
      description: (isDraw ? 'برداشت مالک' : 'آورده مالک') + (payload.description ? ' - ' + payload.description : ''),
      lines,
    });
  });
  return { entry_id: run() };
}

/** مانده اولیه حساب‌های نقدی هنگام راه‌اندازی */
function openingBalances(db, payload) {
  const run = db.transaction(() => {
    const date = payload.date || todayIso();
    const lines = [];
    let total = 0;
    for (const code of ['101', '102', '103']) {
      const amount = Math.max(0, r(payload[code] || 0));
      if (amount > 0) {
        lines.push({ account: code, debit: amount, description: 'مانده اول دوره' });
        total += amount;
      }
    }
    if (!lines.length) return null;
    lines.push({ account: ACC.EQUITY, credit: total, description: 'سرمایه اولیه' });
    return accounting.postEntry(db, {
      date, refType: 'opening', refId: null, description: 'مانده اول دوره حساب‌های نقدی', lines,
    });
  });
  return { entry_id: run() };
}

function voidDoc(db, table, id) {
  const run = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new AppError('سند یافت نشد.', 'NO_DOC');
    if (row.status === 'void') throw new AppError('این سند قبلاً ابطال شده است.', 'ALREADY_VOID');
    if (row.entry_id) accounting.reverseEntry(db, row.entry_id, todayIso(), 'ابطال سند');
    db.prepare(`UPDATE ${table} SET status='void' WHERE id=?`).run(id);
    return id;
  });
  run();
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
}

function listExpenses(db, filter = {}) { return listSimple(db, 'expenses', filter); }
function listIncomes(db, filter = {}) { return listSimple(db, 'incomes', filter); }

function listSimple(db, table, filter) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.from) { where += ' AND date>=@from'; params.from = filter.from; }
  if (filter.to) { where += ' AND date<=@to'; params.to = filter.to; }
  if (filter.categoryId) { where += ' AND category_id=@cid'; params.cid = Number(filter.categoryId); }
  if (filter.method) { where += ' AND method=@method'; params.method = filter.method; }
  if (filter.q) { where += ' AND (description LIKE @q OR category_name LIKE @q)'; params.q = '%' + filter.q + '%'; }
  const limit = Math.min(Number(filter.limit) || 300, 3000);
  const offset = Number(filter.offset) || 0;
  const rows = db.prepare(`SELECT * FROM ${table} ${where} ORDER BY date DESC, id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  const agg = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) total FROM ${table} ${where} AND status='posted'`).get(params);
  const byCategory = db.prepare(`SELECT category_name, COALESCE(SUM(amount),0) total, COUNT(*) count
    FROM ${table} ${where} AND status='posted' GROUP BY category_name ORDER BY total DESC`).all(params);
  return { rows, total: agg.c, summary: agg, byCategory };
}

function listTransfers(db, filter = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.from) { where += ' AND t.date>=@from'; params.from = filter.from; }
  if (filter.to) { where += ' AND t.date<=@to'; params.to = filter.to; }
  const rows = db.prepare(`SELECT t.*, (SELECT name FROM accounts WHERE code=t.from_code) from_name,
      (SELECT name FROM accounts WHERE code=t.to_code) to_name
    FROM transfers t ${where} ORDER BY t.date DESC, t.id DESC LIMIT 500`).all(params);
  return { rows, total: rows.length };
}

module.exports = {
  addExpense, addIncome, addTransfer, ownerEquity, openingBalances,
  listExpenses, listIncomes, listTransfers, voidDoc, payAccount, PAY_ACCOUNTS,
};
