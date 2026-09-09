'use client';

import { ConfidenceBadge } from '@/components/badges';
import { Card, EmptyState } from '@/components/ui';
import { faDate } from '@/lib/format';
import type { LeadDetail } from '../types';

/**
 * Source transparency.
 *
 * Every field on the lead can be traced to the provider that supplied it, with a link to
 * the original record where one exists. This is what lets a salesperson verify a number
 * before they dial it.
 */

const FIELD_LABELS: Record<string, string> = {
  businessName: 'نام کسب‌وکار',
  phone: 'تلفن',
  website: 'وب‌سایت',
  address: 'آدرس',
  city: 'شهر',
  province: 'استان',
  email: 'ایمیل',
  instagramUrl: 'اینستاگرام',
  telegramUrl: 'تلگرام',
  googleMapsUrl: 'گوگل مپ',
  reviewCount: 'تعداد نظرات',
  reviewRating: 'امتیاز نظرات',
  description: 'توضیحات',
  openingHours: 'ساعات کاری',
  coordinates: 'مختصات جغرافیایی',
};

const PROVIDER_LABELS: Record<string, string> = {
  osm_overpass: 'OpenStreetMap',
  google_places: 'Google Places',
  search_engine: 'جست‌وجوی وب',
  manual: 'ورود دستی / CSV',
  merge: 'ادغام سرنخ',
};

const ORIGIN_LABELS: Record<string, string> = {
  PUBLIC_BUSINESS_RESEARCH: 'تحقیق عمومی کسب‌وکار',
  FIRST_PARTY_BAIMAR: 'داده خود بایمر',
  ADVERTISING_CAMPAIGN: 'داده تبلیغاتی',
  AGGREGATE_SEARCH_SIGNAL: 'سیگنال تجمیعی جست‌وجو',
  AI_INFERENCE: 'استنتاج هوش مصنوعی',
  MANUAL_ENTRY: 'ورود دستی',
};

export function SourcesTab({ data }: { data: LeadDetail }) {
  const references = data.lead.sourceReferences;
  const match = data.lead.websiteMatchReasons;
  const confidence = data.lead.websiteMatchConfidence;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/*
        Why we believe this website belongs to this business.

        A wrong website is worse than no website: the salesperson would open the call
        with a fact about a stranger's site. So the score is shown with the signals
        behind it, and anything the system was not confident enough to attach is listed
        separately as a suggestion for a human to confirm.
      */}
      {(confidence !== null || match) && (
        <Card
          title="اطمینان از تطبیق وب‌سایت"
          subtitle={data.lead.websiteDomain ?? 'وب‌سایتی به این سرنخ متصل نشده است'}
          className="xl:col-span-2"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-surface-2 px-4 py-2.5">
              <p className="text-[11px] text-subtle">امتیاز اطمینان</p>
              <p className="tnum mt-0.5 text-2xl font-semibold">
                {confidence === null ? <span className="text-base text-subtle">محاسبه نشده</span> : `${confidence}٪`}
              </p>
            </div>
            <div className="text-xs leading-6 text-muted">
              {data.lead.websiteStatus === 'NOT_VERIFIED' && (
                <p className="text-warning">این آدرس هنوز توسط انسان تأیید نشده است — پیش از استناد در تماس بررسی شود.</p>
              )}
              {data.lead.websiteMatchedBy && <p>روش کشف: {data.lead.websiteMatchedBy}</p>}
              {data.lead.lastCrawledAt && <p>آخرین بررسی: {faDate(data.lead.lastCrawledAt)}</p>}
            </div>
          </div>

          {(match?.signals?.length ?? 0) > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
              {match!.signals!.map((signal) => (
                <li key={signal.key} className="flex items-start justify-between gap-3 text-xs leading-6">
                  <span className={signal.matched ? '' : 'text-subtle'}>
                    {signal.labelFa}
                    {signal.evidence && <span className="block text-[11px] text-muted">{signal.evidence}</span>}
                  </span>
                  <span className={`tnum shrink-0 ${signal.matched ? 'text-success' : 'text-subtle'}`}>
                    {signal.points} / {signal.maxPoints}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(match?.suggestions?.length ?? 0) > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1.5 text-[11px] font-medium text-subtle">
                نامزدهای با اطمینان پایین — متصل نشده‌اند، برای تأیید انسانی
              </p>
              <ul className="space-y-1.5">
                {match!.suggestions!.map((s) => (
                  <li key={s.url} className="text-xs leading-6">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline" dir="ltr">
                      {s.domain}
                    </a>
                    <span className="tnum ms-2 text-subtle">{s.confidence}٪</span>
                    {s.reasons.length > 0 && <span className="block text-[11px] text-muted">{s.reasons.join(' • ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card title="منابع اطلاعات" subtitle="هر منبع جداگانه نگهداری می‌شود تا قابل راستی‌آزمایی باشد">
        {references.length === 0 ? (
          <EmptyState title="منبعی ثبت نشده است" />
        ) : (
          <ul className="space-y-3">
            {references.map((reference) => (
              <li key={reference.id} className="rounded-xl border border-border p-3.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{PROVIDER_LABELS[reference.providerKey] ?? reference.providerKey}</span>
                  <div className="flex items-center gap-2">
                    <span className="chip bg-surface-2 text-subtle">{ORIGIN_LABELS[reference.origin] ?? reference.origin}</span>
                    <ConfidenceBadge confidence={reference.confidence as never} />
                  </div>
                </div>

                {reference.fields.length > 0 && (
                  <p className="text-[11px] leading-6 text-subtle">
                    اطلاعات تأمین‌شده: {reference.fields.map((f) => FIELD_LABELS[f] ?? f).join('، ')}
                  </p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-subtle">
                  <span>دریافت: {faDate(reference.fetchedAt, true)}</span>
                  {reference.sourceUrl && (
                    <a
                      href={reference.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent hover:underline"
                      dir="ltr"
                    >
                      مشاهده منبع اصلی ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-4">
        <Card title="سیگنال‌های کسب‌وکار" subtitle="ورودی‌های موتور امتیازدهی">
          {data.lead.businessSignals.length === 0 ? (
            <p className="text-xs text-subtle">سیگنالی استخراج نشده است.</p>
          ) : (
            <ul className="space-y-2">
              {data.lead.businessSignals.map((signal) => (
                <li key={signal.id} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className={signal.value ? 'font-medium text-fg' : 'text-subtle'}>{signal.key}</span>
                    <div className="flex items-center gap-2">
                      {signal.weightHint !== null && <span className="tnum text-subtle">{signal.weightHint > 0 ? '+' : ''}{signal.weightHint}</span>}
                      <ConfidenceBadge confidence={signal.confidence as never} />
                    </div>
                  </div>
                  {signal.evidence && <p className="mt-0.5 leading-6 text-subtle">{signal.evidence}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="تاریخچه امتیاز">
          {data.lead.scores.length === 0 ? (
            <p className="text-xs text-subtle">امتیازی ثبت نشده است.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {data.lead.scores.map((score) => (
                <li key={score.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className="text-muted">{score.reason ?? score.temperature}</span>
                  <span className="text-subtle">{faDate(score.createdAt, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.lead.campaign && (
          <Card title="کمپین منبع">
            <p className="text-sm">{data.lead.campaign.name}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
