'use strict';
/** ساخت خروجی اکسل چندشیتی با سرستون‌های فارسی و تاریخ شمسی */
const xlsx = require('./xlsx-writer');
const accounting = require('./accounting');
const inventory = require('./inventory');
const reports = require('./reports');
const checksSvc = require('./checks');
const invoicesSvc = require('./invoices');
const { isoToJalali } = require('../util/jalali');

const J = (iso) => isoToJalali(iso) || '';
const METHOD = accounting.METHOD_LABELS;
const TYPE = invoicesSvc.TYPE_LABELS;
const CHECK_STATUS = checksSvc.STATUS_LABELS;
const CHECK_KIND = { received: 'دریافتی', paid: 'پرداختی' };
const ACC_TYPE = {
  asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه',
};
const MOVE = inventory.MOVEMENT_LABELS;

function whereDate(opts) {
  const params = {};
  let sql = '';
  if (opts.from) { sql += ' AND date>=@from'; params.from = opts.from; }
  if (opts.to) { sql += ' AND date<=@to'; params.to = opts.to; }
  return { sql, params };
}

function invoiceSheet(db, type, name, opts) {
  const w = whereDate(opts);
  const rows = db.prepare(`SELECT * FROM invoices WHERE type=@type ${w.sql} ORDER BY date, id`)
    .all({ ...w.params, type });
  const totals = rows.filter((x) => x.status === 'posted').reduce((a, x) => ({
    subtotal: a.subtotal + x.subtotal, discount_total: a.discount_total + x.discount_total,
    taxable: a.taxable + x.taxable, vat: a.vat + x.vat, total: a.total + x.total,
    paid: a.paid + x.paid, due: a.due + x.due, cogs: a.cogs + x.cogs,
  }), { subtotal: 0, discount_total: 0, taxable: 0, vat: 0, total: 0, paid: 0, due: 0, cogs: 0 });
  return {
    name,
    title: name,
    subtitle: opts.from ? `از ${J(opts.from)} تا ${J(opts.to)}` : 'همه دوره‌ها',
    columns: [
      { header: 'شماره فاکتور', key: 'invoice_no', width: 16, type: 'center' },
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'طرف حساب', key: 'party_name', width: 26 },
      { header: 'جمع کالاها', key: 'subtotal', width: 16, type: 'money' },
      { header: 'تخفیف', key: 'discount_total', width: 14, type: 'money' },
      { header: 'مبلغ مشمول', key: 'taxable', width: 16, type: 'money' },
      { header: 'ارزش افزوده', key: 'vat', width: 14, type: 'money' },
      { header: 'مبلغ نهایی', key: 'total', width: 17, type: 'money' },
      { header: 'پرداخت‌شده', key: 'paid', width: 15, type: 'money' },
      { header: 'مانده', key: 'due', width: 14, type: 'money' },
      { header: 'بهای تمام‌شده', key: 'cogs', width: 16, type: 'money' },
      { header: 'وضعیت', key: 'status', width: 12, type: 'center', value: (r) => (r.status === 'void' ? 'ابطال‌شده' : 'ثبت‌شده') },
      { header: 'توضیحات', key: 'notes', width: 24 },
    ],
    rows,
    totals,
  };
}

function build(db, opts = {}) {
  const sheets = [];
  const w = whereDate(opts);
  const period = opts.from ? `از ${J(opts.from)} تا ${J(opts.to)}` : 'همه دوره‌ها';

  // ۱..۴ فاکتورها
  sheets.push(invoiceSheet(db, 'sale', 'فروش', opts));
  sheets.push(invoiceSheet(db, 'purchase', 'خرید', opts));
  sheets.push(invoiceSheet(db, 'sale_return', 'برگشت از فروش', opts));
  sheets.push(invoiceSheet(db, 'purchase_return', 'برگشت از خرید', opts));

  // ۵ ریز اقلام فاکتورها
  const items = db.prepare(`SELECT i.type, i.invoice_no, i.date, i.party_name, ii.*
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE i.status='posted' ${w.sql.replace(/date/g, 'i.date')} ORDER BY i.date, i.id, ii.id`).all(w.params);
  sheets.push({
    name: 'ریز اقلام فاکتور',
    title: 'ریز اقلام فاکتورها', subtitle: period,
    columns: [
      { header: 'نوع سند', key: 'type', width: 16, value: (r) => TYPE[r.type] || r.type },
      { header: 'شماره فاکتور', key: 'invoice_no', width: 15, type: 'center' },
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'طرف حساب', key: 'party_name', width: 22 },
      { header: 'کالا', key: 'product_name', width: 28 },
      { header: 'کد کالا', key: 'product_code', width: 12, type: 'center' },
      { header: 'تعداد', key: 'qty', width: 10, type: 'qty' },
      { header: 'واحد', key: 'unit', width: 10, type: 'center' },
      { header: 'قیمت واحد', key: 'unit_price', width: 15, type: 'money' },
      { header: 'تخفیف', key: 'discount', width: 13, type: 'money' },
      { header: 'مبلغ ردیف', key: 'line_total', width: 16, type: 'money' },
      { header: 'بهای تمام‌شده', key: 'cost_total', width: 15, type: 'money' },
    ],
    rows: items,
  });

  // ۶ کالاها
  const products = db.prepare(`SELECT p.*, c.name category_name,
      CASE WHEN p.stock>0 THEN p.stock_value/p.stock ELSE p.buy_price END avg_cost
    FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.name`).all();
  sheets.push({
    name: 'کالاها',
    title: 'فهرست کالاها',
    columns: [
      { header: 'نام کالا', key: 'name', width: 30 },
      { header: 'کد', key: 'code', width: 12, type: 'center' },
      { header: 'بارکد', key: 'barcode', width: 16, type: 'center' },
      { header: 'دسته‌بندی', key: 'category_name', width: 16 },
      { header: 'واحد', key: 'unit', width: 10, type: 'center' },
      { header: 'قیمت خرید', key: 'buy_price', width: 15, type: 'money' },
      { header: 'قیمت فروش', key: 'sell_price', width: 15, type: 'money' },
      { header: 'موجودی', key: 'stock', width: 12, type: 'qty' },
      { header: 'حداقل موجودی', key: 'min_stock', width: 14, type: 'qty' },
      { header: 'وضعیت', key: 'active', width: 11, type: 'center', value: (r) => (r.active ? 'فعال' : 'غیرفعال') },
    ],
    rows: products,
  });

  // ۷ موجودی و ارزش انبار
  const valuation = inventory.valuationRows(db);
  sheets.push({
    name: 'موجودی انبار',
    title: 'موجودی و ارزش انبار',
    columns: [
      { header: 'نام کالا', key: 'name', width: 30 },
      { header: 'کد', key: 'code', width: 12, type: 'center' },
      { header: 'واحد', key: 'unit', width: 10, type: 'center' },
      { header: 'موجودی', key: 'stock', width: 12, type: 'qty' },
      { header: 'بهای میانگین', key: 'avg_cost', width: 16, type: 'money' },
      { header: 'ارزش موجودی', key: 'stock_value', width: 18, type: 'money' },
      { header: 'حداقل موجودی', key: 'min_stock', width: 14, type: 'qty' },
      { header: 'وضعیت', key: 'alert', width: 14, type: 'center', value: (r) => (r.min_stock > 0 && r.stock <= r.min_stock ? 'کمبود موجودی' : 'عادی') },
    ],
    rows: valuation,
    totals: { stock_value: valuation.reduce((a, x) => a + x.stock_value, 0) },
  });

  // ۸ گردش انبار
  const moves = db.prepare(`SELECT m.*, p.name product_name, p.code product_code
    FROM inventory_movements m JOIN products p ON p.id=m.product_id
    WHERE 1=1 ${w.sql.replace(/date/g, 'm.date')} ORDER BY m.date, m.id`).all(w.params);
  sheets.push({
    name: 'گردش انبار',
    title: 'گردش انبار', subtitle: period,
    columns: [
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'کالا', key: 'product_name', width: 28 },
      { header: 'نوع گردش', key: 'type', width: 16, value: (r) => MOVE[r.type] || r.type },
      { header: 'تعداد', key: 'qty', width: 12, type: 'qty' },
      { header: 'بهای واحد', key: 'unit_cost', width: 15, type: 'money' },
      { header: 'ارزش', key: 'value', width: 16, type: 'money' },
      { header: 'موجودی پس از گردش', key: 'balance_qty', width: 16, type: 'qty' },
      { header: 'ارزش موجودی', key: 'balance_value', width: 17, type: 'money' },
      { header: 'شرح', key: 'description', width: 30 },
    ],
    rows: moves,
  });

  // ۹/۱۰ مشتریان و تأمین‌کنندگان
  for (const [type, label] of [['customer', 'مشتریان'], ['supplier', 'تأمین‌کنندگان']]) {
    const bal = reports.partyBalances(db, type);
    const map = {};
    for (const b of bal.rows) map[b.id] = b.balance;
    const list = db.prepare('SELECT * FROM parties WHERE type=? ORDER BY name').all(type);
    sheets.push({
      name: label,
      title: `فهرست ${label}`,
      columns: [
        { header: 'نام', key: 'name', width: 28 },
        { header: 'تلفن', key: 'phone', width: 15, type: 'center' },
        { header: 'کد/شناسه ملی', key: 'national_id', width: 16, type: 'center' },
        { header: 'آدرس', key: 'address', width: 34 },
        { header: type === 'customer' ? 'مانده بدهکاری' : 'مانده بستانکاری', key: 'balance', width: 18, type: 'money', value: (r) => map[r.id] || 0 },
        { header: 'یادداشت', key: 'notes', width: 24 },
      ],
      rows: list,
      totals: { balance: bal.total },
    });
  }

  // ۱۱/۱۲ مانده حساب مشتریان و تأمین‌کنندگان
  for (const [type, label] of [['customer', 'مانده مشتریان'], ['supplier', 'مانده تأمین‌کنندگان']]) {
    const bal = reports.partyBalances(db, type);
    sheets.push({
      name: label,
      title: label,
      columns: [
        { header: 'نام', key: 'name', width: 28 },
        { header: 'تلفن', key: 'phone', width: 15, type: 'center' },
        { header: 'مانده', key: 'balance', width: 18, type: 'money' },
      ],
      rows: bal.withBalance,
      totals: { balance: bal.total },
    });
  }

  // ۱۳..۱۵ صندوق، کارتخوان، بانک
  for (const [code, label] of [['101', 'صندوق'], ['102', 'کارتخوان'], ['103', 'بانک']]) {
    const led = accounting.ledger(db, code, opts);
    sheets.push({
      name: 'گردش ' + label,
      title: `گردش حساب ${label}`, subtitle: period,
      columns: [
        { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
        { header: 'شماره سند', key: 'entry_no', width: 14, type: 'center' },
        { header: 'شرح', key: 'entry_desc', width: 44 },
        { header: 'دریافت', key: 'debit', width: 16, type: 'money' },
        { header: 'پرداخت', key: 'credit', width: 16, type: 'money' },
        { header: 'مانده', key: 'balance', width: 18, type: 'money' },
      ],
      rows: led.rows,
      totals: {
        debit: led.rows.reduce((a, x) => a + x.debit, 0),
        credit: led.rows.reduce((a, x) => a + x.credit, 0),
        balance: led.closing,
      },
    });
  }

  // ۱۶ چک‌ها
  const checks = db.prepare('SELECT * FROM checks ORDER BY due_date, id').all();
  sheets.push({
    name: 'چک‌ها',
    title: 'فهرست چک‌ها',
    columns: [
      { header: 'نوع', key: 'kind', width: 12, type: 'center', value: (r) => CHECK_KIND[r.kind] || r.kind },
      { header: 'شماره چک', key: 'number', width: 16, type: 'center' },
      { header: 'بانک', key: 'bank', width: 16 },
      { header: 'طرف حساب', key: 'party_name', width: 24 },
      { header: 'مبلغ', key: 'amount', width: 17, type: 'money' },
      { header: 'تاریخ صدور', key: 'issue_date', width: 13, type: 'center', value: (r) => J(r.issue_date) },
      { header: 'سررسید', key: 'due_date', width: 13, type: 'center', value: (r) => J(r.due_date) },
      { header: 'وضعیت', key: 'status', width: 14, type: 'center', value: (r) => CHECK_STATUS[r.status] || r.status },
      { header: 'تاریخ تسویه', key: 'settled_date', width: 13, type: 'center', value: (r) => J(r.settled_date) },
    ],
    rows: checks,
    totals: { amount: checks.reduce((a, x) => a + x.amount, 0) },
  });

  // ۱۷/۱۸ هزینه و درآمد
  const expenses = db.prepare(`SELECT * FROM expenses WHERE status='posted' ${w.sql} ORDER BY date, id`).all(w.params);
  sheets.push({
    name: 'هزینه‌ها',
    title: 'هزینه‌ها', subtitle: period,
    columns: [
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'دسته هزینه', key: 'category_name', width: 22 },
      { header: 'مبلغ', key: 'amount', width: 17, type: 'money' },
      { header: 'روش پرداخت', key: 'method', width: 14, type: 'center', value: (r) => METHOD[r.method] || r.method },
      { header: 'شرح', key: 'description', width: 36 },
    ],
    rows: expenses,
    totals: { amount: expenses.reduce((a, x) => a + x.amount, 0) },
  });
  const incomes = db.prepare(`SELECT * FROM incomes WHERE status='posted' ${w.sql} ORDER BY date, id`).all(w.params);
  sheets.push({
    name: 'درآمدها',
    title: 'درآمدهای متفرقه', subtitle: period,
    columns: [
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'دسته درآمد', key: 'category_name', width: 22 },
      { header: 'مبلغ', key: 'amount', width: 17, type: 'money' },
      { header: 'روش دریافت', key: 'method', width: 14, type: 'center', value: (r) => METHOD[r.method] || r.method },
      { header: 'شرح', key: 'description', width: 36 },
    ],
    rows: incomes,
    totals: { amount: incomes.reduce((a, x) => a + x.amount, 0) },
  });

  // ۱۹ دریافت و پرداخت
  const pays = db.prepare(`SELECT * FROM payments WHERE status='posted' ${w.sql} ORDER BY date, id`).all(w.params);
  sheets.push({
    name: 'دریافت و پرداخت',
    title: 'اسناد دریافت و پرداخت', subtitle: period,
    columns: [
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'نوع', key: 'kind', width: 12, type: 'center', value: (r) => (r.kind === 'receipt' ? 'دریافت' : 'پرداخت') },
      { header: 'طرف حساب', key: 'party_name', width: 26 },
      { header: 'مبلغ', key: 'amount', width: 17, type: 'money' },
      { header: 'شرح', key: 'description', width: 36 },
    ],
    rows: pays,
    totals: { amount: pays.reduce((a, x) => a + x.amount, 0) },
  });

  // ۲۰ دفتر روزنامه
  const jrows = db.prepare(`SELECT e.entry_no, e.date, e.ref_type, e.description entry_desc,
      l.account_code, a.name account_name, l.debit, l.credit, l.description line_desc,
      (SELECT name FROM parties WHERE id=l.party_id) party_name
    FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
    JOIN accounts a ON a.code=l.account_code
    WHERE 1=1 ${w.sql.replace(/date/g, 'e.date')} ORDER BY e.date, e.id, l.id`).all(w.params);
  sheets.push({
    name: 'دفتر روزنامه',
    title: 'دفتر روزنامه', subtitle: period,
    columns: [
      { header: 'شماره سند', key: 'entry_no', width: 14, type: 'center' },
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'شرح سند', key: 'entry_desc', width: 42 },
      { header: 'کد حساب', key: 'account_code', width: 12, type: 'center' },
      { header: 'نام حساب', key: 'account_name', width: 30 },
      { header: 'طرف حساب', key: 'party_name', width: 22 },
      { header: 'بدهکار', key: 'debit', width: 17, type: 'money' },
      { header: 'بستانکار', key: 'credit', width: 17, type: 'money' },
    ],
    rows: jrows,
    totals: {
      debit: jrows.reduce((a, x) => a + x.debit, 0),
      credit: jrows.reduce((a, x) => a + x.credit, 0),
    },
  });

  // ۲۱ دفتر کل (تراز آزمایشی)
  const tb = accounting.trialBalance(db, opts);
  sheets.push({
    name: 'دفتر کل',
    title: 'دفتر کل و تراز آزمایشی', subtitle: period,
    columns: [
      { header: 'کد حساب', key: 'code', width: 12, type: 'center' },
      { header: 'نام حساب', key: 'name', width: 34 },
      { header: 'نوع حساب', key: 'type', width: 14, type: 'center', value: (r) => ACC_TYPE[r.type] || r.type },
      { header: 'گردش بدهکار', key: 'debit', width: 18, type: 'money' },
      { header: 'گردش بستانکار', key: 'credit', width: 18, type: 'money' },
      { header: 'مانده بدهکار', key: 'debitBalance', width: 18, type: 'money' },
      { header: 'مانده بستانکار', key: 'creditBalance', width: 18, type: 'money' },
    ],
    rows: tb.rows,
    totals: {
      debit: tb.totals.debit, credit: tb.totals.credit,
      debitBalance: tb.totals.debitBalance, creditBalance: tb.totals.creditBalance,
    },
  });

  // ۲۲ کدینگ حساب‌ها
  const accs = db.prepare('SELECT * FROM accounts ORDER BY sort_order, code').all();
  sheets.push({
    name: 'کدینگ حساب‌ها',
    title: 'جدول حساب‌ها (کدینگ)',
    columns: [
      { header: 'کد', key: 'code', width: 12, type: 'center' },
      { header: 'نام حساب', key: 'name', width: 36 },
      { header: 'نوع', key: 'type', width: 14, type: 'center', value: (r) => ACC_TYPE[r.type] || r.type },
      { header: 'ماهیت', key: 'normal_side', width: 14, type: 'center', value: (r) => (r.normal_side === 'debit' ? 'بدهکار' : 'بستانکار') },
      { header: 'حساب بالادست', key: 'parent_code', width: 14, type: 'center' },
    ],
    rows: accs,
  });

  // ۲۳ سود و زیان
  const pl = accounting.profitLoss(db, opts);
  const plRows = [
    { item: 'فروش ناخالص', amount: pl.revenue },
    { item: 'کسر می‌شود: تخفیفات فروش', amount: -pl.discounts },
    { item: 'کسر می‌شود: برگشت از فروش', amount: -pl.returns },
    { item: 'فروش خالص', amount: pl.netSales },
    { item: 'کسر می‌شود: بهای تمام‌شده کالای فروش‌رفته', amount: -pl.cogs },
    { item: 'سود ناخالص', amount: pl.grossProfit },
    ...pl.expenseRows.map((x) => ({ item: 'هزینه: ' + x.name, amount: -x.amount })),
    { item: 'جمع هزینه‌های عملیاتی', amount: -pl.operatingExpenses },
    ...pl.otherIncomeRows.map((x) => ({ item: 'درآمد: ' + x.name, amount: x.amount })),
    { item: 'جمع درآمدهای متفرقه', amount: pl.otherIncome },
    { item: 'سود (زیان) خالص', amount: pl.netProfit },
  ];
  sheets.push({
    name: 'سود و زیان',
    title: 'صورت سود و زیان', subtitle: period,
    columns: [
      { header: 'شرح', key: 'item', width: 46 },
      { header: 'مبلغ', key: 'amount', width: 20, type: 'money' },
    ],
    rows: plRows,
  });

  // ۲۴ ارزش افزوده
  const vat = accounting.vatReport(db, opts);
  sheets.push({
    name: 'ارزش افزوده',
    title: 'گزارش مالیات بر ارزش افزوده', subtitle: period,
    columns: [
      { header: 'شماره فاکتور', key: 'invoice_no', width: 16, type: 'center' },
      { header: 'نوع سند', key: 'type', width: 16, value: (r) => TYPE[r.type] || r.type },
      { header: 'تاریخ', key: 'date', width: 13, type: 'center', value: (r) => J(r.date) },
      { header: 'طرف حساب', key: 'party_name', width: 26 },
      { header: 'مبلغ مشمول', key: 'taxable', width: 18, type: 'money' },
      { header: 'نرخ (٪)', key: 'vat_rate', width: 10, type: 'number' },
      { header: 'ارزش افزوده', key: 'vat', width: 17, type: 'money' },
      { header: 'مبلغ کل', key: 'total', width: 18, type: 'money' },
    ],
    rows: vat.details,
    totals: {
      taxable: vat.details.reduce((a, x) => a + x.taxable, 0),
      vat: vat.details.reduce((a, x) => a + x.vat, 0),
      total: vat.details.reduce((a, x) => a + x.total, 0),
    },
  });

  return xlsx.build(sheets);
}

module.exports = { build };
