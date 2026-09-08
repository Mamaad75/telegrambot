'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Card, ErrorNote, Field, Loading, Spinner, Tabs, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa } from '@/lib/format';
import { useSession } from '@/lib/session';

interface SignalMeta {
  key: string;
  labelFa: string;
  labelEn: string;
  criterion: string;
  defaultWeight: number;
}

interface SettingsResponse {
  scoring: {
    weights: Record<string, number>;
    thresholds: { hot: number; warm: number; medium: number };
    audit: { seo: number; mobile: number; performance: number; ux: number; conversion: number; technical: number; highReviewCount: number };
    groupCaps: Record<string, number>;
    strongCategories: string[];
  };
  ai: {
    provider: string;
    model: string | null;
    temperature: number;
    maxTokens: number;
    monthlyBudgetUsd: number;
    minLeadScore: number;
    cacheEnabled: boolean;
  };
  crawler: { respectRobots: boolean; maxPages: number; timeoutMs: number; delayMs: number; maxBytes: number; reauditAfterHours: number };
  market: { minSampleSize: number; lookbackDays: number; thresholds: { veryHigh: number; high: number; medium: number; low: number } };
  notifications: { hotLeadThreshold: number; telegramEnabled: boolean; emailEnabled: boolean; inAppEnabled: boolean; dailySummaryHour: number };
  general: { organizationName: string; defaultCountry: string; defaultCity: string | null; showDemoData: boolean; currency: string };
  meta: { signals: SignalMeta[]; groups: Array<{ group: string; signals: string[] }> };
}

const GROUP_LABELS: Record<string, string> = {
  PRESENCE: 'حضور آنلاین',
  WEBSITE_QUALITY: 'کیفیت وب‌سایت',
  CAPABILITY: 'قابلیت‌های از دست رفته',
  POTENTIAL: 'پتانسیل کسب‌وکار',
};

/** Scoring, AI, crawler and market tuning. Everything here changes engine behaviour live. */
export default function ScoringSettingsPage() {
  const session = useSession();
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('scoring');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SettingsResponse | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<SettingsResponse>('/api/settings');
      setData(result);
      setDraft(structuredClone(result));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت تنظیمات ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveScoring = async (rescoreAll: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await api.put<{ rescoreQueued: number }>('/api/settings/scoring', {
        config: draft.scoring,
        rescoreAll,
      });
      toast.show(
        rescoreAll
          ? `تنظیمات ذخیره شد و ${fa(result.rescoreQueued)} سرنخ برای امتیازدهی مجدد در صف قرار گرفت.`
          : 'تنظیمات ذخیره شد. امتیازهای قبلی تا محاسبه بعدی به‌روز نمی‌شوند.',
      );
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveSection = async (path: string, body: unknown, label: string) => {
    setBusy(true);
    try {
      await api.put(`/api/settings/${path}`, body);
      toast.show(`${label} ذخیره شد`);
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data || !draft) return null;

  const readOnly = !session.can('settings:write');

  return (
    <>
      {toast.node}
      <PageHeader
        title="تنظیمات موتور"
        description="وزن سیگنال‌ها، آستانه‌ها و بودجه‌ها. تغییر این مقادیر رفتار موتور امتیازدهی و فرصت‌یابی را بلافاصله عوض می‌کند."
      />

      <Tabs
        tabs={[
          { key: 'scoring', label: 'امتیازدهی' },
          { key: 'ai', label: 'هوش مصنوعی' },
          { key: 'crawler', label: 'خزنده وب' },
          { key: 'market', label: 'بازار' },
          { key: 'notifications', label: 'اعلان‌ها' },
          { key: 'general', label: 'عمومی' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4 space-y-4">
        {tab === 'scoring' && (
          <>
            <Card title="آستانه دما" subtitle="امتیاز از ۱۰۰ که مرز هر دسته را تعیین می‌کند">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(['hot', 'warm', 'medium'] as const).map((key) => (
                  <Field key={key} label={{ hot: 'داغ از', warm: 'گرم از', medium: 'متوسط از' }[key]}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="input"
                      disabled={readOnly}
                      value={draft.scoring.thresholds[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scoring: { ...draft.scoring, thresholds: { ...draft.scoring.thresholds, [key]: Number(e.target.value) } },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            </Card>

            <Card
              title="سقف گروه‌های سیگنال"
              subtitle="بیشترین امتیازی که هر گروه می‌تواند بدهد — جلوی غالب‌شدن یک دسته سیگنال را می‌گیرد"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                {Object.entries(draft.scoring.groupCaps ?? {}).map(([group, value]) => (
                  <Field key={group} label={GROUP_LABELS[group] ?? group}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="input"
                      disabled={readOnly}
                      value={value}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scoring: { ...draft.scoring, groupCaps: { ...draft.scoring.groupCaps, [group]: Number(e.target.value) } },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            </Card>

            <Card title="وزن سیگنال‌ها" subtitle="وزن مثبت یعنی فرصت بیشتر؛ وزن منفی یعنی فرصت کمتر" padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="px-5 py-2.5 text-start font-medium">سیگنال</th>
                      <th className="px-3 py-2.5 text-start font-medium">گروه</th>
                      <th className="px-3 py-2.5 text-start font-medium">شرط فعال‌شدن</th>
                      <th className="px-5 py-2.5 text-start font-medium">وزن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.meta.signals.map((signal) => {
                      const group = data.meta.groups.find((g) => g.signals.includes(signal.key))?.group;
                      return (
                        <tr key={signal.key} className="border-t border-border">
                          <td className="px-5 py-2.5">
                            <p className="font-medium">{signal.labelFa}</p>
                            <p className="text-[11px] text-subtle">{signal.labelEn}</p>
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-subtle">{group ? GROUP_LABELS[group] ?? group : 'کاهنده'}</td>
                          <td className="max-w-[22rem] px-3 py-2.5 text-[11px] leading-6 text-subtle">{signal.criterion}</td>
                          <td className="px-5 py-2.5">
                            <input
                              type="number"
                              min={-50}
                              max={50}
                              className="input w-24 py-1 text-xs"
                              disabled={readOnly}
                              value={draft.scoring.weights[signal.key] ?? signal.defaultWeight}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  scoring: {
                                    ...draft.scoring,
                                    weights: { ...draft.scoring.weights, [signal.key]: Number(e.target.value) },
                                  },
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {!readOnly && (
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft(structuredClone(data))}>
                  بازگردانی تغییرات
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void saveScoring(false)} disabled={busy}>
                  ذخیره بدون امتیازدهی مجدد
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={() => void saveScoring(true)} disabled={busy}>
                  {busy && <Spinner />}
                  ذخیره و امتیازدهی مجدد همه سرنخ‌ها
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'ai' && (
          <Card
            title="هوش مصنوعی و کنترل هزینه"
            subtitle="کلید API فقط در فایل .env سرور تنظیم می‌شود و هرگز اینجا نمایش داده نمی‌شود"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ارائه‌دهنده">
                <select
                  className="input"
                  disabled={readOnly}
                  value={draft.ai.provider}
                  onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, provider: e.target.value } })}
                >
                  <option value="none">غیرفعال (فقط قواعد قطعی)</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="compatible">سرویس سازگار با OpenAI</option>
                  <option value="local">مدل محلی</option>
                </select>
              </Field>
              <Field label="حداقل امتیاز برای تحلیل" hint="سرنخ‌های پایین‌تر از این امتیاز به مدل ارسال نمی‌شوند.">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input"
                  disabled={readOnly}
                  value={draft.ai.minLeadScore}
                  onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, minLeadScore: Number(e.target.value) } })}
                />
              </Field>
              <Field label="سقف هزینه ماهانه (دلار)" hint="با رسیدن به سقف، تحلیل‌های جدید متوقف می‌شوند. صفر یعنی بدون سقف.">
                <input
                  type="number"
                  min={0}
                  className="input"
                  disabled={readOnly}
                  value={draft.ai.monthlyBudgetUsd}
                  onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, monthlyBudgetUsd: Number(e.target.value) } })}
                />
              </Field>
              <Field label="حداکثر توکن پاسخ">
                <input
                  type="number"
                  min={256}
                  max={16000}
                  className="input"
                  disabled={readOnly}
                  value={draft.ai.maxTokens}
                  onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, maxTokens: Number(e.target.value) } })}
                />
              </Field>
              <Field label="دما (temperature)" hint="مقدار پایین‌تر یعنی خروجی محافظه‌کارانه‌تر و نزدیک‌تر به داده.">
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  className="input"
                  disabled={readOnly}
                  value={draft.ai.temperature}
                  onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, temperature: Number(e.target.value) } })}
                />
              </Field>
              <label className="mt-6 flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={readOnly}
                  checked={draft.ai.cacheEnabled}
                  onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, cacheEnabled: e.target.checked } })}
                />
                <span>
                  استفاده از نتیجه ذخیره‌شده وقتی داده سرنخ تغییر نکرده است
                  <span className="block text-[11px] text-subtle">از پرداخت دوباره برای تحلیل یکسان جلوگیری می‌کند.</span>
                </span>
              </label>
            </div>

            {!readOnly && (
              <div className="mt-4 flex justify-end">
                <button type="button" className="btn-primary btn-sm" onClick={() => void saveSection('ai', draft.ai, 'تنظیمات هوش مصنوعی')} disabled={busy}>
                  {busy && <Spinner />}
                  ذخیره
                </button>
              </div>
            )}
          </Card>
        )}

        {tab === 'crawler' && (
          <Card title="خزنده وب" subtitle="این مقادیر تعیین می‌کنند سامانه چقدر مؤدبانه با سایت‌ها رفتار کند">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-xs text-muted sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={readOnly}
                  checked={draft.crawler.respectRobots}
                  onChange={(e) => setDraft({ ...draft, crawler: { ...draft.crawler, respectRobots: e.target.checked } })}
                />
                <span>
                  رعایت robots.txt
                  <span className="block text-[11px] text-subtle">
                    در محیط عملیاتی این گزینه باید روشن بماند. با خاموش‌کردن آن، سایت‌هایی که خزیدن را منع کرده‌اند هم خوانده می‌شوند.
                  </span>
                </span>
              </label>
              <Field label="حداکثر صفحه در هر بررسی">
                <input type="number" min={1} max={20} className="input" disabled={readOnly} value={draft.crawler.maxPages} onChange={(e) => setDraft({ ...draft, crawler: { ...draft.crawler, maxPages: Number(e.target.value) } })} />
              </Field>
              <Field label="فاصله بین درخواست‌ها (میلی‌ثانیه)">
                <input type="number" min={200} max={30000} className="input" disabled={readOnly} value={draft.crawler.delayMs} onChange={(e) => setDraft({ ...draft, crawler: { ...draft.crawler, delayMs: Number(e.target.value) } })} />
              </Field>
              <Field label="مهلت هر درخواست (میلی‌ثانیه)">
                <input type="number" min={2000} max={60000} className="input" disabled={readOnly} value={draft.crawler.timeoutMs} onChange={(e) => setDraft({ ...draft, crawler: { ...draft.crawler, timeoutMs: Number(e.target.value) } })} />
              </Field>
              <Field label="حداکثر حجم هر صفحه (بایت)">
                <input type="number" min={100000} className="input" disabled={readOnly} value={draft.crawler.maxBytes} onChange={(e) => setDraft({ ...draft, crawler: { ...draft.crawler, maxBytes: Number(e.target.value) } })} />
              </Field>
              <Field label="فاصله بررسی مجدد (ساعت)">
                <input type="number" min={1} className="input" disabled={readOnly} value={draft.crawler.reauditAfterHours} onChange={(e) => setDraft({ ...draft, crawler: { ...draft.crawler, reauditAfterHours: Number(e.target.value) } })} />
              </Field>
            </div>
            {!readOnly && (
              <div className="mt-4 flex justify-end">
                <button type="button" className="btn-primary btn-sm" onClick={() => void saveSection('crawler', draft.crawler, 'تنظیمات خزنده')} disabled={busy}>
                  {busy && <Spinner />}
                  ذخیره
                </button>
              </div>
            )}
          </Card>
        )}

        {tab === 'market' && (
          <Card title="تجمیع تقاضای بازار">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="حداقل تعداد مشاهده" hint="کمتر از این تعداد، وضعیت «داده کافی نیست» گزارش می‌شود — هیچ عددی ساخته نمی‌شود.">
                <input type="number" min={1} className="input" disabled={readOnly} value={draft.market.minSampleSize} onChange={(e) => setDraft({ ...draft, market: { ...draft.market, minSampleSize: Number(e.target.value) } })} />
              </Field>
              <Field label="بازه بررسی (روز)">
                <input type="number" min={7} max={730} className="input" disabled={readOnly} value={draft.market.lookbackDays} onChange={(e) => setDraft({ ...draft, market: { ...draft.market, lookbackDays: Number(e.target.value) } })} />
              </Field>
              {(['veryHigh', 'high', 'medium', 'low'] as const).map((key) => (
                <Field key={key} label={{ veryHigh: 'بسیار بالا از', high: 'بالا از', medium: 'متوسط از', low: 'کم از' }[key]}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input"
                    disabled={readOnly}
                    value={draft.market.thresholds[key]}
                    onChange={(e) => setDraft({ ...draft, market: { ...draft.market, thresholds: { ...draft.market.thresholds, [key]: Number(e.target.value) } } })}
                  />
                </Field>
              ))}
            </div>
            {!readOnly && (
              <div className="mt-4 flex justify-end">
                <button type="button" className="btn-primary btn-sm" onClick={() => void saveSection('market', draft.market, 'تنظیمات بازار')} disabled={busy}>
                  {busy && <Spinner />}
                  ذخیره
                </button>
              </div>
            )}
          </Card>
        )}

        {tab === 'notifications' && (
          <Card title="اعلان‌ها">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="آستانه سرنخ داغ" hint="امتیازی که از آن به بالا اعلان سرنخ داغ ارسال می‌شود.">
                <input type="number" min={0} max={100} className="input" disabled={readOnly} value={draft.notifications.hotLeadThreshold} onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, hotLeadThreshold: Number(e.target.value) } })} />
              </Field>
              <Field label="ساعت ارسال خلاصه روزانه">
                <input type="number" min={0} max={23} className="input" disabled={readOnly} value={draft.notifications.dailySummaryHour} onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, dailySummaryHour: Number(e.target.value) } })} />
              </Field>
              {(['inAppEnabled', 'telegramEnabled', 'emailEnabled'] as const).map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={draft.notifications[key]}
                    onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, [key]: e.target.checked } })}
                  />
                  {{ inAppEnabled: 'اعلان درون‌برنامه‌ای', telegramEnabled: 'تلگرام', emailEnabled: 'ایمیل' }[key]}
                </label>
              ))}
            </div>
            {!readOnly && (
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn-ghost btn-sm" onClick={() => void api.post('/api/notifications/test', { channel: 'TELEGRAM' }).then(() => toast.show('پیام آزمایشی ارسال شد')).catch(() => toast.show('ارسال ناموفق بود', 'error'))}>
                  ارسال پیام آزمایشی تلگرام
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={() => void saveSection('notifications', draft.notifications, 'تنظیمات اعلان')} disabled={busy}>
                  {busy && <Spinner />}
                  ذخیره
                </button>
              </div>
            )}
          </Card>
        )}

        {tab === 'general' && (
          <Card title="تنظیمات عمومی">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="نام سازمان">
                <input className="input" disabled={readOnly} value={draft.general.organizationName} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, organizationName: e.target.value } })} />
              </Field>
              <Field label="شهر پیش‌فرض">
                <input className="input" disabled={readOnly} value={draft.general.defaultCity ?? ''} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, defaultCity: e.target.value || null } })} />
              </Field>
              <label className="flex items-start gap-2 text-xs text-muted sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={readOnly}
                  checked={draft.general.showDemoData}
                  onChange={(e) => setDraft({ ...draft, general: { ...draft.general, showDemoData: e.target.checked } })}
                />
                <span>
                  نمایش داده نمونه در فهرست‌ها به‌صورت پیش‌فرض
                  <span className="block text-[11px] text-subtle">
                    داده نمونه همیشه با برچسب «نمونه» مشخص می‌شود و هرگز با داده واقعی ترکیب نمی‌شود.
                  </span>
                </span>
              </label>
            </div>
            {!readOnly && (
              <div className="mt-4 flex justify-end">
                <button type="button" className="btn-primary btn-sm" onClick={() => void saveSection('general', draft.general, 'تنظیمات عمومی')} disabled={busy}>
                  {busy && <Spinner />}
                  ذخیره
                </button>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
