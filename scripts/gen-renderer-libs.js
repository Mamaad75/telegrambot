'use strict';
/**
 * ساخت نسخه مرورگری کتابخانه‌های مشترک (تاریخ شمسی و مبالغ) از روی فایل‌های
 * فرایند اصلی، تا منطق در دو جا تکرار و ناهمگام نشود.
 * خروجی: src/renderer/js/lib.generated.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function strip(source) {
  return source
    .replace(/^'use strict';\s*/m, '')
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/m, '')
    .trim();
}

const jalali = strip(read('src/main/util/jalali.js'));
const money = strip(read('src/main/util/money.js'));

const out = `/* این فایل به صورت خودکار توسط scripts/gen-renderer-libs.js ساخته می‌شود. ویرایش دستی نکنید. */
(function (global) {
  'use strict';

  // ── تاریخ شمسی ────────────────────────────────────────────────
  ${jalali.split('\n').join('\n  ')}

  // ── مبالغ ─────────────────────────────────────────────────────
  ${money.split('\n').join('\n  ')}

  global.Jalali = {
    toJalali, toGregorian, isoToJalali, jalaliToIso, isoToJalaliLong,
    todayIso, addDaysIso, weekdayName, startOfJalaliWeek, jalaliMonthRange,
    jalaliYearRange, isLeapJalali, jalaliMonthLength, JALALI_MONTHS, JALALI_WEEKDAYS,
  };
  global.Money = { r, toAmount, toQty, formatNumber, formatNumberFa, toPersianDigits, numberToPersianWords };
}(window));
`;

const target = path.join(root, 'src/renderer/js/lib.generated.js');
fs.writeFileSync(target, out);
console.log('ساخته شد:', path.relative(root, target), out.length, 'بایت');
