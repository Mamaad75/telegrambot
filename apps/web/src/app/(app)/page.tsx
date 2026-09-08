'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PIPELINE_ORDER } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { BusinessValueBadge, CONTACT_STATUS_LABELS, TemperatureBadge, WebsiteStatusBadge } from '@/components/badges';
import { BarList, Donut, Funnel, StatTile } from '@/components/charts';
import { Card, EmptyState, ErrorNote, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faNumber, percent, phone } from '@/lib/format';

interface DashboardResponse {
  kpis: {
    totalLeads: number;
    hotLeads: number;
    warmLeads: number;
    readyToCall: number;
    callsToday: number;
    followUpsDue: number;
    followUpsOverdue: number;
    meetings: number;
    proposals: number;
    won: number;
    lost: number;
    conversionRate: number | null;
    leadsWithoutWebsite: number;
    auditedLeads: number;
    newLeadsInPeriod: number;
    wonInPeriod: number;
    periodDays: number;
  };
  charts: {
    pipeline: Array<{ status: string; count: number }>;
    temperature: Array<{ temperature: string; count: number }>;
    cities: Array<{ label: string; count: number }>;
    categories: Array<{ label: string; count: number }>;
    services: Array<{ key: string; label: string; count: number }>;
    sources: Array<{ label: string; count: number }>;
    scoreDistribution: Array<{ bucket: string; count: number }>;
    wonLost: Array<{ label: string; count: number }>;
  };
  hotList: Array<{
    id: string;
    businessName: string;
    city: string | null;
    leadScore: number | null;
    recommendedService: string | null;
    recommendedServiceName: string | null;
    normalizedPhone: string | null;
    websiteStatus: string;
    businessValueTier: string;
  }>;
}

interface MarketOverview {
  hasData: boolean;
  kpis: {
    topService: { key: string | null; name: string | null; strength: string } | null;
    topCity: { city: string } | null;
    topKeyword: { keyword: string; metricLabel: string } | null;
  };
  emptyStateHint: string | null;
}

const TEMPERATURE_LABELS: Record<string, string> = {
  HOT: 'داغ',
  WARM: 'گرم',
  MEDIUM: 'متوسط',
  LOW: 'کم',
  UNSCORED: 'امتیازدهی نشده',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboard, marketOverview] = await Promise.all([
        api.get<DashboardResponse>('/api/dashboard'),
        api.get<MarketOverview>('/api/market/overview').catch(() => null),
      ]);
      setData(dashboard);
      setMarket(marketOverview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت اطلاعات داشبورد ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data) return null;

  const { kpis, charts, hotList } = data;
  const hasLeads = kpis.totalLeads > 0;

  return (
    <>
      <PageHeader
        title="داشبورد"
        description="تصویر کلی از سرنخ‌ها، خط فروش و تقاضای بازار. اعداد فقط از داده‌های واقعی ثبت‌شده محاسبه می‌شوند."
        actions={
          <>
            <Link href="/leads?temperature=HOT" className="btn-ghost btn-sm">
              سرنخ‌های داغ
            </Link>
            <Link href="/campaigns" className="btn-primary btn-sm">
              کمپین جدید
            </Link>
          </>
        }
      />

      {!hasLeads ? (
        <Card>
          <EmptyState
            icon="◔"
            title="هنوز سرنخی ثبت نشده است"
            description="برای شروع، یک کمپین کشف کسب‌وکار بسازید یا فهرست موجود خود را از فایل CSV وارد کنید. اگر فقط می‌خواهید محصول را ببینید، داده نمونه را با دستور «npm run db:demo» فعال کنید."
            action={
              <div className="flex gap-2">
                <Link href="/campaigns" className="btn-primary btn-sm">
                  ساخت کمپین
                </Link>
                <Link href="/leads" className="btn-ghost btn-sm">
                  ورود فایل CSV
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {/* Sales KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="کل سرنخ‌ها" value={faNumber(kpis.totalLeads)} href="/leads" />
            <StatTile label="سرنخ داغ" value={faNumber(kpis.hotLeads)} tone="hot" href="/leads?temperature=HOT" />
            <StatTile label="سرنخ گرم" value={faNumber(kpis.warmLeads)} tone="warm" href="/leads?temperature=WARM" />
            <StatTile
              label="پیگیری سررسیدشده"
              value={faNumber(kpis.followUpsDue)}
              tone={kpis.followUpsOverdue > 0 ? 'danger' : 'default'}
              hint={kpis.followUpsOverdue > 0 ? `${faNumber(kpis.followUpsOverdue)} مورد عقب‌افتاده` : undefined}
              href="/tasks"
            />
            <StatTile label="تماس‌های امروز" value={faNumber(kpis.callsToday)} />
            <StatTile
              label="نرخ تبدیل"
              value={kpis.conversionRate === null ? '—' : percent(kpis.conversionRate, 1)}
              hint={
                kpis.conversionRate === null
                  ? 'هنوز معامله بسته‌شده‌ای ثبت نشده'
                  : `${faNumber(kpis.won)} برنده از ${faNumber(kpis.won + kpis.lost)} معامله بسته‌شده`
              }
              tone="success"
            />
          </div>

          {/* Market KPIs */}
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatTile
              label="بیشترین تقاضای خدمت"
              value={market?.kpis.topService?.name ?? '—'}
              hint={market?.hasData ? undefined : 'داده تقاضای بازار موجود نیست'}
            />
            <StatTile
              label="پرتقاضاترین شهر"
              value={market?.kpis.topCity?.city ?? '—'}
              hint={market?.hasData ? undefined : 'برای فعال‌سازی، داده کلیدواژه وارد کنید'}
            />
            <StatTile
              label="کلیدواژه شاخص"
              value={market?.kpis.topKeyword?.keyword ?? '—'}
              hint={market?.kpis.topKeyword?.metricLabel}
            />
          </div>

          {/* Charts */}
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card title="خط فروش" subtitle="تعداد سرنخ در هر مرحله" className="xl:col-span-2">
              <Funnel
                data={charts.pipeline.map((s) => ({
                  label: CONTACT_STATUS_LABELS[s.status as keyof typeof CONTACT_STATUS_LABELS] ?? s.status,
                  count: s.count,
                }))}
                hint="وقتی سرنخ‌ها وارد مراحل فروش شوند اینجا نمایش داده می‌شوند."
              />
            </Card>

            <Card title="دمای سرنخ‌ها" subtitle="بر پایه امتیاز محاسبه‌شده">
              <Donut
                data={charts.temperature.map((t) => ({
                  label: TEMPERATURE_LABELS[t.temperature] ?? t.temperature,
                  count: t.count,
                  color:
                    t.temperature === 'HOT'
                      ? 'rgb(var(--hot))'
                      : t.temperature === 'WARM'
                        ? 'rgb(var(--warm))'
                        : t.temperature === 'MEDIUM'
                          ? 'rgb(var(--medium))'
                          : 'rgb(var(--subtle))',
                }))}
              />
            </Card>

            <Card title="خدمات پیشنهادی" subtitle="خروجی موتور فرصت‌یابی">
              <BarList data={charts.services.map((s) => ({ label: s.label, count: s.count }))} />
            </Card>

            <Card title="شهرها" subtitle="پراکندگی جغرافیایی سرنخ‌ها">
              <BarList data={charts.cities} />
            </Card>

            <Card title="دسته‌های کسب‌وکار">
              <BarList data={charts.categories} />
            </Card>

            <Card title="توزیع امتیاز" subtitle="امتیاز فرصت فروش">
              <BarList
                data={charts.scoreDistribution.map((b) => ({
                  label: b.bucket === 'unscored' ? 'امتیازدهی نشده' : fa(b.bucket),
                  count: b.count,
                }))}
              />
            </Card>

            <Card title="منابع داده" subtitle="سرنخ‌ها از کجا آمده‌اند">
              <BarList data={charts.sources} hint="هر سرنخ منبع خود را نگه می‌دارد تا قابل راستی‌آزمایی باشد." />
            </Card>

            <Card title="وضعیت وب‌سایت" subtitle="نقطه شروع بیشتر فرصت‌های بایمر">
              <BarList
                data={[
                  { label: 'بدون وب‌سایت', count: kpis.leadsWithoutWebsite, color: 'rgb(var(--hot))' },
                  { label: 'بررسی‌شده', count: kpis.auditedLeads, color: 'rgb(var(--success))' },
                  {
                    label: 'بررسی نشده',
                    count: Math.max(0, kpis.totalLeads - kpis.auditedLeads - kpis.leadsWithoutWebsite),
                    color: 'rgb(var(--subtle))',
                  },
                ]}
              />
            </Card>
          </div>

          {/* Priority call list */}
          <Card
            className="mt-4"
            padded={false}
            title="امروز با چه کسانی تماس بگیریم"
            subtitle="سرنخ‌های داغ که هنوز تماسی با آن‌ها گرفته نشده"
            action={
              <Link href="/leads?temperature=HOT&contactStatus=NEW&contactStatus=READY_TO_CALL" className="btn-ghost btn-sm">
                همه
              </Link>
            }
          >
            {hotList.length === 0 ? (
              <EmptyState
                title="سرنخ داغی در انتظار تماس نیست"
                description="پس از اجرای یک کمپین یا بررسی وب‌سایت سرنخ‌های موجود، اولویت‌های تماس اینجا ظاهر می‌شوند."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="table-head">
                      <th className="px-5 py-2.5 text-start font-medium">کسب‌وکار</th>
                      <th className="px-3 py-2.5 text-start font-medium">شهر</th>
                      <th className="px-3 py-2.5 text-start font-medium">امتیاز</th>
                      <th className="px-3 py-2.5 text-start font-medium">وب‌سایت</th>
                      <th className="px-3 py-2.5 text-start font-medium">خدمت پیشنهادی</th>
                      <th className="px-3 py-2.5 text-start font-medium">ارزش</th>
                      <th className="px-5 py-2.5 text-start font-medium">تماس</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotList.map((lead) => (
                      <tr key={lead.id} className="border-t border-border hover:bg-surface-2/60">
                        <td className="px-5 py-2.5">
                          <Link href={`/leads/${lead.id}`} className="font-medium hover:text-accent">
                            {lead.businessName}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-muted">{lead.city ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className="tnum me-2 font-medium">{fa(lead.leadScore)}</span>
                          <TemperatureBadge temperature="HOT" />
                        </td>
                        <td className="px-3 py-2.5">
                          <WebsiteStatusBadge status={lead.websiteStatus as never} />
                        </td>
                        <td className="px-3 py-2.5 text-muted">{lead.recommendedServiceName ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <BusinessValueBadge tier={lead.businessValueTier as never} />
                        </td>
                        <td className="px-5 py-2.5">
                          {lead.normalizedPhone ? (
                            <a href={`tel:${lead.normalizedPhone}`} className="tnum text-accent hover:underline" dir="ltr">
                              {phone(lead.normalizedPhone)}
                            </a>
                          ) : (
                            <span className="text-subtle">نامشخص</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
