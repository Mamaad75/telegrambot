'use client';

import { AppShell } from '@/components/app-shell';

/** Every route in this group requires a session and renders inside the dashboard shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
