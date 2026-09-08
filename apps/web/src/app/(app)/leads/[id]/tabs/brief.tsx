'use client';

import { useState } from 'react';
import { Card, EmptyState, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { LeadDetail } from '../types';

const OPENING_LABELS: Record<string, string> = {
  PROBLEM: 'شروع بر پایه مشکل مشاهده‌شده',
  OPPORTUNITY: 'شروع بر پایه فرصت',
  AUDIT: 'شروع بر پایه گزارش بررسی',
};

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  RULES: { label: 'قواعد قطعی', className: 'bg-info/10 text-info' },
  AI: { label: 'هوش مصنوعی', className: 'bg-accent/15 text-accent' },
  HYBRID: { label: 'ترکیبی (قواعد + هوش مصنوعی)', className: 'bg-accent/15 text-accent' },
};

/**
 * The sales brief. This is the deliverable: everything a salesperson needs in the
 * 30–60 seconds before the call, with its provenance attached.
 */
export function BriefTab({ data, onReload }: { data: LeadDetail; onReload: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const brief = data.currentBrief;

  const regenerate = async () => {
    setBusy(true);
    try {
      await api.post(`/api/leads/${data.lead.id}/regenerate-brief`);
      toast.show('گزارش فروش بازسازی شد');
      onReload();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'بازسازی ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.show('کپی ناموفق بود', 'error');
    }
  };

  if (!brief) {
    return (
      <>
        {toast.node}
        <Card>
          <EmptyState
            title="گزارش فروشی ساخته نشده است"
            description="گزارش فروش از داده‌های مشاهده‌شده ساخته می‌شود. ابتدا کشف وب‌سایت و بررسی آن را اجرا کنید، سپس گزارش را بسازید."
            action={
              <button type="button" className="btn-primary btn-sm" onClick={regenerate} disabled={busy}>
                {busy && <Spinner />}
                ساخت گزارش
              </button>
            }
          />
        </Card>
      </>
    );
  }

  const content = brief.content;
  const source = SOURCE_LABELS[brief.generatedBy] ?? SOURCE_LABELS.RULES;

  return (
    <>
      {toast.node}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card
            title="گزارش فروش بایمر"
            subtitle={`نسخه ${brief.version} • ${faDate(brief.createdAt, true)}`}
            action={
              <div className="flex items-center gap-2">
                <span className={`chip ${source.className}`}>{source.label}</span>
                {session.can('lead:update') && (
                  <button type="button" className="btn-ghost btn-sm" onClick={regenerate} disabled={busy}>
                    {busy && <Spinner />}
                    بازسازی
                  </button>
                )}
              </div>
            }
          >
            <section className="space-y-4">
              <div>
                <h3 className="mb-1 text-xs font-medium text-subtle">چرا باید با این کسب‌وکار تماس گرفت</h3>
                <p className="text-sm leading-7">{content.whyContactFa}</p>
              </div>

              {content.keyProblemsFa.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-medium text-subtle">مشکلات مشاهده‌شده</h3>
                  <ul className="space-y-1">
                    {content.keyProblemsFa.map((problem) => (
                      <li key={problem} className="flex gap-2 text-sm leading-7">
                        <span className="text-hot">•</span>
                        <span>{problem}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[11px] text-subtle">بهترین خدمت</p>
                  <p className="mt-0.5 text-sm font-medium text-accent">{content.recommendedServiceNameFa ?? 'نامشخص'}</p>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[11px] text-subtle">خدمات مکمل</p>
                  <p className="mt-0.5 text-sm">
                    {content.secondaryServiceKeys.length
                      ? content.secondaryServiceKeys.map((k) => data.services[k]?.nameFa ?? k).join('، ')
                      : '—'}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-xs font-medium text-subtle">زاویه فروش</h3>
                <p className="text-sm leading-7">{content.salesAngleFa}</p>
              </div>
            </section>
          </Card>

          <Card title="جملات شروع" subtitle="فقط بر پایه اطلاعاتی که واقعاً مشاهده شده است">
            <ul className="space-y-3">
              {content.openings.map((opening) => (
                <li key={opening.style} className="rounded-xl border border-border p-3.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-subtle">{OPENING_LABELS[opening.style]}</span>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => void copy(opening.textFa, opening.style)}
                    >
                      {copied === opening.style ? 'کپی شد ✓' : 'کپی'}
                    </button>
                  </div>
                  <p className="text-sm leading-7">{opening.textFa}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="سؤال‌هایی که بپرسید">
            <ol className="space-y-2">
              {content.questionsFa.map((question, i) => (
                <li key={question} className="flex gap-2.5 text-sm leading-7">
                  <span className="tnum shrink-0 text-subtle">{i + 1}.</span>
                  <span>{question}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="اعتراض‌های محتمل و پاسخ">
            <ul className="space-y-3">
              {content.objections.map((objection) => (
                <li key={objection.objectionFa}>
                  <p className="text-sm font-medium">«{objection.objectionFa}»</p>
                  <p className="mt-1 text-xs leading-6 text-muted">{objection.responseFa}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="اقدام بعدی">
            <p className="text-sm leading-7">{content.nextActionFa}</p>
          </Card>

          {content.disclaimersFa.length > 0 && (
            <Card title="محدودیت‌های این گزارش">
              <ul className="space-y-1.5 text-[11px] leading-6 text-subtle">
                {content.disclaimersFa.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
