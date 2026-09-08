'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { Card, ErrorNote, Field, Loading, Modal, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faDate, faNumber } from '@/lib/format';
import { useSession } from '@/lib/session';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  phone: string | null;
  telegramChatId: string | null;
  lastLoginAt: string | null;
  assignedLeadCount: number;
  createdAt: string;
}

export default function UsersPage() {
  const session = useSession();
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ items: UserRow[] }>('/api/users');
      setUsers(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت کاربران ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (id: string, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/api/users/${id}`, patch);
      toast.show('ذخیره شد');
      await load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود', 'error');
    }
  };

  if (loading) return <Loading />;

  const canManage = session.can('user:manage');

  return (
    <>
      {toast.node}
      <PageHeader
        title="کاربران"
        description="نقش‌ها تعیین می‌کنند هر کاربر چه چیزی می‌بیند. کارشناس فروش فقط سرنخ‌های واگذارشده به خودش را می‌بیند."
        actions={
          canManage && (
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              کاربر جدید
            </button>
          )
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-5 py-2.5 text-start font-medium">نام</th>
                <th className="px-3 py-2.5 text-start font-medium">ایمیل</th>
                <th className="px-3 py-2.5 text-start font-medium">نقش</th>
                <th className="px-3 py-2.5 text-start font-medium">سرنخ‌های واگذارشده</th>
                <th className="px-3 py-2.5 text-start font-medium">آخرین ورود</th>
                <th className="px-3 py-2.5 text-start font-medium">وضعیت</th>
                <th className="px-5 py-2.5 text-start font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-border">
                  <td className="px-5 py-2.5 font-medium">{user.name}</td>
                  <td className="px-3 py-2.5 text-muted" dir="ltr">
                    {user.email}
                  </td>
                  <td className="px-3 py-2.5">
                    {canManage ? (
                      <select
                        className="input py-1 text-xs"
                        value={user.role}
                        onChange={(e) => void update(user.id, { role: e.target.value })}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role].fa}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABELS[user.role].fa
                    )}
                  </td>
                  <td className="tnum px-3 py-2.5">{faNumber(user.assignedLeadCount)}</td>
                  <td className="px-3 py-2.5 text-subtle">{user.lastLoginAt ? faDate(user.lastLoginAt, true) : 'هرگز'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`chip ${user.isActive ? 'bg-success/10 text-success' : 'bg-surface-2 text-subtle'}`}>
                      {user.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    {canManage && (
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setResetFor(user)}>
                          تغییر رمز
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => void update(user.id, { isActive: !user.isActive })}
                        >
                          {user.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          void load();
          toast.show('کاربر ساخته شد');
        }}
      />

      <ResetPasswordModal
        user={resetFor}
        onClose={() => setResetFor(null)}
        onDone={() => {
          setResetFor(null);
          toast.show('رمز عبور تغییر کرد و همه نشست‌های آن کاربر بسته شد.');
        }}
      />
    </>
  );
}

function CreateUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SALESPERSON' as Role, telegramChatId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/users', {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        telegramChatId: form.telegramChatId || undefined,
      });
      setForm({ name: '', email: '', password: '', role: 'SALESPERSON', telegramChatId: '' });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ساخت کاربر ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="کاربر جدید"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy && <Spinner />}
            ساخت
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="نام" required>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="ایمیل" required>
          <input type="email" dir="ltr" className="input text-start" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="رمز عبور" required hint="حداقل ۱۰ کاراکتر، شامل حرف بزرگ، حرف کوچک و رقم.">
          <input type="text" dir="ltr" className="input text-start" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="نقش">
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role].fa}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شناسه چت تلگرام" hint="برای دریافت اعلان شخصی در تلگرام. اختیاری.">
          <input dir="ltr" className="input text-start" value={form.telegramChatId} onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })} />
        </Field>
        {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/users/${user.id}/reset-password`, { password });
      setPassword('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تغییر رمز ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title={`تغییر رمز عبور ${user?.name ?? ''}`}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy || password.length < 10}>
            {busy && <Spinner />}
            تغییر رمز
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="رمز عبور جدید" required hint="حداقل ۱۰ کاراکتر، شامل حرف بزرگ، حرف کوچک و رقم.">
          <input type="text" dir="ltr" className="input text-start" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <p className="text-[11px] leading-6 text-subtle">با تغییر رمز، همه نشست‌های فعال این کاربر بسته می‌شوند.</p>
        {error && <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
