'use strict';
/*
 * نقطه شروع برنامه ویندوزی.
 * - پایگاه داده در پوشه داده کاربر (%APPDATA%) نگهداری می‌شود، نه در پوشه نصب
 * - پنجره اصلی با contextIsolation و بدون nodeIntegration اجرا می‌شود
 * - پشتیبان خودکار هنگام اجرا و هنگام بستن برنامه
 */
const path = require('path');
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');

const paths = require('./paths.js');
const logger = require('./logger.js');
const connection = require('../db/connection.js');
const settings = require('../services/settings.js');
const backup = require('../services/backup.js');
const checks = require('../services/checks.js');
const ipc = require('./ipc.js');

let mainWindow = null;
let appPaths = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function showFatal(title, message) {
  try { dialog.showErrorBox(title, message); } catch (e) { /* بی‌اهمیت */ }
}

process.on('uncaughtException', function (err) {
  logger.error('خطای مدیریت‌نشده: ' + err.message, err);
  if (app.isReady()) {
    dialog.showMessageBox({
      type: 'error',
      title: 'خطای غیرمنتظره',
      message: 'یک خطای غیرمنتظره رخ داد. اطلاعات فنی در فایل گزارش ذخیره شد.',
      detail: err.message,
      buttons: ['ادامه', 'نمایش فایل گزارش'],
      defaultId: 0
    }).then(function (r) {
      if (r.response === 1 && appPaths) shell.showItemInFolder(appPaths.logFile);
    }).catch(function () { /* بی‌اهمیت */ });
  }
});

process.on('unhandledRejection', function (reason) {
  logger.error('Promise رد شده: ' + (reason && reason.message ? reason.message : String(reason)), reason);
});

function buildMenu() {
  const template = [
    {
      label: 'پرونده',
      submenu: [
        { label: 'فاکتور فروش جدید', accelerator: 'CmdOrCtrl+N', click: function () { navigate('sales/new'); } },
        { label: 'فاکتور خرید جدید', accelerator: 'CmdOrCtrl+Shift+N', click: function () { navigate('purchases/new'); } },
        { type: 'separator' },
        { label: 'پشتیبان‌گیری فوری', click: doManualBackup },
        { label: 'پوشه داده‌ها', click: function () { if (appPaths) shell.openPath(appPaths.root); } },
        { type: 'separator' },
        { label: 'خروج', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'نمایش',
      submenu: [
        { label: 'داشبورد', accelerator: 'CmdOrCtrl+1', click: function () { navigate('dashboard'); } },
        { label: 'کالاها', accelerator: 'CmdOrCtrl+2', click: function () { navigate('products'); } },
        { label: 'فروش', accelerator: 'CmdOrCtrl+3', click: function () { navigate('sales'); } },
        { label: 'خرید', accelerator: 'CmdOrCtrl+4', click: function () { navigate('purchases'); } },
        { label: 'چک‌ها', accelerator: 'CmdOrCtrl+5', click: function () { navigate('checks'); } },
        { label: 'گزارش‌ها', accelerator: 'CmdOrCtrl+6', click: function () { navigate('reports'); } },
        { type: 'separator' },
        { label: 'بزرگ‌نمایی بیشتر', role: 'zoomIn' },
        { label: 'بزرگ‌نمایی کمتر', role: 'zoomOut' },
        { label: 'اندازه عادی', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'تمام‌صفحه', role: 'togglefullscreen' },
        { label: 'ابزار توسعه‌دهنده', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'ابزار',
      submenu: [
        { label: 'تنظیمات', accelerator: 'CmdOrCtrl+,', click: function () { navigate('settings'); } },
        { label: 'پشتیبان‌گیری و بازیابی', click: function () { navigate('backup'); } },
        { label: 'بررسی سلامت حسابداری', click: checkIntegrity }
      ]
    },
    {
      label: 'راهنما',
      submenu: [
        {
          label: 'درباره برنامه',
          click: function () {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'درباره برنامه',
              message: 'نرم‌افزار حسابداری فروشگاهی',
              detail: 'نسخه ' + app.getVersion() + '\n' +
                'محل پایگاه داده:\n' + (appPaths ? appPaths.dbFile : '-') + '\n\n' +
                'محل پشتیبان‌ها:\n' + (appPaths ? appPaths.backupDir : '-'),
              buttons: ['بستن']
            });
          }
        },
        { label: 'فایل گزارش خطاها', click: function () { if (appPaths) shell.showItemInFolder(appPaths.logFile); } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function navigate(route) {
  if (mainWindow) mainWindow.webContents.send('app:navigate', { route: route });
}

async function doManualBackup() {
  try {
    const dir = settings.get(connection.get(), 'backup_dir') || appPaths.backupDir;
    const r = backup.create(connection.get(), dir, 'manual');
    await dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'پشتیبان‌گیری', message: 'نسخه پشتیبان با موفقیت ساخته شد.',
      detail: r.file, buttons: ['بستن']
    });
  } catch (e) {
    showFatal('پشتیبان‌گیری ناموفق', e.message);
  }
}

async function checkIntegrity() {
  try {
    const reports = require('../services/reports.js');
    const r = reports.integrity(connection.get());
    const dbCheck = connection.integrityCheck(connection.get());
    await dialog.showMessageBox(mainWindow, {
      type: r.ok && dbCheck.ok ? 'info' : 'warning',
      title: 'بررسی سلامت',
      message: r.ok && dbCheck.ok ? 'همه چیز سالم است.' : 'در بررسی سلامت اشکالی یافت شد.',
      detail:
        'جمع بدهکار: ' + r.total_debit.toLocaleString('en-US') + '\n' +
        'جمع بستانکار: ' + r.total_credit.toLocaleString('en-US') + '\n' +
        'اسناد ناتراز: ' + r.unbalanced_entries.length + '\n' +
        'حساب موجودی کالا: ' + r.inventory_gl.toLocaleString('en-US') + '\n' +
        'ارزش واقعی انبار: ' + r.inventory_stock_value.toLocaleString('en-US') + '\n' +
        'سلامت فایل پایگاه داده: ' + (dbCheck.ok ? 'سالم' : 'مشکل‌دار'),
      buttons: ['بستن']
    });
  } catch (e) {
    showFatal('بررسی سلامت ناموفق', e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    backgroundColor: '#f2f5f9',
    title: 'نرم‌افزار حسابداری فروشگاهی',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', function () {
    mainWindow.maximize();
    mainWindow.show();
    setTimeout(sendStartupNotices, 1200);
  });

  // جلوگیری از باز شدن پنجره یا پیمایش به آدرس خارجی
  // (بارگذاری مجدد همان صفحه مجاز است تا پس از راه‌اندازی اولیه برنامه بالا بیاید)
  const appUrl = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html').replace(/\\/g, '/');
  mainWindow.webContents.setWindowOpenHandler(function () { return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', function (e, url) {
    if (url.split('#')[0].split('?')[0] === appUrl) return;
    e.preventDefault();
    logger.warn('پیمایش به آدرس خارجی مسدود شد: ' + url);
  });

  mainWindow.on('closed', function () { mainWindow = null; });
}

function sendStartupNotices() {
  if (!mainWindow) return;
  try {
    const db = connection.get();
    const due = checks.reminders(db);
    const overdue = due.filter(function (c) { return c.is_overdue; });
    if (due.length) {
      mainWindow.webContents.send('app:notice', {
        kind: 'checks',
        count: due.length,
        overdue: overdue.length,
        message: 'شما ' + due.length + ' چک نزدیک سررسید' + (overdue.length ? ' و ' + overdue.length + ' چک سررسید گذشته' : '') + ' دارید.'
      });
    }
  } catch (e) {
    logger.warn('ارسال یادآوری چک ناموفق بود: ' + e.message);
  }
}

app.whenReady().then(function () {
  try {
    appPaths = paths.init(app);
    logger.init(appPaths.logFile);
    logger.info('شروع برنامه، نسخه ' + app.getVersion());
    connection.open(appPaths.dbFile);
    const db = connection.get();
    if (!settings.get(db, 'backup_dir')) settings.set(db, 'backup_dir', appPaths.backupDir);
    try {
      const auto = backup.autoBackup(db, settings.get(db, 'backup_dir') || appPaths.backupDir);
      if (auto) logger.info('پشتیبان خودکار ساخته شد: ' + auto.file);
    } catch (e) {
      logger.warn('پشتیبان خودکار ناموفق بود: ' + e.message);
    }
  } catch (e) {
    logger.error('باز کردن پایگاه داده ناموفق بود: ' + e.message, e);
    showFatal('خطا در باز کردن پایگاه داده',
      'پایگاه داده باز نشد.\n\n' + e.message + '\n\nمسیر: ' + (appPaths ? appPaths.dbFile : '-'));
    app.quit();
    return;
  }

  ipc.register();
  buildMenu();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});

app.on('before-quit', function () {
  try {
    const db = connection.get();
    if (settings.getBool(db, 'auto_backup')) {
      const dir = settings.get(db, 'backup_dir') || appPaths.backupDir;
      backup.create(db, dir, 'exit');
      backup.prune(dir, parseInt(settings.get(db, 'backup_keep', '30'), 10) || 30);
    }
  } catch (e) {
    logger.warn('پشتیبان هنگام خروج ناموفق بود: ' + e.message);
  }
  try { connection.close(); } catch (e) { /* بی‌اهمیت */ }
  logger.info('پایان برنامه');
});
