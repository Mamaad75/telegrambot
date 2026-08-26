'use strict';
/**
 * تبدیل تاریخ میلادی <-> شمسی (هجری خورشیدی) بدون وابستگی خارجی
 * پیاده‌سازی بر پایه الگوریتم استاندارد Borkowski.
 * قرارداد پروژه: تاریخ‌ها همیشه به صورت میلادی ISO (YYYY-MM-DD) در پایگاه داده ذخیره
 * می‌شوند و فقط هنگام نمایش به شمسی تبدیل می‌گردند.
 */

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

// نکته مهم: تقسیم باید به سمت صفر بریده شود (نه floor) وگرنه برای اعداد منفی نتیجه غلط می‌شود.
function div(a, b) { return Math.trunc(a / b); }
function mod(a, b) { return a - Math.trunc(a / b) * b; }

function jalCal(jy) {
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سال شمسی خارج از محدوده: ' + jy);
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** میلادی -> شمسی */
function toJalali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
/** شمسی -> میلادی */
function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }

function isLeapJalali(jy) { return jalCal(jy).leap === 0; }
function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalali(jy) ? 30 : 29;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' میلادی -> 'YYYY/MM/DD' شمسی */
function isoToJalali(iso) {
  if (!iso || typeof iso !== 'string' || iso.length < 10) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const j = toJalali(y, m, d);
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}

/** 'YYYY/MM/DD' شمسی -> 'YYYY-MM-DD' میلادی */
function jalaliToIso(str) {
  if (!str) return '';
  const parts = String(str).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
    .split(/[\/\-\.]/).map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) return '';
  const g = toGregorian(parts[0], parts[1], parts[2]);
  return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}`;
}

/** تاریخ امروز به صورت ISO میلادی (بر اساس ساعت محلی سیستم) */
function todayIso(date) {
  const d = date instanceof Date ? date : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayIso(dt);
}

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const JALALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

/** نام روز هفته برای یک تاریخ ISO */
function weekdayName(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay(); // 0=Sunday
  return JALALI_WEEKDAYS[(wd + 1) % 7];
}

/** تاریخ شمسی خوانا: ۱۲ مرداد ۱۴۰۴ */
function isoToJalaliLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const j = toJalali(y, m, d);
  return `${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`;
}

/** ابتدای هفته شمسی (شنبه) برای تاریخ داده‌شده */
function startOfJalaliWeek(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  const back = (wd + 1) % 7;
  return addDaysIso(iso, -back);
}

/** ابتدا و انتهای ماه شمسی جاری برای تاریخ داده‌شده */
function jalaliMonthRange(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const j = toJalali(y, m, d);
  const s = toGregorian(j.jy, j.jm, 1);
  const len = jalaliMonthLength(j.jy, j.jm);
  const e = toGregorian(j.jy, j.jm, len);
  return {
    from: `${s.gy}-${pad2(s.gm)}-${pad2(s.gd)}`,
    to: `${e.gy}-${pad2(e.gm)}-${pad2(e.gd)}`,
  };
}

/** ابتدا و انتهای سال شمسی جاری */
function jalaliYearRange(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const j = toJalali(y, m, d);
  const s = toGregorian(j.jy, 1, 1);
  const e = toGregorian(j.jy, 12, isLeapJalali(j.jy) ? 30 : 29);
  return {
    from: `${s.gy}-${pad2(s.gm)}-${pad2(s.gd)}`,
    to: `${e.gy}-${pad2(e.gm)}-${pad2(e.gd)}`,
  };
}

module.exports = {
  toJalali, toGregorian, isoToJalali, jalaliToIso, isoToJalaliLong,
  todayIso, addDaysIso, weekdayName, startOfJalaliWeek, jalaliMonthRange,
  jalaliYearRange, isLeapJalali, jalaliMonthLength, JALALI_MONTHS, JALALI_WEEKDAYS,
};
