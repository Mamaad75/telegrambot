'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ALL_CITIES, BUSINESS_CATEGORIES, IRAN_PROVINCES } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { Card, EmptyState, ErrorNote, Field, Loading, Modal, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, faNumber } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Campaign {
  id: string;
  name: string;
  status: string;
  city: string | null;
  province: string | null;
  categories: string[];
  websiteFilter: string;
  minLeadScore: number | null;
  limit: number;
  providers: string[];
  leadCount: number;
  createdAt: string;
  lastRunAt: string | null;
  isDemo: boolean;
  stats: {
    collected: number;
    unique: number;
    qualified: number;
    hot: number;
    warm: number;
    medium: number;
    low: number;
    rejected: number;
    errors: number;
    merged: number;
  } | null;
  currentRun: { id: string; status: string; stage: string | null; progress: number; error: string | null } | null;
}

interface Source {
  key: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  usable: boolean;
  state: string;
  lastError: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  READY: 'آماده اجرا',
  RUNNING: 'در حال اجرا',
  PAUSED: 'متوقف',
  COMPLETED: 'تکمیل‌شده',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-surface-2 text-subtle',
  READY: 'bg-info/10 text-info',
  RUNNING: 'bg-accent/15 text-accent',
  PAUSED: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-success/10 text-success',
  FAILED: 'bg-danger/10 text-danger',
  CANCELLED: 'bg-surface-2 text-subtle',
};

export default function CampaignsPage() {
  const session = useSession();
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, availableSources] = await Promise.all([
        api.get<{ items: Campaign[] }>('/api/campaigns'),
        api.get<{ items: Source[] }>('/api/campaigns/available-sources').catch(() => ({ items: [] as Source[] })),
      ]);
      setCampaigns(list.items);
      setSources(availableSources.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت کمپین‌ها ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a run is in progress so the stage and counters stay live.
  useEffect(() => {
    const hasRunning = campaigns.some((c) => c.currentRun && ['QUEUED', 'RUNNING'].includes(c.currentRun.status));
    if (!hasRunning) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [campaigns, load]);

  const run = async (id: string) => {
    setRunning(id);
    try {
      await api.post(`/api/campaigns/${id}/run`);
      toast.show('کمپین شروع شد. پیشرفت اجرا روی همین صفحه به‌روزرسانی می‌شود.');
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'اجرای کمپین ناموفق بود', 'error');
    } finally {
      setRunning(null);
    }
  };

  const usableSources = sources.filter((s) => s.usable);

  if (loading) return <Loading />;

  return (
    <>
      {toast.node}
      <PageHeader
        title="کمپین‌ها"
        description="کشف کسب‌وکارهای هدف بر پایه شهر، دسته و منابع فعال. اجرای هر کمپین در پس‌زمینه انجام می‌شود."
        actions={
          session.can('campaign:create') && (
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              کمپین جدید
            </button>
          )
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      {usableSources.length === 0 && (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/5 p-4 text-xs leading-6 text-warning">
          هیچ منبع کشف کسب‌وکاری فعال و پیکربندی‌شده نیست. می‌توانید OpenStreetMap را در بخش یکپارچه‌سازی‌ها فعال کنید
          (بدون نیاز به کلید)، یا سرنخ‌ها را از فایل CSV وارد کنید.{' '}
          <Link href="/admin/providers" className="underline">
            تنظیم یکپارچه‌سازی‌ها
          </Link>
        </div>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            title="هنوز کمپینی ساخته نشده است"
            description="یک کمپین بسازید: شهر و دسته‌های هدف را انتخاب کنید، سقف نتایج را تعیین کنید و اجرا بزنید. خط لوله کشف، حذف تکراری، بررسی وب‌سایت و امتیازدهی به‌صورت خودکار اجرا می‌شود."
            action={
              session.can('campaign:create') && (
                <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                  ساخت اولین کمپین
                </button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => {
            const isRunning = campaign.currentRun && ['QUEUED', 'RUNNING'].includes(campaign.currentRun.status);
            return (
              <Card key={campaign.id}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/campaigns/${campaign.id}`} className="block truncate text-sm font-semibold hover:text-accent">
                      {campaign.name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-subtle">
                      {[campaign.city, campaign.province].filter(Boolean).join('، ') || 'بدون محدوده جغرافیایی'} •{' '}
                      {faNumber(campaign.categories.length)} دسته
                    </p>
                  </div>
                  <span className={`chip shrink-0 ${STATUS_STYLES[campaign.status]}`}>{STATUS_LABELS[campaign.status]}</span>
                </div>

                {isRunning && campaign.currentRun && (
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-subtle">
                      <span>{campaign.currentRun.stage ?? 'در حال اجرا'}</span>
                      <span className="tnum">{fa(campaign.currentRun.progress)}٪</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${campaign.currentRun.progress}%` }} />
                    </div>
                  </div>
                )}

                {campaign.currentRun?.error && (
                  <p className="mb-3 rounded-xl border border-danger/30 bg-danger/5 p-2.5 text-[11px] leading-6 text-danger">
                    {campaign.currentRun.error}
                  </p>
                )}

                {campaign.stats ? (
                  <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
                    <Stat label="جمع‌آوری" value={campaign.stats.collected} />
                    <Stat label="یکتا" value={campaign.stats.unique} />
                    <Stat label="واجد شرایط" value={campaign.stats.qualified} />
                    <Stat label="داغ" value={campaign.stats.hot} tone="text-hot" />
                    <Stat label="گرم" value={campaign.stats.warm} tone="text-warm" />
                    <Stat label="ادغام‌شده" value={campaign.stats.merged} />
                  </dl>
                ) : (
                  <p className="mb-3 text-[11px] text-subtle">هنوز اجرا نشده است.</p>
                )}

                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-[11px] text-subtle">
                    {campaign.lastRunAt ? `آخرین اجرا: ${faDate(campaign.lastRunAt)}` : `ساخته‌شده: ${faDate(campaign.createdAt)}`}
                  </span>
                  <div className="flex gap-2">
                    <Link href={`/leads?campaignId=${campaign.id}`} className="btn-ghost btn-sm">
                      {faNumber(campaign.leadCount)} سرنخ
                    </Link>
                    {session.can('campaign:run') && !isRunning && (
                      <button type="button" className="btn-primary btn-sm" onClick={() => void run(campaign.id)} disabled={running === campaign.id}>
                        {running === campaign.id && <Spinner />}
                        اجرا
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        sources={sources}
        onDone={() => {
          setCreateOpen(false);
          void load();
          toast.show('کمپین ساخته شد');
        }}
      />
    </>
  );
}

function Stat({ label, value, tone = 'text-fg' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 py-1.5">
      <dt className="text-[10px] text-subtle">{label}</dt>
      <dd className={`tnum text-sm font-semibold ${tone}`}>{faNumber(value)}</dd>
    </div>
  );
}

function CreateCampaignModal({
  open,
  onClose,
  sources,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  sources: Source[];
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    province: '',
    city: '',
    categories: [] as string[],
    providers: [] as string[],
    websiteFilter: 'ANY',
    minLeadScore: '',
    maxResults: 100,
    enableAi: false,
  });
  const [customCategory, setCustomCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cities = form.province ? (IRAN_PROVINCES.find((p) => p.name === form.province)?.cities ?? []) : ALL_CITIES;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/campaigns', {
        name: form.name,
        province: form.province || undefined,
        city: form.city || undefined,
        categories: form.categories,
        providers: form.providers,
        websiteFilter: form.websiteFilter,
        minLeadScore: form.minLeadScore ? Number(form.minLeadScore) : null,
        maxResults: Number(form.maxResults),
        enableAi: form.enableAi,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ساخت کمپین ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (value: string) =>
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(value) ? f.categories.filter((c) => c !== value) : [...f.categories, value],
    }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="کمپین جدید"
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={submit}
            disabled={busy || form.name.trim().length < 3 || form.categories.length === 0}
          >
            {busy && <Spinner />}
            ساخت کمپین
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="نام کمپین" required hint="مثال: «اراک — کسب‌وکارهای بدون وب‌سایت — پاییز ۱۴۰۵»">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="استان">
            <select className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value, city: '' })}>
              <option value="">— همه —</option>
              {IRAN_PROVINCES.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="شهر" hint="محدوده جغرافیایی کشف کسب‌وکارها.">
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              <option value="">— انتخاب کنید —</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="دسته‌های هدف" required>
          <div className="flex flex-wrap gap-1.5">
            {BUSINESS_CATEGORIES.map((category) => (
              <button
                key={category.key}
                type="button"
                onClick={() => toggleCategory(category.fa)}
                className={`chip border transition-colors ${
                  form.categories.includes(category.fa)
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border bg-surface-2 text-muted hover:border-accent/40'
                }`}
              >
                {category.fa}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input"
              placeholder="دسته دلخواه…"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customCategory.trim()) {
                  e.preventDefault();
                  toggleCategory(customCategory.trim());
                  setCustomCategory('');
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                if (customCategory.trim()) {
                  toggleCategory(customCategory.trim());
                  setCustomCategory('');
                }
              }}
            >
              افزودن
            </button>
          </div>
          {form.categories.length > 0 && (
            <p className="mt-1.5 text-[11px] text-subtle">انتخاب‌شده: {form.categories.join('، ')}</p>
          )}
        </Field>

        <Field label="منابع کشف" hint="خالی بگذارید تا همه منابع فعال استفاده شوند.">
          <div className="space-y-1.5">
            {sources.map((source) => (
              <label
                key={source.key}
                className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                  source.usable ? 'border-border' : 'border-border opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={!source.usable}
                  checked={form.providers.includes(source.key)}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      providers: f.providers.includes(source.key)
                        ? f.providers.filter((p) => p !== source.key)
                        : [...f.providers, source.key],
                    }))
                  }
                />
                <span>
                  <span className="font-medium">{source.displayName}</span>
                  {!source.usable && <span className="ms-1.5 text-subtle">(پیکربندی نشده)</span>}
                  {source.description && <span className="block text-[11px] leading-5 text-subtle">{source.description}</span>}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="وضعیت وب‌سایت">
            <select className="input" value={form.websiteFilter} onChange={(e) => setForm({ ...form, websiteFilter: e.target.value })}>
              <option value="ANY">هر وضعیتی</option>
              <option value="NO_WEBSITE">فقط بدون وب‌سایت</option>
              <option value="HAS_WEBSITE">فقط دارای وب‌سایت</option>
            </select>
          </Field>
          <Field label="حداقل امتیاز" hint="برای شمارش «واجد شرایط».">
            <input type="number" min={0} max={100} className="input" value={form.minLeadScore} onChange={(e) => setForm({ ...form, minLeadScore: e.target.value })} />
          </Field>
          <Field label="سقف نتایج">
            <input type="number" min={1} max={2000} className="input" value={form.maxResults} onChange={(e) => setForm({ ...form, maxResults: Number(e.target.value) })} />
          </Field>
        </div>

        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={form.enableAi} onChange={(e) => setForm({ ...form, enableAi: e.target.checked })} />
          <span>
            اجرای تحلیل هوش مصنوعی روی سرنخ‌های واجد شرایط
            <span className="block text-[11px] text-subtle">
              تحلیل فقط برای سرنخ‌های بالاتر از آستانه امتیاز اجرا می‌شود و هزینه دارد. بدون آن هم گزارش فروش از قواعد قطعی
              ساخته می‌شود.
            </span>
          </span>
        </label>

        {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
