'use strict';
/**
 * پل ارتباطی امن بین رابط کاربری و فرایند اصلی.
 * این فایل در حالت sandbox اجرا می‌شود و هیچ API نودی را در اختیار صفحه
 * قرار نمی‌دهد؛ تنها راه ارتباط، فراخوانی عملیات‌های تعریف‌شده در فرایند اصلی است.
 * اعتبارسنجی نهایی کانال‌ها در فرایند اصلی انجام می‌شود (فقط کانال‌های ثبت‌شده پاسخ می‌دهند).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /**
   * فراخوانی یک عملیات در فرایند اصلی.
   * پاسخ همیشه به شکل {ok:true,data} یا {ok:false,error:{message,code}} است.
   */
  async call(channel, payload) {
    if (typeof channel !== 'string') {
      return { ok: false, error: { message: 'عملیات نامعتبر است.', code: 'BAD_CHANNEL' } };
    }
    try {
      return await ipcRenderer.invoke(channel, payload === undefined ? {} : payload);
    } catch (err) {
      return {
        ok: false,
        error: { message: 'ارتباط با هسته برنامه برقرار نشد.', code: 'IPC_FAILED', technical: String(err && err.message) },
      };
    }
  },
  /** دریافت رویدادهای فرایند اصلی */
  on(event, handler) {
    const valid = ['print:data', 'app:notice', 'app:reload', 'app:navigate'];
    if (!valid.includes(event) || typeof handler !== 'function') return () => {};
    const wrapped = (_e, data) => handler(data);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
  /** دستورهای پنجره چاپ */
  printAction(action, options) {
    return ipcRenderer.invoke('print.action', { action, options: options || {} });
  },
});
