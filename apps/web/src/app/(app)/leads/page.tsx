'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONTACT_STATUSES, LEAD_TEMPERATURES, WEBSITE_STATUSES } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import {
  BusinessValueBadge,
  CONTACT_STATUS_LABELS,
  DemoBadge,
  StatusBadge,
  TemperatureBadge,
  WEBSITE_STATUS_LABELS,
  WebsiteStatusBadge,
} from '@/components/badges';
import { Card, EmptyState, ErrorNote, Field, Loading, Modal, Spinner, useToast } from '@/components/ui';
import { api, ApiError, downloadCsv } from '@/lib/api';
import { fa, faDate, faNumber, isOverdue, phone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ImportPanel } from './import-panel';

interface LeadRow {
  id: string;
  businessName: string;
  category: string | null;
  city: string | null;
  normalizedPhone: string | null;
  website: string | null;
  websiteStatus: string;
  leadScore: number | null;
  leadTemperature: string | null;
  businessValueTier: string;
  recommendedServiceName: string | null;
  contactStatus: string;
  assignedToName: string | null;
  nextFollowUpAt: string | null;
  isDemo: boolean;
}

interface Facets {
  cities: Array<{ value: string; count: number }>;
  categories: Array<{ value: string; count: number }>;
  services: Array<{ value: string; label: string }>;
  users: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; count: number }>;
}

interface ListResponse {
  items: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type Filters = {
  q: string;
  city: string[];
  category: string[];
  temperature: string[];
  websiteStatus: string[];
  contactStatus: string[];
  recommendedService: string[];
  assignedToId: string[];
  source: string[];
  minScore: string;
  websiteFilter: string;
  includeDemo: boolean;
  followUpDue: boolean;
  sort: string;
};

const EMPTY_FILTERS: Filters = {
  q: '',
  city: [],
  category: [],
  temperature: [],
  websiteStatus: [],
  contactStatus: [],
  recommendedService: [],
  assignedToId: [],
  source: [],
  minScore: '',
  websiteFilter: 'ANY',
  includeDemo: false,
  followUpDue: false,
  sort: 'score_desc',
};

const SORTS = [
  { value: 'score_desc', label: 'بیشترین امتیاز' },
  { value: 'value_desc', label: 'بیشترین ارزش تجاری' },
  { value: 'newest', label: 'جدیدترین' },
  { value: 'followup_asc', label: 'نزدیک‌ترین پیگیری' },
  { value: 'name_asc', label: 'نام (الفبا)' },
];

export default function LeadsPage() {
  const session = useSession();
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () => ({
      q: filters.q || undefined,
      city: filters.city,
      category: filters.category,
      temperature: filters.temperature,
      websiteStatus: filters.websiteStatus,
      contactStatus: filters.contactStatus,
      recommendedService: filters.recommendedService,
      assignedToId: filters.assignedToId,
      source: filters.source,
      minScore: filters.minScore || undefined,
      websiteFilter: filters.websiteFilter === 'ANY' ? undefined : filters.websiteFilter,
      includeDemo: filters.includeDemo || undefined,
      followUpDue: filters.followUpDue || undefined,
      sort: filters.sort,
      page,
      pageSize: 25,
    }),
    [filters, page],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ListResponse>('/api/leads', query);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت فهرست سرنخ‌ها ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get<Facets>('/api/leads/facets').then(setFacets).catch(() => undefined);
  }, []);

  const toggleFilterValue = (key: keyof Filters, value: string) => {
    setPage(1);
    setFilters((prev) => {
      const current = prev[key] as string[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const runBulk = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await api.post<{ affected: number }>('/api/leads/bulk', {
        leadIds: Array.from(selected),
        ...body,
      });
      toast.show(`${faNumber(result.affected)} سرنخ به‌روزرسانی شد`);
      setSelected(new Set());
      setBulkOpen(false);
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'عملیات ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const activeFilterCount =
    filters.city.length +
    filters.category.length +
    filters.temperature.length +
    filters.websiteStatus.length +
    filters.contactStatus.length +
    filters.recommendedService.length +
    filters.assignedToId.length +
    filters.source.length +
    (filters.minScore ? 1 : 0) +
    (filters.websiteFilter !== 'ANY' ? 1 : 0) +
    (filters.followUpDue ? 1 : 0);

  return (
    <>
      {toast.node}
      <PageHeader
        title="سرنخ‌ها"
        description="فهرست کسب‌وکارهای شناسایی‌شده به همراه امتیاز فرصت، ارزش تجاری و خدمت پیشنهادی بایمر."
        actions={
          <>
            {session.can('lead:import') && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
                ورود CSV
              </button>
            )}
            {session.can('lead:export') && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  downloadCsv('/api/leads/export', `baimar-leads-${new Date().toISOString().slice(0, 10)}.csv`, query)
                }
              >
                خروجی CSV
              </button>
            )}
            {session.can('lead:create') && (
              <Link href="/leads/new" className="btn-primary btn-sm">
                سرنخ جدید
              </Link>
            )}
          </>
        }
      />

      {/* Search + sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="جست‌وجو در نام، تلفن، دامنه یا آدرس…"
          value={filters.q}
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, q: e.target.value }));
          }}
        />
        <select
          className="input max-w-[12rem]"
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="input max-w-[10rem]"
          value={filters.websiteFilter}
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, websiteFilter: e.target.value }));
          }}
        >
          <option value="ANY">هر وضعیت سایت</option>
          <option value="NO_WEBSITE">بدون وب‌سایت</option>
          <option value="HAS_WEBSITE">دارای وب‌سایت</option>
        </select>
        <input
          className="input max-w-[8rem]"
          type="number"
          min={0}
          max={100}
          placeholder="حداقل امتیاز"
          value={filters.minScore}
          onChange={(e) => {
            setPage(1);
            setFilters((f) => ({ ...f, minScore: e.target.value }));
          }}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.followUpDue}
            onChange={(e) => setFilters((f) => ({ ...f, followUpDue: e.target.checked }))}
          />
          فقط پیگیری‌های سررسیدشده
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.includeDemo}
            onChange={(e) => setFilters((f) => ({ ...f, includeDemo: e.target.checked }))}
          />
          نمایش داده نمونه
        </label>
        {activeFilterCount > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}>
            پاک‌کردن {fa(activeFilterCount)} فیلتر
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_1fr]">
        {/* Filter rail */}
        <aside className="space-y-3">
          <FilterGroup
            title="دما"
            options={LEAD_TEMPERATURES.map((t) => ({
              value: t,
              label: { HOT: 'داغ', WARM: 'گرم', MEDIUM: 'متوسط', LOW: 'کم' }[t],
            }))}
            selected={filters.temperature}
            onToggle={(v) => toggleFilterValue('temperature', v)}
          />
          <FilterGroup
            title="وضعیت فروش"
            options={CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABELS[s] }))}
            selected={filters.contactStatus}
            onToggle={(v) => toggleFilterValue('contactStatus', v)}
            collapsible
          />
          <FilterGroup
            title="شهر"
            options={(facets?.cities ?? []).map((c) => ({ value: c.value, label: `${c.value} (${fa(c.count)})` }))}
            selected={filters.city}
            onToggle={(v) => toggleFilterValue('city', v)}
            collapsible
          />
          <FilterGroup
            title="دسته"
            options={(facets?.categories ?? []).map((c) => ({ value: c.value, label: `${c.value} (${fa(c.count)})` }))}
            selected={filters.category}
            onToggle={(v) => toggleFilterValue('category', v)}
            collapsible
          />
          <FilterGroup
            title="خدمت پیشنهادی"
            options={(facets?.services ?? []).map((s) => ({ value: s.value, label: s.label }))}
            selected={filters.recommendedService}
            onToggle={(v) => toggleFilterValue('recommendedService', v)}
            collapsible
          />
          <FilterGroup
            title="وضعیت وب‌سایت"
            options={WEBSITE_STATUSES.map((s) => ({ value: s, label: WEBSITE_STATUS_LABELS[s] }))}
            selected={filters.websiteStatus}
            onToggle={(v) => toggleFilterValue('websiteStatus', v)}
            collapsible
          />
          {session.can('lead:assign') && (
            <FilterGroup
              title="کارشناس فروش"
              options={(facets?.users ?? []).map((u) => ({ value: u.value, label: u.label }))}
              selected={filters.assignedToId}
              onToggle={(v) => toggleFilterValue('assignedToId', v)}
              collapsible
            />
          )}
          <FilterGroup
            title="منبع"
            options={(facets?.sources ?? []).map((s) => ({ value: s.value, label: `${s.value} (${fa(s.count)})` }))}
            selected={filters.source}
            onToggle={(v) => toggleFilterValue('source', v)}
            collapsible
          />
        </aside>

        {/* Table */}
        <div className="min-w-0">
          {selected.size > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 text-sm">
              <span className="font-medium">{faNumber(selected.size)} سرنخ انتخاب شده</span>
              <div className="flex-1" />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setBulkOpen(true)}>
                اقدام گروهی
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                لغو انتخاب
              </button>
            </div>
          )}

          <Card padded={false}>
            {loading && !data ? (
              <Loading />
            ) : error ? (
              <div className="p-4">
                <ErrorNote message={error} onRetry={load} />
              </div>
            ) : !data || data.items.length === 0 ? (
              <EmptyState
                title="سرنخی با این فیلترها یافت نشد"
                description="فیلترها را تغییر دهید، یک کمپین اجرا کنید، یا فهرست خود را از فایل CSV وارد کنید."
                action={
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    پاک‌کردن فیلترها
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-sm">
                  <thead>
                    <tr className="table-head">
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label="انتخاب همه"
                          checked={data.items.every((l) => selected.has(l.id))}
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Set(data.items.map((l) => l.id)) : new Set())
                          }
                        />
                      </th>
                      <th className="px-3 py-2.5 text-start font-medium">کسب‌وکار</th>
                      <th className="px-3 py-2.5 text-start font-medium">امتیاز</th>
                      <th className="px-3 py-2.5 text-start font-medium">ارزش</th>
                      <th className="px-3 py-2.5 text-start font-medium">وب‌سایت</th>
                      <th className="px-3 py-2.5 text-start font-medium">خدمت پیشنهادی</th>
                      <th className="px-3 py-2.5 text-start font-medium">وضعیت</th>
                      <th className="px-3 py-2.5 text-start font-medium">کارشناس</th>
                      <th className="px-3 py-2.5 text-start font-medium">پیگیری بعدی</th>
                      <th className="px-3 py-2.5 text-start font-medium">تماس</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((lead) => (
                      <tr key={lead.id} className="border-t border-border hover:bg-surface-2/60">
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`انتخاب ${lead.businessName}`}
                            checked={selected.has(lead.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(lead.id);
                              else next.delete(lead.id);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="max-w-[16rem] px-3 py-2.5">
                          <Link href={`/leads/${lead.id}`} className="block truncate font-medium hover:text-accent">
                            {lead.businessName}
                          </Link>
                          <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                            {[lead.category, lead.city].filter(Boolean).join(' • ') || '—'}
                            {lead.isDemo && <DemoBadge />}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="tnum font-medium">{fa(lead.leadScore)}</span>
                            <TemperatureBadge temperature={lead.leadTemperature as never} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <BusinessValueBadge tier={lead.businessValueTier as never} />
                        </td>
                        <td className="px-3 py-2.5">
                          <WebsiteStatusBadge status={lead.websiteStatus as never} />
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2.5 text-muted">
                          {lead.recommendedServiceName ?? '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={lead.contactStatus as never} />
                        </td>
                        <td className="px-3 py-2.5 text-muted">{lead.assignedToName ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          {lead.nextFollowUpAt ? (
                            <span className={isOverdue(lead.nextFollowUpAt) ? 'text-danger' : 'text-muted'}>
                              {faDate(lead.nextFollowUpAt)}
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
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

            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
                <span className="text-subtle">
                  {faNumber((data.page - 1) * data.pageSize + 1)}–{faNumber(Math.min(data.page * data.pageSize, data.total))} از{' '}
                  {faNumber(data.total)}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    قبلی
                  </button>
                  <span className="tnum px-2 py-1.5">
                    {fa(data.page)} / {fa(data.totalPages)}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    بعدی
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <BulkModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        count={selected.size}
        users={facets?.users ?? []}
        busy={busy}
        onRun={runBulk}
        canAssign={session.can('lead:assign')}
        canRunAi={session.can('lead:run_ai')}
      />

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="ورود سرنخ از فایل CSV" wide>
        <ImportPanel
          onDone={() => {
            setImportOpen(false);
            void load();
          }}
        />
      </Modal>
    </>
  );
}

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
  collapsible = false,
}: {
  title: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (!options.length) return null;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {title}
          {selected.length > 0 && <span className="ms-1.5 text-accent">({fa(selected.length)})</span>}
        </span>
        <span className="text-subtle">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto border-t border-border px-2 py-2">
          {options.map((option) => (
            <li key={option.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
                <span className="truncate text-muted">{option.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BulkModal({
  open,
  onClose,
  count,
  users,
  busy,
  onRun,
  canAssign,
  canRunAi,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  users: Array<{ value: string; label: string }>;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  canAssign: boolean;
  canRunAi: boolean;
}) {
  const [action, setAction] = useState('audit');
  const [assignedToId, setAssignedToId] = useState('');
  const [contactStatus, setContactStatus] = useState('READY_TO_CALL');
  const [followUpAt, setFollowUpAt] = useState('');
  const [followUpKind, setFollowUpKind] = useState('تماس مجدد');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`اقدام گروهی روی ${faNumber(count)} سرنخ`}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy || (action === 'follow_up' && !followUpAt)}
            onClick={() =>
              void onRun({
                action,
                assignedToId: action === 'assign' ? assignedToId || null : undefined,
                contactStatus: action === 'status' ? contactStatus : undefined,
                followUpAt: action === 'follow_up' && followUpAt ? new Date(followUpAt).toISOString() : undefined,
                followUpKind: action === 'follow_up' ? followUpKind : undefined,
              })
            }
          >
            {busy && <Spinner />}
            اجرا
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="اقدام">
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="audit">بررسی وب‌سایت</option>
            <option value="rescore">محاسبه مجدد امتیاز</option>
            {canRunAi && <option value="analyze">تحلیل هوش مصنوعی</option>}
            {canAssign && <option value="assign">واگذاری به کارشناس</option>}
            <option value="status">تغییر وضعیت</option>
            <option value="follow_up">ثبت پیگیری</option>
            <option value="archive">بایگانی</option>
          </select>
        </Field>

        {action === 'assign' && (
          <Field label="کارشناس فروش" hint="خالی بگذارید تا واگذاری لغو شود.">
            <select className="input" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
              <option value="">— بدون کارشناس —</option>
              {users.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {action === 'status' && (
          <Field label="وضعیت جدید">
            <select className="input" value={contactStatus} onChange={(e) => setContactStatus(e.target.value)}>
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        )}

        {action === 'follow_up' && (
          <>
            <Field label="نوع پیگیری">
              <input className="input" value={followUpKind} onChange={(e) => setFollowUpKind(e.target.value)} />
            </Field>
            <Field label="تاریخ و ساعت" required>
              <input
                type="datetime-local"
                className="input"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
              />
            </Field>
          </>
        )}

        {(action === 'audit' || action === 'analyze') && (
          <p className="rounded-xl bg-surface-2 p-3 text-[11px] leading-6 text-subtle">
            این عملیات در پس‌زمینه اجرا می‌شود و ممکن است چند دقیقه طول بکشد. نتیجه پس از اتمام روی هر سرنخ ثبت می‌شود.
            {action === 'analyze' && ' تحلیل هوش مصنوعی فقط برای سرنخ‌هایی اجرا می‌شود که امتیاز آن‌ها از آستانه تنظیم‌شده بالاتر باشد.'}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Read the initial filters from the URL so links like /leads?temperature=HOT work. */
function readFiltersFromUrl(): Filters {
  if (typeof window === 'undefined') return EMPTY_FILTERS;
  const params = new URLSearchParams(window.location.search);
  return {
    ...EMPTY_FILTERS,
    q: params.get('q') ?? '',
    temperature: params.getAll('temperature'),
    contactStatus: params.getAll('contactStatus'),
    city: params.getAll('city'),
    recommendedService: params.getAll('recommendedService'),
    websiteFilter: params.get('websiteFilter') ?? 'ANY',
    includeDemo: params.get('includeDemo') === 'true',
  };
}
