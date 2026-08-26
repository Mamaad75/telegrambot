@echo off
chcp 65001 >nul
title ساخت نسخه ویندوز - حسابداری فروشگاه
echo ============================================================
echo   ساخت نسخه نصبی ویندوز - نرم افزار حسابداری فروشگاه
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js نصب نیست.
  echo لطفا نسخه LTS را از https://nodejs.org نصب کنید و دوباره اجرا کنید.
  pause
  exit /b 1
)

echo [1/4] نصب وابستگی ها ...
call npm install
if errorlevel 1 (
  echo [خطا] نصب وابستگی ها ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [2/4] اجرای آزمون های حسابداری ...
call npm test
if errorlevel 1 (
  echo [هشدار] برخی آزمون ها ناموفق بودند. ساخت ادامه پیدا می کند.
)

echo.
echo [3/4] ساخت نصب کننده و نسخه قابل حمل ...
call npx electron-builder --win --x64 --config electron-builder.yml
if errorlevel 1 (
  echo [خطا] ساخت ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [4/4] پایان
echo خروجی ها در پوشه dist ساخته شدند:
dir /b dist\*.exe
echo.
echo   MyShopAccounting-Setup.exe      : نصب کننده ویندوز
echo   MyShopAccounting-Portable.exe   : نسخه قابل حمل
echo.
pause
