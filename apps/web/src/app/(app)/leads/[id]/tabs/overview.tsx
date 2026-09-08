'use client';

import { SCORING_SIGNAL_META, type ScoringSignal } from '@baimar/shared';
import { ConfidenceBadge, ScoreBar } from '@/components/badges';
import { Card, EmptyState } from '@/components/ui';
import { fa, faDate, faNumber } from '@/lib/format';
import type { LeadDetail } from '../types';

/**
 * Overview: the score, and — more importantly — *why* it is what it is.
 * A number without its reasons is not something a salesperson can defend on a call.
 */
export function OverviewTab({ data }: { data: LeadDetail; onReload: () => void }) {
  const lead = data.lead;
  const audit = data.latestAudit;
  const breakdown = lead.scoreBreakdown ?? [];
  const value = lead.businessValueReasons;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="اجزای امتیاز فرصت" subtitle={lead.scoredAt ? `آخرین محاسبه: ${faDate(lead.scoredAt, true)}` : undefined}>
        {breakdown.length === 0 ? (
          <EmptyState
            title="امتیازی محاسبه نشده است"
            description="پس از کشف وب‌سایت و بررسی آن، امتیاز و دلایل آن اینجا نمایش داده می‌شود."
          />
        ) : (
          <ul className="space-y-2.5">
            {breakdown.map((item) => (
              <li key={item.signal} className="flex items-start gap-3">
                <span
                  className={`tnum mt-0.5 w-12 shrink-0 rounded-lg px-2 py-1 text-center text-xs font-semibold ${
                    item.points > 0 ? 'bg-hot/10 text-hot' : 'bg-success/10 text-success'
                  }`}
                >
                  {item.points > 0 ? '+' : '−'}
                  {fa(Math.abs(item.points))}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {item.labelFa}
                    <ConfidenceBadge confidence={item.confidence} />
                  </p>
                  <p className="mt-0.5 text-xs leading-6 text-subtle">{item.evidence}</p>
                  <p className="mt-0.5 text-[11px] text-subtle/70">
                    {SCORING_SIGNAL_META[item.signal as ScoringSignal]?.criterion}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-4">
        <Card title="ارزش تجاری" subtitle="تخمین جذابیت تجاری از روی نشانه‌های عمومی — درآمد واقعی نیست">
          {!value || value.reasons.length === 0 ? (
            <EmptyState title="داده کافی برای ارزیابی وجود ندارد" description="تعداد نظرات، تنوع خدمات و حضور دیجیتال هنوز مشخص نیست." />
          ) : (
            <>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="tnum text-2xl font-semibold">{fa(value.score)}</span>
                <span className="text-xs text-subtle">از ۱۰۰</span>
                {lead.businessSizeEstimate && <span className="ms-auto text-[11px] text-subtle">{lead.businessSizeEstimate}</span>}
              </div>
              <ul className="space-y-2">
                {value.reasons.map((r) => (
                  <li key={r.factor} className="flex items-start gap-3 text-xs">
                    <span className="tnum w-9 shrink-0 rounded-lg bg-surface-2 px-1.5 py-0.5 text-center font-medium">
                      +{fa(r.points)}
                    </span>
                    <div>
                      <p className="font-medium text-fg">{r.labelFa}</p>
                      <p className="text-subtle">{r.evidence}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {value.unknownFactors.length > 0 && (
                <p className="mt-3 rounded-xl bg-surface-2 p-3 text-[11px] leading-6 text-subtle">
                  اطلاعات در دسترس نبود برای: {value.unknownFactors.join('، ')}. این موارد در ارزیابی لحاظ نشده‌اند.
                </p>
              )}
            </>
          )}
        </Card>

        {audit && (
          <Card title="خلاصه بررسی وب‌سایت" subtitle={`${faNumber(audit.pagesCrawled)} صفحه بررسی شد`}>
            <ScoreBar label="سئو" score={audit.seoScore} />
            <ScoreBar label="موبایل" score={audit.mobileScore} />
            <ScoreBar label="کارایی" score={audit.performanceScore} />
            <ScoreBar label="تجربه کاربری" score={audit.uxScore} />
            <ScoreBar label="نرخ تبدیل" score={audit.conversionScore} />
            <ScoreBar label="فنی" score={audit.technicalScore} />
          </Card>
        )}

        <Card title="فرصت‌های شناسایی‌شده">
          {lead.opportunities_.length === 0 ? (
            <EmptyState title="فرصتی تطبیق داده نشده" description="موتور فرصت‌یابی پس از بررسی وب‌سایت اجرا می‌شود." />
          ) : (
            <ul className="space-y-2.5">
              {lead.opportunities_.map((opportunity) => (
                <li key={opportunity.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {data.services[opportunity.serviceKey]?.nameFa ?? opportunity.serviceKey}
                      {opportunity.isPrimary && <span className="ms-2 chip bg-accent/15 text-accent">پیشنهاد اصلی</span>}
                    </p>
                    <span className="tnum text-xs text-subtle">{fa(opportunity.score)}</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[11px] leading-6 text-subtle">
                    {opportunity.reasons.slice(0, 3).map((reason) => (
                      <li key={reason}>• {reason}</li>
                    ))}
                  </ul>
                  {opportunity.marketBoost > 0 && (
                    <p className="mt-1 text-[11px] text-accent">
                      +{fa(opportunity.marketBoost)} امتیاز از سیگنال تقاضای بازار
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
