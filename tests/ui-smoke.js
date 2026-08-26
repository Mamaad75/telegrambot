'use strict';
/**
 * آزمون واقعی رابط کاربری: برنامه Electron اجرا می‌شود، همه صفحات باز می‌شوند،
 * یک فاکتور فروش کامل ثبت می‌گردد و از خطاهای کنسول عکس گرفته می‌شود.
 * اجرا: xvfb-run -a node tests/ui-smoke.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const OUT = process.env.SMOKE_OUT || path.join(os.tmpdir(), 'myshop-smoke');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'myshop-ui-'));

let pass = 0; let fail = 0;
const problems = [];
function check(cond, label, detail) {
  if (cond) { pass += 1; console.log('  \x1b[32m✓\x1b[0m ' + label); } else {
    fail += 1; problems.push(label + (detail ? ' → ' + detail : ''));
    console.log('  \x1b[31m✗ ' + label + (detail ? ' → ' + detail : '') + '\x1b[0m');
  }
}

async function shot(page, name) {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false });
}

(async () => {
  console.log('\x1b[1m═══ آزمون رابط کاربری (Electron) ═══\x1b[0m');
  console.log('پوشه اطلاعات آزمون:', USER_DATA);

  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, MYSHOP_USER_DATA: USER_DATA },
    timeout: 60000,
  });

  const page = await app.firstWindow({ timeout: 40000 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // ── راه‌اندازی اولیه
  const setupVisible = await page.locator('#setup').isVisible().catch(() => false);
  check(setupVisible, 'صفحه راه‌اندازی اولیه نمایش داده شد');
  await shot(page, '01-setup');
  if (setupVisible) {
    await page.fill('#setup input[type=text]', 'سوپرمارکت آزمون');
    await page.click('#setup button.primary');           // مرحله ۲
    await page.waitForTimeout(300);
    await page.click('#setup button.primary');           // مرحله ۳
    await page.waitForTimeout(300);
    const moneyInputs = page.locator('#setup input.num');
    await moneyInputs.first().fill('100000000');
    await page.click('#setup button.primary');           // پایان
    await page.waitForTimeout(1500);
  }
  check(!(await page.locator('#setup').count()), 'راه‌اندازی اولیه کامل شد و داشبورد باز شد');
  await shot(page, '02-dashboard');

  const title = await page.locator('#pageTitle').textContent();
  check(title.includes('داشبورد'), 'عنوان صفحه: داشبورد', title);
  check((await page.locator('#brandName').textContent()).includes('سوپرمارکت آزمون'), 'نام فروشگاه در نوار کناری');

  // ── ثبت کالا
  await page.click('.nav-item[data-page="products"]');
  await page.waitForTimeout(700);
  await page.click('button:has-text("+ کالای جدید")');
  await page.waitForTimeout(600);
  const modal = page.locator('.modal').last();
  const fieldInput = (labelText) => modal.locator(`.field:has(label:text-is("${labelText}")) input`).first();
  await fieldInput('نام کالا *').fill('کالای آزمایشی');
  await fieldInput('کد کالا').fill('A1');
  await fieldInput('بارکد').fill('1234567890');
  await fieldInput('قیمت خرید').fill('20000');
  await fieldInput('قیمت فروش').fill('30000');
  await fieldInput('حداقل موجودی').fill('5');
  await fieldInput('موجودی اولیه').fill('50');
  await modal.locator('button:has-text("ذخیره")').click();
  await page.waitForTimeout(1500);
  check(await page.locator('.modal').count() === 0, 'پنجره ثبت کالا پس از ذخیره بسته شد');
  const bodyText = await page.locator('#view').textContent();
  check(/کالای آزمایشی/.test(bodyText), 'کالا ثبت و در فهرست نمایش داده شد');
  check(/۵۰/.test(bodyText), 'موجودی اولیه ۵۰ عدد ثبت شد (با ارقام فارسی)');
  await shot(page, '03-products');

  // ── فاکتور فروش
  await page.click('.nav-item[data-page="sale"]');
  await page.waitForTimeout(900);
  await page.fill('input[placeholder*="نام، کد یا بارکد"]', 'کالای آزمایشی');
  await page.waitForTimeout(700);
  const suggestion = page.locator('.autocomplete .results div').first();
  check(await suggestion.isVisible(), 'جست‌وجوی کالا نتیجه داد');
  await suggestion.click();
  await page.waitForTimeout(400);
  await page.click('button:has-text("+ افزودن به فاکتور")');
  await page.waitForTimeout(600);
  const lineCount = await page.locator('table.grid-table tbody tr').count();
  check(lineCount >= 1, 'ردیف کالا به فاکتور اضافه شد');
  await page.click('button:has-text("+ افزودن روش پرداخت")');
  await page.waitForTimeout(400);
  await shot(page, '04-sale');
  await page.click('button:has-text("ثبت فاکتور")');
  await page.waitForTimeout(1800);
  const toastText = await page.locator('.toast').first().textContent().catch(() => '');
  check(/ثبت شد/.test(toastText), 'فاکتور فروش با موفقیت ثبت شد', toastText);

  // ── چاپ فاکتور و خروجی PDF
  await page.click('.nav-item[data-page="invoices"]');
  await page.waitForTimeout(1200);
  const invoiceRows = await page.locator('table.grid-table tbody tr').count();
  check(invoiceRows >= 1, 'فاکتور ثبت‌شده در فهرست فاکتورها دیده می‌شود');
  await page.locator('button:has-text("مشاهده")').first().click();
  await page.waitForTimeout(900);
  const detailText = await page.locator('.modal').last().textContent();
  check(/اسناد حسابداری/.test(detailText), 'جزئیات فاکتور شامل اسناد حسابداری است');
  check(/بهای تمام‌شده/.test(detailText), 'جزئیات فاکتور شامل بهای تمام‌شده است');
  await shot(page, '07-invoice-detail');

  const [printWindow] = await Promise.all([
    app.waitForEvent('window', { timeout: 20000 }),
    page.locator('.modal button:has-text("چاپ فاکتور")').click(),
  ]);
  await printWindow.waitForLoadState('domcontentloaded');
  await printWindow.waitForTimeout(1200);
  const printText = await printWindow.locator('#paper').textContent();
  check(/فاکتور فروش/.test(printText), 'پیش‌نمایش چاپ فاکتور باز شد');
  check(/مبلغ به حروف/.test(printText), 'فاکتور چاپی مبلغ به حروف دارد');
  check(/سوپرمارکت آزمون/.test(printText), 'نام فروشگاه روی فاکتور چاپ می‌شود');
  check(/مهر و امضا/.test(printText), 'فاکتور چاپی محل امضا دارد');
  await printWindow.screenshot({ path: path.join(OUT, '08-print-preview.png') });

  // تولید واقعی PDF از پنجره چاپ (بدون پنجره ذخیره فایل)
  const pdfPath = path.join(OUT, 'invoice.pdf');
  const pdfBase64 = await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    const win = wins.find((w) => w.getTitle().includes('فاکتور')) || wins[wins.length - 1];
    const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    return data.toString('base64');
  });
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');
  fs.writeFileSync(pdfPath, pdfBuffer);
  check(pdfBuffer.length > 3000, 'خروجی PDF فاکتور تولید شد', pdfBuffer.length + ' بایت');
  const pdfHeader = pdfBuffer.slice(0, 5).toString();
  check(pdfHeader === '%PDF-', 'فایل PDF معتبر است', pdfHeader);
  await printWindow.close().catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── بررسی سایر صفحات
  const pages = [
    ['invoices', 'فهرست فاکتورها'], ['inventory', 'انبار'], ['customers', 'مشتریان'],
    ['suppliers', 'تأمین‌کنندگان'], ['treasury', 'صندوق و بانک'], ['checks', 'چک‌ها'],
    ['accounting', 'حسابداری'], ['reports', 'گزارش‌ها'], ['settings', 'تنظیمات'],
    ['purchase', 'فاکتور خرید'], ['sale_return', 'برگشت از فروش'], ['dashboard', 'داشبورد'],
  ];
  for (const [key, label] of pages) {
    await page.click(`.nav-item[data-page="${key}"]`);
    await page.waitForTimeout(900);
    const hasError = await page.locator('h3:has-text("خطا در نمایش این بخش")').count();
    const heading = await page.locator('#pageTitle').textContent();
    check(hasError === 0 && heading.trim().length > 0, `صفحه «${label}» بدون خطا باز شد`, hasError ? 'خطای نمایش' : '');
    if (['invoices', 'accounting', 'reports', 'settings'].includes(key)) await shot(page, 'page-' + key);
  }

  // ── جست‌وجوی سراسری
  await page.click('.nav-item[data-page="dashboard"]');
  await page.waitForTimeout(800);
  await page.fill('#globalSearch input', 'کالای آزمایشی');
  await page.waitForTimeout(900);
  const gResults = page.locator('#globalSearch .results div');
  const gCount = await gResults.count();
  check(gCount >= 1, 'جست‌وجوی سراسری نتیجه برمی‌گرداند', 'نتایج: ' + gCount);
  const gText = await gResults.first().textContent();
  check(/کالای آزمایشی/.test(gText), 'نتیجه جست‌وجوی سراسری شامل کالا است', gText);
  await shot(page, '09-global-search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── بررسی داشبورد پس از فروش
  await page.click('.nav-item[data-page="dashboard"]');
  await page.waitForTimeout(1500);
  const dashText = await page.locator('#view').textContent();
  check(/فروش دوره/.test(dashText), 'داشبورد شاخص فروش را نمایش می‌دهد');
  check(/[۰-۹]/.test(dashText), 'داشبورد اعداد را با ارقام فارسی نمایش می‌دهد');
  await shot(page, '05-dashboard-after');

  // ── بررسی حسابداری: تراز
  await page.click('.nav-item[data-page="accounting"]');
  await page.waitForTimeout(800);
  await page.click('.tabs button:has-text("تراز آزمایشی")');
  await page.waitForTimeout(1200);
  const trialText = await page.locator('#view').textContent();
  check(/متوازن/.test(trialText), 'تراز آزمایشی نمایش داده شد');
  check(!/نامتوازن/.test(trialText), 'دفاتر متوازن هستند');
  await shot(page, '06-trial-balance');

  // ── خطاهای کنسول
  const realErrors = consoleErrors.filter((e) => !/DevTools|Autofill|GPU|dbus|libva/i.test(e));
  check(realErrors.length === 0, 'هیچ خطای کنسولی در رابط کاربری رخ نداد', realErrors.slice(0, 3).join(' | '));

  await app.close();

  console.log('\n' + '─'.repeat(60));
  console.log(`\x1b[1mنتیجه آزمون رابط کاربری: ${pass} موفق، ${fail} ناموفق\x1b[0m`);
  if (problems.length) { console.log('\x1b[31mموارد ناموفق:\x1b[0m'); problems.forEach((p) => console.log(' - ' + p)); }
  console.log('تصاویر:', OUT);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\x1b[31mاجرای آزمون با خطا متوقف شد:\x1b[0m', e);
  process.exit(1);
});
