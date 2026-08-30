'use strict';
/*
 * درون‌ریزی کالا از فایل PDF، اکسل و CSV.
 *
 * مسیر کار همیشه دو مرحله است:
 *   ۱) preview()  فایل را می‌خواند، ستون‌ها را تشخیص می‌دهد و ردیف‌ها را برمی‌گرداند
 *   ۲) commit()   ردیف‌های تأییدشده را در یک تراکنش ثبت یا به‌روزرسانی می‌کند
 *
 * هیچ چیزی بدون تأیید کاربر در پایگاه داده نوشته نمی‌شود.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const products = require('./products.js');
const settings = require('./settings.js');
const Fmt = require('../shared/format.js');

/* ------------------------------ نرمال‌سازی متن ------------------------------ */

/** یکسان‌سازی ی/ي، ک/ك، حذف نیم‌فاصله و فاصله‌های اضافی برای تطبیق نام ستون‌ها */
function norm(s) {
  if (s === null || s === undefined) return '';
  return Fmt.toEnDigits(String(s))
    .replace(/[يى]/g, 'ی')   // ي ى -> ی
    .replace(/ك/g, 'ک')           // ك -> ک
    .replace(/[‌‎‏﻿]/g, ' ')
    .replace(/[()\[\]{}«»"'.:،,؛;_\-\/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** تبدیل رشته مبلغ به عدد صحیح */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const clean = Fmt.toEnDigits(String(v)).replace(/[,\s٬،]/g, '').replace(/[^0-9.\-]/g, '');
  if (clean === '' || clean === '-' || clean === '.') return null;
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/* ------------------------------ نگاشت ستون‌ها ------------------------------ */

const FIELD_ALIASES = {
  name: ['نام کالا', 'عنوان محصول', 'نام محصول', 'شرح کالا', 'عنوان کالا', 'نام', 'کالا', 'شرح',
    'عنوان', 'name', 'title', 'product', 'product name', 'item', 'description'],
  code: ['کد محصول', 'کد کالا', 'کد', 'شماره فنی', 'کد فنی', 'code', 'sku', 'item code', 'product code', 'part number'],
  barcode: ['بارکد', 'بارکد کالا', 'شماره بارکد', 'barcode', 'ean', 'upc'],
  unit: ['واحد', 'واحد شمارش', 'واحد کالا', 'unit', 'uom'],
  category: ['دسته', 'دسته بندی', 'گروه', 'گروه کالا', 'category', 'group'],
  purchase_price: ['قیمت خرید', 'بهای خرید', 'فی', 'فی ریال', 'فی تومان', 'قیمت پایه', 'مبلغ',
    'خرید', 'purchase price', 'buy price', 'cost', 'unit price', 'price'],
  sale_price: ['قیمت فروش', 'بهای فروش', 'فروش', 'قیمت مصرف کننده', 'قیمت نهایی',
    'sale price', 'selling price', 'retail price'],
  min_stock: ['حداقل موجودی', 'نقطه سفارش', 'حداقل', 'min stock', 'minimum', 'reorder'],
  opening_qty: ['موجودی', 'موجودی اولیه', 'تعداد', 'qty', 'quantity', 'stock', 'on hand'],
  description: ['توضیحات', 'توضیح', 'شرح تکمیلی', 'ملاحظات', 'note', 'notes', 'comment', 'remark']
};

/** بهترین فیلد متناظر با یک عنوان ستون */
function matchField(header) {
  const h = norm(header);
  if (!h) return null;
  let best = null, bestLen = 0;
  for (const field of Object.keys(FIELD_ALIASES)) {
    for (const alias of FIELD_ALIASES[field]) {
      const a = norm(alias);
      if (h === a) return field;                    // تطابق کامل، بلافاصله
      if (h.indexOf(a) !== -1 && a.length > bestLen) { best = field; bestLen = a.length; }
    }
  }
  return best;
}

/* ------------------------------ خواندن اکسل ------------------------------ */

async function readSheetRows(filePath) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    await wb.csv.readFile(filePath);
  } else {
    await wb.xlsx.readFile(filePath);
  }
  const sheets = [];
  wb.eachSheet(function (ws) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, function (row) {
      const values = [];
      row.eachCell({ includeEmpty: true }, function (cell, col) {
        let v = cell.value;
        if (v && typeof v === 'object') {
          if (v.richText) v = v.richText.map(function (t) { return t.text; }).join('');
          else if (v.text !== undefined) v = v.text;
          else if (v.result !== undefined) v = v.result;
          else if (v instanceof Date) v = v.toISOString().slice(0, 10);
          else v = String(v);
        }
        values[col - 1] = v === null || v === undefined ? '' : v;
      });
      rows.push(values);
    });
    if (rows.length) sheets.push({ name: ws.name, rows: rows });
  });
  return sheets;
}

/** پیدا کردن سطر عنوان: سطری که بیشترین ستون شناخته‌شده را دارد */
function detectHeader(rows) {
  let bestIdx = -1, bestScore = 0, bestMap = null;
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const map = {};
    let score = 0;
    rows[i].forEach(function (cell, col) {
      const f = matchField(cell);
      if (f && map[f] === undefined) { map[f] = col; score++; }
    });
    if (map.name !== undefined) score += 2;   // ستون نام مهم‌ترین است
    if (score > bestScore) { bestScore = score; bestIdx = i; bestMap = map; }
  }
  return { index: bestIdx, mapping: bestMap || {}, score: bestScore };
}

function rowsFromSheet(sheet) {
  const det = detectHeader(sheet.rows);
  if (det.index < 0 || det.mapping.name === undefined) {
    return { ok: false, reason: 'ستون «نام کالا» در این برگه پیدا نشد.', header: det };
  }
  const out = [];
  for (let i = det.index + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const item = {};
    for (const field of Object.keys(det.mapping)) {
      item[field] = r[det.mapping[field]];
    }
    if (!item.name || !String(item.name).trim()) continue;
    out.push(item);
  }
  return { ok: true, rows: out, header: det, sheet: sheet.name };
}

/* ------------------------------ خواندن PDF ------------------------------ */

const RE_HEADER_COLS = /کد\s*محصول|کد\s*کالا/;
const RE_PRICE_SEP = /^فی\b|^قیمت\s|ارزش\s*افزوده\s*\+|^مبلغ\b/;
const MONEY = '(?:\\d{1,3},)+\\d{3}';
// ردیفی که نامش درون‌خطی آمده: کد + متن غیررقمی + یک یا دو مبلغ  ← طول کد در این حالت قطعی است
const RE_INLINE = new RegExp('^(\\d{4,12})([^\\d,][^,]*?)(' + MONEY + ')(' + MONEY + ')?$');
// خطی که فقط رقم و مبلغ دارد (طول کد مبهم است)
const RE_NUMERIC = new RegExp('^\\d+(?:,\\d+)*$');

function ratioSpread(pairs) {
  const rs = [];
  for (const p of pairs) {
    const a = Number(String(p[0]).replace(/,/g, ''));
    const b = Number(String(p[1]).replace(/,/g, ''));
    if (a > 0 && b > 0) rs.push(b / a);
  }
  if (rs.length < 2) return Infinity;
  return Math.max.apply(null, rs) / Math.min.apply(null, rs);
}

/**
 * تشخیص طول کد محصول.
 * رشته «کد+مبلغ» ذاتاً مبهم است (۳۰۱۰۴۰۰۹|۸۸,۷۴۰,۰۰۰ یا ۳۰۱۰۴۰۰۹۸|۸,۷۴۰,۰۰۰).
 * ابتدا از ردیف‌هایی که نامشان درون‌خطی آمده استفاده می‌کنیم (قطعی)،
 * وگرنه طولی را برمی‌گزینیم که نسبت دو ستون قیمت در همه ردیف‌ها یکسان‌تر باشد.
 */
function detectCodeLength(numericLines, inlineCodes) {
  if (inlineCodes.length) {
    const freq = {};
    for (const c of inlineCodes) freq[c.length] = (freq[c.length] || 0) + 1;
    let bestL = null, bestN = 0;
    for (const L of Object.keys(freq)) {
      if (freq[L] > bestN) { bestN = freq[L]; bestL = parseInt(L, 10); }
    }
    if (bestL) return { length: bestL, source: 'inline' };
  }

  let best = null;
  for (let L = 4; L <= 12; L++) {
    const re = new RegExp('^\\d{' + L + '}(' + MONEY + ')(' + MONEY + ')?$');
    const pairs = [];
    let n = 0;
    for (const line of numericLines) {
      const m = line.match(re);
      if (!m) continue;
      n++;
      if (m[2]) pairs.push([m[1], m[2]]);
    }
    if (!n || n < numericLines.length) continue;   // باید همه ردیف‌ها را پوشش دهد
    const spread = ratioSpread(pairs);
    if (!best || spread < best.spread - 1e-9) best = { length: L, spread: spread, source: 'ratio' };
  }
  return best || { length: 8, source: 'default' };
}

/**
 * لیست‌های قیمت فارسی ستون‌ها را جدا استخراج می‌کنند. ترتیب بخش‌ها ثابت نیست
 * (در بعضی صفحه‌ها نام‌ها بعد از داده و در بعضی قبل از آن می‌آید)، بنابراین
 * هر خط مستقل دسته‌بندی می‌شود و در پایان داده‌ها و نام‌های هر بلوک به ترتیب جفت می‌شوند.
 */
function parsePriceListLayout(text) {
  const lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

  // ---- مرحله ۱: تقسیم به بلوک و دسته‌بندی خطوط ----
  const blocks = [];
  let cur = null;
  const allNumeric = [];
  const inlineCodes = [];

  for (const line of lines) {
    if (RE_HEADER_COLS.test(line) && line.length < 60) {
      cur = { numeric: [], inline: [], names: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (RE_PRICE_SEP.test(line) && line.length < 90 && !RE_NUMERIC.test(line)) continue;
    if (/لیست\s*قیمت/.test(line)) continue;

    const inl = line.match(RE_INLINE);
    if (inl && /[؀-ۿA-Za-z]/.test(inl[2])) {
      cur.inline.push({ pos: cur.numeric.length + cur.inline.length, code: inl[1], name: inl[2].trim(), p1: inl[3], p2: inl[4] || null });
      inlineCodes.push(inl[1]);
      continue;
    }
    if (RE_NUMERIC.test(line) && /,/.test(line)) {
      cur.numeric.push(line);
      allNumeric.push(line);
      continue;
    }
    cur.names.push(line);
  }

  if (!allNumeric.length && !inlineCodes.length) return [];

  // ---- مرحله ۲: تعیین طول کد ----
  const det = detectCodeLength(allNumeric, inlineCodes);
  const reFixed = new RegExp('^(\\d{' + det.length + '})(' + MONEY + ')(' + MONEY + ')?$');

  // ---- مرحله ۳: بازسازی ردیف‌ها با حفظ ترتیب اصلی ----
  const rows = [];
  for (const b of blocks) {
    const seq = [];
    let ni = 0, ii = 0;
    // ترتیب اصلی خطوط داده در بلوک: numeric ها و inline ها به‌ترتیب ظهور
    const ordered = [];
    for (const l of b.numeric) ordered.push({ kind: 'numeric', line: l });
    for (const x of b.inline) ordered.splice(Math.min(x.pos, ordered.length), 0, { kind: 'inline', data: x });

    for (const item of ordered) {
      if (item.kind === 'inline') {
        seq.push({ code: item.data.code, name: item.data.name, p1: item.data.p1, p2: item.data.p2 });
      } else {
        const m = item.line.match(reFixed);
        if (!m) continue;
        seq.push({ code: m[1], name: null, p1: m[2], p2: m[3] || null });
      }
    }
    for (const s of seq) {
      const name = s.name || b.names[ni++] || null;
      if (!name) continue;
      rows.push({ code: s.code, name: name, purchase_price: s.p1, sale_price: s.p2 });
    }
    ii = ii; // no-op
  }
  rows._codeLength = det;
  return rows;
}

/** حالت عمومی: هر خطی که «متن + یک یا دو عدد» باشد */
function parseGenericLines(text) {
  const rows = [];
  const re = /^(.*?[؀-ۿa-zA-Z].*?)[\s\t]+((?:\d{1,3}[,،])+\d{3}|\d{4,})(?:[\s\t]+((?:\d{1,3}[,،])+\d{3}|\d{4,}))?$/;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;
    const m = line.match(re);
    if (!m) continue;
    const name = m[1].trim();
    if (name.length < 2) continue;
    if (/لیست قیمت|جمع کل|مجموع|صفحه|tel|www|تلفن/i.test(name)) continue;
    rows.push({ code: null, name: name, purchase_price: m[2], sale_price: m[3] || null });
  }
  return rows;
}

/**
 * تشخیص درصد مالیات و درصد سود از سرصفحه لیست قیمت.
 * نمونه: «لیست قیمت — با ۱۰٪ ارزش افزوده و ۲۰٪»
 * توجه: در استخراج PDF فارسی، علامت ٪ گاهی جابه‌جا می‌شود، بنابراین
 * به وجود ٪ کنار عدد دوم تکیه نمی‌کنیم.
 */
function cleanTitle(head) {
  let t = String(head || '')
    .replace(/[\u066A\u0025]/g, ' ')          // نشانه درصد جابه‌جاشده در استخراج RTL
    .replace(/\s+/g, ' ')
    .trim();
  const cut = t.search(/\s(?:—|-|–|با\s)/);
  if (cut > 0) t = t.slice(0, cut).trim();
  return t.replace(/^[\s\-—–]+|[\s\-—–]+$/g, '');
}

function detectHeaderRates(text) {
  const out = { vat_rate: null, markup: null, title: null };
  const lines = Fmt.toEnDigits(text).split('\n')
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return /لیست\s*قیمت|ارزش\s*افزوده/.test(l); });
  if (!lines.length) return out;
  const head = lines[0];
  out.title = cleanTitle(head) || null;

  const vat = head.match(/(\d{1,2})\s*٪?\s*(?:درصد\s*)?ارزش\s*افزوده/);
  if (vat) out.vat_rate = parseInt(vat[1], 10);

  // عدد باقیمانده پس از حذف عبارت مالیات، درصد سود است
  const rest = vat ? head.replace(vat[0], ' ') : head;
  const nums = (rest.match(/\d{1,2}/g) || []).map(Number).filter(function (n) { return n > 0 && n <= 99; });
  if (nums.length) out.markup = nums[nums.length - 1];
  return out;
}

async function readPdfRows(filePath) {
  const data = await pdfParse(fs.readFileSync(filePath));
  const text = data.text || '';
  let rows = parsePriceListLayout(text);
  let strategy = 'price-list';
  if (rows.length < 2) {
    rows = parseGenericLines(text);
    strategy = 'generic';
  }
  return { rows: rows, strategy: strategy, pages: data.numpages, rates: detectHeaderRates(text), text: text };
}

/* ------------------------------ پیش‌نمایش ------------------------------ */

/**
 * خواندن فایل و آماده‌سازی ردیف‌ها برای تأیید کاربر.
 * opt: { divisor, sale_includes_vat, vat_rate, markup, price_column }
 */
async function preview(db, filePath, opt) {
  const o = opt || {};
  if (!fs.existsSync(filePath)) throw new Error('فایل انتخاب‌شده یافت نشد.');
  const ext = path.extname(filePath).toLowerCase();

  let raw = [];
  const meta = { file: path.basename(filePath), kind: null, sheets: [], strategy: null, rates: {} };

  if (ext === '.pdf') {
    meta.kind = 'pdf';
    const r = await readPdfRows(filePath);
    raw = r.rows;
    meta.strategy = r.strategy;
    meta.pages = r.pages;
    meta.rates = r.rates;
    if (r.rates && r.rates.title) meta.title = r.rates.title;
  } else if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xls' || ext === '.csv') {
    meta.kind = 'sheet';
    const sheets = await readSheetRows(filePath);
    if (!sheets.length) throw new Error('این فایل هیچ برگه‌ای ندارد.');
    let picked = null;
    for (const s of sheets) {
      const res = rowsFromSheet(s);
      meta.sheets.push({ name: s.name, ok: res.ok, count: res.ok ? res.rows.length : 0, reason: res.reason || null });
      if (res.ok && (!picked || res.rows.length > picked.rows.length)) picked = res;
    }
    if (!picked) {
      throw new Error('ستون «نام کالا» در هیچ برگه‌ای پیدا نشد. ' +
        'سرستون‌ها باید شامل «نام کالا» یا «عنوان محصول» باشند.');
    }
    raw = picked.rows;
    meta.sheet = picked.sheet;
    meta.detected_columns = Object.keys(picked.header.mapping);
  } else {
    throw new Error('فرمت فایل پشتیبانی نمی‌شود. فقط PDF، Excel و CSV پذیرفته می‌شود.');
  }

  // ------- تبدیل مقادیر -------
  const divisor = Number(o.divisor) > 0 ? Number(o.divisor) : 1;
  const vatRate = o.vat_rate !== undefined && o.vat_rate !== null && o.vat_rate !== ''
    ? Number(o.vat_rate)
    : (meta.rates.vat_rate || 0);
  const saleIncludesVat = o.sale_includes_vat === undefined ? !!meta.rates.vat_rate : !!o.sale_includes_vat;
  const markup = o.markup !== undefined && o.markup !== null && o.markup !== ''
    ? Number(o.markup)
    : (meta.rates.markup || 0);
  const saleFromMarkup = !!o.sale_from_markup;

  const existingByCode = new Map();
  const existingByBarcode = new Map();
  for (const p of db.prepare('SELECT id, name, code, barcode FROM products').all()) {
    if (p.code) existingByCode.set(String(p.code).trim(), p);
    if (p.barcode) existingByBarcode.set(String(p.barcode).trim(), p);
  }

  const seenCode = new Set();
  const rows = [];
  for (const r of raw) {
    const name = String(r.name === undefined || r.name === null ? '' : r.name).trim();
    if (!name) continue;

    const code = r.code ? String(r.code).trim() : null;
    const barcode = r.barcode ? Fmt.toEnDigits(String(r.barcode)).replace(/\D/g, '') : null;

    let purchase = toNumber(r.purchase_price);
    let sale = toNumber(r.sale_price);

    if (purchase !== null) purchase = purchase / divisor;
    if (sale !== null) sale = sale / divisor;

    // ستون دوم لیست قیمت معمولاً شامل مالیات است؛ برنامه خودش مالیات را اضافه می‌کند
    if (sale !== null && saleIncludesVat && vatRate > 0) sale = sale / (1 + vatRate / 100);
    // یا قیمت فروش را از درصد سود بساز
    if (saleFromMarkup && purchase !== null && markup > 0) sale = purchase * (1 + markup / 100);

    const item = {
      name: name,
      code: code,
      barcode: barcode || null,
      unit: r.unit ? String(r.unit).trim() : null,
      category: r.category ? String(r.category).trim() : null,
      purchase_price: purchase === null ? 0 : Math.round(purchase),
      sale_price: sale === null ? 0 : Math.round(sale),
      min_stock: toNumber(r.min_stock) || 0,
      opening_qty: toNumber(r.opening_qty) || 0,
      description: r.description ? String(r.description).trim() : null,
      status: 'new',
      note: null
    };

    // وضعیت: جدید / به‌روزرسانی / تکراری در خود فایل
    const dupKey = code || ('name:' + norm(name));
    if (seenCode.has(dupKey)) {
      item.status = 'duplicate';
      item.note = 'در همین فایل تکراری است';
    } else {
      seenCode.add(dupKey);
      const hit = (code && existingByCode.get(code)) || (barcode && existingByBarcode.get(barcode));
      if (hit) {
        item.status = 'update';
        item.existing_id = hit.id;
        item.note = 'کالای موجود: ' + hit.name;
      }
    }
    if (!item.purchase_price && !item.sale_price) {
      item.note = (item.note ? item.note + ' — ' : '') + 'بدون قیمت';
    }
    rows.push(item);
  }

  return {
    meta: meta,
    options: {
      divisor: divisor, vat_rate: vatRate, sale_includes_vat: saleIncludesVat,
      markup: markup, sale_from_markup: saleFromMarkup
    },
    rows: rows,
    summary: {
      total: rows.length,
      new: rows.filter(function (r) { return r.status === 'new'; }).length,
      update: rows.filter(function (r) { return r.status === 'update'; }).length,
      duplicate: rows.filter(function (r) { return r.status === 'duplicate'; }).length
    }
  };
}

/* ------------------------------ ثبت نهایی ------------------------------ */

/**
 * ثبت ردیف‌های تأییدشده. همه در یک تراکنش؛ اگر ردیفی خطا بدهد کل عملیات برگشت می‌خورد
 * مگر اینکه skip_errors فعال باشد.
 * opt: { update_existing, default_unit, category_id, skip_errors }
 */
function commit(db, rows, opt) {
  const o = opt || {};
  const result = { created: 0, updated: 0, skipped: 0, errors: [] };
  const defaultUnit = o.default_unit || 'عدد';

  const tx = db.transaction(function () {
    for (const r of rows) {
      if (r.status === 'duplicate' && !o.import_duplicates) { result.skipped++; continue; }
      try {
        const data = {
          name: r.name,
          code: r.code || undefined,
          barcode: r.barcode || null,
          unit: r.unit || defaultUnit,
          purchase_price: Math.round(Number(r.purchase_price) || 0),
          sale_price: Math.round(Number(r.sale_price) || 0),
          min_stock: Number(r.min_stock) || 0,
          description: r.description || null,
          category_id: o.category_id || null,
          active: 1
        };

        if (r.status === 'update' && r.existing_id) {
          if (!o.update_existing) { result.skipped++; continue; }
          const patch = {
            name: data.name, unit: data.unit,
            purchase_price: data.purchase_price, sale_price: data.sale_price,
            min_stock: data.min_stock
          };
          if (o.update_category && o.category_id) patch.category_id = o.category_id;
          if (r.barcode) patch.barcode = r.barcode;
          if (r.description) patch.description = r.description;
          products.update(db, r.existing_id, patch);
          result.updated++;
        } else {
          if (!data.code) delete data.code;   // کد خودکار ساخته شود
          const opening = Number(r.opening_qty) || 0;
          if (opening > 0) {
            data.opening_qty = opening;
            data.opening_cost = data.purchase_price;
          }
          products.create(db, data);
          result.created++;
        }
      } catch (e) {
        result.errors.push({ name: r.name, code: r.code, error: e.message });
        if (!o.skip_errors) throw new Error('ردیف «' + r.name + '»: ' + e.message);
        result.skipped++;
      }
    }
  });
  tx();
  return result;
}

/** ساخت فایل نمونه اکسل برای درون‌ریزی */
async function template(filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('کالاها', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'نام کالا', key: 'name', width: 34 },
    { header: 'کد کالا', key: 'code', width: 14 },
    { header: 'بارکد', key: 'barcode', width: 18 },
    { header: 'دسته', key: 'category', width: 16 },
    { header: 'واحد', key: 'unit', width: 10 },
    { header: 'قیمت خرید', key: 'purchase_price', width: 16 },
    { header: 'قیمت فروش', key: 'sale_price', width: 16 },
    { header: 'حداقل موجودی', key: 'min_stock', width: 14 },
    { header: 'موجودی اولیه', key: 'opening_qty', width: 14 },
    { header: 'توضیحات', key: 'description', width: 30 }
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Tahoma', size: 10 };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  head.alignment = { horizontal: 'center', vertical: 'middle' };
  head.height = 22;
  ws.addRow({
    name: 'نمونه: روغن موتور ۴ لیتری', code: 'K-0001', barcode: '6260000000001',
    category: 'روانکار', unit: 'عدد', purchase_price: 850000, sale_price: 1100000,
    min_stock: 5, opening_qty: 0, description: 'این سطر نمونه است؛ آن را پاک کنید'
  });
  ws.getColumn('purchase_price').numFmt = '#,##0';
  ws.getColumn('sale_price').numFmt = '#,##0';
  await wb.xlsx.writeFile(filePath);
  return { file: filePath };
}

/* --------------------- کاتالوگ‌های همراه برنامه --------------------- */

/** پوشه کاتالوگ‌های آماده که همراه برنامه نصب می‌شوند */
function catalogDir() {
  return path.join(__dirname, '..', 'assets', 'catalog');
}

/** فهرست کاتالوگ‌های آماده (لیست قیمت‌هایی که همراه برنامه ارائه شده‌اند) */
function builtins() {
  const dir = catalogDir();
  const idx = path.join(dir, 'index.json');
  if (!fs.existsSync(idx)) return [];
  let list = [];
  try { list = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter(function (c) {
    return c && c.file && fs.existsSync(path.join(dir, c.file));
  }).map(function (c) {
    return {
      id: c.id, title: c.title, count: c.count, markup: c.markup,
      vat_rate: c.vat_rate, note: c.note || null
    };
  });
}

/** مسیر فایل یک کاتالوگ آماده بر اساس شناسه — با محافظت در برابر مسیر دستکاری‌شده */
function builtinPath(id) {
  const dir = catalogDir();
  const idx = path.join(dir, 'index.json');
  if (!fs.existsSync(idx)) throw new Error('کاتالوگ همراه برنامه یافت نشد.');
  const list = JSON.parse(fs.readFileSync(idx, 'utf8'));
  const hit = (Array.isArray(list) ? list : []).find(function (c) { return c && c.id === id; });
  if (!hit) throw new Error('کاتالوگ درخواستی وجود ندارد.');
  const full = path.join(dir, path.basename(hit.file));
  if (!fs.existsSync(full)) throw new Error('فایل کاتالوگ «' + hit.title + '» یافت نشد.');
  return full;
}

module.exports = {
  preview: preview,
  builtins: builtins,
  builtinPath: builtinPath,
  commit: commit,
  template: template,
  // برای آزمون
  _internal: { norm: norm, toNumber: toNumber, matchField: matchField, parsePriceListLayout: parsePriceListLayout, detectHeaderRates: detectHeaderRates, cleanTitle: cleanTitle, readPdfRows: readPdfRows }
};
