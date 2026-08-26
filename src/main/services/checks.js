'use strict';
/**
 * مدیریت چک‌های دریافتی و پرداختی و تغییر وضعیت آن‌ها همراه با سند حسابداری.
 * چرخه چک دریافتی: در جریان → واگذار به بانک → وصول‌شده / برگشتی
 * چرخه چک پرداختی: در جریان → پرداخت‌شده (پاس‌شده) / برگشتی
 */
const { AppError, assert } = require('../util/errors');
const { r } = require('../util/money');
const { todayIso, addDaysIso } = require('../util/jalali');
const accounting = require('./accounting');

const ACC = accounting.ACC;

const STATUS_LABELS = {
  pending: 'در جریان',
  deposited: 'واگذار به بانک',
  cleared: 'وصول‌شده',
  returned: 'برگشتی',
  paid: 'پرداخت‌شده',
  cancelled: 'ابطال‌شده',
};

const ALLOWED = {
  received: {
    pending: ['deposited', 'cleared', 'returned', 'cancelled'],
    deposited: ['cleared', 'returned'],
    cleared: [],
    returned: ['deposited', 'cleared', 'cancelled'],
    cancelled: [],
  },
  paid: {
    pending: ['paid', 'returned', 'cancelled'],
    deposited: ['paid', 'returned'],
    paid: [],
    returned: ['paid', 'cancelled'],
    cancelled: [],
  },
};

function get(db, id) {
  const c = db.prepare('SELECT * FROM checks WHERE id=?').get(id);
  if (!c) throw new AppError('چک یافت نشد.', 'NO_CHECK');
  const events = db.prepare('SELECT * FROM check_events WHERE check_id=? ORDER BY id').all(id);
  return { check: c, events };
}

function list(db, filter = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.kind) { where += ' AND c.kind=@kind'; params.kind = filter.kind; }
  if (filter.status) { where += ' AND c.status=@status'; params.status = filter.status; }
  if (filter.open) where += " AND c.status IN ('pending','deposited')";
  if (filter.from) { where += ' AND c.due_date>=@from'; params.from = filter.from; }
  if (filter.to) { where += ' AND c.due_date<=@to'; params.to = filter.to; }
  if (filter.overdue) { where += " AND c.due_date < @today AND c.status IN ('pending','deposited')"; params.today = todayIso(); }
  if (filter.partyId) { where += ' AND c.party_id=@pid'; params.pid = Number(filter.partyId); }
  if (filter.q) { where += ' AND (c.number LIKE @q OR c.bank LIKE @q OR c.party_name LIKE @q)'; params.q = '%' + filter.q + '%'; }
  const limit = Math.min(Number(filter.limit) || 300, 3000);
  const rows = db.prepare(`SELECT c.* FROM checks c ${where} ORDER BY c.due_date, c.id LIMIT ${limit}`).all(params);
  const agg = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) total FROM checks c ${where}`).get(params);
  return { rows, total: agg.c, summary: agg };
}

/** ثبت دستی چک (بدون فاکتور) — مثلاً چک امانی یا چک ثبت‌نشده */
function create(db, payload) {
  const run = db.transaction(() => {
    const kind = payload.kind === 'paid' ? 'paid' : 'received';
    const amount = Math.max(0, r(payload.amount));
    assert(amount > 0, 'مبلغ چک باید بزرگ‌تر از صفر باشد.');
    const date = payload.issue_date || todayIso();
    const partyId = payload.party_id ? Number(payload.party_id) : null;
    let partyName = String(payload.party_name || '');
    if (partyId) {
      const p = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
      if (!p) throw new AppError('طرف حساب یافت نشد.', 'NO_PARTY');
      partyName = p.name;
    }
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO checks
      (kind,number,bank,branch,party_id,party_name,amount,issue_date,due_date,status,doc_type,doc_id,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'pending','manual',NULL,?,?)`)
      .run(kind, String(payload.number || ''), String(payload.bank || ''), String(payload.branch || ''),
        partyId, partyName, amount, date, payload.due_date || date, String(payload.notes || ''), now);
    const checkId = Number(info.lastInsertRowid);

    // سند حسابداری: چک دریافتی ⇒ بدهکار اسناد دریافتنی / بستانکار حساب مشتری
    const lines = kind === 'received'
      ? [{ account: ACC.CHECKS_RECEIVABLE, debit: amount, description: 'چک دریافتی ' + (payload.number || '') },
        { account: ACC.RECEIVABLE, credit: amount, partyId, description: 'دریافت چک از مشتری' }]
      : [{ account: ACC.PAYABLE, debit: amount, partyId, description: 'صدور چک به تأمین‌کننده' },
        { account: ACC.CHECKS_PAYABLE, credit: amount, description: 'چک پرداختی ' + (payload.number || '') }];
    const entryId = accounting.postEntry(db, {
      date, refType: 'check', refId: checkId,
      description: `ثبت چک ${kind === 'received' ? 'دریافتی' : 'پرداختی'} شماره ${payload.number || ''}`,
      lines,
    });
    db.prepare(`INSERT INTO check_events(check_id,date,from_status,to_status,entry_id,notes,created_at)
                VALUES (?,?,'','pending',?,?,?)`).run(checkId, date, entryId, 'ثبت دستی چک', now);
    return checkId;
  });
  return get(db, run());
}

/**
 * تغییر وضعیت چک همراه با سند حسابداری متناسب.
 * @param {object} opts {date, account: '101'|'103', notes}
 */
function changeStatus(db, id, toStatus, opts = {}) {
  const run = db.transaction(() => {
    const c = db.prepare('SELECT * FROM checks WHERE id=?').get(id);
    if (!c) throw new AppError('چک یافت نشد.', 'NO_CHECK');
    const allowed = (ALLOWED[c.kind] || {})[c.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(`تغییر وضعیت از «${STATUS_LABELS[c.status]}» به «${STATUS_LABELS[toStatus] || toStatus}» مجاز نیست.`, 'BAD_STATUS');
    }
    const date = opts.date || todayIso();
    const bankAccount = ['101', '102', '103'].includes(opts.account) ? opts.account : ACC.BANK;
    let lines = null;

    if (c.kind === 'received') {
      if (toStatus === 'cleared') {
        lines = [
          { account: bankAccount, debit: c.amount, description: 'وصول چک ' + c.number },
          { account: ACC.CHECKS_RECEIVABLE, credit: c.amount, description: 'وصول چک دریافتی' },
        ];
      } else if (toStatus === 'returned') {
        lines = [
          { account: ACC.RECEIVABLE, debit: c.amount, partyId: c.party_id, description: 'برگشت چک ' + c.number },
          { account: ACC.CHECKS_RECEIVABLE, credit: c.amount, description: 'برگشت چک دریافتی' },
        ];
      } else if (toStatus === 'cancelled') {
        lines = [
          { account: ACC.RECEIVABLE, debit: c.amount, partyId: c.party_id, description: 'ابطال چک ' + c.number },
          { account: ACC.CHECKS_RECEIVABLE, credit: c.amount, description: 'ابطال چک دریافتی' },
        ];
      } else if (toStatus === 'deposited') {
        lines = null; // واگذاری به بانک تغییری در حساب‌ها ایجاد نمی‌کند
      }
      if (c.status === 'returned' && (toStatus === 'deposited' || toStatus === 'cleared')) {
        // چک برگشتی دوباره در جریان گذاشته می‌شود
        const back = [
          { account: ACC.CHECKS_RECEIVABLE, debit: c.amount, description: 'بازگشت چک به جریان ' + c.number },
          { account: ACC.RECEIVABLE, credit: c.amount, partyId: c.party_id, description: 'چک مجدد در جریان' },
        ];
        accounting.postEntry(db, { date, refType: 'check', refId: c.id, description: 'چک برگشتی مجدداً در جریان قرار گرفت', lines: back });
        if (toStatus === 'cleared') {
          lines = [
            { account: bankAccount, debit: c.amount, description: 'وصول چک ' + c.number },
            { account: ACC.CHECKS_RECEIVABLE, credit: c.amount, description: 'وصول چک دریافتی' },
          ];
        } else lines = null;
      }
    } else { // چک پرداختی
      if (toStatus === 'paid') {
        lines = [
          { account: ACC.CHECKS_PAYABLE, debit: c.amount, description: 'پرداخت چک ' + c.number },
          { account: bankAccount, credit: c.amount, description: 'پاس شدن چک پرداختی' },
        ];
      } else if (toStatus === 'returned' || toStatus === 'cancelled') {
        lines = [
          { account: ACC.CHECKS_PAYABLE, debit: c.amount, description: (toStatus === 'returned' ? 'برگشت' : 'ابطال') + ' چک ' + c.number },
          { account: ACC.PAYABLE, credit: c.amount, partyId: c.party_id, description: 'بازگشت بدهی به تأمین‌کننده' },
        ];
      }
      if (c.status === 'returned' && toStatus === 'paid') {
        const back = [
          { account: ACC.PAYABLE, debit: c.amount, partyId: c.party_id, description: 'چک مجدد در جریان' },
          { account: ACC.CHECKS_PAYABLE, credit: c.amount, description: 'چک پرداختی مجدد در جریان' },
        ];
        accounting.postEntry(db, { date, refType: 'check', refId: c.id, description: 'چک پرداختی مجدداً در جریان قرار گرفت', lines: back });
      }
    }

    let entryId = null;
    if (lines) {
      entryId = accounting.postEntry(db, {
        date, refType: 'check', refId: c.id,
        description: `${STATUS_LABELS[toStatus]} - چک شماره ${c.number} (${c.party_name || ''})`,
        lines,
      });
    }
    const settled = ['cleared', 'paid', 'cancelled'].includes(toStatus) ? date : '';
    db.prepare('UPDATE checks SET status=?, settled_date=? WHERE id=?').run(toStatus, settled, id);
    db.prepare(`INSERT INTO check_events(check_id,date,from_status,to_status,entry_id,notes,created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(id, date, c.status, toStatus, entryId, String(opts.notes || ''), new Date().toISOString());
    return id;
  });
  return get(db, run());
}

/** یادآوری چک‌های سررسیدشده و نزدیک سررسید */
function reminders(db, days = 7) {
  const today = todayIso();
  const soon = addDaysIso(today, days);
  const overdue = db.prepare(`SELECT * FROM checks WHERE status IN ('pending','deposited') AND due_date < ?
                              ORDER BY due_date`).all(today);
  const upcoming = db.prepare(`SELECT * FROM checks WHERE status IN ('pending','deposited')
                               AND due_date >= ? AND due_date <= ? ORDER BY due_date`).all(today, soon);
  const sum = (rows, kind) => rows.filter((x) => x.kind === kind).reduce((a, x) => a + x.amount, 0);
  return {
    today,
    overdue,
    upcoming,
    totals: {
      overdueReceived: sum(overdue, 'received'),
      overduePaid: sum(overdue, 'paid'),
      upcomingReceived: sum(upcoming, 'received'),
      upcomingPaid: sum(upcoming, 'paid'),
    },
  };
}

module.exports = { STATUS_LABELS, ALLOWED, get, list, create, changeStatus, reminders };
