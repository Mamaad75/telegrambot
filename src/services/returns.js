'use strict';
/*
 * برگشت از فروش و برگشت از خرید.
 * برگشت از فروش : افزایش موجودی با همان بهای زمان فروش، کاهش فروش و مالیات، کاهش مطالبات مشتری، برگشت بهای تمام‌شده
 * برگشت از خرید : کاهش موجودی با همان بهای خرید، کاهش بدهی به تأمین‌کننده و مالیات خرید
 * استرداد وجه به صورت یک سند دریافت/پرداخت جداگانه ثبت می‌شود.
 */
const journal = require('./journal.js');
const inventory = require('./inventory.js');
const payments = require('./payments.js');
const settings = require('./settings.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

const SALES_REF = 'sales_return';
const PURCHASE_REF = 'purchase_return';

/* ----------------------------- برگشت از فروش ----------------------------- */

function createSalesReturn(db, data) {
  if (!data.invoice_id) throw new Error('برگشت از فروش باید به یک فاکتور فروش متصل باشد.');
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(data.invoice_id);
  if (!inv) throw new Error('فاکتور فروش یافت نشد.');
  if (inv.status !== 'active') throw new Error('این فاکتور فعال نیست.');
  if (!data.items || !data.items.length) throw new Error('حداقل یک ردیف برای برگشت لازم است.');
  const date = data.date || Jalali.todayIso();

  const prepared = [];
  for (const it of data.items) {
    const qty = Number(it.qty);
    if (!(qty > 0)) continue;
    const item = db.prepare('SELECT * FROM sales_invoice_items WHERE id=? AND invoice_id=?').get(it.item_id, inv.id);
    if (!item) throw new Error('ردیف انتخاب‌شده در این فاکتور وجود ندارد.');
    const remainingQty = item.qty - item.returned_qty;
    if (qty - remainingQty > 1e-9) {
      throw new Error('تعداد برگشتی کالای «' + item.name_snapshot + '» بیشتر از تعداد قابل برگشت (' + remainingQty + ') است.');
    }
    const full = Math.abs(qty - remainingQty) < 1e-9 && Math.abs(item.returned_qty) < 1e-9;
    const netUnit = item.qty > 0 ? item.net_total / item.qty : 0;
    const netValue = full ? item.net_total : Math.round(netUnit * qty);
    prepared.push({ item: item, qty: qty, net_value: netValue, unit_price: item.unit_price });
  }
  if (!prepared.length) throw new Error('هیچ ردیف معتبری برای برگشت انتخاب نشده است.');

  const subtotal = prepared.reduce(function (a, r) { return a + r.net_value; }, 0);
  const vatRate = inv.vat_rate || 0;
  const vat = Math.round(subtotal * vatRate / 100);
  const total = subtotal + vat;

  const tx = db.transaction(function () {
    const returnNo = data.return_no || settings.docNumber(db, 'sales_return');
    const info = db.prepare(
      'INSERT INTO sales_returns (return_no, date, invoice_id, customer_id, subtotal, vat_rate, vat_amount, total, cogs, note, status) ' +
      'VALUES (?,?,?,?,?,?,?,?,0,?,\'active\')'
    ).run(returnNo, date, inv.id, inv.customer_id, subtotal, vatRate, vat, total, data.note || null);
    const returnId = info.lastInsertRowid;

    const itemStmt = db.prepare(
      'INSERT INTO sales_return_items (return_id, item_id, product_id, name_snapshot, qty, unit_price, line_total, unit_cost, cogs) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    let totalCost = 0;
    for (const r of prepared) {
      const res = inventory.stockIn(db, {
        date: date, product_id: r.item.product_id, qty: r.qty, unit_cost: r.item.unit_cost,
        move_type: 'sale_return', ref_type: SALES_REF, ref_id: returnId, ref_no: returnNo,
        description: 'برگشت از فروش طبق ' + returnNo
      });
      totalCost += res.value;
      itemStmt.run(returnId, r.item.id, r.item.product_id, r.item.name_snapshot, r.qty, r.unit_price, r.net_value, r.item.unit_cost, res.value);
      db.prepare('UPDATE sales_invoice_items SET returned_qty = returned_qty + ? WHERE id=?').run(r.qty, r.item.id);
    }
    db.prepare('UPDATE sales_returns SET cogs=? WHERE id=?').run(totalCost, returnId);

    const custName = inv.customer_id ? (db.prepare('SELECT name FROM customers WHERE id=?').get(inv.customer_id) || {}).name : 'مشتری متفرقه';
    const desc = 'برگشت از فروش ' + returnNo + ' - فاکتور ' + inv.invoice_no;
    const lines = [
      { account: C.ACC.SALES, debit: subtotal, description: desc }
    ];
    if (vat) lines.push({ account: C.ACC.VAT_PAYABLE, debit: vat, description: 'برگشت مالیات ' + returnNo });
    if (inv.customer_id) {
      lines.push({ account: C.ACC.RECEIVABLE, credit: total, party_type: 'customer', party_id: inv.customer_id, description: desc + ' - ' + (custName || '') });
    } else {
      // فروش نقدی بدون مشتری: مبلغ به صورت بستانکار روی حساب دریافتنی عمومی می‌نشیند تا با سند استرداد تسویه شود
      lines.push({ account: C.ACC.RECEIVABLE, credit: total, description: desc });
    }
    if (totalCost) {
      lines.push({ account: C.ACC.INVENTORY, debit: totalCost, description: 'برگشت کالا به انبار ' + returnNo });
      lines.push({ account: C.ACC.COGS, credit: totalCost, description: 'برگشت بهای تمام‌شده ' + returnNo });
    }
    const entryId = journal.post(db, { date: date, description: desc, ref_type: SALES_REF, ref_id: returnId, ref_no: returnNo, lines: lines });
    db.prepare('UPDATE sales_returns SET journal_entry_id=? WHERE id=?').run(entryId, returnId);

    // استرداد وجه (اختیاری)
    if (data.refund && data.refund.length) {
      payments.create(db, {
        direction: 'out', date: date, party_type: 'customer', party_id: inv.customer_id,
        ref_type: SALES_REF, ref_id: returnId, ref_no: returnNo,
        lines: data.refund, note: 'استرداد وجه برگشت از فروش ' + returnNo
      });
    }
    db.prepare('INSERT INTO activity_log (action, ref_type, ref_id, detail) VALUES (?,?,?,?)')
      .run('ثبت برگشت از فروش', SALES_REF, returnId, returnNo);
    return returnId;
  });
  return getSalesReturn(db, tx());
}

function getSalesReturn(db, id) {
  const r = db.prepare(
    'SELECT sr.*, c.name AS customer_name, si.invoice_no FROM sales_returns sr ' +
    'LEFT JOIN customers c ON c.id=sr.customer_id LEFT JOIN sales_invoices si ON si.id=sr.invoice_id WHERE sr.id=?'
  ).get(id);
  if (!r) return null;
  r.items = db.prepare('SELECT * FROM sales_return_items WHERE return_id=? ORDER BY id').all(id);
  r.payments = payments.list(db, { ref_type: SALES_REF, ref_id: id });
  r.date_jalali = Jalali.isoToJalali(r.date);
  return r;
}

function listSalesReturns(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('sr.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('sr.date <= ?'); args.push(o.to); }
  if (o.customer_id) { where.push('sr.customer_id = ?'); args.push(o.customer_id); }
  if (o.invoice_id) { where.push('sr.invoice_id = ?'); args.push(o.invoice_id); }
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    where.push('(sr.return_no LIKE ? OR si.invoice_no LIKE ? OR c.name LIKE ?)');
    args.push(s, s, s);
  }
  const sql = 'SELECT sr.*, c.name AS customer_name, si.invoice_no FROM sales_returns sr ' +
    'LEFT JOIN customers c ON c.id=sr.customer_id LEFT JOIN sales_invoices si ON si.id=sr.invoice_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY sr.date DESC, sr.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 200, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) { r.date_jalali = Jalali.isoToJalali(r.date); return r; });
}

function removeSalesReturn(db, id) {
  const r = db.prepare('SELECT * FROM sales_returns WHERE id=?').get(id);
  if (!r) throw new Error('سند برگشت یافت نشد.');
  const tx = db.transaction(function () {
    payments.removeForDocument(db, SALES_REF, id);
    const items = db.prepare('SELECT * FROM sales_return_items WHERE return_id=?').all(id);
    for (const it of items) {
      if (it.item_id) db.prepare('UPDATE sales_invoice_items SET returned_qty = returned_qty - ? WHERE id=?').run(it.qty, it.item_id);
    }
    inventory.reverseMoves(db, SALES_REF, id);
    db.prepare('DELETE FROM sales_return_items WHERE return_id=?').run(id);
    db.prepare('DELETE FROM sales_returns WHERE id=?').run(id);
    journal.deleteByRef(db, SALES_REF, id);
  });
  tx();
  return true;
}

/* ----------------------------- برگشت از خرید ----------------------------- */

function createPurchaseReturn(db, data) {
  if (!data.invoice_id) throw new Error('برگشت از خرید باید به یک فاکتور خرید متصل باشد.');
  const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(data.invoice_id);
  if (!inv) throw new Error('فاکتور خرید یافت نشد.');
  if (!data.items || !data.items.length) throw new Error('حداقل یک ردیف برای برگشت لازم است.');
  const date = data.date || Jalali.todayIso();
  const vatMode = settings.get(db, 'purchase_vat_mode', 'reclaim');

  const prepared = [];
  for (const it of data.items) {
    const qty = Number(it.qty);
    if (!(qty > 0)) continue;
    const item = db.prepare('SELECT * FROM purchase_invoice_items WHERE id=? AND invoice_id=?').get(it.item_id, inv.id);
    if (!item) throw new Error('ردیف انتخاب‌شده در این فاکتور وجود ندارد.');
    const remainingQty = item.qty - item.returned_qty;
    if (qty - remainingQty > 1e-9) {
      throw new Error('تعداد برگشتی کالای «' + item.name_snapshot + '» بیشتر از تعداد قابل برگشت (' + remainingQty + ') است.');
    }
    const full = Math.abs(qty - remainingQty) < 1e-9 && Math.abs(item.returned_qty) < 1e-9;
    const netUnit = item.qty > 0 ? item.net_total / item.qty : 0;
    const netValue = full ? item.net_total : Math.round(netUnit * qty);
    prepared.push({ item: item, qty: qty, net_value: netValue });
  }
  if (!prepared.length) throw new Error('هیچ ردیف معتبری برای برگشت انتخاب نشده است.');

  const subtotal = prepared.reduce(function (a, r) { return a + r.net_value; }, 0);
  const vatRate = inv.vat_rate || 0;
  const vat = Math.round(subtotal * vatRate / 100);
  const total = subtotal + vat;

  const tx = db.transaction(function () {
    const returnNo = data.return_no || settings.docNumber(db, 'purchase_return');
    const info = db.prepare(
      'INSERT INTO purchase_returns (return_no, date, invoice_id, supplier_id, subtotal, vat_rate, vat_amount, total, note, status) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,\'active\')'
    ).run(returnNo, date, inv.id, inv.supplier_id, subtotal, vatRate, vat, total, data.note || null);
    const returnId = info.lastInsertRowid;

    const itemStmt = db.prepare(
      'INSERT INTO purchase_return_items (return_id, item_id, product_id, name_snapshot, qty, unit_price, line_total, unit_cost) VALUES (?,?,?,?,?,?,?,?)'
    );
    let costRemoved = 0;
    for (const r of prepared) {
      const res = inventory.stockOut(db, {
        date: date, product_id: r.item.product_id, qty: r.qty, forced_unit_cost: r.item.unit_cost,
        move_type: 'purchase_return', ref_type: PURCHASE_REF, ref_id: returnId, ref_no: returnNo,
        description: 'برگشت از خرید طبق ' + returnNo
      });
      costRemoved += res.cost;
      itemStmt.run(returnId, r.item.id, r.item.product_id, r.item.name_snapshot, r.qty, r.item.unit_price, r.net_value, r.item.unit_cost);
      db.prepare('UPDATE purchase_invoice_items SET returned_qty = returned_qty + ? WHERE id=?').run(r.qty, r.item.id);
    }

    const supName = inv.supplier_id ? (db.prepare('SELECT name FROM suppliers WHERE id=?').get(inv.supplier_id) || {}).name : '';
    const desc = 'برگشت از خرید ' + returnNo + ' - فاکتور ' + inv.invoice_no;
    const lines = [];
    if (inv.supplier_id) {
      lines.push({ account: C.ACC.PAYABLE, debit: total, party_type: 'supplier', party_id: inv.supplier_id, description: desc + ' - ' + (supName || '') });
    } else {
      lines.push({ account: C.ACC.PAYABLE, debit: total, description: desc });
    }
    lines.push({ account: C.ACC.INVENTORY, credit: costRemoved, description: 'خروج کالا بابت ' + returnNo });
    if (vatMode !== 'cost' && vat) lines.push({ account: C.ACC.VAT_PAYABLE, credit: vat, description: 'برگشت مالیات خرید ' + returnNo });
    const expected = vatMode === 'cost' ? total : subtotal;
    const diff = expected - costRemoved;
    if (diff !== 0) {
      if (diff > 0) lines.push({ account: C.ACC.OPERATING_EXPENSE, credit: diff, description: 'تفاوت گِرد کردن برگشت از خرید' });
      else lines.push({ account: C.ACC.OPERATING_EXPENSE, debit: -diff, description: 'تفاوت گِرد کردن برگشت از خرید' });
    }
    const entryId = journal.post(db, { date: date, description: desc, ref_type: PURCHASE_REF, ref_id: returnId, ref_no: returnNo, lines: lines });
    db.prepare('UPDATE purchase_returns SET journal_entry_id=? WHERE id=?').run(entryId, returnId);

    if (data.refund && data.refund.length) {
      payments.create(db, {
        direction: 'in', date: date, party_type: 'supplier', party_id: inv.supplier_id,
        ref_type: PURCHASE_REF, ref_id: returnId, ref_no: returnNo,
        lines: data.refund, note: 'دریافت وجه برگشت از خرید ' + returnNo
      });
    }
    db.prepare('INSERT INTO activity_log (action, ref_type, ref_id, detail) VALUES (?,?,?,?)')
      .run('ثبت برگشت از خرید', PURCHASE_REF, returnId, returnNo);
    return returnId;
  });
  return getPurchaseReturn(db, tx());
}

function getPurchaseReturn(db, id) {
  const r = db.prepare(
    'SELECT pr.*, s.name AS supplier_name, pi.invoice_no FROM purchase_returns pr ' +
    'LEFT JOIN suppliers s ON s.id=pr.supplier_id LEFT JOIN purchase_invoices pi ON pi.id=pr.invoice_id WHERE pr.id=?'
  ).get(id);
  if (!r) return null;
  r.items = db.prepare('SELECT * FROM purchase_return_items WHERE return_id=? ORDER BY id').all(id);
  r.payments = payments.list(db, { ref_type: PURCHASE_REF, ref_id: id });
  r.date_jalali = Jalali.isoToJalali(r.date);
  return r;
}

function listPurchaseReturns(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('pr.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('pr.date <= ?'); args.push(o.to); }
  if (o.supplier_id) { where.push('pr.supplier_id = ?'); args.push(o.supplier_id); }
  if (o.invoice_id) { where.push('pr.invoice_id = ?'); args.push(o.invoice_id); }
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    where.push('(pr.return_no LIKE ? OR pi.invoice_no LIKE ? OR s.name LIKE ?)');
    args.push(s, s, s);
  }
  const sql = 'SELECT pr.*, s.name AS supplier_name, pi.invoice_no FROM purchase_returns pr ' +
    'LEFT JOIN suppliers s ON s.id=pr.supplier_id LEFT JOIN purchase_invoices pi ON pi.id=pr.invoice_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY pr.date DESC, pr.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 200, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) { r.date_jalali = Jalali.isoToJalali(r.date); return r; });
}

function removePurchaseReturn(db, id) {
  const r = db.prepare('SELECT * FROM purchase_returns WHERE id=?').get(id);
  if (!r) throw new Error('سند برگشت یافت نشد.');
  const tx = db.transaction(function () {
    payments.removeForDocument(db, PURCHASE_REF, id);
    const items = db.prepare('SELECT * FROM purchase_return_items WHERE return_id=?').all(id);
    for (const it of items) {
      if (it.item_id) db.prepare('UPDATE purchase_invoice_items SET returned_qty = returned_qty - ? WHERE id=?').run(it.qty, it.item_id);
    }
    inventory.reverseMoves(db, PURCHASE_REF, id);
    db.prepare('DELETE FROM purchase_return_items WHERE return_id=?').run(id);
    db.prepare('DELETE FROM purchase_returns WHERE id=?').run(id);
    journal.deleteByRef(db, PURCHASE_REF, id);
  });
  tx();
  return true;
}

module.exports = {
  createSalesReturn: createSalesReturn, getSalesReturn: getSalesReturn,
  listSalesReturns: listSalesReturns, removeSalesReturn: removeSalesReturn,
  createPurchaseReturn: createPurchaseReturn, getPurchaseReturn: getPurchaseReturn,
  listPurchaseReturns: listPurchaseReturns, removePurchaseReturn: removePurchaseReturn,
  SALES_REF: SALES_REF, PURCHASE_REF: PURCHASE_REF
};
