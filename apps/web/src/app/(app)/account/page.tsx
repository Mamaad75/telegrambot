'use client';

import { useState } from 'react';
import { ROLE_LABELS } from '@baimar/shared';
import { PageHeader } from '@/components/app-shell';
import { Card, Field, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function AccountPage() {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [profile, setProfile] = useState({
    name: session.user?.name ?? '',
    telegramChatId: session.user?.telegramChatId ?? '',
  });
  const [passwords, setPasswords] = useState({ current: '', next: '' });

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api.patch('/api/auth/me', {
        name: profile.name,
        telegramChatId: profile.telegramChatId || null,
      });
      await session.refreshUser();
      toast.show('اطلاعات ذخیره شد');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      toast.show('رمز عبور تغییر کرد. برای ادامه باید دوباره وارد شوید.');
      setPasswords({ current: '', next: '' });
      setTimeout(() => void session.logout(), 2000);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'تغییر رمز ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {toast.node}
      <PageHeader title="حساب کاربری" description={session.user ? ROLE_LABELS[session.user.role].fa : undefined} />

      <div className="grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="مشخصات">
          <div className="space-y-4">
            <Field label="نام">
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="ایمیل">
              <input className="input text-start" dir="ltr" value={session.user?.email ?? ''} disabled />
            </Field>
            <Field
              label="شناسه چت تلگرام"
              hint="برای دریافت اعلان سرنخ داغ و یادآوری پیگیری در تلگرام. شناسه خود را از ربات دریافت کنید."
            >
              <input
                className="input text-start"
                dir="ltr"
                value={profile.telegramChatId}
                onChange={(e) => setProfile({ ...profile, telegramChatId: e.target.value })}
              />
            </Field>
            <div className="flex justify-end">
              <button type="button" className="btn-primary btn-sm" onClick={saveProfile} disabled={busy}>
                {busy && <Spinner />}
                ذخیره
              </button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="پوسته">
            <div className="flex gap-2">
              {(['dark', 'light', 'system'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  className={`btn-ghost btn-sm flex-1 ${theme === option ? 'border-accent text-accent' : ''}`}
                >
                  {{ dark: 'تیره', light: 'روشن', system: 'مطابق سیستم' }[option]}
                </button>
              ))}
            </div>
          </Card>

          <Card title="تغییر رمز عبور">
            <div className="space-y-4">
              <Field label="رمز فعلی" required>
                <input
                  type="password"
                  dir="ltr"
                  className="input text-start"
                  value={passwords.current}
                  onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                />
              </Field>
              <Field label="رمز جدید" required hint="حداقل ۱۰ کاراکتر، شامل حرف بزرگ، حرف کوچک و رقم.">
                <input
                  type="password"
                  dir="ltr"
                  className="input text-start"
                  value={passwords.next}
                  onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                />
              </Field>
              <p className="text-[11px] leading-6 text-subtle">با تغییر رمز، همه نشست‌های فعال شما بسته می‌شود.</p>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={changePassword}
                  disabled={busy || !passwords.current || passwords.next.length < 10}
                >
                  {busy && <Spinner />}
                  تغییر رمز
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
