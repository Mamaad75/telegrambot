import {
  BUSINESS_VALUE_LABELS,
  TEMPERATURE_LABELS,
  normalizeText,
  toPersianDigits,
  type SalesBriefContent,
} from '@baimar/shared';
import type { AIAnalysis, Lead, Service, WebsiteAudit } from '@prisma/client';
import type { BusinessValueResult } from './business-value';
import type { ServiceMatch } from './opportunity';
import type { ScoreResult } from './scoring';
import type { SignalMap } from './signals';

/**
 * Sales brief generation.
 *
 * The brief is what a salesperson reads in the 30–60 seconds before dialling. Two hard
 * rules shape it:
 *
 *   1. Openings and problem statements may only use facts we actually observed. When we
 *      observed nothing about a business beyond its name, the brief says so instead of
 *      inventing a hook.
 *   2. The deterministic version is complete on its own. An AI analysis, when present,
 *      replaces individual fields and the result is marked HYBRID — so it is always clear
 *      which sentences came from a model.
 */

export interface BriefInput {
  lead: Lead;
  audit: WebsiteAudit | null;
  signals: SignalMap;
  score: ScoreResult | null;
  businessValue: BusinessValueResult | null;
  primary: ServiceMatch | null;
  secondary: ServiceMatch[];
  /** Service rows for the recommended services, for angles/objections/questions. */
  services: Service[];
  ai?: AIAnalysis | null;
}

export function buildSalesBrief(input: BriefInput): SalesBriefContent {
  const { lead, audit, signals, score, businessValue, primary, secondary, services, ai } = input;

  const primaryService = primary ? services.find((s) => s.key === primary.serviceKey) ?? null : null;

  const observedProblems = collectProblems(signals, audit);
  const whyContact = buildWhyContact(lead, score, businessValue, primary, observedProblems);
  const salesAngle = primaryService?.salesAngles?.[0] ?? primary?.reasonsFa?.[0] ?? defaultAngle(lead);

  const openings = buildOpenings(lead, audit, signals, primary, observedProblems);
  const questions = buildQuestions(primaryService, lead, signals);
  const objections = buildObjections(primaryService);
  const nextAction = buildNextAction(score, lead);

  const base: SalesBriefContent = {
    whyContactFa: whyContact,
    keyProblemsFa: observedProblems.map((p) => p.textFa),
    recommendedServiceKey: primary?.serviceKey ?? null,
    recommendedServiceNameFa: primary?.nameFa ?? null,
    secondaryServiceKeys: secondary.map((s) => s.serviceKey),
    salesAngleFa: salesAngle,
    openings,
    questionsFa: questions,
    objections,
    nextActionFa: nextAction,
    generatedBy: 'RULES',
    disclaimersFa: buildDisclaimers(lead, audit, observedProblems.length),
  };

  if (!ai) return base;
  return mergeAi(base, ai);
}

/* -------------------------------------------------------------------------- */

/** Persian digits everywhere in generated copy, so the brief reads as one language. */
const fa = (value: number | string): string => toPersianDigits(String(value));

interface ObservedProblem {
  textFa: string;
  evidence: string;
  severity: number;
}

function collectProblems(signals: SignalMap, audit: WebsiteAudit | null): ObservedProblem[] {
  const problems: ObservedProblem[] = [];

  /**
   * Signals and audit findings describe the same defects in different words, so exact
   * string matching is not enough: "امکان رزرو آنلاین ندارد" and
   * "امکان رزرو یا نوبت‌دهی آنلاین ندارد" are one problem, and printing both makes the
   * brief look padded.
   */
  const push = (textFa: string, evidence: string, severity: number) => {
    const tokens = problemTokens(textFa);
    // Overlap rather than equality: the signal and the audit finding for the same defect
    // rarely use identical wording.
    const existing = problems.find((p) => tokensOverlap(problemTokens(p.textFa), tokens));
    if (existing) {
      // Keep the more specific evidence and the higher severity.
      if (severity > existing.severity) existing.severity = severity;
      if (evidence.length > existing.evidence.length) existing.evidence = evidence;
      return;
    }
    problems.push({ textFa, evidence, severity });
  };

  if (signals.NO_WEBSITE?.value) push('وب‌سایتی برای این کسب‌وکار پیدا نشد', signals.NO_WEBSITE.evidence, 10);
  if (signals.WEBSITE_BROKEN?.value) push('وب‌سایت در دسترس نیست', signals.WEBSITE_BROKEN.evidence, 10);
  if (signals.SOCIAL_ONLY_PRESENCE?.value) push('فعالیت فقط در شبکه‌های اجتماعی', signals.SOCIAL_ONLY_PRESENCE.evidence, 9);
  if (signals.OUTDATED_WEBSITE?.value) push('ساختار وب‌سایت قدیمی است', signals.OUTDATED_WEBSITE.evidence, 8);
  if (signals.POOR_MOBILE_UX?.value) push('تجربه کاربری موبایل ضعیف', signals.POOR_MOBILE_UX.evidence, 8);
  if (signals.NO_SSL?.value) push('گواهی امنیتی HTTPS ندارد', signals.NO_SSL.evidence, 7);
  if (signals.WEAK_CTA?.value) push('مسیر روشنی برای تماس یا سفارش وجود ندارد', signals.WEAK_CTA.evidence, 7);
  if (signals.NO_ONLINE_BOOKING?.value) push('امکان رزرو یا نوبت‌دهی آنلاین ندارد', signals.NO_ONLINE_BOOKING.evidence, 6);
  if (signals.NO_ONLINE_STORE?.value) push('امکان فروش آنلاین ندارد', signals.NO_ONLINE_STORE.evidence, 6);
  if (signals.WEAK_SEO?.value) push('ساختار سئو ضعیف است', signals.WEAK_SEO.evidence, 6);
  if (signals.NO_CONTACT_FORM?.value) push('فرم تماس ندارد', signals.NO_CONTACT_FORM.evidence, 5);
  if (signals.POOR_PERFORMANCE?.value) push('سرعت بارگذاری پایین', signals.POOR_PERFORMANCE.evidence, 5);
  if (signals.WEAK_BRANDING?.value) push('نشانه‌های هویت بصری ضعیف', signals.WEAK_BRANDING.evidence, 4);
  if (signals.POOR_CONTENT_STRUCTURE?.value) push('ساختار محتوایی نامنظم', signals.POOR_CONTENT_STRUCTURE.evidence, 4);
  if (signals.MISSING_BUSINESS_INFO?.value) push('اطلاعات پایه کسب‌وکار روی سایت ناقص است', signals.MISSING_BUSINESS_INFO.evidence, 3);

  // The audit's own high-severity findings add specificity the signals do not carry.
  const findings = Array.isArray(audit?.findings) ? (audit!.findings as Array<{ severity: string; titleFa: string; evidence: string }>) : [];
  for (const f of findings.filter((x) => x.severity === 'HIGH').slice(0, 3)) {
    push(f.titleFa, f.evidence, 7);
  }

  return problems.sort((a, b) => b.severity - a.severity).slice(0, 6);
}

/** Meaningful tokens of a problem statement, used to spot two phrasings of one defect. */
function problemTokens(textFa: string): Set<string> {
  return new Set(
    normalizeText(textFa)
      .split(' ')
      .filter((t) => t.length > 2 && !PROBLEM_STOPWORDS.has(t)),
  );
}

/** Same defect when one phrasing's keywords are contained in the other's, or they largely agree. */
function tokensOverlap(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const smaller = Math.min(a.size, b.size);
  const union = a.size + b.size - shared;
  return shared === smaller || shared / union >= 0.6;
}

const PROBLEM_STOPWORDS = new Set(['ندارد', 'است', 'وجود', 'روشنی', 'برای', 'این', 'یا', 'های', 'شده', 'دهی']);

function buildWhyContact(
  lead: Lead,
  score: ScoreResult | null,
  value: BusinessValueResult | null,
  primary: ServiceMatch | null,
  problems: ObservedProblem[],
): string {
  const parts: string[] = [];

  if (!problems.length && !primary) {
    return 'هنوز داده کافی برای توصیه فروش جمع‌آوری نشده است. پیش از تماس، بررسی وب‌سایت و تکمیل اطلاعات کسب‌وکار را اجرا کنید.';
  }

  const presence = describePresence(lead);
  if (presence) parts.push(presence);

  if (problems.length) {
    const top = problems.slice(0, 2).map((p) => p.textFa);
    parts.push(`مشکلات مشاهده‌شده: ${top.join(' و ')}`);
  }

  if (value && value.tier !== 'UNKNOWN') {
    parts.push(`ارزش تجاری تخمینی: ${BUSINESS_VALUE_LABELS[value.tier].fa}`);
  }

  if (primary) parts.push(`فرصت اصلی: ${primary.nameFa}`);
  if (score) parts.push(`امتیاز سرنخ ${fa(score.score)} از ۱۰۰ (${TEMPERATURE_LABELS[score.temperature].fa})`);

  return `${parts.join('. ')}.`;
}

function describePresence(lead: Lead): string | null {
  const bits: string[] = [];
  if (lead.websiteStatus === 'NO_WEBSITE') bits.push('بدون وب‌سایت');
  else if (lead.websiteDomain) bits.push(`وب‌سایت: ${lead.websiteDomain}`);
  if (lead.instagramUrl) bits.push('اینستاگرام فعال');
  if (typeof lead.reviewCount === 'number' && lead.reviewCount > 0) {
    bits.push(`${fa(lead.reviewCount)} نظر عمومی${lead.reviewRating ? ` با میانگین ${fa(lead.reviewRating.toFixed(1))}` : ''}`);
  }
  return bits.length ? bits.join('، ') : null;
}

/**
 * Three opening styles. Each is built only from observations we can defend if the
 * business owner pushes back — no flattery, no invented claims about their traffic.
 */
function buildOpenings(
  lead: Lead,
  audit: WebsiteAudit | null,
  signals: SignalMap,
  primary: ServiceMatch | null,
  problems: ObservedProblem[],
): SalesBriefContent['openings'] {
  const name = lead.businessName;
  const city = lead.city ? ` ${lead.city}` : '';
  const openings: SalesBriefContent['openings'] = [];

  // Problem-based: only when we actually observed a problem.
  if (problems.length) {
    const p = problems[0];
    openings.push({
      style: 'PROBLEM',
      textFa: `سلام، از بایمر تماس می‌گیرم. ما حضور آنلاین کسب‌وکارهای${city || ' منطقه'} را بررسی می‌کنیم و در بررسی «${name}» به این مورد برخوردیم: ${p.textFa}. اگر یک دقیقه وقت داشته باشید توضیح می‌دهم چه تأثیری روی مشتری‌های شما دارد.`,
    });
  }

  // Opportunity-based: needs a real asset to build on.
  const asset =
    signals.ACTIVE_INSTAGRAM?.value
      ? 'صفحه اینستاگرام فعال شما'
      : typeof lead.reviewCount === 'number' && lead.reviewCount >= 20
        ? `${fa(lead.reviewCount)} نظر ثبت‌شده مشتریان شما`
        : null;
  if (asset && primary) {
    openings.push({
      style: 'OPPORTUNITY',
      textFa: `سلام، از بایمر مزاحم می‌شوم. ${asset} را دیدیم؛ چیزی که الان جایش خالی است ${primary.nameFa} است تا این مخاطب به مشتری قابل شمارش تبدیل شود. می‌توانم در دو دقیقه توضیح بدهم؟`,
    });
  }

  // Audit-based: only when a real audit exists.
  if (audit?.reachable && typeof audit.overallScore === 'number') {
    const weakest = weakestArea(audit);
    openings.push({
      style: 'AUDIT',
      textFa: `سلام، از بایمر تماس می‌گیرم. ما یک بررسی فنی کوتاه روی وب‌سایت ${audit.finalUrl ?? lead.websiteDomain} انجام دادیم؛ امتیاز کلی ${fa(audit.overallScore)} از ۱۰۰ شد${weakest ? ` و ضعیف‌ترین بخش ${weakest} بود` : ''}. گزارش را رایگان برایتان می‌فرستم، اگر مایل باشید.`,
    });
  }

  if (!openings.length) {
    openings.push({
      style: 'PROBLEM',
      textFa: `سلام، از بایمر تماس می‌گیرم. در حال بررسی حضور آنلاین کسب‌وکارهای${city || ' منطقه'} هستیم. هنوز اطلاعات دیجیتال کاملی از «${name}» نداریم — می‌توانم چند سؤال کوتاه بپرسم تا ببینیم آیا اصلاً کمکی از ما برمی‌آید؟`,
    });
  }

  return openings;
}

function weakestArea(audit: WebsiteAudit): string | null {
  const areas: Array<[string, number | null]> = [
    ['موبایل', audit.mobileScore],
    ['سئو', audit.seoScore],
    ['نرخ تبدیل', audit.conversionScore],
    ['سرعت', audit.performanceScore],
    ['تجربه کاربری', audit.uxScore],
  ];
  const scored = areas.filter((a): a is [string, number] => typeof a[1] === 'number');
  if (!scored.length) return null;
  scored.sort((a, b) => a[1] - b[1]);
  return scored[0][0];
}

function buildQuestions(service: Service | null, lead: Lead, signals: SignalMap): string[] {
  const questions: string[] = [];
  questions.push('در حال حاضر مشتری‌ها بیشتر از چه راهی با شما تماس می‌گیرند؟');
  if (signals.ACTIVE_INSTAGRAM?.value) {
    questions.push('مخاطب‌های اینستاگرام را به کجا هدایت می‌کنید؟');
  }
  if (lead.websiteDomain) {
    questions.push('از وب‌سایت ماهانه چند تماس یا سفارش می‌گیرید؟');
  }
  questions.push(...(service?.discoveryQuestions ?? []));
  return Array.from(new Set(questions)).slice(0, 5);
}

function buildObjections(service: Service | null): SalesBriefContent['objections'] {
  if (!service?.commonObjections?.length) {
    return [
      {
        objectionFa: 'الان بودجه‌اش را نداریم.',
        responseFa: 'کاملاً قابل درک است. می‌توانیم با کوچک‌ترین قدم مؤثر شروع کنیم و بعد از دیدن نتیجه ادامه بدهیم.',
      },
    ];
  }
  return service.commonObjections.map((objectionFa, i) => ({
    objectionFa,
    responseFa: service.objectionResponses?.[i] ?? 'اجازه بدهید دقیقاً همان موردی را که مشاهده کرده‌ایم برایتان بفرستم تا خودتان قضاوت کنید.',
  }));
}

function buildNextAction(score: ScoreResult | null, lead: Lead): string {
  if (!score) return 'ابتدا بررسی وب‌سایت و امتیازدهی را اجرا کنید، سپس تماس بگیرید.';
  if (score.temperature === 'HOT') return 'همین امروز تماس بگیرید؛ این سرنخ در اولویت اول است.';
  if (score.temperature === 'WARM') return 'در ۴۸ ساعت آینده تماس بگیرید و گزارش بررسی سایت را ارسال کنید.';
  if (score.temperature === 'MEDIUM') return 'در برنامه هفته جاری قرار دهید؛ ابتدا اطلاعات تکمیلی جمع‌آوری شود.';
  return lead.websiteStatus === 'UNKNOWN'
    ? 'اطلاعات این سرنخ ناقص است؛ پیش از تماس، کشف وب‌سایت و بررسی را اجرا کنید.'
    : 'اولویت پایین — فقط در صورت خالی بودن صف تماس، پیگیری شود.';
}

function defaultAngle(lead: Lead): string {
  return lead.websiteStatus === 'NO_WEBSITE'
    ? 'ساختن اولین مرجع رسمی و قابل جست‌وجو برای کسب‌وکار'
    : 'تبدیل بازدیدکننده فعلی سایت به تماس و سفارش قابل اندازه‌گیری';
}

function buildDisclaimers(lead: Lead, audit: WebsiteAudit | null, problemCount: number): string[] {
  const notes: string[] = [];
  if (!audit) notes.push('بررسی وب‌سایت هنوز انجام نشده است؛ مشکلات فنی در این گزارش لحاظ نشده‌اند.');
  else if (!audit.reachable) notes.push('وب‌سایت در زمان بررسی در دسترس نبود؛ نتایج فنی ناقص است.');
  else if (audit.unavailable?.length) {
    notes.push('برخی سنجه‌ها (مانند Core Web Vitals) اندازه‌گیری نشده‌اند و در امتیاز لحاظ نشده‌اند.');
  }
  if (lead.websiteStatus === 'NOT_VERIFIED') {
    notes.push('آدرس وب‌سایت به‌صورت خودکار حدس زده شده و نیاز به تأیید انسانی دارد.');
  }
  if (typeof lead.reviewCount !== 'number') notes.push('تعداد نظرات عمومی برای این کسب‌وکار در دسترس نبود.');
  if (!problemCount) notes.push('هیچ مشکل دیجیتال قابل اثباتی مشاهده نشد؛ از ادعای کلی پرهیز کنید.');
  return notes;
}

/**
 * Overlay AI output on the deterministic brief.
 * Only non-empty AI fields replace the rules-based text, and the result is labelled so the
 * reader knows which sentences a model wrote.
 */
function mergeAi(base: SalesBriefContent, ai: AIAnalysis): SalesBriefContent {
  const merged: SalesBriefContent = { ...base, generatedBy: 'HYBRID' };

  if (ai.whyContact) merged.whyContactFa = ai.whyContact;
  if (ai.mainDigitalProblems?.length) merged.keyProblemsFa = ai.mainDigitalProblems;
  if (ai.salesAngle) merged.salesAngleFa = ai.salesAngle;
  if (ai.recommendedService) merged.recommendedServiceKey = ai.recommendedService;
  if (ai.secondaryServices?.length) merged.secondaryServiceKeys = ai.secondaryServices;
  if (ai.recommendedQuestions?.length) merged.questionsFa = ai.recommendedQuestions;
  if (ai.recommendedNextStep) merged.nextActionFa = ai.recommendedNextStep;

  if (ai.recommendedOpening) {
    merged.openings = [
      { style: 'PROBLEM', textFa: ai.recommendedOpening },
      ...base.openings.filter((o) => o.textFa !== ai.recommendedOpening),
    ];
  }

  if (ai.likelyObjections?.length) {
    merged.objections = ai.likelyObjections.map((objectionFa, i) => ({
      objectionFa,
      responseFa:
        i === 0 && ai.objectionStrategy
          ? ai.objectionStrategy
          : base.objections[i]?.responseFa ?? 'پاسخ را بر پایه همان موردی بدهید که در گزارش بررسی مشاهده شده است.',
    }));
  }

  merged.disclaimersFa = [
    ...base.disclaimersFa,
    'بخش‌هایی از این گزارش توسط مدل زبانی تولید شده است و پیش از استفاده باید با داده‌های مشاهده‌شده تطبیق داده شود.',
  ];

  return merged;
}
