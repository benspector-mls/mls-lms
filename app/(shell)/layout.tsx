import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionBoundary } from "@/components/session-boundary";

/**
 * Every signed-in screen. The boundary sits outside the shell so a session that expires
 * mid-visit sends the viewer to sign in, rather than showing them the shell wrapped
 * around an error.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <SessionBoundary>
      {/*
        One provider for the whole signed-in application, so tooltips share a delay: moving
        along a row of flag badges shows each in turn without waiting again for every one. Short
        rather than zero, so a pointer crossing a badge on its way somewhere else does not
        flash an explanation nobody asked for.
      */}
      <TooltipProvider delay={200}>
        <AppShell>{children}</AppShell>
      </TooltipProvider>
    </SessionBoundary>
  );
}
