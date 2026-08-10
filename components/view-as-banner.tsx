"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";

import { useTRPC } from "@/trpc/client";

/**
 * The bar that says you are not looking at your own account.
 *
 * **Its whole job is to be impossible to overlook**, which is why it is a full-width strip in a
 * warning colour above every screen rather than a marker in the corner. A preview that looks like
 * the real thing is a way to grade the wrong person, and the failure it guards against is not
 * subtle: an admin who forgets they are in a test student's view and reads an empty course page as
 * a broken deployment, or who goes looking for their own cohort and finds a stranger's sidebar.
 *
 * Renders nothing the rest of the time, which is nearly always. It costs one query on every screen
 * to say nothing, and that is the right trade for a state this consequential being invisible.
 *
 * **Leaving is a form**, posting to a route handler, for the reason set out in
 * `app/api/view-as/exit/route.ts`: while the cookie is set the caller reads as a student, so an
 * admin-guarded mutation would refuse the one person entitled to press it. A form also means the
 * way out works with no JavaScript, which matters more here than anywhere else in the application —
 * this is the control somebody reaches for when something has gone wrong.
 *
 * It carries no destination. Leaving lands on the roster the admin switched in from, recorded when
 * they did — this banner is on every screen and most of them have no course to name, so the one
 * place that knew is the roster button, not here.
 */
export function ViewAsBanner() {
  const trpc = useTRPC();
  const { data: viewingAs } = useSuspenseQuery(trpc.viewingAs.queryOptions());

  if (!viewingAs) return null;

  const name = viewingAs.testStudent.displayName ?? `Test Student ${viewingAs.testStudent.number}`;

  return (
    <div className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/50 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <Eye className="size-4 shrink-0" />
      <span className="min-w-0">
        You are looking at this as <span className="font-semibold">{name}</span>. Anything you
        accept or submit is recorded as theirs.
      </span>
      {/*
        A plain form and a plain button rather than the `Button` component, so nothing about
        returning to your own account depends on client JavaScript having loaded. Styled to match
        an outline button in this colour.
      */}
      <form method="post" action="/api/view-as/exit" className="ms-auto">
        <button
          type="submit"
          className="rounded-md border border-amber-600/50 px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors hover:bg-amber-200 dark:border-amber-400/40 dark:hover:bg-amber-900"
        >
          Exit student view
        </button>
      </form>
    </div>
  );
}
