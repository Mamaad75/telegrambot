'use strict';
/*
 * مسیرهای داده برنامه.
 * پایگاه داده و پشتیبان‌ها هرگز در پوشه نصب برنامه قرار نمی‌گیرند تا با به‌روزرسانی پاک نشوند.
 * ویندوز:  %APPDATA%\MyShopAccounting\data\shop.db
 */
const path = require('path');
const fs = require('fs');

let cache = null;

function init(app) {
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
  const userData = app.getPath('userData');
  // نسخه قابل حمل: داده‌ها کنار فایل اجرایی نگهداری می‌شود
  const root = portableRoot ? path.join(portableRoot, 'MyShopAccounting-Data') : userData;
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const logDir = path.join(root, 'logs');
  const exportDir = path.join(root, 'exports');
  for (const d of [dataDir, backupDir, logDir, exportDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  cache = {
    root: root,
    dataDir: dataDir,
    dbFile: path.join(dataDir, 'shop.db'),
    backupDir: backupDir,
    logDir: logDir,
    logFile: path.join(logDir, 'app.log'),
    exportDir: exportDir,
    portable: !!portableRoot
  };
  return cache;
}

function get() {
  if (!cache) throw new Error('مسیرهای برنامه هنوز مقداردهی نشده‌اند.');
  return cache;
}

module.exports = { init: init, get: get };
