'use strict';
/*
 * مدیریت کامل چک‌ها.
 * هر چک هنگام ثبت یک «کد یکتای سیستمی» می‌گیرد (مثل CHK-R-000012) که هرگز تکرار نمی‌شود
 * و می‌توان بعداً با همان کد، نام دارنده، شماره چک، شماره صیادی یا شماره فاکتور مرتبط آن را پیدا کرد.
 *
 * حسابداری:
 *   چک دریافتی  : هنگام دریافت  بدهکار ۱۰۴ (اسناد دریافتنی)
 *                 وصول          بدهکار بانک/صندوق ، بستانکار ۱۰۴
 *                 برگشت         بدهکار ۱۰۵ (حساب مشتری) ، بستانکار ۱۰۴ یا بانک
 *   چک صادره    : هنگام صدور    بستانکار ۲۰۳ (اسناد پرداختنی)
 *                 پاس شدن       بدهکار ۲۰۳ ، بستانکار بانک/صندوق
 *                 برگشت/ابطال   بدهکار ۲۰۳ ، بستانکار ۲۰۱ (حساب تأمین‌کننده)
 */
const journal = require('./journal.js');
const settings = require('./settings.js');
const bankAccounts = require('./bankAccounts.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');
const Fmt = require('../shared/format.js');

const RECEIVED_FLOW = {
  pending: ['deposited', 'cleared', 'returned', 'cancelled'],
  deposited: ['cleared', 'returned', 'pending'],
  cleared: ['returned'],
  returned: ['cleared', 'cancelled'],
  cancelled: []
};

const ISSUED_FLOW = {
  pending: ['paid', 'returned', 'cancelled'],
  paid: ['returned'],
  returned: ['paid', 'cancelled'],
  cancelled: []
};

function flowFor(direction) { return direction === 'issued' ? ISSUED_FLOW : RECEIVED_FLOW; }

function partyName(db, partyType, partyId) {
  if (!partyType || !partyId) return null;
  const table = partyType === 'supplier' ? 'suppliers' : 'customers';
  const r = db.prepare('SELECT name FROM ' + table + ' WHERE id=?').get(partyId);
  return r ? r.name : null;
}

function decorate(db, c) {
  if (!c) return c;
  c.status_label = C.CHECK_STATUS[c.status] || c.status;
  c.direction_label = C.CHECK_DIRECTION[c.direction] || c.direction;
  c.party_name = c.party_name || partyName(db, c.party_type, c.party_id);
  c.due_date_jalali = c.due_date ? Jalali.isoToJalali(c.due_date) : '';
  c.issue_date_jalali = c.issue_date ? Jalali.isoToJalali(c.issue_date) : '';
  const openStatuses = c.direction === 'issued' ? ['pending'] : ['pending', 'deposited'];
  c.is_open = openStatuses.indexOf(c.status) !== -1;
  c.days_to_due = c.due_date ? Jalali.isoDiffDays(c.due_date, Jalali.todayIso()) : null;
  c.is_overdue = !!(c.is_open && c.due_date && c.days_to_due < 0);
  if (c.bank_account_id) {
    const ba = db.prepare('SELECT title, bank_name FROM bank_accounts WHERE id=?').get(c.bank_account_id);
    c.bank_account_title = ba ? ba.title : null;
  }
  return c;
}

/**
 * ثبت چک جدید. معمولاً از سرویس دریافت/پرداخت فراخوانی می‌شود.
 * سند حسابداری اولیه چک توسط همان سرویس (payments) صادر می‌شود.
 */
function create(db, data) {
  if (!data.amount || Number(data.amount) <= 0) throw new Error('مبلغ چک باید بزرگ‌تر از صفر باشد.');
  const direction = data.direction === 'issued' ? 'issued' : 'received';
  const code = settings.checkCode(db, direction);
  const info = db.prepare(
    'INSERT INTO checks (check_code, direction, check_number, sayad_id, bank_name, branch, holder_name, party_type, party_id, ' +
    ' amount, issue_date, due_date, status, bank_account_id, ref_type, ref_id, ref_no, payment_id, note) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    code, direction,
    data.check_number ? Fmt.toEnDigits(String(data.check_number)) : null,
    data.sayad_id ? Fmt.toEnDigits(String(data.sayad_id)) : null,
    data.bank_name || null, data.branch || null,
    data.holder_name || partyName(db, data.party_type, data.party_id) || null,
    data.party_type || null, data.party_id || null,
    Math.round(Number(data.amount)),
    data.issue_date || null, data.due_date || null,
    'pending',
    data.bank_account_id || null,
    data.ref_type || null, data.ref_id || null, data.ref_no || null,
    data.payment_id || null,
    data.note || null
  );
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO check_events (check_id, date, status, description) VALUES (?,?,?,?)')
    .run(id, data.issue_date || data.date || Jalali.todayIso(), 'pending',
      direction === 'received' ? 'دریافت چک' : 'صدور چک');
  return get(db, id);
}

function get(db, id) {
  const c = db.prepare('SELECT * FROM checks WHERE id=?').get(id);
  if (!c) return null;
  decorate(db, c);
  c.events = db.prepare('SELECT * FROM check_events WHERE check_id=? ORDER BY id').all(id).map(function (e) {
    e.status_label = C.CHECK_STATUS[e.status] || e.status;
    e.date_jalali = Jalali.isoToJalali(e.date);
    return e;
  });
  if (c.ref_type === 'sales_invoice' && c.ref_id) {
    c.invoice = db.prepare('SELECT id, invoice_no, date, total FROM sales_invoices WHERE id=?').get(c.ref_id) || null;
  } else if (c.ref_type === 'purchase_invoice' && c.ref_id) {
    c.invoice = db.prepare('SELECT id, invoice_no, date, total FROM purchase_invoices WHERE id=?').get(c.ref_id) || null;
  }
  c.allowed_next = flowFor(c.direction)[c.status] || [];
  return c;
}

function getByCode(db, code) {
  const r = db.prepare('SELECT id FROM checks WHERE check_code = ?').get(String(code).trim().toUpperCase());
  return r ? get(db, r.id) : null;
}

/**
 * جست‌وجوی چک‌ها.
 * search روی: کد یکتا، شماره چک، شناسه صیادی، نام دارنده، شماره فاکتور مرتبط و نام طرف‌حساب
 */
function list(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.direction) { where.push('ch.direction = ?'); args.push(o.direction); }
  if (o.status) {
    if (Array.isArray(o.status)) {
      where.push('ch.status IN (' + o.status.map(function () { return '?'; }).join(',') + ')');
      args.push.apply(args, o.status);
    } else { where.push('ch.status = ?'); args.push(o.status); }
  }
  if (o.party_type) { where.push('ch.party_type = ?'); args.push(o.party_type); }
  if (o.party_id) { where.push('ch.party_id = ?'); args.push(o.party_id); }
  if (o.bank_account_id) { where.push('ch.bank_account_id = ?'); args.push(o.bank_account_id); }
  if (o.due_from) { where.push('ch.due_date >= ?'); args.push(o.due_from); }
  if (o.due_to) { where.push('ch.due_date <= ?'); args.push(o.due_to); }
  if (o.from) { where.push('ch.created_at >= ?'); args.push(o.from); }
  if (o.ref_type) { where.push('ch.ref_type = ?'); args.push(o.ref_type); }
  if (o.ref_id) { where.push('ch.ref_id = ?'); args.push(o.ref_id); }
  if (o.overdue) {
    where.push('ch.due_date < ? AND ch.status IN (\'pending\',\'deposited\')');
    args.push(o.today || Jalali.todayIso());
  }
  if (o.search) {
    const s = '%' + Fmt.toEnDigits(String(o.search).trim()) + '%';
    const sRaw = '%' + String(o.search).trim() + '%';
    where.push('(ch.check_code LIKE ? OR ch.check_number LIKE ? OR ch.sayad_id LIKE ? OR ch.holder_name LIKE ? ' +
      'OR ch.ref_no LIKE ? OR ch.note LIKE ? OR ch.bank_name LIKE ? ' +
      'OR cu.name LIKE ? OR su.name LIKE ? OR CAST(ch.amount AS TEXT) LIKE ?)');
    args.push(s, s, s, sRaw, s, sRaw, sRaw, sRaw, sRaw, s);
  }
  const sql =
    'SELECT ch.*, COALESCE(cu.name, su.name) AS party_name ' +
    'FROM checks ch ' +
    'LEFT JOIN customers cu ON ch.party_type=\'customer\' AND cu.id=ch.party_id ' +
    'LEFT JOIN suppliers su ON ch.party_type=\'supplier\' AND su.id=ch.party_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY ' + (o.order === 'due' ? 'ch.due_date' : 'ch.id DESC') + ' LIMIT ? OFFSET ?';
  args.push(o.limit || 300, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (c) { return decorate(db, c); });
}

function count(db, opt) {
  const rows = list(db, Object.assign({}, opt, { limit: 100000, offset: 0 }));
  return rows.length;
}

/** خلاصه وضعیت چک‌ها برای داشبورد */
function summary(db, today) {
  const t = today || Jalali.todayIso();
  const q = function (sql, args) { return db.prepare(sql).get(...(args || [])); };
  const openReceived = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM checks WHERE direction=\'received\' AND status IN (\'pending\',\'deposited\')');
  const openIssued = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM checks WHERE direction=\'issued\' AND status=\'pending\'');
  const overdueReceived = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM checks WHERE direction=\'received\' AND status IN (\'pending\',\'deposited\') AND due_date < ?', [t]);
  const overdueIssued = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM checks WHERE direction=\'issued\' AND status=\'pending\' AND due_date < ?', [t]);
  const days = parseInt(settings.get(db, 'check_reminder_days', '7'), 10) || 7;
  const soon = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM checks WHERE status IN (\'pending\',\'deposited\') AND due_date BETWEEN ? AND ?',
    [t, Jalali.isoAddDays(t, days)]);
  const returned = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM checks WHERE status=\'returned\'');
  return {
    open_received: openReceived, open_issued: openIssued,
    overdue_received: overdueReceived, overdue_issued: overdueIssued,
    due_soon: soon, returned: returned, reminder_days: days
  };
}

/** چک‌های سررسید نزدیک برای یادآوری */
function reminders(db, days, today) {
  const t = today || Jalali.todayIso();
  const d = days || parseInt(settings.get(db, 'check_reminder_days', '7'), 10) || 7;
  return list(db, { status: ['pending', 'deposited'], due_to: Jalali.isoAddDays(t, d), order: 'due', limit: 200 });
}

function settleAccountOf(db, opt) {
  if (opt.method === 'cash') return { code: C.ACC.CASH, bank_account_id: null };
  if (!opt.bank_account_id) throw new Error('برای این عملیات باید حساب بانکی/کارتخوان انتخاب شود.');
  const ba = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(opt.bank_account_id);
  if (!ba) throw new Error('حساب بانکی انتخاب‌شده یافت نشد.');
  return { code: bankAccounts.accountCodeOf(ba.kind), bank_account_id: ba.id, title: ba.title };
}

/**
 * تغییر وضعیت چک به همراه سند حسابداری مربوطه.
 * opt: { status, date, bank_account_id, method, description }
 */
function changeStatus(db, id, opt) {
  const c = db.prepare('SELECT * FROM checks WHERE id=?').get(id);
  if (!c) throw new Error('چک یافت نشد.');
  const next = opt.status;
  const allowed = flowFor(c.direction)[c.status] || [];
  if (allowed.indexOf(next) === -1) {
    throw new Error('تغییر وضعیت از «' + (C.CHECK_STATUS[c.status] || c.status) + '» به «' +
      (C.CHECK_STATUS[next] || next) + '» مجاز نیست.');
  }
  const date = opt.date || Jalali.todayIso();
  const amount = c.amount;
  const name = partyName(db, c.party_type, c.party_id);
  const label = 'چک ' + c.check_code + (c.check_number ? ' (شماره ' + c.check_number + ')' : '');

  const tx = db.transaction(function () {
    let entryId = null;
    let lines = null;
    let desc = '';
    let bankAccountId = null;

    if (c.direction === 'received') {
      if (next === 'deposited') {
        desc = 'واگذاری ' + label + ' به بانک';
        if (opt.bank_account_id) bankAccountId = opt.bank_account_id;
      } else if (next === 'cleared') {
        const target = settleAccountOf(db, { method: opt.method || 'bank', bank_account_id: opt.bank_account_id || c.bank_account_id });
        bankAccountId = target.bank_account_id;
        desc = 'وصول ' + label;
        lines = [
          { account: target.code, debit: amount, bank_account_id: target.bank_account_id, description: desc },
          { account: C.ACC.CHECKS_RECEIVABLE, credit: amount, party_type: c.party_type, party_id: c.party_id, description: desc }
        ];
      } else if (next === 'returned' || next === 'cancelled') {
        desc = (next === 'returned' ? 'برگشت ' : 'ابطال ') + label + (name ? ' - ' + name : '');
        if (c.status === 'cleared') {
          const target = settleAccountOf(db, { method: opt.method || 'bank', bank_account_id: opt.bank_account_id || c.bank_account_id });
          bankAccountId = target.bank_account_id;
          lines = [
            { account: C.ACC.RECEIVABLE, debit: amount, party_type: c.party_type, party_id: c.party_id, description: desc },
            { account: target.code, credit: amount, bank_account_id: target.bank_account_id, description: desc }
          ];
        } else {
          lines = [
            { account: C.ACC.RECEIVABLE, debit: amount, party_type: c.party_type, party_id: c.party_id, description: desc },
            { account: C.ACC.CHECKS_RECEIVABLE, credit: amount, party_type: c.party_type, party_id: c.party_id, description: desc }
          ];
        }
      } else if (next === 'pending') {
        desc = 'بازگشت ' + label + ' از بانک به صندوق چک‌ها';
      }
    } else { // چک صادره
      if (next === 'paid') {
        const target = settleAccountOf(db, { method: opt.method || 'bank', bank_account_id: opt.bank_account_id || c.bank_account_id });
        bankAccountId = target.bank_account_id;
        desc = 'پرداخت ' + label;
        lines = [
          { account: C.ACC.CHECKS_PAYABLE, debit: amount, party_type: c.party_type, party_id: c.party_id, description: desc },
          { account: target.code, credit: amount, bank_account_id: target.bank_account_id, description: desc }
        ];
      } else if (next === 'returned' || next === 'cancelled') {
        desc = (next === 'returned' ? 'برگشت ' : 'ابطال ') + label + (name ? ' - ' + name : '');
        if (c.status === 'paid') {
          const target = settleAccountOf(db, { method: opt.method || 'bank', bank_account_id: opt.bank_account_id || c.bank_account_id });
          bankAccountId = target.bank_account_id;
          lines = [
            { account: target.code, debit: amount, bank_account_id: target.bank_account_id, description: desc },
            { account: C.ACC.PAYABLE, credit: amount, party_type: c.party_type, party_id: c.party_id, description: desc }
          ];
        } else {
          lines = [
            { account: C.ACC.CHECKS_PAYABLE, debit: amount, party_type: c.party_type, party_id: c.party_id, description: desc },
            { account: C.ACC.PAYABLE, credit: amount, party_type: c.party_type, party_id: c.party_id, description: desc }
          ];
        }
      }
    }

    if (lines) {
      entryId = journal.post(db, {
        date: date, description: desc, ref_type: 'check', ref_id: c.id, ref_no: c.check_code, lines: lines
      });
    }

    const settled = (next === 'cleared' || next === 'paid') ? date : null;
    db.prepare('UPDATE checks SET status=?, bank_account_id=COALESCE(?, bank_account_id), settled_at=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
      .run(next, bankAccountId, settled, c.id);
    db.prepare('INSERT INTO check_events (check_id, date, status, description, bank_account_id, journal_entry_id) VALUES (?,?,?,?,?,?)')
      .run(c.id, date, next, opt.description || desc || (C.CHECK_STATUS[next] || next), bankAccountId, entryId);
    return entryId;
  });
  tx();
  return get(db, id);
}

/** بازگردانی آخرین تغییر وضعیت (اصلاح اشتباه کاربر) */
function revertLastEvent(db, id) {
  const events = db.prepare('SELECT * FROM check_events WHERE check_id=? ORDER BY id').all(id);
  if (events.length <= 1) throw new Error('این چک وضعیت قبلی برای بازگشت ندارد.');
  const last = events[events.length - 1];
  const prev = events[events.length - 2];
  const tx = db.transaction(function () {
    db.prepare('DELETE FROM check_events WHERE id=?').run(last.id);
    if (last.journal_entry_id) journal.deleteEntry(db, last.journal_entry_id);
    const settled = (prev.status === 'cleared' || prev.status === 'paid') ? prev.date : null;
    db.prepare('UPDATE checks SET status=?, settled_at=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
      .run(prev.status, settled, id);
  });
  tx();
  return get(db, id);
}

/** ویرایش اطلاعات شناسنامه‌ای چک (مبلغ فقط تا وقتی سند مالی نخورده) */
function update(db, id, data) {
  const c = db.prepare('SELECT * FROM checks WHERE id=?').get(id);
  if (!c) throw new Error('چک یافت نشد.');
  db.prepare(
    'UPDATE checks SET check_number=?, sayad_id=?, bank_name=?, branch=?, holder_name=?, issue_date=?, due_date=?, note=?, ' +
    'updated_at=datetime(\'now\',\'localtime\') WHERE id=?'
  ).run(
    data.check_number !== undefined ? (data.check_number ? Fmt.toEnDigits(String(data.check_number)) : null) : c.check_number,
    data.sayad_id !== undefined ? (data.sayad_id ? Fmt.toEnDigits(String(data.sayad_id)) : null) : c.sayad_id,
    data.bank_name !== undefined ? data.bank_name : c.bank_name,
    data.branch !== undefined ? data.branch : c.branch,
    data.holder_name !== undefined ? data.holder_name : c.holder_name,
    data.issue_date !== undefined ? data.issue_date : c.issue_date,
    data.due_date !== undefined ? data.due_date : c.due_date,
    data.note !== undefined ? data.note : c.note,
    id
  );
  return get(db, id);
}

/** حذف چک — فقط چک بدون سند مالی و بدون اتصال به دریافت/پرداخت */
function remove(db, id) {
  const c = db.prepare('SELECT * FROM checks WHERE id=?').get(id);
  if (!c) throw new Error('چک یافت نشد.');
  const linked = db.prepare('SELECT COUNT(*) c FROM payment_lines WHERE check_id=?').get(id).c;
  if (linked) throw new Error('این چک به یک سند دریافت/پرداخت متصل است؛ ابتدا آن سند را حذف کنید.');
  const entries = db.prepare('SELECT COUNT(*) c FROM check_events WHERE check_id=? AND journal_entry_id IS NOT NULL').get(id).c;
  if (entries) throw new Error('این چک دارای سند حسابداری است؛ ابتدا وضعیت‌های آن را بازگردانی کنید.');
  db.prepare('DELETE FROM checks WHERE id=?').run(id);
  return true;
}

/** مجموع چک‌های در جریان (برای داشبورد و ترازنامه) */
function openTotals(db) {
  const received = db.prepare(
    'SELECT COALESCE(SUM(amount),0) s FROM checks WHERE direction=\'received\' AND status IN (\'pending\',\'deposited\')').get().s;
  const issued = db.prepare(
    'SELECT COALESCE(SUM(amount),0) s FROM checks WHERE direction=\'issued\' AND status=\'pending\'').get().s;
  return { received: received, issued: issued };
}

module.exports = {
  create: create, get: get, getByCode: getByCode, list: list, count: count,
  changeStatus: changeStatus, revertLastEvent: revertLastEvent, update: update, remove: remove,
  summary: summary, reminders: reminders, openTotals: openTotals,
  RECEIVED_FLOW: RECEIVED_FLOW, ISSUED_FLOW: ISSUED_FLOW
};
