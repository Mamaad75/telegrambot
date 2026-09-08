'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { normalizePhone } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { Card, Field, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** Manual lead creation. Runs through the same normalization and dedupe as discovery. */
export default function NewLeadPage() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    businessName: '',
    phone: '',
    email: '',
    website: '',
    city: '',
    province: '',
    address: '',
    category: '',
    instagramUrl: '',
    description: '',
  });

  const phonePreview = form.phone ? normalizePhone(form.phone) : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ action: string; lead: { id: string }; evidence?: string }>('/api/leads', {
        ...form,
        email: form.email || undefined,
        website: form.website || undefined,
      });
      if (result.action === 'merged') {
        toast.show(`این کسب‌وکار قبلاً ثبت شده بود و اطلاعات ادغام شد. ${result.evidence ?? ''}`);
      }
      router.push(`/leads/${result.lead.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ثبت سرنخ ناموفق بود', 'error');
      setBusy(false);
    }
  };

  return (
    <>
      {toast.node}
      <PageHeader
        title="سرنخ جدید"
        description="کسب‌وکار جدید به‌صورت دستی ثبت می‌شود و از همان مسیر نرمال‌سازی و حذف تکراری عبور می‌کند."
      />

      <form onSubmit={submit} className="max-w-3xl">
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="نام کسب‌وکار" required>
                <input
                  className="input"
                  required
                  minLength={2}
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label="تلفن"
              hint={
                phonePreview
                  ? phonePreview.valid
                    ? `نرمال‌سازی: ${phonePreview.e164} (${phonePreview.kind === 'MOBILE' ? 'موبایل' : 'ثابت'})`
                    : `قابل تشخیص نیست — مقدار اصلی حفظ می‌شود (${phonePreview.reason})`
                  : 'مثال: ۰۹۱۲۳۴۵۶۷۸۹ یا ۰۸۶۳۳۳۳۴۴۵۵'
              }
            >
              <input dir="ltr" className="input text-start" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>

            <Field label="ایمیل">
              <input type="email" dir="ltr" className="input text-start" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>

            <Field label="وب‌سایت" hint="خالی بگذارید تا سامانه خودش جست‌وجو کند.">
              <input dir="ltr" className="input text-start" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </Field>

            <Field label="اینستاگرام">
              <input dir="ltr" className="input text-start" value={form.instagramUrl} onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })} />
            </Field>

            <Field label="شهر">
              <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>

            <Field label="استان">
              <input className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            </Field>

            <Field label="دسته کسب‌وکار">
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
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

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => router.back()}>
              انصراف
            </button>
            <button type="submit" className="btn-primary btn-sm" disabled={busy || form.businessName.trim().length < 2}>
              {busy && <Spinner />}
              ثبت سرنخ
            </button>
          </div>
        </Card>
      </form>
    </>
  );
}
