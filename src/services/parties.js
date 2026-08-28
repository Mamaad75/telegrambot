'use strict';
/*
 * مشتریان و تأمین‌کنندگان.
 * مانده هر طرف‌حساب از دفتر روزنامه خوانده می‌شود (حساب ۱۰۵ برای مشتری و ۲۰۱ برای تأمین‌کننده)
 * بنابراین همیشه با حسابداری هماهنگ است.
 */
const journal = require('./journal.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

const CFG = {
  customer: { table: 'customers', account: C.ACC.RECEIVABLE, label: 'مشتری' },
  supplier: { table: 'suppliers', account: C.ACC.PAYABLE, label: 'تأمین‌کننده' }
};

function cfg(type) {
  const c = CFG[type];
  if (!c) throw new Error('نوع طرف‌حساب نامعتبر است.');
  return c;
}

function balance(db, type, id, to) {
  const c = cfg(type);
  return journal.accountBalance(db, c.account, { party_type: type, party_id: id, to: to });
}

function list(db, type, opt) {
  const c = cfg(type);
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.search) {
    where.push('(name LIKE ? OR phone LIKE ? OR national_id LIKE ? OR address LIKE ?)');
    const s = '%' + o.search + '%';
    args.push(s, s, s, s);
  }
  if (o.active !== undefined && o.active !== null && o.active !== '') { where.push('active = ?'); args.push(o.active ? 1 : 0); }
  const sql = 'SELECT * FROM ' + c.table + ' ' + (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY name LIMIT ? OFFSET ?';
  args.push(o.limit || 500, o.offset || 0);
  const rows = db.prepare(sql).all(...args);
  if (o.withBalance !== false) {
    for (const r of rows) r.balance = balance(db, type, r.id);
  }
  return rows;
}

function get(db, type, id) {
  const c = cfg(type);
  const r = db.prepare('SELECT * FROM ' + c.table + ' WHERE id=?').get(id);
  if (!r) return null;
  r.balance = balance(db, type, id);
  r.party_type = type;
  return r;
}

function create(db, type, data) {
  const c = cfg(type);
  if (!data.name || !String(data.name).trim()) throw new Error('نام ' + c.label + ' الزامی است.');
  const opening = Math.round(Number(data.opening_balance) || 0);
  const date = data.date || Jalali.todayIso();
  const tx = db.transaction(function () {
    const info = db.prepare(
      'INSERT INTO ' + c.table + ' (name, phone, national_id, economic_code, address, note, opening_balance, active) ' +
      'VALUES (?,?,?,?,?,?,?,?)'
    ).run(String(data.name).trim(), data.phone || null, data.national_id || null, data.economic_code || null,
      data.address || null, data.note || null, opening, data.active === 0 ? 0 : 1);
    const id = info.lastInsertRowid;
    if (opening !== 0) postOpening(db, type, id, String(data.name).trim(), opening, date);
    return id;
  });
  return get(db, type, tx());
}

function postOpening(db, type, id, name, opening, date) {
  const c = cfg(type);
  let lines;
  if (type === 'customer') {
    lines = opening > 0
      ? [{ account: C.ACC.RECEIVABLE, debit: opening, party_type: type, party_id: id, description: 'مانده اولیه' },
         { account: C.ACC.EQUITY, credit: opening, description: 'مانده اولیه مشتری ' + name }]
      : [{ account: C.ACC.EQUITY, debit: -opening, description: 'مانده اولیه مشتری ' + name },
         { account: C.ACC.RECEIVABLE, credit: -opening, party_type: type, party_id: id, description: 'مانده اولیه' }];
  } else {
    lines = opening > 0
      ? [{ account: C.ACC.EQUITY, debit: opening, description: 'مانده اولیه تأمین‌کننده ' + name },
         { account: C.ACC.PAYABLE, credit: opening, party_type: type, party_id: id, description: 'مانده اولیه' }]
      : [{ account: C.ACC.PAYABLE, debit: -opening, party_type: type, party_id: id, description: 'مانده اولیه' },
         { account: C.ACC.EQUITY, credit: -opening, description: 'مانده اولیه تأمین‌کننده ' + name }];
  }
  return journal.post(db, {
    date: date, description: 'مانده اولیه ' + c.label + ' ' + name,
    ref_type: type + '_opening', ref_id: id, lines: lines
  });
}

function update(db, type, id, data) {
  const c = cfg(type);
  const cur = db.prepare('SELECT * FROM ' + c.table + ' WHERE id=?').get(id);
  if (!cur) throw new Error(c.label + ' یافت نشد.');
  const opening = data.opening_balance !== undefined ? Math.round(Number(data.opening_balance) || 0) : cur.opening_balance;
  const tx = db.transaction(function () {
    db.prepare(
      'UPDATE ' + c.table + ' SET name=?, phone=?, national_id=?, economic_code=?, address=?, note=?, opening_balance=?, active=? WHERE id=?'
    ).run(
      data.name !== undefined ? String(data.name).trim() : cur.name,
      data.phone !== undefined ? data.phone : cur.phone,
      data.national_id !== undefined ? data.national_id : cur.national_id,
      data.economic_code !== undefined ? data.economic_code : cur.economic_code,
      data.address !== undefined ? data.address : cur.address,
      data.note !== undefined ? data.note : cur.note,
      opening,
      data.active !== undefined ? (data.active ? 1 : 0) : cur.active,
      id
    );
    if (opening !== cur.opening_balance) {
      journal.deleteByRef(db, type + '_opening', id);
      if (opening !== 0) {
        postOpening(db, type, id, data.name !== undefined ? String(data.name).trim() : cur.name, opening,
          data.date || Jalali.todayIso());
      }
    }
  });
  tx();
  return get(db, type, id);
}

function hasDocuments(db, type, id) {
  if (type === 'customer') {
    const a = db.prepare('SELECT COUNT(*) c FROM sales_invoices WHERE customer_id=?').get(id).c;
    const b = db.prepare('SELECT COUNT(*) c FROM payments WHERE party_type=\'customer\' AND party_id=?').get(id).c;
    const d = db.prepare('SELECT COUNT(*) c FROM sales_returns WHERE customer_id=?').get(id).c;
    return a + b + d > 0;
  }
  const a = db.prepare('SELECT COUNT(*) c FROM purchase_invoices WHERE supplier_id=?').get(id).c;
  const b = db.prepare('SELECT COUNT(*) c FROM payments WHERE party_type=\'supplier\' AND party_id=?').get(id).c;
  const d = db.prepare('SELECT COUNT(*) c FROM purchase_returns WHERE supplier_id=?').get(id).c;
  return a + b + d > 0;
}

function remove(db, type, id) {
  const c = cfg(type);
  if (hasDocuments(db, type, id)) {
    throw new Error('این ' + c.label + ' دارای سند است و حذف نمی‌شود؛ می‌توانید آن را غیرفعال کنید.');
  }
  const tx = db.transaction(function () {
    journal.deleteByRef(db, type + '_opening', id);
    db.prepare('DELETE FROM ' + c.table + ' WHERE id=?').run(id);
  });
  tx();
  return true;
}

function deactivate(db, type, id) {
  const c = cfg(type);
  db.prepare('UPDATE ' + c.table + ' SET active=0 WHERE id=?').run(id);
  return true;
}

/** صورت‌حساب طرف‌حساب (گردش + مانده تجمعی) */
function statement(db, type, id, opt) {
  const c = cfg(type);
  const party = get(db, type, id);
  if (!party) throw new Error(c.label + ' یافت نشد.');
  const led = journal.ledger(db, c.account, Object.assign({}, opt || {}, { party_type: type, party_id: id }));
  for (const r of led.rows) r.date_jalali = Jalali.isoToJalali(r.date);
  return { party: party, opening: led.opening, rows: led.rows, closing: led.closing, account: led.account };
}

/** خلاصه عملکرد طرف‌حساب */
function summary(db, type, id, opt) {
  const o = opt || {};
  const args = [id];
  let dateWhere = '';
  if (o.from) { dateWhere += ' AND date >= ?'; args.push(o.from); }
  if (o.to) { dateWhere += ' AND date <= ?'; args.push(o.to); }

  if (type === 'customer') {
    const sales = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM sales_invoices WHERE customer_id=? AND status=\'active\'' + dateWhere).get(...args);
    const rets = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM sales_returns WHERE customer_id=? AND status=\'active\'' + dateWhere).get(...args);
    const pays = db.prepare('SELECT COALESCE(SUM(CASE WHEN direction=\'in\' THEN total ELSE -total END),0) s FROM payments WHERE party_type=\'customer\' AND party_id=?' + dateWhere).get(...args);
    return {
      invoices: sales.n, total_sales: sales.s, returns_count: rets.n, total_returns: rets.s,
      total_payments: pays.s, balance: balance(db, type, id)
    };
  }
  const purch = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM purchase_invoices WHERE supplier_id=? AND status=\'active\'' + dateWhere).get(...args);
  const rets = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM purchase_returns WHERE supplier_id=? AND status=\'active\'' + dateWhere).get(...args);
  const pays = db.prepare('SELECT COALESCE(SUM(CASE WHEN direction=\'out\' THEN total ELSE -total END),0) s FROM payments WHERE party_type=\'supplier\' AND party_id=?' + dateWhere).get(...args);
  return {
    invoices: purch.n, total_purchases: purch.s, returns_count: rets.n, total_returns: rets.s,
    total_payments: pays.s, balance: balance(db, type, id)
  };
}

/** فهرست مانده‌ها (برای گزارش بدهکاران/بستانکاران) */
function balances(db, type, opt) {
  const c = cfg(type);
  const o = opt || {};
  const rows = db.prepare(
    'SELECT p.id, p.name, p.phone, p.active, ' +
    ' COALESCE(SUM(CASE WHEN jl.debit>0 THEN jl.debit ELSE 0 END),0) AS debit, ' +
    ' COALESCE(SUM(jl.credit),0) AS credit ' +
    'FROM ' + c.table + ' p ' +
    'LEFT JOIN journal_lines jl ON jl.party_type=? AND jl.party_id=p.id AND jl.account_code=? ' +
    'GROUP BY p.id ORDER BY p.name'
  ).all(type, c.account);
  const out = [];
  for (const r of rows) {
    const bal = type === 'customer' ? r.debit - r.credit : r.credit - r.debit;
    if (o.nonZeroOnly && bal === 0) continue;
    out.push({ id: r.id, name: r.name, phone: r.phone, active: r.active, debit: r.debit, credit: r.credit, balance: bal });
  }
  return out;
}

module.exports = {
  list: list, get: get, create: create, update: update, remove: remove, deactivate: deactivate,
  statement: statement, summary: summary, balance: balance, balances: balances, CFG: CFG
};
