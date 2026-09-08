'use client';

import { useState } from 'react';
import { Field, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNumber } from '@/lib/format';

/**
 * CSV import with automatic column mapping.
 *
 * The preview step exists because a silent import is dangerous: the user sees exactly
 * which column the platform believes is the business name, the phone and the website
 * before a single row is written, and can correct any of them.
 */

const FIELD_LABELS: Record<string, string> = {
  businessName: 'نام کسب‌وکار',
  phone: 'تلفن',
  mobile: 'موبایل',
  email: 'ایمیل',
  website: 'وب‌سایت',
  city: 'شهر',
  province: 'استان',
  address: 'آدرس',
  category: 'دسته',
  subcategory: 'زیر دسته',
  instagram: 'اینستاگرام',
  telegram: 'تلگرام',
  linkedin: 'لینکدین',
  whatsapp: 'واتساپ',
  googleMaps: 'گوگل مپ',
  description: 'توضیحات',
  services: 'خدمات',
  reviewCount: 'تعداد نظرات',
  reviewRating: 'امتیاز نظرات',
  decisionMakerName: 'نام تصمیم‌گیرنده',
  decisionMakerRole: 'سمت تصمیم‌گیرنده',
};

interface Preview {
  headers: string[];
  mapping: Record<string, string | null>;
  unmapped: string[];
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  missingRequired: string[];
}

interface ImportResult {
  total: number;
  imported: number;
  merged: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export function ImportPanel({ onDone }: { onDone: () => void }) {
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runPipeline, setRunPipeline] = useState(true);
  const [defaultCity, setDefaultCity] = useState('');
  const [defaultCategory, setDefaultCategory] = useState('');

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    const text = await file.text();
    setContent(text);
    setFilename(file.name);
    setBusy(true);
    try {
      const data = await api.post<Preview>('/api/leads/import/preview', { content: text });
      setPreview(data);
      setMapping(data.mapping);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن فایل ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<ImportResult>('/api/leads/import', {
        content,
        filename,
        mapping,
        runPipeline,
        defaultCity: defaultCity || undefined,
        defaultCategory: defaultCategory || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ورود اطلاعات ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="کل ردیف‌ها" value={result.total} />
          <Stat label="ثبت جدید" value={result.imported} tone="success" />
          <Stat label="ادغام با موجود" value={result.merged} tone="info" />
          <Stat label="رد شده" value={result.skipped} tone={result.skipped ? 'warning' : 'default'} />
        </div>

        {result.errors.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-xl border border-border bg-surface-2 p-3">
            <p className="mb-2 text-xs font-medium">ردیف‌های رد شده</p>
            <ul className="space-y-1 text-[11px] text-subtle">
              {result.errors.slice(0, 50).map((e) => (
                <li key={`${e.row}-${e.reason}`}>
                  ردیف {faNumber(e.row)}: {e.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] leading-6 text-subtle">
          سرنخ‌های تکراری بر پایه شماره تلفن نرمال‌شده، دامنه وب‌سایت و شباهت نام در همان شهر ادغام شدند؛ هر منبع
          به‌صورت جداگانه روی سرنخ ثبت می‌شود.
        </p>

        <div className="flex justify-end">
          <button type="button" className="btn-primary btn-sm" onClick={onDone}>
            بستن و به‌روزرسانی فهرست
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field label="فایل CSV" hint="ستون‌ها به‌صورت خودکار تشخیص داده می‌شوند؛ می‌توانید هر نگاشت را تغییر دهید.">
        <input
          type="file"
          accept=".csv,text/csv"
          className="input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
      </Field>

      {busy && !preview && (
        <div className="flex items-center gap-2 text-sm text-subtle">
          <Spinner /> در حال خواندن فایل…
        </div>
      )}

      {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}

      {preview && (
        <>
          <p className="text-xs text-muted">
            {faNumber(preview.totalRows)} ردیف شناسایی شد.
            {preview.missingRequired.length > 0 && (
              <span className="text-danger"> ستون «نام کسب‌وکار» پیدا نشد — بدون آن ورود ممکن نیست.</span>
            )}
          </p>

          <div className="max-h-64 overflow-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="table-head">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">ستون فایل</th>
                  <th className="px-3 py-2 text-start font-medium">نگاشت به</th>
                  <th className="px-3 py-2 text-start font-medium">نمونه</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((header) => (
                  <tr key={header} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{header}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input py-1 text-xs"
                        value={mapping[header] ?? ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value || null }))}
                      >
                        <option value="">— نادیده گرفته شود —</option>
                        {Object.entries(FIELD_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-subtle">
                      {preview.sampleRows[0]?.[header] ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="شهر پیش‌فرض" hint="برای ردیف‌هایی که ستون شهر ندارند.">
              <input className="input" value={defaultCity} onChange={(e) => setDefaultCity(e.target.value)} />
            </Field>
            <Field label="دسته پیش‌فرض">
              <input className="input" value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={runPipeline} onChange={(e) => setRunPipeline(e.target.checked)} />
            پس از ورود، کشف وب‌سایت و بررسی و امتیازدهی در پس‌زمینه اجرا شود
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy || preview.missingRequired.length > 0}
              onClick={runImport}
            >
              {busy && <Spinner />}
              ورود {faNumber(preview.totalRows)} ردیف
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: string }) {
  const toneClass =
    { success: 'text-success', info: 'text-info', warning: 'text-warning', default: 'text-fg' }[tone] ?? 'text-fg';
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-[11px] text-subtle">{label}</p>
      <p className={`tnum mt-1 text-lg font-semibold ${toneClass}`}>{faNumber(value)}</p>
    </div>
  );
}
