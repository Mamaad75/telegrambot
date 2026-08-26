'use strict';
/**
 * موتور حسابداری دوطرفه.
 * هیچ سند مالی جز از طریق postEntry ثبت نمی‌شود و هر سند پیش از ثبت
 * از نظر توازن (جمع بدهکار = جمع بستانکار) بررسی می‌گردد.
 */
const { AppError } = require('../util/errors');
const { r } = require('../util/money');
const { todayIso } = require('../util/jalali');

const CASH_ACCOUNTS = {
  cash: '101',
  pos: '102',
  bank: '103',
  transfer: '103',
  check: '104',
};

const METHOD_LABELS = {
  cash: 'نقدی',
  pos: 'کارتخوان',
  bank: 'بانک / کارت‌به‌کارت',
  check: 'چک',
  credit: 'نسیه',
};

const ACC = {
  CASH: '101', POS: '102', BANK: '103', CHECKS_RECEIVABLE: '104',
  RECEIVABLE: '105', INVENTORY: '106',
  PAYABLE: '201', VAT: '202', CHECKS_PAYABLE: '203',
  EQUITY: '301', DRAWINGS: '302',
  SALES: '401', OTHER_INCOME: '402', SALES_RETURNS: '403', SALES_DISCOUNTS: '404',
  PURCHASES: '501', OPEX: '502', COGS: '503',
};

/** شماره بعدی برای یک شمارنده (فاکتور، سند و ...) */
function nextCounter(db, name) {
  const row = db.prepare('SELECT value FROM counters WHERE name=?').get(name);
  if (!row) {
    db.prepare('INSERT INTO counters(name,value) VALUES (?,1)').run(name);
    return 1;
  }
  const v = row.value + 1;
  db.prepare('UPDATE counters SET value=? WHERE name=?').run(v, name);
  return v;
}

function pad(n, w) { return String(n).padStart(w, '0'); }

/** شماره سند حسابداری */
function nextEntryNo(db) {
  return 'JV-' + pad(nextCounter(db, 'journal'), 6);
}

/**
 * ثبت سند حسابداری.
 * @param {object} db
 * @param {{date:string, refType:string, refId?:number, description?:string,
 *          lines:Array<{account:string,debit?:number,credit?:number,partyId?:number,description?:string}>}} spec
 * @returns {number} شناسه سند
 */
function postEntry(db, spec) {
  const date = spec.date || todayIso();
  const lines = (spec.lines || [])
    .map((l) => ({
      account: String(l.account),
      debit: Math.max(0, r(l.debit || 0)),
      credit: Math.max(0, r(l.credit || 0)),
      partyId: l.partyId || null,
      description: l.description || '',
    }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  if (!lines.length) throw new AppError('سند حسابداری بدون ردیف قابل ثبت نیست.', 'EMPTY_ENTRY');

  for (const l of lines) {
    if (l.debit && l.credit) {
      throw new AppError('هر ردیف سند فقط می‌تواند بدهکار یا بستانکار باشد.', 'BAD_LINE');
    }
  }

  const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
  const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
  if (totalDebit !== totalCredit) {
    throw new AppError(
      `سند حسابداری متوازن نیست (بدهکار ${totalDebit} / بستانکار ${totalCredit}). عملیات لغو شد.`,
      'UNBALANCED',
      { totalDebit, totalCredit, lines },
    );
  }

  const known = new Set(db.prepare('SELECT code FROM accounts').all().map((x) => x.code));
  for (const l of lines) {
    if (!known.has(l.account)) throw new AppError(`حساب ${l.account} در دفتر حساب‌ها تعریف نشده است.`, 'NO_ACCOUNT');
  }

  const entryNo = spec.entryNo || nextEntryNo(db);
  const info = db.prepare(`INSERT INTO journal_entries(entry_no,date,ref_type,ref_id,description,reversed_of,created_at)
                           VALUES (?,?,?,?,?,?,?)`)
    .run(entryNo, date, spec.refType || 'manual', spec.refId || null,
      spec.description || '', spec.reversedOf || null, new Date().toISOString());
  const entryId = Number(info.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO journal_lines(entry_id,account_code,debit,credit,party_id,description)
                          VALUES (?,?,?,?,?,?)`);
  for (const l of lines) ins.run(entryId, l.account, l.debit, l.credit, l.partyId, l.description);
  return entryId;
}

/** ثبت سند معکوس (برای ابطال اسناد) */
function reverseEntry(db, entryId, date, description) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id=?').get(entryId);
  if (!entry) throw new AppError('سند حسابداری یافت نشد.', 'NO_ENTRY');
  const lines = db.prepare('SELECT * FROM journal_lines WHERE entry_id=?').all(entryId);
  return postEntry(db, {
    date: date || todayIso(),
    refType: entry.ref_type + '_reverse',
    refId: entry.ref_id,
    description: description || ('ابطال سند ' + entry.entry_no),
    reversedOf: entryId,
    lines: lines.map((l) => ({
      account: l.account_code,
      debit: l.credit,
      credit: l.debit,
      partyId: l.party_id,
      description: l.description,
    })),
  });
}

function dateFilter(alias, from, to, params) {
  let sql = '';
  if (from) { sql += ` AND ${alias}.date >= @from`; params.from = from; }
  if (to) { sql += ` AND ${alias}.date <= @to`; params.to = to; }
  return sql;
}

/** مانده یک حساب (بر اساس ماهیت حساب) */
function accountBalance(db, code, opts = {}) {
  const params = { code };
  const where = dateFilter('e', opts.from, opts.to, params);
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.account_code=@code ${where}`).get(params);
  const acc = db.prepare('SELECT * FROM accounts WHERE code=?').get(code);
  const debit = row.d || 0;
  const credit = row.c || 0;
  const natural = acc && acc.normal_side === 'credit' ? credit - debit : debit - credit;
  return { code, debit, credit, balance: natural };
}

/** مانده همه حساب‌های نقدی (صندوق/کارتخوان/بانک/اسناد دریافتنی) */
function treasuryBalances(db, opts = {}) {
  const params = {};
  const where = dateFilter('e', opts.from, opts.to, params);
  const rows = db.prepare(`
    SELECT a.code, a.name,
           COALESCE(t.debit,0) - COALESCE(t.credit,0) AS balance
    FROM accounts a
    LEFT JOIN (
      SELECT l.account_code code, SUM(l.debit) debit, SUM(l.credit) credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE 1=1 ${where}
      GROUP BY l.account_code
    ) t ON t.code = a.code
    WHERE a.code IN ('101','102','103','104')
    ORDER BY a.code`).all(params);
  const map = {};
  for (const x of rows) map[x.code] = x.balance || 0;
  return {
    cash: map['101'] || 0,
    pos: map['102'] || 0,
    bank: map['103'] || 0,
    checksReceivable: map['104'] || 0,
    rows,
  };
}

/** تراز آزمایشی */
function trialBalance(db, opts = {}) {
  const params = {};
  const where = dateFilter('e', opts.from, opts.to, params);
  const rows = db.prepare(`
    SELECT a.code, a.name, a.type, a.normal_side,
           COALESCE(t.debit,0)  AS debit,
           COALESCE(t.credit,0) AS credit
    FROM accounts a
    LEFT JOIN (
      SELECT l.account_code code, SUM(l.debit) debit, SUM(l.credit) credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE 1=1 ${where}
      GROUP BY l.account_code
    ) t ON t.code = a.code
    ORDER BY a.sort_order, a.code`).all(params);
  const out = rows.map((x) => {
    const net = x.debit - x.credit;
    return {
      ...x,
      debitBalance: net > 0 ? net : 0,
      creditBalance: net < 0 ? -net : 0,
      balance: x.normal_side === 'credit' ? -net : net,
    };
  });
  const totals = out.reduce((a, x) => ({
    debit: a.debit + x.debit,
    credit: a.credit + x.credit,
    debitBalance: a.debitBalance + x.debitBalance,
    creditBalance: a.creditBalance + x.creditBalance,
  }), { debit: 0, credit: 0, debitBalance: 0, creditBalance: 0 });
  return { rows: out.filter((x) => x.debit || x.credit), totals, balanced: totals.debit === totals.credit };
}

/** دفتر معین یک حساب با مانده تجمعی */
function ledger(db, code, opts = {}) {
  const params = { code };
  const where = dateFilter('e', opts.from, opts.to, params);
  const acc = db.prepare('SELECT * FROM accounts WHERE code=?').get(code);
  if (!acc) throw new AppError('حساب یافت نشد.', 'NO_ACCOUNT');
  let opening = 0;
  if (opts.from) {
    const o = db.prepare(`
      SELECT COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) net
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.account_code=@code AND e.date < @from`).get({ code, from: opts.from });
    opening = acc.normal_side === 'credit' ? -(o.net || 0) : (o.net || 0);
  }
  const rows = db.prepare(`
    SELECT e.id entry_id, e.entry_no, e.date, e.ref_type, e.ref_id, e.description entry_desc,
           l.debit, l.credit, l.description line_desc, l.party_id,
           (SELECT name FROM parties WHERE id=l.party_id) party_name
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.account_code=@code ${where}
    ORDER BY e.date, e.id, l.id`).all(params);
  let bal = opening;
  const out = rows.map((x) => {
    const delta = acc.normal_side === 'credit' ? x.credit - x.debit : x.debit - x.credit;
    bal += delta;
    return { ...x, balance: bal };
  });
  return { account: acc, opening, rows: out, closing: bal };
}

/** مانده حساب یک طرف حساب (مشتری یا تأمین‌کننده) */
function partyBalance(db, partyId) {
  const p = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
  if (!p) throw new AppError('طرف حساب یافت نشد.', 'NO_PARTY');
  const code = p.type === 'customer' ? ACC.RECEIVABLE : ACC.PAYABLE;
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
    FROM journal_lines l WHERE l.party_id=? AND l.account_code=?`).get(partyId, code);
  const net = (row.d || 0) - (row.c || 0);
  // برای مشتری: مثبت یعنی بدهکار (طلب ما)؛ برای تأمین‌کننده: مثبت یعنی بستانکار (بدهی ما)
  return p.type === 'customer' ? net : -net;
}

/** صورت‌حساب طرف حساب */
function partyStatement(db, partyId, opts = {}) {
  const p = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
  if (!p) throw new AppError('طرف حساب یافت نشد.', 'NO_PARTY');
  const code = p.type === 'customer' ? ACC.RECEIVABLE : ACC.PAYABLE;
  const params = { pid: partyId, code };
  const where = dateFilter('e', opts.from, opts.to, params);
  let opening = 0;
  if (opts.from) {
    const o = db.prepare(`SELECT COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) net
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.party_id=@pid AND l.account_code=@code AND e.date < @from`).get({ pid: partyId, code, from: opts.from });
    opening = p.type === 'customer' ? (o.net || 0) : -(o.net || 0);
  }
  const rows = db.prepare(`
    SELECT e.date, e.entry_no, e.ref_type, e.ref_id, e.description, l.debit, l.credit
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.party_id=@pid AND l.account_code=@code ${where}
    ORDER BY e.date, e.id`).all(params);
  let bal = opening;
  const out = rows.map((x) => {
    const delta = p.type === 'customer' ? x.debit - x.credit : x.credit - x.debit;
    bal += delta;
    return { ...x, balance: bal };
  });
  return { party: p, opening, rows: out, closing: bal };
}

/** سود و زیان دوره */
function profitLoss(db, opts = {}) {
  const bal = (code) => {
    const params = { code };
    const where = dateFilter('e', opts.from, opts.to, params);
    const row = db.prepare(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.account_code=@code ${where}`).get(params);
    return { debit: row.d || 0, credit: row.c || 0 };
  };
  const like = (prefix) => {
    const params = { p: prefix + '%' };
    const where = dateFilter('e', opts.from, opts.to, params);
    return db.prepare(`SELECT l.account_code code,
        (SELECT name FROM accounts WHERE code=l.account_code) name,
        COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) amount
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.account_code LIKE @p ${where}
      GROUP BY l.account_code HAVING amount <> 0 ORDER BY l.account_code`).all(params);
  };

  const sales = bal(ACC.SALES);
  const revenue = sales.credit - sales.debit;
  const disc = bal(ACC.SALES_DISCOUNTS);
  const discounts = disc.debit - disc.credit;
  const ret = bal(ACC.SALES_RETURNS);
  const returns = ret.debit - ret.credit;
  const netSales = revenue - discounts - returns;

  const cogsB = bal(ACC.COGS);
  const cogs = cogsB.debit - cogsB.credit;
  const grossProfit = netSales - cogs;

  const expenseRows = like('502').filter((x) => x.code !== '502' || x.amount !== 0);
  const operatingExpenses = expenseRows.reduce((a, x) => a + x.amount, 0);
  const otherIncomeRows = like('402').map((x) => ({ ...x, amount: -x.amount }));
  const otherIncome = otherIncomeRows.reduce((a, x) => a + x.amount, 0);
  const netProfit = grossProfit - operatingExpenses + otherIncome;

  return {
    from: opts.from || null,
    to: opts.to || null,
    revenue, discounts, returns, netSales, cogs, grossProfit,
    operatingExpenses, expenseRows, otherIncome, otherIncomeRows, netProfit,
  };
}

/** گزارش ارزش افزوده */
function vatReport(db, opts = {}) {
  const params = {};
  const where = dateFilter('i', opts.from, opts.to, params);
  const rows = db.prepare(`
    SELECT type, COUNT(*) cnt, COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(vat),0) vat, COALESCE(SUM(total),0) total
    FROM invoices i WHERE status='posted' ${where} GROUP BY type`).all(params);
  const get = (t) => rows.find((x) => x.type === t) || { cnt: 0, taxable: 0, vat: 0, total: 0 };
  const sale = get('sale'); const saleRet = get('sale_return');
  const pur = get('purchase'); const purRet = get('purchase_return');
  const outputVat = sale.vat - saleRet.vat;
  const inputVat = pur.vat - purRet.vat;
  const details = db.prepare(`
    SELECT id, type, invoice_no, date, party_name, taxable, vat_rate, vat, total
    FROM invoices i WHERE status='posted' AND vat <> 0 ${where} ORDER BY date, id`).all(params);
  return {
    sale, saleRet, pur, purRet, outputVat, inputVat, payable: outputVat - inputVat, details,
  };
}

module.exports = {
  ACC, CASH_ACCOUNTS, METHOD_LABELS,
  postEntry, reverseEntry, nextCounter, nextEntryNo,
  accountBalance, treasuryBalances, trialBalance, ledger,
  partyBalance, partyStatement, profitLoss, vatReport,
};
