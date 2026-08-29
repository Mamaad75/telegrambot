'use strict';
/* پل امن پنجره چاپ: فقط سه عملیات چاپ، ذخیره PDF و بستن در دسترس است */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printApi', {
  print: function () { return ipcRenderer.invoke('print-window:print'); },
  savePdf: function () { return ipcRenderer.invoke('print-window:save-pdf'); },
  close: function () { return ipcRenderer.invoke('print-window:close'); }
});
