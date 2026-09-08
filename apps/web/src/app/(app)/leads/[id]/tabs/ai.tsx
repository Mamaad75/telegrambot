'use client';

import { useState } from 'react';
import { ConfidenceBadge } from '@/components/badges';
import { Card, EmptyState, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, usd } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { LeadDetail } from '../types';

/**
 * AI analysis.
 *
 * Every field on this tab is badged as an AI insight and shown alongside its cost and
 * latency, so the team can see exactly what the model contributed and what it cost.
 */
export function AiTab({ data, onReload }: { data: LeadDetail; onReload: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const analysis = data.latestAi;
  const failed = data.lead.aiAnalyses.find((a) => a.error);

  const run = async () => {
    setBusy(true);
    try {
      await api.post(`/api/leads/${data.lead.id}/analyze`, { force: true });
      toast.show('تحلیل در صف قرار گرفت. نتیجه پس از تکمیل روی همین صفحه ظاهر می‌شود.');
      setTimeout(onReload, 6000);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'اجرای تحلیل ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!analysis) {
    return (
      <>
        {toast.node}
        <Card>
          <EmptyState
            title="تحلیل هوش مصنوعی انجام نشده است"
            description={
              failed?.error
                ? `آخرین تلاش ناموفق بود: ${failed.error}`
                : 'تحلیل هوش مصنوعی اختیاری است. اگر ارائه‌دهنده‌ای پیکربندی نشده باشد، گزارش فروش همچنان از قواعد قطعی ساخته می‌شود. برای صرفه‌جویی در هزینه، تحلیل فقط برای سرنخ‌های بالاتر از آستانه امتیاز اجرا می‌شود.'
            }
            action={
              session.can('lead:run_ai') && (
                <button type="button" className="btn-primary btn-sm" onClick={run} disabled={busy}>
                  {busy && <Spinner />}
                  اجرای تحلیل
                </button>
              )
            }
          />
        </Card>
      </>
    );
  }

  const sections: Array<{ title: string; value: string | null; list?: string[] }> = [
    { title: 'خلاصه کسب‌وکار', value: analysis.businessSummary },
    { title: 'پروفایل احتمالی مشتریان', value: analysis.likelyCustomerProfile },
    { title: 'مشکلات دیجیتال اصلی', value: null, list: analysis.mainDigitalProblems },
    { title: 'فرصت‌های کسب‌وکار', value: null, list: analysis.businessOpportunities },
    { title: 'زاویه فروش', value: analysis.salesAngle },
    { title: 'چرا تماس بگیریم', value: analysis.whyContact },
    { title: 'جمله شروع پیشنهادی', value: analysis.recommendedOpening },
    { title: 'سؤال‌های پیشنهادی', value: null, list: analysis.recommendedQuestions },
    { title: 'اعتراض‌های محتمل', value: null, list: analysis.likelyObjections },
    { title: 'راهبرد پاسخ به اعتراض', value: analysis.objectionStrategy },
    { title: 'اقدام بعدی پیشنهادی', value: analysis.recommendedNextStep },
  ];

  return (
    <>
      {toast.node}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card
          title="تحلیل هوش مصنوعی"
          subtitle={faDate(analysis.createdAt, true)}
          action={
            session.can('lead:run_ai') && (
              <button type="button" className="btn-ghost btn-sm" onClick={run} disabled={busy}>
                {busy && <Spinner />}
                اجرای مجدد
              </button>
            )
          }
        >
          <div className="mb-4 flex items-center gap-2">
            <ConfidenceBadge confidence="AI_INSIGHT" />
            <span className="text-[11px] leading-6 text-subtle">
              این متن‌ها توسط مدل زبانی و فقط بر پایه داده‌های مشاهده‌شده تولید شده‌اند. پیش از استناد در تماس، آن‌ها را با
              بخش «بررسی وب‌سایت» تطبیق دهید.
            </span>
          </div>

          <div className="space-y-4">
            {sections
              .filter((s) => s.value || (s.list && s.list.length > 0))
              .map((section) => (
                <div key={section.title}>
                  <h3 className="mb-1 text-xs font-medium text-subtle">{section.title}</h3>
                  {section.value && <p className="text-sm leading-7">{section.value}</p>}
                  {section.list && section.list.length > 0 && (
                    <ul className="space-y-1">
                      {section.list.map((item) => (
                        <li key={item} className="flex gap-2 text-sm leading-7">
                          <span className="text-accent">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="اطلاعات اجرا">
            <dl className="space-y-2 text-xs">
              <Row label="ارائه‌دهنده" value={analysis.provider} />
              <Row label="مدل" value={analysis.model} />
              <Row label="توکن ورودی" value={analysis.promptTokens !== null ? fa(analysis.promptTokens) : '—'} />
              <Row label="توکن خروجی" value={analysis.completionTokens !== null ? fa(analysis.completionTokens) : '—'} />
              <Row
                label="هزینه تخمینی"
                value={analysis.estimatedCostUsd !== null ? usd(analysis.estimatedCostUsd) : 'قیمت این مدل تعریف نشده'}
              />
              <Row label="زمان پاسخ" value={analysis.latencyMs !== null ? `${fa(analysis.latencyMs)} میلی‌ثانیه` : '—'} />
            </dl>
          </Card>

          {data.lead.aiAnalyses.length > 1 && (
            <Card title="تاریخچه تحلیل‌ها">
              <ul className="space-y-2 text-xs">
                {data.lead.aiAnalyses.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted">{faDate(item.createdAt, true)}</span>
                    <span className={item.error ? 'text-danger' : 'text-success'}>{item.error ? 'ناموفق' : 'موفق'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-fg" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
