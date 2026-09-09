'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROLE_LABELS } from '@baimar/shared';
import { api } from '@/lib/api';
import { faRelative } from '@/lib/format';
import { useRequireAuth } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Loading, Spinner } from './ui';

/**
 * Application shell: sidebar navigation, top bar, notification bell.
 *
 * The layout is RTL-first and collapses to a slide-over drawer below `lg`, because a
 * salesperson checking a sales brief before dialling is usually on a phone.
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: Parameters<ReturnType<typeof useRequireAuth>['can']>[0];
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'فروش',
    items: [
      { href: '/', label: 'داشبورد', icon: '◧' },
      { href: '/today', label: 'کارهای امروز', icon: '☀' },
      { href: '/leads', label: 'سرنخ‌ها', icon: '☷' },
      { href: '/tasks', label: 'پیگیری‌ها', icon: '✓' },
    ],
  },
  {
    section: 'هوشمندی',
    items: [
      { href: '/campaigns', label: 'کمپین‌ها', icon: '◎', permission: 'campaign:read' },
      { href: '/market', label: 'هوشمندی بازار', icon: '↗', permission: 'market:read' },
      { href: '/reports', label: 'گزارش‌ها', icon: '▤', permission: 'report:read' },
    ],
  },
  {
    section: 'مدیریت',
    items: [
      { href: '/admin/providers', label: 'یکپارچه‌سازی‌ها', icon: '⚙', permission: 'provider:read' },
      { href: '/admin/scoring', label: 'امتیازدهی', icon: '≡', permission: 'settings:read' },
      { href: '/admin/services', label: 'خدمات بایمر', icon: '✦', permission: 'settings:read' },
      { href: '/admin/users', label: 'کاربران', icon: '☺', permission: 'user:read' },
      { href: '/admin/logs', label: 'گزارش فعالیت', icon: '⌸', permission: 'audit_log:read' },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useRequireAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (session.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }
  if (!session.user) return null;

  return (
    <div className="min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-border bg-surface lg:block">
        <SidebarContent pathname={pathname} can={session.can} />
      </aside>

      {/* Drawer (mobile) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} role="presentation" />
          <aside className="absolute inset-y-0 start-0 w-72 border-e border-border bg-surface shadow-pop animate-fade-in">
            <SidebarContent pathname={pathname} can={session.can} />
          </aside>
        </div>
      )}

      <div className="lg:ps-64">
        <TopBar onMenu={() => setDrawerOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  pathname,
  can,
}: {
  pathname: string;
  can: ReturnType<typeof useRequireAuth>['can'];
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <BrandMark />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">بایمر</p>
          <p className="truncate text-[11px] text-subtle">هوشمندی سرنخ و بازار</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group) => {
          const items = group.items.filter((item) => !item.permission || can(item.permission));
          if (!items.length) return null;
          return (
            <div key={group.section} className="mb-5">
              <p className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-subtle">{group.section}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                          active ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
                        }`}
                      >
                        <span className="w-4 text-center opacity-70">{item.icon}</span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3 text-[11px] leading-5 text-subtle">
        داده‌های عمومی کسب‌وکارها. هیچ اطلاعات خصوصی افراد جمع‌آوری نمی‌شود.
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-fg">
      ب
    </span>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const session = useRequireAuth();
  const { resolved, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <button type="button" className="btn-ghost btn-sm lg:hidden" onClick={onMenu} aria-label="منو">
          ☰
        </button>

        <div className="flex-1" />

        <NotificationBell />

        <button type="button" onClick={toggle} className="btn-ghost btn-sm" aria-label="تغییر پوسته">
          {resolved === 'dark' ? '☾' : '☀'}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border px-2.5 py-1.5 text-xs hover:bg-surface-2"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-[11px] font-medium">
              {session.user?.name.slice(0, 1) ?? '؟'}
            </span>
            <span className="hidden text-start sm:block">
              <span className="block max-w-[10rem] truncate font-medium">{session.user?.name}</span>
              <span className="block text-[10px] text-subtle">
                {session.user ? ROLE_LABELS[session.user.role].fa : ''}
              </span>
            </span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} role="presentation" />
              <div className="absolute end-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-pop animate-fade-in">
                <Link href="/account" className="block px-4 py-2.5 text-sm hover:bg-surface-2">
                  حساب کاربری
                </Link>
                <button
                  type="button"
                  onClick={() => void session.logout()}
                  className="block w-full px-4 py-2.5 text-start text-sm text-danger hover:bg-surface-2"
                >
                  خروج
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
  leadId: string | null;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: NotificationItem[]; unreadCount: number }>('/api/notifications', { limit: 15 });
      setItems(data.items);
      setUnread(data.unreadCount);
    } catch {
      // A notification fetch failure must not disrupt the page.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost btn-sm relative"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        aria-label="اعلان‌ها"
      >
        ⌾
        {unread > 0 && (
          <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-hot px-1 text-[10px] font-medium text-white">
            {unread > 9 ? '۹+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} role="presentation" />
          <div className="absolute end-0 z-20 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-border bg-surface shadow-pop animate-fade-in">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-xs font-semibold">اعلان‌ها</span>
              {unread > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-accent hover:underline"
                  onClick={async () => {
                    await api.post('/api/notifications/read-all').catch(() => undefined);
                    void load();
                  }}
                >
                  خواندن همه
                </button>
              )}
            </div>

            {loading && items.length === 0 && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}

            {!loading && items.length === 0 && <p className="px-4 py-8 text-center text-xs text-subtle">اعلانی وجود ندارد</p>}

            <ul>
              {items.map((item) => (
                <li key={item.id} className={`border-b border-border last:border-0 ${item.readAt ? '' : 'bg-accent/5'}`}>
                  <Link
                    href={item.leadId ? `/leads/${item.leadId}` : '/'}
                    className="block px-4 py-3 hover:bg-surface-2"
                    onClick={() => void api.post(`/api/notifications/${item.id}/read`).catch(() => undefined)}
                  >
                    <p className="text-xs font-medium">{item.title}</p>
                    {item.body && <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-subtle">{item.body}</p>}
                    <p className="mt-1 text-[10px] text-subtle">{faRelative(item.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-xs leading-6 text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
