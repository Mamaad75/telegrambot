'use strict';
/**
 * ساخت داده نمایشی برای «حالت نمایشی».
 * این داده‌ها فقط در پایگاه داده جداگانه demo.sqlite ساخته می‌شوند و هرگز
 * وارد پایگاه داده اصلی فروشگاه نمی‌گردند.
 */
const products = require('./products');
const parties = require('./parties');
const invoices = require('./invoices');
const payments = require('./payments');
const cashbook = require('./cashbook');
const checksSvc = require('./checks');
const settings = require('./settings');
const { todayIso, addDaysIso } = require('../util/jalali');

const PRODUCTS = [
  ['برنج طارم هاشمی ۱۰ کیلویی', 'BR10', '6260001000017', 'کیسه', 950000, 1250000, 5],
  ['روغن آفتابگردان ۱.۸ لیتری', 'OIL18', '6260001000024', 'عدد', 145000, 189000, 12],
  ['چای سیاه ۵۰۰ گرمی', 'TEA500', '6260001000031', 'بسته', 220000, 295000, 8],
  ['شکر بسته ۹۰۰ گرمی', 'SUG900', '6260001000048', 'بسته', 42000, 58000, 20],
  ['ماکارونی ۷۰۰ گرمی', 'PAS700', '6260001000055', 'عدد', 28000, 39000, 25],
  ['رب گوجه ۸۰۰ گرمی', 'TOM800', '6260001000062', 'قوطی', 68000, 92000, 15],
  ['پنیر سفید ۴۰۰ گرمی', 'CHE400', '6260001000079', 'بسته', 95000, 128000, 10],
  ['تخم‌مرغ شانه ۳۰ عددی', 'EGG30', '6260001000086', 'شانه', 165000, 215000, 6],
  ['شوینده ظرفشویی ۳.۷۵ لیتری', 'DET375', '6260001000093', 'گالن', 175000, 235000, 6],
  ['دستمال کاغذی ۱۰۰ برگ', 'TIS100', '6260001000109', 'بسته', 32000, 47000, 20],
];

const CUSTOMERS = [
  ['رستوران گلستان', '09121234567'], ['کافه ایده', '09127654321'],
  ['آقای احمدی', '09131112233'], ['خانم رضایی', '09144445566'],
  ['بوفه دبستان مهر', '09155556677'],
];
const SUPPLIERS = [
  ['پخش مواد غذایی البرز', '02155443322'], ['شرکت لبنیات پگاه', '02133221100'],
  ['بازرگانی شمال', '01133445566'],
];

function pick(arr, i) { return arr[i % arr.length]; }

/** ساخت داده نمایشی. اگر داده‌ای از قبل باشد، دوباره ساخته نمی‌شود. */
function generate(db) {
  if (db.prepare('SELECT COUNT(*) c FROM invoices').get().c > 0) {
    return { skipped: true, reason: 'داده نمایشی از قبل ساخته شده است.' };
  }
  const today = todayIso();
  const start = addDaysIso(today, -60);

  const run = db.transaction(() => {
    settings.set(db, {
      shop_name: 'سوپرمارکت نمونه',
      shop_phone: '۰۲۱-۵۵۵۵۴۴۴۴',
      shop_address: 'تهران، خیابان نمونه، پلاک ۱۲',
      setup_done: '1',
      vat_rate: '10',
    });
    cashbook.openingBalances(db, { date: start, 101: 50000000, 103: 120000000 });

    const prodIds = PRODUCTS.map(([name, code, barcode, unit, buy, sell, min]) => products.create(db, {
      name, code, barcode, unit, buy_price: buy, sell_price: sell, min_stock: min,
    }).id);
    const custIds = CUSTOMERS.map(([name, phone]) => parties.create(db, { type: 'customer', name, phone }).id);
    const suppIds = SUPPLIERS.map(([name, phone]) => parties.create(db, { type: 'supplier', name, phone }).id);

    // خریدهای اولیه
    for (let s = 0; s < suppIds.length; s += 1) {
      const items = prodIds
        .filter((_, i) => i % suppIds.length === s)
        .map((id, i) => {
          const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
          return { product_id: id, qty: 40 + i * 10, unit_price: p.buy_price };
        });
      const total = items.reduce((a, x) => a + x.qty * x.unit_price, 0);
      invoices.create(db, {
        type: 'purchase', date: addDaysIso(start, s), party_id: suppIds[s], items,
        payments: s === 0 ? [{ method: 'bank', amount: total }] : (s === 1 ? [{ method: 'cash', amount: Math.round(total / 2) }] : []),
      });
    }

    // فروش روزانه ۴۵ روز اخیر
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let d = 45; d >= 0; d -= 1) {
      const date = addDaysIso(today, -d);
      const invoiceCount = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < invoiceCount; k += 1) {
        const lineCount = 1 + Math.floor(rnd() * 3);
        const items = [];
        for (let l = 0; l < lineCount; l += 1) {
          const pid = pick(prodIds, Math.floor(rnd() * prodIds.length) + l);
          const p = db.prepare('SELECT * FROM products WHERE id=?').get(pid);
          if (p.stock < 3) continue;
          const qty = 1 + Math.floor(rnd() * 3);
          items.push({
            product_id: pid, qty, unit_price: p.sell_price,
            discount: rnd() > 0.85 ? Math.round(p.sell_price * qty * 0.05) : 0,
          });
        }
        if (!items.length) continue;
        const gross = items.reduce((a, x) => a + x.qty * x.unit_price - (x.discount || 0), 0);
        const total = gross + Math.round(gross * 0.1);
        const r = rnd();
        let pays; let partyId = null;
        if (r < 0.45) pays = [{ method: 'cash', amount: total }];
        else if (r < 0.75) pays = [{ method: 'pos', amount: total }];
        else if (r < 0.85) {
          partyId = pick(custIds, Math.floor(rnd() * custIds.length));
          pays = [{ method: 'cash', amount: Math.round(total * 0.4) }, { method: 'pos', amount: total - Math.round(total * 0.4) }];
        } else {
          partyId = pick(custIds, Math.floor(rnd() * custIds.length));
          pays = r < 0.93 ? [] : [{
            method: 'check',
            amount: total,
            check: { number: '۸۰' + (1000 + Math.floor(rnd() * 8999)), bank: 'ملت', due_date: addDaysIso(date, 30) },
          }];
        }
        invoices.create(db, { type: 'sale', date, party_id: partyId, items, payments: pays });
      }

      if (d % 7 === 3) {
        const cat = db.prepare(`SELECT id FROM categories WHERE kind='expense' AND name='حمل و نقل'`).get();
        cashbook.addExpense(db, { date, category_id: cat.id, amount: 800000 + Math.floor(rnd() * 400000), method: 'cash', description: 'کرایه حمل بار' });
      }
      if (d % 30 === 5) {
        const cat = db.prepare(`SELECT id FROM categories WHERE kind='expense' AND name='اجاره'`).get();
        cashbook.addExpense(db, { date, category_id: cat.id, amount: 25000000, method: 'bank', description: 'اجاره ماهانه مغازه' });
        const el = db.prepare(`SELECT id FROM categories WHERE kind='expense' AND name='برق'`).get();
        cashbook.addExpense(db, { date, category_id: el.id, amount: 3200000, method: 'cash', description: 'قبض برق' });
      }
    }

    // یک برگشت از فروش نمونه
    const lastSale = db.prepare(`SELECT * FROM invoices WHERE type='sale' AND status='posted' AND party_id IS NOT NULL
                                 ORDER BY date DESC LIMIT 1`).get();
    if (lastSale) {
      const item = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? LIMIT 1').get(lastSale.id);
      if (item && item.qty >= 1) {
        invoices.create(db, {
          type: 'sale_return', date: today, party_id: lastSale.party_id, ref_invoice_id: lastSale.id,
          items: [{ product_id: item.product_id, qty: 1, unit_price: item.unit_price }],
          payments: [{ method: 'cash', amount: Math.round(item.unit_price * 1.1) }],
          notes: 'کالای معیوب برگشت داده شد',
        });
      }
    }

    // دریافت از مشتریان بدهکار
    for (const cid of custIds.slice(0, 3)) {
      const bal = db.prepare(`SELECT COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0) v
                              FROM journal_lines WHERE party_id=? AND account_code='105'`).get(cid).v;
      if (bal > 0) {
        payments.create(db, {
          kind: 'receipt', date: today, party_id: cid,
          lines: [{ method: 'cash', amount: Math.round(bal / 2) }],
          description: 'دریافت بخشی از بدهی',
        });
      }
    }

    // پرداخت به تأمین‌کننده
    for (const sid of suppIds) {
      const bal = db.prepare(`SELECT COALESCE(SUM(credit),0)-COALESCE(SUM(debit),0) v
                              FROM journal_lines WHERE party_id=? AND account_code='201'`).get(sid).v;
      if (bal > 0) {
        payments.create(db, {
          kind: 'payment', date: addDaysIso(today, -2), party_id: sid,
          lines: [{ method: 'bank', amount: Math.round(bal * 0.6) }],
          description: 'پرداخت بخشی از بدهی',
        });
      }
    }

    // یک چک پرداختی نمونه
    checksSvc.create(db, {
      kind: 'paid', number: '۹۹۱۲۳۴', bank: 'صادرات', party_id: suppIds[0],
      amount: 15000000, issue_date: today, due_date: addDaysIso(today, 45), notes: 'بابت خرید بهمن',
    });
    settings.set(db, { demo_data: '1' });
  });
  run();
  return { skipped: false, message: 'داده نمایشی ساخته شد.' };
}

module.exports = { generate };
