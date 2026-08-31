'use strict';
/*
 * قالب‌های چاپ: فاکتور A4، فیش حرارتی ۸۰ میلی‌متری، صورت‌حساب و گزارش عمومی.
 * خروجی HTML خودکفا (بدون منبع خارجی) است تا کاملاً آفلاین چاپ شود.
 */
const Fmt = require('../shared/format.js');
const Jalali = require('../shared/jalali.js');
const C = require('../shared/constants.js');

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const BASE_CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Vazirmatn, Sahel, IRANSans, 'Segoe UI', Tahoma, sans-serif;
    direction: rtl; margin: 0; padding: 0; color: #111; background: #fff;
    font-size: 12px; line-height: 1.7; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { padding: 8mm; max-width: 210mm; margin: 0 auto; }
  .toolbar {
    position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; padding: 10px 14px;
    background: #1f3a5f; color: #fff; align-items: center;
  }
  .toolbar button {
    font-family: inherit; font-size: 13px; padding: 7px 16px; border: 0; border-radius: 6px;
    background: #fff; color: #1f3a5f; cursor: pointer; font-weight: 600;
  }
  .toolbar button.ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.5); }
  .toolbar .spacer { flex: 1; }
  @media print { .toolbar { display: none !important; } .sheet { padding: 0; } }
  h1,h2,h3 { margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f3a5f; padding-bottom: 8px; }
  .shop { display: flex; gap: 10px; align-items: center; }
  .shop img { max-height: 62px; max-width: 120px; object-fit: contain; }
  .shop-name { font-size: 18px; font-weight: 700; color: #1f3a5f; }
  .shop-meta { font-size: 11px; color: #444; }
  .doc-title { text-align: left; }
  .doc-title h2 { font-size: 16px; color: #1f3a5f; }
  .doc-meta { font-size: 11px; margin-top: 4px; }
  .doc-meta b { display: inline-block; min-width: 74px; }
  .party { margin-top: 10px; border: 1px solid #d5dde7; border-radius: 6px; padding: 8px 10px; background: #f7f9fc; font-size: 11.5px; }
  .party span { margin-left: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #c9d3e0; padding: 5px 6px; text-align: center; }
  th { background: #1f3a5f; color: #fff; font-weight: 600; font-size: 11.5px; }
  td.name { text-align: right; }
  tbody tr:nth-child(even) { background: #f5f8fc; }
  tfoot td { font-weight: 700; background: #eef3f9; }
  .totals { margin-top: 10px; display: flex; justify-content: flex-start; gap: 12px; }
  .totals table { width: 300px; margin: 0; }
  .totals td { text-align: right; border: 1px solid #c9d3e0; padding: 5px 8px; }
  .totals td.label { background: #f5f8fc; width: 55%; }
  .totals tr.grand td { background: #1f3a5f; color: #fff; font-weight: 700; font-size: 13px; }
  .words { margin-top: 8px; font-size: 11.5px; border: 1px dashed #9fb3cc; padding: 6px 8px; border-radius: 6px; background: #fbfcfe; }
  .payments { margin-top: 10px; font-size: 11.5px; }
  .payments table { width: 100%; }
  .note { margin-top: 8px; font-size: 11px; white-space: pre-wrap; }
  .signs { margin-top: 22px; display: flex; justify-content: space-between; gap: 20px; font-size: 11.5px; }
  .signs div { flex: 1; border-top: 1px solid #999; padding-top: 5px; text-align: center; }
  .footer { margin-top: 14px; text-align: center; font-size: 10px; color: #777; border-top: 1px solid #ddd; padding-top: 6px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 10.5px; background: #e6eefa; color: #1f3a5f; }
  /* ستون‌های جدول اقلام فاکتور — ستون «شرح کالا» بقیه فضا را می‌گیرد */
  table.items { table-layout: fixed; }
  table.items .c-idx { width: 32px; }
  table.items .c-code { width: 70px; }
  table.items .c-name { width: auto; }
  table.items .c-unit { width: 52px; }
  table.items .c-qty { width: 60px; }
  table.items .c-price { width: 95px; }
  table.items .c-disc { width: 85px; }
  table.items .c-total { width: 105px; }
  table.items td.name { word-break: break-word; }
`;

/* اندازه‌های کاغذ فاکتور. A5 نصف A4 است، پس همه‌چیز فشرده‌تر می‌شود تا در یک برگ جا شود. */
const PAPER = {
  a4: { label: 'A4', pageSize: 'A4', width: 900 },
  a5: { label: 'A5', pageSize: 'A5', width: 700 }
};

const A5_CSS = `
  @page { size: A5; margin: 6mm; }
  body { font-size: 10px; line-height: 1.5; }
  .sheet { padding: 4mm; max-width: 148mm; }
  .head { padding-bottom: 5px; }
  .shop img { max-height: 42px; max-width: 84px; }
  .shop-name { font-size: 13px; }
  .shop-meta { font-size: 8.5px; }
  .doc-title h2 { font-size: 12px; }
  .doc-meta { font-size: 8.5px; margin-top: 2px; }
  .doc-meta b { min-width: 56px; }
  .party { margin-top: 6px; padding: 4px 6px; font-size: 9px; }
  .party span { margin-left: 10px; }
  table { margin-top: 6px; }
  th, td { padding: 2.5px 3px; }
  th { font-size: 8.5px; }
  td { font-size: 9px; }
  .totals { margin-top: 6px; }
  .totals table { width: 258px; }
  .totals td { padding: 2.5px 5px; font-size: 9px; white-space: nowrap; }
  .totals td.label { width: 50%; white-space: normal; }
  .totals tr.grand td { font-size: 10.5px; }
  .words { margin-top: 5px; font-size: 9px; padding: 3px 5px; }
  .payments { margin-top: 6px; font-size: 9px; }
  .note { margin-top: 5px; font-size: 8.5px; }
  .signs { margin-top: 12px; font-size: 9px; gap: 12px; }
  .signs div { padding-top: 3px; }
  .footer { margin-top: 8px; font-size: 8px; padding-top: 4px; }
  /* A5 نصف عرض A4 است، پس ستون‌های عددی باید باریک‌تر شوند تا «شرح کالا» جا بماند */
  table.items .c-idx { width: 20px; }
  table.items .c-code { width: 46px; }
  table.items .c-unit { width: 30px; }
  table.items .c-qty { width: 34px; }
  table.items .c-price { width: 66px; }
  table.items .c-disc { width: 48px; }
  table.items .c-total { width: 72px; }
`;

/** نام اندازه کاغذ را به شکل معتبر برمی‌گرداند (پیش‌فرض A5) */
function paperKey(p) {
  const k = String(p || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAPER, k) ? k : 'a5';
}

/** CSS فاکتور برای اندازه کاغذ خواسته‌شده */
function invoiceCss(paper) {
  return paperKey(paper) === 'a5' ? BASE_CSS + A5_CSS : BASE_CSS;
}

const THERMAL_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: Vazirmatn, Sahel, 'Segoe UI', Tahoma, sans-serif; direction: rtl; font-size: 11px; width: 74mm; margin: 0 auto; color: #000; }
  .sheet { padding: 2mm 0; }
  .center { text-align: center; }
  .shop-name { font-size: 15px; font-weight: 700; }
  .meta { font-size: 10px; margin-top: 2px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th, td { padding: 2px 1px; }
  th { border-bottom: 1px solid #000; }
  td.name { text-align: right; }
  td.num, th.num { text-align: center; }
  .row { display: flex; justify-content: space-between; font-size: 11px; padding: 1px 0; }
  .row.grand { font-weight: 700; font-size: 13px; border-top: 1px solid #000; margin-top: 3px; padding-top: 3px; }
  .toolbar { display: flex; gap: 6px; padding: 8px; background: #1f3a5f; }
  .toolbar button { font-family: inherit; padding: 6px 12px; border: 0; border-radius: 5px; background: #fff; color: #1f3a5f; cursor: pointer; }
  @media print { .toolbar { display: none !important; } }
`;

const TOOLBAR = `
<div class="toolbar">
  <button onclick="window.printApi && window.printApi.print()">🖨 چاپ</button>
  <button class="ghost" onclick="window.printApi && window.printApi.savePdf()">ذخیره PDF</button>
  <span class="spacer"></span>
  <button class="ghost" onclick="window.printApi && window.printApi.close()">بستن</button>
</div>`;

function page(title, css, body, withToolbar) {
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
    '<title>' + esc(title) + '</title><style>' + css + '</style></head><body>' +
    (withToolbar === false ? '' : TOOLBAR) + body + '</body></html>';
}

function shopHeader(shop) {
  return '<div class="shop">' +
    (shop.shop_logo ? '<img src="' + esc(shop.shop_logo) + '" alt="">' : '') +
    '<div><div class="shop-name">' + esc(shop.shop_name || 'فروشگاه') + '</div>' +
    '<div class="shop-meta">' +
    (shop.shop_phone ? 'تلفن: ' + esc(shop.shop_phone) + ' &nbsp;|&nbsp; ' : '') +
    (shop.economic_code ? 'کد اقتصادی: ' + esc(shop.economic_code) : '') + '</div>' +
    (shop.shop_address ? '<div class="shop-meta">' + esc(shop.shop_address) + '</div>' : '') +
    '</div></div>';
}

function money(n, currency) {
  return Fmt.money(n) + (currency ? ' ' + currency : '');
}

/**
 * فاکتور کاغذی (فروش یا خرید).
 * data.paper: 'a5' (پیش‌فرض) یا 'a4'
 */
function invoiceSheet(data) {
  const shop = data.settings || {};
  const cur = shop.currency || 'تومان';
  const isSale = data.type === 'sale';
  const inv = data.invoice;
  const partyName = isSale ? (inv.customer_name || 'مشتری متفرقه') : (inv.supplier_name || 'تأمین‌کننده متفرقه');
  const partyPhone = isSale ? inv.customer_phone : inv.supplier_phone;
  const partyAddress = isSale ? inv.customer_address : inv.supplier_address;
  const title = isSale ? 'فاکتور فروش' : 'فاکتور خرید';

  let rows = '';
  inv.items.forEach(function (it, i) {
    rows += '<tr>' +
      '<td>' + Fmt.toFaDigits(i + 1) + '</td>' +
      '<td>' + esc(it.product_code || '') + '</td>' +
      '<td class="name">' + esc(it.name_snapshot) + '</td>' +
      '<td>' + esc(it.unit || '') + '</td>' +
      '<td>' + Fmt.qty(it.qty) + '</td>' +
      '<td>' + Fmt.money(it.unit_price) + '</td>' +
      '<td>' + Fmt.money(it.discount) + '</td>' +
      '<td>' + Fmt.money(it.line_total) + '</td>' +
      '</tr>';
  });

  let payRows = '';
  (inv.payments || []).forEach(function (p) {
    (p.payment_lines || []).forEach(function (l) {
      payRows += '<tr><td>' + esc(C.PAY_METHOD_LABEL[l.method] || l.method) + '</td><td>' + Fmt.money(l.amount) + '</td>' +
        '<td>' + esc(p.date_jalali || '') + '</td><td>' + esc(p.payment_no) + '</td></tr>';
    });
  });
  (inv.checks || []).forEach(function (ch) {
    payRows += '<tr><td>چک ' + esc(ch.check_code) + '</td><td>' + Fmt.money(ch.amount) + '</td>' +
      '<td>سررسید ' + esc(ch.due_date_jalali || '') + '</td><td>' + esc(ch.status_label || '') + '</td></tr>';
  });

  const body =
    '<div class="sheet">' +
    '<div class="head">' + shopHeader(shop) +
    '<div class="doc-title"><h2>' + title + '</h2>' +
    '<div class="doc-meta"><b>شماره:</b> ' + esc(inv.invoice_no) + '</div>' +
    '<div class="doc-meta"><b>تاریخ:</b> ' + esc(inv.date_jalali) + '</div>' +
    (inv.supplier_ref_no ? '<div class="doc-meta"><b>شماره فروشنده:</b> ' + esc(inv.supplier_ref_no) + '</div>' : '') +
    '</div></div>' +

    '<div class="party">' +
    '<span><b>' + (isSale ? 'خریدار' : 'فروشنده') + ':</b> ' + esc(partyName) + '</span>' +
    (partyPhone ? '<span><b>تلفن:</b> ' + esc(partyPhone) + '</span>' : '') +
    (inv.customer_national_id ? '<span><b>کد ملی:</b> ' + esc(inv.customer_national_id) + '</span>' : '') +
    (partyAddress ? '<div><b>نشانی:</b> ' + esc(partyAddress) + '</div>' : '') +
    '</div>' +

    '<table class="items"><thead><tr>' +
    '<th class="c-idx">ردیف</th><th class="c-code">کد</th><th class="c-name">شرح کالا</th>' +
    '<th class="c-unit">واحد</th><th class="c-qty">تعداد</th>' +
    '<th class="c-price">قیمت واحد</th><th class="c-disc">تخفیف</th><th class="c-total">مبلغ کل</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +

    '<div class="totals"><table>' +
    '<tr><td class="label">جمع کل</td><td>' + money(inv.subtotal, cur) + '</td></tr>' +
    (inv.line_discount ? '<tr><td class="label">تخفیف ردیف‌ها</td><td>' + money(inv.line_discount, cur) + '</td></tr>' : '') +
    (inv.invoice_discount ? '<tr><td class="label">تخفیف فاکتور</td><td>' + money(inv.invoice_discount, cur) + '</td></tr>' : '') +
    '<tr><td class="label">مبلغ مشمول مالیات</td><td>' + money(inv.taxable, cur) + '</td></tr>' +
    (inv.vat_amount ? '<tr><td class="label">مالیات بر ارزش افزوده (' + Fmt.toFaDigits(inv.vat_rate) + '٪)</td><td>' + money(inv.vat_amount, cur) + '</td></tr>' : '') +
    '<tr class="grand"><td class="label">مبلغ قابل پرداخت</td><td>' + money(inv.total, cur) + '</td></tr>' +
    (inv.paid ? '<tr><td class="label">پرداخت‌شده</td><td>' + money(inv.paid, cur) + '</td></tr>' : '') +
    (inv.remaining ? '<tr><td class="label">مانده</td><td>' + money(inv.remaining, cur) + '</td></tr>' : '') +
    '</table></div>' +

    '<div class="words">مبلغ به حروف: ' + esc(Fmt.toWords(inv.total)) + ' ' + esc(cur) + '</div>' +

    (payRows ? '<div class="payments"><b>نحوه پرداخت:</b><table><thead><tr><th>روش</th><th>مبلغ</th><th>تاریخ / سررسید</th><th>سند</th></tr></thead><tbody>' + payRows + '</tbody></table></div>' : '') +
    (inv.note ? '<div class="note"><b>توضیحات:</b> ' + esc(inv.note) + '</div>' : '') +

    '<div class="signs"><div>مهر و امضای فروشنده</div><div>مهر و امضای خریدار</div></div>' +
    '<div class="footer">' + esc(shop.shop_name || '') + ' — چاپ ' + esc(Jalali.longDate(Jalali.todayIso())) + '</div>' +
    '</div>';

  return page(title + ' ' + inv.invoice_no, invoiceCss(data.paper), body);
}

/** فیش حرارتی ۸۰ میلی‌متری */
function invoiceThermal(data) {
  const shop = data.settings || {};
  const cur = shop.currency || 'تومان';
  const inv = data.invoice;
  const isSale = data.type === 'sale';
  let rows = '';
  inv.items.forEach(function (it) {
    rows += '<tr><td class="name" colspan="3">' + esc(it.name_snapshot) + '</td></tr>' +
      '<tr><td class="num">' + Fmt.qty(it.qty) + ' × ' + Fmt.money(it.unit_price) + '</td>' +
      '<td class="num">' + (it.discount ? '-' + Fmt.money(it.discount) : '') + '</td>' +
      '<td class="num">' + Fmt.money(it.line_total) + '</td></tr>';
  });
  const body = '<div class="sheet">' +
    '<div class="center"><div class="shop-name">' + esc(shop.shop_name || 'فروشگاه') + '</div>' +
    (shop.shop_phone ? '<div class="meta">تلفن: ' + esc(shop.shop_phone) + '</div>' : '') +
    (shop.shop_address ? '<div class="meta">' + esc(shop.shop_address) + '</div>' : '') +
    '</div><hr>' +
    '<div class="row"><span>' + (isSale ? 'فاکتور فروش' : 'فاکتور خرید') + '</span><span>' + esc(inv.invoice_no) + '</span></div>' +
    '<div class="row"><span>تاریخ</span><span>' + esc(inv.date_jalali) + '</span></div>' +
    '<div class="row"><span>' + (isSale ? 'مشتری' : 'تأمین‌کننده') + '</span><span>' + esc(isSale ? (inv.customer_name || 'متفرقه') : (inv.supplier_name || 'متفرقه')) + '</span></div>' +
    '<hr><table>' + rows + '</table><hr>' +
    '<div class="row"><span>جمع</span><span>' + Fmt.money(inv.subtotal) + '</span></div>' +
    ((inv.line_discount + inv.invoice_discount) ? '<div class="row"><span>تخفیف</span><span>' + Fmt.money(inv.line_discount + inv.invoice_discount) + '</span></div>' : '') +
    (inv.vat_amount ? '<div class="row"><span>مالیات</span><span>' + Fmt.money(inv.vat_amount) + '</span></div>' : '') +
    '<div class="row grand"><span>قابل پرداخت</span><span>' + Fmt.money(inv.total) + ' ' + esc(cur) + '</span></div>' +
    (inv.remaining ? '<div class="row"><span>مانده</span><span>' + Fmt.money(inv.remaining) + '</span></div>' : '') +
    '<hr><div class="center meta">با تشکر از خرید شما</div>' +
    '<div class="center meta">' + esc(Jalali.longDate(Jalali.todayIso())) + '</div>' +
    '</div>';
  return page('فیش ' + inv.invoice_no, THERMAL_CSS, body);
}

/** صورت‌حساب طرف‌حساب */
function statement(data) {
  const shop = data.settings || {};
  const cur = shop.currency || 'تومان';
  const st = data.statement;
  const party = st.party;
  let rows = '';
  st.rows.forEach(function (r, i) {
    rows += '<tr><td>' + Fmt.toFaDigits(i + 1) + '</td><td>' + esc(r.date_jalali || Jalali.isoToJalali(r.date)) + '</td>' +
      '<td class="name">' + esc(r.description || r.entry_desc || '') + '</td>' +
      '<td>' + esc(r.ref_no || '') + '</td>' +
      '<td>' + Fmt.money(r.debit) + '</td><td>' + Fmt.money(r.credit) + '</td><td>' + Fmt.money(r.balance) + '</td></tr>';
  });
  const body = '<div class="sheet">' +
    '<div class="head">' + shopHeader(shop) +
    '<div class="doc-title"><h2>صورت‌حساب</h2>' +
    '<div class="doc-meta"><b>طرف حساب:</b> ' + esc(party.name) + '</div>' +
    (data.from ? '<div class="doc-meta"><b>از تاریخ:</b> ' + esc(Jalali.isoToJalali(data.from)) + '</div>' : '') +
    (data.to ? '<div class="doc-meta"><b>تا تاریخ:</b> ' + esc(Jalali.isoToJalali(data.to)) + '</div>' : '') +
    '</div></div>' +
    '<div class="party"><span><b>تلفن:</b> ' + esc(party.phone || '-') + '</span>' +
    '<span><b>مانده ابتدای دوره:</b> ' + money(st.opening, cur) + '</span></div>' +
    '<table><thead><tr><th style="width:34px">ردیف</th><th style="width:80px">تاریخ</th><th>شرح</th>' +
    '<th style="width:90px">مرجع</th><th style="width:100px">بدهکار</th><th style="width:100px">بستانکار</th><th style="width:110px">مانده</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="6">مانده پایان دوره</td><td>' + money(st.closing, cur) + '</td></tr></tfoot></table>' +
    '<div class="footer">' + esc(shop.shop_name || '') + ' — چاپ ' + esc(Jalali.longDate(Jalali.todayIso())) + '</div></div>';
  return page('صورت‌حساب ' + party.name, BASE_CSS, body);
}

/** گزارش عمومی جدولی */
function genericReport(data) {
  const shop = data.settings || {};
  let head = '';
  for (const c of data.columns) head += '<th' + (c.width ? ' style="width:' + c.width + '"' : '') + '>' + esc(c.header) + '</th>';
  let rows = '';
  data.rows.forEach(function (r, i) {
    rows += '<tr><td>' + Fmt.toFaDigits(i + 1) + '</td>';
    for (const c of data.columns) {
      const v = r[c.key];
      rows += '<td class="' + (c.align === 'right' ? 'name' : '') + '">' +
        (c.money ? Fmt.money(v) : esc(v === null || v === undefined ? '' : v)) + '</td>';
    }
    rows += '</tr>';
  });
  let foot = '';
  if (data.totals) {
    foot = '<tfoot><tr><td>جمع</td>';
    for (const c of data.columns) {
      const v = data.totals[c.key];
      foot += '<td>' + (v === undefined || v === null ? '' : (c.money ? Fmt.money(v) : esc(v))) + '</td>';
    }
    foot += '</tr></tfoot>';
  }
  const body = '<div class="sheet">' +
    '<div class="head">' + shopHeader(shop) +
    '<div class="doc-title"><h2>' + esc(data.title) + '</h2>' +
    (data.subtitle ? '<div class="doc-meta">' + esc(data.subtitle) + '</div>' : '') +
    '<div class="doc-meta">' + esc(Jalali.longDate(Jalali.todayIso())) + '</div></div></div>' +
    '<table><thead><tr><th style="width:34px">ردیف</th>' + head + '</tr></thead><tbody>' + rows + '</tbody>' + foot + '</table>' +
    '<div class="footer">' + esc(shop.shop_name || '') + '</div></div>';
  return page(data.title, BASE_CSS, body);
}

/** برگه اطلاعات چک */
function checkSheet(data) {
  const shop = data.settings || {};
  const cur = shop.currency || 'تومان';
  const c = data.check;
  let events = '';
  (c.events || []).forEach(function (e, i) {
    events += '<tr><td>' + Fmt.toFaDigits(i + 1) + '</td><td>' + esc(e.date_jalali) + '</td><td>' + esc(e.status_label) + '</td><td class="name">' + esc(e.description || '') + '</td></tr>';
  });
  const body = '<div class="sheet">' +
    '<div class="head">' + shopHeader(shop) +
    '<div class="doc-title"><h2>شناسنامه چک</h2><div class="doc-meta"><b>کد یکتا:</b> ' + esc(c.check_code) + '</div></div></div>' +
    '<table><tbody>' +
    '<tr><th style="width:150px">نوع چک</th><td class="name">' + esc(c.direction_label) + '</td><th style="width:150px">وضعیت</th><td class="name">' + esc(c.status_label) + '</td></tr>' +
    '<tr><th>شماره چک</th><td class="name">' + esc(c.check_number || '-') + '</td><th>شناسه صیادی</th><td class="name">' + esc(c.sayad_id || '-') + '</td></tr>' +
    '<tr><th>بانک</th><td class="name">' + esc(c.bank_name || '-') + '</td><th>شعبه</th><td class="name">' + esc(c.branch || '-') + '</td></tr>' +
    '<tr><th>دارنده / صادرکننده</th><td class="name">' + esc(c.holder_name || '-') + '</td><th>طرف حساب</th><td class="name">' + esc(c.party_name || '-') + '</td></tr>' +
    '<tr><th>مبلغ</th><td class="name">' + money(c.amount, cur) + '</td><th>مبلغ به حروف</th><td class="name">' + esc(Fmt.toWords(c.amount)) + '</td></tr>' +
    '<tr><th>تاریخ صدور</th><td class="name">' + esc(c.issue_date_jalali || '-') + '</td><th>سررسید</th><td class="name">' + esc(c.due_date_jalali || '-') + '</td></tr>' +
    '<tr><th>فاکتور مرتبط</th><td class="name">' + esc(c.ref_no || '-') + '</td><th>حساب بانکی</th><td class="name">' + esc(c.bank_account_title || '-') + '</td></tr>' +
    (c.note ? '<tr><th>توضیحات</th><td class="name" colspan="3">' + esc(c.note) + '</td></tr>' : '') +
    '</tbody></table>' +
    '<h3 style="margin-top:14px;font-size:13px;color:#1f3a5f">تاریخچه وضعیت</h3>' +
    '<table><thead><tr><th style="width:34px">ردیف</th><th style="width:90px">تاریخ</th><th style="width:150px">وضعیت</th><th>شرح</th></tr></thead><tbody>' + events + '</tbody></table>' +
    '<div class="footer">' + esc(shop.shop_name || '') + ' — چاپ ' + esc(Jalali.longDate(Jalali.todayIso())) + '</div></div>';
  return page('چک ' + c.check_code, BASE_CSS, body);
}

module.exports = {
  invoiceSheet: invoiceSheet,
  invoiceA4: invoiceSheet,   // نام قدیمی، برای سازگاری
  PAPER: PAPER,
  paperKey: paperKey,
  invoiceThermal: invoiceThermal,
  statement: statement,
  genericReport: genericReport,
  checkSheet: checkSheet,
  page: page,
  BASE_CSS: BASE_CSS
};
