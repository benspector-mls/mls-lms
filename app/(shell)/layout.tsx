import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { SessionBoundary } from '@/components/session-boundary';

/**
 * Every signed-in screen. The boundary sits outside the shell so a session that expires
 * mid-visit sends the viewer to sign in, rather than showing them the shell wrapped
 * around an error.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <SessionBoundary>
      <AppShell>{children}</AppShell>
    </SessionBoundary>
  );
}
