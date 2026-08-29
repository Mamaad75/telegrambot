'use strict';
/*
 * پل امن بین رابط کاربری و پردازش اصلی.
 * هیچ API نودی به رابط کاربری داده نمی‌شود؛ فقط یک تابع فراخوانی کانال.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /**
   * فراخوانی یک عملیات؛ خروجی { ok, data } یا { ok:false, error }
   */
  call: function (channel, payload) {
    if (typeof channel !== 'string') return Promise.resolve({ ok: false, error: 'کانال نامعتبر است.' });
    return ipcRenderer.invoke('api', { channel: channel, payload: payload || {} });
  },
  /** رویدادهای ارسالی از پردازش اصلی (یادآوری چک، پشتیبان خودکار و ...) */
  on: function (name, cb) {
    const allowed = ['app:notice', 'app:navigate', 'app:reload-data'];
    if (allowed.indexOf(name) === -1) return function () {};
    const listener = function (_e, data) { cb(data); };
    ipcRenderer.on(name, listener);
    return function () { ipcRenderer.removeListener(name, listener); };
  }
});
