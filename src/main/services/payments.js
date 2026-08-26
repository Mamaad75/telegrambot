'use strict';
/**
 * دریافت از مشتری و پرداخت به تأمین‌کننده (تسویه حساب).
 * پس از ثبت، مبلغ به صورت خودکار روی قدیمی‌ترین فاکتورهای باز طرف حساب تخصیص می‌یابد.
 */
const { AppError, assert } = require('../util/errors');
const { r } = require('../util/money');
const { todayIso } = require('../util/jalali');
const accounting = require('./accounting');
const invoices = require('./invoices');

const ACC = accounting.ACC;

function allocate(db, partyId, kind, amount, sign) {
  // kind receipt ⇒ فاکتورهای فروش، payment ⇒ فاکتورهای خرید
  const type = kind === 'receipt' ? 'sale' : 'purchase';
  let remain = amount;
  const open = db.prepare(`SELECT id, due, paid FROM invoices
    WHERE party_id=? AND type=? AND status='posted' AND due > 0 ORDER BY date, id`).all(partyId, type);
  for (const inv of open) {
    if (remain <= 0) break;
    const use = Math.min(inv.due, remain);
    db.prepare('UPDATE invoices SET paid=paid+?, due=due-? WHERE id=?').run(use, use, inv.id);
    remain -= use;
  }
  return amount - remain;
}

function unallocate(db, partyId, kind, amount) {
  const type = kind === 'receipt' ? 'sale' : 'purchase';
  let remain = amount;
  const paidInv = db.prepare(`SELECT id, due, paid, total FROM invoices
    WHERE party_id=? AND type=? AND status='posted' AND paid > 0 ORDER BY date DESC, id DESC`).all(partyId, type);
  for (const inv of paidInv) {
    if (remain <= 0) break;
    const use = Math.min(inv.paid, remain);
    db.prepare('UPDATE invoices SET paid=paid-?, due=due+? WHERE id=?').run(use, use, inv.id);
    remain -= use;
  }
}

function create(db, payload) {
  const run = db.transaction(() => {
    const kind = payload.kind === 'payment' ? 'payment' : 'receipt';
    const date = payload.date || todayIso();
    const partyId = payload.party_id ? Number(payload.party_id) : null;
    assert(partyId, 'انتخاب طرف حساب الزامی است.');
    const party = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
    if (!party) throw new AppError('طرف حساب یافت نشد.', 'NO_PARTY');
    const expected = kind === 'receipt' ? 'customer' : 'supplier';
    if (party.type !== expected) throw new AppError('نوع طرف حساب با نوع سند همخوانی ندارد.', 'BAD_PARTY');

    const rawLines = Array.isArray(payload.lines) && payload.lines.length
      ? payload.lines
      : [{ method: payload.method || 'cash', amount: payload.amount, check: payload.check }];
    const lines = rawLines.map((l) => ({ ...l, amount: Math.max(0, r(l.amount)) }))
      .filter((l) => l.amount > 0 && l.method && l.method !== 'credit');
    assert(lines.length > 0, 'مبلغ سند باید بزرگ‌تر از صفر باشد.');
    const amount = lines.reduce((a, l) => a + l.amount, 0);

    const direction = kind === 'receipt' ? 'in' : 'out';
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO payments(kind,date,party_id,party_name,amount,description,status,entry_id,created_at)
      VALUES (?,?,?,?,?,?,'posted',NULL,?)`)
      .run(kind, date, partyId, party.name, amount, String(payload.description || ''), now);
    const paymentId = Number(info.lastInsertRowid);

    const entryLines = [];
    for (const l of lines) {
      const acc = invoices.settlementAccount(l.method, direction);
      let checkId = null;
      if (l.method === 'check') {
        const chk = l.check || {};
        const ci = db.prepare(`INSERT INTO checks
          (kind,number,bank,branch,party_id,party_name,amount,issue_date,due_date,status,doc_type,doc_id,notes,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,'pending','payment',?,?,?)`)
          .run(direction === 'in' ? 'received' : 'paid', String(chk.number || ''), String(chk.bank || ''),
            String(chk.branch || ''), partyId, party.name, l.amount, chk.issue_date || date,
            chk.due_date || date, paymentId, String(chk.notes || ''), now);
        checkId = Number(ci.lastInsertRowid);
        db.prepare(`INSERT INTO check_events(check_id,date,from_status,to_status,entry_id,notes,created_at)
                    VALUES (?,?,'','pending',NULL,?,?)`).run(checkId, date, 'ثبت اولیه چک', now);
      }
      db.prepare(`INSERT INTO payment_lines(doc_type,doc_id,direction,method,account_code,amount,check_id,date,description)
                  VALUES ('payment',?,?,?,?,?,?,?,?)`)
        .run(paymentId, direction, l.method, acc, l.amount, checkId, date, l.description || '');
      if (direction === 'in') entryLines.push({ account: acc, debit: l.amount, description: accounting.METHOD_LABELS[l.method] });
      else entryLines.push({ account: acc, credit: l.amount, description: accounting.METHOD_LABELS[l.method] });
    }

    if (kind === 'receipt') {
      entryLines.push({ account: ACC.RECEIVABLE, credit: amount, partyId, description: 'دریافت از مشتری' });
    } else {
      entryLines.push({ account: ACC.PAYABLE, debit: amount, partyId, description: 'پرداخت به تأمین‌کننده' });
    }

    const entryId = accounting.postEntry(db, {
      date, refType: kind, refId: paymentId,
      description: `${kind === 'receipt' ? 'دریافت از' : 'پرداخت به'} ${party.name}`,
      lines: entryLines,
    });
    db.prepare('UPDATE payments SET entry_id=? WHERE id=?').run(entryId, paymentId);
    allocate(db, partyId, kind, amount);
    return paymentId;
  });
  const id = run();
  return get(db, id);
}

function get(db, id) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw new AppError('سند دریافت/پرداخت یافت نشد.', 'NO_PAYMENT');
  const lines = db.prepare(`SELECT pl.*, c.number check_number, c.bank check_bank, c.due_date check_due, c.status check_status
    FROM payment_lines pl LEFT JOIN checks c ON c.id=pl.check_id
    WHERE pl.doc_type='payment' AND pl.doc_id=?`).all(id);
  return { payment: p, lines };
}

function list(db, filter = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.kind) { where += ' AND p.kind=@kind'; params.kind = filter.kind; }
  if (filter.partyId) { where += ' AND p.party_id=@pid'; params.pid = Number(filter.partyId); }
  if (filter.from) { where += ' AND p.date>=@from'; params.from = filter.from; }
  if (filter.to) { where += ' AND p.date<=@to'; params.to = filter.to; }
  if (filter.q) { where += ' AND (p.party_name LIKE @q OR p.description LIKE @q)'; params.q = '%' + filter.q + '%'; }
  const limit = Math.min(Number(filter.limit) || 200, 2000);
  const offset = Number(filter.offset) || 0;
  const rows = db.prepare(`SELECT p.*, (SELECT group_concat(method) FROM payment_lines
       WHERE doc_type='payment' AND doc_id=p.id) methods
     FROM payments p ${where} ORDER BY p.date DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  const agg = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) total FROM payments p ${where} AND p.status='posted'`).get(params);
  return { rows, total: agg.c, summary: agg };
}

function voidPayment(db, id) {
  const run = db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
    if (!p) throw new AppError('سند یافت نشد.', 'NO_PAYMENT');
    if (p.status === 'void') throw new AppError('این سند قبلاً ابطال شده است.', 'ALREADY_VOID');
    const checks = db.prepare("SELECT * FROM checks WHERE doc_type='payment' AND doc_id=?").all(id);
    for (const c of checks) {
      if (c.status !== 'pending' && c.status !== 'cancelled') {
        throw new AppError(`چک شماره ${c.number} تعیین تکلیف شده و امکان ابطال وجود ندارد.`, 'CHECK_SETTLED');
      }
    }
    const date = todayIso();
    if (p.entry_id) accounting.reverseEntry(db, p.entry_id, date, 'ابطال سند دریافت/پرداخت');
    for (const c of checks) {
      db.prepare("UPDATE checks SET status='cancelled' WHERE id=?").run(c.id);
      db.prepare(`INSERT INTO check_events(check_id,date,from_status,to_status,entry_id,notes,created_at)
                  VALUES (?,?,?,'cancelled',NULL,'ابطال سند',?)`).run(c.id, date, c.status, new Date().toISOString());
    }
    unallocate(db, p.party_id, p.kind, p.amount);
    db.prepare("UPDATE payments SET status='void' WHERE id=?").run(id);
    return id;
  });
  return get(db, run());
}

module.exports = { create, get, list, voidPayment, allocate, unallocate };
