'use strict';
const t = require('./helper');

const cases = [
  ['هسته حسابداری', require('./cases/core')],
  ['صحت‌سنجی و گزارش‌ها', require('./cases/sanity')],
  ['فایل‌ها: اکسل، پشتیبان و انتقال داده', require('./cases/files')],
];

console.log('\x1b[1m═══ آزمون‌های نرم‌افزار حسابداری فروشگاه ═══\x1b[0m');
for (const [name, fn] of cases) {
  try { fn(); } catch (e) {
    console.error(`\x1b[31m✗ اجرای مجموعه «${name}» با خطا متوقف شد: ${e.message}\x1b[0m`);
    console.error(e.stack);
    t.ok(false, `مجموعه ${name} کامل اجرا شد`, e.message);
  }
}
process.exit(t.summary() ? 0 : 1);
