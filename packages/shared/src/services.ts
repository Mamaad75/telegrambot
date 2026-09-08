import type { ScoringSignal } from './scoring';

/**
 * Baimar's service catalogue.
 *
 * These are seed *defaults* only — services live in the `Service` table and are fully
 * editable from Settings → Services. Nothing in the engine hard-codes a service key
 * beyond these seeds; the opportunity engine reads its rules from the database.
 */

export interface ServiceRule {
  /** Every signal in this list must be present for the rule to fire. */
  requiresAll?: ScoringSignal[];
  /** At least one of these signals must be present. */
  requiresAny?: ScoringSignal[];
  /** The rule does not fire if any of these signals is present. */
  excludes?: ScoringSignal[];
  /** Priority contribution when the rule fires. */
  points: number;
  /** Shown to the salesperson as the reason this service was recommended. */
  reasonFa: string;
  reasonEn: string;
}

export interface ServiceSeed {
  key: string;
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  /** Ordering hint when several services tie. */
  basePriority: number;
  rules: ServiceRule[];
  salesAnglesFa: string[];
  commonObjectionsFa: string[];
  objectionResponsesFa: string[];
  /** Questions the salesperson should ask on the first call. */
  discoveryQuestionsFa: string[];
}

export const DEFAULT_SERVICES: ServiceSeed[] = [
  {
    key: 'WEBSITE_DESIGN',
    nameFa: 'طراحی وب‌سایت',
    nameEn: 'Website design',
    descriptionFa: 'طراحی وب‌سایت اختصاصی برای کسب‌وکارهایی که هنوز وب‌سایت ندارند.',
    basePriority: 100,
    rules: [
      {
        requiresAny: ['NO_WEBSITE', 'WEBSITE_BROKEN', 'WEBSITE_PARKED', 'SOCIAL_ONLY_PRESENCE'],
        points: 100,
        reasonFa: 'این کسب‌وکار وب‌سایت فعالی ندارد.',
        reasonEn: 'The business has no working website.',
      },
    ],
    salesAnglesFa: [
      'تبدیل مخاطب شبکه‌های اجتماعی به مشتری قابل اندازه‌گیری',
      'دیده‌شدن در جست‌وجوی گوگل هم‌زمان با رقبا',
      'ایجاد مرجع رسمی و قابل استناد برای کسب‌وکار',
    ],
    commonObjectionsFa: [
      'ما فقط با اینستاگرام کار می‌کنیم و نیازی به سایت نداریم.',
      'الان بودجه‌اش را نداریم.',
      'مشتری‌های ما از طریق معرفی می‌آیند.',
    ],
    objectionResponsesFa: [
      'اینستاگرام کانال معرفی خوبی است، اما جست‌وجوی نام کسب‌وکار شما در گوگل به هیچ صفحه رسمی نمی‌رسد؛ همان مخاطب به رقیب می‌رسد.',
      'می‌توانیم با یک صفحه فرود کوچک شروع کنیم و بعد از دیدن نتیجه، توسعه بدهیم.',
      'معرفی شفاهی هم در نهایت به جست‌وجوی نام شما ختم می‌شود؛ نبود صفحه رسمی اعتماد را کم می‌کند.',
    ],
    discoveryQuestionsFa: [
      'در حال حاضر مشتری‌ها چطور با شما تماس می‌گیرند؟',
      'آیا تا حالا برای طراحی سایت اقدام کرده‌اید؟',
      'ماهانه چند درخواست جدید از فضای آنلاین دریافت می‌کنید؟',
    ],
  },
  {
    key: 'WEBSITE_REDESIGN',
    nameFa: 'بازطراحی وب‌سایت',
    nameEn: 'Website redesign',
    descriptionFa: 'بازطراحی وب‌سایت‌های قدیمی با تمرکز بر تجربه کاربری و نرخ تبدیل.',
    basePriority: 90,
    rules: [
      {
        requiresAny: ['OUTDATED_WEBSITE', 'POOR_MOBILE_UX'],
        excludes: ['NO_WEBSITE'],
        points: 90,
        reasonFa: 'وب‌سایت فعلی قدیمی است یا روی موبایل تجربه ضعیفی دارد.',
        reasonEn: 'The current website is outdated or performs poorly on mobile.',
      },
    ],
    salesAnglesFa: [
      'بیش از نیمی از بازدید‌ها از موبایل است؛ سایت فعلی این ترافیک را از دست می‌دهد.',
      'به‌روزرسانی ظاهر سایت هم‌تراز با کیفیت واقعی خدمات شما',
    ],
    commonObjectionsFa: ['ما همین الان سایت داریم.', 'سایت ما تازه ساخته شده.'],
    objectionResponsesFa: [
      'بله، سایت دارید؛ موضوع این است که نسخه موبایل آن قابل استفاده نیست و بیشتر مخاطب شما با موبایل وارد می‌شود.',
      'ممکن است تاریخ ساخت جدید باشد اما ساختار فنی آن قدیمی است؛ گزارش بررسی را برایتان می‌فرستم.',
    ],
    discoveryQuestionsFa: [
      'آخرین بار چه زمانی سایت به‌روزرسانی شد؟',
      'بازدیدکننده‌های موبایل چه بازخوردی داده‌اند؟',
      'از سایت چند تماس یا سرنخ در ماه می‌گیرید؟',
    ],
  },
  {
    key: 'RESPONSIVE_REDESIGN',
    nameFa: 'بهینه‌سازی موبایل',
    nameEn: 'Responsive redesign',
    descriptionFa: 'اصلاح تجربه کاربری موبایل بدون بازسازی کامل سایت.',
    basePriority: 80,
    rules: [
      {
        requiresAll: ['POOR_MOBILE_UX'],
        excludes: ['NO_WEBSITE', 'OUTDATED_WEBSITE'],
        points: 80,
        reasonFa: 'سایت روی موبایل به‌درستی نمایش داده نمی‌شود.',
        reasonEn: 'The site does not render correctly on mobile.',
      },
    ],
    salesAnglesFa: ['اصلاح سریع و کم‌هزینه برای بازگرداندن ترافیک موبایل'],
    commonObjectionsFa: ['روی کامپیوتر که مشکلی ندارد.'],
    objectionResponsesFa: ['درست است، اما بیشتر مخاطب شما با موبایل وارد می‌شود و همان‌جا خارج می‌شود.'],
    discoveryQuestionsFa: ['آیا سایت را روی موبایل خودتان بررسی کرده‌اید؟'],
  },
  {
    key: 'CONVERSION_OPTIMIZATION',
    nameFa: 'بهینه‌سازی نرخ تبدیل',
    nameEn: 'Conversion optimization',
    descriptionFa: 'افزودن مسیر تبدیل روشن، فرم تماس و فراخوان مؤثر.',
    basePriority: 70,
    rules: [
      {
        requiresAny: ['WEAK_CTA', 'NO_CONTACT_FORM'],
        excludes: ['NO_WEBSITE'],
        points: 70,
        reasonFa: 'بازدیدکننده مسیر روشنی برای تماس یا سفارش ندارد.',
        reasonEn: 'Visitors have no clear path to contact or order.',
      },
    ],
    salesAnglesFa: ['ترافیک فعلی را بدون هزینه تبلیغات به تماس تبدیل کنیم.'],
    commonObjectionsFa: ['شماره تماس ما در سایت هست.'],
    objectionResponsesFa: ['شماره هست اما در جای دیده‌نشده؛ بازدیدکننده باید در چند ثانیه اول راه تماس را ببیند.'],
    discoveryQuestionsFa: ['از سایت چند تماس در ماه می‌گیرید؟', 'سرنخ‌های سایت را ثبت می‌کنید؟'],
  },
  {
    key: 'SEO',
    nameFa: 'سئو',
    nameEn: 'SEO',
    descriptionFa: 'بهبود دیده‌شدن در نتایج جست‌وجو برای کلیدواژه‌های تجاری.',
    basePriority: 65,
    rules: [
      {
        requiresAny: ['WEAK_SEO'],
        excludes: ['NO_WEBSITE'],
        points: 65,
        reasonFa: 'ساختار سئوی سایت ضعیف است.',
        reasonEn: 'The site has weak SEO fundamentals.',
      },
    ],
    salesAnglesFa: ['حضور در نتایج جست‌وجوی محلی برای خدمات اصلی شما'],
    commonObjectionsFa: ['سئو زمان‌بر است.', 'ما تبلیغات می‌کنیم.'],
    objectionResponsesFa: [
      'بله زمان‌بر است، به همین دلیل با کلیدواژه‌های محلی کم‌رقابت شروع می‌کنیم که زودتر نتیجه می‌دهد.',
      'تبلیغات با قطع بودجه متوقف می‌شود؛ سئو دارایی ماندگار می‌سازد.',
    ],
    discoveryQuestionsFa: ['برای چه عبارت‌هایی می‌خواهید در گوگل دیده شوید؟'],
  },
  {
    key: 'ECOMMERCE',
    nameFa: 'فروشگاه اینترنتی',
    nameEn: 'E-commerce',
    descriptionFa: 'راه‌اندازی فروشگاه اینترنتی با درگاه پرداخت و مدیریت سفارش.',
    basePriority: 85,
    rules: [
      {
        requiresAny: ['NO_ONLINE_STORE'],
        points: 85,
        reasonFa: 'کسب‌وکار محصول می‌فروشد اما امکان فروش آنلاین ندارد.',
        reasonEn: 'The business sells products but has no online sales capability.',
      },
    ],
    salesAnglesFa: ['فروش خارج از ساعت کاری و خارج از محدوده جغرافیایی فعلی'],
    commonObjectionsFa: ['مشتری ما حضوری خرید می‌کند.', 'ارسال برایمان سخت است.'],
    objectionResponsesFa: [
      'فروشگاه آنلاین جایگزین فروش حضوری نیست؛ سفارش‌های خارج از شهر را اضافه می‌کند.',
      'می‌توانیم با سفارش آنلاین و تحویل حضوری شروع کنیم.',
    ],
    discoveryQuestionsFa: ['الان سفارش‌های خارج از شهر را چطور مدیریت می‌کنید؟'],
  },
  {
    key: 'BOOKING_SYSTEM',
    nameFa: 'سامانه نوبت‌دهی آنلاین',
    nameEn: 'Online booking',
    descriptionFa: 'سیستم رزرو و نوبت‌دهی آنلاین برای کلینیک‌ها و مراکز خدماتی.',
    basePriority: 82,
    rules: [
      {
        requiresAny: ['NO_ONLINE_BOOKING'],
        points: 82,
        reasonFa: 'مراجعه‌کننده امکان رزرو آنلاین ندارد.',
        reasonEn: 'Clients cannot book online.',
      },
    ],
    salesAnglesFa: ['کاهش بار تماس تلفنی و کم‌شدن نوبت‌های از دست رفته'],
    commonObjectionsFa: ['منشی ما نوبت می‌دهد.'],
    objectionResponsesFa: ['نوبت‌دهی آنلاین جای منشی را نمی‌گیرد؛ تماس‌های خارج از ساعت کاری را نجات می‌دهد.'],
    discoveryQuestionsFa: ['روزانه چند تماس فقط برای گرفتن نوبت دارید؟'],
  },
  {
    key: 'BRANDING',
    nameFa: 'برندینگ',
    nameEn: 'Branding',
    descriptionFa: 'هویت بصری، لوگو و یکپارچگی برند در تمام کانال‌ها.',
    basePriority: 50,
    rules: [
      {
        requiresAny: ['WEAK_BRANDING'],
        points: 50,
        reasonFa: 'نشانه‌های هویت بصری منسجم دیده نمی‌شود.',
        reasonEn: 'No consistent brand identity signals were found.',
      },
    ],
    salesAnglesFa: ['هم‌تراز کردن تصویر برند با کیفیت واقعی خدمات'],
    commonObjectionsFa: ['لوگو داریم.'],
    objectionResponsesFa: ['لوگو بخشی از برند است؛ یکپارچگی آن در سایت و شبکه‌های اجتماعی دیده نمی‌شود.'],
    discoveryQuestionsFa: ['هویت بصری فعلی را چه کسی طراحی کرده؟'],
  },
  {
    key: 'LOGO_DESIGN',
    nameFa: 'طراحی لوگو',
    nameEn: 'Logo design',
    descriptionFa: 'طراحی لوگوی اختصاصی.',
    basePriority: 40,
    rules: [
      {
        requiresAll: ['WEAK_BRANDING'],
        requiresAny: ['NO_WEBSITE', 'SOCIAL_ONLY_PRESENCE'],
        points: 40,
        reasonFa: 'کسب‌وکار نشانه هویت بصری مشخصی ندارد.',
        reasonEn: 'The business has no identifiable brand mark.',
      },
    ],
    salesAnglesFa: ['اولین قدم کم‌هزینه برای ساخت تصویر حرفه‌ای'],
    commonObjectionsFa: ['فعلاً اولویت نیست.'],
    objectionResponsesFa: ['درست است؛ می‌توانیم آن را به‌عنوان بخشی از پروژه سایت انجام دهیم.'],
    discoveryQuestionsFa: ['لوگوی فعلی را کجا استفاده می‌کنید؟'],
  },
  {
    key: 'LANDING_PAGE',
    nameFa: 'صفحه فرود',
    nameEn: 'Landing page',
    descriptionFa: 'صفحه فرود تک‌هدفه برای کمپین‌های تبلیغاتی و شبکه‌های اجتماعی.',
    basePriority: 60,
    rules: [
      {
        requiresAll: ['ACTIVE_INSTAGRAM'],
        requiresAny: ['NO_WEBSITE', 'SOCIAL_ONLY_PRESENCE', 'WEAK_CTA'],
        points: 60,
        reasonFa: 'فعالیت اجتماعی وجود دارد اما مقصدی برای تبدیل آن نیست.',
        reasonEn: 'Active social presence with no destination to convert it.',
      },
    ],
    salesAnglesFa: ['تبدیل ترافیک بیو اینستاگرام به تماس و سفارش قابل شمارش'],
    commonObjectionsFa: ['لینک دایرکت کافی است.'],
    objectionResponsesFa: ['دایرکت قابل اندازه‌گیری نیست و در ساعات غیرکاری پاسخ داده نمی‌شود.'],
    discoveryQuestionsFa: ['بازدیدکننده‌های اینستاگرام به کجا هدایت می‌شوند؟'],
  },
  {
    key: 'WEBSITE_RESTRUCTURING',
    nameFa: 'بازساختاردهی وب‌سایت',
    nameEn: 'Website restructuring',
    descriptionFa: 'سازمان‌دهی مجدد صفحات و خدمات برای سایت‌های شلوغ و بی‌ساختار.',
    basePriority: 55,
    rules: [
      {
        requiresAny: ['POOR_CONTENT_STRUCTURE'],
        excludes: ['NO_WEBSITE'],
        points: 55,
        reasonFa: 'خدمات متعدد بدون ساختار صفحه‌بندی مشخص ارائه شده است.',
        reasonEn: 'Many services presented without a clear page structure.',
      },
    ],
    salesAnglesFa: ['هر خدمت صفحه اختصاصی خودش را داشته باشد تا در جست‌وجو دیده شود.'],
    commonObjectionsFa: ['همه چیز در یک صفحه هست.'],
    objectionResponsesFa: ['همان مشکل است؛ گوگل و کاربر نمی‌توانند خدمت مورد نظر را پیدا کنند.'],
    discoveryQuestionsFa: ['کدام خدمت برایتان سودآورتر است؟'],
  },
  {
    key: 'DIGITAL_MARKETING',
    nameFa: 'بازاریابی دیجیتال',
    nameEn: 'Digital marketing',
    descriptionFa: 'مدیریت کمپین‌های تبلیغاتی و رشد کانال‌های دیجیتال.',
    basePriority: 45,
    rules: [
      {
        requiresAll: ['MARKET_DEMAND_MATCH'],
        points: 45,
        reasonFa: 'تقاضای بازار برای خدمات این کسب‌وکار در این شهر بالاست.',
        reasonEn: 'Market demand for this service is strong in this city.',
      },
    ],
    salesAnglesFa: ['تقاضای موجود در بازار را به سمت شما هدایت کنیم.'],
    commonObjectionsFa: ['تبلیغات گران است.'],
    objectionResponsesFa: ['با بودجه کوچک و اندازه‌گیری دقیق شروع می‌کنیم.'],
    discoveryQuestionsFa: ['الان چه کانالی بیشترین مشتری را می‌آورد؟'],
  },
  {
    key: 'MAINTENANCE',
    nameFa: 'پشتیبانی و نگهداری',
    nameEn: 'Maintenance',
    descriptionFa: 'پشتیبانی فنی، به‌روزرسانی و امنیت وب‌سایت.',
    basePriority: 30,
    rules: [
      {
        requiresAny: ['NO_SSL', 'MISSING_BUSINESS_INFO'],
        excludes: ['NO_WEBSITE'],
        points: 30,
        reasonFa: 'سایت مشکلات فنی یا اطلاعاتی دارد که نیاز به نگهداری منظم را نشان می‌دهد.',
        reasonEn: 'Technical or information gaps indicate a lack of ongoing maintenance.',
      },
    ],
    salesAnglesFa: ['جلوگیری از خرابی و از دست رفتن اعتماد کاربر'],
    commonObjectionsFa: ['خودمان مدیریت می‌کنیم.'],
    objectionResponsesFa: ['گواهی امنیتی سایت شما مشکل دارد و مرورگر به کاربر هشدار می‌دهد.'],
    discoveryQuestionsFa: ['چه کسی الان از سایت پشتیبانی می‌کند؟'],
  },
  {
    key: 'AUTOMATION',
    nameFa: 'اتوماسیون کسب‌وکار',
    nameEn: 'Automation',
    descriptionFa: 'اتوماسیون فرایندهای فروش، پشتیبانی و گزارش‌گیری.',
    basePriority: 35,
    rules: [
      {
        requiresAll: ['HIGH_BUSINESS_POTENTIAL'],
        requiresAny: ['NO_ONLINE_BOOKING', 'NO_CONTACT_FORM'],
        points: 35,
        reasonFa: 'حجم کسب‌وکار بالاست اما فرایندها دستی انجام می‌شود.',
        reasonEn: 'Significant business volume handled through manual processes.',
      },
    ],
    salesAnglesFa: ['حذف کارهای تکراری تیم و کاهش خطای انسانی'],
    commonObjectionsFa: ['سیستم فعلی جواب می‌دهد.'],
    objectionResponsesFa: ['هدف جایگزینی نیست؛ حذف کارهای تکراری است.'],
    discoveryQuestionsFa: ['کدام کار روزانه بیشترین وقت تیم را می‌گیرد؟'],
  },
];

/**
 * Category vocabularies used to decide which capability gaps are even relevant.
 *
 * "No online store" is only a sales signal for a business that sells products, and
 * "no online booking" only for one that takes appointments. Firing them indiscriminately
 * is how a lead-scoring engine ends up recommending an e-commerce build to an accountant.
 */
export const PRODUCT_SELLING_HINTS = [
  'فروشگاه', 'پوشاک', 'مبلمان', 'طلا', 'جواهر', 'لوازم', 'کالا', 'محصول', 'تولیدی', 'صنایع',
  'نانوایی', 'شیرینی', 'سوپرمارکت', 'هایپر', 'کتاب', 'گل', 'عطر', 'آرایشی', 'دیجیتال',
  'shop', 'store', 'retail', 'boutique', 'clothing', 'furniture', 'jewelry', 'bakery',
  'manufacturer', 'supermarket', 'market', 'goods', 'products',
];

export const APPOINTMENT_HINTS = [
  'کلینیک', 'مطب', 'دندان', 'زیبایی', 'پزشک', 'درمانگاه', 'سالن', 'آرایشگاه', 'ماساژ',
  'باشگاه', 'آموزشگاه', 'مشاوره', 'وکالت', 'حقوقی', 'دامپزشکی', 'فیزیوتراپی', 'هتل', 'رستوران',
  'clinic', 'dental', 'dentist', 'doctor', 'salon', 'spa', 'gym', 'fitness', 'lawyer',
  'consulting', 'veterinary', 'hotel', 'restaurant', 'school', 'academy', 'travel', 'agency',
];

/** Case-insensitive containment check against a hint vocabulary. */
export function matchesCategoryHints(haystack: string | null | undefined, hints: string[]): boolean {
  if (!haystack) return false;
  const value = haystack.toLowerCase();
  return hints.some((hint) => value.includes(hint.toLowerCase()));
}

/** Look-up helper used by seeds and the UI. */
export function serviceByKey(key: string): ServiceSeed | undefined {
  return DEFAULT_SERVICES.find((s) => s.key === key);
}
