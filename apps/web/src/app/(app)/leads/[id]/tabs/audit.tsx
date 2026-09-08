'use client';

import { ScoreBar, ScoreRing } from '@/components/badges';
import { Card, EmptyState } from '@/components/ui';
import { fa, faDate, faNumber } from '@/lib/format';
import type { LeadDetail } from '../types';

/**
 * Website audit results.
 *
 * The "not measured" panel is as important as the scores: it is what stops the platform
 * from implying it ran a Lighthouse test it never ran.
 */

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: 'bg-danger/10 text-danger',
  MEDIUM: 'bg-warning/10 text-warning',
  LOW: 'bg-info/10 text-info',
  INFO: 'bg-surface-2 text-subtle',
};

const SEVERITY_LABELS: Record<string, string> = {
  HIGH: 'بحرانی',
  MEDIUM: 'متوسط',
  LOW: 'جزئی',
  INFO: 'اطلاعاتی',
};

const AREA_LABELS: Record<string, string> = {
  SEO: 'سئو',
  MOBILE: 'موبایل',
  PERFORMANCE: 'کارایی',
  UX: 'تجربه کاربری',
  CONVERSION: 'نرخ تبدیل',
  TECHNICAL: 'فنی',
  ACCESSIBILITY: 'دسترس‌پذیری',
  TRUST: 'اعتماد',
  CONTENT: 'محتوا',
};

const UNAVAILABLE_LABELS: Record<string, string> = {
  'lighthouse-core-web-vitals': 'Core Web Vitals (نیازمند اجرای مرورگر واقعی — انجام نشد)',
  'real-user-performance': 'داده کارایی کاربران واقعی (در دسترس نیست)',
  'mobile.tap_target_size': 'اندازه نواحی لمسی (نیازمند رندر صفحه)',
  'mobile.font_legibility': 'خوانایی فونت روی موبایل (نیازمند رندر صفحه)',
  'a11y.color_contrast': 'کنتراست رنگ (نیازمند رندر صفحه)',
  'a11y.keyboard_navigation': 'پیمایش با صفحه‌کلید (نیازمند رندر صفحه)',
  'site-unreachable': 'سایت در دسترس نبود — هیچ سنجه‌ای اندازه‌گیری نشد',
  'all-measurements-blocked-by-robots': 'robots.txt سایت اجازه بررسی نداده است',
  'demo-simulated-audit': 'این نتیجه شبیه‌سازی‌شده برای داده نمونه است',
};

const CAPABILITY_LABELS: Array<{ key: keyof NonNullable<LeadDetail['latestAudit']>; label: string }> = [
  { key: 'hasSsl', label: 'HTTPS' },
  { key: 'hasViewport', label: 'طراحی موبایل' },
  { key: 'hasContactForm', label: 'فرم تماس' },
  { key: 'hasContactPage', label: 'صفحه تماس' },
  { key: 'hasAboutPage', label: 'صفحه درباره ما' },
  { key: 'hasEcommerce', label: 'فروش آنلاین' },
  { key: 'hasBooking', label: 'رزرو آنلاین' },
  { key: 'hasAnalytics', label: 'ابزار تحلیل' },
  { key: 'hasLogo', label: 'لوگو' },
  { key: 'hasFavicon', label: 'آیکون سایت' },
  { key: 'hasSitemap', label: 'نقشه سایت' },
  { key: 'hasRobots', label: 'robots.txt' },
  { key: 'hasStructuredData', label: 'داده ساختاریافته' },
  { key: 'hasBlog', label: 'وبلاگ' },
];

export function AuditTab({ data }: { data: LeadDetail }) {
  const audit = data.latestAudit;

  if (!audit) {
    return (
      <Card>
        <EmptyState
          title="این سرنخ هنوز بررسی نشده است"
          description={
            data.lead.websiteStatus === 'NO_WEBSITE'
              ? 'برای این کسب‌وکار وب‌سایتی پیدا نشد — همین موضوع قوی‌ترین سیگنال فروش است و در امتیاز لحاظ شده. چیزی برای بررسی وجود ندارد.'
              : 'دکمه «بررسی وب‌سایت» را در بالای صفحه بزنید. بررسی در پس‌زمینه انجام می‌شود و به robots.txt سایت احترام می‌گذارد.'
          }
        />
      </Card>
    );
  }

  const findings = audit.findings ?? [];
  const technologies = audit.technologies ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <Card title="امتیاز بررسی" subtitle={`${faDate(audit.createdAt, true)} • ${faNumber(audit.pagesCrawled)} صفحه`}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <ScoreRing score={audit.overallScore} size={80} label="امتیاز کلی" />
            <div className="text-end text-xs text-subtle">
              <p dir="ltr" className="truncate">
                {audit.finalUrl ?? audit.url}
              </p>
              <p className="mt-1">
                وضعیت HTTP: <span className="tnum">{audit.httpStatus ? fa(audit.httpStatus) : '—'}</span>
              </p>
              {audit.responseMs !== null && (
                <p>
                  میانگین پاسخ: <span className="tnum">{fa(audit.responseMs)}</span> میلی‌ثانیه
                </p>
              )}
              {audit.totalBytes !== null && (
                <p>
                  حجم دریافتی: <span className="tnum">{fa(Math.round(audit.totalBytes / 1024))}</span> کیلوبایت
                </p>
              )}
            </div>
          </div>

          <ScoreBar label="سئو" score={audit.seoScore} />
          <ScoreBar label="موبایل" score={audit.mobileScore} />
          <ScoreBar label="کارایی" score={audit.performanceScore} />
          <ScoreBar label="تجربه کاربری" score={audit.uxScore} />
          <ScoreBar label="نرخ تبدیل" score={audit.conversionScore} />
          <ScoreBar label="فنی" score={audit.technicalScore} />
          <ScoreBar label="دسترس‌پذیری" score={audit.accessibilityScore} />

          {audit.error && (
            <p className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs leading-6 text-danger">{audit.error}</p>
          )}
        </Card>

        <Card title="آنچه اندازه‌گیری نشد" subtitle="این موارد در امتیاز لحاظ نشده‌اند">
          <ul className="space-y-1.5 text-[11px] leading-6 text-subtle">
            {audit.unavailable.length === 0 ? (
              <li>همه سنجه‌های قابل اندازه‌گیری انجام شد.</li>
            ) : (
              audit.unavailable.map((key) => <li key={key}>• {UNAVAILABLE_LABELS[key] ?? key}</li>)
            )}
          </ul>
        </Card>

        <Card title="قابلیت‌های سایت">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {CAPABILITY_LABELS.map(({ key, label }) => {
              const value = audit[key] as boolean | null | undefined;
              return (
                <li key={String(key)} className="flex items-center justify-between gap-2">
                  <span className="text-muted">{label}</span>
                  {value === null || value === undefined ? (
                    <span className="text-subtle">نامشخص</span>
                  ) : value ? (
                    <span className="text-success">دارد</span>
                  ) : (
                    <span className="text-danger">ندارد</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="یافته‌ها" subtitle={`${faNumber(findings.length)} مورد`}>
          {findings.length === 0 ? (
            <p className="text-xs text-subtle">مشکل قابل توجهی یافت نشد.</p>
          ) : (
            <ul className="space-y-2.5">
              {findings.map((finding) => (
                <li key={finding.code} className="rounded-xl border border-border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={`chip ${SEVERITY_STYLES[finding.severity]}`}>{SEVERITY_LABELS[finding.severity]}</span>
                    <span className="chip bg-surface-2 text-subtle">{AREA_LABELS[finding.area] ?? finding.area}</span>
                    <span className="text-sm font-medium">{finding.titleFa}</span>
                  </div>
                  <p className="text-[11px] leading-6 text-subtle">{finding.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="فناوری‌های تشخیص داده شده" subtitle="تشخیص مبتنی بر نشانه است، نه قطعی">
          {technologies.length === 0 ? (
            <p className="text-xs text-subtle">فناوری شناخته‌شده‌ای تشخیص داده نشد.</p>
          ) : (
            <ul className="space-y-2">
              {technologies.map((tech) => (
                <li key={tech.name} className="flex items-start justify-between gap-3 text-xs">
                  <div>
                    <p className="font-medium">
                      {tech.name} <span className="text-subtle">— {tech.category}</span>
                    </p>
                    <p className="text-[11px] text-subtle">{tech.evidence}</p>
                  </div>
                  <span
                    className={`chip shrink-0 ${
                      tech.confidence === 'HIGH' ? 'bg-success/10 text-success' : tech.confidence === 'MEDIUM' ? 'bg-info/10 text-info' : 'bg-surface-2 text-subtle'
                    }`}
                  >
                    {{ HIGH: 'اطمینان بالا', MEDIUM: 'اطمینان متوسط', LOW: 'اطمینان کم' }[tech.confidence]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {audit.pages && audit.pages.length > 0 && (
          <Card title="صفحات بررسی‌شده" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="table-head">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">آدرس</th>
                    <th className="px-3 py-2 text-start font-medium">نوع</th>
                    <th className="px-3 py-2 text-start font-medium">کلمات</th>
                    <th className="px-3 py-2 text-start font-medium">فرم</th>
                    <th className="px-4 py-2 text-start font-medium">تصاویر بدون alt</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.pages.map((page) => (
                    <tr key={page.id} className="border-t border-border">
                      <td className="max-w-[16rem] truncate px-4 py-2" dir="ltr">
                        <a href={page.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-accent">
                          {page.url}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-subtle">{page.role ?? '—'}</td>
                      <td className="tnum px-3 py-2">{page.wordCount !== null ? fa(page.wordCount) : '—'}</td>
                      <td className="px-3 py-2">{page.hasForm ? 'دارد' : '—'}</td>
                      <td className="tnum px-4 py-2">
                        {fa(page.imagesWithoutAlt)} / {fa(page.imageCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {audit.discoveredPhones.length + audit.discoveredEmails.length > 0 && (
          <Card title="اطلاعات تماس یافت‌شده روی سایت">
            <dl className="space-y-2 text-xs">
              {audit.discoveredPhones.length > 0 && (
                <div>
                  <dt className="text-subtle">تلفن</dt>
                  <dd className="tnum" dir="ltr">
                    {audit.discoveredPhones.join('، ')}
                  </dd>
                </div>
              )}
              {audit.discoveredEmails.length > 0 && (
                <div>
                  <dt className="text-subtle">ایمیل</dt>
                  <dd dir="ltr">{audit.discoveredEmails.join('، ')}</dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}
