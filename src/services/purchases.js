'use strict';
/*
 * فاکتور خرید.
 * ثبت هر فاکتور در یک تراکنش: افزایش موجودی انبار با بهای تمام‌شده واقعی،
 * صدور سند حسابداری تراز، و ثبت پرداخت‌های نقدی/کارتی/چکی.
 *
 * نحوه برخورد با مالیات خرید با تنظیم purchase_vat_mode کنترل می‌شود:
 *   reclaim (پیش‌فرض) : مالیات خرید بدهکار حساب ۲۰۲ می‌شود (قابل تهاتر با مالیات فروش)
 *   cost              : مالیات خرید به بهای تمام‌شده کالا اضافه می‌شود
 */
const journal = require('./journal.js');
const inventory = require('./inventory.js');
const payments = require('./payments.js');
const settings = require('./settings.js');
const C = require('../shared/constants.js');
const Jalali = require('../shared/jalali.js');

const REF = 'purchase_invoice';

function computeTotals(items, invoiceDiscount, vatRate) {
  let subtotal = 0, lineDiscount = 0;
  const rows = items.map(function (it) {
    const qty = Number(it.qty);
    const price = Math.round(Number(it.unit_price) || 0);
    const disc = Math.round(Number(it.discount) || 0);
    if (!(qty > 0)) throw new Error('تعداد هر ردیف باید بزرگ‌تر از صفر باشد.');
    const gross = Math.round(qty * price);
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
    ? Number(data.vat_rate) : 0;
  const t = computeTotals(data.items, data.invoice_discount, vatRate);
  const vatMode = settings.get(db, 'purchase_vat_mode', 'reclaim');

  const payLines = payments.normalizeLines(db, data.payments);
  const paid = payments.sumLines(payLines);
  const remaining = t.total - paid;
  if (remaining !== 0 && !data.supplier_id) {
    throw new Error('برای خرید نسیه یا پرداخت ناقص، انتخاب تأمین‌کننده الزامی است.');
  }
  if (paid > t.total) throw new Error('مبلغ پرداختی از مبلغ فاکتور بیشتر است.');

  const tx = db.transaction(function () {
    const invoiceNo = data.invoice_no || settings.docNumber(db, 'purchase_invoice');
    const info = db.prepare(
      'INSERT INTO purchase_invoices (invoice_no, supplier_ref_no, date, supplier_id, subtotal, line_discount, invoice_discount, taxable, vat_rate, vat_amount, total, note, status) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,\'active\')'
    ).run(invoiceNo, data.supplier_ref_no || null, date, data.supplier_id || null, t.subtotal, t.line_discount,
      t.invoice_discount, t.taxable, t.vat_rate, t.vat_amount, t.total, data.note || null);
    const invoiceId = info.lastInsertRowid;

    // ---- ورود کالا به انبار ----
    const itemStmt = db.prepare(
      'INSERT INTO purchase_invoice_items (invoice_id, product_id, name_snapshot, unit, qty, unit_price, discount, line_total, net_total, unit_cost) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    let inventoryValue = 0;
    // در حالت افزودن مالیات به بهای تمام‌شده، مالیات نیز روی ردیف‌ها سرشکن می‌شود
    let vatAllocated = 0;
    t.rows.forEach(function (r, i) {
      let extra = 0;
      if (vatMode === 'cost' && t.vat_amount) {
        extra = (i === t.rows.length - 1)
          ? t.vat_amount - vatAllocated
          : (t.taxable > 0 ? Math.round(t.vat_amount * r.net_total / t.taxable) : 0);
        vatAllocated += extra;
      }
      r.cost_value = r.net_total + extra;
      r.unit_cost = r.qty > 0 ? r.cost_value / r.qty : 0;
    });

    for (const r of t.rows) {
      const p = db.prepare('SELECT name, unit FROM products WHERE id=?').get(r.product_id);
      if (!p) throw new Error('کالای انتخاب‌شده یافت نشد.');
      const res = inventory.stockIn(db, {
        date: date, product_id: r.product_id, qty: r.qty, unit_cost: r.unit_cost, move_type: 'purchase',
        ref_type: REF, ref_id: invoiceId, ref_no: invoiceNo, description: 'خرید طبق فاکتور ' + invoiceNo
      });
      inventoryValue += res.value;
      itemStmt.run(invoiceId, r.product_id, p.name, p.unit, r.qty, r.unit_price, r.discount, r.line_total, r.net_total, r.unit_cost);
      db.prepare('UPDATE products SET purchase_price=? WHERE id=?').run(Math.round(r.unit_cost), r.product_id);
    }

    // ---- پرداخت ----
    const pay = payments.attachToDocument(db, {
      direction: 'out', date: date,
      party_type: 'supplier', party_id: data.supplier_id || null,
      ref_type: REF, ref_id: invoiceId, ref_no: invoiceNo,
      description: 'فاکتور خرید ' + invoiceNo,
      note: data.payment_note || null
    }, data.payments);

    // ---- سند حسابداری ----
    const supName = data.supplier_id
      ? (db.prepare('SELECT name FROM suppliers WHERE id=?').get(data.supplier_id) || {}).name
      : 'تأمین‌کننده متفرقه';
    const desc = 'فاکتور خرید ' + invoiceNo + ' - ' + (supName || '');
    const lines = pay.journal_lines.slice();
    lines.push({ account: C.ACC.INVENTORY, debit: inventoryValue, description: 'ورود کالا طبق فاکتور ' + invoiceNo });
    if (vatMode !== 'cost' && t.vat_amount) {
      lines.push({ account: C.ACC.VAT_PAYABLE, debit: t.vat_amount, description: 'مالیات خرید فاکتور ' + invoiceNo });
    }
    if (remaining > 0) {
      lines.push({ account: C.ACC.PAYABLE, credit: remaining, party_type: 'supplier', party_id: data.supplier_id, description: 'مانده فاکتور ' + invoiceNo });
    } else if (remaining < 0) {
      lines.push({ account: C.ACC.PAYABLE, debit: -remaining, party_type: 'supplier', party_id: data.supplier_id, description: 'پیش‌پرداخت فاکتور ' + invoiceNo });
    }
    // اختلاف گِرد کردن ارزش انبار با مبلغ فاکتور (حداکثر چند ریال)
    const expectedInventory = vatMode === 'cost' ? t.total : t.taxable;
    const diff = expectedInventory - inventoryValue;
    if (diff !== 0) {
      if (diff > 0) lines.push({ account: C.ACC.OPERATING_EXPENSE, debit: diff, description: 'تفاوت گِرد کردن فاکتور خرید' });
      else lines.push({ account: C.ACC.OPERATING_EXPENSE, credit: -diff, description: 'تفاوت گِرد کردن فاکتور خرید' });
    }

    const entryId = journal.post(db, { date: date, description: desc, ref_type: REF, ref_id: invoiceId, ref_no: invoiceNo, lines: lines });
    db.prepare('UPDATE purchase_invoices SET journal_entry_id=? WHERE id=?').run(entryId, invoiceId);
    payments.linkEntry(db, pay.payment_id, entryId);

    db.prepare('INSERT INTO activity_log (action, ref_type, ref_id, detail) VALUES (?,?,?,?)')
      .run('ثبت فاکتور خرید', REF, invoiceId, invoiceNo);
    return invoiceId;
  });
  return get(db, tx());
}

function get(db, id) {
  const inv = db.prepare(
    'SELECT pi.*, s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address ' +
    'FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id=pi.supplier_id WHERE pi.id=?'
  ).get(id);
  if (!inv) return null;
  inv.items = db.prepare(
    'SELECT ii.*, p.code AS product_code FROM purchase_invoice_items ii LEFT JOIN products p ON p.id=ii.product_id WHERE ii.invoice_id=? ORDER BY ii.id'
  ).all(id);
  inv.payments = payments.list(db, { ref_type: REF, ref_id: id });
  const paid = payments.paidFor(db, REF, id);
  inv.paid = paid.out - paid.in;
  inv.remaining = inv.total - inv.paid;
  inv.date_jalali = Jalali.isoToJalali(inv.date);
  inv.checks = db.prepare('SELECT * FROM checks WHERE ref_type=? AND ref_id=? ORDER BY id').all(REF, id).map(function (ch) {
    ch.status_label = C.CHECK_STATUS[ch.status] || ch.status;
    ch.due_date_jalali = ch.due_date ? Jalali.isoToJalali(ch.due_date) : '';
    return ch;
  });
  inv.returns = db.prepare('SELECT id, return_no, date, total FROM purchase_returns WHERE invoice_id=? AND status=\'active\'').all(id);
  inv.returned_total = inv.returns.reduce(function (a, r) { return a + r.total; }, 0);
  return inv;
}

function getByNumber(db, no) {
  const r = db.prepare('SELECT id FROM purchase_invoices WHERE invoice_no=?').get(String(no).trim());
  return r ? get(db, r.id) : null;
}

function list(db, opt) {
  const o = opt || {};
  const where = ['1=1'];
  const args = [];
  if (o.from) { where.push('pi.date >= ?'); args.push(o.from); }
  if (o.to) { where.push('pi.date <= ?'); args.push(o.to); }
  if (o.supplier_id) { where.push('pi.supplier_id = ?'); args.push(o.supplier_id); }
  if (o.status) { where.push('pi.status = ?'); args.push(o.status); }
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    where.push('(pi.invoice_no LIKE ? OR pi.supplier_ref_no LIKE ? OR s.name LIKE ? OR pi.note LIKE ?)');
    args.push(s, s, s, s);
  }
  const sql =
    'SELECT pi.*, s.name AS supplier_name, ' +
    ' (SELECT COALESCE(SUM(CASE WHEN direction=\'out\' THEN total ELSE -total END),0) FROM payments WHERE ref_type=\'' + REF + '\' AND ref_id=pi.id) AS paid ' +
    'FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id=pi.supplier_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY pi.date DESC, pi.id DESC LIMIT ? OFFSET ?';
  args.push(o.limit || 200, o.offset || 0);
  return db.prepare(sql).all(...args).map(function (r) {
    r.remaining = r.total - r.paid;
    r.date_jalali = Jalali.isoToJalali(r.date);
    return r;
  });
}

function remove(db, id) {
  const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(id);
  if (!inv) throw new Error('فاکتور یافت نشد.');
  const rets = db.prepare('SELECT COUNT(*) c FROM purchase_returns WHERE invoice_id=? AND status=\'active\'').get(id).c;
  if (rets) throw new Error('برای این فاکتور برگشت از خرید ثبت شده است؛ ابتدا آن را حذف کنید.');

  const tx = db.transaction(function () {
    payments.removeForDocument(db, REF, id);
    db.prepare('DELETE FROM checks WHERE ref_type=? AND ref_id=? AND status=\'pending\'').run(REF, id);
    inventory.reverseMoves(db, REF, id);
    db.prepare('DELETE FROM purchase_invoice_items WHERE invoice_id=?').run(id);
    db.prepare('DELETE FROM purchase_invoices WHERE id=?').run(id);
    journal.deleteByRef(db, REF, id);
    db.prepare('INSERT INTO activity_log (action, ref_type, ref_id, detail) VALUES (?,?,?,?)')
      .run('حذف فاکتور خرید', REF, id, inv.invoice_no);
  });
  tx();
  return true;
}

function update(db, id, data) {
  const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(id);
  if (!inv) throw new Error('فاکتور یافت نشد.');
  const tx = db.transaction(function () {
    remove(db, id);
    return create(db, Object.assign({}, data, { invoice_no: inv.invoice_no })).id;
  });
  return get(db, tx());
}

module.exports = { create: create, get: get, getByNumber: getByNumber, list: list, remove: remove, update: update, computeTotals: computeTotals, REF: REF };
