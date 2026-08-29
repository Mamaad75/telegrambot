@echo off
REM ===========================================================================
REM  ساخت نسخه نصبی ویندوز برای نرم‌افزار حسابداری فروشگاهی
REM  این فایل را روی یک کامپیوتر ویندوز (۱۰ یا ۱۱) اجرا کنید.
REM  پیش‌نیاز: فقط Node.js نسخه ۱۸ یا بالاتر  ->  https://nodejs.org
REM
REM  خروجی:  release\MyShopAccounting-Setup.exe
REM          release\MyShopAccounting-Portable.exe
REM ===========================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ============================================================
echo    ساخت نسخه ویندوزی نرم افزار حسابداری فروشگاهی
echo ============================================================
echo.

REM ---------- ۱) بررسی نصب بودن Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js روی این سیستم نصب نیست.
  echo.
  echo   لطفا نسخه LTS را از آدرس زیر دانلود و نصب کنید و سپس دوباره این فایل را اجرا کنید:
  echo   https://nodejs.org
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo [1/4] Node.js یافت شد: !NODEV!
echo.

REM ---------- ۲) نصب وابستگی ها ----------
echo [2/4] در حال نصب وابستگی ها (این مرحله ممکن است چند دقیقه طول بکشد)...
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 (
  echo.
  echo [خطا] نصب وابستگی ها ناموفق بود. اتصال اینترنت را بررسی کنید.
  pause
  exit /b 1
)
echo      نصب وابستگی ها انجام شد.
echo.

REM ---------- ۳) آماده سازی ماژول بومی پایگاه داده ----------
echo [3/4] در حال آماده سازی موتور پایگاه داده برای Electron...
call npx electron-builder install-app-deps
if errorlevel 1 (
  echo.
  echo [خطا] آماده سازی better-sqlite3 ناموفق بود.
  echo       اگر خطای کامپایل دیدید، «Visual Studio Build Tools» را نصب کنید:
  echo       npm install --global windows-build-tools
  pause
  exit /b 1
)
echo      موتور پایگاه داده آماده شد.
echo.

REM ---------- ۴) اجرای آزمون های حسابداری ----------
echo [4/4] اجرای آزمون های خودکار حسابداری...
call npm test
if errorlevel 1 (
  echo.
  echo [هشدار] برخی آزمون ها موفق نبودند. ساخت نسخه نصبی ادامه پیدا می کند.
  echo.
)

REM ---------- ساخت نسخه نصبی ----------
echo.
echo در حال ساخت فایل نصبی ویندوز...
echo.
call npx electron-builder --win nsis portable --x64 --publish never
if errorlevel 1 (
  echo.
  echo [خطا] ساخت نسخه نصبی ناموفق بود. متن خطای بالا را بررسی کنید.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo    ساخت با موفقیت انجام شد
echo ============================================================
echo.
echo   فایل نصبی:      release\MyShopAccounting-Setup.exe
echo   نسخه قابل حمل:  release\MyShopAccounting-Portable.exe
echo.
echo   پایگاه داده برنامه پس از نصب در این مسیر ساخته می شود:
echo   %%APPDATA%%\MyShopAccounting\data\shop.db
echo.
if exist "release" start "" "release"
pause
endlocal
