'use strict';
/** ابزار کار با مبالغ: همه مبالغ به صورت عدد صحیح (بدون اعشار) نگهداری می‌شوند. */

/** گرد کردن ایمن به عدد صحیح (نیم به بالا، مستقل از علامت) */
function r(n) {
  const x = Number(n) || 0;
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** تبدیل هر ورودی به عدد صحیح مثبت یا صفر */
function toAmount(n) {
  const v = r(n);
  return Number.isFinite(v) ? v : 0;
}

/** تبدیل ورودی به تعداد (اعشاری با حداکثر ۳ رقم) */
function toQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

/** جداکننده هزارگان با ارقام لاتین */
function formatNumber(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
  return (neg ? '-' : '') + s;
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** تبدیل ارقام لاتین به فارسی و جداکننده هزارگان فارسی */
function toPersianDigits(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/,/g, '٬')
    .replace(/-/g, '−')
    .replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** عدد با جداکننده هزارگان و ارقام فارسی */
function formatNumberFa(n) {
  return toPersianDigits(formatNumber(n));
}

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', ' هزار', ' میلیون', ' میلیارد', ' هزار میلیارد'];

function threeDigitsToWords(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest <= 19) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ONES[o]);
  }
  return parts.join(' و ');
}

/** عدد به حروف فارسی (برای فاکتور رسمی) */
function numberToPersianWords(num) {
  let n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return 'صفر';
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] === 0) continue;
    words.push(threeDigitsToWords(groups[i]) + (SCALES[i] || ''));
  }
  const sign = (Number(num) || 0) < 0 ? 'منفی ' : '';
  return sign + words.join(' و ');
}

module.exports = { r, toAmount, toQty, formatNumber, formatNumberFa, toPersianDigits, numberToPersianWords };
