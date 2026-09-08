/**
 * Demo data seeder.
 *
 * Creates 20 clearly-labelled example businesses so the platform can be explored before
 * any real campaign is run.
 *
 * Safety rules this file follows, deliberately:
 *   * every row sets `isDemo = true`, and demo rows are hidden from every production list
 *     unless the viewer explicitly asks for them;
 *   * every business name is prefixed with "[نمونه]" so it cannot be mistaken for a real
 *     lead in a screenshot or an export;
 *   * websites use *.example.com, which RFC 2606 reserves for documentation and which can
 *     never belong to a real business;
 *   * phone numbers are placeholders, and each demo lead carries a pinned note telling the
 *     salesperson not to dial them.
 *
 * Run with: npm run db:demo   (or set DEMO_MODE=true and run the seed)
 */
import 'dotenv/config';
import { businessNameKey, normalizeBusinessName, normalizePhone } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { disconnectRedis } from '../src/lib/redis';
import { computeMarketSignals } from '../src/core/market';
import { recalculateLead } from '../src/services/scoring-service';
import { seedServices } from '../src/bootstrap';
import { storeKeywordObservations, storeSearchTerms } from '../src/services/market-service';

const DEMO_PREFIX = '[نمونه]';
const DEMO_NOTE = 'این یک رکورد نمونه (DEMO) است. با این شماره تماس نگیرید و آن را با داده واقعی اشتباه نگیرید.';

interface DemoLead {
  name: string;
  category: string;
  city: string;
  province: string;
  phone?: string;
  website?: string;
  websiteStatus: Prisma.LeadCreateInput['websiteStatus'];
  instagram?: string;
  telegram?: string;
  reviewCount?: number;
  reviewRating?: number;
  services?: string[];
  products?: string[];
  address?: string;
  description?: string;
  contactStatus: Prisma.LeadCreateInput['contactStatus'];
  /** Simulated audit result, used to make the demo scores realistic. */
  audit?: {
    reachable: boolean;
    seo: number | null;
    mobile: number | null;
    performance: number | null;
    ux: number | null;
    conversion: number | null;
    technical: number | null;
    hasSsl: boolean;
    hasViewport: boolean;
    hasContactForm: boolean;
    hasEcommerce: boolean;
    hasBooking: boolean;
    hasAnalytics: boolean;
    hasLogo: boolean;
    legacy: string[];
    technologies: Array<{ name: string; category: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; evidence: string }>;
  };
}

const DEMO_LEADS: DemoLead[] = [
  {
    name: 'کلینیک زیبایی آرمان',
    category: 'کلینیک زیبایی',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0001',
    websiteStatus: 'NO_WEBSITE',
    instagram: 'https://instagram.com/example_beauty_demo',
    reviewCount: 184,
    reviewRating: 4.6,
    services: ['لیزر موهای زائد', 'تزریق ژل', 'میکرونیدلینگ', 'پاکسازی پوست'],
    address: 'اراک، خیابان نمونه، پلاک ۱',
    description: 'کلینیک زیبایی با فعالیت پررنگ در اینستاگرام و بدون وب‌سایت.',
    contactStatus: 'READY_TO_CALL',
  },
  {
    name: 'دندانپزشکی مهر',
    category: 'کلینیک دندانپزشکی',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0002',
    website: 'https://dental-demo.example.com',
    websiteStatus: 'ACTIVE',
    reviewCount: 96,
    reviewRating: 4.3,
    services: ['ایمپلنت', 'ارتودنسی', 'لمینت'],
    contactStatus: 'NEW',
    audit: {
      reachable: true,
      seo: 44,
      mobile: 38,
      performance: 51,
      ux: 47,
      conversion: 32,
      technical: 62,
      hasSsl: true,
      hasViewport: false,
      hasContactForm: false,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: false,
      hasLogo: true,
      legacy: ['Legacy DOCTYPE (XHTML/HTML4)', 'jQuery 1.11 (end of life)'],
      technologies: [{ name: 'WordPress', category: 'CMS', confidence: 'HIGH', evidence: 'markup matched /wp-content/' }],
    },
  },
  {
    name: 'فروشگاه پوشاک ونداد',
    category: 'پوشاک',
    city: 'اراک',
    province: 'مرکزی',
    phone: '0912-000-0003',
    website: 'https://clothing-demo.example.com',
    websiteStatus: 'ACTIVE',
    instagram: 'https://instagram.com/example_clothing_demo',
    reviewCount: 41,
    reviewRating: 4.1,
    products: ['مانتو', 'شلوار', 'کیف', 'کفش'],
    contactStatus: 'NEW',
    audit: {
      reachable: true,
      seo: 55,
      mobile: 71,
      performance: 60,
      ux: 64,
      conversion: 38,
      technical: 70,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: true,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: false,
      hasLogo: true,
      legacy: [],
      technologies: [{ name: 'WordPress', category: 'CMS', confidence: 'HIGH', evidence: 'markup matched /wp-content/' }],
    },
  },
  {
    name: 'رستوران باغ ایرانی',
    category: 'رستوران',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0004',
    websiteStatus: 'NO_WEBSITE',
    instagram: 'https://instagram.com/example_restaurant_demo',
    reviewCount: 312,
    reviewRating: 4.4,
    services: ['سالن پذیرایی', 'بیرون‌بر', 'رزرو مراسم'],
    contactStatus: 'CONTACTED',
  },
  {
    name: 'صنایع فلزی پارسیان',
    category: 'تولیدی و صنعتی',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0005',
    website: 'https://industry-demo.example.com',
    websiteStatus: 'ACTIVE',
    services: ['قطعات صنعتی', 'قالب‌سازی', 'CNC'],
    contactStatus: 'INTERESTED',
    audit: {
      reachable: true,
      seo: 31,
      mobile: 22,
      performance: 44,
      ux: 35,
      conversion: 25,
      technical: 40,
      hasSsl: false,
      hasViewport: false,
      hasContactForm: false,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: false,
      hasLogo: false,
      legacy: ['Uses <font> tags', 'table layout attributes', 'Legacy DOCTYPE (XHTML/HTML4)'],
      technologies: [{ name: 'Apache', category: 'Web server', confidence: 'HIGH', evidence: 'header "server: apache"' }],
    },
  },
  {
    name: 'آموزشگاه زبان راه نو',
    category: 'آموزشگاه',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0006',
    website: 'https://language-demo.example.com',
    websiteStatus: 'ACTIVE',
    telegram: 'https://t.me/example_school_demo',
    reviewCount: 58,
    reviewRating: 4.7,
    services: ['انگلیسی', 'آلمانی', 'آیلتس', 'کلاس آنلاین'],
    contactStatus: 'MEETING',
    audit: {
      reachable: true,
      seo: 72,
      mobile: 78,
      performance: 69,
      ux: 74,
      conversion: 55,
      technical: 80,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: true,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: true,
      hasLogo: true,
      legacy: [],
      technologies: [{ name: 'Next.js', category: 'Framework', confidence: 'HIGH', evidence: 'markup matched __NEXT_DATA__' }],
    },
  },
  {
    name: 'مبلمان شهر',
    category: 'مبلمان',
    city: 'اراک',
    province: 'مرکزی',
    phone: '0912-000-0007',
    websiteStatus: 'NO_WEBSITE',
    instagram: 'https://instagram.com/example_furniture_demo',
    reviewCount: 27,
    reviewRating: 3.9,
    products: ['مبل راحتی', 'سرویس خواب', 'میز ناهارخوری'],
    contactStatus: 'READY_TO_CALL',
  },
  {
    name: 'املاک آسمان',
    category: 'املاک',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0008',
    website: 'https://realestate-demo.example.com',
    websiteStatus: 'PARKED',
    contactStatus: 'NEW',
    audit: {
      reachable: true,
      seo: 12,
      mobile: 40,
      performance: 85,
      ux: 18,
      conversion: 10,
      technical: 55,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: false,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: false,
      hasLogo: false,
      legacy: [],
      technologies: [],
    },
  },
  {
    name: 'باشگاه بدنسازی اوج',
    category: 'باشگاه ورزشی',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0009',
    websiteStatus: 'NO_WEBSITE',
    instagram: 'https://instagram.com/example_gym_demo',
    reviewCount: 73,
    reviewRating: 4.2,
    services: ['بدنسازی', 'کراسفیت', 'مربی خصوصی'],
    contactStatus: 'CALLBACK',
  },
  {
    name: 'داروخانه دکتر نمونه',
    category: 'داروخانه',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0010',
    website: 'https://pharmacy-demo.example.com',
    websiteStatus: 'BROKEN',
    reviewCount: 15,
    contactStatus: 'NEW',
    audit: {
      reachable: false,
      seo: null,
      mobile: null,
      performance: null,
      ux: null,
      conversion: null,
      technical: null,
      hasSsl: false,
      hasViewport: false,
      hasContactForm: false,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: false,
      hasLogo: false,
      legacy: [],
      technologies: [],
    },
  },
  {
    name: 'کافه گالری هنر',
    category: 'کافه',
    city: 'تهران',
    province: 'تهران',
    phone: '021-8888-0011',
    websiteStatus: 'SOCIAL_ONLY',
    instagram: 'https://instagram.com/example_cafe_demo',
    reviewCount: 421,
    reviewRating: 4.8,
    contactStatus: 'NEW',
  },
  {
    name: 'کلینیک پوست و مو رویا',
    category: 'کلینیک زیبایی',
    city: 'تهران',
    province: 'تهران',
    phone: '021-8888-0012',
    website: 'https://skin-demo.example.com',
    websiteStatus: 'ACTIVE',
    instagram: 'https://instagram.com/example_skin_demo',
    reviewCount: 640,
    reviewRating: 4.5,
    services: ['لیزر', 'مزوتراپی', 'کاشت مو', 'بوتاکس', 'هایفو', 'فیشیال'],
    contactStatus: 'PROPOSAL',
    audit: {
      reachable: true,
      seo: 58,
      mobile: 49,
      performance: 47,
      ux: 52,
      conversion: 40,
      technical: 66,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: true,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: true,
      hasLogo: true,
      legacy: [],
      technologies: [
        { name: 'WordPress', category: 'CMS', confidence: 'HIGH', evidence: 'markup matched /wp-content/' },
        { name: 'Elementor', category: 'Page builder', confidence: 'HIGH', evidence: 'markup matched elementor-page' },
      ],
    },
  },
  {
    name: 'گالری طلای درخشان',
    category: 'طلا و جواهر',
    city: 'اصفهان',
    province: 'اصفهان',
    phone: '031-7777-0013',
    websiteStatus: 'NO_WEBSITE',
    instagram: 'https://instagram.com/example_gold_demo',
    reviewCount: 88,
    reviewRating: 4.6,
    products: ['انگشتر', 'دستبند', 'سرویس طلا'],
    contactStatus: 'NEW',
  },
  {
    name: 'شرکت حسابداری اعتماد',
    category: 'خدمات تخصصی',
    city: 'مشهد',
    province: 'خراسان رضوی',
    phone: '051-6666-0014',
    website: 'https://accounting-demo.example.com',
    websiteStatus: 'ACTIVE',
    services: ['حسابداری', 'مالیات', 'حقوق و دستمزد', 'مشاوره مالی', 'اظهارنامه'],
    contactStatus: 'NEW',
    audit: {
      reachable: true,
      seo: 61,
      mobile: 66,
      performance: 58,
      ux: 60,
      conversion: 44,
      technical: 72,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: false,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: false,
      hasLogo: true,
      legacy: [],
      technologies: [{ name: 'Bootstrap', category: 'CSS framework', confidence: 'MEDIUM', evidence: 'markup matched bootstrap.min.css' }],
    },
  },
  {
    name: 'هتل آپارتمان سپید',
    category: 'هتل و اقامتگاه',
    city: 'شیراز',
    province: 'فارس',
    phone: '071-5555-0015',
    website: 'https://hotel-demo.example.com',
    websiteStatus: 'ACTIVE',
    reviewCount: 205,
    reviewRating: 4.0,
    contactStatus: 'NEGOTIATION',
    audit: {
      reachable: true,
      seo: 66,
      mobile: 74,
      performance: 63,
      ux: 70,
      conversion: 48,
      technical: 76,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: true,
      hasEcommerce: false,
      hasBooking: false,
      hasAnalytics: true,
      hasLogo: true,
      legacy: [],
      technologies: [{ name: 'React', category: 'JS library', confidence: 'MEDIUM', evidence: 'markup matched data-reactroot' }],
    },
  },
  {
    name: 'تعمیرگاه خودرو سریع',
    category: 'خودرو',
    city: 'تبریز',
    province: 'آذربایجان شرقی',
    phone: '041-4444-0016',
    websiteStatus: 'NO_WEBSITE',
    reviewCount: 34,
    reviewRating: 4.1,
    contactStatus: 'NOT_INTERESTED',
  },
  {
    name: 'شیرینی‌سرای گل',
    category: 'نانوایی و شیرینی',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0017',
    websiteStatus: 'NO_WEBSITE',
    instagram: 'https://instagram.com/example_pastry_demo',
    reviewCount: 152,
    reviewRating: 4.7,
    products: ['شیرینی تر', 'کیک سفارشی', 'شکلات'],
    contactStatus: 'WON',
  },
  {
    name: 'دامپزشکی مهربان',
    category: 'دامپزشکی',
    city: 'کرج',
    province: 'البرز',
    phone: '026-9999-0018',
    website: 'https://vet-demo.example.com',
    websiteStatus: 'NOT_VERIFIED',
    reviewCount: 22,
    reviewRating: 4.4,
    contactStatus: 'NEW',
  },
  {
    name: 'آژانس مسافرتی راه ابریشم',
    category: 'آژانس مسافرتی',
    city: 'اصفهان',
    province: 'اصفهان',
    phone: '031-7777-0019',
    website: 'https://travel-demo.example.com',
    websiteStatus: 'ACTIVE',
    telegram: 'https://t.me/example_travel_demo',
    reviewCount: 118,
    reviewRating: 4.2,
    services: ['تور داخلی', 'تور خارجی', 'بلیت هواپیما', 'ویزا'],
    contactStatus: 'LOST',
    audit: {
      reachable: true,
      seo: 69,
      mobile: 81,
      performance: 72,
      ux: 78,
      conversion: 76,
      technical: 84,
      hasSsl: true,
      hasViewport: true,
      hasContactForm: true,
      hasEcommerce: true,
      hasBooking: true,
      hasAnalytics: true,
      hasLogo: true,
      legacy: [],
      technologies: [{ name: 'Next.js', category: 'Framework', confidence: 'HIGH', evidence: 'markup matched /_next/static/' }],
    },
  },
  {
    name: 'سوپرمارکت خانواده',
    category: 'فروشگاه',
    city: 'اراک',
    province: 'مرکزی',
    phone: '086-3333-0020',
    websiteStatus: 'NO_WEBSITE',
    reviewCount: 9,
    reviewRating: 3.8,
    products: ['مواد غذایی', 'لبنیات'],
    contactStatus: 'NEW',
  },
];

/** Demo keyword data, so the market dashboard has something to show in demo mode. */
const DEMO_KEYWORDS = [
  { keyword: 'طراحی سایت اراک', impressions: 4210, clicks: 186, conversions: 7, volume: 720 },
  { keyword: 'طراحی سایت شرکتی', impressions: 3180, clicks: 121, conversions: 4, volume: 590 },
  { keyword: 'فروشگاه اینترنتی راه اندازی', impressions: 2890, clicks: 143, conversions: 6, volume: 880 },
  { keyword: 'سئو سایت اراک', impressions: 1450, clicks: 61, conversions: 2, volume: 260 },
  { keyword: 'طراحی لوگو حرفه ای', impressions: 1120, clicks: 44, conversions: 1, volume: 340 },
  { keyword: 'نوبت دهی آنلاین کلینیک', impressions: 980, clicks: 52, conversions: 3, volume: 210 },
  { keyword: 'برندینگ کسب و کار', impressions: 640, clicks: 19, conversions: 0, volume: 150 },
  { keyword: 'لندینگ پیج اینستاگرام', impressions: 520, clicks: 33, conversions: 2, volume: 190 },
  { keyword: 'بازطراحی سایت قدیمی', impressions: 410, clicks: 21, conversions: 1, volume: 110 },
  { keyword: 'پشتیبانی سایت وردپرس', impressions: 380, clicks: 15, conversions: 1, volume: 130 },
];

async function main() {
  console.log('Seeding DEMO data — every row is flagged isDemo and prefixed with "[نمونه]".\n');

  await seedServices();

  const existing = await prisma.lead.count({ where: { isDemo: true } });
  if (existing > 0) {
    console.log(`• ${existing} demo leads already exist. Removing them first so the seed stays idempotent.`);
    await prisma.lead.deleteMany({ where: { isDemo: true } });
    await prisma.campaign.deleteMany({ where: { isDemo: true } });
    await prisma.keyword.deleteMany({ where: { isDemo: true } });
    await prisma.searchTerm.deleteMany({ where: { isDemo: true } });
    await prisma.marketSignal.deleteMany({ where: { isDemo: true } });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: `${DEMO_PREFIX} فرصت‌های وب‌سایت اراک`,
      description: 'کمپین نمونه برای آشنایی با محصول. هیچ داده واقعی در این کمپین وجود ندارد.',
      status: 'COMPLETED',
      city: 'اراک',
      province: 'مرکزی',
      categories: ['کلینیک زیبایی', 'رستوران', 'فروشگاه', 'تولیدی و صنعتی'],
      providers: ['osm_overpass'],
      websiteFilter: 'ANY',
      minLeadScore: 60,
      maxResults: 200,
      enableAi: false,
      isDemo: true,
      lastRunAt: new Date(),
    },
  });

  const run = await prisma.campaignRun.create({
    data: {
      campaignId: campaign.id,
      status: 'COMPLETED',
      stage: 'READY_TO_CALL',
      progress: 100,
      collected: 26,
      unique: DEMO_LEADS.length,
      merged: 6,
      startedAt: new Date(Date.now() - 3600_000),
      finishedAt: new Date(Date.now() - 3400_000),
      log: [
        { at: new Date().toISOString(), stage: 'DISCOVERY', message: 'داده نمونه — اجرای واقعی انجام نشده است', level: 'info' },
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  const salesUser = await prisma.user.findFirst({ where: { role: { in: ['SALESPERSON', 'SALES_MANAGER'] } } });

  let created = 0;
  for (const demo of DEMO_LEADS) {
    const name = `${DEMO_PREFIX} ${demo.name}`;
    const phone = demo.phone ? normalizePhone(demo.phone) : null;

    const lead = await prisma.lead.create({
      data: {
        businessName: name,
        normalizedBusinessName: normalizeBusinessName(name),
        nameKey: businessNameKey(name),
        category: demo.category,
        city: demo.city,
        province: demo.province,
        country: 'IR',
        address: demo.address ?? null,
        originalPhone: demo.phone ?? null,
        normalizedPhone: phone?.valid ? phone.e164 : null,
        mobile: phone?.kind === 'MOBILE' ? phone.e164 : null,
        website: demo.website ?? null,
        websiteDomain: demo.website ? new URL(demo.website).hostname : null,
        websiteStatus: demo.websiteStatus,
        instagramUrl: demo.instagram ?? null,
        telegramUrl: demo.telegram ?? null,
        description: demo.description ?? null,
        services: demo.services ?? [],
        products: demo.products ?? [],
        reviewCount: demo.reviewCount ?? null,
        reviewRating: demo.reviewRating ?? null,
        contactStatus: demo.contactStatus,
        assignedToId: salesUser?.id ?? null,
        campaignId: campaign.id,
        isDemo: true,
      },
    });

    await prisma.leadSourceReference.create({
      data: {
        leadId: lead.id,
        providerKey: 'manual',
        externalId: `demo-${created}`,
        sourceUrl: null,
        fields: ['businessName', 'phone', 'city', 'category'],
        origin: 'MANUAL_ENTRY',
        confidence: 'UNKNOWN',
        raw: { note: 'DEMO record — not sourced from any real provider' },
      },
    });

    await prisma.note.create({
      data: { leadId: lead.id, body: DEMO_NOTE, isPinned: true },
    });

    if (demo.instagram) {
      await prisma.socialSignal.create({
        data: {
          leadId: lead.id,
          platform: 'instagram',
          url: demo.instagram,
          isActive: true,
          confidence: 'UNKNOWN',
          source: 'DEMO data',
        },
      });
    }

    if (demo.audit) {
      const a = demo.audit;
      const scores = [a.seo, a.mobile, a.performance, a.ux, a.conversion, a.technical].filter(
        (v): v is number => typeof v === 'number',
      );
      await prisma.websiteAudit.create({
        data: {
          leadId: lead.id,
          url: demo.website ?? 'https://demo.example.com',
          finalUrl: demo.website ?? null,
          reachable: a.reachable,
          httpStatus: a.reachable ? 200 : null,
          raw: {
            demo: true,
            note: 'Simulated audit for demonstration only. No website was crawled.',
            legacySignals: a.legacy,
          } as unknown as Prisma.InputJsonValue,
          seoScore: a.seo,
          mobileScore: a.mobile,
          performanceScore: a.performance,
          uxScore: a.ux,
          conversionScore: a.conversion,
          technicalScore: a.technical,
          overallScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
          unavailable: ['lighthouse-core-web-vitals', 'real-user-performance', 'demo-simulated-audit'],
          findings: buildDemoFindings(a) as unknown as Prisma.InputJsonValue,
          technologies: a.technologies as unknown as Prisma.InputJsonValue,
          pagesCrawled: a.reachable ? 5 : 0,
          hasSsl: a.hasSsl,
          hasViewport: a.hasViewport,
          hasContactForm: a.hasContactForm,
          hasContactPage: a.hasContactForm,
          hasAboutPage: a.reachable,
          hasEcommerce: a.hasEcommerce,
          hasBooking: a.hasBooking,
          hasAnalytics: a.hasAnalytics,
          hasLogo: a.hasLogo,
          hasFavicon: a.hasLogo,
          hasSitemap: a.reachable && a.seo !== null && a.seo > 50,
          hasRobots: a.reachable,
          hasStructuredData: a.reachable && a.seo !== null && a.seo > 60,
          error: a.reachable ? null : 'DEMO: simulated unreachable website',
        },
      });
    }

    // Run the real scoring pipeline over the demo rows so the numbers are produced by the
    // same engine that scores production leads.
    await recalculateLead(lead.id);
    created++;
  }

  // A couple of demo CRM records so the pipeline views are not empty.
  const wonLead = await prisma.lead.findFirst({ where: { isDemo: true, contactStatus: 'WON' } });
  if (wonLead) {
    await prisma.call.create({
      data: { leadId: wonLead.id, outcome: 'MEETING_SET', durationSeconds: 240, notes: 'DEMO: جلسه حضوری هماهنگ شد.' },
    });
    await prisma.lead.update({ where: { id: wonLead.id }, data: { wonAt: new Date(), lastContactAt: new Date() } });
  }
  const callbackLead = await prisma.lead.findFirst({ where: { isDemo: true, contactStatus: 'CALLBACK' } });
  if (callbackLead) {
    await prisma.followUp.create({
      data: {
        leadId: callbackLead.id,
        kind: 'تماس مجدد',
        dueAt: new Date(Date.now() + 24 * 3600 * 1000),
        notes: 'DEMO: مشتری خواست فردا تماس بگیریم.',
      },
    });
    await prisma.lead.update({ where: { id: callbackLead.id }, data: { nextFollowUpAt: new Date(Date.now() + 24 * 3600 * 1000) } });
  }

  // Demo market data, flagged so it can never contaminate the real demand picture.
  const now = new Date();
  const periodStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  await storeKeywordObservations(
    DEMO_KEYWORDS.map((k) => ({
      keyword: k.keyword,
      source: 'MANUAL_IMPORT' as const,
      origin: 'AGGREGATE_SEARCH_SIGNAL' as const,
      language: 'fa',
      city: 'اراک',
      country: 'IR',
      searchVolume: k.volume,
      competition: 'MEDIUM',
      impressions: k.impressions,
      clicks: k.clicks,
      conversions: k.conversions,
      periodStart,
      periodEnd: now,
      date: now,
    })),
    { isDemo: true },
  );

  await storeSearchTerms(
    DEMO_KEYWORDS.slice(0, 6).map((k) => ({
      term: k.keyword,
      keyword: k.keyword,
      source: 'GOOGLE_ADS' as const,
      origin: 'ADVERTISING_CAMPAIGN' as const,
      campaignName: '[نمونه] کمپین طراحی سایت',
      city: 'اراک',
      country: 'IR',
      impressions: k.impressions,
      clicks: k.clicks,
      conversions: k.conversions,
      costMicros: k.clicks * 15000,
      periodStart,
      periodEnd: now,
      date: now,
    })),
    { isDemo: true },
  );

  // Fill in the run's temperature counters from the leads that were actually scored, so
  // the campaign card cannot show "12 qualified, 0 hot" and look broken.
  const temperatures = await prisma.lead.groupBy({
    by: ['leadTemperature'],
    where: { campaignId: campaign.id },
    _count: true,
  });
  const countFor = (t: string) => temperatures.find((row) => row.leadTemperature === t)?._count ?? 0;
  const qualified = await prisma.lead.count({
    where: { campaignId: campaign.id, leadScore: { gte: campaign.minLeadScore ?? 0 } },
  });

  await prisma.campaignRun.update({
    where: { id: run.id },
    data: {
      hot: countFor('HOT'),
      warm: countFor('WARM'),
      medium: countFor('MEDIUM'),
      low: countFor('LOW'),
      qualified,
      rejected: Math.max(0, DEMO_LEADS.length - qualified),
    },
  });

  const signals = await computeMarketSignals({ city: 'اراک', includeDemo: true });

  console.log(`✓ demo campaign: ${campaign.name}`);
  console.log(`✓ demo leads created: ${created}`);
  console.log(`✓ demo keywords: ${DEMO_KEYWORDS.length}, demo market signals: ${signals.length}`);
  console.log('\nDemo rows are hidden from production lists by default.');
  console.log('Enable "نمایش داده نمونه" in Settings → General, or pass includeDemo=true, to see them.');
  console.log('Remove them at any time with: npx tsx prisma/demo.ts --clean');
}

function buildDemoFindings(a: NonNullable<DemoLead['audit']>) {
  const findings: Array<{ code: string; area: string; severity: string; titleFa: string; titleEn: string; evidence: string; confidence: string }> = [];
  const push = (code: string, area: string, severity: string, titleFa: string, titleEn: string, evidence: string) =>
    findings.push({ code, area, severity, titleFa, titleEn, evidence, confidence: 'FACT' });

  if (!a.reachable) push('tech.http_status', 'TECHNICAL', 'HIGH', 'وب‌سایت در دسترس نیست', 'Website unreachable', 'DEMO: simulated timeout');
  if (!a.hasSsl) push('tech.https', 'TECHNICAL', 'HIGH', 'گواهی امنیتی (HTTPS) ندارد', 'No HTTPS', 'DEMO: simulated observation');
  if (!a.hasViewport) push('mobile.viewport', 'MOBILE', 'HIGH', 'صفحه برای موبایل طراحی نشده است', 'Not mobile-ready', 'DEMO: no viewport meta tag');
  if (!a.hasContactForm) push('conv.contact_form', 'CONVERSION', 'MEDIUM', 'فرم تماس ندارد', 'No contact form', 'DEMO: simulated observation');
  if (!a.hasBooking) push('conv.online_booking', 'CONVERSION', 'HIGH', 'امکان رزرو آنلاین ندارد', 'No online booking', 'DEMO: simulated observation');
  if (!a.hasEcommerce) push('conv.online_store', 'CONVERSION', 'MEDIUM', 'امکان فروش آنلاین ندارد', 'No online store', 'DEMO: simulated observation');
  if (!a.hasAnalytics) push('conv.analytics', 'CONVERSION', 'MEDIUM', 'ابزار تحلیل ترافیک نصب نیست', 'No analytics', 'DEMO: simulated observation');
  if (a.legacy.length) push('ux.modern_markup', 'UX', 'HIGH', 'ساختار سایت قدیمی است', 'Outdated construction', `DEMO: ${a.legacy.join('; ')}`);
  return findings;
}

async function clean() {
  const leads = await prisma.lead.deleteMany({ where: { isDemo: true } });
  const campaigns = await prisma.campaign.deleteMany({ where: { isDemo: true } });
  const keywords = await prisma.keyword.deleteMany({ where: { isDemo: true } });
  const terms = await prisma.searchTerm.deleteMany({ where: { isDemo: true } });
  const signals = await prisma.marketSignal.deleteMany({ where: { isDemo: true } });
  console.log(
    `Removed demo data — leads: ${leads.count}, campaigns: ${campaigns.count}, keywords: ${keywords.count}, search terms: ${terms.count}, market signals: ${signals.count}`,
  );
}

const task = process.argv.includes('--clean') ? clean() : main();

task
  .catch((err) => {
    console.error('demo seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    // Both the database client and the Redis client hold the event loop open.
    await prisma.$disconnect();
    await disconnectRedis();
  });
