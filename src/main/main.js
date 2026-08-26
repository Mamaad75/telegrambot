'use strict';
/**
 * فرایند اصلی برنامه حسابداری فروشگاه.
 * وظایف: مدیریت پنجره، باز کردن پایگاه داده در مسیر داده کاربر، پشتیبان‌گیری خودکار،
 * ثبت عملیات‌های IPC و مدیریت خطاهای پیش‌بینی‌نشده.
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');

const connection = require('./db/connection');
const logger = require('./util/logger');
const ipc = require('./ipc');
const { createPrinter } = require('./printing');
const settings = require('./services/settings');
const backup = require('./services/backup');
const demo = require('./services/demo');

const isDev = !app.isPackaged;
let mainWindow = null;
let printer = null;
let demoMode = false;
let paths = {};

app.setName('MyShopAccounting');

function computePaths() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const backups = path.join(userData, 'backups');
  const logs = path.join(userData, 'logs');
  for (const d of [dataDir, backups, logs]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  let documents = userData;
  try { documents = app.getPath('documents'); } catch (_) { /* در برخی سیستم‌ها موجود نیست */ }
  return {
    userData,
    dataDir,
    backups,
    logs,
    documents,
    dbFile: path.join(dataDir, 'myshop.sqlite'),
    demoDb: path.join(dataDir, 'demo.sqlite'),
  };
}

/** مسیرهای احتمالی پایگاه داده نسخه‌های قبلی برنامه */
function legacyDirs() {
  const base = path.dirname(app.getPath('userData'));
  return [
    path.join(base, 'حسابداری فروشگاه'),
    path.join(base, 'small-shop-accounting'),
    path.join(base, 'shop-accounting'),
    path.join(base, 'MyShopAccounting'),
    app.getPath('userData'),
    paths.dataDir,
  ];
}

function openDatabase(useDemo) {
  const file = useDemo ? paths.demoDb : paths.dbFile;
  const { db, migration } = connection.open(file);
  demoMode = !!useDemo;
  if (migration.applied.length) {
    logger.info(`ساختار پایگاه داده به‌روزرسانی شد: ${migration.from} → ${migration.to}`);
  }
  if (useDemo) {
    try { demo.generate(db); } catch (e) { logger.error('ساخت داده نمایشی ناموفق بود', e); }
  } else {
    try {
      const res = backup.autoBackup(db, paths.backups);
      if (!res.skipped) logger.info('پشتیبان خودکار ساخته شد: ' + res.file);
    } catch (e) {
      logger.error('پشتیبان‌گیری خودکار ناموفق بود', e);
    }
  }
  return db;
}

function switchDb(useDemo) {
  connection.close();
  openDatabase(useDemo);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
}

function buildMenu() {
  const template = [
    {
      label: 'پرونده',
      submenu: [
        {
          label: 'پشتیبان‌گیری فوری',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            try {
              const dir = settings.get(connection.get(), 'backup_dir', '') || paths.backups;
              const res = backup.createBackup(connection.get(), dir, 'manual');
              dialog.showMessageBox(mainWindow, {
                type: 'info', title: 'پشتیبان‌گیری',
                message: 'پشتیبان با موفقیت ساخته شد.',
                detail: res.file, buttons: ['باشه'],
              });
            } catch (e) {
              dialog.showErrorBox('خطا در پشتیبان‌گیری', e.message);
            }
          },
        },
        {
          label: 'پوشه پشتیبان‌ها',
          click: () => shell.openPath(settings.get(connection.get(), 'backup_dir', '') || paths.backups),
        },
        { type: 'separator' },
        { label: 'خروج', role: 'quit' },
      ],
    },
    {
      label: 'نمایش',
      submenu: [
        { label: 'بارگذاری مجدد', role: 'reload' },
        { label: 'بزرگ‌نمایی', role: 'zoomIn' },
        { label: 'کوچک‌نمایی', role: 'zoomOut' },
        { label: 'اندازه عادی', role: 'resetZoom' },
        { label: 'تمام‌صفحه', role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { label: 'ابزار توسعه', role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'راهنما',
      submenu: [
        {
          label: 'پوشه اطلاعات برنامه',
          click: () => shell.openPath(paths.userData),
        },
        {
          label: 'فایل گزارش خطا',
          click: () => { if (logger.file()) shell.showItemInFolder(logger.file()); },
        },
        { type: 'separator' },
        {
          label: 'درباره برنامه',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'درباره برنامه',
            message: 'نرم‌افزار حسابداری فروشگاه',
            detail: `نسخه ${app.getVersion()}\nحسابداری دوطرفه، انبار، فاکتور، چک و گزارش‌های مالی\n\n`
              + `مسیر اطلاعات: ${paths.userData}\nپایگاه داده: ${connection.file()}`,
            buttons: ['باشه'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f2f5f9',
    title: 'حسابداری فروشگاه',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // جلوگیری از باز شدن پنجره یا رفتن به آدرس خارجی
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('فرایند نمایش متوقف شد: ' + JSON.stringify(details));
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showFatal(err) {
  logger.error('خطای بحرانی', err);
  try {
    dialog.showErrorBox('خطای غیرمنتظره',
      'متأسفانه خطایی رخ داد. جزئیات در فایل گزارش خطا ذخیره شد.\n\n'
      + (logger.file() || '') + '\n\n' + String(err && err.message ? err.message : err));
  } catch (_) { /* در حال خاموش شدن */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    paths = computePaths();
    logger.init(paths.logs);
    logger.info('شروع برنامه، نسخه ' + app.getVersion());

    // سیاست امنیتی محتوا برای جلوگیری از بارگذاری منابع خارجی
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"],
        },
      });
    });

    try {
      openDatabase(false);
    } catch (e) {
      showFatal(e);
      app.quit();
      return;
    }

    const ctx = {
      paths,
      mainWindow: () => mainWindow,
      isDemo: () => demoMode,
      switchDb,
      legacyDirs,
      notifyReload: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); },
    };
    printer = createPrinter(ctx);
    ctx.printer = printer;
    ipc.register(ctx);
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch(showFatal);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    try { connection.close(); } catch (_) { /* در حال خروج */ }
  });
}

process.on('uncaughtException', (err) => showFatal(err));
process.on('unhandledRejection', (reason) => logger.error('Promise رد شد', reason));
