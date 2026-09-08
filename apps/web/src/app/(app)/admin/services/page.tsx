'use client';

import { useCallback, useEffect, useState } from 'react';
import { SCORING_SIGNAL_META, type ScoringSignal } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { Card, EmptyState, ErrorNote, Field, Loading, Modal, Spinner, Toggle, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNumber } from '@/lib/format';
import { useSession } from '@/lib/session';

interface ServiceRule {
  requiresAll?: string[];
  requiresAny?: string[];
  excludes?: string[];
  points: number;
  reasonFa: string;
  reasonEn: string;
}

interface Service {
  id: string;
  key: string;
  nameFa: string;
  nameEn: string;
  descriptionFa: string | null;
  basePriority: number;
  isActive: boolean;
  rules: ServiceRule[];
  salesAngles: string[];
  commonObjections: string[];
  objectionResponses: string[];
  discoveryQuestions: string[];
  opportunityCount: number;
}

/**
 * The service catalogue is data, not code: an administrator can add an offering, describe
 * when it applies, and the opportunity engine starts recommending it immediately.
 */
export default function ServicesPage() {
  const session = useSession();
  const toast = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [signals, setSignals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ items: Service[]; signals: string[] }>('/api/services');
      setServices(data.items);
      setSignals(data.signals);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت خدمات ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (service: Service) => {
    try {
      await api.patch(`/api/services/${service.id}`, { isActive: !service.isActive });
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'تغییر وضعیت ناموفق بود', 'error');
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      {toast.node}
      <PageHeader
        title="خدمات بایمر"
        description="فهرست خدمات و قواعدی که تعیین می‌کند هر خدمت برای چه نوع سرنخی پیشنهاد شود. این قواعد در پایگاه داده ذخیره می‌شوند، نه در کد."
        actions={
          session.can('settings:write') && (
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
              خدمت جدید
            </button>
          )
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      {services.length === 0 ? (
        <Card>
          <EmptyState title="خدمتی ثبت نشده است" description="با اجرای seed اولیه، فهرست پیش‌فرض خدمات بایمر ساخته می‌شود." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {services.map((service) => (
            <Card key={service.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{service.nameFa}</h3>
                    <span className="chip bg-surface-2 text-subtle" dir="ltr">
                      {service.key}
                    </span>
                    {!service.isActive && <span className="chip bg-surface-2 text-subtle">غیرفعال</span>}
                  </div>
                  {service.descriptionFa && <p className="mt-1.5 text-[11px] leading-6 text-subtle">{service.descriptionFa}</p>}
                </div>
                {session.can('settings:write') && (
                  <Toggle checked={service.isActive} onChange={() => void toggleActive(service)} label={service.nameFa} />
                )}
              </div>

              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <p className="text-[11px] font-medium text-subtle">قواعد پیشنهاد ({faNumber(service.rules.length)})</p>
                {service.rules.length === 0 ? (
                  <p className="text-[11px] text-subtle">قاعده‌ای تعریف نشده — این خدمت هرگز خودکار پیشنهاد نمی‌شود.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {service.rules.map((rule, i) => (
                      <li key={i} className="rounded-lg bg-surface-2 p-2.5 text-[11px] leading-6">
                        <p className="text-fg">{rule.reasonFa}</p>
                        <p className="mt-0.5 text-subtle" dir="ltr">
                          {rule.requiresAll?.length ? `ALL: ${rule.requiresAll.join(', ')} ` : ''}
                          {rule.requiresAny?.length ? `ANY: ${rule.requiresAny.join(', ')} ` : ''}
                          {rule.excludes?.length ? `NOT: ${rule.excludes.join(', ')} ` : ''}
                          → +{rule.points}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-subtle">
                <span>{faNumber(service.opportunityCount)} فرصت تطبیق‌یافته</span>
                {session.can('settings:write') && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(service)}>
                    ویرایش
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ServiceModal
        open={creating || editing !== null}
        service={editing}
        signals={signals}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onDone={() => {
          setCreating(false);
          setEditing(null);
          void load();
          toast.show('ذخیره شد');
        }}
      />
    </>
  );
}

function ServiceModal({
  open,
  service,
  signals,
  onClose,
  onDone,
}: {
  open: boolean;
  service: Service | null;
  signals: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    key: '',
    nameFa: '',
    nameEn: '',
    descriptionFa: '',
    basePriority: 50,
    salesAngles: '',
    commonObjections: '',
    objectionResponses: '',
    discoveryQuestions: '',
    rules: [] as ServiceRule[],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (service) {
      setForm({
        key: service.key,
        nameFa: service.nameFa,
        nameEn: service.nameEn,
        descriptionFa: service.descriptionFa ?? '',
        basePriority: service.basePriority,
        salesAngles: service.salesAngles.join('\n'),
        commonObjections: service.commonObjections.join('\n'),
        objectionResponses: service.objectionResponses.join('\n'),
        discoveryQuestions: service.discoveryQuestions.join('\n'),
        rules: service.rules,
      });
    } else {
      setForm({
        key: '',
        nameFa: '',
        nameEn: '',
        descriptionFa: '',
        basePriority: 50,
        salesAngles: '',
        commonObjections: '',
        objectionResponses: '',
        discoveryQuestions: '',
        rules: [],
      });
    }
    setError(null);
  }, [service, open]);

  const lines = (value: string) => value.split('\n').map((l) => l.trim()).filter(Boolean);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = {
      nameFa: form.nameFa,
      nameEn: form.nameEn,
      descriptionFa: form.descriptionFa || undefined,
      basePriority: Number(form.basePriority),
      rules: form.rules,
      salesAngles: lines(form.salesAngles),
      commonObjections: lines(form.commonObjections),
      objectionResponses: lines(form.objectionResponses),
      discoveryQuestions: lines(form.discoveryQuestions),
    };
    try {
      if (service) await api.patch(`/api/services/${service.id}`, body);
      else await api.post('/api/services', { ...body, key: form.key });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const updateRule = (index: number, patch: Partial<ServiceRule>) =>
    setForm((f) => ({ ...f, rules: f.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={service ? `ویرایش «${service.nameFa}»` : 'خدمت جدید'}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy || !form.nameFa || (!service && !form.key)}>
            {busy && <Spinner />}
            ذخیره
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {!service && (
            <Field label="کلید" required hint="حروف بزرگ انگلیسی و زیرخط، مثال: WEBSITE_DESIGN">
              <input dir="ltr" className="input text-start" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })} />
            </Field>
          )}
          <Field label="نام فارسی" required>
            <input className="input" value={form.nameFa} onChange={(e) => setForm({ ...form, nameFa: e.target.value })} />
          </Field>
          <Field label="نام انگلیسی" required>
            <input dir="ltr" className="input text-start" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Field>
          <Field label="اولویت پایه" hint="در تساوی قواعد، خدمت با اولویت بالاتر انتخاب می‌شود.">
            <input type="number" min={0} max={200} className="input" value={form.basePriority} onChange={(e) => setForm({ ...form, basePriority: Number(e.target.value) })} />
          </Field>
        </div>

        <Field label="توضیحات">
          <textarea rows={2} className="input" value={form.descriptionFa} onChange={(e) => setForm({ ...form, descriptionFa: e.target.value })} />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">قواعد پیشنهاد</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  rules: [...f.rules, { requiresAny: [], points: 50, reasonFa: '', reasonEn: '' }],
                }))
              }
            >
              افزودن قاعده
            </button>
          </div>

          {form.rules.length === 0 ? (
            <p className="rounded-xl bg-surface-2 p-3 text-[11px] leading-6 text-subtle">
              بدون قاعده، این خدمت هرگز به‌صورت خودکار پیشنهاد نمی‌شود.
            </p>
          ) : (
            <ul className="space-y-3">
              {form.rules.map((rule, index) => (
                <li key={index} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-subtle">قاعده {index + 1}</span>
                    <button
                      type="button"
                      className="text-[11px] text-danger hover:underline"
                      onClick={() => setForm((f) => ({ ...f, rules: f.rules.filter((_, i) => i !== index) }))}
                    >
                      حذف
                    </button>
                  </div>

                  <div className="space-y-2">
                    <SignalPicker
                      label="حداقل یکی از این سیگنال‌ها"
                      signals={signals}
                      selected={rule.requiresAny ?? []}
                      onChange={(value) => updateRule(index, { requiresAny: value })}
                    />
                    <SignalPicker
                      label="همه این سیگنال‌ها"
                      signals={signals}
                      selected={rule.requiresAll ?? []}
                      onChange={(value) => updateRule(index, { requiresAll: value })}
                    />
                    <SignalPicker
                      label="هیچ‌کدام از این سیگنال‌ها"
                      signals={signals}
                      selected={rule.excludes ?? []}
                      onChange={(value) => updateRule(index, { excludes: value })}
                    />

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="امتیاز">
                        <input type="number" min={0} max={200} className="input py-1 text-xs" value={rule.points} onChange={(e) => updateRule(index, { points: Number(e.target.value) })} />
                      </Field>
                      <Field label="دلیل (فارسی)">
                        <input className="input py-1 text-xs" value={rule.reasonFa} onChange={(e) => updateRule(index, { reasonFa: e.target.value })} />
                      </Field>
                      <Field label="دلیل (انگلیسی)">
                        <input dir="ltr" className="input py-1 text-start text-xs" value={rule.reasonEn} onChange={(e) => updateRule(index, { reasonEn: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="زوایای فروش" hint="هر خط یک مورد.">
            <textarea rows={3} className="input" value={form.salesAngles} onChange={(e) => setForm({ ...form, salesAngles: e.target.value })} />
          </Field>
          <Field label="سؤال‌های کشف" hint="هر خط یک مورد.">
            <textarea rows={3} className="input" value={form.discoveryQuestions} onChange={(e) => setForm({ ...form, discoveryQuestions: e.target.value })} />
          </Field>
          <Field label="اعتراض‌های رایج" hint="هر خط یک مورد.">
            <textarea rows={3} className="input" value={form.commonObjections} onChange={(e) => setForm({ ...form, commonObjections: e.target.value })} />
          </Field>
          <Field label="پاسخ به اعتراض‌ها" hint="ترتیب خطوط با اعتراض‌ها متناظر است.">
            <textarea rows={3} className="input" value={form.objectionResponses} onChange={(e) => setForm({ ...form, objectionResponses: e.target.value })} />
          </Field>
        </div>

        {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function SignalPicker({
  label,
  signals,
  selected,
  onChange,
}: {
  label: string;
  signals: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-1">
        {signals.map((signal) => (
          <button
            key={signal}
            type="button"
            onClick={() => onChange(selected.includes(signal) ? selected.filter((s) => s !== signal) : [...selected, signal])}
            className={`chip border text-[10px] transition-colors ${
              selected.includes(signal) ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-surface-2 text-subtle hover:border-accent/40'
            }`}
            title={SCORING_SIGNAL_META[signal as ScoringSignal]?.criterion}
          >
            {SCORING_SIGNAL_META[signal as ScoringSignal]?.labelFa ?? signal}
          </button>
        ))}
      </div>
    </div>
  );
}
