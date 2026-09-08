'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Field, Loading, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faDate, faRelative, isOverdue } from '@/lib/format';

interface ActivityResponse {
  activities: Array<{ id: string; type: string; title: string; body: string | null; createdAt: string; user: { name: string } | null }>;
  calls: Array<{ id: string; outcome: string; durationSeconds: number | null; notes: string | null; createdAt: string; user: { name: string } | null }>;
  notes: Array<{ id: string; body: string; isPinned: boolean; createdAt: string; user: { name: string } | null }>;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; assignedTo: { name: string } | null }>;
  followUps: Array<{ id: string; kind: string; dueAt: string; completedAt: string | null; notes: string | null }>;
}

const ACTIVITY_LABELS: Record<string, string> = {
  CALL: 'تماس',
  NOTE: 'یادداشت',
  STATUS_CHANGE: 'تغییر وضعیت',
  ASSIGNMENT: 'واگذاری',
  EMAIL: 'ایمیل',
  MEETING: 'جلسه',
  PROPOSAL_SENT: 'ارسال پیشنهاد',
  FOLLOW_UP: 'پیگیری',
  SYSTEM: 'سیستم',
};

const OUTCOME_LABELS: Record<string, string> = {
  ANSWERED: 'پاسخ داده شد',
  NO_ANSWER: 'بدون پاسخ',
  BUSY: 'مشغول',
  WRONG_NUMBER: 'شماره اشتباه',
  CALLBACK_REQUESTED: 'درخواست تماس مجدد',
  NOT_INTERESTED: 'علاقه‌مند نبود',
  INTERESTED: 'علاقه‌مند',
  MEETING_SET: 'جلسه هماهنگ شد',
};

/** Contact history, notes, tasks and follow-ups for one lead. */
export function ActivityTab({ leadId, onReload }: { leadId: string; onReload: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState({ kind: 'تماس مجدد', dueAt: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<ActivityResponse>(`/api/leads/${leadId}/activity`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addNote = async () => {
    if (!noteBody.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/crm/leads/${leadId}/notes`, { body: noteBody.trim() });
      setNoteBody('');
      toast.show('یادداشت ثبت شد');
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ثبت یادداشت ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addFollowUp = async () => {
    if (!followUp.dueAt) return;
    setBusy(true);
    try {
      await api.post(`/api/crm/leads/${leadId}/follow-ups`, {
        kind: followUp.kind,
        dueAt: new Date(followUp.dueAt).toISOString(),
        notes: followUp.notes || undefined,
      });
      setFollowUp({ kind: 'تماس مجدد', dueAt: '', notes: '' });
      toast.show('پیگیری ثبت شد');
      await load();
      onReload();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ثبت پیگیری ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const completeFollowUp = async (id: string) => {
    await api.post(`/api/crm/follow-ups/${id}/complete`).catch(() => undefined);
    await load();
    onReload();
  };

  if (loading && !data) return <Loading />;

  return (
    <>
      {toast.node}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card title="یادداشت جدید">
            <textarea
              rows={3}
              className="input"
              placeholder="آنچه در تماس فهمیدید را اینجا بنویسید…"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn-primary btn-sm" onClick={addNote} disabled={busy || !noteBody.trim()}>
                {busy && <Spinner />}
                ثبت یادداشت
              </button>
            </div>
          </Card>

          <Card title="تاریخچه فعالیت" padded={false}>
            {!data || data.activities.length === 0 ? (
              <EmptyState title="فعالیتی ثبت نشده است" description="تماس‌ها، تغییر وضعیت‌ها و یادداشت‌ها اینجا ثبت می‌شوند." />
            ) : (
              <ul className="divide-y divide-border">
                {data.activities.map((activity) => (
                  <li key={activity.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="chip bg-surface-2 text-subtle">{ACTIVITY_LABELS[activity.type] ?? activity.type}</span>
                      <span className="text-[11px] text-subtle">{faRelative(activity.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm">{activity.title}</p>
                    {activity.body && <p className="mt-0.5 text-xs leading-6 text-subtle">{activity.body}</p>}
                    {activity.user && <p className="mt-1 text-[11px] text-subtle">{activity.user.name}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data && data.calls.length > 0 && (
            <Card title="تماس‌ها" padded={false}>
              <ul className="divide-y divide-border">
                {data.calls.map((call) => (
                  <li key={call.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{OUTCOME_LABELS[call.outcome] ?? call.outcome}</span>
                      <span className="text-[11px] text-subtle">{faDate(call.createdAt, true)}</span>
                    </div>
                    {call.notes && <p className="mt-1 text-xs leading-6 text-subtle">{call.notes}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="ثبت پیگیری">
            <div className="space-y-3">
              <Field label="نوع">
                <select className="input" value={followUp.kind} onChange={(e) => setFollowUp({ ...followUp, kind: e.target.value })}>
                  <option>تماس مجدد</option>
                  <option>ارسال پیشنهاد</option>
                  <option>ارسال نمونه‌کار</option>
                  <option>هماهنگی جلسه</option>
                  <option>ارسال گزارش بررسی سایت</option>
                </select>
              </Field>
              <Field label="تاریخ و ساعت" required>
                <input type="datetime-local" className="input" value={followUp.dueAt} onChange={(e) => setFollowUp({ ...followUp, dueAt: e.target.value })} />
              </Field>
              <Field label="یادداشت">
                <input className="input" value={followUp.notes} onChange={(e) => setFollowUp({ ...followUp, notes: e.target.value })} />
              </Field>
              <button type="button" className="btn-primary btn-sm w-full" onClick={addFollowUp} disabled={busy || !followUp.dueAt}>
                {busy && <Spinner />}
                ثبت
              </button>
            </div>
          </Card>

          <Card title="پیگیری‌های باز">
            {!data || data.followUps.filter((f) => !f.completedAt).length === 0 ? (
              <p className="text-xs text-subtle">پیگیری بازی وجود ندارد.</p>
            ) : (
              <ul className="space-y-2">
                {data.followUps
                  .filter((f) => !f.completedAt)
                  .map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-2 rounded-xl border border-border p-3">
                      <div>
                        <p className="text-sm font-medium">{f.kind}</p>
                        <p className={`text-[11px] ${isOverdue(f.dueAt) ? 'text-danger' : 'text-subtle'}`}>
                          {faDate(f.dueAt, true)} • {faRelative(f.dueAt)}
                        </p>
                        {f.notes && <p className="mt-1 text-[11px] text-subtle">{f.notes}</p>}
                      </div>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => void completeFollowUp(f.id)}>
                        انجام شد
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          {data && data.notes.length > 0 && (
            <Card title="یادداشت‌ها" padded={false}>
              <ul className="divide-y divide-border">
                {data.notes.map((note) => (
                  <li key={note.id} className="px-5 py-3">
                    <p className="whitespace-pre-wrap text-sm leading-7">{note.body}</p>
                    <p className="mt-1 text-[11px] text-subtle">
                      {note.user?.name ?? 'سیستم'} • {faRelative(note.createdAt)}
                      {note.isPinned && <span className="ms-2 text-accent">سنجاق‌شده</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
