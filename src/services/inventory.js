'use strict';
/*
 * موتور انبار و بهای تمام‌شده.
 * روش قیمت‌گذاری: میانگین موزون متحرک (Weighted Average Cost)
 * برای هر کالا دو مقدار نگهداری می‌شود: stock_qty (تعداد) و stock_value (ارزش صحیح).
 * بهای هر واحد = stock_value / stock_qty ؛ بنابراین حساب ۱۰۶ همیشه با جمع ارزش کالاها برابر است.
 */
const settings = require('./settings.js');
const journal = require('./journal.js');
const C = require('../shared/constants.js');

const EPS = 1e-9;

function getProduct(db, id) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!p) throw new Error('کالا یافت نشد (شناسه ' + id + ').');
  return p;
}

function writeMove(db, m) {
  db.prepare(
    'INSERT INTO stock_moves (date, product_id, move_type, qty, unit_cost, value, balance_qty, balance_value, ref_type, ref_id, ref_no, description) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(m.date, m.product_id, m.move_type, m.qty, m.unit_cost, m.value, m.balance_qty, m.balance_value,
    m.ref_type || null, m.ref_id || null, m.ref_no || null, m.description || null);
}

function updateProductStock(db, productId, qty, value) {
  db.prepare('UPDATE products SET stock_qty = ?, stock_value = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(qty, value, productId);
}

/** ورود کالا به انبار — ارزش افزوده‌شده = qty × unit_cost */
function stockIn(db, o) {
  const p = getProduct(db, o.product_id);
  const qty = Number(o.qty);
  if (!(qty > 0)) throw new Error('تعداد ورودی باید بزرگ‌تر از صفر باشد.');
  const unitCost = Number(o.unit_cost) || 0;
  const value = Math.round(qty * unitCost);
  const newQty = p.stock_qty + qty;
  const newValue = p.stock_value + value;
  updateProductStock(db, p.id, newQty, newValue);
  writeMove(db, {
    date: o.date, product_id: p.id, move_type: o.move_type || 'purchase',
    qty: qty, unit_cost: unitCost, value: value,
    balance_qty: newQty, balance_value: newValue,
    ref_type: o.ref_type, ref_id: o.ref_id, ref_no: o.ref_no, description: o.description
  });
  return { value: value, unit_cost: unitCost };
}

/**
 * خروج کالا از انبار.
 * اگر forced_unit_cost داده شود (مثلاً برگشت از خرید) با همان بها خارج می‌شود،
 * در غیر این صورت با میانگین موزون جاری.
 */
function stockOut(db, o) {
  const p = getProduct(db, o.product_id);
  const qty = Number(o.qty);
  if (!(qty > 0)) throw new Error('تعداد خروجی باید بزرگ‌تر از صفر باشد.');

  const allowNegative = settings.getBool(db, 'allow_negative_stock');
  if (!allowNegative && p.stock_qty - qty < -EPS) {
    throw new Error('موجودی کالای «' + p.name + '» کافی نیست (موجودی: ' + p.stock_qty + '، درخواست: ' + qty + ').');
  }

  let unitCost, value;
  if (o.forced_unit_cost !== undefined && o.forced_unit_cost !== null) {
    unitCost = Number(o.forced_unit_cost) || 0;
    value = -Math.round(qty * unitCost);
  } else if (p.stock_qty > EPS) {
    unitCost = p.stock_value / p.stock_qty;
    value = (qty >= p.stock_qty - EPS) ? -p.stock_value : -Math.round(unitCost * qty);
  } else {
    // موجودی منفی مجاز: از آخرین بهای خرید استفاده می‌شود
    unitCost = p.purchase_price || 0;
    value = -Math.round(qty * unitCost);
  }

  const newQty = p.stock_qty - qty;
  const newValue = p.stock_value + value;
  updateProductStock(db, p.id, newQty, newValue);
  writeMove(db, {
    date: o.date, product_id: p.id, move_type: o.move_type || 'sale',
    qty: -qty, unit_cost: unitCost, value: value,
    balance_qty: newQty, balance_value: newValue,
    ref_type: o.ref_type, ref_id: o.ref_id, ref_no: o.ref_no, description: o.description
  });
  return { value: -value, unit_cost: unitCost, cost: -value };
}

/** برگرداندن تمام حرکات یک مدرک (هنگام حذف یا ویرایش) */
function reverseMoves(db, refType, refId) {
  const moves = db.prepare('SELECT * FROM stock_moves WHERE ref_type=? AND ref_id=? ORDER BY id DESC').all(refType, refId);
  const allowNegative = settings.getBool(db, 'allow_negative_stock');
  for (const m of moves) {
    const p = getProduct(db, m.product_id);
    const newQty = p.stock_qty - m.qty;
    const newValue = p.stock_value - m.value;
    if (!allowNegative && newQty < -EPS) {
      throw new Error('حذف این سند موجودی کالای «' + p.name + '» را منفی می‌کند.');
    }
    updateProductStock(db, p.id, newQty, newValue);
  }
  db.prepare('DELETE FROM stock_moves WHERE ref_type=? AND ref_id=?').run(refType, refId);
  return moves.length;
}

/** ثبت موجودی اولیه هنگام تعریف کالا (سرمایه اولیه) */
function setOpeningStock(db, o) {
  const qty = Number(o.qty) || 0;
  if (qty <= 0) return null;
  const unitCost = Number(o.unit_cost) || 0;
  const r = stockIn(db, {
    date: o.date, product_id: o.product_id, qty: qty, unit_cost: unitCost,
    move_type: 'opening', ref_type: 'product_opening', ref_id: o.product_id,
    description: 'موجودی اولیه کالا'
  });
  if (r.value > 0) {
    const entryId = journal.post(db, {
      date: o.date,
      description: 'موجودی اولیه کالا',
      ref_type: 'product_opening',
      ref_id: o.product_id,
      lines: [
        { account: C.ACC.INVENTORY, debit: r.value, description: 'موجودی اولیه' },
        { account: C.ACC.EQUITY, credit: r.value, description: 'سرمایه اولیه - موجودی کالا' }
      ]
    });
    return entryId;
  }
  return null;
}

/** اصلاح / انبارگردانی: تعیین موجودی جدید یا افزایش و کاهش دستی */
function adjust(db, o) {
  const p = getProduct(db, o.product_id);
  const date = o.date;
  const desc = o.description || 'اصلاح موجودی انبار';
  let diffQty;
  if (o.mode === 'count') {
    diffQty = Number(o.new_qty) - p.stock_qty;
  } else {
    diffQty = o.mode === 'out' ? -Math.abs(Number(o.qty)) : Math.abs(Number(o.qty));
  }
  if (Math.abs(diffQty) < EPS) return { changed: false };

  const refId = db.prepare('SELECT COALESCE(MAX(ref_id),0)+1 AS n FROM stock_moves WHERE ref_type=\'adjustment\'').get().n;
  let value;
  if (diffQty > 0) {
    const unitCost = (o.unit_cost !== undefined && o.unit_cost !== null && o.unit_cost !== '')
      ? Number(o.unit_cost)
      : (p.stock_qty > EPS ? p.stock_value / p.stock_qty : p.purchase_price);
    const r = stockIn(db, {
      date: date, product_id: p.id, qty: diffQty, unit_cost: unitCost,
      move_type: o.mode === 'count' ? 'count' : 'adjust_in',
      ref_type: 'adjustment', ref_id: refId, description: desc
    });
    value = r.value;
  } else {
    const r = stockOut(db, {
      date: date, product_id: p.id, qty: -diffQty,
      move_type: o.mode === 'count' ? 'count' : 'adjust_out',
      ref_type: 'adjustment', ref_id: refId, description: desc
    });
    value = -r.cost;
  }

  let entryId = null;
  if (value !== 0) {
    const lines = value > 0
      ? [{ account: C.ACC.INVENTORY, debit: value, description: desc },
         { account: C.ACC.OPERATING_EXPENSE, credit: value, description: 'اضافی انبار' }]
      : [{ account: C.ACC.OPERATING_EXPENSE, debit: -value, description: 'کسری انبار' },
         { account: C.ACC.INVENTORY, credit: -value, description: desc }];
    entryId = journal.post(db, {
      date: date, description: desc + ' - ' + p.name,
      ref_type: 'adjustment', ref_id: refId, lines: lines
    });
  }
  return { changed: true, diff_qty: diffQty, value: value, entry_id: entryId, ref_id: refId };
}

/** ارزش کل موجودی انبار */
function totalValue(db) {
  const r = db.prepare('SELECT COALESCE(SUM(stock_value),0) v, COALESCE(SUM(stock_qty),0) q FROM products').get();
  return { value: r.v, qty: r.q };
}

function lowStock(db, limit) {
  return db.prepare(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ' +
    'WHERE p.active=1 AND p.min_stock > 0 AND p.stock_qty <= p.min_stock ORDER BY (p.stock_qty - p.min_stock) LIMIT ?'
  ).all(limit || 100);
}

function moves(db, o) {
  const opt = o || {};
  const where = [];
  const args = [];
  if (opt.from) { where.push('m.date >= ?'); args.push(opt.from); }
  if (opt.to) { where.push('m.date <= ?'); args.push(opt.to); }
  if (opt.product_id) { where.push('m.product_id = ?'); args.push(opt.product_id); }
  if (opt.move_type) { where.push('m.move_type = ?'); args.push(opt.move_type); }
  const sql = 'SELECT m.*, p.name AS product_name, p.unit FROM stock_moves m JOIN products p ON p.id=m.product_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY m.date DESC, m.id DESC LIMIT ? OFFSET ?';
  args.push(opt.limit || 500, opt.offset || 0);
  return db.prepare(sql).all(...args);
}

/** ارزش‌گذاری موجودی */
function valuation(db) {
  return db.prepare(
    'SELECT p.id, p.code, p.name, p.unit, p.stock_qty, p.stock_value, p.sale_price, ' +
    '       CASE WHEN p.stock_qty > 0 THEN p.stock_value / p.stock_qty ELSE 0 END AS avg_cost, ' +
    '       c.name AS category_name ' +
    'FROM products p LEFT JOIN categories c ON c.id=p.category_id ' +
    'WHERE p.active=1 OR p.stock_qty <> 0 ORDER BY p.name'
  ).all();
}

module.exports = {
  stockIn: stockIn,
  stockOut: stockOut,
  reverseMoves: reverseMoves,
  setOpeningStock: setOpeningStock,
  adjust: adjust,
  totalValue: totalValue,
  lowStock: lowStock,
  moves: moves,
  valuation: valuation
};
