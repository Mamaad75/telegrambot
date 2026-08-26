'use strict';
/** داشبورد و مرکز گزارش‌ها */
const accounting = require('./accounting');
const inventory = require('./inventory');
const checksSvc = require('./checks');
const { todayIso, addDaysIso, startOfJalaliWeek, jalaliMonthRange } = require('../util/jalali');

const ACC = accounting.ACC;

/** بازه‌های آماده تاریخ */
function range(kind, today) {
  const t = today || todayIso();
  switch (kind) {
    case 'today': return { from: t, to: t };
    case 'yesterday': { const y = addDaysIso(t, -1); return { from: y, to: y }; }
    case 'week': return { from: startOfJalaliWeek(t), to: t };
    case 'month': { const m = jalaliMonthRange(t); return { from: m.from, to: t < m.to ? t : m.to }; }
    case 'last7': return { from: addDaysIso(t, -6), to: t };
    case 'last30': return { from: addDaysIso(t, -29), to: t };
    case 'all': return { from: null, to: null };
    default: return { from: t, to: t };
  }
}

function invoiceSummary(db, type, from, to) {
  const params = { type };
  let where = "WHERE status='posted' AND type=@type";
  if (from) { where += ' AND date>=@from'; params.from = from; }
  if (to) { where += ' AND date<=@to'; params.to = to; }
  const row = db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(total),0) total,
      COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(vat),0) vat,
      COALESCE(SUM(discount_total),0) discount, COALESCE(SUM(cogs),0) cogs,
      COALESCE(SUM(paid),0) paid, COALESCE(SUM(due),0) due
    FROM invoices ${where}`).get(params);
  return row;
}

/** مجموع فروش/خرید به تفکیک روز برای نمودار */
function dailySeries(db, from, to) {
  const params = { from, to };
  const rows = db.prepare(`
    SELECT date,
      COALESCE(SUM(CASE WHEN type='sale' THEN total ELSE 0 END),0) sales,
      COALESCE(SUM(CASE WHEN type='purchase' THEN total ELSE 0 END),0) purchases,
      COALESCE(SUM(CASE WHEN type='sale' THEN taxable - cogs ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN type='sale_return' THEN taxable - cogs ELSE 0 END),0) profit
    FROM invoices WHERE status='posted' AND date>=@from AND date<=@to
    GROUP BY date ORDER BY date`).all(params);
  const map = {};
  for (const x of rows) map[x.date] = x;
  const out = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard < 400) {
    out.push(map[d] || { date: d, sales: 0, purchases: 0, profit: 0 });
    d = addDaysIso(d, 1);
    guard += 1;
  }
  return out;
}

/** توزیع روش‌های دریافت در بازه */
function methodDistribution(db, from, to) {
  const params = {};
  let where = "WHERE pl.direction='in'";
  if (from) { where += ' AND pl.date>=@from'; params.from = from; }
  if (to) { where += ' AND pl.date<=@to'; params.to = to; }
  const rows = db.prepare(`SELECT pl.method, COALESCE(SUM(pl.amount),0) amount, COUNT(*) count
    FROM payment_lines pl ${where} GROUP BY pl.method ORDER BY amount DESC`).all(params);
  const creditRow = db.prepare(`SELECT COALESCE(SUM(due),0) amount, COUNT(*) count FROM invoices
    WHERE status='posted' AND type='sale' AND due>0
    ${from ? 'AND date>=@from' : ''} ${to ? 'AND date<=@to' : ''}`).get(params);
  if (creditRow.amount > 0) rows.push({ method: 'credit', amount: creditRow.amount, count: creditRow.count });
  return rows;
}

/** مطالبات سررسید گذشته */
function overdueReceivables(db, days = 30) {
  const limit = addDaysIso(todayIso(), -days);
  const rows = db.prepare(`SELECT i.id, i.invoice_no, i.date, i.party_id, i.party_name, i.total, i.due
    FROM invoices i WHERE i.status='posted' AND i.type='sale' AND i.due>0 AND i.date <= ?
    ORDER BY i.date`).all(limit);
  return { days, rows, total: rows.reduce((a, x) => a + x.due, 0) };
}

function dashboard(db, opts = {}) {
  const t = todayIso();
  const r = opts.from || opts.to ? { from: opts.from, to: opts.to } : range(opts.range || 'today', t);
  const from = r.from || '0000-01-01';
  const to = r.to || '9999-12-31';

  const sales = invoiceSummary(db, 'sale', r.from, r.to);
  const purchases = invoiceSummary(db, 'purchase', r.from, r.to);
  const salesReturns = invoiceSummary(db, 'sale_return', r.from, r.to);
  const purchaseReturns = invoiceSummary(db, 'purchase_return', r.from, r.to);
  const pl = accounting.profitLoss(db, { from: r.from, to: r.to });
  const treasury = accounting.treasuryBalances(db);
  const receivable = accounting.accountBalance(db, ACC.RECEIVABLE).balance;
  const payable = accounting.accountBalance(db, ACC.PAYABLE).balance;
  const stock = inventory.totalValuation(db);
  const checkRem = checksSvc.reminders(db, 7);
  const pendingChecks = db.prepare(`SELECT kind, COUNT(*) count, COALESCE(SUM(amount),0) amount
    FROM checks WHERE status IN ('pending','deposited') GROUP BY kind`).all();
  const low = inventory.lowStock(db);
  const overdue = overdueReceivables(db, Number(opts.overdueDays) || 30);
  const series = dailySeries(db, r.from || addDaysIso(t, -13), r.to || t);
  const methods = methodDistribution(db, r.from, r.to);
  const topProducts = db.prepare(`
    SELECT ii.product_id, ii.product_name, SUM(ii.qty) qty, SUM(ii.line_total) amount
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE i.type='sale' AND i.status='posted' AND i.date>=? AND i.date<=?
    GROUP BY ii.product_id ORDER BY amount DESC LIMIT 8`).all(from, to);

  return {
    range: r,
    sales, purchases, salesReturns, purchaseReturns,
    profit: {
      gross: pl.grossProfit, net: pl.netProfit, cogs: pl.cogs,
      netSales: pl.netSales, expenses: pl.operatingExpenses, otherIncome: pl.otherIncome,
    },
    treasury,
    receivable,
    payable,
    inventory: stock,
    lowStock: low,
    checks: {
      pending: pendingChecks,
      overdue: checkRem.overdue,
      upcoming: checkRem.upcoming,
      totals: checkRem.totals,
    },
    overdueReceivables: overdue,
    series,
    methods,
    topProducts,
  };
}

/** گزارش فروش/خرید با تفکیک روز، کالا و طرف حساب */
function salesReport(db, opts = {}) {
  const type = opts.type || 'sale';
  const params = { type };
  let where = "WHERE i.status='posted' AND i.type=@type";
  if (opts.from) { where += ' AND i.date>=@from'; params.from = opts.from; }
  if (opts.to) { where += ' AND i.date<=@to'; params.to = opts.to; }
  if (opts.partyId) { where += ' AND i.party_id=@pid'; params.pid = Number(opts.partyId); }
  const rows = db.prepare(`SELECT i.* FROM invoices i ${where} ORDER BY i.date, i.id`).all(params);
  const summary = db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(i.subtotal),0) subtotal,
      COALESCE(SUM(i.discount_total),0) discount, COALESCE(SUM(i.taxable),0) taxable,
      COALESCE(SUM(i.vat),0) vat, COALESCE(SUM(i.total),0) total,
      COALESCE(SUM(i.cogs),0) cogs, COALESCE(SUM(i.paid),0) paid, COALESCE(SUM(i.due),0) due
    FROM invoices i ${where}`).get(params);
  const byDay = db.prepare(`SELECT i.date, COUNT(*) count, COALESCE(SUM(i.total),0) total,
      COALESCE(SUM(i.cogs),0) cogs FROM invoices i ${where} GROUP BY i.date ORDER BY i.date`).all(params);
  const byParty = db.prepare(`SELECT i.party_id, COALESCE(i.party_name,'(بدون طرف حساب)') party_name,
      COUNT(*) count, COALESCE(SUM(i.total),0) total, COALESCE(SUM(i.due),0) due
    FROM invoices i ${where} GROUP BY i.party_id ORDER BY total DESC`).all(params);
  const byProduct = db.prepare(`SELECT ii.product_id, ii.product_name, SUM(ii.qty) qty,
      COALESCE(SUM(ii.line_total),0) amount, COALESCE(SUM(ii.cost_total),0) cost
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id ${where}
    GROUP BY ii.product_id ORDER BY amount DESC`).all(params);
  return { rows, summary: { ...summary, profit: (summary.taxable || 0) - (summary.cogs || 0) }, byDay, byParty, byProduct };
}

/** گزارش دفتر روزنامه */
function journal(db, opts = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (opts.from) { where += ' AND e.date>=@from'; params.from = opts.from; }
  if (opts.to) { where += ' AND e.date<=@to'; params.to = opts.to; }
  if (opts.refType) { where += ' AND e.ref_type=@ref'; params.ref = opts.refType; }
  if (opts.q) { where += ' AND (e.description LIKE @q OR e.entry_no LIKE @q)'; params.q = '%' + opts.q + '%'; }
  const limit = Math.min(Number(opts.limit) || 300, 5000);
  const offset = Number(opts.offset) || 0;
  const entries = db.prepare(`SELECT e.* FROM journal_entries e ${where}
    ORDER BY e.date DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  const ids = entries.map((e) => e.id);
  let lines = [];
  if (ids.length) {
    lines = db.prepare(`SELECT l.*, a.name account_name, p.name party_name
      FROM journal_lines l JOIN accounts a ON a.code=l.account_code
      LEFT JOIN parties p ON p.id=l.party_id
      WHERE l.entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.id`).all(...ids);
  }
  const byEntry = {};
  for (const l of lines) { (byEntry[l.entry_id] = byEntry[l.entry_id] || []).push(l); }
  const total = db.prepare(`SELECT COUNT(*) c FROM journal_entries e ${where}`).get(params).c;
  const sums = db.prepare(`SELECT COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id ${where}`).get(params);
  return {
    rows: entries.map((e) => ({ ...e, lines: byEntry[e.id] || [] })),
    total, sums,
  };
}

/** گزارش خزانه: گردش یک حساب نقدی */
function treasuryReport(db, code, opts = {}) {
  const led = accounting.ledger(db, code, opts);
  const inflow = led.rows.reduce((a, x) => a + x.debit, 0);
  const outflow = led.rows.reduce((a, x) => a + x.credit, 0);
  return { ...led, inflow, outflow };
}

/** خلاصه مالی روزانه */
function dailySummary(db, date) {
  const d = date || todayIso();
  const sales = invoiceSummary(db, 'sale', d, d);
  const purchases = invoiceSummary(db, 'purchase', d, d);
  const salesReturns = invoiceSummary(db, 'sale_return', d, d);
  const purchaseReturns = invoiceSummary(db, 'purchase_return', d, d);
  const pl = accounting.profitLoss(db, { from: d, to: d });
  const received = db.prepare(`SELECT method, COALESCE(SUM(amount),0) amount FROM payment_lines
    WHERE direction='in' AND date=? GROUP BY method`).all(d);
  const paid = db.prepare(`SELECT method, COALESCE(SUM(amount),0) amount FROM payment_lines
    WHERE direction='out' AND date=? GROUP BY method`).all(d);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE date=? AND status='posted'`).get(d).v;
  const incomes = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM incomes WHERE date=? AND status='posted'`).get(d).v;
  return {
    date: d, sales, purchases, salesReturns, purchaseReturns,
    received, paid, expenses, incomes, profitLoss: pl,
    treasury: accounting.treasuryBalances(db, { to: d }),
  };
}

/** مانده همه مشتریان/تأمین‌کنندگان */
function partyBalances(db, type) {
  const code = type === 'supplier' ? ACC.PAYABLE : ACC.RECEIVABLE;
  const sign = type === 'supplier' ? -1 : 1;
  const rows = db.prepare(`
    SELECT p.id, p.name, p.phone, p.type,
      ${sign} * (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0)) balance
    FROM parties p LEFT JOIN journal_lines l ON l.party_id=p.id AND l.account_code=?
    WHERE p.type=? GROUP BY p.id ORDER BY balance DESC`).all(code, type === 'supplier' ? 'supplier' : 'customer');
  const withBalance = rows.filter((x) => x.balance !== 0);
  return { rows, withBalance, total: withBalance.reduce((a, x) => a + x.balance, 0) };
}

module.exports = {
  range, dashboard, salesReport, journal, treasuryReport, dailySummary,
  partyBalances, overdueReceivables, dailySeries, methodDistribution, invoiceSummary,
};
