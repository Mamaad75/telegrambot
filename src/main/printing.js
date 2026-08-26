'use strict';
/**
 * پنجره پیش‌نمایش و چاپ اسناد.
 * رابط کاربری، HTML سند را می‌سازد و اینجا در یک پنجره جدا نمایش داده می‌شود
 * تا کاربر بتواند پیش‌نمایش ببیند، چاپ کند یا خروجی PDF بگیرد.
 */
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain, dialog, shell } = require('electron');
const logger = require('./util/logger');

const A4 = { width: 8.27, height: 11.69 };
const THERMAL = { width: 3.15, height: 11.69 };

function createPrinter(ctx) {
  const windows = new Set();

  function open(payload) {
    const size = payload.size === 'thermal' ? 'thermal' : 'a4';
    const win = new BrowserWindow({
      width: size === 'thermal' ? 460 : 900,
      height: 860,
      parent: ctx.mainWindow() || undefined,
      title: payload.title || 'پیش‌نمایش چاپ',
      autoHideMenuBar: true,
      backgroundColor: '#f1f4f8',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    windows.add(win);
    win.on('closed', () => windows.delete(win));
    win.setMenu(null);
    win.loadFile(path.join(__dirname, '..', 'renderer', 'print.html'));
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('print:data', {
        html: String(payload.html || ''),
        size,
        title: payload.title || 'سند',
        autoPrint: !!payload.autoPrint,
      });
      win.show();
    });
    return { opened: true };
  }

  async function action(event, { action: what, options }) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false };
    const size = (options && options.size) === 'thermal' ? 'thermal' : 'a4';
    if (what === 'close') { win.close(); return { ok: true }; }
    if (what === 'print') {
      return new Promise((resolve) => {
        win.webContents.print({
          silent: false,
          printBackground: true,
          margins: { marginType: size === 'thermal' ? 'none' : 'default' },
          pageSize: size === 'thermal' ? { width: 80000, height: 297000 } : 'A4',
        }, (success, reason) => {
          if (!success && reason && reason !== 'cancelled') logger.warn('چاپ ناموفق: ' + reason);
          resolve({ ok: success, reason });
        });
      });
    }
    if (what === 'pdf') {
      const name = ((options && options.name) || 'سند').replace(/[\\/:*?"<>|]/g, '-');
      const target = await dialog.showSaveDialog(win, {
        title: 'ذخیره PDF',
        defaultPath: path.join(ctx.paths.documents, name + '.pdf'),
        filters: [{ name: 'فایل PDF', extensions: ['pdf'] }],
      });
      if (target.canceled || !target.filePath) return { ok: false, canceled: true };
      const data = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: size === 'thermal' ? THERMAL : A4,
        margins: size === 'thermal'
          ? { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 }
          : { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      });
      fs.writeFileSync(target.filePath, data);
      shell.showItemInFolder(target.filePath);
      return { ok: true, file: target.filePath };
    }
    return { ok: false };
  }

  ipcMain.handle('print.action', action);

  return { open, closeAll: () => { for (const w of windows) w.close(); } };
}

module.exports = { createPrinter };
