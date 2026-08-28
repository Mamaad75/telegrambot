'use strict';
/*
 * خروجی اکسل حرفه‌ای (xlsx) با نام شیت‌ها و سرستون‌های فارسی و جهت راست‌به‌چپ.
 */
const ExcelJS = require('exceljs');
const journal = require('./journal.js');
const reports = require('./reports.js');
const inventory = require('./inventory.js');
const parties = require('./parties.js');
const settings = require('./settings.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Tahoma', size: 10 };
const BODY_FONT = { name: 'Tahoma', size: 10 };
const MONEY_FMT = '#,##0';

function addSheet(wb, name, columns, rows, opt) {
  const options = opt || {};
  const ws = wb.addWorksheet(name.substring(0, 31), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 }
  });
  ws.columns = columns.map(function (c) {
    return { header: c.header, key: c.key, width: c.width || 16, style: c.money ? { numFmt: MONEY_FMT } : undefined };
  });
  const headerRow = ws.getRow(1);
  headerRow.font = HEADER_FONT;
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;

  for (const r of rows) ws.addRow(r);

  ws.eachRow(function (row, i) {
    if (i === 1) return;
    row.font = BODY_FONT;
    row.alignment = { vertical: 'middle' };
  });

  if (options.totals) {
    const totalRow = ws.addRow(options.totals);
    totalRow.font = { bold: true, name: 'Tahoma', size: 10 };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

function jal(d) { return d ? Jalali.isoToJalali(d) : ''; }

/** ساخت فایل اکسل کامل از تمام اطلاعات برنامه */
async function exportAll(db, filePath, opt) {
  const o = opt || {};
  const from = o.from || '1000-01-01';
  const to = o.to || '9999-12-31';
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.get(db, 'shop_name', 'فروشگاه');
  wb.created = new Date();

  /* ---------------- فروش ---------------- */
  const sales = reports.salesReport(db, { from: from, to: to });
  addSheet(wb, 'فروش', [
    { header: 'شماره فاکتور', key: 'invoice_no', width: 16 },
    { header: 'تاریخ', key: 'date_jalali', width: 12 },
    { header: 'مشتری', key: 'customer_name', width: 24 },
    { header: 'جمع کل', key: 'subtotal', width: 16, money: true },
    { header: 'تخفیف ردیف', key: 'line_discount', width: 14, money: true },
    { header: 'تخفیف فاکتور', key: 'invoice_discount', width: 14, money: true },
    { header: 'مبلغ مشمول مالیات', key: 'taxable', width: 18, money: true },
    { header: 'مالیات', key: 'vat_amount', width: 14, money: true },
    { header: 'مبلغ نهایی', key: 'total', width: 16, money: true },
    { header: 'بهای تمام‌شده', key: 'cogs', width: 16, money: true },
    { header: 'سود', key: 'profit', width: 14, money: true },
    { header: 'پرداخت‌شده', key: 'paid', width: 16, money: true },
    { header: 'مانده', key: 'remaining', width: 14, money: true }
  ], sales.rows, {
    totals: {
      invoice_no: 'جمع', subtotal: sales.totals.subtotal, taxable: sales.totals.taxable,
      vat_amount: sales.totals.vat, total: sales.totals.total, cogs: sales.totals.cogs,
      profit: sales.totals.profit, paid: sales.totals.paid
    }
  });

  /* ---------------- خرید ---------------- */
  const purch = reports.purchasesReport(db, { from: from, to: to });
  addSheet(wb, 'خرید', [
    { header: 'شماره فاکتور', key: 'invoice_no', width: 16 },
    { header: 'تاریخ', key: 'date_jalali', width: 12 },
    { header: 'تأمین‌کننده', key: 'supplier_name', width: 24 },
    { header: 'جمع کل', key: 'subtotal', width: 16, money: true },
    { header: 'تخفیف', key: 'invoice_discount', width: 14, money: true },
    { header: 'مبلغ مشمول مالیات', key: 'taxable', width: 18, money: true },
    { header: 'مالیات', key: 'vat_amount', width: 14, money: true },
    { header: 'مبلغ نهایی', key: 'total', width: 16, money: true },
    { header: 'پرداخت‌شده', key: 'paid', width: 16, money: true },
    { header: 'مانده', key: 'remaining', width: 14, money: true }
  ], purch.rows, {
    totals: { invoice_no: 'جمع', subtotal: purch.totals.subtotal, taxable: purch.totals.taxable, vat_amount: purch.totals.vat, total: purch.totals.total, paid: purch.totals.paid }
  });

  /* ---------------- برگشتی‌ها ---------------- */
  const sRet = db.prepare('SELECT sr.*, c.name AS customer_name, si.invoice_no FROM sales_returns sr ' +
    'LEFT JOIN customers c ON c.id=sr.customer_id LEFT JOIN sales_invoices si ON si.id=sr.invoice_id ' +
    'WHERE sr.status=\'active\' AND sr.date BETWEEN ? AND ? ORDER BY sr.date').all(from, to);
  addSheet(wb, 'برگشت از فروش', [
    { header: 'شماره سند', key: 'return_no', width: 16 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'فاکتور مرتبط', key: 'invoice_no', width: 16 },
    { header: 'مشتری', key: 'customer_name', width: 24 },
    { header: 'مبلغ', key: 'subtotal', width: 16, money: true },
    { header: 'مالیات', key: 'vat_amount', width: 14, money: true },
    { header: 'جمع', key: 'total', width: 16, money: true },
    { header: 'بهای تمام‌شده', key: 'cogs', width: 16, money: true }
  ], sRet.map(function (r) { r.date_j = jal(r.date); return r; }));

  const pRet = db.prepare('SELECT pr.*, s.name AS supplier_name, pi.invoice_no FROM purchase_returns pr ' +
    'LEFT JOIN suppliers s ON s.id=pr.supplier_id LEFT JOIN purchase_invoices pi ON pi.id=pr.invoice_id ' +
    'WHERE pr.status=\'active\' AND pr.date BETWEEN ? AND ? ORDER BY pr.date').all(from, to);
  addSheet(wb, 'برگشت از خرید', [
    { header: 'شماره سند', key: 'return_no', width: 16 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'فاکتور مرتبط', key: 'invoice_no', width: 16 },
    { header: 'تأمین‌کننده', key: 'supplier_name', width: 24 },
    { header: 'مبلغ', key: 'subtotal', width: 16, money: true },
    { header: 'مالیات', key: 'vat_amount', width: 14, money: true },
    { header: 'جمع', key: 'total', width: 16, money: true }
  ], pRet.map(function (r) { r.date_j = jal(r.date); return r; }));

  /* ---------------- کالا و انبار ---------------- */
  const prods = db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.name').all();
  addSheet(wb, 'کالاها', [
    { header: 'کد', key: 'code', width: 12 },
    { header: 'بارکد', key: 'barcode', width: 16 },
    { header: 'نام کالا', key: 'name', width: 30 },
    { header: 'دسته', key: 'category_name', width: 16 },
    { header: 'واحد', key: 'unit', width: 10 },
    { header: 'قیمت خرید', key: 'purchase_price', width: 14, money: true },
    { header: 'قیمت فروش', key: 'sale_price', width: 14, money: true },
    { header: 'موجودی', key: 'stock_qty', width: 12 },
    { header: 'حداقل موجودی', key: 'min_stock', width: 14 },
    { header: 'ارزش موجودی', key: 'stock_value', width: 16, money: true },
    { header: 'وضعیت', key: 'status_label', width: 12 }
  ], prods.map(function (p) { p.status_label = p.active ? 'فعال' : 'غیرفعال'; return p; }));

  const val = inventory.valuation(db);
  addSheet(wb, 'موجودی انبار', [
    { header: 'کد', key: 'code', width: 12 },
    { header: 'نام کالا', key: 'name', width: 30 },
    { header: 'دسته', key: 'category_name', width: 16 },
    { header: 'واحد', key: 'unit', width: 10 },
    { header: 'تعداد', key: 'stock_qty', width: 12 },
    { header: 'بهای میانگین', key: 'avg_cost', width: 16, money: true },
    { header: 'ارزش کل', key: 'stock_value', width: 18, money: true }
  ], val, { totals: { name: 'جمع ارزش موجودی', stock_value: val.reduce(function (a, r) { return a + r.stock_value; }, 0) } });

  const moves = inventory.moves(db, { from: from, to: to, limit: 100000 });
  addSheet(wb, 'گردش انبار', [
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'کالا', key: 'product_name', width: 28 },
    { header: 'نوع', key: 'type_label', width: 16 },
    { header: 'تعداد', key: 'qty', width: 12 },
    { header: 'بهای واحد', key: 'unit_cost', width: 14, money: true },
    { header: 'ارزش', key: 'value', width: 16, money: true },
    { header: 'موجودی پس از عملیات', key: 'balance_qty', width: 18 },
    { header: 'مرجع', key: 'ref_no', width: 16 },
    { header: 'شرح', key: 'description', width: 30 }
  ], moves.map(function (m) { m.date_j = jal(m.date); m.type_label = C.MOVE_TYPES[m.move_type] || m.move_type; return m; }));

  /* ---------------- طرف‌حساب‌ها ---------------- */
  const custs = parties.list(db, 'customer', { limit: 100000 });
  addSheet(wb, 'مشتریان', [
    { header: 'نام', key: 'name', width: 28 },
    { header: 'تلفن', key: 'phone', width: 16 },
    { header: 'کد ملی', key: 'national_id', width: 16 },
    { header: 'آدرس', key: 'address', width: 34 },
    { header: 'مانده (بدهکار)', key: 'balance', width: 18, money: true }
  ], custs);

  const sups = parties.list(db, 'supplier', { limit: 100000 });
  addSheet(wb, 'تأمین‌کنندگان', [
    { header: 'نام', key: 'name', width: 28 },
    { header: 'تلفن', key: 'phone', width: 16 },
    { header: 'آدرس', key: 'address', width: 34 },
    { header: 'مانده (بستانکار)', key: 'balance', width: 18, money: true }
  ], sups);

  const cBal = parties.balances(db, 'customer', { nonZeroOnly: true });
  addSheet(wb, 'مانده مشتریان', [
    { header: 'نام', key: 'name', width: 28 },
    { header: 'تلفن', key: 'phone', width: 16 },
    { header: 'بدهکار', key: 'debit', width: 16, money: true },
    { header: 'بستانکار', key: 'credit', width: 16, money: true },
    { header: 'مانده', key: 'balance', width: 16, money: true }
  ], cBal, { totals: { name: 'جمع', balance: cBal.reduce(function (a, r) { return a + r.balance; }, 0) } });

  const sBal = parties.balances(db, 'supplier', { nonZeroOnly: true });
  addSheet(wb, 'مانده تأمین‌کنندگان', [
    { header: 'نام', key: 'name', width: 28 },
    { header: 'تلفن', key: 'phone', width: 16 },
    { header: 'بدهکار', key: 'debit', width: 16, money: true },
    { header: 'بستانکار', key: 'credit', width: 16, money: true },
    { header: 'مانده', key: 'balance', width: 16, money: true }
  ], sBal, { totals: { name: 'جمع', balance: sBal.reduce(function (a, r) { return a + r.balance; }, 0) } });

  /* ---------------- خزانه ---------------- */
  const cashCols = [
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'شماره سند', key: 'entry_no', width: 12 },
    { header: 'شرح', key: 'description', width: 40 },
    { header: 'مرجع', key: 'ref_no', width: 16 },
    { header: 'بدهکار (ورود)', key: 'debit', width: 16, money: true },
    { header: 'بستانکار (خروج)', key: 'credit', width: 16, money: true },
    { header: 'مانده', key: 'balance', width: 18, money: true }
  ];
  const mapLedger = function (code) {
    const led = journal.ledger(db, code, { from: from, to: to });
    return led.rows.map(function (r) { r.date_j = jal(r.date); r.description = r.description || r.entry_desc; return r; });
  };
  addSheet(wb, 'گردش صندوق', cashCols, mapLedger(C.ACC.CASH));
  addSheet(wb, 'گردش کارتخوان', cashCols, mapLedger(C.ACC.POS));
  addSheet(wb, 'گردش بانک', cashCols, mapLedger(C.ACC.BANK));

  const banks = db.prepare('SELECT * FROM bank_accounts ORDER BY kind, title').all();
  addSheet(wb, 'حساب‌های بانکی', [
    { header: 'عنوان', key: 'title', width: 24 },
    { header: 'نوع', key: 'kind_label', width: 14 },
    { header: 'بانک', key: 'bank_name', width: 18 },
    { header: 'شعبه', key: 'branch', width: 16 },
    { header: 'شماره حساب', key: 'account_number', width: 22 },
    { header: 'شماره کارت', key: 'card_number', width: 22 },
    { header: 'شبا', key: 'iban', width: 30 },
    { header: 'صاحب حساب', key: 'owner_name', width: 20 },
    { header: 'مانده', key: 'balance', width: 18, money: true }
  ], banks.map(function (b) {
    b.kind_label = b.kind === 'pos' ? 'کارتخوان' : 'حساب بانکی';
    b.balance = journal.accountBalance(db, b.kind === 'pos' ? C.ACC.POS : C.ACC.BANK, { bank_account_id: b.id, to: to });
    return b;
  }));

  /* ---------------- چک‌ها ---------------- */
  const checks = db.prepare(
    'SELECT ch.*, COALESCE(cu.name, su.name) AS party_name, ba.title AS bank_title FROM checks ch ' +
    'LEFT JOIN customers cu ON ch.party_type=\'customer\' AND cu.id=ch.party_id ' +
    'LEFT JOIN suppliers su ON ch.party_type=\'supplier\' AND su.id=ch.party_id ' +
    'LEFT JOIN bank_accounts ba ON ba.id=ch.bank_account_id ORDER BY ch.due_date').all();
  addSheet(wb, 'چک‌ها', [
    { header: 'کد یکتا', key: 'check_code', width: 18 },
    { header: 'نوع', key: 'direction_label', width: 14 },
    { header: 'شماره چک', key: 'check_number', width: 18 },
    { header: 'شناسه صیادی', key: 'sayad_id', width: 20 },
    { header: 'بانک', key: 'bank_name', width: 16 },
    { header: 'دارنده / صادرکننده', key: 'holder_name', width: 24 },
    { header: 'طرف حساب', key: 'party_name', width: 22 },
    { header: 'مبلغ', key: 'amount', width: 18, money: true },
    { header: 'تاریخ صدور', key: 'issue_j', width: 12 },
    { header: 'سررسید', key: 'due_j', width: 12 },
    { header: 'وضعیت', key: 'status_label', width: 18 },
    { header: 'فاکتور مرتبط', key: 'ref_no', width: 16 },
    { header: 'حساب بانکی', key: 'bank_title', width: 20 },
    { header: 'توضیحات', key: 'note', width: 26 }
  ], checks.map(function (c) {
    c.direction_label = C.CHECK_DIRECTION[c.direction] || c.direction;
    c.status_label = C.CHECK_STATUS[c.status] || c.status;
    c.issue_j = jal(c.issue_date);
    c.due_j = jal(c.due_date);
    return c;
  }));

  /* ---------------- هزینه و درآمد ---------------- */
  const exps = db.prepare('SELECT e.*, ec.name AS category_name, ba.title AS bank_title FROM expenses e ' +
    'LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN bank_accounts ba ON ba.id=e.bank_account_id ' +
    'WHERE e.date BETWEEN ? AND ? ORDER BY e.date').all(from, to);
  addSheet(wb, 'هزینه‌ها', [
    { header: 'شماره سند', key: 'doc_no', width: 14 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'دسته', key: 'category_name', width: 18 },
    { header: 'مبلغ', key: 'amount', width: 16, money: true },
    { header: 'روش پرداخت', key: 'method_label', width: 16 },
    { header: 'حساب', key: 'bank_title', width: 18 },
    { header: 'شرح', key: 'description', width: 34 }
  ], exps.map(function (e) { e.date_j = jal(e.date); e.method_label = C.PAY_METHOD_LABEL[e.method] || e.method; return e; }),
    { totals: { doc_no: 'جمع', amount: exps.reduce(function (a, r) { return a + r.amount; }, 0) } });

  const incs = db.prepare('SELECT i.*, ic.name AS category_name, ba.title AS bank_title FROM incomes i ' +
    'LEFT JOIN income_categories ic ON ic.id=i.category_id LEFT JOIN bank_accounts ba ON ba.id=i.bank_account_id ' +
    'WHERE i.date BETWEEN ? AND ? ORDER BY i.date').all(from, to);
  addSheet(wb, 'درآمدها', [
    { header: 'شماره سند', key: 'doc_no', width: 14 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'دسته', key: 'category_name', width: 18 },
    { header: 'مبلغ', key: 'amount', width: 16, money: true },
    { header: 'روش دریافت', key: 'method_label', width: 16 },
    { header: 'حساب', key: 'bank_title', width: 18 },
    { header: 'شرح', key: 'description', width: 34 }
  ], incs.map(function (e) { e.date_j = jal(e.date); e.method_label = C.PAY_METHOD_LABEL[e.method] || e.method; return e; }),
    { totals: { doc_no: 'جمع', amount: incs.reduce(function (a, r) { return a + r.amount; }, 0) } });

  /* ---------------- دریافت و پرداخت ---------------- */
  const pays = db.prepare(
    'SELECT p.*, COALESCE(cu.name, su.name) AS party_name, ' +
    ' (SELECT GROUP_CONCAT(method) FROM payment_lines WHERE payment_id=p.id) AS methods ' +
    'FROM payments p ' +
    'LEFT JOIN customers cu ON p.party_type=\'customer\' AND cu.id=p.party_id ' +
    'LEFT JOIN suppliers su ON p.party_type=\'supplier\' AND su.id=p.party_id ' +
    'WHERE p.date BETWEEN ? AND ? ORDER BY p.date').all(from, to);
  addSheet(wb, 'دریافت و پرداخت', [
    { header: 'شماره سند', key: 'payment_no', width: 14 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'نوع', key: 'dir_label', width: 12 },
    { header: 'طرف حساب', key: 'party_name', width: 24 },
    { header: 'مبلغ', key: 'total', width: 16, money: true },
    { header: 'روش‌ها', key: 'methods_label', width: 24 },
    { header: 'فاکتور مرتبط', key: 'ref_no', width: 16 },
    { header: 'شرح', key: 'note', width: 30 }
  ], pays.map(function (p) {
    p.date_j = jal(p.date);
    p.dir_label = p.direction === 'in' ? 'دریافت' : 'پرداخت';
    p.methods_label = String(p.methods || '').split(',').map(function (m) { return C.PAY_METHOD_LABEL[m] || m; }).join('، ');
    return p;
  }));

  /* ---------------- حسابداری ---------------- */
  const entries = journal.journal(db, { from: from, to: to, limit: 100000 });
  const journalRows = [];
  for (const e of entries) {
    for (const l of e.lines) {
      journalRows.push({
        entry_no: e.entry_no, date_j: jal(e.date), entry_desc: e.description,
        account_code: l.account_code, account_name: l.account_name,
        debit: l.debit, credit: l.credit, line_desc: l.description, ref_no: e.ref_no
      });
    }
  }
  addSheet(wb, 'دفتر روزنامه', [
    { header: 'شماره سند', key: 'entry_no', width: 12 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'شرح سند', key: 'entry_desc', width: 36 },
    { header: 'کد حساب', key: 'account_code', width: 12 },
    { header: 'نام حساب', key: 'account_name', width: 28 },
    { header: 'بدهکار', key: 'debit', width: 16, money: true },
    { header: 'بستانکار', key: 'credit', width: 16, money: true },
    { header: 'شرح ردیف', key: 'line_desc', width: 34 },
    { header: 'مرجع', key: 'ref_no', width: 14 }
  ], journalRows, {
    totals: {
      entry_no: 'جمع',
      debit: journalRows.reduce(function (a, r) { return a + r.debit; }, 0),
      credit: journalRows.reduce(function (a, r) { return a + r.credit; }, 0)
    }
  });

  const tb = journal.trialBalance(db, { from: from, to: to });
  addSheet(wb, 'تراز آزمایشی', [
    { header: 'کد حساب', key: 'code', width: 12 },
    { header: 'نام حساب', key: 'name', width: 34 },
    { header: 'گردش بدهکار', key: 'debit', width: 18, money: true },
    { header: 'گردش بستانکار', key: 'credit', width: 18, money: true },
    { header: 'مانده بدهکار', key: 'debit_balance', width: 18, money: true },
    { header: 'مانده بستانکار', key: 'credit_balance', width: 18, money: true }
  ], tb, {
    totals: {
      code: 'جمع',
      debit: tb.reduce(function (a, r) { return a + r.debit; }, 0),
      credit: tb.reduce(function (a, r) { return a + r.credit; }, 0),
      debit_balance: tb.reduce(function (a, r) { return a + r.debit_balance; }, 0),
      credit_balance: tb.reduce(function (a, r) { return a + r.credit_balance; }, 0)
    }
  });

  const ledgerRows = [];
  for (const acc of db.prepare('SELECT * FROM accounts ORDER BY sort_order').all()) {
    const led = journal.ledger(db, acc.code, { from: from, to: to });
    if (!led.rows.length && led.opening === 0) continue;
    for (const r of led.rows) {
      ledgerRows.push({
        code: acc.code, account: acc.name, date_j: jal(r.date), entry_no: r.entry_no,
        description: r.description || r.entry_desc, debit: r.debit, credit: r.credit, balance: r.balance
      });
    }
  }
  addSheet(wb, 'دفتر کل', [
    { header: 'کد حساب', key: 'code', width: 12 },
    { header: 'نام حساب', key: 'account', width: 28 },
    { header: 'تاریخ', key: 'date_j', width: 12 },
    { header: 'شماره سند', key: 'entry_no', width: 12 },
    { header: 'شرح', key: 'description', width: 40 },
    { header: 'بدهکار', key: 'debit', width: 16, money: true },
    { header: 'بستانکار', key: 'credit', width: 16, money: true },
    { header: 'مانده', key: 'balance', width: 18, money: true }
  ], ledgerRows);

  addSheet(wb, 'کدینگ حساب‌ها', [
    { header: 'کد', key: 'code', width: 12 },
    { header: 'نام حساب', key: 'name', width: 34 },
    { header: 'نوع', key: 'type_label', width: 16 },
    { header: 'ماهیت', key: 'side_label', width: 14 }
  ], db.prepare('SELECT * FROM accounts ORDER BY sort_order').all().map(function (a) {
    a.type_label = { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه' }[a.type] || a.type;
    a.side_label = a.normal_side === 'debit' ? 'بدهکار' : 'بستانکار';
    return a;
  }));

  /* ---------------- سود و زیان و مالیات ---------------- */
  const pl = reports.profitAndLoss(db, { from: from, to: to });
  addSheet(wb, 'سود و زیان', [
    { header: 'شرح', key: 'label', width: 40 },
    { header: 'مبلغ', key: 'value', width: 22, money: true }
  ], [
    { label: 'فروش ناخالص (پس از تخفیف)', value: pl.gross_revenue },
    { label: 'برگشت از فروش', value: -pl.sales_returns },
    { label: 'فروش خالص', value: pl.net_sales },
    { label: 'بهای تمام‌شده کالای فروش‌رفته', value: -pl.cogs },
    { label: 'سود ناخالص', value: pl.gross_profit },
    { label: 'هزینه‌های عملیاتی', value: -pl.operating_expenses },
    { label: 'درآمد متفرقه', value: pl.other_income },
    { label: 'سود خالص', value: pl.net_profit },
    { label: 'مجموع تخفیف‌های اعطایی', value: pl.discounts }
  ]);

  const vat = reports.vatReport(db, { from: from, to: to });
  addSheet(wb, 'مالیات ارزش افزوده', [
    { header: 'شرح', key: 'label', width: 40 },
    { header: 'مبلغ پایه', key: 'base', width: 22, money: true },
    { header: 'مالیات', key: 'vat', width: 22, money: true }
  ], [
    { label: 'فروش', base: vat.sales.base, vat: vat.sales.vat },
    { label: 'برگشت از فروش', base: -vat.sales_returns.base, vat: -vat.sales_returns.vat },
    { label: 'مالیات فروش (خروجی)', base: '', vat: vat.output_vat },
    { label: 'خرید', base: vat.purchases.base, vat: vat.purchases.vat },
    { label: 'برگشت از خرید', base: -vat.purchase_returns.base, vat: -vat.purchase_returns.vat },
    { label: 'مالیات خرید (ورودی)', base: '', vat: vat.input_vat },
    { label: 'مالیات قابل پرداخت', base: '', vat: vat.net_vat }
  ]);

  await wb.xlsx.writeFile(filePath);
  return { file: filePath, sheets: wb.worksheets.length };
}

/** خروجی اکسل از یک جدول دلخواه (برای دکمه «خروجی اکسل» در گزارش‌ها) */
async function exportTable(filePath, sheetName, columns, rows, totals) {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, sheetName, columns, rows, { totals: totals });
  await wb.xlsx.writeFile(filePath);
  return { file: filePath };
}

module.exports = { exportAll: exportAll, exportTable: exportTable };
