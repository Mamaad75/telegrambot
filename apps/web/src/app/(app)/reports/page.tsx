'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarList, Funnel } from '@/components/charts';
import { PageHeader } from '@/components/app-shell';
import { Card, EmptyState, ErrorNote, Loading, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { faDate, faNumber } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * Reports.
 *
 * The rule that shapes every table here: a rate computed from three leads is noise, and
 * printing "0% win rate" next to a service that has been pitched twice would send
 * somebody to change a price for no reason. The API returns null for any rate below its
 * minimum sample, and this page renders that as "داده کافی نیست" — never as a zero.
 */

interface Summary {
  days: number;
  minSampleForRate: number;
  acquisition: Array<{ date: string; created: number; qualified: number; hot: number }>;
  quality: {
    total: number;
    scored: number;
    unscored: number;
    withPhone: number;
    withWebsite: number;
    withoutWebsite: number;
    audited: number;
    averageScore: number | null;
    byTemperature: Array<{ temperature: string; count: number; share: number | null }>;
    blockers: Array<{ reason: string; count: number }>;
  };
  conversion: {
    stages: Array<{ key: string; labelFa: string; count: number; shareOfTotal: number | null }>;
    contactRate: number | null;
    meetingRate: number | null;
    proposalRate: number | null;
    winRate: number | null;
    medianDaysToWin: number | null;
    sampleSize: number;
  };
  sources: Array<{
    providerKey: string;
    displayName: string;
    leads: number;
    qualified: number;
    hot: number;
    contacted: number;
    won: number;
    qualifiedRate: number | null;
    contactRate: number | null;
    winRate: number | null;
  }>;
  services: Array<{
    serviceKey: string;
    nameFa: string;
    leads: number;
    contacted: number;
    meetings: number;
    proposals: number;
    won: number;
    contactRate: number | null;
    winRate: number | null;
  }>;
  campaigns: Array<{
    campaignId: string;
    name: string;
    city: string | null;
    runs: number;
    collected: number;
    unique: number;
    qualified: number;
    hot: number;
    failed: number;
    errors: number;
    lastRunAt: string | null;
    lastStatus: string | null;
    yieldRate: number | null;
  }>;
  demand: Array<{
    serviceKey: string;
    nameFa: string;
    recommendedFor: number;
    marketStrength: string | null;
    marketQuality: string | null;
    marketBasis: string | null;
  }>;
}

const RANGES = [
  { days: 7, label: '۷ روز' },
  { days: 30, label: '۳۰ روز' },
  { days: 90, label: '۹۰ روز' },
  { days: 365, label: 'یک سال' },
];

/** A percentage, or an explicit "not enough data" — never a misleading zero. */
function Pct({ value, sample, min }: { value: number | null; sample?: number; min: number }) {
  if (value === null) {
    return (
      <span
        className="text-subtle"
        title={
          sample !== undefined
            ? `فقط ${sample} مورد در این بازه — برای محاسبهٔ نرخ حداقل ${min} مورد لازم است.`
            : `برای محاسبهٔ نرخ حداقل ${min} مورد لازم است.`
        }
      >
        داده کافی نیست
      </span>
    );
  }
  return <span className="tnum font-medium">{faNumber(value)}٪</span>;
}

export default function ReportsPage() {
  const session = useSession();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState('funnel');
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Summary>(`/api/reports/summary?days=${days}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'گزارش‌ها بارگذاری نشد');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session.can('report:read')) {
    return (
      <Card>
        <EmptyState title="دسترسی ندارید" description="مشاهده گزارش‌ها برای نقش شما فعال نیست." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="گزارش‌ها"
        description="عملکرد واقعی خط لولهٔ فروش: کدام منبع، کدام خدمت، و کجا متوقف می‌شود"
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                className={days === r.days ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => setDays(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <p className="text-[11px] text-subtle">سرنخ جمع‌آوری‌شده</p>
              <p className="tnum mt-1 text-2xl font-semibold">{faNumber(data.quality.total)}</p>
            </Card>
            <Card>
              <p className="text-[11px] text-subtle">میانگین امتیاز</p>
              <p className="tnum mt-1 text-2xl font-semibold">
                {data.quality.averageScore === null ? <span className="text-base text-subtle">نامشخص</span> : faNumber(data.quality.averageScore)}
              </p>
            </Card>
            <Card>
              <p className="text-[11px] text-subtle">نرخ تماس</p>
              <p className="mt-1 text-2xl font-semibold">
                <Pct value={data.conversion.contactRate} sample={data.conversion.sampleSize} min={data.minSampleForRate} />
              </p>
            </Card>
            <Card>
              <p className="text-[11px] text-subtle">نرخ برد (از معاملات بسته‌شده)</p>
              <p className="mt-1 text-2xl font-semibold">
                <Pct value={data.conversion.winRate} min={data.minSampleForRate} />
              </p>
            </Card>
          </div>

          <Tabs
            tabs={[
              { key: 'funnel', label: 'قیف فروش' },
              { key: 'sources', label: 'عملکرد منابع', badge: data.sources.length },
              { key: 'services', label: 'عملکرد خدمات', badge: data.services.length },
              { key: 'acquisition', label: 'روند جذب' },
              { key: 'campaigns', label: 'کمپین‌ها', badge: data.campaigns.length },
              { key: 'demand', label: 'تقاضا در برابر عرضه' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'funnel' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="قیف فروش" subtitle={`${data.days} روز گذشته`}>
                <Funnel
                  data={data.conversion.stages.map((s) => ({ label: s.labelFa, count: s.count }))}
                  hint="پس از ثبت اولین تماس‌ها پر می‌شود."
                />
                {data.conversion.medianDaysToWin !== null && (
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
                    میانهٔ زمان تا بستن قرارداد: <span className="tnum font-medium">{faNumber(data.conversion.medianDaysToWin)}</span> روز
                  </p>
                )}
              </Card>

              <Card title="کیفیت سرنخ‌ها">
                <dl className="space-y-2 text-sm">
                  {[
                    ['امتیازدهی‌شده', data.quality.scored],
                    ['دارای شماره تماس', data.quality.withPhone],
                    ['دارای وب‌سایت', data.quality.withWebsite],
                    ['بدون وب‌سایت (فرصت اصلی)', data.quality.withoutWebsite],
                    ['وب‌سایت بررسی‌شده', data.quality.audited],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex items-center justify-between gap-3">
                      <dt className="text-muted">{label}</dt>
                      <dd className="tnum font-medium">
                        {faNumber(value as number)}
                        <span className="ms-1.5 text-[11px] text-subtle">
                          <Pct
                            value={data.quality.total >= data.minSampleForRate ? Math.round(((value as number) / data.quality.total) * 1000) / 10 : null}
                            sample={data.quality.total}
                            min={data.minSampleForRate}
                          />
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>

                {data.quality.blockers.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="mb-1.5 text-[11px] font-medium text-subtle">چه چیزی جلوی پیشرفت را گرفته است</p>
                    <ul className="space-y-1">
                      {data.quality.blockers.map((b) => (
                        <li key={b.reason} className="flex justify-between gap-3 text-xs leading-6">
                          <span className="text-muted">{b.reason}</span>
                          <span className="tnum shrink-0">{faNumber(b.count)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>
          )}

          {tab === 'sources' && (
            <Card
              title="کدام منبع واقعاً ارزش دارد"
              subtitle="تعداد سرنخ به‌تنهایی گمراه‌کننده است؛ هر منبع تا مرحلهٔ بستن قرارداد دنبال شده است"
              padded={false}
            >
              {data.sources.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="هنوز داده‌ای نیست" description="پس از اجرای اولین کمپین یا ورود CSV پر می‌شود." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] text-subtle">
                        <th className="px-4 py-2.5 text-start font-medium">منبع</th>
                        <th className="px-4 py-2.5 text-start font-medium">سرنخ</th>
                        <th className="px-4 py-2.5 text-start font-medium">واجد شرایط</th>
                        <th className="px-4 py-2.5 text-start font-medium">داغ</th>
                        <th className="px-4 py-2.5 text-start font-medium">تماس‌گرفته</th>
                        <th className="px-4 py-2.5 text-start font-medium">برنده</th>
                        <th className="px-4 py-2.5 text-start font-medium">نرخ واجد شرایط</th>
                        <th className="px-4 py-2.5 text-start font-medium">نرخ برد</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.sources.map((s) => (
                        <tr key={s.providerKey}>
                          <td className="px-4 py-2.5 font-medium">{s.displayName}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.leads)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.qualified)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.hot)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.contacted)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.won)}</td>
                          <td className="px-4 py-2.5"><Pct value={s.qualifiedRate} sample={s.leads} min={data.minSampleForRate} /></td>
                          <td className="px-4 py-2.5"><Pct value={s.winRate} sample={s.contacted} min={data.minSampleForRate} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'services' && (
            <Card
              title="کدام خدمت را واقعاً می‌فروشیم"
              subtitle="فاصلهٔ میان آنچه موتور پیشنهاد می‌دهد و آنچه بسته می‌شود"
              padded={false}
            >
              {data.services.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="هنوز خدمتی پیشنهاد نشده است" description="پس از امتیازدهی اولین سرنخ‌ها پر می‌شود." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] text-subtle">
                        <th className="px-4 py-2.5 text-start font-medium">خدمت</th>
                        <th className="px-4 py-2.5 text-start font-medium">پیشنهاد شده</th>
                        <th className="px-4 py-2.5 text-start font-medium">تماس</th>
                        <th className="px-4 py-2.5 text-start font-medium">جلسه</th>
                        <th className="px-4 py-2.5 text-start font-medium">پیشنهاد قیمت</th>
                        <th className="px-4 py-2.5 text-start font-medium">برنده</th>
                        <th className="px-4 py-2.5 text-start font-medium">نرخ برد</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.services.map((s) => (
                        <tr key={s.serviceKey}>
                          <td className="px-4 py-2.5 font-medium">{s.nameFa}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.leads)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.contacted)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.meetings)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.proposals)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(s.won)}</td>
                          <td className="px-4 py-2.5"><Pct value={s.winRate} sample={s.proposals} min={data.minSampleForRate} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'acquisition' && (
            <Card title="روند جذب سرنخ" subtitle={`${data.days} روز گذشته`}>
              <BarList
                data={data.acquisition
                  .filter((p) => p.created > 0)
                  .slice(-20)
                  .map((p) => ({ label: faDate(p.date), count: p.created }))}
                hint="در این بازه سرنخی ثبت نشده است."
                max={20}
              />
            </Card>
          )}

          {tab === 'campaigns' && (
            <Card title="عملکرد کمپین‌ها" padded={false}>
              {data.campaigns.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="کمپینی در این بازه اجرا نشده است" description="یک کمپین بسازید و اجرا کنید." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] text-subtle">
                        <th className="px-4 py-2.5 text-start font-medium">کمپین</th>
                        <th className="px-4 py-2.5 text-start font-medium">اجرا</th>
                        <th className="px-4 py-2.5 text-start font-medium">جمع‌آوری</th>
                        <th className="px-4 py-2.5 text-start font-medium">یکتا</th>
                        <th className="px-4 py-2.5 text-start font-medium">داغ</th>
                        <th className="px-4 py-2.5 text-start font-medium">ناموفق</th>
                        <th className="px-4 py-2.5 text-start font-medium">بازده</th>
                        <th className="px-4 py-2.5 text-start font-medium">آخرین وضعیت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.campaigns.map((c) => (
                        <tr key={c.campaignId}>
                          <td className="px-4 py-2.5">
                            <span className="font-medium">{c.name}</span>
                            {c.city && <span className="ms-2 text-[11px] text-subtle">{c.city}</span>}
                          </td>
                          <td className="tnum px-4 py-2.5">{faNumber(c.runs)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(c.collected)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(c.unique)}</td>
                          <td className="tnum px-4 py-2.5">{faNumber(c.hot)}</td>
                          <td className="tnum px-4 py-2.5">
                            {c.failed > 0 ? <span className="text-warning">{faNumber(c.failed)}</span> : faNumber(0)}
                          </td>
                          <td className="px-4 py-2.5"><Pct value={c.yieldRate} sample={c.collected} min={data.minSampleForRate} /></td>
                          <td className="px-4 py-2.5 text-[11px] text-subtle">
                            {c.lastStatus === 'COMPLETED_WITH_ERRORS' ? 'کامل شد — با خطا' : c.lastStatus ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'demand' && (
            <Card
              title="تقاضای بازار در برابر سرنخ‌های موجود"
              subtitle="خدمتی با سرنخ زیاد و سیگنال قوی، مقصد کمپین بعدی است"
              padded={false}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-subtle">
                      <th className="px-4 py-2.5 text-start font-medium">خدمت</th>
                      <th className="px-4 py-2.5 text-start font-medium">سرنخ منتظر</th>
                      <th className="px-4 py-2.5 text-start font-medium">سیگنال بازار</th>
                      <th className="px-4 py-2.5 text-start font-medium">مبنا</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.demand.map((d) => (
                      <tr key={d.serviceKey}>
                        <td className="px-4 py-2.5 font-medium">{d.nameFa}</td>
                        <td className="tnum px-4 py-2.5">{faNumber(d.recommendedFor)}</td>
                        <td className="px-4 py-2.5">
                          {/* Null means nobody has measured — which is not the same as
                              having measured and found little demand. */}
                          {d.marketStrength ? (
                            <span className="chip bg-info/10 text-info">{d.marketStrength}</span>
                          ) : (
                            <span className="text-subtle" title="سیگنالی برای این خدمت محاسبه نشده است.">
                              اندازه‌گیری نشده
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] leading-6 text-subtle">{d.marketBasis ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
