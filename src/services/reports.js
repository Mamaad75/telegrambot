'use strict';
/* مرکز گزارش‌ها: داشبورد، سود و زیان، مالیات، گردش‌ها و روندها */
const journal = require('./journal.js');
const checksSvc = require('./checks.js');
const inventory = require('./inventory.js');
const payments = require('./payments.js');
const parties = require('./parties.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

function sumSide(db, code, from, to, side) {
  const where = ['jl.account_code = ?'];
  const args = [code];
  if (from) { where.push('je.date >= ?'); args.push(from); }
  if (to) { where.push('je.date <= ?'); args.push(to); }
  const sql = 'SELECT COALESCE(SUM(jl.' + (side === 'debit' ? 'debit' : 'credit') + '),0) s ' +
    'FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE ' + where.join(' AND ');
  return db.prepare(sql).get(...args).s;
}

/** صورت سود و زیان */
function profitAndLoss(db, opt) {
  const o = opt || {};
  const from = o.from, to = o.to;

  const grossRevenue = sumSide(db, C.ACC.SALES, from, to, 'credit');
  const salesReturns = sumSide(db, C.ACC.SALES, from, to, 'debit');
  const netSales = grossRevenue - salesReturns;

  const cogs = sumSide(db, C.ACC.COGS, from, to, 'debit') - sumSide(db, C.ACC.COGS, from, to, 'credit');
  const grossProfit = netSales - cogs;

  const opex = sumSide(db, C.ACC.OPERATING_EXPENSE, from, to, 'debit') - sumSide(db, C.ACC.OPERATING_EXPENSE, from, to, 'credit');
  const otherIncome = sumSide(db, C.ACC.OTHER_INCOME, from, to, 'credit') - sumSide(db, C.ACC.OTHER_INCOME, from, to, 'debit');
  const netProfit = grossProfit - opex + otherIncome;

  const dateWhere = [];
  const args = [];
  if (from) { dateWhere.push('date >= ?'); args.push(from); }
  if (to) { dateWhere.push('date <= ?'); args.push(to); }
  const w = dateWhere.length ? ' AND ' + dateWhere.join(' AND ') : '';
  const disc = db.prepare('SELECT COALESCE(SUM(line_discount),0) l, COALESCE(SUM(invoice_discount),0) i FROM sales_invoices WHERE status=\'active\'' + w).get(...args);

  const expenseByCategory = db.prepare(
    'SELECT COALESCE(ec.name, \'بدون دسته\') AS name, COALESCE(SUM(e.amount),0) AS total, COUNT(*) AS n ' +
    'FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id ' +
    'WHERE 1=1' + (dateWhere.length ? ' AND ' + dateWhere.map(function (x) { return 'e.' + x; }).join(' AND ') : '') +
    ' GROUP BY ec.id ORDER BY total DESC'
  ).all(...args);

  return {
    from: from, to: to,
    gross_revenue: grossRevenue,
    discounts: disc.l + disc.i,
    line_discount: disc.l,
    invoice_discount: disc.i,
    sales_returns: salesReturns,
    net_sales: netSales,
    cogs: cogs,
    gross_profit: grossProfit,
    operating_expenses: opex,
    other_income: otherIncome,
    net_profit: netProfit,
    expense_by_category: expenseByCategory,
    margin: netSales > 0 ? Math.round(grossProfit * 10000 / netSales) / 100 : 0
  };
}

/** گزارش مالیات بر ارزش افزوده */
function vatReport(db, opt) {
  const o = opt || {};
  const args = [];
  const where = ['status = \'active\''];
  if (o.from) { where.push('date >= ?'); args.push(o.from); }
  if (o.to) { where.push('date <= ?'); args.push(o.to); }
  const w = where.join(' AND ');
  const sales = db.prepare('SELECT COALESCE(SUM(taxable),0) base, COALESCE(SUM(vat_amount),0) vat, COUNT(*) n FROM sales_invoices WHERE ' + w).get(...args);
  const purch = db.prepare('SELECT COALESCE(SUM(taxable),0) base, COALESCE(SUM(vat_amount),0) vat, COUNT(*) n FROM purchase_invoices WHERE ' + w).get(...args);
  const sRet = db.prepare('SELECT COALESCE(SUM(subtotal),0) base, COALESCE(SUM(vat_amount),0) vat, COUNT(*) n FROM sales_returns WHERE ' + w).get(...args);
  const pRet = db.prepare('SELECT COALESCE(SUM(subtotal),0) base, COALESCE(SUM(vat_amount),0) vat, COUNT(*) n FROM purchase_returns WHERE ' + w).get(...args);
  const outputVat = sales.vat - sRet.vat;
  const inputVat = purch.vat - pRet.vat;
  return {
    from: o.from, to: o.to,
    sales: sales, purchases: purch, sales_returns: sRet, purchase_returns: pRet,
    output_vat: outputVat, input_vat: inputVat, net_vat: outputVat - inputVat,
    ledger_balance: journal.accountBalance(db, C.ACC.VAT_PAYABLE, { to: o.to })
  };
}

/** روند روزانه فروش / خرید / سود */
function trend(db, opt) {
  const o = opt || {};
  const from = o.from, to = o.to;
  const sales = db.prepare(
    'SELECT date, COALESCE(SUM(taxable),0) net, COALESCE(SUM(total),0) total, COALESCE(SUM(cogs),0) cogs, COUNT(*) n ' +
    'FROM sales_invoices WHERE status=\'active\' AND date BETWEEN ? AND ? GROUP BY date').all(from, to);
  const purchases = db.prepare(
    'SELECT date, COALESCE(SUM(total),0) total, COUNT(*) n FROM purchase_invoices WHERE status=\'active\' AND date BETWEEN ? AND ? GROUP BY date').all(from, to);
  const expenses = db.prepare('SELECT date, COALESCE(SUM(amount),0) total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date').all(from, to);
  const sReturns = db.prepare('SELECT date, COALESCE(SUM(subtotal),0) net, COALESCE(SUM(cogs),0) cogs FROM sales_returns WHERE status=\'active\' AND date BETWEEN ? AND ? GROUP BY date').all(from, to);

  const map = {};
  const ensure = function (d) {
    if (!map[d]) map[d] = { date: d, date_jalali: Jalali.isoToJalali(d), sales: 0, sales_net: 0, cogs: 0, purchases: 0, expenses: 0, profit: 0, count: 0 };
    return map[d];
  };
  for (const r of sales) { const x = ensure(r.date); x.sales = r.total; x.sales_net = r.net; x.cogs = r.cogs; x.count = r.n; }
  for (const r of purchases) { const x = ensure(r.date); x.purchases = r.total; }
  for (const r of expenses) { const x = ensure(r.date); x.expenses = r.total; }
  for (const r of sReturns) { const x = ensure(r.date); x.sales_net -= r.net; x.cogs -= r.cogs; }

  // پر کردن روزهای خالی
  let cursor = from;
  const out = [];
  let guard = 0;
  while (cursor <= to && guard < 1000) {
    const x = ensure(cursor);
    x.profit = x.sales_net - x.cogs - x.expenses;
    out.push(x);
    cursor = Jalali.isoAddDays(cursor, 1);
    guard++;
  }
  return out;
}

/** داشبورد اصلی */
function dashboard(db, opt) {
  const o = opt || {};
  const today = o.today || Jalali.todayIso();
  const from = o.from || today;
  const to = o.to || today;

  const pl = profitAndLoss(db, { from: from, to: to });
  const salesAgg = db.prepare('SELECT COALESCE(SUM(total),0) total, COUNT(*) n FROM sales_invoices WHERE status=\'active\' AND date BETWEEN ? AND ?').get(from, to);
  const purchAgg = db.prepare('SELECT COALESCE(SUM(total),0) total, COUNT(*) n FROM purchase_invoices WHERE status=\'active\' AND date BETWEEN ? AND ?').get(from, to);

  const cash = journal.accountBalance(db, C.ACC.CASH, { to: to });
  const pos = journal.accountBalance(db, C.ACC.POS, { to: to });
  const bank = journal.accountBalance(db, C.ACC.BANK, { to: to });
  const receivable = journal.accountBalance(db, C.ACC.RECEIVABLE, { to: to });
  const payable = journal.accountBalance(db, C.ACC.PAYABLE, { to: to });
  const inv = inventory.totalValue(db);
  const checkSummary = checksSvc.summary(db, today);

  const banks = db.prepare('SELECT id, title, kind FROM bank_accounts WHERE active=1 ORDER BY kind, title').all();
  for (const b of banks) {
    b.balance = journal.accountBalance(db, b.kind === 'pos' ? C.ACC.POS : C.ACC.BANK, { bank_account_id: b.id, to: to });
  }

  const overdueReceivables = db.prepare(
    'SELECT si.id, si.invoice_no, si.date, si.total, c.name AS customer_name, ' +
    ' (SELECT COALESCE(SUM(CASE WHEN direction=\'in\' THEN total ELSE -total END),0) FROM payments WHERE ref_type=\'sales_invoice\' AND ref_id=si.id) AS paid ' +
    'FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id ' +
    'WHERE si.status=\'active\' AND si.date <= ? ORDER BY si.date LIMIT 500'
  ).all(Jalali.isoAddDays(today, -1)).filter(function (r) { return r.total - r.paid > 0; }).slice(0, 20)
    .map(function (r) {
      r.remaining = r.total - r.paid;
      r.days = Jalali.isoDiffDays(today, r.date);
      r.date_jalali = Jalali.isoToJalali(r.date);
      return r;
    });

  const lowStock = inventory.lowStock(db, 20);
  const methodMix = payments.methodBreakdown(db, { from: from, to: to, direction: 'in' });
  const trendRange = { from: o.trend_from || Jalali.isoAddDays(to, -13), to: to };

  return {
    range: { from: from, to: to, label: o.label || '' },
    sales_total: salesAgg.total, sales_count: salesAgg.n,
    purchases_total: purchAgg.total, purchases_count: purchAgg.n,
    profit: pl.net_profit, gross_profit: pl.gross_profit, cogs: pl.cogs,
    net_sales: pl.net_sales, expenses: pl.operating_expenses, other_income: pl.other_income,
    cash: cash, pos: pos, bank: bank, liquid_total: cash + pos + bank,
    receivable: receivable, payable: payable,
    inventory_value: inv.value, inventory_qty: inv.qty,
    checks: checkSummary,
    bank_accounts: banks,
    overdue_receivables: overdueReceivables,
    low_stock: lowStock,
    payment_mix: methodMix,
    trend: trend(db, trendRange),
    today: today
  };
}

/** گزارش فروش تجمیعی */
function salesReport(db, opt) {
  const o = opt || {};
  const rows = db.prepare(
    'SELECT si.id, si.invoice_no, si.date, si.subtotal, si.line_discount, si.invoice_discount, si.taxable, si.vat_amount, si.total, si.cogs, ' +
    ' c.name AS customer_name, ' +
    ' (SELECT COALESCE(SUM(CASE WHEN direction=\'in\' THEN total ELSE -total END),0) FROM payments WHERE ref_type=\'sales_invoice\' AND ref_id=si.id) AS paid ' +
    'FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id ' +
    'WHERE si.status=\'active\' AND si.date BETWEEN ? AND ? ORDER BY si.date, si.id'
  ).all(o.from, o.to);
  let totals = { subtotal: 0, discount: 0, taxable: 0, vat: 0, total: 0, cogs: 0, paid: 0, profit: 0 };
  for (const r of rows) {
    r.remaining = r.total - r.paid;
    r.profit = r.taxable - r.cogs;
    r.date_jalali = Jalali.isoToJalali(r.date);
    totals.subtotal += r.subtotal;
    totals.discount += r.line_discount + r.invoice_discount;
    totals.taxable += r.taxable;
    totals.vat += r.vat_amount;
    totals.total += r.total;
    totals.cogs += r.cogs;
    totals.paid += r.paid;
    totals.profit += r.profit;
  }
  return { rows: rows, totals: totals };
}

function purchasesReport(db, opt) {
  const o = opt || {};
  const rows = db.prepare(
    'SELECT pi.id, pi.invoice_no, pi.date, pi.subtotal, pi.line_discount, pi.invoice_discount, pi.taxable, pi.vat_amount, pi.total, ' +
    ' s.name AS supplier_name, ' +
    ' (SELECT COALESCE(SUM(CASE WHEN direction=\'out\' THEN total ELSE -total END),0) FROM payments WHERE ref_type=\'purchase_invoice\' AND ref_id=pi.id) AS paid ' +
    'FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id=pi.supplier_id ' +
    'WHERE pi.status=\'active\' AND pi.date BETWEEN ? AND ? ORDER BY pi.date, pi.id'
  ).all(o.from, o.to);
  let totals = { subtotal: 0, discount: 0, taxable: 0, vat: 0, total: 0, paid: 0 };
  for (const r of rows) {
    r.remaining = r.total - r.paid;
    r.date_jalali = Jalali.isoToJalali(r.date);
    totals.subtotal += r.subtotal;
    totals.discount += r.line_discount + r.invoice_discount;
    totals.taxable += r.taxable;
    totals.vat += r.vat_amount;
    totals.total += r.total;
    totals.paid += r.paid;
  }
  return { rows: rows, totals: totals };
}

/** پرفروش‌ترین کالاها */
function topProducts(db, opt) {
  const o = opt || {};
  return db.prepare(
    'SELECT p.id, p.name, p.code, p.unit, SUM(ii.qty) AS qty, SUM(ii.net_total) AS revenue, SUM(ii.cogs) AS cost, ' +
    ' SUM(ii.net_total) - SUM(ii.cogs) AS profit ' +
    'FROM sales_invoice_items ii JOIN sales_invoices si ON si.id=ii.invoice_id JOIN products p ON p.id=ii.product_id ' +
    'WHERE si.status=\'active\' AND si.date BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT ?'
  ).all(o.from, o.to, o.limit || 20);
}

/** خلاصه مالی روزانه */
function dailySummary(db, opt) {
  const o = opt || {};
  const date = o.date || Jalali.todayIso();
  const sales = db.prepare('SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM sales_invoices WHERE status=\'active\' AND date=?').get(date);
  const purch = db.prepare('SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM purchase_invoices WHERE status=\'active\' AND date=?').get(date);
  const receipts = db.prepare('SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM payments WHERE direction=\'in\' AND date=?').get(date);
  const paid = db.prepare('SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM payments WHERE direction=\'out\' AND date=?').get(date);
  const expenses = db.prepare('SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM expenses WHERE date=?').get(date);
  const incomes = db.prepare('SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM incomes WHERE date=?').get(date);
  const pl = profitAndLoss(db, { from: date, to: date });
  const mix = payments.methodBreakdown(db, { from: date, to: date });
  return {
    date: date, date_jalali: Jalali.isoToJalali(date), date_long: Jalali.longDate(date),
    sales: sales, purchases: purch, receipts: receipts, payments: paid,
    expenses: expenses, incomes: incomes,
    profit: pl.net_profit, gross_profit: pl.gross_profit, cogs: pl.cogs, net_sales: pl.net_sales,
    payment_mix: mix,
    balances: {
      cash: journal.accountBalance(db, C.ACC.CASH, { to: date }),
      pos: journal.accountBalance(db, C.ACC.POS, { to: date }),
      bank: journal.accountBalance(db, C.ACC.BANK, { to: date })
    }
  };
}

/** ترازنامه ساده */
function balanceSheet(db, opt) {
  const o = opt || {};
  const to = o.to || Jalali.todayIso();
  const tb = journal.trialBalance(db, { to: to });
  const assets = tb.filter(function (r) { return r.type === 'asset'; });
  const liabilities = tb.filter(function (r) { return r.type === 'liability'; });
  const equity = tb.filter(function (r) { return r.type === 'equity'; });
  const income = tb.filter(function (r) { return r.type === 'income'; });
  const expense = tb.filter(function (r) { return r.type === 'expense'; });
  const sum = function (list) { return list.reduce(function (a, r) { return a + r.balance; }, 0); };
  const retained = sum(income) - sum(expense);
  return {
    to: to,
    assets: assets, liabilities: liabilities, equity: equity,
    total_assets: sum(assets), total_liabilities: sum(liabilities),
    total_equity: sum(equity), retained_earnings: retained,
    balanced: sum(assets) === sum(liabilities) + sum(equity) + retained
  };
}

/** بررسی سلامت حسابداری: تراز بودن همه اسناد */
function integrity(db) {
  const unbalanced = db.prepare(
    'SELECT je.id, je.entry_no, je.date, je.description, ' +
    ' COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c ' +
    'FROM journal_entries je LEFT JOIN journal_lines jl ON jl.entry_id=je.id ' +
    'GROUP BY je.id HAVING d <> c'
  ).all();
  const tb = journal.trialBalance(db, {});
  const totalDebit = tb.reduce(function (a, r) { return a + r.debit; }, 0);
  const totalCredit = tb.reduce(function (a, r) { return a + r.credit; }, 0);
  const invGl = journal.accountBalance(db, C.ACC.INVENTORY, {});
  const invStock = inventory.totalValue(db).value;
  const orphanLines = db.prepare('SELECT COUNT(*) c FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.entry_id WHERE je.id IS NULL').get().c;
  return {
    unbalanced_entries: unbalanced,
    total_debit: totalDebit,
    total_credit: totalCredit,
    trial_balanced: totalDebit === totalCredit,
    inventory_gl: invGl,
    inventory_stock_value: invStock,
    inventory_matches: invGl === invStock,
    orphan_lines: orphanLines,
    ok: unbalanced.length === 0 && totalDebit === totalCredit && invGl === invStock && orphanLines === 0
  };
}

/** گزارش مانده مشتریان و تأمین‌کنندگان */
function partyBalances(db, type, opt) {
  return parties.balances(db, type, opt);
}

module.exports = {
  profitAndLoss: profitAndLoss, vatReport: vatReport, trend: trend, dashboard: dashboard,
  salesReport: salesReport, purchasesReport: purchasesReport, topProducts: topProducts,
  dailySummary: dailySummary, balanceSheet: balanceSheet, integrity: integrity,
  partyBalances: partyBalances
};
