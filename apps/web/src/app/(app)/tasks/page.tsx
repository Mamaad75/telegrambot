'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { TASK_PRIORITIES } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { Card, EmptyState, Field, Loading, Modal, Spinner, Tabs, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fa, faDate, faRelative, isOverdue, phone } from '@/lib/format';

interface Task {
  id: string;
  leadId: string | null;
  leadName: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  assignedToName: string | null;
  isOverdue: boolean;
}

interface FollowUp {
  id: string;
  kind: string;
  dueAt: string;
  notes: string | null;
  lead: { id: string; businessName: string; city: string | null; normalizedPhone: string | null; leadScore: number | null };
}

const PRIORITY_LABELS: Record<string, string> = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'زیاد', URGENT: 'فوری' };
const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'bg-surface-2 text-subtle',
  NORMAL: 'bg-info/10 text-info',
  HIGH: 'bg-warm/15 text-warm',
  URGENT: 'bg-hot/15 text-hot',
};

/** Follow-ups and tasks in one place; overdue items are surfaced first. */
export default function TasksPage() {
  const toast = useToast();
  const [tab, setTab] = useState('followups');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskData, followUpData] = await Promise.all([
        api.get<{ items: Task[] }>('/api/crm/tasks', { limit: 100 }),
        api.get<{ items: FollowUp[] }>('/api/crm/follow-ups', { limit: 100 }),
      ]);
      setTasks(taskData.items);
      setFollowUps(followUpData.items);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'دریافت اطلاعات ناموفق بود', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completeFollowUp = async (id: string) => {
    await api.post(`/api/crm/follow-ups/${id}/complete`).catch(() => undefined);
    toast.show('پیگیری بسته شد');
    await load();
  };

  const setTaskStatus = async (id: string, status: string) => {
    await api.patch(`/api/crm/tasks/${id}`, { status }).catch(() => undefined);
    await load();
  };

  const overdueCount = followUps.filter((f) => isOverdue(f.dueAt)).length + tasks.filter((t) => t.isOverdue).length;

  return (
    <>
      {toast.node}
      <PageHeader
        title="پیگیری‌ها و کارها"
        description={overdueCount > 0 ? `${fa(overdueCount)} مورد عقب‌افتاده دارید.` : 'همه چیز به‌روز است.'}
        actions={
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            کار جدید
          </button>
        }
      />

      <Tabs
        tabs={[
          { key: 'followups', label: 'پیگیری‌ها', badge: followUps.length },
          { key: 'tasks', label: 'کارها', badge: tasks.filter((t) => t.status === 'OPEN').length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {loading ? (
          <Loading />
        ) : tab === 'followups' ? (
          <Card padded={false}>
            {followUps.length === 0 ? (
              <EmptyState title="پیگیری بازی وجود ندارد" description="پس از ثبت تماس، پیگیری بعدی را زمان‌بندی کنید تا اینجا ظاهر شود." />
            ) : (
              <ul className="divide-y divide-border">
                {followUps.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <Link href={`/leads/${item.lead.id}`} className="text-sm font-medium hover:text-accent">
                        {item.lead.businessName}
                      </Link>
                      <p className="text-xs text-muted">
                        {item.kind}
                        {item.lead.city && <span className="text-subtle"> • {item.lead.city}</span>}
                      </p>
                      <p className={`text-[11px] ${isOverdue(item.dueAt) ? 'text-danger' : 'text-subtle'}`}>
                        {faDate(item.dueAt, true)} • {faRelative(item.dueAt)}
                      </p>
                      {item.notes && <p className="mt-1 text-[11px] text-subtle">{item.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.lead.normalizedPhone && (
                        <a href={`tel:${item.lead.normalizedPhone}`} className="btn-ghost btn-sm" dir="ltr">
                          {phone(item.lead.normalizedPhone)}
                        </a>
                      )}
                      <button type="button" className="btn-primary btn-sm" onClick={() => void completeFollowUp(item.id)}>
                        انجام شد
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card padded={false}>
            {tasks.length === 0 ? (
              <EmptyState title="کاری ثبت نشده است" />
            ) : (
              <ul className="divide-y divide-border">
                {tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`chip ${PRIORITY_STYLES[task.priority]}`}>{PRIORITY_LABELS[task.priority]}</span>
                        <span className={`text-sm ${task.status === 'DONE' ? 'text-subtle line-through' : 'font-medium'}`}>
                          {task.title}
                        </span>
                      </div>
                      {task.description && <p className="mt-1 text-xs text-subtle">{task.description}</p>}
                      <p className={`mt-1 text-[11px] ${task.isOverdue ? 'text-danger' : 'text-subtle'}`}>
                        {task.dueAt ? `${faDate(task.dueAt)} • ${faRelative(task.dueAt)}` : 'بدون سررسید'}
                        {task.leadName && task.leadId && (
                          <Link href={`/leads/${task.leadId}`} className="ms-2 text-accent hover:underline">
                            {task.leadName}
                          </Link>
                        )}
                      </p>
                    </div>
                    {task.status === 'OPEN' && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => void setTaskStatus(task.id, 'DONE')}>
                        انجام شد
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          void load();
          toast.show('کار ثبت شد');
        }}
      />
    </>
  );
}

function CreateTaskModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'NORMAL', dueAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/crm/tasks', {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
      });
      setForm({ title: '', description: '', priority: 'NORMAL', dueAt: '' });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="کار جدید"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy || form.title.trim().length < 2}>
            {busy && <Spinner />}
            ثبت
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="عنوان" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="توضیحات">
          <textarea rows={3} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="اولویت">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="سررسید">
            <input type="datetime-local" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          </Field>
        </div>
        {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
