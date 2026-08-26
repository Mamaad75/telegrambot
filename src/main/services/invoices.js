'use strict';
/**
 * فاکتورهای خرید، فروش و برگشتی.
 * هر فاکتور در یک تراکنش پایگاه داده ثبت می‌شود: اقلام، گردش انبار، سند حسابداری،
 * دریافت/پرداخت و چک‌ها. اگر هر مرحله شکست بخورد، کل عملیات برگشت می‌خورد.
 */
const { AppError, assert } = require('../util/errors');
const { r, toQty } = require('../util/money');
const { todayIso } = require('../util/jalali');
const accounting = require('./accounting');
const inventory = require('./inventory');
const settings = require('./settings');

const ACC = accounting.ACC;

const TYPE_LABELS = {
  sale: 'فاکتور فروش',
  purchase: 'فاکتور خرید',
  sale_return: 'برگشت از فروش',
  purchase_return: 'برگشت از خرید',
};

/** جهت جریان پول برای هر نوع سند: in = ورود پول به فروشگاه */
const MONEY_DIRECTION = { sale: 'in', purchase: 'out', sale_return: 'out', purchase_return: 'in' };
const PARTY_TYPE = { sale: 'customer', purchase: 'supplier', sale_return: 'customer', purchase_return: 'supplier' };

/** حساب مربوط به هر روش تسویه با توجه به جهت پول */
function settlementAccount(method, direction) {
  switch (method) {
    case 'cash': return ACC.CASH;
    case 'pos': return ACC.POS;
    case 'bank': return ACC.BANK;
    case 'check': return direction === 'in' ? ACC.CHECKS_RECEIVABLE : ACC.CHECKS_PAYABLE;
    default: throw new AppError('روش پرداخت نامعتبر است: ' + method, 'BAD_METHOD');
  }
}

/** توزیع یک مبلغ صحیح بین چند ردیف به نسبت وزن، بدون خطای گرد کردن */
function distribute(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Array(weights.length).fill(0);
  if (!amount || total <= 0) return out;
  let acc = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (i === weights.length - 1) { out[i] = amount - acc; break; }
    out[i] = r(amount * (weights[i] / total));
    acc += out[i];
  }
  return out;
}

/** محاسبه مبالغ فاکتور از روی اقلام و تخفیف‌ها */
function computeTotals(items, discountInvoice, vatRate) {
  let subtotal = 0; let discountLines = 0;
  const lines = items.map((it) => {
    const qty = toQty(it.qty);
    const price = Math.max(0, r(it.unit_price));
    const gross = r(qty * price);
    const disc = Math.min(Math.max(0, r(it.discount)), gross);
    subtotal += gross;
    discountLines += disc;
    return { ...it, qty, unit_price: price, gross, discount: disc, line_total: gross - disc };
  });
  const maxInvoiceDiscount = Math.max(0, subtotal - discountLines);
  const discInv = Math.min(Math.max(0, r(discountInvoice)), maxInvoiceDiscount);
  const discountTotal = discountLines + discInv;
  const taxable = subtotal - discountTotal;
  const rate = Math.max(0, Number(vatRate) || 0);
  const vat = r(taxable * rate / 100);
  return {
    lines, subtotal, discountLines, discountInvoice: discInv, discountTotal,
    taxable, vatRate: rate, vat, total: taxable + vat,
  };
}

function validatePayload(db, payload) {
  const type = payload.type;
  assert(TYPE_LABELS[type], 'نوع فاکتور نامعتبر است.');
  const items = Array.isArray(payload.items) ? payload.items.filter((x) => x && x.product_id) : [];
  assert(items.length > 0, 'فاکتور باید حداقل یک ردیف کالا داشته باشد.');
  for (const it of items) {
    assert(toQty(it.qty) > 0, 'تعداد هر ردیف باید بزرگ‌تر از صفر باشد.');
    assert(r(it.unit_price) >= 0, 'قیمت واحد نمی‌تواند منفی باشد.');
  }
  return items;
}

/** ساخت و ثبت فاکتور (در تراکنش فراخوانی می‌شود) */
function createInvoiceInner(db, payload) {
  const type = payload.type;
  const items = validatePayload(db, payload);
  const date = payload.date || todayIso();
  const direction = MONEY_DIRECTION[type];
  const allowNegative = settings.bool(db, 'allow_negative_stock', false);

  // نرخ ارزش افزوده
  let rate;
  if (payload.vat_rate !== undefined && payload.vat_rate !== null && payload.vat_rate !== '') {
    rate = Math.max(0, Number(payload.vat_rate) || 0);
  } else if (type === 'sale' || type === 'sale_return') {
    rate = settings.vatRate(db);
  } else {
    rate = 0;
  }

  const totals = computeTotals(items, payload.discount_invoice, rate);

  // طرف حساب
  let partyId = payload.party_id ? Number(payload.party_id) : null;
  let partyName = String(payload.party_name || '').trim();
  if (partyId) {
    const p = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
    if (!p) throw new AppError('طرف حساب انتخاب‌شده یافت نشد.', 'NO_PARTY');
    if (p.type !== PARTY_TYPE[type]) throw new AppError('نوع طرف حساب با نوع فاکتور همخوانی ندارد.', 'BAD_PARTY');
    partyName = p.name;
  }

  // تسویه‌ها
  const rawPayments = Array.isArray(payload.payments) ? payload.payments : [];
  const payments = rawPayments
    .map((p) => ({ ...p, amount: Math.max(0, r(p.amount)) }))
    .filter((p) => p.amount > 0 && p.method && p.method !== 'credit');
  const settled = payments.reduce((a, p) => a + p.amount, 0);
  if (settled > totals.total) {
    throw new AppError('مجموع مبالغ پرداخت از مبلغ فاکتور بیشتر است.', 'OVER_PAID');
  }
  const due = totals.total - settled;
  if (due > 0 && !partyId) {
    throw new AppError('برای بخش نسیه فاکتور باید طرف حساب مشخص شود.', 'CREDIT_NEEDS_PARTY');
  }

  // شماره فاکتور
  let invoiceNo = String(payload.invoice_no || '').trim();
  if (!invoiceNo) {
    invoiceNo = settings.nextInvoiceNo(db, type);
  } else {
    const dup = db.prepare('SELECT id FROM invoices WHERE type=? AND invoice_no=?').get(type, invoiceNo);
    if (dup) throw new AppError('شماره فاکتور تکراری است.', 'DUP_INVOICE_NO');
  }

  // فاکتور اصلی برای برگشتی‌ها
  let refInvoice = null;
  if (payload.ref_invoice_id) {
    refInvoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(Number(payload.ref_invoice_id));
    if (!refInvoice) throw new AppError('فاکتور اصلی یافت نشد.', 'NO_REF_INVOICE');
  }

  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO invoices
    (type,invoice_no,date,party_id,party_name,subtotal,discount_lines,discount_invoice,discount_total,
     taxable,vat_rate,vat,total,paid,due,cogs,ref_invoice_id,status,notes,entry_id,created_at)
    VALUES (@type,@no,@date,@pid,@pname,@sub,@dl,@di,@dt,@tax,@rate,@vat,@total,@paid,@due,0,@ref,'posted',@notes,NULL,@now)`)
    .run({
      type, no: invoiceNo, date, pid: partyId, pname: partyName,
      sub: totals.subtotal, dl: totals.discountLines, di: totals.discountInvoice, dt: totals.discountTotal,
      tax: totals.taxable, rate: totals.vatRate, vat: totals.vat, total: totals.total,
      paid: settled, due, ref: refInvoice ? refInvoice.id : null, notes: String(payload.notes || ''), now,
    });
  const invoiceId = Number(info.lastInsertRowid);

  // سهم هر ردیف از تخفیف کل فاکتور (برای بهای تمام‌شده)
  const shares = distribute(totals.discountInvoice, totals.lines.map((l) => l.line_total));

  const itemStmt = db.prepare(`INSERT INTO invoice_items
    (invoice_id,product_id,product_name,product_code,unit,qty,unit_price,discount,line_total,unit_cost,cost_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

  let cogsTotal = 0;
  let inventoryValueIn = 0;
  const vatDeductible = settings.bool(db, 'purchase_vat_deductible', true);

  totals.lines.forEach((line, idx) => {
    const product = inventory.getProduct(db, line.product_id);
    const netLine = line.line_total - shares[idx]; // بهای خالص ردیف پس از تخفیف فاکتور
    let unitCost = 0; let costTotal = 0;

    if (type === 'sale') {
      inventory.ensureAvailable(db, product.id, line.qty, allowNegative);
      const mv = inventory.applyMovement(db, {
        date, productId: product.id, type: 'sale', direction: 'out', qty: line.qty,
        refType: 'invoice', refId: invoiceId, description: `فروش - فاکتور ${invoiceNo}`,
      });
      costTotal = mv.value; unitCost = mv.unitCost; cogsTotal += costTotal;
    } else if (type === 'purchase') {
      const base = vatDeductible ? netLine : netLine + r(netLine * totals.vatRate / 100);
      const mv = inventory.applyMovement(db, {
        date, productId: product.id, type: 'purchase', direction: 'in', qty: line.qty,
        value: base, unitCost: line.qty ? base / line.qty : 0,
        refType: 'invoice', refId: invoiceId, description: `خرید - فاکتور ${invoiceNo}`,
      });
      costTotal = mv.value; unitCost = mv.unitCost; inventoryValueIn += costTotal;
    } else if (type === 'sale_return') {
      // بهای تمام‌شده برگشتی از فاکتور اصلی خوانده می‌شود تا سود دقیق بماند
      let cost = null;
      if (refInvoice) {
        const orig = db.prepare(`SELECT unit_cost, qty FROM invoice_items
                                 WHERE invoice_id=? AND product_id=? LIMIT 1`).get(refInvoice.id, product.id);
        if (orig && orig.unit_cost) cost = r(line.qty * orig.unit_cost);
      }
      if (cost === null) cost = r(line.qty * inventory.avgCost(product));
      const mv = inventory.applyMovement(db, {
        date, productId: product.id, type: 'sale_return', direction: 'in', qty: line.qty,
        value: cost, unitCost: line.qty ? cost / line.qty : 0,
        refType: 'invoice', refId: invoiceId, description: `برگشت از فروش - فاکتور ${invoiceNo}`,
      });
      costTotal = mv.value; unitCost = mv.unitCost; cogsTotal += costTotal;
    } else if (type === 'purchase_return') {
      inventory.ensureAvailable(db, product.id, line.qty, allowNegative);
      const available = Math.max(0, product.stock_value);
      const value = Math.min(netLine, product.stock > 0 ? Math.max(0, r(available * Math.min(1, line.qty / product.stock))) : netLine);
      const mv = inventory.applyMovement(db, {
        date, productId: product.id, type: 'purchase_return', direction: 'out', qty: line.qty,
        value, unitCost: line.qty ? value / line.qty : 0,
        refType: 'invoice', refId: invoiceId, description: `برگشت از خرید - فاکتور ${invoiceNo}`,
      });
      costTotal = mv.value; unitCost = mv.unitCost; inventoryValueIn += costTotal;
    }

    itemStmt.run(invoiceId, product.id, product.name, product.code, product.unit,
      line.qty, line.unit_price, line.discount, line.line_total, unitCost, costTotal);
  });

  // ------- سند حسابداری -------
  const lines = [];
  const payLineStmt = db.prepare(`INSERT INTO payment_lines
    (doc_type,doc_id,direction,method,account_code,amount,check_id,date,description)
    VALUES ('invoice',?,?,?,?,?,?,?,?)`);
  const createdChecks = [];

  for (const p of payments) {
    const acc = settlementAccount(p.method, direction);
    let checkId = null;
    if (p.method === 'check') {
      const chk = p.check || {};
      const chkKind = direction === 'in' ? 'received' : 'paid';
      const ci = db.prepare(`INSERT INTO checks
        (kind,number,bank,branch,party_id,party_name,amount,issue_date,due_date,status,doc_type,doc_id,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'pending','invoice',?,?,?)`)
        .run(chkKind, String(chk.number || ''), String(chk.bank || ''), String(chk.branch || ''),
          partyId, partyName, p.amount, chk.issue_date || date, chk.due_date || date,
          invoiceId, String(chk.notes || ''), now);
      checkId = Number(ci.lastInsertRowid);
      createdChecks.push(checkId);
      db.prepare(`INSERT INTO check_events(check_id,date,from_status,to_status,entry_id,notes,created_at)
                  VALUES (?,?,'','pending',NULL,?,?)`).run(checkId, date, 'ثبت اولیه چک', now);
    }
    payLineStmt.run(invoiceId, direction, p.method, acc, p.amount, checkId, date, p.description || '');
    if (direction === 'in') lines.push({ account: acc, debit: p.amount, description: accounting.METHOD_LABELS[p.method] });
    else lines.push({ account: acc, credit: p.amount, description: accounting.METHOD_LABELS[p.method] });
  }

  if (type === 'sale') {
    if (due > 0) lines.push({ account: ACC.RECEIVABLE, debit: due, partyId, description: 'نسیه فروش' });
    if (totals.discountTotal > 0) lines.push({ account: ACC.SALES_DISCOUNTS, debit: totals.discountTotal, description: 'تخفیف فروش' });
    lines.push({ account: ACC.SALES, credit: totals.subtotal, description: 'فروش کالا' });
    if (totals.vat > 0) lines.push({ account: ACC.VAT, credit: totals.vat, description: 'ارزش افزوده فروش' });
  } else if (type === 'purchase') {
    const invValue = inventoryValueIn;
    lines.push({ account: ACC.INVENTORY, debit: invValue, description: 'خرید کالا' });
    if (vatDeductible && totals.vat > 0) lines.push({ account: ACC.VAT, debit: totals.vat, description: 'ارزش افزوده خرید' });
    const expectedDebit = invValue + (vatDeductible ? totals.vat : 0);
    const diff = totals.total - expectedDebit;
    if (diff > 0) lines.push({ account: ACC.PURCHASES, debit: diff, description: 'مابه‌التفاوت خرید' });
    else if (diff < 0) lines.push({ account: ACC.PURCHASES, credit: -diff, description: 'مابه‌التفاوت خرید' });
    if (due > 0) lines.push({ account: ACC.PAYABLE, credit: due, partyId, description: 'خرید نسیه' });
  } else if (type === 'sale_return') {
    lines.push({ account: ACC.SALES_RETURNS, debit: totals.subtotal, description: 'برگشت از فروش' });
    if (totals.vat > 0) lines.push({ account: ACC.VAT, debit: totals.vat, description: 'برگشت ارزش افزوده' });
    if (totals.discountTotal > 0) lines.push({ account: ACC.SALES_DISCOUNTS, credit: totals.discountTotal, description: 'برگشت تخفیف فروش' });
    if (due > 0) lines.push({ account: ACC.RECEIVABLE, credit: due, partyId, description: 'کاهش طلب از مشتری' });
  } else if (type === 'purchase_return') {
    if (due > 0) lines.push({ account: ACC.PAYABLE, debit: due, partyId, description: 'کاهش بدهی به تأمین‌کننده' });
    lines.push({ account: ACC.INVENTORY, credit: inventoryValueIn, description: 'برگشت کالا به فروشنده' });
    if (vatDeductible && totals.vat > 0) lines.push({ account: ACC.VAT, credit: totals.vat, description: 'برگشت ارزش افزوده خرید' });
    const credited = inventoryValueIn + (vatDeductible && totals.vat > 0 ? totals.vat : 0);
    const diff = totals.total - credited;
    if (diff > 0) lines.push({ account: '402-90', credit: diff, description: 'مابه‌التفاوت برگشت از خرید' });
    else if (diff < 0) lines.push({ account: '502-90', debit: -diff, description: 'مابه‌التفاوت برگشت از خرید' });
  }

  const entryId = accounting.postEntry(db, {
    date, refType: type, refId: invoiceId,
    description: `${TYPE_LABELS[type]} شماره ${invoiceNo}${partyName ? ' - ' + partyName : ''}`,
    lines,
  });

  // سند بهای تمام‌شده
  if (type === 'sale' && cogsTotal > 0) {
    accounting.postEntry(db, {
      date, refType: 'cogs', refId: invoiceId,
      description: `بهای تمام‌شده کالای فروش‌رفته - فاکتور ${invoiceNo}`,
      lines: [
        { account: ACC.COGS, debit: cogsTotal, description: 'بهای تمام‌شده' },
        { account: ACC.INVENTORY, credit: cogsTotal, description: 'کاهش موجودی کالا' },
      ],
    });
  } else if (type === 'sale_return' && cogsTotal > 0) {
    accounting.postEntry(db, {
      date, refType: 'cogs_return', refId: invoiceId,
      description: `برگشت بهای تمام‌شده - فاکتور ${invoiceNo}`,
      lines: [
        { account: ACC.INVENTORY, debit: cogsTotal, description: 'افزایش موجودی کالا' },
        { account: ACC.COGS, credit: cogsTotal, description: 'برگشت بهای تمام‌شده' },
      ],
    });
  }

  db.prepare('UPDATE invoices SET entry_id=?, cogs=? WHERE id=?').run(entryId, cogsTotal, invoiceId);
  return invoiceId;
}

function create(db, payload) {
  const run = db.transaction(() => createInvoiceInner(db, payload));
  const id = run();
  return getFull(db, id);
}

function getFull(db, id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!invoice) throw new AppError('فاکتور یافت نشد.', 'NO_INVOICE');
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(id);
  const paymentLines = db.prepare(`SELECT pl.*, c.number check_number, c.bank check_bank, c.due_date check_due
    FROM payment_lines pl LEFT JOIN checks c ON c.id=pl.check_id
    WHERE pl.doc_type='invoice' AND pl.doc_id=?`).all(id);
  const party = invoice.party_id ? db.prepare('SELECT * FROM parties WHERE id=?').get(invoice.party_id) : null;
  const entries = db.prepare(`SELECT e.*, (SELECT json_group_array(json_object(
        'account', l.account_code, 'name', (SELECT name FROM accounts WHERE code=l.account_code),
        'debit', l.debit, 'credit', l.credit, 'description', l.description))
      FROM journal_lines l WHERE l.entry_id=e.id) lines_json
    FROM journal_entries e WHERE e.ref_id=? AND e.ref_type IN (?,?,?)
    ORDER BY e.id`).all(id, invoice.type, 'cogs', 'cogs_return');
  return {
    invoice, items, paymentLines, party,
    entries: entries.map((e) => ({ ...e, lines: JSON.parse(e.lines_json || '[]') })),
  };
}

function list(db, filter = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.type) { where += ' AND i.type=@type'; params.type = filter.type; }
  if (filter.types) { where += ` AND i.type IN (${filter.types.map((t) => `'${t}'`).join(',')})`; }
  if (filter.from) { where += ' AND i.date>=@from'; params.from = filter.from; }
  if (filter.to) { where += ' AND i.date<=@to'; params.to = filter.to; }
  if (filter.partyId) { where += ' AND i.party_id=@pid'; params.pid = Number(filter.partyId); }
  if (filter.status) { where += ' AND i.status=@status'; params.status = filter.status; }
  if (filter.onlyUnpaid) where += ' AND i.due > 0';
  if (filter.q) {
    where += ' AND (i.invoice_no LIKE @q OR i.party_name LIKE @q OR i.notes LIKE @q)';
    params.q = '%' + String(filter.q).trim() + '%';
  }
  const limit = Math.min(Number(filter.limit) || 100, 2000);
  const offset = Number(filter.offset) || 0;
  const rows = db.prepare(`SELECT i.* FROM invoices i ${where}
                           ORDER BY i.date DESC, i.id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  const agg = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) total, COALESCE(SUM(paid),0) paid,
                                 COALESCE(SUM(due),0) due, COALESCE(SUM(vat),0) vat,
                                 COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(cogs),0) cogs,
                                 COALESCE(SUM(discount_total),0) discount
                          FROM invoices i ${where} AND i.status='posted'`).get(params);
  return { rows, total: agg.c, summary: agg };
}

/** ابطال فاکتور: برگشت انبار، سند معکوس و لغو چک‌های مرتبط */
function voidInvoice(db, id, reason) {
  const run = db.transaction(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
    if (!inv) throw new AppError('فاکتور یافت نشد.', 'NO_INVOICE');
    if (inv.status === 'void') throw new AppError('این فاکتور قبلاً ابطال شده است.', 'ALREADY_VOID');

    const returns = db.prepare('SELECT COUNT(*) c FROM invoices WHERE ref_invoice_id=? AND status=\'posted\'').get(id).c;
    if (returns > 0) throw new AppError('برای این فاکتور سند برگشتی ثبت شده است؛ ابتدا سند برگشتی را ابطال کنید.', 'HAS_RETURNS');

    const checks = db.prepare("SELECT * FROM checks WHERE doc_type='invoice' AND doc_id=?").all(id);
    for (const c of checks) {
      if (c.status !== 'pending' && c.status !== 'cancelled') {
        throw new AppError(`چک شماره ${c.number} وضعیت «${c.status}» دارد و امکان ابطال فاکتور وجود ندارد.`, 'CHECK_SETTLED');
      }
    }

    const date = todayIso();
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(id);
    const allowNegative = settings.bool(db, 'allow_negative_stock', false);
    for (const it of items) {
      if (!it.product_id) continue;
      const back = (inv.type === 'sale' || inv.type === 'purchase_return') ? 'in' : 'out';
      if (back === 'out') inventory.ensureAvailable(db, it.product_id, it.qty, allowNegative);
      inventory.applyMovement(db, {
        date, productId: it.product_id, type: 'void', direction: back, qty: it.qty,
        value: it.cost_total, unitCost: it.unit_cost,
        refType: 'invoice_void', refId: id, description: `ابطال ${TYPE_LABELS[inv.type]} ${inv.invoice_no}`,
      });
    }

    const entries = db.prepare(`SELECT id FROM journal_entries WHERE ref_id=? AND ref_type IN (?,?,?)
                                AND reversed_of IS NULL`).all(id, inv.type, 'cogs', 'cogs_return');
    for (const e of entries) {
      accounting.reverseEntry(db, e.id, date, `ابطال ${TYPE_LABELS[inv.type]} ${inv.invoice_no}`);
    }
    for (const c of checks) {
      db.prepare("UPDATE checks SET status='cancelled', notes=? WHERE id=?")
        .run((c.notes ? c.notes + ' | ' : '') + 'ابطال به همراه فاکتور', c.id);
      db.prepare(`INSERT INTO check_events(check_id,date,from_status,to_status,entry_id,notes,created_at)
                  VALUES (?,?,?,'cancelled',NULL,?,?)`)
        .run(c.id, date, c.status, 'ابطال فاکتور', new Date().toISOString());
    }
    db.prepare("UPDATE invoices SET status='void', notes=? WHERE id=?")
      .run((inv.notes ? inv.notes + ' | ' : '') + 'ابطال شد' + (reason ? ': ' + reason : ''), id);
    return id;
  });
  const invId = run();
  return getFull(db, invId);
}

/** اقلام قابل برگشت یک فاکتور (تعداد فروخته/خریداری‌شده منهای برگشت‌های قبلی) */
function returnableItems(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!inv) throw new AppError('فاکتور یافت نشد.', 'NO_INVOICE');
  if (inv.status !== 'posted') throw new AppError('فاکتور ابطال‌شده قابل برگشت نیست.', 'VOID_INVOICE');
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(invoiceId);
  const returned = db.prepare(`SELECT ii.product_id, COALESCE(SUM(ii.qty),0) qty
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE i.ref_invoice_id=? AND i.status='posted' GROUP BY ii.product_id`).all(invoiceId);
  const map = {};
  for (const x of returned) map[x.product_id] = x.qty;
  return {
    invoice: inv,
    items: items.map((it) => ({
      ...it,
      returned_qty: map[it.product_id] || 0,
      remaining_qty: toQty(it.qty - (map[it.product_id] || 0)),
    })).filter((it) => it.remaining_qty > 0),
  };
}

module.exports = {
  TYPE_LABELS, MONEY_DIRECTION, settlementAccount, computeTotals, distribute,
  create, getFull, list, voidInvoice, returnableItems,
};
