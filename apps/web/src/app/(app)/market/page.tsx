'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ALL_CITIES } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { DemandBadge } from '@/components/badges';
import { BarList, StatTile } from '@/components/charts';
import { Card, EmptyState, ErrorNote, Field, Loading, Modal, Spinner, Tabs, useToast } from '@/components/ui';
import { api, ApiError, downloadCsv } from '@/lib/api';
import { fa, faDate, faNumber } from '@/lib/format';
import { useSession } from '@/lib/session';

interface ServiceDemand {
  id: string;
  serviceKey: string | null;
  serviceName: string | null;
  city: string | null;
  strength: string;
  score: number | null;
  basis: string;
  confidence: string;
  sourceLabels: string[];
  sampleSize: number;
  totalClicks: number | null;
  totalImpressions: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

interface Overview {
  hasData: boolean;
  kpis: {
    topService: { key: string | null; name: string | null; strength: string } | null;
    topCity: { city: string } | null;
    topKeyword: { keyword: string; metricLabel: string } | null;
    keywordCount: number;
    searchTermCount: number;
    lastImportAt: string | null;
  };
  serviceDemand: ServiceDemand[];
  emptyStateHint: string | null;
}

interface KeywordRow {
  id: string;
  keyword: string;
  city: string | null;
  serviceKey: string | null;
  sourceLabel: string;
  searchVolume: number | null;
  competition: string | null;
  trend: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  date: string | null;
}

interface Opportunity {
  leadId: string;
  businessName: string;
  city: string | null;
  opportunityScore: number;
  level: string;
  reasons: string[];
  leadScore: number | null;
  businessValueTier: string;
}

/**
 * Market intelligence.
 *
 * Deliberately explicit about what this data is and is not: aggregate demand and
 * first-party advertising signals, never individual search activity.
 */
export default function MarketPage() {
  const session = useSession();
  const toast = useToast();

  const [tab, setTab] = useState('demand');
  const [city, setCity] = useState('');
  // Demo market signals are excluded by default, exactly like demo leads, so seeded data
  // can never be mistaken for real demand.
  const [includeDemo, setIncludeDemo] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [overviewData, keywordData] = await Promise.all([
        api.get<Overview>('/api/market/overview', { city: city || undefined, includeDemo: includeDemo || undefined }),
        api.get<{ items: KeywordRow[] }>('/api/market/keywords', {
          city: city || undefined,
          includeDemo: includeDemo || undefined,
          pageSize: 100,
        }),
      ]);
      setOverview(overviewData);
      setKeywords(keywordData.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت داده بازار ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, [city, includeDemo]);

  useEffect(() => {
    void load();
  }, [load]);

  const recompute = async () => {
    setBusy(true);
    try {
      await api.post('/api/market/recompute', { city: city || undefined, syncProviders: true });
      toast.show('محاسبه مجدد سیگنال‌های بازار در صف قرار گرفت.');
      setTimeout(() => void load(), 5000);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'محاسبه ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadOpportunities = async (serviceKey: string) => {
    setSelectedService(serviceKey);
    setOpportunities(null);
    try {
      const data = await api.get<{ items: Opportunity[] }>('/api/market/opportunities', {
        serviceKey,
        city: city || undefined,
        includeDemo: includeDemo || undefined,
        limit: 30,
      });
      setOpportunities(data.items);
    } catch {
      setOpportunities([]);
    }
  };

  if (loading && !overview) return <Loading />;

  return (
    <>
      {toast.node}
      <PageHeader
        title="هوشمندی بازار"
        description="سیگنال‌های تقاضا از داده تجمیعی کلیدواژه و داده تبلیغاتی خود بایمر. این بخش هرگز فعالیت جست‌وجوی افراد مشخص را نشان نمی‌دهد."
        actions={
          <>
            <select className="input max-w-[10rem] py-1.5 text-xs" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">همه شهرها</option>
              {ALL_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
              نمایش داده نمونه
            </label>
            {session.can('market:import') && (
              <>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
                  ورود کلیدواژه
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={recompute} disabled={busy}>
                  {busy && <Spinner />}
                  محاسبه مجدد
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => downloadCsv('/api/market/export', `baimar-market-${new Date().toISOString().slice(0, 10)}.csv`)}
            >
              خروجی CSV
            </button>
          </>
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      {overview && !overview.hasData ? (
        <Card>
          <EmptyState
            icon="↗"
            title="هنوز سیگنال تقاضایی ثبت نشده است"
            description={
              overview.emptyStateHint ??
              'برای فعال شدن این بخش، یک فایل کلیدواژه وارد کنید یا اتصال گوگل ادز / سرچ کنسول را در تنظیمات فعال کنید. تا وقتی داده‌ای نباشد، هیچ عددی ساخته نمی‌شود.'
            }
            action={
              session.can('market:import') && (
                <div className="flex gap-2">
                  <button type="button" className="btn-primary btn-sm" onClick={() => setImportOpen(true)}>
                    ورود فایل کلیدواژه
                  </button>
                  <Link href="/admin/providers" className="btn-ghost btn-sm">
                    اتصال گوگل ادز
                  </Link>
                </div>
              )
            }
          />
        </Card>
      ) : (
        overview && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatTile label="بیشترین تقاضا" value={overview.kpis.topService?.name ?? '—'} />
              <StatTile label="پرتقاضاترین شهر" value={overview.kpis.topCity?.city ?? '—'} />
              <StatTile label="کلیدواژه شاخص" value={overview.kpis.topKeyword?.keyword ?? '—'} hint={overview.kpis.topKeyword?.metricLabel} />
              <StatTile label="کلیدواژه‌های ثبت‌شده" value={faNumber(overview.kpis.keywordCount)} />
              <StatTile
                label="عبارت‌های تبلیغاتی"
                value={faNumber(overview.kpis.searchTermCount)}
                hint={overview.kpis.lastImportAt ? `آخرین ورود: ${faDate(overview.kpis.lastImportAt)}` : undefined}
              />
            </div>

            <div className="mt-4">
              <Tabs
                tabs={[
                  { key: 'demand', label: 'تقاضای خدمات' },
                  { key: 'keywords', label: 'کلیدواژه‌ها', badge: keywords.length },
                  { key: 'opportunities', label: 'تطبیق با سرنخ‌ها' },
                ]}
                active={tab}
                onChange={setTab}
              />
            </div>

            <div className="mt-4">
              {tab === 'demand' && (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
                  <Card title="سیگنال تقاضا به تفکیک خدمت" padded={false}>
                    <ul className="divide-y divide-border">
                      {overview.serviceDemand.map((signal) => (
                        <li key={signal.id} className="px-5 py-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">
                                {signal.serviceName ?? signal.serviceKey}
                                {signal.city && <span className="ms-2 text-[11px] text-subtle">{signal.city}</span>}
                              </p>
                              <p className="mt-0.5 text-[11px] leading-6 text-subtle">{signal.basis}</p>
                              <p className="mt-0.5 text-[11px] text-subtle">
                                منابع: {signal.sourceLabels.join('، ') || '—'}
                                {signal.periodStart && signal.periodEnd && (
                                  <span> • {faDate(signal.periodStart)} تا {faDate(signal.periodEnd)}</span>
                                )}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <DemandBadge strength={signal.strength} />
                              {signal.serviceKey && (
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  onClick={() => {
                                    setTab('opportunities');
                                    void loadOpportunities(signal.serviceKey!);
                                  }}
                                >
                                  سرنخ‌های مرتبط
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>

                  <Card title="بیشترین نمایش کلیدواژه‌ها">
                    <BarList
                      data={keywords
                        .filter((k) => k.impressions !== null || k.searchVolume !== null)
                        .slice(0, 10)
                        .map((k) => ({ label: k.keyword, count: k.impressions ?? k.searchVolume ?? 0 }))}
                      hint="پس از ورود داده کلیدواژه نمایش داده می‌شود."
                    />
                  </Card>
                </div>
              )}

              {tab === 'keywords' && (
                <Card padded={false}>
                  {keywords.length === 0 ? (
                    <EmptyState title="کلیدواژه‌ای ثبت نشده است" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[52rem] text-sm">
                        <thead className="table-head">
                          <tr>
                            <th className="px-5 py-2.5 text-start font-medium">کلیدواژه</th>
                            <th className="px-3 py-2.5 text-start font-medium">شهر</th>
                            <th className="px-3 py-2.5 text-start font-medium">منبع</th>
                            <th className="px-3 py-2.5 text-start font-medium">حجم جست‌وجو</th>
                            <th className="px-3 py-2.5 text-start font-medium">نمایش</th>
                            <th className="px-3 py-2.5 text-start font-medium">کلیک</th>
                            <th className="px-3 py-2.5 text-start font-medium">رقابت</th>
                            <th className="px-5 py-2.5 text-start font-medium">روند</th>
                          </tr>
                        </thead>
                        <tbody>
                          {keywords.map((row) => (
                            <tr key={row.id} className="border-t border-border">
                              <td className="px-5 py-2.5 font-medium">{row.keyword}</td>
                              <td className="px-3 py-2.5 text-muted">{row.city ?? '—'}</td>
                              <td className="px-3 py-2.5 text-subtle">{row.sourceLabel}</td>
                              <td className="tnum px-3 py-2.5">
                                {row.searchVolume !== null ? faNumber(row.searchVolume) : <span className="text-subtle">در دسترس نیست</span>}
                              </td>
                              <td className="tnum px-3 py-2.5">{row.impressions !== null ? faNumber(row.impressions) : '—'}</td>
                              <td className="tnum px-3 py-2.5">{row.clicks !== null ? faNumber(row.clicks) : '—'}</td>
                              <td className="px-3 py-2.5 text-muted">{row.competition ?? '—'}</td>
                              <td className="px-5 py-2.5 text-muted">
                                {row.trend
                                  ? { RISING: 'صعودی', FALLING: 'نزولی', STABLE: 'پایدار' }[row.trend] ?? row.trend
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {tab === 'opportunities' && (
                <Card
                  title="تطبیق تقاضای بازار با سرنخ‌ها"
                  subtitle="کسب‌وکارهایی که این خدمت را ندارند و از نظر تجاری جذاب هستند"
                >
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {overview.serviceDemand
                      .filter((s) => s.serviceKey)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => void loadOpportunities(s.serviceKey!)}
                          className={`chip border transition-colors ${
                            selectedService === s.serviceKey
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-border bg-surface-2 text-muted hover:border-accent/40'
                          }`}
                        >
                          {s.serviceName ?? s.serviceKey}
                        </button>
                      ))}
                  </div>

                  {!selectedService ? (
                    <EmptyState title="یک خدمت را انتخاب کنید" description="سرنخ‌هایی که این خدمت برایشان بیشترین فرصت را دارد نمایش داده می‌شوند." />
                  ) : opportunities === null ? (
                    <Loading />
                  ) : opportunities.length === 0 ? (
                    <EmptyState
                      title="سرنخ مرتبطی یافت نشد"
                      description="هیچ سرنخ فعالی با این فرصت تطبیق داده نشده است. ابتدا کمپینی اجرا کنید یا بررسی وب‌سایت سرنخ‌های موجود را انجام دهید."
                    />
                  ) : (
                    <ul className="divide-y divide-border">
                      {opportunities.map((item) => (
                        <li key={item.leadId} className="flex flex-wrap items-start justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <Link href={`/leads/${item.leadId}`} className="text-sm font-medium hover:text-accent">
                              {item.businessName}
                            </Link>
                            <p className="text-[11px] text-subtle">{item.city ?? '—'}</p>
                            <ul className="mt-1 space-y-0.5 text-[11px] leading-6 text-subtle">
                              {item.reasons.slice(0, 2).map((reason) => (
                                <li key={reason}>• {reason}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="tnum text-xs text-subtle">امتیاز سرنخ {fa(item.leadScore)}</span>
                            <DemandBadge strength={item.level} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </>
        )
      )}

      <KeywordImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          toast.show('داده کلیدواژه وارد شد');
          setTimeout(() => void load(), 3000);
        }}
      />
    </>
  );
}

function KeywordImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [source, setSource] = useState('MANUAL_IMPORT');
  const [asSearchTerms, setAsSearchTerms] = useState(false);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ keywordsStored: number; searchTermsStored: number; total: number } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ keywordsStored: number; searchTermsStored: number; total: number }>('/api/market/import', {
        content,
        filename,
        source,
        asSearchTerms,
        city: city || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ورود داده ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ورود داده کلیدواژه"
      footer={
        result ? (
          <div className="flex justify-end">
            <button type="button" className="btn-primary btn-sm" onClick={onDone}>
              بستن
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              انصراف
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy || !content}>
              {busy && <Spinner />}
              ورود
            </button>
          </div>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p>
            از {faNumber(result.total)} ردیف، {faNumber(result.keywordsStored)} کلیدواژه و {faNumber(result.searchTermsStored)}{' '}
            عبارت جست‌وجو ثبت شد.
          </p>
          <p className="text-xs leading-6 text-subtle">
            سیگنال‌های تقاضا به‌صورت خودکار بازمحاسبه می‌شوند. اگر داده کافی نباشد، وضعیت «داده کافی نیست» نمایش داده
            می‌شود — هیچ عددی ساخته نمی‌شود.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field
            label="فایل CSV"
            hint="خروجی Keyword Planner، گزارش عبارت‌های جست‌وجوی گوگل ادز، یا هر فایلی با ستون کلیدواژه."
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setContent(await file.text());
                setFilename(file.name);
              }}
            />
          </Field>

          <Field label="منبع داده">
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="MANUAL_IMPORT">ورود دستی / تحقیق کلیدواژه</option>
              <option value="GOOGLE_ADS">خروجی گوگل ادز</option>
              <option value="SEARCH_CONSOLE">خروجی سرچ کنسول</option>
              <option value="PROVIDER">ارائه‌دهنده داده کلیدواژه</option>
            </select>
          </Field>

          <Field label="شهر (اختیاری)" hint="برای ردیف‌هایی که ستون شهر ندارند.">
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>

          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" className="mt-0.5" checked={asSearchTerms} onChange={(e) => setAsSearchTerms(e.target.checked)} />
            <span>
              این فایل «عبارت‌های جست‌وجویی» است که تبلیغات بایمر را فعال کرده‌اند
              <span className="block text-[11px] text-subtle">
                این داده به‌عنوان داده تبلیغاتی بایمر برچسب می‌خورد، نه سیگنال عمومی بازار.
              </span>
            </span>
          </label>

          {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
