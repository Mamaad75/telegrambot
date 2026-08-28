'use strict';
/*
 * هزینه، درآمد متفرقه و انتقال بین صندوق/بانک/کارتخوان.
 * انتقال هیچ اثری بر سود و زیان ندارد (فقط جابه‌جایی بین دارایی‌ها).
 */
const journal = require('./journal.js');
const settings = require('./settings.js');
const bankAccounts = require('./bankAccounts.js');
const checksSvc = require('./checks.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

function assetAccount(db, method, bankAccountId) {
  if (method === 'cash') return { code: C.ACC.CASH, bank_account_id: null };
  if (method === 'check') return { code: C.ACC.CHECKS_PAYABLE, bank_account_id: null };
  if (!bankAccountId) {
    const def = bankAccounts.defaultFor(db, method);
    if (!def) throw new Error('برای این روش باید ابتدا حساب بانکی یا کارتخوان تعریف شود.');
    bankAccountId = def.id;
  }
  const ba = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(bankAccountId);
  if (!ba) throw new Error('حساب بانکی یافت نشد.');
  return { code: bankAccounts.accountCodeOf(ba.kind), bank_account_id: ba.id };
}

/* --------------------------------- هزینه --------------------------------- */

function createExpense(db, data) {
  const amount = Math.round(Number(data.amount) || 0);
  if (amount <= 0) throw new Error('مبلغ هزینه باید بزرگ‌تر از صفر باشد.');
  const date = data.date || Jalali.todayIso();
  const method = data.method || 'cash';
  const tx = db.transaction(function () {
    const docNo = settings.docNumber(db, 'expense');
    let checkId = null;
    if (method === 'check') {
      const chk = checksSvc.create(db, {
        direction: 'issued', amount: amount,
        check_number: (data.check || {}).check_number,
        sayad_id: (data.check || {}).sayad_id,
        bank_name: (data.check || {}).bank_name,
        holder_name: (data.check || {}).holder_name || data.description,
        issue_date: (data.check || {}).issue_date || date,
        due_date: (data.check || {}).due_date || date,
        bank_account_id: data.bank_account_id || null,
        ref_type: 'expense', ref_no: docNo, date: date,
        note: 'چک بابت هزینه'
      });
      checkId = chk.id;
    }
    const cat = data.category_id ? db.prepare('SELECT name FROM expense_categories WHERE id=?').get(data.category_id) : null;
    const desc = (cat ? cat.name : 'هزینه') + (data.description ? ' - ' + data.description : '');
    const acc = assetAccount(db, method, data.bank_account_id);
    const entryId = journal.post(db, {
      date: date, description: desc, ref_type: 'expense', ref_no: docNo,
      lines: [
        { account: C.ACC.OPERATING_EXPENSE, debit: amount, description: desc },
        { account: acc.code, credit: amount, bank_account_id: acc.bank_account_id, description: desc }
      ]
    });
    const info = db.prepare(
      'INSERT INTO expenses (doc_no, date, category_id, amount, method, bank_account_id, check_id, description, journal_entry_id) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(docNo, date, data.category_id || null, amount, method, acc.bank_account_id, checkId, data.description || null, entryId);
    const id = info.lastInsertRowid;
    journal.setRef(db, entryId, 'expense', id, docNo);
    if (checkId) db.prepare('UPDATE checks SET ref_id=? WHERE id=?').run(id, checkId);
    return id;
  });
  return getExpense(db, tx());
}

function getExpense(db, id) {
  const r = db.prepare('SELECT e.*, ec.name AS category_name, ba.title AS bank_title FROM expenses e ' +
    'LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN bank_accounts ba ON ba.id=e.bank_account_id WHERE e.id=?').get(id);
  if (r) {
    r.date_jalali = Jalali.isoToJalali(r.date);
    r.method_label = C.PAY_METHOD_LABEL[r.method] || r.method;
  }
  return r;
}

function listExpenses(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('e.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('e.date <= ?'); args.push(o.to); }
  if (o.category_id) { where.push('e.category_id = ?'); args.push(o.category_id); }
  if (o.method) { where.push('e.method = ?'); args.push(o.method); }
  if (o.search) { where.push('(e.description LIKE ? OR e.doc_no LIKE ? OR ec.name LIKE ?)'); const s = '%' + o.search + '%'; args.push(s, s, s); }
  const sql = 'SELECT e.*, ec.name AS category_name, ba.title AS bank_title FROM expenses e ' +
    'LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN bank_accounts ba ON ba.id=e.bank_account_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 300, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) {
    r.date_jalali = Jalali.isoToJalali(r.date);
    r.method_label = C.PAY_METHOD_LABEL[r.method] || r.method;
    return r;
  });
}

function removeExpense(db, id) {
  const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(id);
  if (!e) throw new Error('سند هزینه یافت نشد.');
  const tx = db.transaction(function () {
    if (e.check_id) {
      const ch = db.prepare('SELECT status, check_code FROM checks WHERE id=?').get(e.check_id);
      if (ch && ch.status !== 'pending') throw new Error('چک ' + ch.check_code + ' وضعیت تغییر یافته دارد و قابل حذف نیست.');
      db.prepare('DELETE FROM checks WHERE id=?').run(e.check_id);
    }
    db.prepare('DELETE FROM expenses WHERE id=?').run(id);
    journal.deleteEntry(db, e.journal_entry_id);
  });
  tx();
  return true;
}

function expenseCategories(db) {
  return db.prepare('SELECT ec.*, (SELECT COUNT(*) FROM expenses e WHERE e.category_id=ec.id) AS usage_count FROM expense_categories ec ORDER BY ec.name').all();
}

function createExpenseCategory(db, name) {
  if (!name || !String(name).trim()) throw new Error('نام دسته الزامی است.');
  db.prepare('INSERT INTO expense_categories (name, active) VALUES (?,1) ON CONFLICT(name) DO NOTHING').run(String(name).trim());
  return db.prepare('SELECT * FROM expense_categories WHERE name=?').get(String(name).trim());
}

function removeExpenseCategory(db, id) {
  const n = db.prepare('SELECT COUNT(*) c FROM expenses WHERE category_id=?').get(id).c;
  if (n) throw new Error('این دسته دارای سند هزینه است و حذف نمی‌شود.');
  db.prepare('DELETE FROM expense_categories WHERE id=?').run(id);
  return true;
}

/* --------------------------------- درآمد --------------------------------- */

function createIncome(db, data) {
  const amount = Math.round(Number(data.amount) || 0);
  if (amount <= 0) throw new Error('مبلغ درآمد باید بزرگ‌تر از صفر باشد.');
  const date = data.date || Jalali.todayIso();
  const method = data.method || 'cash';
  if (method === 'check') throw new Error('برای درآمد چکی، از سند دریافت استفاده کنید.');
  const tx = db.transaction(function () {
    const docNo = settings.docNumber(db, 'income');
    const cat = data.category_id ? db.prepare('SELECT name FROM income_categories WHERE id=?').get(data.category_id) : null;
    const desc = (cat ? cat.name : 'درآمد متفرقه') + (data.description ? ' - ' + data.description : '');
    const acc = assetAccount(db, method, data.bank_account_id);
    const entryId = journal.post(db, {
      date: date, description: desc, ref_type: 'income', ref_no: docNo,
      lines: [
        { account: acc.code, debit: amount, bank_account_id: acc.bank_account_id, description: desc },
        { account: C.ACC.OTHER_INCOME, credit: amount, description: desc }
      ]
    });
    const info = db.prepare(
      'INSERT INTO incomes (doc_no, date, category_id, amount, method, bank_account_id, description, journal_entry_id) VALUES (?,?,?,?,?,?,?,?)'
    ).run(docNo, date, data.category_id || null, amount, method, acc.bank_account_id, data.description || null, entryId);
    const id = info.lastInsertRowid;
    journal.setRef(db, entryId, 'income', id, docNo);
    return id;
  });
  return getIncome(db, tx());
}

function getIncome(db, id) {
  const r = db.prepare('SELECT i.*, ic.name AS category_name, ba.title AS bank_title FROM incomes i ' +
    'LEFT JOIN income_categories ic ON ic.id=i.category_id LEFT JOIN bank_accounts ba ON ba.id=i.bank_account_id WHERE i.id=?').get(id);
  if (r) {
    r.date_jalali = Jalali.isoToJalali(r.date);
    r.method_label = C.PAY_METHOD_LABEL[r.method] || r.method;
  }
  return r;
}

function listIncomes(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('i.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('i.date <= ?'); args.push(o.to); }
  if (o.category_id) { where.push('i.category_id = ?'); args.push(o.category_id); }
  if (o.search) { where.push('(i.description LIKE ? OR i.doc_no LIKE ? OR ic.name LIKE ?)'); const s = '%' + o.search + '%'; args.push(s, s, s); }
  const sql = 'SELECT i.*, ic.name AS category_name, ba.title AS bank_title FROM incomes i ' +
    'LEFT JOIN income_categories ic ON ic.id=i.category_id LEFT JOIN bank_accounts ba ON ba.id=i.bank_account_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY i.date DESC, i.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 300, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) {
    r.date_jalali = Jalali.isoToJalali(r.date);
    r.method_label = C.PAY_METHOD_LABEL[r.method] || r.method;
    return r;
  });
}

function removeIncome(db, id) {
  const e = db.prepare('SELECT * FROM incomes WHERE id=?').get(id);
  if (!e) throw new Error('سند درآمد یافت نشد.');
  const tx = db.transaction(function () {
    db.prepare('DELETE FROM incomes WHERE id=?').run(id);
    journal.deleteEntry(db, e.journal_entry_id);
  });
  tx();
  return true;
}

function incomeCategories(db) {
  return db.prepare('SELECT ic.*, (SELECT COUNT(*) FROM incomes i WHERE i.category_id=ic.id) AS usage_count FROM income_categories ic ORDER BY ic.name').all();
}

function createIncomeCategory(db, name) {
  if (!name || !String(name).trim()) throw new Error('نام دسته الزامی است.');
  db.prepare('INSERT INTO income_categories (name, active) VALUES (?,1) ON CONFLICT(name) DO NOTHING').run(String(name).trim());
  return db.prepare('SELECT * FROM income_categories WHERE name=?').get(String(name).trim());
}

/* -------------------------------- انتقال -------------------------------- */

function createTransfer(db, data) {
  const amount = Math.round(Number(data.amount) || 0);
  if (amount <= 0) throw new Error('مبلغ انتقال باید بزرگ‌تر از صفر باشد.');
  const fee = Math.round(Number(data.fee) || 0);
  if (fee < 0) throw new Error('کارمزد نمی‌تواند منفی باشد.');
  const date = data.date || Jalali.todayIso();
  const from = assetAccount(db, data.from_kind || 'cash', data.from_bank_account_id);
  const to = assetAccount(db, data.to_kind || 'bank', data.to_bank_account_id);
  if (from.code === to.code && from.bank_account_id === to.bank_account_id) {
    throw new Error('مبدأ و مقصد انتقال نمی‌توانند یکسان باشند.');
  }
  const tx = db.transaction(function () {
    const docNo = settings.docNumber(db, 'transfer');
    const desc = data.description || 'انتقال وجه';
    const lines = [
      { account: to.code, debit: amount, bank_account_id: to.bank_account_id, description: desc + ' (واریز)' },
      { account: from.code, credit: amount + fee, bank_account_id: from.bank_account_id, description: desc + ' (برداشت)' }
    ];
    if (fee) lines.push({ account: C.ACC.OPERATING_EXPENSE, debit: fee, description: 'کارمزد انتقال وجه' });
    const entryId = journal.post(db, { date: date, description: desc, ref_type: 'transfer', ref_no: docNo, lines: lines });
    const info = db.prepare(
      'INSERT INTO transfers (doc_no, date, from_kind, from_bank_account_id, to_kind, to_bank_account_id, amount, fee, description, journal_entry_id) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(docNo, date, data.from_kind || 'cash', from.bank_account_id, data.to_kind || 'bank', to.bank_account_id,
      amount, fee, data.description || null, entryId);
    const id = info.lastInsertRowid;
    journal.setRef(db, entryId, 'transfer', id, docNo);
    return id;
  });
  return getTransfer(db, tx());
}

function getTransfer(db, id) {
  const r = db.prepare(
    'SELECT t.*, bf.title AS from_title, bt.title AS to_title FROM transfers t ' +
    'LEFT JOIN bank_accounts bf ON bf.id=t.from_bank_account_id LEFT JOIN bank_accounts bt ON bt.id=t.to_bank_account_id WHERE t.id=?'
  ).get(id);
  if (r) r.date_jalali = Jalali.isoToJalali(r.date);
  return r;
}

function listTransfers(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('t.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('t.date <= ?'); args.push(o.to); }
  const sql = 'SELECT t.*, bf.title AS from_title, bt.title AS to_title FROM transfers t ' +
    'LEFT JOIN bank_accounts bf ON bf.id=t.from_bank_account_id LEFT JOIN bank_accounts bt ON bt.id=t.to_bank_account_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 300, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) { r.date_jalali = Jalali.isoToJalali(r.date); return r; });
}

function removeTransfer(db, id) {
  const t = db.prepare('SELECT * FROM transfers WHERE id=?').get(id);
  if (!t) throw new Error('سند انتقال یافت نشد.');
  const tx = db.transaction(function () {
    db.prepare('DELETE FROM transfers WHERE id=?').run(id);
    journal.deleteEntry(db, t.journal_entry_id);
  });
  tx();
  return true;
}

/* --------------------- آورده و برداشت سرمایه مالک --------------------- */

/**
 * آورده نقدی مالک (افزایش سرمایه) یا برداشت شخصی.
 * kind: 'in' = آورده ، 'out' = برداشت
 */
function createCapital(db, data) {
  const amount = Math.round(Number(data.amount) || 0);
  if (amount <= 0) throw new Error('مبلغ باید بزرگ‌تر از صفر باشد.');
  const date = data.date || Jalali.todayIso();
  const kind = data.kind === 'out' ? 'out' : 'in';
  const acc = assetAccount(db, data.method || 'cash', data.bank_account_id);
  const desc = data.description || (kind === 'in' ? 'آورده نقدی مالک' : 'برداشت شخصی مالک');
  const lines = kind === 'in'
    ? [{ account: acc.code, debit: amount, bank_account_id: acc.bank_account_id, description: desc },
       { account: C.ACC.EQUITY, credit: amount, description: desc }]
    : [{ account: C.ACC.EQUITY, debit: amount, description: desc },
       { account: acc.code, credit: amount, bank_account_id: acc.bank_account_id, description: desc }];
  const entryId = journal.post(db, { date: date, description: desc, ref_type: 'capital', lines: lines });
  return { entry_id: entryId, amount: amount, kind: kind, date: date, description: desc };
}

function listCapital(db, opt) {
  const o = opt || {};
  const where = ['je.ref_type = \'capital\''];
  const args = [];
  if (o.from) { where.push('je.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('je.date <= ?'); args.push(o.to); }
  const rows = db.prepare(
    'SELECT je.id, je.date, je.description, ' +
    ' (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=je.id AND account_code=\'' + C.ACC.EQUITY + '\') AS draw, ' +
    ' (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=je.id AND account_code=\'' + C.ACC.EQUITY + '\') AS contribution ' +
    'FROM journal_entries je WHERE ' + where.join(' AND ') + ' ORDER BY je.date DESC, je.id DESC LIMIT ?'
  ).all(...args.concat([o.limit || 200]));
  return rows.map(function (r) { r.date_jalali = Jalali.isoToJalali(r.date); return r; });
}

function removeCapital(db, entryId) {
  const e = db.prepare('SELECT * FROM journal_entries WHERE id=? AND ref_type=\'capital\'').get(entryId);
  if (!e) throw new Error('سند سرمایه یافت نشد.');
  journal.deleteEntry(db, entryId);
  return true;
}

module.exports = {
  createCapital: createCapital, listCapital: listCapital, removeCapital: removeCapital,
  createExpense: createExpense, getExpense: getExpense, listExpenses: listExpenses, removeExpense: removeExpense,
  expenseCategories: expenseCategories, createExpenseCategory: createExpenseCategory, removeExpenseCategory: removeExpenseCategory,
  createIncome: createIncome, getIncome: getIncome, listIncomes: listIncomes, removeIncome: removeIncome,
  incomeCategories: incomeCategories, createIncomeCategory: createIncomeCategory,
  createTransfer: createTransfer, getTransfer: getTransfer, listTransfers: listTransfers, removeTransfer: removeTransfer
};
