'use strict';
/*
 * چاپ و خروجی PDF.
 * سند در یک پنجره مستقل با نوار ابزار (چاپ / ذخیره PDF / بستن) باز می‌شود.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BrowserWindow, dialog } = require('electron');
const logger = require('./logger.js');

const openWindows = new Set();

/** اندازه کاغذ برای printToPDF: فیش حرارتی ۸۰ میلی‌متری، وگرنه A4/A5 */
function pageSizeOf(opt) {
  const o = opt || {};
  if (o.thermal) return { width: 80000, height: 297000 };
  const p = String(o.pageSize || 'A4').toUpperCase();
  return p === 'A5' ? 'A5' : 'A4';
}

function tempFile(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopacc-print-'));
  const file = path.join(dir, 'document.html');
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

function cleanup(file) {
  try {
    fs.unlinkSync(file);
    fs.rmdirSync(path.dirname(file));
  } catch (e) { /* بی‌اهمیت */ }
}

/** باز کردن پیش‌نمایش چاپ */
function preview(html, opt) {
  const options = opt || {};
  const file = tempFile(html);
  const win = new BrowserWindow({
    width: options.width || 900,
    height: options.height || 780,
    title: options.title || 'پیش‌نمایش چاپ',
    parent: options.parent || null,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'print-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.__printMeta = {
    defaultName: options.defaultName || 'document',
    landscape: !!options.landscape,
    thermal: !!options.thermal,
    pageSize: options.pageSize || 'A4'
  };
  openWindows.add(win);
  win.loadFile(file);
  win.on('closed', function () {
    openWindows.delete(win);
    cleanup(file);
  });
  return win;
}

/** چاپ مستقیم بدون نمایش پنجره */
function printDirect(html, opt) {
  const options = opt || {};
  return new Promise(function (resolve) {
    const file = tempFile(html);
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    win.loadFile(file);
    win.webContents.once('did-finish-load', function () {
      const printOpts = {
        silent: !!options.silent,
        printBackground: true,
        deviceName: options.deviceName || undefined,
        landscape: !!options.landscape,
        margins: { marginType: 'default' }
      };
      // ویندوز اندازه کاغذ را از خود سند می‌گیرد؛ برای A5 صریح اعلام می‌کنیم
      if (!options.thermal && String(options.pageSize || '').toUpperCase() === 'A5') {
        printOpts.pageSize = 'A5';
      }
      win.webContents.print(printOpts, function (success, reason) {
        if (!success) logger.warn('چاپ انجام نشد: ' + reason);
        win.destroy();
        cleanup(file);
        resolve({ ok: !!success, reason: reason || null });
      });
    });
  });
}

/** ساخت فایل PDF */
async function toPdf(html, filePath, opt) {
  const options = opt || {};
  const file = tempFile(html);
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadFile(file);
    const data = await win.webContents.printToPDF({
      printBackground: true,
      landscape: !!options.landscape,
      pageSize: pageSizeOf(options),
      margins: options.thermal ? { top: 0, bottom: 0, left: 0, right: 0 } : undefined
    });
    fs.writeFileSync(filePath, data);
    return { ok: true, file: filePath };
  } finally {
    win.destroy();
    cleanup(file);
  }
}

/** درخواست ذخیره PDF از داخل پنجره پیش‌نمایش */
async function savePdfFromWindow(win, exportDir) {
  const meta = win.__printMeta || {};
  const res = await dialog.showSaveDialog(win, {
    title: 'ذخیره فایل PDF',
    defaultPath: path.join(exportDir || os.homedir(), (meta.defaultName || 'document') + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const data = await win.webContents.printToPDF({
    printBackground: true,
    landscape: !!meta.landscape,
    pageSize: pageSizeOf(meta)
  });
  fs.writeFileSync(res.filePath, data);
  return { ok: true, file: res.filePath };
}

function printFromWindow(win) {
  const meta = win.__printMeta || {};
  return new Promise(function (resolve) {
    const opts = { silent: false, printBackground: true };
    if (!meta.thermal && String(meta.pageSize || '').toUpperCase() === 'A5') opts.pageSize = 'A5';
    win.webContents.print(opts, function (success, reason) {
      resolve({ ok: !!success, reason: reason || null });
    });
  });
}

module.exports = { preview: preview, printDirect: printDirect, toPdf: toPdf, savePdfFromWindow: savePdfFromWindow, printFromWindow: printFromWindow };
