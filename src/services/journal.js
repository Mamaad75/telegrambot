'use strict';
/*
 * موتور حسابداری دوطرفه.
 * هر سند باید تراز باشد: جمع بدهکار = جمع بستانکار.
 * تمام مبالغ عدد صحیح هستند تا تراز دقیقاً برقرار بماند.
 */
const C = require('../shared/constants.js');

/** شماره بعدی سند */
function nextEntryNo(db) {
  const row = db.prepare('SELECT COALESCE(MAX(entry_no), 0) + 1 AS n FROM journal_entries').get();
  return row.n;
}

/**
 * ثبت سند حسابداری.
 * lines: [{ account, debit, credit, party_type, party_id, bank_account_id, description }]
 */
function post(db, doc) {
  if (!doc || !doc.date) throw new Error('تاریخ سند حسابداری مشخص نیست.');
  const raw = (doc.lines || []).map(function (l) {
    return {
      account: String(l.account),
      debit: Math.round(Number(l.debit) || 0),
      credit: Math.round(Number(l.credit) || 0),
      party_type: l.party_type || null,
      party_id: l.party_id || null,
      bank_account_id: l.bank_account_id || null,
      description: l.description || null
    };
  }).filter(function (l) { return l.debit !== 0 || l.credit !== 0; });

  if (!raw.length) throw new Error('سند حسابداری بدون ردیف قابل ثبت نیست.');

  let totalDebit = 0, totalCredit = 0;
  for (const l of raw) {
    if (l.debit < 0 || l.credit < 0) throw new Error('مبلغ منفی در سند حسابداری مجاز نیست.');
    if (l.debit > 0 && l.credit > 0) throw new Error('یک ردیف نمی‌تواند همزمان بدهکار و بستانکار باشد.');
    totalDebit += l.debit;
    totalCredit += l.credit;
  }
  if (totalDebit !== totalCredit) {
    throw new Error('سند حسابداری تراز نیست (بدهکار ' + totalDebit + ' / بستانکار ' + totalCredit + ').');
  }
  if (totalDebit === 0) throw new Error('سند حسابداری با مبلغ صفر قابل ثبت نیست.');

  const info = db.prepare(
    'INSERT INTO journal_entries (entry_no, date, description, ref_type, ref_id, ref_no) VALUES (?,?,?,?,?,?)'
  ).run(nextEntryNo(db), doc.date, doc.description || '', doc.ref_type || null, doc.ref_id || null, doc.ref_no || null);

  const entryId = info.lastInsertRowid;
  const ins = db.prepare(
    'INSERT INTO journal_lines (entry_id, account_code, debit, credit, party_type, party_id, bank_account_id, description) ' +
    'VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const l of raw) {
    ins.run(entryId, l.account, l.debit, l.credit, l.party_type, l.party_id, l.bank_account_id, l.description);
  }
  return entryId;
}

/** به‌روزرسانی شناسه مرجع سند پس از ثبت مدرک */
function setRef(db, entryId, refType, refId, refNo) {
  db.prepare('UPDATE journal_entries SET ref_type=?, ref_id=?, ref_no=? WHERE id=?')
    .run(refType, refId, refNo || null, entryId);
}

/** حذف اسناد یک مدرک (فقط در چارچوب تراکنش حذف/اصلاح مدرک) */
function deleteByRef(db, refType, refId) {
  db.prepare('DELETE FROM journal_entries WHERE ref_type=? AND ref_id=?').run(refType, refId);
}

function deleteEntry(db, entryId) {
  if (!entryId) return;
  db.prepare('DELETE FROM journal_entries WHERE id=?').run(entryId);
}

/** مانده یک حساب کل؛ مثبت = مانده در جهت طبیعی حساب */
function accountBalance(db, code, opt) {
  const o = opt || {};
  const where = ['jl.account_code = ?'];
  const args = [code];
  if (o.to) { where.push('je.date <= ?'); args.push(o.to); }
  if (o.from) { where.push('je.date >= ?'); args.push(o.from); }
  if (o.bank_account_id) { where.push('jl.bank_account_id = ?'); args.push(o.bank_account_id); }
  if (o.party_type) { where.push('jl.party_type = ?'); args.push(o.party_type); }
  if (o.party_id) { where.push('jl.party_id = ?'); args.push(o.party_id); }
  const row = db.prepare(
    'SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c ' +
    'FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE ' + where.join(' AND ')
  ).get(...args);
  const acc = db.prepare('SELECT normal_side FROM accounts WHERE code=?').get(code);
  const side = acc ? acc.normal_side : 'debit';
  return side === 'debit' ? row.d - row.c : row.c - row.d;
}

/** تراز آزمایشی */
function trialBalance(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.from) { where.push('je.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('je.date <= ?'); args.push(o.to); }
  const sql =
    'SELECT a.code, a.name, a.type, a.normal_side, ' +
    '  COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit ' +
    'FROM accounts a ' +
    'LEFT JOIN journal_lines jl ON jl.account_code = a.code ' +
    'LEFT JOIN journal_entries je ON je.id = jl.entry_id ' +
    (where.length ? 'AND ' + where.join(' AND ') + ' ' : '') +
    'GROUP BY a.code ORDER BY a.sort_order';
  const rows = db.prepare(sql).all(...args);
  return rows.map(function (r) {
    const bal = r.normal_side === 'debit' ? r.debit - r.credit : r.credit - r.debit;
    return {
      code: r.code, name: r.name, type: r.type, normal_side: r.normal_side,
      debit: r.debit, credit: r.credit, balance: bal,
      debit_balance: r.debit - r.credit > 0 ? r.debit - r.credit : 0,
      credit_balance: r.credit - r.debit > 0 ? r.credit - r.debit : 0
    };
  });
}

/** دفتر روزنامه */
function journal(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.from) { where.push('je.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('je.date <= ?'); args.push(o.to); }
  if (o.ref_type) { where.push('je.ref_type = ?'); args.push(o.ref_type); }
  if (o.search) { where.push('(je.description LIKE ? OR je.ref_no LIKE ?)'); args.push('%' + o.search + '%', '%' + o.search + '%'); }
  const sql =
    'SELECT je.*, (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=je.id) AS total ' +
    'FROM journal_entries je ' + (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY je.date DESC, je.entry_no DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 200, o.offset || 0);
  const entries = db.prepare(sql).all(...args);
  const lineStmt = db.prepare(
    'SELECT jl.*, a.name AS account_name FROM journal_lines jl JOIN accounts a ON a.code=jl.account_code WHERE jl.entry_id=? ORDER BY jl.id');
  for (const e of entries) e.lines = lineStmt.all(e.id);
  return entries;
}

/** دفتر کل یک حساب با مانده تجمعی */
function ledger(db, code, opt) {
  const o = opt || {};
  const where = ['jl.account_code = ?'];
  const args = [code];
  if (o.from) { where.push('je.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('je.date <= ?'); args.push(o.to); }
  if (o.bank_account_id) { where.push('jl.bank_account_id = ?'); args.push(o.bank_account_id); }
  if (o.party_type) { where.push('jl.party_type = ?'); args.push(o.party_type); }
  if (o.party_id) { where.push('jl.party_id = ?'); args.push(o.party_id); }
  const sql =
    'SELECT je.date, je.entry_no, je.description AS entry_desc, je.ref_type, je.ref_id, je.ref_no, ' +
    '       jl.debit, jl.credit, jl.description, jl.party_type, jl.party_id, jl.bank_account_id ' +
    'FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY je.date, je.entry_no, jl.id';
  const rows = db.prepare(sql).all(...args);
  const acc = db.prepare('SELECT * FROM accounts WHERE code=?').get(code);
  const side = acc ? acc.normal_side : 'debit';

  let opening = 0;
  if (o.from) {
    const owhere = ['jl.account_code = ?', 'je.date < ?'];
    const oargs = [code, o.from];
    if (o.bank_account_id) { owhere.push('jl.bank_account_id = ?'); oargs.push(o.bank_account_id); }
    if (o.party_type) { owhere.push('jl.party_type = ?'); oargs.push(o.party_type); }
    if (o.party_id) { owhere.push('jl.party_id = ?'); oargs.push(o.party_id); }
    const osql = 'SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c FROM journal_lines jl ' +
      'JOIN journal_entries je ON je.id=jl.entry_id WHERE ' + owhere.join(' AND ');
    const orow = db.prepare(osql).get(...oargs);
    opening = side === 'debit' ? orow.d - orow.c : orow.c - orow.d;
  }

  let running = opening;
  for (const r of rows) {
    running += side === 'debit' ? (r.debit - r.credit) : (r.credit - r.debit);
    r.balance = running;
  }
  return { account: acc, opening: opening, rows: rows, closing: running };
}

module.exports = {
  ACC: C.ACC,
  post: post,
  setRef: setRef,
  deleteByRef: deleteByRef,
  deleteEntry: deleteEntry,
  accountBalance: accountBalance,
  trialBalance: trialBalance,
  journal: journal,
  ledger: ledger,
  nextEntryNo: nextEntryNo
};
