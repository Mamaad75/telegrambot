# Jarchi WordPress Plugin 1.21.0

## هدف این نسخه
این نسخه روی سه مسیر متمرکز است: Elementor-native شدن صفحات تیکت، کشف واقعی فیلدهای runtime، و جدا کردن شمارهٔ تماس صاحب آگهی از فیلد `phone` خود آگهی.

## تغییرات اصلی
- Widget بومی **Jarchi Ticket Center** برای Elementor، با viewهای `list` و `new`.
- مهاجرت امن صفحات قدیمی: Widget شورت‌کد `[jarchi_tickets]` داخل Elementor درجا به Widget بومی تبدیل می‌شود؛ سایر تنظیمات و چیدمان صفحه حفظ می‌شوند.
- طراحی پیش‌فرض تیکت با UI جارچی: لیست متراکم‌تر، جستجوی تیکت، وضعیت، شماره و دپارتمان، صفحهٔ ثبت جدا، FAQ بدون search و CTA واقعی «مشکلم حل نشد».
- Back control فقط فلش، و responsive layout در موبایل/تبلت/دسکتاپ.
- Runtime field discovery روی نمونه‌های واقعی همان post type/scope و persist شدن discovery در همان request.
- Contract 1.4 برای شماره تماس: شماره از پروفایل نویسنده (`wp_usermeta`) می‌آید و فقط برای platformهایی که contact button روشن است مجاز می‌شود.

## سازگاری
- Shortcodeهای قدیمی برای backwards compatibility ثبت می‌مانند، اما صفحات جدید به آن‌ها وابسته نیستند.
- payloadهای قدیمی backend همچنان قابل پردازش‌اند؛ برای سیاست جدید شماره تماس Backend 2.4.14 توصیه می‌شود.
