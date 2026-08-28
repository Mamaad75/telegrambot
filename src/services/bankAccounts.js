'use strict';
/*
 * حساب‌های بانکی و پایانه‌های فروشگاهی (کارتخوان).
 * هر حساب یک «معین» زیر حساب کل ۱۰۳ (بانک) یا ۱۰۲ (کارتخوان) است و مانده آن
 * از روی ردیف‌های دفتر روزنامه با همان bank_account_id محاسبه می‌شود.
 */
const journal = require('./journal.js');
const C = require('../shared/constants.js');
const Fmt = require('../shared/format.js');

function accountCodeOf(kind) {
  return kind === 'pos' ? C.ACC.POS : C.ACC.BANK;
}

function normalizeDigits(s) {
  if (!s) return null;
  const v = Fmt.toEnDigits(String(s)).replace(/[^0-9]/g, '');
  return v || null;
}

function normalizeIban(s) {
  if (!s) return null;
  let v = Fmt.toEnDigits(String(s)).toUpperCase().replace(/[\s-]/g, '');
  if (/^\d{24}$/.test(v)) v = 'IR' + v;
  return v || null;
}

function validate(data, isNew) {
  const errors = [];
  if (!data.title || !String(data.title).trim()) errors.push('عنوان حساب الزامی است.');
  if (data.card_number) {
    const c = normalizeDigits(data.card_number);
    if (c && c.length !== 16) errors.push('شماره کارت باید ۱۶ رقم باشد.');
  }
  if (data.iban) {
    const i = normalizeIban(data.iban);
    if (i && !/^IR\d{24}$/.test(i)) errors.push('شماره شبا باید با IR و ۲۴ رقم باشد.');
  }
  if (data.kind && ['bank', 'pos'].indexOf(data.kind) === -1) errors.push('نوع حساب نامعتبر است.');
  if (isNew && data.opening_balance && isNaN(Number(data.opening_balance))) errors.push('مانده اولیه نامعتبر است.');
  return errors;
}

function list(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.kind) { where.push('kind = ?'); args.push(o.kind); }
  if (o.active !== undefined && o.active !== null && o.active !== '') { where.push('active = ?'); args.push(o.active ? 1 : 0); }
  if (o.search) {
    where.push('(title LIKE ? OR bank_name LIKE ? OR account_number LIKE ? OR card_number LIKE ? OR iban LIKE ? OR owner_name LIKE ?)');
    const s = '%' + o.search + '%';
    args.push(s, s, s, s, s, s);
  }
  const sql = 'SELECT * FROM bank_accounts ' + (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY is_default DESC, kind, title';
  const rows = db.prepare(sql).all(...args);
  for (const r of rows) {
    r.balance = journal.accountBalance(db, accountCodeOf(r.kind), { bank_account_id: r.id, to: o.to || null });
    r.account_code = accountCodeOf(r.kind);
    r.kind_label = r.kind === 'pos' ? 'کارتخوان' : 'حساب بانکی';
  }
  return rows;
}

function get(db, id) {
  const r = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(id);
  if (!r) return null;
  r.balance = journal.accountBalance(db, accountCodeOf(r.kind), { bank_account_id: r.id });
  r.account_code = accountCodeOf(r.kind);
  r.kind_label = r.kind === 'pos' ? 'کارتخوان' : 'حساب بانکی';
  return r;
}

function create(db, data) {
  const errors = validate(data, true);
  if (errors.length) throw new Error(errors.join(' '));
  const kind = data.kind === 'pos' ? 'pos' : 'bank';
  const opening = Math.round(Number(data.opening_balance) || 0);
  const date = data.date || require('../shared/jalali.js').todayIso();

  const tx = db.transaction(function () {
    const info = db.prepare(
      'INSERT INTO bank_accounts (title, kind, bank_name, branch, account_number, card_number, iban, owner_name, opening_balance, is_default, active, note) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      String(data.title).trim(), kind, data.bank_name || null, data.branch || null,
      normalizeDigits(data.account_number) || (data.account_number || null),
      normalizeDigits(data.card_number), normalizeIban(data.iban),
      data.owner_name || null, opening, data.is_default ? 1 : 0,
      data.active === 0 || data.active === false ? 0 : 1, data.note || null
    );
    const id = info.lastInsertRowid;
    if (data.is_default) setDefault(db, id, kind);

    if (opening !== 0) {
      const code = accountCodeOf(kind);
      const lines = opening > 0
        ? [{ account: code, debit: opening, bank_account_id: id, description: 'مانده اولیه' },
           { account: C.ACC.EQUITY, credit: opening, description: 'سرمایه اولیه - ' + data.title }]
        : [{ account: C.ACC.EQUITY, debit: -opening, description: 'برداشت اولیه - ' + data.title },
           { account: code, credit: -opening, bank_account_id: id, description: 'مانده اولیه' }];
      journal.post(db, {
        date: date, description: 'مانده اولیه حساب ' + data.title,
        ref_type: 'bank_opening', ref_id: id, lines: lines
      });
    }
    return id;
  });
  const id = tx();
  return get(db, id);
}

function setDefault(db, id, kind) {
  db.prepare('UPDATE bank_accounts SET is_default = 0 WHERE kind = ?').run(kind);
  db.prepare('UPDATE bank_accounts SET is_default = 1 WHERE id = ?').run(id);
}

function update(db, id, data) {
  const existing = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(id);
  if (!existing) throw new Error('حساب بانکی یافت نشد.');
  const errors = validate(Object.assign({}, existing, data), false);
  if (errors.length) throw new Error(errors.join(' '));
  const kind = data.kind === 'pos' ? 'pos' : (data.kind === 'bank' ? 'bank' : existing.kind);

  const tx = db.transaction(function () {
    db.prepare(
      'UPDATE bank_accounts SET title=?, kind=?, bank_name=?, branch=?, account_number=?, card_number=?, iban=?, owner_name=?, active=?, note=? WHERE id=?'
    ).run(
      data.title !== undefined ? String(data.title).trim() : existing.title,
      kind,
      data.bank_name !== undefined ? data.bank_name : existing.bank_name,
      data.branch !== undefined ? data.branch : existing.branch,
      data.account_number !== undefined ? (normalizeDigits(data.account_number) || data.account_number || null) : existing.account_number,
      data.card_number !== undefined ? normalizeDigits(data.card_number) : existing.card_number,
      data.iban !== undefined ? normalizeIban(data.iban) : existing.iban,
      data.owner_name !== undefined ? data.owner_name : existing.owner_name,
      data.active !== undefined ? (data.active ? 1 : 0) : existing.active,
      data.note !== undefined ? data.note : existing.note,
      id
    );
    if (data.is_default) setDefault(db, id, kind);
    // اگر نوع حساب عوض شد، ردیف‌های دفتر هم باید به حساب کل جدید منتقل شوند
    if (kind !== existing.kind) {
      db.prepare('UPDATE journal_lines SET account_code=? WHERE bank_account_id=? AND account_code=?')
        .run(accountCodeOf(kind), id, accountCodeOf(existing.kind));
    }
  });
  tx();
  return get(db, id);
}

/** حذف فقط وقتی مجاز است که هیچ گردشی نداشته باشد؛ در غیر این‌صورت غیرفعال می‌شود */
function remove(db, id) {
  // گردش واقعی = ردیف‌های دفتر این حساب، به‌جز سند مانده اولیه خودش
  const activity = db.prepare(
    'SELECT COUNT(*) c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id ' +
    'WHERE jl.bank_account_id = ? AND NOT (je.ref_type = \'bank_opening\' AND je.ref_id = ?)'
  ).get(id, id).c;
  if (activity > 0) {
    throw new Error('این حساب دارای گردش مالی است و قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید.');
  }
  const linked = db.prepare(
    'SELECT (SELECT COUNT(*) FROM payment_lines WHERE bank_account_id=?) + ' +
    '       (SELECT COUNT(*) FROM checks WHERE bank_account_id=?) AS c'
  ).get(id, id).c;
  if (linked > 0) {
    throw new Error('این حساب به اسناد دیگری متصل است و قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید.');
  }
  const tx = db.transaction(function () {
    db.prepare('DELETE FROM journal_entries WHERE ref_type=\'bank_opening\' AND ref_id=?').run(id);
    db.prepare('DELETE FROM bank_accounts WHERE id=?').run(id);
  });
  tx();
  return true;
}

function deactivate(db, id) {
  db.prepare('UPDATE bank_accounts SET active=0 WHERE id=?').run(id);
  return true;
}

/** گردش حساب یک حساب بانکی */
function statement(db, id, opt) {
  const acc = get(db, id);
  if (!acc) throw new Error('حساب بانکی یافت نشد.');
  const led = journal.ledger(db, acc.account_code, Object.assign({}, opt || {}, { bank_account_id: id }));
  return { account: acc, opening: led.opening, rows: led.rows, closing: led.closing };
}

/** مانده کل صندوق، کارتخوان‌ها و بانک‌ها */
function balances(db, to) {
  const cash = journal.accountBalance(db, C.ACC.CASH, { to: to });
  const pos = journal.accountBalance(db, C.ACC.POS, { to: to });
  const bank = journal.accountBalance(db, C.ACC.BANK, { to: to });
  return { cash: cash, pos: pos, bank: bank, total: cash + pos + bank };
}

/** حساب پیش‌فرض برای یک روش پرداخت */
function defaultFor(db, method) {
  const kind = method === 'pos' ? 'pos' : 'bank';
  return db.prepare('SELECT * FROM bank_accounts WHERE kind=? AND active=1 ORDER BY is_default DESC, id LIMIT 1').get(kind) || null;
}

module.exports = {
  accountCodeOf: accountCodeOf,
  list: list, get: get, create: create, update: update, remove: remove,
  deactivate: deactivate, statement: statement, balances: balances,
  defaultFor: defaultFor, setDefault: setDefault, validate: validate
};
