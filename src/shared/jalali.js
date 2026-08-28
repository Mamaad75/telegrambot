/*
 * تبدیل تاریخ شمسی (جلالی) و میلادی — بدون وابستگی خارجی
 * الگوریتم مبتنی بر jalaali-js (MIT) بازنویسی شده تا برنامه کاملاً آفلاین کار کند.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Jalali = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

  const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy, withoutLeap) {
    const bl = BREAKS.length, gy = jy + 621;
    let leapJ = -14, jp = BREAKS[0], jm, jump = 0, leap, leapG, march, n, i;
    if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال شمسی نامعتبر: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (!withoutLeap) {
      if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
      leap = mod(mod(n + 1, 33) - 1, 4);
      if (leap === -1) leap = 4;
    }
    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
      div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
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
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    const r = jalCal(jy, true);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    const gy = d2g(jdn).gy;
    let jy = gy - 621;
    const r = jalCal(jy, false);
    const jdn1f = g2d(gy, 3, r.march);
    let k = jdn - jdn1f, jm, jd;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  function toJalali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
  function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }

  function isLeapJalaliYear(jy) { return jalCal(jy, false).leap === 0; }

  function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeapJalaliYear(jy) ? 30 : 29;
  }

  function isValidJalali(jy, jm, jd) {
    if (!(jy >= 1178 && jy <= 3177)) return false;
    if (!(jm >= 1 && jm <= 12)) return false;
    if (!(jd >= 1 && jd <= jalaliMonthLength(jy, jm))) return false;
    return true;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 'YYYY-MM-DD' میلادی  ->  'YYYY/MM/DD' شمسی */
  function isoToJalali(iso) {
    if (!iso) return '';
    const m = String(iso).slice(0, 10).split('-');
    if (m.length !== 3) return String(iso);
    const j = toJalali(+m[0], +m[1], +m[2]);
    return j.jy + '/' + pad2(j.jm) + '/' + pad2(j.jd);
  }

  /** 'YYYY/MM/DD' شمسی -> 'YYYY-MM-DD' میلادی */
  function jalaliToIso(s) {
    if (!s) return null;
    const parts = String(s).replace(/[^0-9]+/g, '-').split('-').filter(Boolean);
    if (parts.length !== 3) return null;
    const jy = +parts[0], jm = +parts[1], jd = +parts[2];
    if (!isValidJalali(jy, jm, jd)) return null;
    const g = toGregorian(jy, jm, jd);
    return g.gy + '-' + pad2(g.gm) + '-' + pad2(g.gd);
  }

  /** تاریخ امروز به صورت 'YYYY-MM-DD' میلادی (محلی) */
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function isoAddDays(iso, days) {
    const p = String(iso).slice(0, 10).split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function isoDiffDays(a, b) {
    const pa = String(a).slice(0, 10).split('-');
    const pb = String(b).slice(0, 10).split('-');
    const da = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
    const db = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((da - db) / 86400000);
  }

  function isoWeekdayName(iso) {
    const p = String(iso).slice(0, 10).split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return WEEKDAYS[d.getDay()];
  }

  /** بازه‌های آماده: امروز، دیروز، این هفته (شنبه تا جمعه)، ماه شمسی جاری، سال جاری */
  function range(kind, baseIso) {
    const base = baseIso || todayIso();
    const p = base.split('-');
    const j = toJalali(+p[0], +p[1], +p[2]);
    switch (kind) {
      case 'today': return { from: base, to: base, label: 'امروز' };
      case 'yesterday': {
        const y = isoAddDays(base, -1);
        return { from: y, to: y, label: 'دیروز' };
      }
      case 'week': {
        const d = new Date(+p[0], +p[1] - 1, +p[2]);
        const back = (d.getDay() + 1) % 7; // شنبه ابتدای هفته
        return { from: isoAddDays(base, -back), to: isoAddDays(base, 6 - back), label: 'این هفته' };
      }
      case 'month': {
        const from = jalaliToIso(j.jy + '/' + pad2(j.jm) + '/01');
        const last = jalaliMonthLength(j.jy, j.jm);
        const to = jalaliToIso(j.jy + '/' + pad2(j.jm) + '/' + pad2(last));
        return { from: from, to: to, label: 'ماه جاری (' + MONTHS[j.jm - 1] + ')' };
      }
      case 'lastmonth': {
        let y = j.jy, m = j.jm - 1;
        if (m === 0) { m = 12; y -= 1; }
        const from = jalaliToIso(y + '/' + pad2(m) + '/01');
        const to = jalaliToIso(y + '/' + pad2(m) + '/' + pad2(jalaliMonthLength(y, m)));
        return { from: from, to: to, label: 'ماه گذشته (' + MONTHS[m - 1] + ')' };
      }
      case 'year': {
        const from = jalaliToIso(j.jy + '/01/01');
        const to = jalaliToIso(j.jy + '/12/' + pad2(jalaliMonthLength(j.jy, 12)));
        return { from: from, to: to, label: 'سال ' + j.jy };
      }
      default: return { from: base, to: base, label: 'امروز' };
    }
  }

  function jalaliYearOf(iso) {
    const p = String(iso).slice(0, 10).split('-');
    return toJalali(+p[0], +p[1], +p[2]).jy;
  }

  function longDate(iso) {
    if (!iso) return '';
    const p = String(iso).slice(0, 10).split('-');
    const j = toJalali(+p[0], +p[1], +p[2]);
    return isoWeekdayName(iso) + ' ' + j.jd + ' ' + MONTHS[j.jm - 1] + ' ' + j.jy;
  }

  return {
    MONTHS: MONTHS,
    WEEKDAYS: WEEKDAYS,
    toJalali: toJalali,
    toGregorian: toGregorian,
    isValidJalali: isValidJalali,
    isLeapJalaliYear: isLeapJalaliYear,
    jalaliMonthLength: jalaliMonthLength,
    isoToJalali: isoToJalali,
    jalaliToIso: jalaliToIso,
    todayIso: todayIso,
    isoAddDays: isoAddDays,
    isoDiffDays: isoDiffDays,
    isoWeekdayName: isoWeekdayName,
    jalaliYearOf: jalaliYearOf,
    longDate: longDate,
    range: range
  };
});
