'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { can, type Permission, type Role } from '@baimar/shared';
import { api, clearTokens, getAccessToken, setTokens } from './api';

/**
 * Session context.
 *
 * Holds the signed-in user and exposes the same permission check the API enforces, so a
 * control is never rendered for an action the server will reject.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  telegramChatId: string | null;
  locale: string;
  theme: string;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadUser = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: SessionUser; permissions: Permission[] }>('/api/auth/me');
      setUser(data.user);
      setPermissions(data.permissions);
    } catch {
      setUser(null);
      clearTokens();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<{ user: SessionUser; accessToken: string; refreshToken: string }>(
        '/api/auth/login',
        { email, password },
      );
      setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      await loadUser();
      router.push('/');
    },
    [loadUser, router],
  );

  const logout = useCallback(async () => {
    const refreshToken = window.localStorage.getItem('baimar.refresh');
    await api.post('/api/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    setUser(null);
    setPermissions([]);
    router.push('/login');
  }, [router]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      permissions,
      can: (permission: Permission) => (user ? can(user.role, permission) : false),
      login,
      logout,
      refreshUser: loadUser,
    }),
    [user, loading, permissions, login, logout, loadUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** Redirect to the login page when there is no session. */
export function useRequireAuth(): SessionValue {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!session.loading && !session.user) router.replace('/login');
  }, [session.loading, session.user, router]);

  return session;
}
