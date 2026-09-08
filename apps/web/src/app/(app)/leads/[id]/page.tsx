'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CONTACT_STATUSES } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import {
  BusinessValueBadge,
  CONTACT_STATUS_LABELS,
  ConfidenceBadge,
  DemoBadge,
  ScoreRing,
  StatusBadge,
  TemperatureBadge,
  WebsiteStatusBadge,
} from '@/components/badges';
import { Card, ErrorNote, Loading, Spinner, Tabs, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, phone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { OverviewTab } from './tabs/overview';
import { BusinessTab } from './tabs/business';
import { AuditTab } from './tabs/audit';
import { BriefTab } from './tabs/brief';
import { AiTab } from './tabs/ai';
import { ActivityTab } from './tabs/activity';
import { SourcesTab } from './tabs/sources';
import { MarketTab } from './tabs/market';
import type { LeadDetail } from './types';
import { LogCallModal } from './log-call';

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const toast = useToast();

  const [data, setData] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<LeadDetail>(`/api/leads/${params.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت اطلاعات سرنخ ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (action: string, path: string, body?: unknown) => {
    setBusy(action);
    try {
      const result = await api.post<{ queued?: boolean; skipped?: string }>(path, body);
      toast.show(
        result.queued
          ? 'درخواست در صف پردازش قرار گرفت؛ نتیجه به‌زودی روی همین صفحه ظاهر می‌شود.'
          : result.skipped ?? 'انجام شد',
      );
      // Give a queued job a moment to land before refreshing.
      setTimeout(() => void load(), result.queued ? 4000 : 400);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'اجرای عملیات ناموفق بود', 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (contactStatus: string) => {
    try {
      await api.patch(`/api/leads/${params.id}`, { contactStatus });
      toast.show('وضعیت به‌روزرسانی شد');
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'تغییر وضعیت ناموفق بود', 'error');
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data) return null;

  const lead = data.lead;
  const audit = data.latestAudit;

  const tabs = [
    { key: 'overview', label: 'نمای کلی' },
    { key: 'brief', label: 'گزارش فروش' },
    { key: 'business', label: 'کسب‌وکار' },
    { key: 'audit', label: 'بررسی وب‌سایت', badge: audit ? undefined : '—' },
    { key: 'market', label: 'سیگنال بازار' },
    { key: 'ai', label: 'تحلیل هوش مصنوعی' },
    { key: 'activity', label: 'تاریخچه و یادداشت‌ها' },
    { key: 'sources', label: 'منابع', badge: lead.sourceReferences.length },
  ];

  return (
    <>
      {toast.node}

      <div className="mb-4 flex items-center gap-2 text-xs text-subtle">
        <Link href="/leads" className="hover:text-fg">
          سرنخ‌ها
        </Link>
        <span>/</span>
        <span className="text-fg">{lead.businessName}</span>
      </div>

      <PageHeader
        title={lead.businessName}
        description={[lead.category, lead.city, lead.province].filter(Boolean).join(' • ') || undefined}
        actions={
          <>
            {lead.normalizedPhone && (
              <a href={`tel:${lead.normalizedPhone}`} className="btn-primary btn-sm" dir="ltr">
                {phone(lead.normalizedPhone)}
              </a>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCallOpen(true)}>
              ثبت تماس
            </button>
            {session.can('lead:run_audit') && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => void runAction('audit', `/api/leads/${lead.id}/audit`, { force: true })}
              >
                {busy === 'audit' && <Spinner />}
                بررسی وب‌سایت
              </button>
            )}
            {session.can('lead:run_ai') && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => void runAction('ai', `/api/leads/${lead.id}/analyze`, { force: true })}
              >
                {busy === 'ai' && <Spinner />}
                تحلیل هوش مصنوعی
              </button>
            )}
          </>
        }
      />

      {/* Summary strip: the 30-second read. */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[auto_1fr_auto]">
        <Card className="flex items-center gap-5 px-5 py-4" padded={false}>
          <ScoreRing score={lead.leadScore} size={72} label="امتیاز فرصت" />
          <div className="space-y-1.5">
            <TemperatureBadge temperature={lead.leadTemperature} />
            <div>
              <BusinessValueBadge tier={lead.businessValueTier} />
            </div>
            <div>
              <WebsiteStatusBadge status={lead.websiteStatus} />
            </div>
            {lead.isDemo && (
              <div>
                <DemoBadge />
              </div>
            )}
          </div>
        </Card>

        <Card className="px-5 py-4" padded={false}>
          <p className="text-[11px] text-subtle">چرا باید تماس گرفت</p>
          {/* The full text lives on the brief tab; the header carries the five-second read. */}
          <p className="mt-1 line-clamp-3 text-sm leading-7">
            {data.currentBrief?.content.whyContactFa ?? 'گزارش فروش هنوز ساخته نشده است. ابتدا بررسی وب‌سایت را اجرا کنید.'}
          </p>
          {lead.recommendedService && (
            <p className="mt-2 text-xs text-muted">
              خدمت پیشنهادی: <span className="font-medium text-accent">{lead.recommendedServiceName}</span>
              {lead.secondaryServices.length > 0 && (
                <span className="text-subtle">
                  {' '}
                  • مکمل: {lead.secondaryServices.map((k) => data.services[k]?.nameFa ?? k).join('، ')}
                </span>
              )}
            </p>
          )}
        </Card>

        <Card className="px-5 py-4" padded={false}>
          <p className="mb-1.5 text-[11px] text-subtle">وضعیت فروش</p>
          <select
            className="input py-1.5 text-xs"
            value={lead.contactStatus}
            onChange={(e) => void changeStatus(e.target.value)}
          >
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] text-subtle">
            کارشناس: {lead.assignedTo?.name ?? 'واگذار نشده'}
          </p>
          {lead.nextFollowUpAt && (
            <p className="mt-0.5 text-[11px] text-subtle">پیگیری بعدی: {faDate(lead.nextFollowUpAt)}</p>
          )}
        </Card>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'overview' && <OverviewTab data={data} onReload={load} />}
        {tab === 'brief' && <BriefTab data={data} onReload={load} />}
        {tab === 'business' && <BusinessTab data={data} onReload={load} />}
        {tab === 'audit' && <AuditTab data={data} />}
        {tab === 'market' && <MarketTab data={data} />}
        {tab === 'ai' && <AiTab data={data} onReload={load} />}
        {tab === 'activity' && <ActivityTab leadId={lead.id} onReload={load} />}
        {tab === 'sources' && <SourcesTab data={data} />}
      </div>

      <LogCallModal
        open={callOpen}
        onClose={() => setCallOpen(false)}
        leadId={lead.id}
        phoneNumber={lead.normalizedPhone}
        onDone={() => {
          setCallOpen(false);
          void load();
          toast.show('تماس ثبت شد');
        }}
      />
    </>
  );
}
