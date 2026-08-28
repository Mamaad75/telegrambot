'use strict';
/*
 * دریافت‌ها و پرداخت‌ها (شامل پرداخت ترکیبی).
 * یک سند پرداخت می‌تواند چند ردیف با روش‌های مختلف داشته باشد:
 *   مثال: کل ۱۰٬۰۰۰٬۰۰۰  =  نقد ۲٬۰۰۰٬۰۰۰ + کارتخوان ۵٬۰۰۰٬۰۰۰ + چک ۳٬۰۰۰٬۰۰۰
 * برای هر ردیف چک، یک چک با کد یکتا ساخته و به فاکتور مرتبط می‌شود.
 */
const journal = require('./journal.js');
const settings = require('./settings.js');
const checksSvc = require('./checks.js');
const bankAccounts = require('./bankAccounts.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

const METHODS = ['cash', 'pos', 'bank', 'card', 'check'];

/** حساب کل مربوط به هر روش پرداخت */
function accountForMethod(db, method, bankAccountId, direction) {
  if (method === 'cash') return { code: C.ACC.CASH, bank_account_id: null };
  if (method === 'check') {
    return {
      code: direction === 'in' ? C.ACC.CHECKS_RECEIVABLE : C.ACC.CHECKS_PAYABLE,
      bank_account_id: null
    };
  }
  if (!bankAccountId) {
    const def = bankAccounts.defaultFor(db, method);
    if (!def) throw new Error('برای روش «' + (C.PAY_METHOD_LABEL[method] || method) + '» باید ابتدا یک حساب بانکی یا کارتخوان تعریف کنید.');
    bankAccountId = def.id;
  }
  const ba = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(bankAccountId);
  if (!ba) throw new Error('حساب بانکی انتخاب‌شده یافت نشد.');
  if (method === 'pos' && ba.kind !== 'pos') {
    // اگر کاربر حساب بانکی را برای کارتخوان انتخاب کرده باشد، همان حساب بانکی استفاده می‌شود
    return { code: bankAccounts.accountCodeOf(ba.kind), bank_account_id: ba.id };
  }
  return { code: bankAccounts.accountCodeOf(ba.kind), bank_account_id: ba.id };
}

/** پاک‌سازی و اعتبارسنجی ردیف‌های پرداخت */
function normalizeLines(db, rawLines) {
  const out = [];
  for (const l of (rawLines || [])) {
    const amount = Math.round(Number(l.amount) || 0);
    if (amount === 0) continue;
    if (amount < 0) throw new Error('مبلغ پرداخت نمی‌تواند منفی باشد.');
    if (METHODS.indexOf(l.method) === -1) throw new Error('روش پرداخت نامعتبر است: ' + l.method);
    let bankAccountId = l.bank_account_id || null;
    if (l.method === 'pos' || l.method === 'bank' || l.method === 'card') {
      if (!bankAccountId) {
        const def = bankAccounts.defaultFor(db, l.method);
        if (!def) throw new Error('برای روش «' + C.PAY_METHOD_LABEL[l.method] + '» باید ابتدا حساب بانکی یا کارتخوان تعریف شود.');
        bankAccountId = def.id;
      }
    } else {
      bankAccountId = null;
    }
    if (l.method === 'check') {
      const chk = l.check || {};
      if (!chk.due_date) throw new Error('تاریخ سررسید چک الزامی است.');
    }
    out.push({
      method: l.method,
      amount: amount,
      bank_account_id: bankAccountId,
      check: l.method === 'check' ? (l.check || {}) : null,
      check_id: l.check_id || null,
      note: l.note || null
    });
  }
  return out;
}

function sumLines(lines) {
  return lines.reduce(function (a, l) { return a + l.amount; }, 0);
}

/** ساخت چک‌های مربوط به ردیف‌های پرداخت */
function materializeChecks(db, ctx, lines) {
  for (const l of lines) {
    if (l.method !== 'check') continue;
    if (l.check_id) continue;
    const chk = checksSvc.create(db, {
      direction: ctx.direction === 'in' ? 'received' : 'issued',
      check_number: l.check.check_number,
      sayad_id: l.check.sayad_id,
      bank_name: l.check.bank_name,
      branch: l.check.branch,
      holder_name: l.check.holder_name,
      party_type: ctx.party_type,
      party_id: ctx.party_id,
      amount: l.amount,
      issue_date: l.check.issue_date || ctx.date,
      due_date: l.check.due_date,
      bank_account_id: l.check.bank_account_id || null,
      ref_type: ctx.ref_type,
      ref_id: ctx.ref_id,
      ref_no: ctx.ref_no,
      payment_id: ctx.payment_id,
      date: ctx.date,
      note: l.check.note || l.note
    });
    l.check_id = chk.id;
    l.check_code = chk.check_code;
  }
  return lines;
}

/**
 * ردیف‌های سند حسابداری برای ردیف‌های پرداخت.
 * direction 'in'  => بدهکار کردن حساب‌های نقد/بانک/چک دریافتنی
 * direction 'out' => بستانکار کردن آنها
 */
function journalLinesFor(db, lines, direction, ctx) {
  const out = [];
  for (const l of lines) {
    const acc = accountForMethod(db, l.method, l.bank_account_id, direction);
    const desc = (ctx && ctx.description ? ctx.description + ' - ' : '') + (C.PAY_METHOD_LABEL[l.method] || l.method) +
      (l.check_code ? ' ' + l.check_code : '');
    const line = {
      account: acc.code,
      bank_account_id: acc.bank_account_id,
      description: desc
    };
    if (l.method === 'check') {
      line.party_type = ctx ? ctx.party_type : null;
      line.party_id = ctx ? ctx.party_id : null;
    }
    if (direction === 'in') line.debit = l.amount; else line.credit = l.amount;
    out.push(line);
  }
  return out;
}

function insertPaymentRow(db, p) {
  const info = db.prepare(
    'INSERT INTO payments (payment_no, direction, date, party_type, party_id, ref_type, ref_id, ref_no, total, note, with_invoice) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(p.payment_no, p.direction, p.date, p.party_type || null, p.party_id || null,
    p.ref_type || null, p.ref_id || null, p.ref_no || null, p.total, p.note || null, p.with_invoice ? 1 : 0);
  return info.lastInsertRowid;
}

function insertPaymentLines(db, paymentId, lines) {
  const stmt = db.prepare('INSERT INTO payment_lines (payment_id, method, amount, bank_account_id, check_id, note) VALUES (?,?,?,?,?,?)');
  for (const l of lines) stmt.run(paymentId, l.method, l.amount, l.bank_account_id, l.check_id || null, l.note || null);
}

/**
 * ساخت بخش پرداختِ یک فاکتور (بدون صدور سند مستقل).
 * سند حسابداری فاکتور، ردیف‌های برگشتی این تابع را در خود می‌گیرد.
 */
function attachToDocument(db, ctx, rawLines) {
  const lines = normalizeLines(db, rawLines);
  if (!lines.length) return { payment_id: null, lines: [], total: 0, journal_lines: [] };
  const total = sumLines(lines);
  const docType = ctx.direction === 'in' ? 'receipt' : 'payment';
  const paymentId = insertPaymentRow(db, {
    payment_no: settings.docNumber(db, docType),
    direction: ctx.direction,
    date: ctx.date,
    party_type: ctx.party_type,
    party_id: ctx.party_id,
    ref_type: ctx.ref_type,
    ref_id: ctx.ref_id,
    ref_no: ctx.ref_no,
    total: total,
    note: ctx.note,
    with_invoice: 1
  });
  materializeChecks(db, Object.assign({}, ctx, { payment_id: paymentId }), lines);
  insertPaymentLines(db, paymentId, lines);
  const jl = journalLinesFor(db, lines, ctx.direction, ctx);
  return { payment_id: paymentId, lines: lines, total: total, journal_lines: jl };
}

/** پس از صدور سند فاکتور، شناسه سند روی پرداخت ثبت می‌شود */
function linkEntry(db, paymentId, entryId) {
  if (!paymentId) return;
  db.prepare('UPDATE payments SET journal_entry_id=? WHERE id=?').run(entryId, paymentId);
}

/**
 * ثبت سند مستقل دریافت (از مشتری) یا پرداخت (به تأمین‌کننده).
 * data: { direction, date, party_type, party_id, ref_type, ref_id, ref_no, lines[], note }
 */
function create(db, data) {
  const direction = data.direction === 'out' ? 'out' : 'in';
  const date = data.date || Jalali.todayIso();
  const lines = normalizeLines(db, data.lines);
  if (!lines.length) throw new Error('حداقل یک ردیف پرداخت لازم است.');
  const total = sumLines(lines);
  if (total <= 0) throw new Error('مبلغ سند باید بزرگ‌تر از صفر باشد.');
  if (!data.party_id) throw new Error('طرف حساب مشخص نشده است.');
  const partyType = data.party_type || (direction === 'in' ? 'customer' : 'supplier');

  let refNo = data.ref_no || null;
  if (!refNo && data.ref_type && data.ref_id) {
    const table = { sales_invoice: 'sales_invoices', purchase_invoice: 'purchase_invoices' }[data.ref_type];
    if (table) {
      const r = db.prepare('SELECT invoice_no FROM ' + table + ' WHERE id=?').get(data.ref_id);
      refNo = r ? r.invoice_no : null;
    }
  }

  const tx = db.transaction(function () {
    const paymentId = insertPaymentRow(db, {
      payment_no: settings.docNumber(db, direction === 'in' ? 'receipt' : 'payment'),
      direction: direction, date: date,
      party_type: partyType, party_id: data.party_id,
      ref_type: data.ref_type || null, ref_id: data.ref_id || null, ref_no: refNo,
      total: total, note: data.note, with_invoice: 0
    });
    const ctx = {
      direction: direction, date: date, party_type: partyType, party_id: data.party_id,
      ref_type: data.ref_type || null, ref_id: data.ref_id || null, ref_no: refNo,
      payment_id: paymentId,
      description: direction === 'in' ? 'دریافت از مشتری' : 'پرداخت به تأمین‌کننده'
    };
    materializeChecks(db, ctx, lines);
    insertPaymentLines(db, paymentId, lines);

    const jl = journalLinesFor(db, lines, direction, ctx);
    const partyName = db.prepare('SELECT name FROM ' + (partyType === 'supplier' ? 'suppliers' : 'customers') + ' WHERE id=?')
      .get(data.party_id);
    const desc = (direction === 'in' ? 'دریافت از ' : 'پرداخت به ') + (partyName ? partyName.name : '') +
      (refNo ? ' بابت فاکتور ' + refNo : '');
    // حساب طرف مقابل بر اساس نوع طرف‌حساب تعیین می‌شود، نه جهت سند:
    // مشتری همیشه روی ۱۰۵ و تأمین‌کننده همیشه روی ۲۰۱ می‌نشیند تا استرداد وجه هم درست ثبت شود.
    const counterAccount = partyType === 'supplier' ? C.ACC.PAYABLE : C.ACC.RECEIVABLE;
    const counter = { account: counterAccount, party_type: partyType, party_id: data.party_id, description: desc };
    if (direction === 'in') counter.credit = total; else counter.debit = total;

    const entryId = journal.post(db, {
      date: date, description: desc,
      ref_type: direction === 'in' ? 'receipt' : 'payment_out',
      ref_id: paymentId,
      ref_no: refNo,
      lines: jl.concat([counter])
    });
    linkEntry(db, paymentId, entryId);
    return paymentId;
  });
  const id = tx();
  return get(db, id);
}

function get(db, id) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) return null;
  p.lines = db.prepare(
    'SELECT pl.*, ba.title AS bank_title, ch.check_code, ch.check_number, ch.due_date, ch.status AS check_status, ch.holder_name ' +
    'FROM payment_lines pl LEFT JOIN bank_accounts ba ON ba.id=pl.bank_account_id ' +
    'LEFT JOIN checks ch ON ch.id=pl.check_id WHERE pl.payment_id=? ORDER BY pl.id'
  ).all(id);
  for (const l of p.lines) l.method_label = C.PAY_METHOD_LABEL[l.method] || l.method;
  const table = p.party_type === 'supplier' ? 'suppliers' : 'customers';
  if (p.party_id) {
    const party = db.prepare('SELECT name, phone FROM ' + table + ' WHERE id=?').get(p.party_id);
    p.party_name = party ? party.name : null;
    p.party_phone = party ? party.phone : null;
  }
  p.date_jalali = Jalali.isoToJalali(p.date);
  p.direction_label = p.direction === 'in' ? 'دریافت' : 'پرداخت';
  return p;
}

function list(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.direction) { where.push('p.direction = ?'); args.push(o.direction); }
  if (o.from) { where.push('p.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('p.date <= ?'); args.push(o.to); }
  if (o.party_type) { where.push('p.party_type = ?'); args.push(o.party_type); }
  if (o.party_id) { where.push('p.party_id = ?'); args.push(o.party_id); }
  if (o.ref_type) { where.push('p.ref_type = ?'); args.push(o.ref_type); }
  if (o.ref_id) { where.push('p.ref_id = ?'); args.push(o.ref_id); }
  if (o.method) { where.push('EXISTS (SELECT 1 FROM payment_lines pl WHERE pl.payment_id=p.id AND pl.method=?)'); args.push(o.method); }
  if (o.search) {
    const s = '%' + o.search + '%';
    where.push('(p.payment_no LIKE ? OR p.ref_no LIKE ? OR p.note LIKE ? OR cu.name LIKE ? OR su.name LIKE ?)');
    args.push(s, s, s, s, s);
  }
  const sql =
    'SELECT p.*, COALESCE(cu.name, su.name) AS party_name ' +
    'FROM payments p ' +
    'LEFT JOIN customers cu ON p.party_type=\'customer\' AND cu.id=p.party_id ' +
    'LEFT JOIN suppliers su ON p.party_type=\'supplier\' AND su.id=p.party_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 300, o.offset || 0);
  const rows = db.prepare(sql).all(...args);
  const lineStmt = db.prepare('SELECT method, amount, check_id FROM payment_lines WHERE payment_id=?');
  for (const r of rows) {
    r.date_jalali = Jalali.isoToJalali(r.date);
    r.payment_lines = lineStmt.all(r.id);
    r.methods = r.payment_lines.map(function (l) { return C.PAY_METHOD_LABEL[l.method] || l.method; }).join('، ');
    r.direction_label = r.direction === 'in' ? 'دریافت' : 'پرداخت';
  }
  return rows;
}

/** مجموع پرداخت‌شده برای یک مدرک */
function paidFor(db, refType, refId) {
  const inSum = db.prepare('SELECT COALESCE(SUM(total),0) s FROM payments WHERE ref_type=? AND ref_id=? AND direction=\'in\'').get(refType, refId).s;
  const outSum = db.prepare('SELECT COALESCE(SUM(total),0) s FROM payments WHERE ref_type=? AND ref_id=? AND direction=\'out\'').get(refType, refId).s;
  return { in: inSum, out: outSum, net: inSum - outSum };
}

/** حذف سند پرداخت به همراه سند حسابداری و چک‌های ساخته‌شده */
function remove(db, id) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw new Error('سند پرداخت یافت نشد.');
  const lines = db.prepare('SELECT * FROM payment_lines WHERE payment_id=?').all(id);
  const tx = db.transaction(function () {
    for (const l of lines) {
      if (!l.check_id) continue;
      const ch = db.prepare('SELECT * FROM checks WHERE id=?').get(l.check_id);
      if (!ch) continue;
      if (ch.status !== 'pending') {
        throw new Error('چک ' + ch.check_code + ' دارای وضعیت «' + (C.CHECK_STATUS[ch.status] || ch.status) +
          '» است؛ ابتدا وضعیت آن را بازگردانی کنید.');
      }
      db.prepare('DELETE FROM checks WHERE id=?').run(l.check_id);
    }
    db.prepare('DELETE FROM payment_lines WHERE payment_id=?').run(id);
    db.prepare('DELETE FROM payments WHERE id=?').run(id);
    if (p.journal_entry_id && !p.with_invoice) journal.deleteEntry(db, p.journal_entry_id);
  });
  tx();
  return true;
}

/** حذف تمام پرداخت‌های یک فاکتور (هنگام حذف/ویرایش فاکتور) */
function removeForDocument(db, refType, refId) {
  const rows = db.prepare('SELECT id FROM payments WHERE ref_type=? AND ref_id=?').all(refType, refId);
  for (const r of rows) remove(db, r.id);
  return rows.length;
}

/** جمع دریافت/پرداخت به تفکیک روش در یک بازه */
function methodBreakdown(db, opt) {
  const o = opt || {};
  const args = [];
  const where = [];
  if (o.from) { where.push('p.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('p.date <= ?'); args.push(o.to); }
  if (o.direction) { where.push('p.direction = ?'); args.push(o.direction); }
  const sql = 'SELECT pl.method, p.direction, COUNT(*) n, COALESCE(SUM(pl.amount),0) total ' +
    'FROM payment_lines pl JOIN payments p ON p.id = pl.payment_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'GROUP BY pl.method, p.direction';
  return db.prepare(sql).all(...args).map(function (r) {
    r.method_label = C.PAY_METHOD_LABEL[r.method] || r.method;
    return r;
  });
}

module.exports = {
  METHODS: METHODS,
  normalizeLines: normalizeLines,
  sumLines: sumLines,
  attachToDocument: attachToDocument,
  journalLinesFor: journalLinesFor,
  linkEntry: linkEntry,
  create: create, get: get, list: list, remove: remove,
  removeForDocument: removeForDocument,
  paidFor: paidFor, methodBreakdown: methodBreakdown,
  accountForMethod: accountForMethod
};
