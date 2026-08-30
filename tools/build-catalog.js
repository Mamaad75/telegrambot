'use strict';
/**
 * ساخت «کاتالوگ همراه برنامه» از روی فایل‌های لیست قیمت PDF.
 * خروجی: src/assets/catalog/*.csv  +  index.json
 * اجرا:  PDF_DIR=<پوشه PDF> electron tools/build-catalog.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'catalog');

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const pdfDir = process.env.PDF_DIR;
  if (!pdfDir || !fs.existsSync(pdfDir)) throw new Error('PDF_DIR تنظیم نشده است.');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
  const connection = require(path.join(ROOT, 'src/db/connection.js'));
  const db = connection.open(path.join(tmp, 'catalog.db'));
  const importer = require(path.join(ROOT, 'src/services/importer.js'));

  fs.mkdirSync(OUT, { recursive: true });
  const index = [];

  const files = fs.readdirSync(pdfDir).filter(function (f) { return f.toLowerCase().endsWith('.pdf'); }).sort();
  let n = 0;
  for (const f of files) {
    const full = path.join(pdfDir, f);
    const pv = await importer.preview(db, full, {});
    if (!pv.rows.length) { console.log('رد شد (بدون ردیف): ' + f); continue; }

    const rates = pv.meta.rates || {};
    const markup = rates.markup || 0;
    let base = (pv.meta.title || '').trim() || path.basename(f, '.pdf');
    // عنوان عمومی «لیست قیمت» را با نام گروه کالا دقیق‌تر می‌کنیم
    if (/^لیست\s*قیمت$/.test(base)) {
      const first = (pv.rows[0] && pv.rows[0].name) || '';
      const word = first.split(/\s+/)[0];
      if (word) base = base + ' ' + word;
    }
    n++;
    const slug = 'catalog-' + String(n).padStart(2, '0') + '-markup' + markup;
    const csvPath = path.join(OUT, slug + '.csv');

    const head = ['کد کالا', 'نام کالا', 'واحد', 'قیمت خرید', 'قیمت فروش'];
    const lines = [head.join(',')];
    for (const r of pv.rows) {
      lines.push([r.code, r.name, 'عدد', r.purchase_price, r.sale_price].map(csvCell).join(','));
    }
    fs.writeFileSync(csvPath, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');

    index.push({
      id: slug,
      file: slug + '.csv',
      title: base,
      count: pv.rows.length,
      markup: markup,
      vat_rate: rates.vat_rate || null,
      source: f,
      note: 'قیمت فروش بدون مالیات ذخیره شده است؛ برنامه هنگام صدور فاکتور مالیات را اضافه می‌کند.'
    });
    console.log('✓ ' + slug + '.csv — ' + pv.rows.length + ' کالا — سود ' + markup + '٪ — ' + base);
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log('\nindex.json با ' + index.length + ' کاتالوگ نوشته شد.');
  connection.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

app.whenReady().then(main).then(function () { app.exit(0); }).catch(function (e) {
  console.error('خطا: ' + (e && e.stack || e));
  app.exit(1);
});
