"use client";

import { CalendarRange } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDefaultRecentWindow, WINDOW_PARAMS, type RecentWindow } from "@/lib/recent-window";
import type { SchoolDay } from "@/lib/school-time";

/**
 * The days the Performance tab's recent columns are read over.
 *
 * **It changes what is counted.** Recent Absence, Recent Tardiness, Recent Deadlines Hit and
 * Recently Completed all count the mornings and deadlines that fell inside these days, so an
 * instructor can ask how the roster did over a particular fortnight, or since the last cohort
 * meeting. The term figures and the groups' other cells do not move.
 *
 * **Two plain date fields rather than a menu of presets.** The default is the two weeks ending
 * today, and the one button puts it back; anything else is a range the instructor types. The end
 * cannot be after today, because a deadline that has not passed cannot have been missed, and the
 * server clamps it there whatever the address says — see `parseRecentWindow`.
 *
 * **The choice lives in the query string**, as the course filter's does, so a chosen range can be
 * linked and survives a reload. The default is written as no parameter at all, so the plain address
 * keeps meaning "the last two weeks" as the days go by.
 */
export function WindowFilter({ window, today }: { window: RecentWindow; today: SchoolDay }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDefault = isDefaultRecentWindow(window, today);

  function choose(next: Partial<RecentWindow>) {
    const params = new URLSearchParams(searchParams.toString());
    const from = next.from ?? window.from;
    const to = next.to ?? window.to;
    params.set(WINDOW_PARAMS.from, from);
    params.set(WINDOW_PARAMS.to, to);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(WINDOW_PARAMS.from);
    params.delete(WINDOW_PARAMS.to);
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <CalendarRange aria-hidden className="size-3.5" />
      <span>Recent is</span>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Recent window starts on</span>
        <Input
          type="date"
          value={window.from}
          max={window.to}
          onChange={(event) => event.target.value && choose({ from: event.target.value })}
          className="h-8 w-[9.5rem]"
        />
      </label>
      <span>to</span>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Recent window ends on</span>
        <Input
          type="date"
          value={window.to}
          min={window.from}
          max={today}
          onChange={(event) => event.target.value && choose({ to: event.target.value })}
          className="h-8 w-[9.5rem]"
        />
      </label>
      {!isDefault && (
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={reset}>
          Last two weeks
        </Button>
      )}
    </div>
  );
}
