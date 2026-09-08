'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { BarList } from '@/components/charts';
import { Card, EmptyState, ErrorNote, Loading, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, faNumber } from '@/lib/format';
import { useSession } from '@/lib/session';

interface RunLogEntry {
  at: string;
  stage: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

interface Run {
  id: string;
  status: string;
  stage: string | null;
  progress: number;
  collected: number;
  unique: number;
  merged: number;
  qualified: number;
  hot: number;
  warm: number;
  medium: number;
  low: number;
  rejected: number;
  errors: number;
  log: RunLogEntry[] | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface CampaignDetail {
  campaign: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    city: string | null;
    province: string | null;
    categories: string[];
    providers: string[];
    websiteFilter: string;
    minLeadScore: number | null;
    maxResults: number;
    enableAi: boolean;
    leadCount: number;
    createdAt: string;
    lastRunAt: string | null;
    runs: Run[];
  };
  temperatureBreakdown: Array<{ temperature: string | null; count: number }>;
}

const LEVEL_STYLES: Record<string, string> = {
  info: 'text-subtle',
  warn: 'text-warning',
  error: 'text-danger',
};

const TEMPERATURE_LABELS: Record<string, string> = { HOT: 'داغ', WARM: 'گرم', MEDIUM: 'متوسط', LOW: 'کم' };

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const session = useSession();
  const toast = useToast();
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<CampaignDetail>(`/api/campaigns/${params.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت کمپین ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestRun = data?.campaign.runs[0];
  const isRunning = latestRun && ['QUEUED', 'RUNNING'].includes(latestRun.status);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [isRunning, load]);

  const run = async () => {
    setBusy(true);
    try {
      await api.post(`/api/campaigns/${params.id}/run`);
      toast.show('اجرای کمپین شروع شد');
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'اجرا ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (runId: string) => {
    await api.post(`/api/campaigns/${params.id}/runs/${runId}/cancel`).catch(() => undefined);
    toast.show('اجرا لغو شد');
    await load();
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data) return null;

  const campaign = data.campaign;

  return (
    <>
      {toast.node}
      <div className="mb-4 flex items-center gap-2 text-xs text-subtle">
        <Link href="/campaigns" className="hover:text-fg">
          کمپین‌ها
        </Link>
        <span>/</span>
        <span className="text-fg">{campaign.name}</span>
      </div>

      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        actions={
          <>
            <Link href={`/leads?campaignId=${campaign.id}`} className="btn-ghost btn-sm">
              {faNumber(campaign.leadCount)} سرنخ
            </Link>
            {session.can('campaign:run') && !isRunning && (
              <button type="button" className="btn-primary btn-sm" onClick={run} disabled={busy}>
                {busy && <Spinner />}
                اجرای دوباره
              </button>
            )}
            {isRunning && latestRun && (
              <button type="button" className="btn-danger btn-sm" onClick={() => void cancel(latestRun.id)}>
                لغو اجرا
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {latestRun && (
            <Card
              title="آخرین اجرا"
              subtitle={
                latestRun.startedAt
                  ? `${faDate(latestRun.startedAt, true)}${latestRun.finishedAt ? ` تا ${faDate(latestRun.finishedAt, true)}` : ''}`
                  : undefined
              }
            >
              {isRunning && (
                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-subtle">
                    <span>{latestRun.stage ?? 'در حال اجرا'}</span>
                    <span className="tnum">{fa(latestRun.progress)}٪</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${latestRun.progress}%` }} />
                  </div>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="جمع‌آوری‌شده" value={latestRun.collected} />
                <Stat label="یکتا" value={latestRun.unique} />
                <Stat label="ادغام‌شده" value={latestRun.merged} />
                <Stat label="واجد شرایط" value={latestRun.qualified} tone="text-success" />
                <Stat label="داغ" value={latestRun.hot} tone="text-hot" />
                <Stat label="گرم" value={latestRun.warm} tone="text-warm" />
                <Stat label="رد شده" value={latestRun.rejected} />
                <Stat label="خطا" value={latestRun.errors} tone={latestRun.errors ? 'text-danger' : 'text-fg'} />
              </dl>

              {latestRun.error && (
                <p className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs leading-6 text-danger">{latestRun.error}</p>
              )}
            </Card>
          )}

          <Card title="گزارش اجرا" subtitle="مراحل خط لوله به ترتیب زمان" padded={false}>
            {!latestRun?.log || latestRun.log.length === 0 ? (
              <EmptyState title="گزارشی ثبت نشده است" description="پس از اجرای کمپین، جزئیات هر مرحله اینجا ثبت می‌شود." />
            ) : (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {[...latestRun.log].reverse().map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="flex items-start gap-3 px-5 py-2.5 text-xs">
                    <span className="chip shrink-0 bg-surface-2 text-subtle">{entry.stage}</span>
                    <span className={`flex-1 leading-6 ${LEVEL_STYLES[entry.level]}`}>{entry.message}</span>
                    <span className="shrink-0 text-[11px] text-subtle">{faDate(entry.at, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="تنظیمات کمپین">
            <dl className="space-y-2.5 text-xs">
              <Row label="محدوده" value={[campaign.city, campaign.province].filter(Boolean).join('، ') || 'بدون محدوده'} />
              <Row label="دسته‌ها" value={campaign.categories.join('، ') || '—'} />
              <Row label="منابع" value={campaign.providers.length ? campaign.providers.join('، ') : 'همه منابع فعال'} />
              <Row
                label="فیلتر وب‌سایت"
                value={{ ANY: 'هر وضعیتی', NO_WEBSITE: 'فقط بدون وب‌سایت', HAS_WEBSITE: 'فقط دارای وب‌سایت' }[campaign.websiteFilter] ?? campaign.websiteFilter}
              />
              <Row label="حداقل امتیاز" value={campaign.minLeadScore !== null ? fa(campaign.minLeadScore) : '—'} />
              <Row label="سقف نتایج" value={fa(campaign.maxResults)} />
              <Row label="تحلیل هوش مصنوعی" value={campaign.enableAi ? 'فعال' : 'غیرفعال'} />
            </dl>
          </Card>

          <Card title="دمای سرنخ‌های این کمپین">
            <BarList
              data={data.temperatureBreakdown
                .filter((t) => t.temperature)
                .map((t) => ({
                  label: TEMPERATURE_LABELS[t.temperature!] ?? t.temperature!,
                  count: t.count,
                  color:
                    t.temperature === 'HOT'
                      ? 'rgb(var(--hot))'
                      : t.temperature === 'WARM'
                        ? 'rgb(var(--warm))'
                        : 'rgb(var(--medium))',
                }))}
              hint="پس از امتیازدهی سرنخ‌ها نمایش داده می‌شود."
            />
          </Card>

          {campaign.runs.length > 1 && (
            <Card title="اجراهای قبلی" padded={false}>
              <ul className="divide-y divide-border">
                {campaign.runs.slice(1).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-xs">
                    <span className="text-muted">{faDate(r.createdAt, true)}</span>
                    <span className="text-subtle">
                      {faNumber(r.unique)} یکتا • {faNumber(r.hot)} داغ
                    </span>
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

function Stat({ label, value, tone = 'text-fg' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-center">
      <dt className="text-[11px] text-subtle">{label}</dt>
      <dd className={`tnum mt-0.5 text-lg font-semibold ${tone}`}>{faNumber(value)}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="shrink-0 text-subtle">{label}</dt>
      <dd className="text-end text-fg">{value}</dd>
    </div>
  );
}
