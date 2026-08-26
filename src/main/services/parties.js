'use strict';
const { AppError, assert } = require('../util/errors');
const { r } = require('../util/money');
const { todayIso } = require('../util/jalali');
const accounting = require('./accounting');

const ACC_OF = { customer: accounting.ACC.RECEIVABLE, supplier: accounting.ACC.PAYABLE };

function normalize(p) {
  return {
    type: p.type === 'supplier' ? 'supplier' : 'customer',
    name: String(p.name || '').trim(),
    phone: String(p.phone || '').trim(),
    national_id: String(p.national_id || '').trim(),
    address: String(p.address || '').trim(),
    notes: String(p.notes || '').trim(),
    active: p.active === 0 || p.active === false ? 0 : 1,
  };
}

/**
 * فهرست طرف حساب‌ها همراه با مانده حساب (از دفتر روزنامه).
 * مانده مثبت برای مشتری = طلب ما از او؛ برای تأمین‌کننده = بدهی ما به او.
 */
function list(db, filter = {}) {
  const params = { code: ACC_OF[filter.type === 'supplier' ? 'supplier' : 'customer'] };
  let where = 'WHERE p.type=@type';
  params.type = filter.type === 'supplier' ? 'supplier' : 'customer';
  if (filter.q) {
    where += ' AND (p.name LIKE @q OR p.phone LIKE @q OR p.national_id LIKE @q)';
    params.q = '%' + String(filter.q).trim() + '%';
  }
  if (filter.onlyActive !== false) where += ' AND p.active=1';
  const sign = params.type === 'customer' ? '' : '-';
  const limit = Math.min(Number(filter.limit) || 300, 3000);
  const offset = Number(filter.offset) || 0;
  const rows = db.prepare(`
    SELECT p.*, ${sign}(COALESCE(b.debit,0)-COALESCE(b.credit,0)) AS balance
    FROM parties p
    LEFT JOIN (
      SELECT party_id, SUM(debit) debit, SUM(credit) credit
      FROM journal_lines WHERE account_code=@code AND party_id IS NOT NULL GROUP BY party_id
    ) b ON b.party_id=p.id
    ${where} ORDER BY p.name LIMIT ${limit} OFFSET ${offset}`).all(params);
  const total = db.prepare(`SELECT COUNT(*) c FROM parties p ${where}`).get(params).c;
  return { rows, total };
}

function get(db, id) {
  const p = db.prepare('SELECT * FROM parties WHERE id=?').get(id);
  if (!p) throw new AppError('طرف حساب یافت نشد.', 'NO_PARTY');
  return { ...p, balance: accounting.partyBalance(db, id) };
}

function search(db, type, q, limit = 20) {
  const term = String(q || '').trim();
  const t = type === 'supplier' ? 'supplier' : 'customer';
  if (!term) return db.prepare('SELECT * FROM parties WHERE type=? AND active=1 ORDER BY name LIMIT ?').all(t, limit);
  return db.prepare(`SELECT * FROM parties WHERE type=? AND active=1 AND (name LIKE ? OR phone LIKE ?)
                     ORDER BY name LIMIT ?`).all(t, '%' + term + '%', '%' + term + '%', limit);
}

function create(db, payload) {
  const p = normalize(payload);
  assert(p.name, 'نام طرف حساب الزامی است.');
  const info = db.prepare(`INSERT INTO parties(type,name,phone,national_id,address,notes,active,created_at)
      VALUES (@type,@name,@phone,@national_id,@address,@notes,@active,@now)`)
    .run({ ...p, now: new Date().toISOString() });
  const id = Number(info.lastInsertRowid);
  const opening = r(payload.opening_balance || 0);
  if (opening !== 0) setOpeningBalance(db, id, opening, payload.date || todayIso());
  return get(db, id);
}

function update(db, id, payload) {
  const existing = get(db, id);
  const p = normalize({ ...existing, ...payload, type: existing.type });
  assert(p.name, 'نام طرف حساب الزامی است.');
  db.prepare(`UPDATE parties SET name=@name, phone=@phone, national_id=@national_id,
      address=@address, notes=@notes, active=@active WHERE id=@id`).run({ ...p, id });
  return get(db, id);
}

function remove(db, id) {
  const p = get(db, id);
  const used = db.prepare('SELECT COUNT(*) c FROM invoices WHERE party_id=?').get(id).c
    + db.prepare('SELECT COUNT(*) c FROM payments WHERE party_id=?').get(id).c
    + db.prepare('SELECT COUNT(*) c FROM journal_lines WHERE party_id=?').get(id).c;
  if (used > 0) {
    db.prepare('UPDATE parties SET active=0 WHERE id=?').run(id);
    return { deleted: false, deactivated: true, name: p.name };
  }
  db.prepare('DELETE FROM parties WHERE id=?').run(id);
  return { deleted: true, deactivated: false, name: p.name };
}

/** ثبت مانده اول دوره طرف حساب در برابر حساب سرمایه */
function setOpeningBalance(db, id, amount, date) {
  const p = db.prepare('SELECT * FROM parties WHERE id=?').get(id);
  if (!p) throw new AppError('طرف حساب یافت نشد.', 'NO_PARTY');
  const amt = Math.abs(r(amount));
  if (!amt) return null;
  const d = date || todayIso();
  const lines = p.type === 'customer'
    ? [{ account: accounting.ACC.RECEIVABLE, debit: amt, partyId: id, description: 'مانده اول دوره' },
      { account: accounting.ACC.EQUITY, credit: amt, description: 'سرمایه - مانده اول دوره مشتری' }]
    : [{ account: accounting.ACC.EQUITY, debit: amt, description: 'سرمایه - مانده اول دوره تأمین‌کننده' },
      { account: accounting.ACC.PAYABLE, credit: amt, partyId: id, description: 'مانده اول دوره' }];
  return accounting.postEntry(db, {
    date: d, refType: 'opening', refId: id,
    description: `مانده اول دوره ${p.name}`, lines,
  });
}

/** خلاصه وضعیت مالی و سوابق یک طرف حساب */
function profile(db, id, opts = {}) {
  const p = get(db, id);
  const isCustomer = p.type === 'customer';
  const invType = isCustomer ? 'sale' : 'purchase';
  const retType = isCustomer ? 'sale_return' : 'purchase_return';
  const invoices = db.prepare(`SELECT * FROM invoices WHERE party_id=? AND type IN (?,?)
                               ORDER BY date DESC, id DESC LIMIT 500`).all(id, invType, retType);
  const payments = db.prepare(`SELECT * FROM payments WHERE party_id=? ORDER BY date DESC, id DESC LIMIT 500`).all(id);
  const checks = db.prepare(`SELECT * FROM checks WHERE party_id=? ORDER BY due_date DESC LIMIT 500`).all(id);
  const totals = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type=@inv AND status='posted' THEN total ELSE 0 END),0) invoiced,
           COALESCE(SUM(CASE WHEN type=@ret AND status='posted' THEN total ELSE 0 END),0) returned
    FROM invoices WHERE party_id=@id`).get({ id, inv: invType, ret: retType });
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE party_id=? AND status='posted'`).get(id).v;
  const settledOnInvoice = db.prepare(`
    SELECT COALESCE(SUM(i.paid),0) v FROM invoices i WHERE i.party_id=? AND i.type=? AND i.status='posted'`).get(id, invType).v;
  const statement = accounting.partyStatement(db, id, opts);
  return {
    party: p, invoices, payments, checks,
    totals: {
      invoiced: totals.invoiced, returned: totals.returned,
      payments: paid + settledOnInvoice, balance: p.balance,
    },
    statement,
  };
}

module.exports = { list, get, search, create, update, remove, profile, setOpeningBalance, ACC_OF };
