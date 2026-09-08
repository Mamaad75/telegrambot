'use client';

import { useState } from 'react';
import { normalizePhone } from '@baimar/shared';
import { ConfidenceBadge, ValueOrUnknown } from '@/components/badges';
import { Card, Field, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, phone } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { LeadDetail } from '../types';

/** Business facts, all editable by a salesperson who learns something on a call. */
export function BusinessTab({ data, onReload }: { data: LeadDetail; onReload: () => void }) {
  const session = useSession();
  const toast = useToast();
  const lead = data.lead;

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    businessName: lead.businessName,
    originalPhone: lead.originalPhone ?? lead.normalizedPhone ?? '',
    email: lead.email ?? '',
    website: lead.website ?? '',
    city: lead.city ?? '',
    province: lead.province ?? '',
    address: lead.address ?? '',
    category: lead.category ?? '',
    instagramUrl: lead.instagramUrl ?? '',
    telegramUrl: lead.telegramUrl ?? '',
    decisionMakerName: lead.decisionMakerName ?? '',
    decisionMakerRole: lead.decisionMakerRole ?? '',
    description: lead.description ?? '',
  });

  const phonePreview = form.originalPhone ? normalizePhone(form.originalPhone) : null;

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/leads/${lead.id}`, {
        ...form,
        email: form.email || null,
        website: form.website || null,
        originalPhone: form.originalPhone || null,
      });
      toast.show('اطلاعات ذخیره شد');
      setEditing(false);
      onReload();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <>
        {toast.node}
        <Card title="ویرایش اطلاعات کسب‌وکار">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="نام کسب‌وکار" required>
              <input className="input" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
            </Field>
            <Field
              label="تلفن"
              hint={
                phonePreview
                  ? phonePreview.valid
                    ? `نرمال‌سازی می‌شود به ${phonePreview.e164} (${phonePreview.kind === 'MOBILE' ? 'موبایل' : 'ثابت'})`
                    : `قابل تشخیص نیست (${phonePreview.reason}) — مقدار اصلی حفظ می‌شود`
                  : 'با هر قالبی وارد کنید؛ خودکار نرمال‌سازی می‌شود.'
              }
            >
              <input dir="ltr" className="input text-start" value={form.originalPhone} onChange={(e) => setForm({ ...form, originalPhone: e.target.value })} />
            </Field>
            <Field label="ایمیل">
              <input dir="ltr" className="input text-start" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="وب‌سایت">
              <input dir="ltr" className="input text-start" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </Field>
            <Field label="شهر">
              <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="استان">
              <input className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            </Field>
            <Field label="دسته">
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
            <Field label="اینستاگرام">
              <input dir="ltr" className="input text-start" value={form.instagramUrl} onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })} />
            </Field>
            <Field label="تلگرام">
              <input dir="ltr" className="input text-start" value={form.telegramUrl} onChange={(e) => setForm({ ...form, telegramUrl: e.target.value })} />
            </Field>
            <Field label="نام تصمیم‌گیرنده" hint="فقط اگر خودشان در تماس اعلام کرده‌اند.">
              <input className="input" value={form.decisionMakerName} onChange={(e) => setForm({ ...form, decisionMakerName: e.target.value })} />
            </Field>
            <Field label="سمت تصمیم‌گیرنده">
              <input className="input" value={form.decisionMakerRole} onChange={(e) => setForm({ ...form, decisionMakerRole: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="آدرس">
                <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="توضیحات">
                <textarea rows={3} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(false)}>
              انصراف
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>
              {busy && <Spinner />}
              ذخیره
            </button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      {toast.node}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="اطلاعات تماس"
          action={
            session.can('lead:update') && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
                ویرایش
              </button>
            )
          }
        >
          <dl className="space-y-3 text-sm">
            <Row label="تلفن اصلی">
              {lead.normalizedPhone ? (
                <a href={`tel:${lead.normalizedPhone}`} className="tnum text-accent hover:underline" dir="ltr">
                  {phone(lead.normalizedPhone)}
                </a>
              ) : (
                <ValueOrUnknown value={null} />
              )}
              {lead.originalPhone && lead.originalPhone !== lead.normalizedPhone && (
                <span className="ms-2 text-[11px] text-subtle" dir="ltr">
                  (اصل: {lead.originalPhone})
                </span>
              )}
            </Row>
            {lead.extraPhones.length > 0 && (
              <Row label="شماره‌های دیگر">
                <span className="tnum" dir="ltr">
                  {lead.extraPhones.map((p) => phone(p)).join('، ')}
                </span>
              </Row>
            )}
            <Row label="ایمیل">
              <ValueOrUnknown value={lead.email} />
            </Row>
            <Row label="وب‌سایت">
              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline" dir="ltr">
                  {lead.websiteDomain}
                </a>
              ) : (
                <ValueOrUnknown value={null} unknownLabel="یافت نشد" />
              )}
              {lead.websiteCheckedAt && <span className="ms-2 text-[11px] text-subtle">بررسی: {faDate(lead.websiteCheckedAt)}</span>}
            </Row>
            <Row label="آدرس">
              <ValueOrUnknown value={lead.address} />
            </Row>
            <Row label="تصمیم‌گیرنده">
              <ValueOrUnknown
                value={lead.decisionMakerName ? `${lead.decisionMakerName}${lead.decisionMakerRole ? ` — ${lead.decisionMakerRole}` : ''}` : null}
                unknownLabel="نامشخص — در تماس بپرسید"
              />
            </Row>
          </dl>
        </Card>

        <Card title="حضور دیجیتال">
          <dl className="space-y-3 text-sm">
            <Row label="اینستاگرام">
              <SocialLink url={lead.instagramUrl} />
            </Row>
            <Row label="تلگرام">
              <SocialLink url={lead.telegramUrl} />
            </Row>
            <Row label="واتساپ">
              <SocialLink url={lead.whatsappUrl} />
            </Row>
            <Row label="لینکدین">
              <SocialLink url={lead.linkedinUrl} />
            </Row>
            <Row label="گوگل مپ">
              <SocialLink url={lead.googleMapsUrl} />
            </Row>
            <Row label="نظرات عمومی">
              <ValueOrUnknown
                value={
                  lead.reviewCount !== null
                    ? `${fa(lead.reviewCount)} نظر${lead.reviewRating ? ` • میانگین ${fa(lead.reviewRating.toFixed(1))}` : ''}`
                    : null
                }
              />
            </Row>
          </dl>
        </Card>

        <Card title="خدمات و محصولات">
          {lead.services.length === 0 && lead.products.length === 0 ? (
            <p className="text-xs text-subtle">اطلاعاتی درباره خدمات یا محصولات ثبت نشده است.</p>
          ) : (
            <div className="space-y-3">
              {lead.services.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] text-subtle">خدمات</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lead.services.map((s) => (
                      <span key={s} className="chip bg-surface-2 text-muted">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {lead.products.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] text-subtle">محصولات</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lead.products.map((p) => (
                      <span key={p} className="chip bg-surface-2 text-muted">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {lead.description && <p className="mt-3 border-t border-border pt-3 text-xs leading-6 text-muted">{lead.description}</p>}
        </Card>

        <Card title="سیگنال‌های شبکه اجتماعی" subtitle="فقط اطلاعات عمومی قابل مشاهده">
          {lead.socialSignals.length === 0 ? (
            <p className="text-xs text-subtle">سیگنال اجتماعی ثبت‌شده‌ای وجود ندارد.</p>
          ) : (
            <ul className="space-y-2">
              {lead.socialSignals.map((signal) => (
                <li key={signal.id} className="flex items-center justify-between gap-2 text-xs">
                  <a href={signal.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline" dir="ltr">
                    {signal.platform}
                  </a>
                  <span className="flex items-center gap-2 text-subtle">
                    {signal.followers !== null ? `${fa(signal.followers)} دنبال‌کننده` : 'شمارش در دسترس نیست'}
                    <ConfidenceBadge confidence={signal.confidence as never} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-2.5 last:border-0 last:pb-0">
      <dt className="shrink-0 text-xs text-subtle">{label}</dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  );
}

function SocialLink({ url }: { url: string | null }) {
  if (!url) return <ValueOrUnknown value={null} unknownLabel="یافت نشد" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-accent hover:underline" dir="ltr">
      {url.replace(/^https?:\/\//, '').slice(0, 40)}
    </a>
  );
}
