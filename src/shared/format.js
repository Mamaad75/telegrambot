/*
 * قالب‌بندی اعداد و مبالغ — مشترک بین پردازش اصلی و رابط کاربری
 * تمام مبالغ در پایگاه داده به صورت عدد صحیح (INTEGER) در واحد پول پایه نگهداری می‌شوند
 * تا هیچ خطای اعشاری در حسابداری ایجاد نشود.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Fmt = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  function toFaDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) { return FA_DIGITS[+d]; });
  }

  function toEnDigits(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  }

  /** جداکننده هزارگان */
  function group(n) {
    const neg = n < 0;
    const s = String(Math.abs(n));
    const parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  /** مبلغ صحیح -> رشته با جداکننده */
  function money(n) {
    if (n === null || n === undefined || n === '') return '0';
    const v = Math.round(Number(n) || 0);
    return group(v);
  }

  /** مقدار (می‌تواند اعشاری باشد) */
  function qty(n) {
    const v = Number(n) || 0;
    if (Math.abs(v - Math.round(v)) < 1e-9) return group(Math.round(v));
    return group(Math.round(v * 1000) / 1000);
  }

  /** تبدیل ورودی کاربر به عدد صحیح مبلغ */
  function parseMoney(s) {
    if (s === null || s === undefined) return 0;
    if (typeof s === 'number') return Math.round(s);
    const clean = toEnDigits(s).replace(/[,\s٬]/g, '').replace(/[^0-9.\-]/g, '');
    const v = parseFloat(clean);
    return isNaN(v) ? 0 : Math.round(v);
  }

  function parseQty(s) {
    if (s === null || s === undefined) return 0;
    if (typeof s === 'number') return s;
    const clean = toEnDigits(s).replace(/[,\s٬]/g, '').replace(/[^0-9.\-]/g, '');
    const v = parseFloat(clean);
    return isNaN(v) ? 0 : v;
  }

  const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  const SCALES = ['', ' هزار', ' میلیون', ' میلیارد', ' هزار میلیارد'];

  function threeDigitToWords(n) {
    const out = [];
    const h = Math.floor(n / 100), r = n % 100;
    if (h) out.push(HUNDREDS[h]);
    if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
    else {
      const t = Math.floor(r / 10), o = r % 10;
      if (t) out.push(TENS[t]);
      if (o) out.push(ONES[o]);
    }
    return out.join(' و ');
  }

  /** عدد به حروف فارسی (برای چاپ فاکتور) */
  function toWords(n) {
    let v = Math.round(Math.abs(Number(n) || 0));
    if (v === 0) return 'صفر';
    const groups = [];
    while (v > 0) { groups.push(v % 1000); v = Math.floor(v / 1000); }
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i] === 0) continue;
      parts.push(threeDigitToWords(groups[i]) + (SCALES[i] || ''));
    }
    return (Number(n) < 0 ? 'منفی ' : '') + parts.join(' و ');
  }

  return {
    toFaDigits: toFaDigits,
    toEnDigits: toEnDigits,
    money: money,
    qty: qty,
    group: group,
    parseMoney: parseMoney,
    parseQty: parseQty,
    toWords: toWords
  };
});
