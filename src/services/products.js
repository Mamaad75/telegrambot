'use strict';
/* مدیریت کالا و دسته‌بندی */
const inventory = require('./inventory.js');
const journal = require('./journal.js');
const Jalali = require('../shared/jalali.js');
const Fmt = require('../shared/format.js');

function decorate(p) {
  if (!p) return p;
  p.avg_cost = p.stock_qty > 0 ? Math.round(p.stock_value / p.stock_qty) : 0;
  p.is_low = p.min_stock > 0 && p.stock_qty <= p.min_stock;
  return p;
}

function list(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    const sd = '%' + Fmt.toEnDigits(String(o.search).trim()) + '%';
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)');
    args.push(s, sd, sd, s);
  }
  if (o.category_id) { where.push('p.category_id = ?'); args.push(o.category_id); }
  if (o.active !== undefined && o.active !== null && o.active !== '') { where.push('p.active = ?'); args.push(o.active ? 1 : 0); }
  if (o.lowStock) where.push('p.min_stock > 0 AND p.stock_qty <= p.min_stock');
  if (o.inStock) where.push('p.stock_qty > 0');

  const order = {
    name: 'p.name', code: 'p.code', stock: 'p.stock_qty DESC', price: 'p.sale_price DESC',
    newest: 'p.id DESC'
  }[o.order || 'name'] || 'p.name';

  const sql = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') + 'ORDER BY ' + order + ' LIMIT ? OFFSET ?';
  args.push(o.limit || 200, o.offset || 0);
  return db.prepare(sql).all(...args).map(decorate);
}

function count(db, opt) {
  const o = opt || {};
  const where = [];
  const args = [];
  if (o.search) {
    const s = '%' + String(o.search).trim() + '%';
    where.push('(name LIKE ? OR code LIKE ? OR barcode LIKE ?)');
    args.push(s, s, s);
  }
  if (o.active !== undefined && o.active !== null && o.active !== '') { where.push('active = ?'); args.push(o.active ? 1 : 0); }
  const sql = 'SELECT COUNT(*) c FROM products ' + (where.length ? 'WHERE ' + where.join(' AND ') : '');
  return db.prepare(sql).get(...args).c;
}

function get(db, id) {
  const p = db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(id);
  return decorate(p);
}

/** جست‌وجوی سریع برای فاکتور (بارکد دقیق در اولویت) */
function quickSearch(db, term, limit) {
  const t = String(term || '').trim();
  if (!t) return [];
  const digits = Fmt.toEnDigits(t);
  const exact = db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ' +
    'WHERE p.active=1 AND (p.barcode = ? OR p.code = ?) LIMIT 5').all(digits, digits);
  const like = '%' + t + '%';
  const likeD = '%' + digits + '%';
  const rest = db.prepare(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ' +
    'WHERE p.active=1 AND (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?) ORDER BY p.name LIMIT ?'
  ).all(like, likeD, likeD, limit || 20);
  const seen = new Set();
  const out = [];
  for (const r of exact.concat(rest)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(decorate(r));
  }
  return out;
}

function findByBarcode(db, barcode) {
  const b = Fmt.toEnDigits(String(barcode || '').trim());
  if (!b) return null;
  return decorate(db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ' +
    'WHERE p.barcode=? OR p.code=? LIMIT 1').get(b, b));
}

function validate(db, data, id) {
  const errors = [];
  if (!data.name || !String(data.name).trim()) errors.push('نام کالا الزامی است.');
  if (data.code) {
    const dup = db.prepare('SELECT id FROM products WHERE code=? AND id<>?').get(String(data.code).trim(), id || 0);
    if (dup) errors.push('کد کالا تکراری است.');
  }
  if (data.barcode) {
    const dup = db.prepare('SELECT id, name FROM products WHERE barcode=? AND id<>?').get(Fmt.toEnDigits(String(data.barcode).trim()), id || 0);
    if (dup) errors.push('بارکد قبلاً برای کالای «' + dup.name + '» ثبت شده است.');
  }
  return errors;
}

function nextCode(db) {
  const row = db.prepare('SELECT code FROM products WHERE code LIKE \'K-%\' ORDER BY CAST(SUBSTR(code,3) AS INTEGER) DESC LIMIT 1').get();
  const n = row ? (parseInt(String(row.code).slice(2), 10) || 0) + 1 : 1;
  return 'K-' + String(n).padStart(4, '0');
}

function create(db, data) {
  const errors = validate(db, data, null);
  if (errors.length) throw new Error(errors.join(' '));
  const tx = db.transaction(function () {
    const info = db.prepare(
      'INSERT INTO products (code, barcode, name, category_id, unit, purchase_price, sale_price, min_stock, stock_qty, stock_value, description, active) ' +
      'VALUES (?,?,?,?,?,?,?,?,0,0,?,?)'
    ).run(
      data.code ? String(data.code).trim() : nextCode(db),
      data.barcode ? Fmt.toEnDigits(String(data.barcode).trim()) : null,
      String(data.name).trim(),
      data.category_id || null,
      data.unit || 'عدد',
      Math.round(Number(data.purchase_price) || 0),
      Math.round(Number(data.sale_price) || 0),
      Number(data.min_stock) || 0,
      data.description || null,
      data.active === 0 || data.active === false ? 0 : 1
    );
    const id = info.lastInsertRowid;
    const openQty = Number(data.opening_qty) || 0;
    if (openQty > 0) {
      const cost = Number(data.opening_cost);
      inventory.setOpeningStock(db, {
        date: data.date || Jalali.todayIso(),
        product_id: id,
        qty: openQty,
        unit_cost: isNaN(cost) || cost === 0 ? (Number(data.purchase_price) || 0) : cost
      });
    }
    return id;
  });
  return get(db, tx());
}

function update(db, id, data) {
  const cur = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!cur) throw new Error('کالا یافت نشد.');
  const errors = validate(db, Object.assign({}, cur, data), id);
  if (errors.length) throw new Error(errors.join(' '));
  db.prepare(
    'UPDATE products SET code=?, barcode=?, name=?, category_id=?, unit=?, purchase_price=?, sale_price=?, min_stock=?, description=?, active=?, ' +
    'updated_at=datetime(\'now\',\'localtime\') WHERE id=?'
  ).run(
    data.code !== undefined ? (data.code ? String(data.code).trim() : null) : cur.code,
    data.barcode !== undefined ? (data.barcode ? Fmt.toEnDigits(String(data.barcode).trim()) : null) : cur.barcode,
    data.name !== undefined ? String(data.name).trim() : cur.name,
    data.category_id !== undefined ? (data.category_id || null) : cur.category_id,
    data.unit !== undefined ? data.unit : cur.unit,
    data.purchase_price !== undefined ? Math.round(Number(data.purchase_price) || 0) : cur.purchase_price,
    data.sale_price !== undefined ? Math.round(Number(data.sale_price) || 0) : cur.sale_price,
    data.min_stock !== undefined ? (Number(data.min_stock) || 0) : cur.min_stock,
    data.description !== undefined ? data.description : cur.description,
    data.active !== undefined ? (data.active ? 1 : 0) : cur.active,
    id
  );
  return get(db, id);
}

function used(db, id) {
  const a = db.prepare('SELECT COUNT(*) c FROM sales_invoice_items WHERE product_id=?').get(id).c;
  const b = db.prepare('SELECT COUNT(*) c FROM purchase_invoice_items WHERE product_id=?').get(id).c;
  const c = db.prepare('SELECT COUNT(*) c FROM stock_moves WHERE product_id=? AND ref_type<>\'product_opening\'').get(id).c;
  return a + b + c > 0;
}

function remove(db, id) {
  if (used(db, id)) throw new Error('این کالا در اسناد استفاده شده است و حذف نمی‌شود؛ می‌توانید آن را غیرفعال کنید.');
  const tx = db.transaction(function () {
    journal.deleteByRef(db, 'product_opening', id);
    db.prepare('DELETE FROM stock_moves WHERE product_id=?').run(id);
    db.prepare('DELETE FROM products WHERE id=?').run(id);
  });
  tx();
  return true;
}

function deactivate(db, id) {
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(id);
  return true;
}

/* ------------------------------ دسته‌بندی‌ها ------------------------------ */
function categories(db) {
  return db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS product_count FROM categories c ORDER BY c.name').all();
}

function createCategory(db, name) {
  if (!name || !String(name).trim()) throw new Error('نام دسته الزامی است.');
  const info = db.prepare('INSERT INTO categories (name, active) VALUES (?,1) ON CONFLICT(name) DO NOTHING').run(String(name).trim());
  if (!info.changes) return db.prepare('SELECT * FROM categories WHERE name=?').get(String(name).trim());
  return db.prepare('SELECT * FROM categories WHERE id=?').get(info.lastInsertRowid);
}

function updateCategory(db, id, name) {
  db.prepare('UPDATE categories SET name=? WHERE id=?').run(String(name).trim(), id);
  return db.prepare('SELECT * FROM categories WHERE id=?').get(id);
}

function removeCategory(db, id) {
  const c = db.prepare('SELECT COUNT(*) c FROM products WHERE category_id=?').get(id).c;
  if (c) throw new Error('این دسته دارای کالا است و حذف نمی‌شود.');
  db.prepare('DELETE FROM categories WHERE id=?').run(id);
  return true;
}

function units(db) {
  const rows = db.prepare('SELECT DISTINCT unit FROM products WHERE unit IS NOT NULL AND unit <> \'\' ORDER BY unit').all();
  const base = ['عدد', 'کیلوگرم', 'گرم', 'متر', 'بسته', 'کارتن', 'جعبه', 'لیتر', 'رول', 'جفت'];
  const set = new Set(base);
  for (const r of rows) set.add(r.unit);
  return Array.from(set);
}

module.exports = {
  list: list, count: count, get: get, quickSearch: quickSearch, findByBarcode: findByBarcode,
  create: create, update: update, remove: remove, deactivate: deactivate, nextCode: nextCode,
  categories: categories, createCategory: createCategory, updateCategory: updateCategory, removeCategory: removeCategory,
  units: units
};
