/* ابزارهای عمومی رابط کاربری */
(function (global) {
  'use strict';

  const state = { settings: {}, info: {}, currency: 'تومان' };

  const el = (sel, root) => (root || document).querySelector(sel);
  const els = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** ساخت المان با ویژگی‌ها و فرزندان */
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  /** گریز از HTML برای جلوگیری از تزریق کد در قالب‌های رشته‌ای */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const fa = (v) => global.Money.toPersianDigits(v);

  const fmt = {
    /** مبلغ با ارقام فارسی و در صورت نیاز واحد پول */
    money(n, withUnit) {
      const s = fa(global.Money.formatNumber(Math.round(Number(n) || 0)));
      return withUnit === false ? s : s + ' ' + state.currency;
    },
    /** عدد با ارقام فارسی و جداکننده هزارگان */
    plain(n) { return fa(global.Money.formatNumber(Math.round(Number(n) || 0))); },
    /** تعداد (با اعشار در صورت وجود) */
    qty(n) { return fa(global.Money.formatNumber(Number(n) || 0)); },
    /** عدد با ارقام لاتین (برای مقادیر داخل فیلدهای ورودی) */
    raw(n) { return global.Money.formatNumber(Number(n) || 0); },
    date(iso) { return fa(global.Jalali.isoToJalali(iso)) || '—'; },
    dateLong(iso) { return fa(global.Jalali.isoToJalaliLong(iso)) || '—'; },
    words(n) { return global.Money.numberToPersianWords(Math.round(Number(n) || 0)); },
    percent(n) { return fa(Number(n) || 0) + '٪'; },
    fa,
  };

  const LABELS = {
    method: { cash: 'نقدی', pos: 'کارتخوان', bank: 'بانک / کارت‌به‌کارت', check: 'چک', credit: 'نسیه' },
    invoiceType: { sale: 'فاکتور فروش', purchase: 'فاکتور خرید', sale_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید' },
    invoiceTypeShort: { sale: 'فروش', purchase: 'خرید', sale_return: 'برگشت فروش', purchase_return: 'برگشت خرید' },
    checkStatus: { pending: 'در جریان', deposited: 'واگذار به بانک', cleared: 'وصول‌شده', returned: 'برگشتی', paid: 'پرداخت‌شده', cancelled: 'ابطال‌شده' },
    checkKind: { received: 'دریافتی', paid: 'پرداختی' },
    movement: {
      purchase: 'خرید', sale: 'فروش', sale_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید',
      adjust_in: 'اصلاح افزایشی', adjust_out: 'اصلاح کاهشی', count: 'انبارگردانی',
      opening: 'موجودی اول دوره', void: 'ابطال سند',
    },
    accountType: { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه' },
    refType: {
      sale: 'فروش', purchase: 'خرید', sale_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید',
      cogs: 'بهای تمام‌شده', cogs_return: 'برگشت بهای تمام‌شده', receipt: 'دریافت', payment: 'پرداخت',
      expense: 'هزینه', income: 'درآمد', transfer: 'انتقال وجه', check: 'چک', opening: 'اول دوره',
      adjustment: 'اصلاح انبار', drawing: 'برداشت مالک', contribution: 'آورده مالک', manual: 'دستی',
    },
  };
  function label(group, key) {
    return (LABELS[group] && LABELS[group][key]) || key || '';
  }

  /** تبدیل ارقام فارسی/عربی به لاتین */
  function toLatinDigits(str) {
    return String(str == null ? '' : str)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  }

  /** خواندن عدد از ورودی کاربر (با جداکننده و ارقام فارسی) */
  function parseNumber(value) {
    const s = toLatinDigits(value).replace(/[,\s٬]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  /** فراخوانی امن هسته برنامه؛ خطاها به صورت پیام فارسی نمایش داده می‌شوند */
  async function call(channel, payload, opts) {
    const res = await global.api.call(channel, payload || {});
    if (!res || res.ok !== true) {
      const message = (res && res.error && res.error.message) || 'خطای نامشخص';
      if (!(opts && opts.silent)) global.UI.toast(message, 'bad');
      const err = new Error(message);
      err.code = res && res.error && res.error.code;
      err.handled = true;
      throw err;
    }
    return res.data;
  }

  /** اجرای امن یک تابع async با نمایش خطا به جای توقف برنامه */
  function guard(fn) {
    return async function guarded(...args) {
      try {
        return await fn.apply(this, args);
      } catch (err) {
        if (!err || !err.handled) {
          console.error(err);
          global.UI.toast((err && err.message) || 'خطای غیرمنتظره رخ داد.', 'bad');
          try { global.api.call('app.log', { message: String(err && err.message), detail: String(err && err.stack) }); } catch (_) { /* نادیده */ }
        }
        return undefined;
      }
    };
  }

  function debounce(fn, ms) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 250);
    };
  }

  function todayIso() { return global.Jalali.todayIso(); }

  /** بازه‌های آماده تاریخ برای گزارش‌ها */
  function presetRange(kind) {
    const t = todayIso();
    switch (kind) {
      case 'today': return { from: t, to: t };
      case 'yesterday': { const y = global.Jalali.addDaysIso(t, -1); return { from: y, to: y }; }
      case 'week': return { from: global.Jalali.startOfJalaliWeek(t), to: t };
      case 'month': { const m = global.Jalali.jalaliMonthRange(t); return { from: m.from, to: t }; }
      case 'lastMonth': {
        const m = global.Jalali.jalaliMonthRange(t);
        const prevEnd = global.Jalali.addDaysIso(m.from, -1);
        const prev = global.Jalali.jalaliMonthRange(prevEnd);
        return { from: prev.from, to: prev.to };
      }
      case 'year': { const y = global.Jalali.jalaliYearRange(t); return { from: y.from, to: t }; }
      case 'all': return { from: '', to: '' };
      default: return { from: t, to: t };
    }
  }

  global.U = { el, els, h, esc, fmt, label, LABELS, call, guard, debounce, parseNumber, toLatinDigits, todayIso, presetRange, state };
}(window));
