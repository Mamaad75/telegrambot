'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { BusinessValueBadge, TemperatureBadge, WebsiteStatusBadge } from '@/components/badges';
import { Card, EmptyState, ErrorNote, Loading, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, faRelative, isOverdue, phone } from '@/lib/format';

interface TodayResponse {
  dueFollowUps: Array<{
    id: string;
    kind: string;
    dueAt: string;
    notes: string | null;
    lead: { id: string; businessName: string; city: string | null; normalizedPhone: string | null; leadScore: number | null; recommendedService: string | null };
  }>;
  /** Follow-ups already past their due time — a promise that has been broken. */
  overdue: TodayResponse['dueFollowUps'];
  /** Follow-ups due later today. */
  today: TodayResponse['dueFollowUps'];
  /** Due within the next day, but after today ends. */
  upcoming: TodayResponse['dueFollowUps'];
  overdueCount: number;
  overdueTasks: Array<{ id: string; title: string; dueAt: string | null; lead: { id: string; businessName: string } | null }>;
  meetingsToday: Array<{ id: string; businessName: string; city: string | null; normalizedPhone: string | null; nextFollowUpAt: string | null }>;
  newLeads: Array<{ id: string; businessName: string; city: string | null; leadScore: number | null; leadTemperature: string | null; recommendedService: string | null }>;
  recentlyAssigned: Array<{ id: string; businessName: string; city: string | null; leadScore: number | null; leadTemperature: string | null; normalizedPhone: string | null }>;
  readyToCall: Array<{
    id: string;
    businessName: string;
    city: string | null;
    normalizedPhone: string | null;
    leadScore: number | null;
    leadTemperature: string | null;
    recommendedService: string | null;
    salesAngle: string | null;
    businessValueTier: string;
    websiteStatus: string;
  }>;
}

/** The salesperson's landing view: what to do right now, in priority order. */
export default function TodayPage() {
  const toast = useToast();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<TodayResponse>('/api/dashboard/today'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت کارهای امروز ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (id: string) => {
    await api.post(`/api/crm/follow-ups/${id}/complete`).catch(() => undefined);
    toast.show('پیگیری بسته شد');
    await load();
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data) return null;

  const nothingToDo =
    !data.dueFollowUps.length &&
    !data.overdueTasks.length &&
    !data.readyToCall.length &&
    !data.meetingsToday?.length &&
    !data.newLeads?.length;

  return (
    <>
      {toast.node}
      <PageHeader title="کارهای امروز" description="پیگیری‌های سررسیدشده، کارهای عقب‌افتاده و سرنخ‌هایی که آماده تماس هستند." />

      {/* Priority strip: overdue first, because a broken promise costs more than a
          missed opportunity. */}
      {!nothingToDo && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className={`rounded-xl border p-3 ${(data.overdueCount ?? 0) > 0 ? 'border-hot/40 bg-hot/5' : 'border-border bg-surface-2'}`}>
            <p className="text-[11px] text-subtle">عقب‌افتاده</p>
            <p className={`tnum mt-0.5 text-xl font-semibold ${(data.overdueCount ?? 0) > 0 ? 'text-hot' : ''}`}>
              {fa(data.overdueCount ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] text-subtle">پیگیری امروز</p>
            <p className="tnum mt-0.5 text-xl font-semibold">{fa(data.today?.length ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] text-subtle">جلسه امروز</p>
            <p className="tnum mt-0.5 text-xl font-semibold">{fa(data.meetingsToday?.length ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] text-subtle">سرنخ جدید امروز</p>
            <p className="tnum mt-0.5 text-xl font-semibold">{fa(data.newLeads?.length ?? 0)}</p>
          </div>
        </div>
      )}

      {nothingToDo ? (
        <Card>
          <EmptyState
            title="کاری برای امروز نیست"
            description="پیگیری سررسیدشده‌ای ندارید و سرنخ آماده تماسی در صف شما نیست. می‌توانید یک کمپین جدید اجرا کنید یا فهرست سرنخ‌ها را مرور کنید."
            action={
              <div className="flex gap-2">
                <Link href="/leads" className="btn-ghost btn-sm">
                  فهرست سرنخ‌ها
                </Link>
                <Link href="/campaigns" className="btn-primary btn-sm">
                  کمپین‌ها
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <Card title="پیگیری‌های سررسیدشده" subtitle={`${fa(data.dueFollowUps.length)} مورد`} padded={false}>
              {data.dueFollowUps.length === 0 ? (
                <p className="px-5 py-6 text-center text-xs text-subtle">پیگیری سررسیدشده‌ای ندارید.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.dueFollowUps.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/leads/${item.lead.id}`} className="text-sm font-medium hover:text-accent">
                          {item.lead.businessName}
                        </Link>
                        <p className="text-xs text-muted">{item.kind}</p>
                        <p className={`text-[11px] ${isOverdue(item.dueAt) ? 'text-danger' : 'text-subtle'}`}>
                          {faDate(item.dueAt, true)} • {faRelative(item.dueAt)}
                        </p>
                        {item.notes && <p className="mt-1 text-[11px] text-subtle">{item.notes}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {item.lead.normalizedPhone && (
                          <a href={`tel:${item.lead.normalizedPhone}`} className="btn-primary btn-sm" dir="ltr">
                            {phone(item.lead.normalizedPhone)}
                          </a>
                        )}
                        <button type="button" className="btn-ghost btn-sm" onClick={() => void complete(item.id)}>
                          انجام شد
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {(data.meetingsToday?.length ?? 0) > 0 && (
              <Card title="جلسه‌های امروز" subtitle="قرارهایی که برای امروز تنظیم شده‌اند" padded={false}>
                <ul className="divide-y divide-border">
                  {data.meetingsToday.map((lead) => (
                    <li key={lead.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/leads/${lead.id}`} className="text-sm font-medium hover:text-accent">
                          {lead.businessName}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-subtle">
                          {lead.city ?? '—'}
                          {lead.nextFollowUpAt && <span> • {faDate(lead.nextFollowUpAt)}</span>}
                        </p>
                      </div>
                      {lead.normalizedPhone && (
                        <a href={`tel:${lead.normalizedPhone}`} className="btn-ghost btn-sm shrink-0" dir="ltr">
                          {phone(lead.normalizedPhone)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {(data.recentlyAssigned?.length ?? 0) > 0 && (
              <Card
                title="تازه به شما واگذار شده"
                subtitle="سرنخ‌هایی که در دو روز گذشته به شما سپرده شده و هنوز تماسی نگرفته‌اید"
                padded={false}
              >
                <ul className="divide-y divide-border">
                  {data.recentlyAssigned.map((lead) => (
                    <li key={lead.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/leads/${lead.id}`} className="text-sm font-medium hover:text-accent">
                          {lead.businessName}
                        </Link>
                        <div className="mt-1 flex items-center gap-1.5">
                          <TemperatureBadge temperature={lead.leadTemperature as never} />
                          <span className="text-[11px] text-subtle">{lead.city ?? '—'}</span>
                        </div>
                      </div>
                      {lead.normalizedPhone && (
                        <a href={`tel:${lead.normalizedPhone}`} className="btn-ghost btn-sm shrink-0" dir="ltr">
                          {phone(lead.normalizedPhone)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {data.overdueTasks.length > 0 && (
              <Card title="کارهای عقب‌افتاده" padded={false}>
                <ul className="divide-y divide-border">
                  {data.overdueTasks.map((task) => (
                    <li key={task.id} className="px-5 py-3">
                      <p className="text-sm">{task.title}</p>
                      <p className="text-[11px] text-danger">
                        {task.dueAt ? `${faDate(task.dueAt)} • ${faRelative(task.dueAt)}` : ''}
                        {task.lead && (
                          <Link href={`/leads/${task.lead.id}`} className="ms-2 text-accent hover:underline">
                            {task.lead.businessName}
                          </Link>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <Card title="آماده تماس" subtitle="سرنخ‌های داغ و گرم که هنوز تماسی با آن‌ها گرفته نشده" padded={false}>
            {data.readyToCall.length === 0 ? (
              <p className="px-5 py-6 text-center text-xs text-subtle">سرنخ آماده تماسی وجود ندارد.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.readyToCall.map((lead) => (
                  <li key={lead.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/leads/${lead.id}`} className="text-sm font-medium hover:text-accent">
                          {lead.businessName}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <TemperatureBadge temperature={lead.leadTemperature as never} />
                          <BusinessValueBadge tier={lead.businessValueTier as never} />
                          <WebsiteStatusBadge status={lead.websiteStatus as never} />
                          <span className="tnum text-[11px] text-subtle">{fa(lead.leadScore)}/۱۰۰</span>
                        </div>
                        {lead.salesAngle && <p className="mt-1.5 text-[11px] leading-6 text-subtle">{lead.salesAngle}</p>}
                      </div>
                      {lead.normalizedPhone && (
                        <a href={`tel:${lead.normalizedPhone}`} className="btn-primary btn-sm shrink-0" dir="ltr">
                          {phone(lead.normalizedPhone)}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
