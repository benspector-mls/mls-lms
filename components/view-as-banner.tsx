"use client";

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { useTRPC } from "@/trpc/client";

/**
 * The bar that says you are not looking at your own account.
 *
 * **Its whole job is to be impossible to overlook**, which is why it is a full-width strip in a
 * warning colour above every screen rather than a marker in the corner. A preview that looks like
 * the real thing is a way to grade the wrong person, and the failure it guards against is not
 * subtle: an admin who forgets they are in a test student's view and reads an empty course page as
 * a broken deployment, or an instructor who goes looking for their own cohort and finds a fellow's
 * sidebar.
 *
 * **It says which kind of view this is.** Most views are read-only, and a control that refuses when
 * pressed is only unsurprising if the bar above it said so first. The one writable view, an admin
 * looking through a test student, says the opposite, because there everything pressed is recorded.
 *
 * Renders nothing the rest of the time, which is nearly always. It costs one query on every screen
 * to say nothing, and that is the right trade for a state this consequential being invisible.
 *
 * **Leaving is a form**, posting to a route handler, for the reason set out in
 * `app/api/view-as/exit/route.ts`: while the cookie is set the caller reads as a student, so an
 * instructor-guarded mutation would refuse the one person entitled to press it. A form also means the
 * way out works with no JavaScript, which matters more here than anywhere else in the application —
 * this is the control somebody reaches for when something has gone wrong.
 *
 * **It carries the address it was pressed on**, and leaving returns there when that is an
 * instructor screen. That is the case of somebody who pressed Back out of a view, met an instructor
 * screen refusing them, and exited: what they want is that screen, loaded as themselves. From a
 * fellow's screen, leaving lands on the roster they switched in from instead, because the fellow's
 * dashboard seen as an instructor is nothing they asked for.
 *
 * **It asks again when the browser restores a page from its history.** Pressing Back out of a view
 * can bring back the page exactly as it was before the view began — including this query's answer
 * from then, which was that there was no view. Asking again is what makes the banner appear on that
 * page, above whatever it now fails to load.
 */
export function ViewAsBanner() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: viewingAs } = useSuspenseQuery(trpc.viewingAs.queryOptions());
  const pathname = usePathname();
  const search = useSearchParams().toString();

  React.useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void queryClient.invalidateQueries({ queryKey: trpc.viewingAs.queryKey() });
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [queryClient, trpc]);

  /*
    Its height, published on the root as `--view-as-banner` for anything else that sticks below the
    header: the outline on a settings page sticks under this bar rather than behind it. Measured
    rather than declared, because the sentence wraps onto a second line on a narrow screen. Removed
    when the bar goes, so the variable falls back to nothing.
  */
  const bannerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const bar = bannerRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--view-as-banner", `${bar.offsetHeight}px`);
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--view-as-banner");
    };
  }, [viewingAs]);

  if (!viewingAs) return null;

  const name = viewingAs.student.name;

  return (
    <div
      ref={bannerRef}
      className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/50 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <Eye className="size-4 shrink-0" />
      {viewingAs.readOnly ? (
        <span className="min-w-0">
          You are viewing this as <span className="font-semibold">{name}</span>, read-only. Nothing
          can be changed on their behalf.
        </span>
      ) : (
        <span className="min-w-0">
          You are looking at this as <span className="font-semibold">{name}</span>. Anything you
          accept or submit is recorded as theirs.
        </span>
      )}
      {/*
        A plain form and a plain button rather than the `Button` component, so nothing about
        returning to your own account depends on client JavaScript having loaded. Styled to match
        an outline button in this colour.
      */}
      <form method="post" action="/api/view-as/exit" className="ms-auto">
        <input type="hidden" name="next" value={search ? `${pathname}?${search}` : pathname} />
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
