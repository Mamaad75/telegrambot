'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

export default function LoginPage() {
  const session = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session.loading && session.user) router.replace('/');
  }, [session.loading, session.user, router]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await session.login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'اتصال به سرور برقرار نشد. بررسی کنید که سرویس API در حال اجرا باشد.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-fg">
            ب
          </div>
          <h1 className="text-lg font-semibold tracking-tight">بایمر — هوشمندی سرنخ</h1>
          <p className="mt-1 text-xs text-subtle">برای ادامه وارد حساب کاربری خود شوید</p>
        </div>

        <form onSubmit={onSubmit} className="card card-pad space-y-4">
          <div>
            <label className="label" htmlFor="email">
              ایمیل
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              dir="ltr"
              className="input text-start"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              رمز عبور
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              className="input text-start"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs leading-6 text-danger">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting && <Spinner />}
            ورود
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-5 text-subtle">
          این سامانه فقط اطلاعات عمومی کسب‌وکارها را پردازش می‌کند.
        </p>
      </div>
    </div>
  );
}
