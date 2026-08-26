'use strict';
const { AppError, assert } = require('../util/errors');
const { r, toQty } = require('../util/money');
const { todayIso } = require('../util/jalali');
const inventory = require('./inventory');
const accounting = require('./accounting');
const settings = require('./settings');

function normalize(p) {
  return {
    name: String(p.name || '').trim(),
    code: String(p.code || '').trim(),
    barcode: String(p.barcode || '').trim(),
    category_id: p.category_id ? Number(p.category_id) : null,
    unit: String(p.unit || 'عدد').trim() || 'عدد',
    buy_price: Math.max(0, r(p.buy_price)),
    sell_price: Math.max(0, r(p.sell_price)),
    min_stock: Math.max(0, toQty(p.min_stock)),
    description: String(p.description || '').trim(),
    active: p.active === 0 || p.active === false ? 0 : 1,
  };
}

function list(db, filter = {}) {
  const params = {};
  let where = 'WHERE 1=1';
  if (filter.q) {
    where += ' AND (p.name LIKE @q OR p.code LIKE @q OR p.barcode LIKE @q)';
    params.q = '%' + String(filter.q).trim() + '%';
  }
  if (filter.categoryId) { where += ' AND p.category_id=@cat'; params.cat = Number(filter.categoryId); }
  if (filter.onlyActive !== false) where += ' AND p.active=1';
  if (filter.lowStock) where += ' AND p.min_stock>0 AND p.stock<=p.min_stock';
  const sortMap = {
    name: 'p.name', code: 'p.code', stock: 'p.stock', sell: 'p.sell_price',
    buy: 'p.buy_price', newest: 'p.id DESC',
  };
  const order = sortMap[filter.sort] || 'p.name';
  const limit = Math.min(Number(filter.limit) || 200, 2000);
  const offset = Number(filter.offset) || 0;
  const rows = db.prepare(`
    SELECT p.*, c.name category_name,
           CASE WHEN p.stock>0 THEN p.stock_value/p.stock ELSE p.buy_price END avg_cost
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`).all(params);
  const total = db.prepare(`SELECT COUNT(*) c FROM products p ${where}`).get(params).c;
  return { rows, total };
}

function get(db, id) {
  const p = db.prepare(`SELECT p.*, c.name category_name,
      CASE WHEN p.stock>0 THEN p.stock_value/p.stock ELSE p.buy_price END avg_cost
      FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`).get(id);
  if (!p) throw new AppError('کالا یافت نشد.', 'NO_PRODUCT');
  return p;
}

/** جست‌وجوی سریع کالا برای فاکتور (نام، کد، بارکد) */
function search(db, q, limit = 25) {
  const term = String(q || '').trim();
  if (!term) {
    return db.prepare(`SELECT id,name,code,barcode,unit,sell_price,buy_price,stock,stock_value
                       FROM products WHERE active=1 ORDER BY name LIMIT ?`).all(limit);
  }
  return db.prepare(`
    SELECT id,name,code,barcode,unit,sell_price,buy_price,stock,stock_value
    FROM products WHERE active=1 AND (name LIKE @q OR code LIKE @q OR barcode LIKE @q)
    ORDER BY CASE WHEN barcode=@exact THEN 0 WHEN code=@exact THEN 1 WHEN name=@exact THEN 2 ELSE 3 END, name
    LIMIT @limit`).all({ q: '%' + term + '%', exact: term, limit });
}

/** یافتن کالا با بارکد دقیق (برای بارکدخوان) */
function byBarcode(db, code) {
  const term = String(code || '').trim();
  if (!term) return null;
  return db.prepare(`SELECT * FROM products WHERE active=1 AND (barcode=? OR code=?) LIMIT 1`).get(term, term) || null;
}

function create(db, payload) {
  const p = normalize(payload);
  assert(p.name, 'نام کالا الزامی است.');
  if (p.code) {
    const dup = db.prepare(`SELECT id FROM products WHERE code=? AND code<>''`).get(p.code);
    if (dup) throw new AppError('کد کالا تکراری است.', 'DUP_CODE');
  }
  if (p.barcode) {
    const dup = db.prepare(`SELECT id FROM products WHERE barcode=? AND barcode<>''`).get(p.barcode);
    if (dup) throw new AppError('بارکد تکراری است.', 'DUP_BARCODE');
  }
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO products
      (name,code,barcode,category_id,unit,buy_price,sell_price,min_stock,stock,stock_value,description,active,created_at,updated_at)
      VALUES (@name,@code,@barcode,@category_id,@unit,@buy_price,@sell_price,@min_stock,0,0,@description,@active,@now,@now)`)
    .run({ ...p, now });
  const id = Number(info.lastInsertRowid);

  // موجودی اولیه (در صورت وارد کردن) به عنوان «موجودی اول دوره» ثبت می‌شود
  const openingQty = toQty(payload.stock);
  if (openingQty > 0) {
    const unitCost = Math.max(0, r(payload.opening_cost !== undefined ? payload.opening_cost : p.buy_price));
    const date = payload.date || todayIso();
    const mv = inventory.applyMovement(db, {
      date, productId: id, type: 'opening', direction: 'in', qty: openingQty,
      unitCost, refType: 'product_opening', refId: id, description: 'موجودی اول دوره',
    });
    if (mv.value > 0) {
      accounting.postEntry(db, {
        date, refType: 'opening', refId: id,
        description: `موجودی اول دوره کالای ${p.name}`,
        lines: [
          { account: accounting.ACC.INVENTORY, debit: mv.value, description: p.name },
          { account: accounting.ACC.EQUITY, credit: mv.value, description: 'سرمایه اولیه - موجودی کالا' },
        ],
      });
    }
  }
  return get(db, id);
}

function update(db, id, payload) {
  const existing = get(db, id);
  const p = normalize({ ...existing, ...payload });
  assert(p.name, 'نام کالا الزامی است.');
  if (p.code) {
    const dup = db.prepare(`SELECT id FROM products WHERE code=? AND id<>? AND code<>''`).get(p.code, id);
    if (dup) throw new AppError('کد کالا تکراری است.', 'DUP_CODE');
  }
  if (p.barcode) {
    const dup = db.prepare(`SELECT id FROM products WHERE barcode=? AND id<>? AND barcode<>''`).get(p.barcode, id);
    if (dup) throw new AppError('بارکد تکراری است.', 'DUP_BARCODE');
  }
  db.prepare(`UPDATE products SET name=@name, code=@code, barcode=@barcode, category_id=@category_id,
      unit=@unit, buy_price=@buy_price, sell_price=@sell_price, min_stock=@min_stock,
      description=@description, active=@active, updated_at=@now WHERE id=@id`)
    .run({ ...p, id, now: new Date().toISOString() });
  return get(db, id);
}

/** حذف کالا؛ اگر در اسناد استفاده شده باشد فقط غیرفعال می‌شود */
function remove(db, id) {
  const used = db.prepare('SELECT COUNT(*) c FROM invoice_items WHERE product_id=?').get(id).c
    + db.prepare('SELECT COUNT(*) c FROM inventory_movements WHERE product_id=?').get(id).c;
  if (used > 0) {
    db.prepare('UPDATE products SET active=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    return { deleted: false, deactivated: true };
  }
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  return { deleted: true, deactivated: false };
}

/**
 * اصلاح موجودی انبار (افزایش/کاهش/انبارگردانی) همراه با سند حسابداری.
 * mode: 'in' | 'out' | 'set'
 */
function adjustStock(db, payload) {
  const product = inventory.getProduct(db, payload.productId);
  const date = payload.date || todayIso();
  const mode = payload.mode === 'out' ? 'out' : (payload.mode === 'set' ? 'set' : 'in');
  let direction = mode;
  let qty = toQty(payload.qty);
  let type = mode === 'in' ? 'adjust_in' : 'adjust_out';

  if (mode === 'set') {
    const target = toQty(payload.qty);
    const diff = toQty(target - product.stock);
    if (Math.abs(diff) < 0.0000001) return { changed: false, product: get(db, product.id) };
    direction = diff > 0 ? 'in' : 'out';
    qty = Math.abs(diff);
    type = 'count';
  }
  assert(qty > 0, 'تعداد باید بزرگ‌تر از صفر باشد.');

  const unitCost = payload.unitCost !== undefined && payload.unitCost !== null
    ? Math.max(0, r(payload.unitCost)) : inventory.avgCost(product);

  const mv = inventory.applyMovement(db, {
    date, productId: product.id, type, direction, qty, unitCost,
    refType: 'adjustment', refId: null,
    description: payload.description || 'اصلاح موجودی',
  });

  if (mv.value > 0) {
    const lines = direction === 'in'
      ? [{ account: accounting.ACC.INVENTORY, debit: mv.value, description: product.name },
        { account: '402-90', credit: mv.value, description: 'اضافات انبار' }]
      : [{ account: '502-90', debit: mv.value, description: 'کسری/ضایعات انبار' },
        { account: accounting.ACC.INVENTORY, credit: mv.value, description: product.name }];
    accounting.postEntry(db, {
      date, refType: 'adjustment', refId: mv.movementId,
      description: `${direction === 'in' ? 'افزایش' : 'کاهش'} موجودی کالای ${product.name}`,
      lines,
    });
  }
  return { changed: true, product: get(db, product.id), movement: mv };
}

function categories(db, kind = 'product') {
  return db.prepare('SELECT * FROM categories WHERE kind=? AND active=1 ORDER BY name').all(kind);
}

function addCategory(db, kind, name) {
  const n = String(name || '').trim();
  assert(n, 'نام دسته‌بندی الزامی است.');
  const dup = db.prepare('SELECT id FROM categories WHERE kind=? AND name=?').get(kind, n);
  if (dup) return db.prepare('SELECT * FROM categories WHERE id=?').get(dup.id);
  let accountCode = null;
  if (kind === 'expense' || kind === 'income') {
    const parent = kind === 'expense' ? '502' : '402';
    const last = db.prepare(`SELECT code FROM accounts WHERE parent_code=? ORDER BY code DESC LIMIT 1`).get(parent);
    let n2 = 11;
    if (last) {
      const m = /-(\d+)$/.exec(last.code);
      if (m) n2 = Math.max(11, parseInt(m[1], 10) + 1);
    }
    if (n2 >= 90) n2 = 91;
    accountCode = `${parent}-${String(n2).padStart(2, '0')}`;
    while (db.prepare('SELECT code FROM accounts WHERE code=?').get(accountCode)) {
      n2 += 1;
      accountCode = `${parent}-${String(n2).padStart(2, '0')}`;
    }
    db.prepare(`INSERT INTO accounts(code,name,type,normal_side,parent_code,is_system,cash_like,sort_order)
                VALUES (?,?,?,?,?,0,0,?)`)
      .run(accountCode, n, kind === 'expense' ? 'expense' : 'income',
        kind === 'expense' ? 'debit' : 'credit', parent,
        (kind === 'expense' ? 50200 : 40200) + n2);
  }
  const info = db.prepare('INSERT INTO categories(kind,name,account_code) VALUES (?,?,?)').run(kind, n, accountCode);
  return db.prepare('SELECT * FROM categories WHERE id=?').get(Number(info.lastInsertRowid));
}

module.exports = { list, get, search, byBarcode, create, update, remove, adjustStock, categories, addCategory, normalize };
