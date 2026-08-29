'use strict';
/* لایه فراخوانی عملیات از پردازش اصلی، با مدیریت یکنواخت خطا */
(function (w) {
  const api = w.api;

  /** فراخوانی؛ در صورت خطا پیام فارسی نمایش داده و استثنا پرتاب می‌شود */
  async function call(channel, payload) {
    const res = await api.call(channel, payload);
    if (!res || !res.ok) {
      const msg = (res && res.error) || 'ارتباط با هسته برنامه برقرار نشد.';
      const err = new Error(msg);
      err.handled = false;
      throw err;
    }
    return res.data;
  }

  /** فراخوانی امن: خطا را نمایش می‌دهد و null برمی‌گرداند */
  async function safe(channel, payload, silent) {
    try {
      return await call(channel, payload);
    } catch (e) {
      if (!silent) w.U.toast(e.message, 'error');
      return null;
    }
  }

  w.API = {
    call: call,
    safe: safe,
    on: api.on
  };
})(window);
