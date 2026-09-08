'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { StatTile } from '@/components/charts';
import { Card, EmptyState, ErrorNote, Loading, Spinner, Tabs, Toggle, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, faNumber, usd } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Provider {
  key: string;
  kind: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  state: string;
  requiredConfig: string[];
  missingConfig: string[];
  cost: string;
  docsUrl: string | null;
  attribution: string | null;
  priority: number;
  rateLimits: { perMinute: number | null; perHour: number | null; perDay: number | null };
  lastError: string | null;
  lastErrorAt: string | null;
  lastUsedAt: string | null;
}

interface Usage {
  items: Array<{
    providerKey: string;
    displayName: string;
    kind: string;
    requestsToday: number;
    failuresToday: number;
    requestsThisMonth: number;
    failuresThisMonth: number;
    tokensThisMonth: number;
    estimatedCostThisMonthUsd: number;
    lastUsedAt: string | null;
  }>;
  totals: { requestsToday: number; requestsThisMonth: number; failuresThisMonth: number; estimatedAiCostThisMonthUsd: number };
  costNote: string;
}

const KIND_LABELS: Record<string, string> = {
  LEAD_SOURCE: 'منبع سرنخ',
  SEARCH: 'موتور جست‌وجو',
  BUSINESS_DATA: 'داده کسب‌وکار',
  WEBSITE: 'خزنده وب',
  AI: 'هوش مصنوعی',
  KEYWORD_INSIGHT: 'داده کلیدواژه',
  NOTIFICATION: 'اعلان',
};

const STATE_LABELS: Record<string, { label: string; className: string }> = {
  CONFIGURED: { label: 'پیکربندی‌شده', className: 'bg-success/10 text-success' },
  NOT_CONFIGURED: { label: 'پیکربندی نشده', className: 'bg-warning/10 text-warning' },
  DISABLED: { label: 'غیرفعال', className: 'bg-surface-2 text-subtle' },
  ERROR: { label: 'خطا', className: 'bg-danger/10 text-danger' },
};

const COST_LABELS: Record<string, string> = { FREE: 'رایگان', PAID: 'پولی', FREEMIUM: 'رایگان تا سقف مشخص' };

/**
 * Integrations. The point of this screen is that nothing here is required: every provider
 * can be off, and the platform keeps working with reduced capability.
 */
export default function ProvidersPage() {
  const session = useSession();
  const toast = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tab, setTab] = useState('providers');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [providerData, usageData] = await Promise.all([
        api.get<{ items: Provider[] }>('/api/providers'),
        api.get<Usage>('/api/providers/usage').catch(() => null),
      ]);
      setProviders(providerData.items);
      setUsage(usageData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت یکپارچه‌سازی‌ها ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: string, enabled: boolean) => {
    try {
      await api.patch(`/api/providers/${key}`, { enabled });
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'تغییر وضعیت ناموفق بود', 'error');
    }
  };

  const test = async (key: string) => {
    setTesting(key);
    try {
      const result = await api.post<{ ok: boolean; message: string; durationMs?: number }>(`/api/providers/${key}/test`);
      toast.show(result.message, result.ok ? 'ok' : 'error');
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'آزمایش ناموفق بود', 'error');
    } finally {
      setTesting(null);
    }
  };

  if (loading) return <Loading />;

  const byKind = providers.reduce<Record<string, Provider[]>>((acc, provider) => {
    (acc[provider.kind] ??= []).push(provider);
    return acc;
  }, {});

  return (
    <>
      {toast.node}
      <PageHeader
        title="یکپارچه‌سازی‌ها"
        description="هیچ‌کدام از این سرویس‌ها اجباری نیستند. اگر سرویسی پیکربندی نشده باشد، فقط همان قابلیت غیرفعال می‌شود و بقیه پلتفرم کار می‌کند. کلیدها فقط روی سرور خوانده می‌شوند و هرگز به مرورگر ارسال نمی‌شوند."
        actions={
          <button type="button" className="btn-ghost btn-sm" onClick={load}>
            بازخوانی
          </button>
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      <Tabs
        tabs={[
          { key: 'providers', label: 'سرویس‌ها', badge: providers.length },
          { key: 'usage', label: 'مصرف و هزینه' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'providers' ? (
          <div className="space-y-5">
            {Object.entries(byKind).map(([kind, items]) => (
              <div key={kind}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">{KIND_LABELS[kind] ?? kind}</h2>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {items.map((provider) => {
                    const state = STATE_LABELS[provider.state] ?? STATE_LABELS.NOT_CONFIGURED;
                    return (
                      <Card key={provider.key}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold">{provider.displayName}</h3>
                              <span className={`chip ${state.className}`}>{state.label}</span>
                              <span className="chip bg-surface-2 text-subtle">{COST_LABELS[provider.cost] ?? provider.cost}</span>
                            </div>
                            {provider.description && (
                              <p className="mt-1.5 text-[11px] leading-6 text-subtle">{provider.description}</p>
                            )}
                          </div>
                          {session.can('provider:write') && (
                            <Toggle checked={provider.enabled} onChange={(value) => void toggle(provider.key, value)} label={provider.displayName} />
                          )}
                        </div>

                        {provider.missingConfig.length > 0 && (
                          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
                            <p className="text-[11px] font-medium text-warning">تنظیمات لازم که هنوز مقدار ندارند:</p>
                            <ul className="mt-1 space-y-0.5 text-[11px] text-warning/90" dir="ltr">
                              {provider.missingConfig.map((key) => (
                                <li key={key}>• {key}</li>
                              ))}
                            </ul>
                            <p className="mt-1.5 text-[10px] leading-5 text-subtle">
                              این مقادیر را در فایل .env سرور تنظیم کنید و سرویس API را بازراه‌اندازی کنید.
                            </p>
                          </div>
                        )}

                        {provider.lastError && (
                          <p className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-2.5 text-[11px] leading-6 text-danger">
                            آخرین خطا: {provider.lastError}
                            {provider.lastErrorAt && <span className="block text-[10px]">{faDate(provider.lastErrorAt, true)}</span>}
                          </p>
                        )}

                        {provider.attribution && (
                          <p className="mt-2 text-[10px] text-subtle">الزام انتساب: {provider.attribution}</p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-subtle">
                          <span>
                            محدودیت نرخ:{' '}
                            {[
                              provider.rateLimits.perMinute && `${fa(provider.rateLimits.perMinute)}/دقیقه`,
                              provider.rateLimits.perHour && `${fa(provider.rateLimits.perHour)}/ساعت`,
                              provider.rateLimits.perDay && `${fa(provider.rateLimits.perDay)}/روز`,
                            ]
                              .filter(Boolean)
                              .join(' • ') || 'بدون محدودیت'}
                          </span>
                          <div className="flex items-center gap-2">
                            {provider.docsUrl && (
                              <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                مستندات ↗
                              </a>
                            )}
                            {session.can('provider:write') && (
                              <button type="button" className="btn-ghost btn-sm" onClick={() => void test(provider.key)} disabled={testing === provider.key}>
                                {testing === provider.key && <Spinner />}
                                آزمایش اتصال
                              </button>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : usage ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="درخواست‌های امروز" value={faNumber(usage.totals.requestsToday)} />
              <StatTile label="درخواست‌های این ماه" value={faNumber(usage.totals.requestsThisMonth)} />
              <StatTile
                label="خطاهای این ماه"
                value={faNumber(usage.totals.failuresThisMonth)}
                tone={usage.totals.failuresThisMonth > 0 ? 'danger' : 'default'}
              />
              <StatTile label="هزینه تخمینی هوش مصنوعی" value={usd(usage.totals.estimatedAiCostThisMonthUsd)} tone="warm" />
            </div>

            <Card className="mt-4" padded={false} title="مصرف به تفکیک سرویس">
              {usage.items.length === 0 ? (
                <EmptyState title="هنوز مصرفی ثبت نشده است" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] text-sm">
                    <thead className="table-head">
                      <tr>
                        <th className="px-5 py-2.5 text-start font-medium">سرویس</th>
                        <th className="px-3 py-2.5 text-start font-medium">نوع</th>
                        <th className="px-3 py-2.5 text-start font-medium">امروز</th>
                        <th className="px-3 py-2.5 text-start font-medium">این ماه</th>
                        <th className="px-3 py-2.5 text-start font-medium">خطا</th>
                        <th className="px-3 py-2.5 text-start font-medium">توکن</th>
                        <th className="px-5 py-2.5 text-start font-medium">هزینه تخمینی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.items.map((item) => (
                        <tr key={item.providerKey} className="border-t border-border">
                          <td className="px-5 py-2.5 font-medium">{item.displayName}</td>
                          <td className="px-3 py-2.5 text-subtle">{KIND_LABELS[item.kind] ?? item.kind}</td>
                          <td className="tnum px-3 py-2.5">{faNumber(item.requestsToday)}</td>
                          <td className="tnum px-3 py-2.5">{faNumber(item.requestsThisMonth)}</td>
                          <td className={`tnum px-3 py-2.5 ${item.failuresThisMonth ? 'text-danger' : ''}`}>
                            {faNumber(item.failuresThisMonth)}
                          </td>
                          <td className="tnum px-3 py-2.5">{item.tokensThisMonth ? faNumber(item.tokensThisMonth) : '—'}</td>
                          <td className="tnum px-5 py-2.5">
                            {item.estimatedCostThisMonthUsd ? usd(item.estimatedCostThisMonthUsd) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <p className="mt-3 rounded-xl bg-surface-2 p-3 text-[11px] leading-6 text-subtle">{usage.costNote}</p>
          </>
        ) : (
          <Loading />
        )}
      </div>
    </>
  );
}
