'use strict';
/**
 * انبار و بهای تمام‌شده.
 * روش قیمت‌گذاری: میانگین موزون متحرک (Weighted Average Cost).
 * برای هر کالا دو مقدار نگهداری می‌شود: تعداد موجودی (stock) و ارزش ریالی موجودی
 * (stock_value). بهای هر واحد = stock_value / stock. با این روش هنگام صفر شدن
 * تعداد موجودی، ارزش موجودی نیز دقیقاً صفر می‌شود و مانده حساب «موجودی کالا»
 * در دفاتر با انبار مطابقت کامل دارد.
 */
const { AppError } = require('../util/errors');
const { r, toQty } = require('../util/money');
const { todayIso } = require('../util/jalali');

const MOVEMENT_LABELS = {
  purchase: 'خرید',
  sale: 'فروش',
  sale_return: 'برگشت از فروش',
  purchase_return: 'برگشت از خرید',
  adjust_in: 'اصلاح افزایشی',
  adjust_out: 'اصلاح کاهشی',
  count: 'انبارگردانی',
  opening: 'موجودی اول دوره',
  void: 'ابطال سند',
};

function getProduct(db, productId) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!p) throw new AppError('کالای مورد نظر یافت نشد.', 'NO_PRODUCT');
  return p;
}

/** بهای میانگین هر واحد کالا */
function avgCost(product) {
  if (!product.stock || product.stock <= 0) return product.buy_price || 0;
  return product.stock_value / product.stock;
}

/**
 * ثبت یک گردش انبار و به‌روزرسانی موجودی و ارزش کالا.
 * @returns {{value:number, unitCost:number, balanceQty:number, balanceValue:number, movementId:number}}
 */
function applyMovement(db, m) {
  const product = getProduct(db, m.productId);
  const qty = toQty(m.qty);
  if (qty <= 0) throw new AppError('تعداد گردش انبار باید بزرگ‌تر از صفر باشد.', 'BAD_QTY');
  const direction = m.direction === 'out' ? 'out' : 'in';

  let value;
  if (m.value !== undefined && m.value !== null) {
    value = Math.max(0, r(m.value));
  } else if (direction === 'in') {
    value = Math.max(0, r(qty * (m.unitCost || 0)));
  } else if (product.stock > 0) {
    value = qty >= product.stock
      ? Math.max(0, product.stock_value)
      : Math.max(0, r(product.stock_value * (qty / product.stock)));
  } else {
    // موجودی صفر یا منفی: بهای واحد از آخرین بهای خرید برآورد می‌شود
    value = Math.max(0, r(qty * (m.unitCost || product.buy_price || 0)));
  }

  const signedQty = direction === 'in' ? qty : -qty;
  const signedValue = direction === 'in' ? value : -value;
  const balanceQty = toQty(product.stock + signedQty);
  let balanceValue = product.stock_value + signedValue;
  if (Math.abs(balanceQty) < 0.0000001) balanceValue = 0; // موجودی صفر ⇒ ارزش صفر
  if (balanceValue < 0 && balanceQty >= 0) balanceValue = 0;

  db.prepare('UPDATE products SET stock=?, stock_value=?, updated_at=? WHERE id=?')
    .run(balanceQty, balanceValue, new Date().toISOString(), product.id);

  const unitCost = qty ? Math.abs(value) / qty : 0;
  const info = db.prepare(`INSERT INTO inventory_movements
      (date,product_id,type,qty,unit_cost,value,balance_qty,balance_value,ref_type,ref_id,description,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(m.date || todayIso(), product.id, m.type || (direction === 'in' ? 'adjust_in' : 'adjust_out'),
      signedQty, unitCost, signedValue, balanceQty, balanceValue,
      m.refType || '', m.refId || null, m.description || '', new Date().toISOString());

  return { value, unitCost, balanceQty, balanceValue, movementId: Number(info.lastInsertRowid) };
}

/** بررسی کفایت موجودی پیش از خروج کالا */
function ensureAvailable(db, productId, qty, allowNegative) {
  const p = getProduct(db, productId);
  if (!allowNegative && toQty(p.stock) < toQty(qty) - 0.0000001) {
    throw new AppError(
      `موجودی کالای «${p.name}» کافی نیست (موجودی: ${p.stock}، درخواست: ${qty}).`,
      'NO_STOCK',
    );
  }
  return p;
}

/** ارزش کل موجودی انبار */
function totalValuation(db) {
  const row = db.prepare(`SELECT COALESCE(SUM(stock_value),0) value, COALESCE(SUM(stock),0) qty,
                                 COUNT(*) count FROM products WHERE active=1`).get();
  return { value: row.value || 0, qty: row.qty || 0, count: row.count || 0 };
}

/** فهرست ارزش موجودی به تفکیک کالا */
function valuationRows(db) {
  return db.prepare(`
    SELECT p.id, p.name, p.code, p.barcode, p.unit, p.stock, p.stock_value,
           CASE WHEN p.stock > 0 THEN p.stock_value / p.stock ELSE p.buy_price END avg_cost,
           p.sell_price, p.min_stock, c.name category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.active=1 ORDER BY p.name`).all();
}

/** کالاهای زیر حد سفارش */
function lowStock(db) {
  return db.prepare(`
    SELECT id,name,code,unit,stock,min_stock,sell_price
    FROM products WHERE active=1 AND min_stock > 0 AND stock <= min_stock
    ORDER BY (stock - min_stock), name`).all();
}

/** گردش انبار با فیلتر */
function movements(db, filter = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.productId) { where += ' AND m.product_id=@productId'; params.productId = filter.productId; }
  if (filter.from) { where += ' AND m.date>=@from'; params.from = filter.from; }
  if (filter.to) { where += ' AND m.date<=@to'; params.to = filter.to; }
  if (filter.type) { where += ' AND m.type=@type'; params.type = filter.type; }
  const limit = Math.min(Number(filter.limit) || 500, 5000);
  const offset = Number(filter.offset) || 0;
  const rows = db.prepare(`
    SELECT m.*, p.name product_name, p.code product_code, p.unit
    FROM inventory_movements m JOIN products p ON p.id=m.product_id
    ${where} ORDER BY m.date DESC, m.id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  const total = db.prepare(`SELECT COUNT(*) c FROM inventory_movements m ${where}`).get(params).c;
  return { rows, total };
}

module.exports = {
  MOVEMENT_LABELS, applyMovement, ensureAvailable, avgCost, getProduct,
  totalValuation, valuationRows, lowStock, movements,
};
