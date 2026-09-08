'use client';

import { useState } from 'react';
import { CALL_OUTCOMES } from '@baimar/shared';
import { Field, Modal, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { phone as formatPhone } from '@/lib/format';

/**
 * Logging a call is the single most repeated action in the product, so it does everything
 * in one submit: records the call, advances the pipeline stage implied by the outcome, and
 * schedules the next follow-up.
 */

const OUTCOME_LABELS: Record<string, string> = {
  ANSWERED: 'پاسخ داد',
  NO_ANSWER: 'پاسخ نداد',
  BUSY: 'مشغول بود',
  WRONG_NUMBER: 'شماره اشتباه',
  CALLBACK_REQUESTED: 'خواست بعداً تماس بگیریم',
  NOT_INTERESTED: 'علاقه‌مند نبود',
  INTERESTED: 'علاقه‌مند شد',
  MEETING_SET: 'جلسه هماهنگ شد',
};

/** Outcomes where scheduling the next touch is the natural default. */
const SUGGESTS_FOLLOW_UP = ['NO_ANSWER', 'BUSY', 'CALLBACK_REQUESTED', 'INTERESTED', 'MEETING_SET'];

export function LogCallModal({
  open,
  onClose,
  leadId,
  phoneNumber,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  phoneNumber: string | null;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState('ANSWERED');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [nextActionKind, setNextActionKind] = useState('تماس مجدد');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/crm/leads/${leadId}/calls`, {
        outcome,
        notes: notes || undefined,
        durationSeconds: duration ? Number(duration) * 60 : undefined,
        phone: phoneNumber ?? undefined,
        nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : undefined,
        nextActionKind: nextActionAt ? nextActionKind : undefined,
      });
      setNotes('');
      setDuration('');
      setNextActionAt('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت تماس ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ثبت تماس"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy && <Spinner />}
            ثبت
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {phoneNumber && (
          <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">
            شماره: <span className="tnum" dir="ltr">{formatPhone(phoneNumber)}</span>
          </p>
        )}

        <Field label="نتیجه تماس" required>
          <select
            className="input"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              // Pre-fill tomorrow for outcomes that clearly need another touch.
              if (SUGGESTS_FOLLOW_UP.includes(e.target.value) && !nextActionAt) {
                const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
                tomorrow.setMinutes(0, 0, 0);
                setNextActionAt(new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
              }
            }}
          >
            {CALL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o] ?? o}
              </option>
            ))}
          </select>
        </Field>

        <Field label="مدت تماس (دقیقه)">
          <input type="number" min={0} className="input" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>

        <Field label="یادداشت تماس" hint="فقط آنچه واقعاً گفته شد را بنویسید؛ این متن در تاریخچه سرنخ ثبت می‌شود.">
          <textarea rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="پیگیری بعدی">
            <input type="datetime-local" className="input" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
          </Field>
          <Field label="نوع پیگیری">
            <input className="input" value={nextActionKind} onChange={(e) => setNextActionKind(e.target.value)} disabled={!nextActionAt} />
          </Field>
        </div>

        {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
