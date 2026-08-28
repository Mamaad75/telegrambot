'use strict';
/*
 * فاکتور فروش.
 * ثبت هر فاکتور در یک تراکنش انجام می‌شود و شامل:
 *   ۱) کاهش موجودی انبار و محاسبه بهای تمام‌شده (میانگین موزون)
 *   ۲) صدور سند حسابداری کاملاً تراز
 *   ۳) ثبت پرداخت (تک‌روشی یا ترکیبی) و ساخت چک‌ها با کد یکتا
 * اگر هر مرحله شکست بخورد، کل عملیات برگشت می‌خورد.
 */
const journal = require('./journal.js');
const inventory = require('./inventory.js');
const payments = require('./payments.js');
const settings = require('./settings.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

const REF = 'sales_invoice';

/** محاسبه مبالغ فاکتور از روی ردیف‌ها */
function computeTotals(items, invoiceDiscount, vatRate) {
  let subtotal = 0, lineDiscount = 0;
  const rows = items.map(function (it) {
    const qty = Number(it.qty);
    const price = Math.round(Number(it.unit_price) || 0);
    const disc = Math.round(Number(it.discount) || 0);
    const gross = Math.round(qty * price);
    if (!(qty > 0)) throw new Error('تعداد هر ردیف باید بزرگ‌تر از صفر باشد.');
    if (disc < 0) throw new Error('تخفیف نمی‌تواند منفی باشد.');
    if (disc > gross) throw new Error('تخفیف ردیف نمی‌تواند از مبلغ آن بیشتر باشد.');
    subtotal += gross;
    lineDiscount += disc;
    return { product_id: it.product_id, qty: qty, unit_price: price, discount: disc, line_total: gross - disc };
  });
  const invDisc = Math.round(Number(invoiceDiscount) || 0);
  const afterLine = subtotal - lineDiscount;
  if (invDisc < 0) throw new Error('تخفیف فاکتور نمی‌تواند منفی باشد.');
  if (invDisc > afterLine) throw new Error('تخفیف کل فاکتور از مبلغ فاکتور بیشتر است.');

  // سرشکن کردن تخفیف کل روی ردیف‌ها (باقیمانده به آخرین ردیف)
  let allocated = 0;
  rows.forEach(function (r, i) {
    let share;
    if (i === rows.length - 1) share = invDisc - allocated;
    else share = afterLine > 0 ? Math.round(invDisc * r.line_total / afterLine) : 0;
    allocated += share;
    r.net_total = r.line_total - share;
  });

  const taxable = rows.reduce(function (a, r) { return a + r.net_total; }, 0);
  const rate = Number(vatRate) || 0;
  const vat = Math.round(taxable * rate / 100);
  return {
    rows: rows, subtotal: subtotal, line_discount: lineDiscount, invoice_discount: invDisc,
    taxable: taxable, vat_rate: rate, vat_amount: vat, total: taxable + vat
  };
}

function create(db, data) {
  if (!data.items || !data.items.length) throw new Error('فاکتور بدون کالا قابل ثبت نیست.');
  const date = data.date || Jalali.todayIso();
  const vatRate = data.vat_rate !== undefined && data.vat_rate !== null && data.vat_rate !== ''
    ? Number(data.vat_rate) : settings.getNumber(db, 'vat_rate', 10);
  const t = computeTotals(data.items, data.invoice_discount, vatRate);

  const payLines = payments.normalizeLines(db, data.payments);
  const paid = payments.sumLines(payLines);
  const remaining = t.total - paid;
  if (remaining !== 0 && !data.customer_id) {
    throw new Error('برای فاکتور نسیه یا پرداخت ناقص، انتخاب مشتری الزامی است.');
  }
  if (paid > t.total) throw new Error('مبلغ پرداختی از مبلغ فاکتور بیشتر است.');

  const tx = db.transaction(function () {
    const invoiceNo = data.invoice_no || settings.docNumber(db, 'sales_invoice');
    const info = db.prepare(
      'INSERT INTO sales_invoices (invoice_no, date, customer_id, subtotal, line_discount, invoice_discount, taxable, vat_rate, vat_amount, total, cogs, note, status) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,0,?,\'active\')'
    ).run(invoiceNo, date, data.customer_id || null, t.subtotal, t.line_discount, t.invoice_discount,
      t.taxable, t.vat_rate, t.vat_amount, t.total, data.note || null);
    const invoiceId = info.lastInsertRowid;

    // ---- انبار و بهای تمام‌شده ----
    const itemStmt = db.prepare(
      'INSERT INTO sales_invoice_items (invoice_id, product_id, name_snapshot, unit, qty, unit_price, discount, line_total, net_total, unit_cost, cogs) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    );
    let totalCogs = 0;
    for (const r of t.rows) {
      const p = db.prepare('SELECT name, unit FROM products WHERE id=?').get(r.product_id);
      if (!p) throw new Error('کالای انتخاب‌شده یافت نشد.');
      const out = inventory.stockOut(db, {
        date: date, product_id: r.product_id, qty: r.qty, move_type: 'sale',
        ref_type: REF, ref_id: invoiceId, ref_no: invoiceNo, description: 'فروش طبق فاکتور ' + invoiceNo
      });
      totalCogs += out.cost;
      itemStmt.run(invoiceId, r.product_id, p.name, p.unit, r.qty, r.unit_price, r.discount,
        r.line_total, r.net_total, out.unit_cost, out.cost);
    }
    db.prepare('UPDATE sales_invoices SET cogs=? WHERE id=?').run(totalCogs, invoiceId);

    // ---- پرداخت ----
    const pay = payments.attachToDocument(db, {
      direction: 'in', date: date,
      party_type: 'customer', party_id: data.customer_id || null,
      ref_type: REF, ref_id: invoiceId, ref_no: invoiceNo,
      description: 'فاکتور فروش ' + invoiceNo,
      note: data.payment_note || null
    }, data.payments);

    // ---- سند حسابداری ----
    const custName = data.customer_id
      ? (db.prepare('SELECT name FROM customers WHERE id=?').get(data.customer_id) || {}).name
      : 'مشتری متفرقه';
    const desc = 'فاکتور فروش ' + invoiceNo + ' - ' + (custName || '');
    const lines = pay.journal_lines.slice();
    if (remaining > 0) {
      lines.push({ account: C.ACC.RECEIVABLE, debit: remaining, party_type: 'customer', party_id: data.customer_id, description: 'مانده فاکتور ' + invoiceNo });
    } else if (remaining < 0) {
      lines.push({ account: C.ACC.RECEIVABLE, credit: -remaining, party_type: 'customer', party_id: data.customer_id, description: 'پیش‌دریافت فاکتور ' + invoiceNo });
    }
    lines.push({ account: C.ACC.SALES, credit: t.taxable, description: desc });
    if (t.vat_amount) lines.push({ account: C.ACC.VAT_PAYABLE, credit: t.vat_amount, description: 'مالیات بر ارزش افزوده فاکتور ' + invoiceNo });
    if (totalCogs) {
      lines.push({ account: C.ACC.COGS, debit: totalCogs, description: 'بهای تمام‌شده فاکتور ' + invoiceNo });
      lines.push({ account: C.ACC.INVENTORY, credit: totalCogs, description: 'خروج کالا طبق فاکتور ' + invoiceNo });
    }
    const entryId = journal.post(db, { date: date, description: desc, ref_type: REF, ref_id: invoiceId, ref_no: invoiceNo, lines: lines });
    db.prepare('UPDATE sales_invoices SET journal_entry_id=? WHERE id=?').run(entryId, invoiceId);
    payments.linkEntry(db, pay.payment_id, entryId);

    db.prepare('INSERT INTO activity_log (action, ref_type, ref_id, detail) VALUES (?,?,?,?)')
      .run('ثبت فاکتور فروش', REF, invoiceId, invoiceNo);
    return invoiceId;
  });
  return get(db, tx());
}

function get(db, id) {
  const inv = db.prepare(
    'SELECT si.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.national_id AS customer_national_id ' +
    'FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id WHERE si.id=?'
  ).get(id);
  if (!inv) return null;
  inv.items = db.prepare(
    'SELECT ii.*, p.code AS product_code, p.barcode FROM sales_invoice_items ii LEFT JOIN products p ON p.id=ii.product_id WHERE ii.invoice_id=? ORDER BY ii.id'
  ).all(id);
  inv.payments = payments.list(db, { ref_type: REF, ref_id: id });
  const paid = payments.paidFor(db, REF, id);
  inv.paid = paid.net;
  inv.remaining = inv.total - paid.net;
  inv.date_jalali = Jalali.isoToJalali(inv.date);
  inv.checks = db.prepare('SELECT * FROM checks WHERE ref_type=? AND ref_id=? ORDER BY id').all(REF, id).map(function (ch) {
    ch.status_label = C.CHECK_STATUS[ch.status] || ch.status;
    ch.due_date_jalali = ch.due_date ? Jalali.isoToJalali(ch.due_date) : '';
    return ch;
  });
  inv.returns = db.prepare('SELECT id, return_no, date, total FROM sales_returns WHERE invoice_id=? AND status=\'active\'').all(id);
  inv.returned_total = inv.returns.reduce(function (a, r) { return a + r.total; }, 0);
  return inv;
}

function getByNumber(db, no) {
  const r = db.prepare('SELECT id FROM sales_invoices WHERE invoice_no=?').get(String(no).trim());
  return r ? get(db, r.id) : null;
}

function list(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('si.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('si.date <= ?'); args.push(o.to); }
  if (o.customer_id) { where.push('si.customer_id = ?'); args.push(o.customer_id); }
  if (o.status) { where.push('si.status = ?'); args.push(o.status); }
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    where.push('(si.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR si.note LIKE ?)');
    args.push(s, s, s, s);
  }
  const sql =
    'SELECT si.*, c.name AS customer_name, c.phone AS customer_phone, ' +
    ' (SELECT COALESCE(SUM(CASE WHEN direction=\'in\' THEN total ELSE -total END),0) FROM payments WHERE ref_type=\'' + REF + '\' AND ref_id=si.id) AS paid ' +
    'FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY si.date DESC, si.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 200, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) {
    r.remaining = r.total - r.paid;
    r.date_jalali = Jalali.isoToJalali(r.date);
    return r;
  });
}

function count(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('si.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('si.date <= ?'); args.push(o.to); }
  if (o.customer_id) { where.push('si.customer_id = ?'); args.push(o.customer_id); }
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    where.push('(si.invoice_no LIKE ? OR c.name LIKE ?)');
    args.push(s, s);
  }
  return db.prepare('SELECT COUNT(*) c FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id WHERE ' + where.join(' AND ')).get(...args).c;
}

/** حذف کامل فاکتور همراه با انبار، حسابداری، پرداخت‌ها و چک‌ها */
function remove(db, id) {
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(id);
  if (!inv) throw new Error('فاکتور یافت نشد.');
  const rets = db.prepare('SELECT COUNT(*) c FROM sales_returns WHERE invoice_id=? AND status=\'active\'').get(id).c;
  if (rets) throw new Error('برای این فاکتور برگشت از فروش ثبت شده است؛ ابتدا آن را حذف کنید.');

  const tx = db.transaction(function () {
    payments.removeForDocument(db, REF, id);
    db.prepare('DELETE FROM checks WHERE ref_type=? AND ref_id=? AND status=\'pending\'').run(REF, id);
    inventory.reverseMoves(db, REF, id);
    // ابتدا خود مدرک حذف می‌شود تا ارجاع کلید خارجی به سند حسابداری آزاد شود
    db.prepare('DELETE FROM sales_invoice_items WHERE invoice_id=?').run(id);
    db.prepare('DELETE FROM sales_invoices WHERE id=?').run(id);
    journal.deleteByRef(db, REF, id);
    db.prepare('INSERT INTO activity_log (action, ref_type, ref_id, detail) VALUES (?,?,?,?)')
      .run('حذف فاکتور فروش', REF, id, inv.invoice_no);
  });
  tx();
  return true;
}

/** ویرایش = حذف و ثبت مجدد با همان شماره، در یک تراکنش */
function update(db, id, data) {
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(id);
  if (!inv) throw new Error('فاکتور یافت نشد.');
  const tx = db.transaction(function () {
    remove(db, id);
    return create(db, Object.assign({}, data, { invoice_no: inv.invoice_no })).id;
  });
  return get(db, tx());
}

module.exports = { create: create, get: get, getByNumber: getByNumber, list: list, count: count, remove: remove, update: update, computeTotals: computeTotals, REF: REF };
