/*
 * ثابت‌های مشترک: کدینگ حساب‌ها، روش‌های پرداخت، وضعیت چک‌ها و برچسب‌های فارسی
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Const = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** کدینگ حساب‌ها (کل) */
  const ACC = {
    CASH: '101',            // صندوق
    POS: '102',             // کارتخوان
    BANK: '103',            // بانک
    CHECKS_RECEIVABLE: '104', // اسناد دریافتنی (چک‌های دریافتی)
    RECEIVABLE: '105',      // حساب‌های دریافتنی (بدهکاران / مشتریان)
    INVENTORY: '106',       // موجودی کالا
    PAYABLE: '201',         // حساب‌های پرداختنی (بستانکاران / تأمین‌کنندگان)
    VAT_PAYABLE: '202',     // مالیات بر ارزش افزوده پرداختنی
    CHECKS_PAYABLE: '203',  // اسناد پرداختنی (چک‌های صادره)
    EQUITY: '301',          // سرمایه مالک
    SALES: '401',           // فروش
    OTHER_INCOME: '402',    // درآمد متفرقه
    PURCHASES: '501',       // خرید (در روش دائمی استفاده نمی‌شود)
    OPERATING_EXPENSE: '502', // هزینه‌های عملیاتی
    COGS: '503'             // بهای تمام‌شده کالای فروش‌رفته
  };

  /** چارت حساب‌های پیش‌فرض */
  const CHART = [
    { code: ACC.CASH, name: 'صندوق', type: 'asset', normal_side: 'debit', sort_order: 10 },
    { code: ACC.POS, name: 'کارتخوان (POS)', type: 'asset', normal_side: 'debit', sort_order: 20 },
    { code: ACC.BANK, name: 'بانک', type: 'asset', normal_side: 'debit', sort_order: 30 },
    { code: ACC.CHECKS_RECEIVABLE, name: 'اسناد دریافتنی (چک‌های دریافتی)', type: 'asset', normal_side: 'debit', sort_order: 40 },
    { code: ACC.RECEIVABLE, name: 'حساب‌های دریافتنی (مشتریان)', type: 'asset', normal_side: 'debit', sort_order: 50 },
    { code: ACC.INVENTORY, name: 'موجودی کالا', type: 'asset', normal_side: 'debit', sort_order: 60 },
    { code: ACC.PAYABLE, name: 'حساب‌های پرداختنی (تأمین‌کنندگان)', type: 'liability', normal_side: 'credit', sort_order: 110 },
    { code: ACC.VAT_PAYABLE, name: 'مالیات بر ارزش افزوده', type: 'liability', normal_side: 'credit', sort_order: 120 },
    { code: ACC.CHECKS_PAYABLE, name: 'اسناد پرداختنی (چک‌های صادره)', type: 'liability', normal_side: 'credit', sort_order: 130 },
    { code: ACC.EQUITY, name: 'سرمایه مالک', type: 'equity', normal_side: 'credit', sort_order: 210 },
    { code: ACC.SALES, name: 'فروش', type: 'income', normal_side: 'credit', sort_order: 310 },
    { code: ACC.OTHER_INCOME, name: 'درآمد متفرقه', type: 'income', normal_side: 'credit', sort_order: 320 },
    { code: ACC.PURCHASES, name: 'خرید کالا', type: 'expense', normal_side: 'debit', sort_order: 410 },
    { code: ACC.OPERATING_EXPENSE, name: 'هزینه‌های عملیاتی', type: 'expense', normal_side: 'debit', sort_order: 420 },
    { code: ACC.COGS, name: 'بهای تمام‌شده کالای فروش‌رفته', type: 'expense', normal_side: 'debit', sort_order: 430 }
  ];

  /** روش‌های پرداخت */
  const PAY_METHODS = [
    { key: 'cash', label: 'نقدی', account: ACC.CASH, needsBank: false },
    { key: 'pos', label: 'کارتخوان', account: ACC.POS, needsBank: true },
    { key: 'bank', label: 'واریز/انتقال بانکی', account: ACC.BANK, needsBank: true },
    { key: 'card', label: 'کارت به کارت', account: ACC.BANK, needsBank: true },
    { key: 'check', label: 'چک', account: null, needsBank: false }
  ];

  const PAY_METHOD_LABEL = PAY_METHODS.reduce(function (a, m) { a[m.key] = m.label; return a; }, {});
  PAY_METHOD_LABEL.credit = 'نسیه';
  PAY_METHOD_LABEL.mixed = 'ترکیبی';

  /** وضعیت چک */
  const CHECK_STATUS = {
    pending: 'در جریان (نزد ما)',
    deposited: 'واگذار شده به بانک',
    cleared: 'وصول شده',
    returned: 'برگشتی',
    paid: 'پرداخت شده',
    cancelled: 'ابطال شده'
  };

  /** وضعیت‌های مجاز بر اساس نوع چک */
  const CHECK_STATUS_FLOW = {
    received: ['pending', 'deposited', 'cleared', 'returned', 'cancelled'],
    issued: ['pending', 'paid', 'returned', 'cancelled']
  };

  const CHECK_DIRECTION = { received: 'دریافتی', issued: 'صادره (پرداختی)' };

  const MOVE_TYPES = {
    opening: 'موجودی اولیه',
    purchase: 'خرید',
    sale: 'فروش',
    sale_return: 'برگشت از فروش',
    purchase_return: 'برگشت از خرید',
    adjust_in: 'اصلاح - افزایش',
    adjust_out: 'اصلاح - کاهش',
    count: 'انبارگردانی'
  };

  const DEFAULT_EXPENSE_CATEGORIES = ['اجاره', 'برق', 'آب', 'گاز', 'اینترنت و تلفن', 'حقوق و دستمزد',
    'حمل و نقل', 'تعمیرات', 'ملزومات مصرفی', 'تبلیغات', 'مالیات و عوارض', 'متفرقه'];

  const DEFAULT_INCOME_CATEGORIES = ['درآمد خدمات', 'اجاره دریافتی', 'سود بانکی', 'درآمد متفرقه'];

  const DEFAULT_SETTINGS = {
    shop_name: 'فروشگاه من',
    shop_phone: '',
    shop_address: '',
    shop_logo: '',
    economic_code: '',
    currency: 'تومان',
    vat_rate: '10',
    purchase_vat_mode: 'reclaim',
    allow_negative_stock: '0',
    default_payment_method: 'cash',
    sale_prefix: 'F',
    purchase_prefix: 'P',
    sale_return_prefix: 'RS',
    purchase_return_prefix: 'RP',
    receipt_prefix: 'RC',
    payment_prefix: 'PY',
    expense_prefix: 'EX',
    income_prefix: 'IN',
    transfer_prefix: 'TR',
    number_padding: '5',
    print_size: 'a4',
    auto_backup: '1',
    auto_backup_days: '1',
    backup_dir: '',
    backup_keep: '30',
    check_reminder_days: '7',
    setup_done: '0'
  };

  return {
    ACC: ACC,
    CHART: CHART,
    PAY_METHODS: PAY_METHODS,
    PAY_METHOD_LABEL: PAY_METHOD_LABEL,
    CHECK_STATUS: CHECK_STATUS,
    CHECK_STATUS_FLOW: CHECK_STATUS_FLOW,
    CHECK_DIRECTION: CHECK_DIRECTION,
    MOVE_TYPES: MOVE_TYPES,
    DEFAULT_EXPENSE_CATEGORIES: DEFAULT_EXPENSE_CATEGORIES,
    DEFAULT_INCOME_CATEGORIES: DEFAULT_INCOME_CATEGORIES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
});
