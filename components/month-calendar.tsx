"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  addMonths,
  formatMonth,
  monthGrid,
  monthOf,
  monthRange,
  WEEKDAY_INITIALS,
  type CalendarCell,
  type SchoolMonth,
} from "@/lib/attendance/calendar";
import type { SchoolDay } from "@/lib/school-time";
import { cn } from "@/lib/utils";

/**
 * A month of days, paged with two arrows, with a key beside it.
 *
 * **One calendar, drawn on two screens.** The program's days on the attendance schedule and a
 * fellow's own mornings on their record are the same grid asked two different questions — did the
 * program meet, and was this fellow there — and an instructor reads one against the other. Two
 * grids of slightly different sizes with two legends in two styles made the same Tuesday look like
 * two different Tuesdays. This owns everything the two have in common: the month heading and its
 * arrows, the bordered grid, the weekday row, the size and shape of a square, the ring on today,
 * and the key. What a square *means* is the caller's, which is why the squares are rendered by a
 * function it passes in.
 *
 * **Opens on the month today is in.** A reader opening this in November is asking about
 * November. Opening on the last month with anything in it, which the fellow's calendar once did,
 * opened on the final month of the schedule the moment a program had one — June, in September.
 * When today falls outside the months there are to show, which is a program whose first day has
 * not come, it opens on the nearest month that exists so the arrows always have somewhere to go.
 */

/** One row of the key. The swatch is the square's own classes, so the key cannot drift from the grid. */
export type CalendarKey = {
  swatch: string;
  /** Something drawn inside the swatch, such as the wedge on a late square. */
  mark?: React.ReactNode;
  term: string;
  detail?: string;
};

export function MonthCalendar({
  days,
  today,
  legend,
  children,
}: {
  /** Every day with a session, in any order. Decides which months the arrows can reach. */
  days: SchoolDay[];
  /** Passed in rather than read here, so the server and the browser agree on which square is today. */
  today: SchoolDay;
  legend: CalendarKey[];
  /** Draws one square. The shell keys it; see `squareClass` for the shape every square shares. */
  children: (cell: CalendarCell) => React.ReactNode;
}) {
  const months = React.useMemo(() => monthRange(days, today), [days, today]);
  const [month, setMonth] = React.useState<SchoolMonth>(() => {
    const first = months[0];
    const last = months[months.length - 1];
    const current = monthOf(today);
    if (first === undefined) return current;
    return current < first ? first : current > last ? last : current;
  });

  if (months.length === 0) return null;

  const first = months[0];
  const last = months[months.length - 1];
  const weeks = monthGrid(month);

  return (
    /*
      The calendar is deliberately small and the key sits beside it rather than beneath. A term is
      a glance, not a document — at full page width the squares were the size of buttons and
      implied they could be pressed, and a key below pushed the whole thing past a phone screen.
      Side by side, the pair is one block a reader takes in at once.
    */
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex w-full max-w-[21rem] shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{formatMonth(month)}</p>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="size-6"
              disabled={month <= first}
              aria-label="The month before"
              onClick={() => setMonth((current) => addMonths(current, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-6"
              disabled={month >= last}
              aria-label="The month after"
              onClick={() => setMonth((current) => addMonths(current, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-2">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="pb-0.5 text-center text-[0.65rem] font-medium text-muted-foreground"
              >
                {initial}
              </div>
            ))}

            {weeks.flat().map((cell) => (
              <React.Fragment key={cell.day}>{children(cell)}</React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <dl className="flex flex-col gap-2 text-xs">
        {legend.map((entry) => (
          <div key={entry.term} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("relative size-4 shrink-0 overflow-hidden rounded", entry.swatch)}
            >
              {entry.mark}
            </span>
            <dt className="font-medium">{entry.term}</dt>
            {entry.detail && <dd className="text-muted-foreground">{entry.detail}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The shape every square shares: its size, its corner radius, the fade on a day outside the month,
 * and the ring on today. The caller adds the colour that says what the day means.
 *
 * The ring is inset so it cannot be clipped by the square beside it at this size.
 */
export function squareClass(cell: CalendarCell, today: SchoolDay): string {
  return cn(
    "flex aspect-square items-center justify-center rounded text-xs leading-none tabular-nums",
    !cell.inMonth && "opacity-35",
    cell.day === today && "ring-2 ring-ring ring-inset",
  );
}
