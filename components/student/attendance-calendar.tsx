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
  type SchoolMonth,
} from "@/lib/attendance/calendar";
import { CELL, isMarked, kindOf, LATE_WEDGE_CLASS } from "@/lib/attendance/cells";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import { formatSchoolDay, type SchoolDay } from "@/lib/school-time";
import { cn } from "@/lib/utils";

/**
 * A fellow's own attendance, a month at a time.
 *
 * **The list this replaces was collapsed, and a record nobody opens is a record nobody checks.**
 * A term is sixty rows of mostly "present", which is why it was folded away — and folding it away
 * meant the one thing it is for, noticing a pattern in your own attendance before somebody else
 * does, never happened. A month of coloured squares says the same thing at a glance.
 *
 * **Colour is never the only signal.** Every square has a `title` naming the day and what was
 * recorded, and the same sentence again for a screen reader. A calendar that separated present
 * from absent by hue alone would be unreadable to roughly one fellow in twelve. The squares are
 * too small to also carry a letter — at this size two glyphs are worse than one — so the date
 * stays visible and the status is in the title.
 *
 * **Late is green with a mark rather than a colour of its own.** Green means the session counts as
 * attended, and late does count — an amber square would put it beside excused, which does not.
 * The mark is what says it was not on time.
 *
 * **The tooltip carries what a list of missed days used to.** That list sat directly above this
 * and said in rows what the red and amber squares already say in colour; what it had that they did
 * not was the note and who recorded the mark, so those moved into the square. A day carrying a
 * note gets a dot in the corner, because a tooltip nobody knows to hover is a tooltip nobody
 * reads.
 */

/** What one day of the month shows. */
export type CalendarDay = {
  day: SchoolDay;
  /** Null when a session ran and nothing was recorded for this fellow. */
  status: AttendanceStatus | null;
  /** Check-in is still open, so nothing about it is settled. */
  open: boolean;
  /**
   * Where the mark came from, already in words: "checked in at 9:02", "marked by Ben Spector".
   *
   * Composed by the caller rather than here, because turning a source and a timestamp into a
   * sentence needs the school's timezone and this is a client component. Null while a session is
   * still open, when there is nothing yet to have come from anywhere.
   */
  detail: string | null;
  /** Why, in an instructor's words or the fellow's own. Rare, and the reason the tooltip exists. */
  note: string | null;
};

export function AttendanceCalendar({
  days,
  enrolledFrom,
  today,
}: {
  days: CalendarDay[];
  enrolledFrom: SchoolDay;
  /** Passed in rather than read here, so the server and the browser agree on which square is today. */
  today: SchoolDay;
}) {
  const byDay = React.useMemo(() => new Map(days.map((entry) => [entry.day, entry])), [days]);
  const months = React.useMemo(
    () =>
      monthRange(
        days.map((entry) => entry.day),
        today,
      ),
    [days, today],
  );

  /*
    Opens on the most recent month that has anything in it rather than on today, because a cohort
    between terms would otherwise open on an empty grid and look broken. `months` already runs
    through today, so paging forward from there still reaches the current month.
  */
  const opensOn = months.at(-1) ?? monthOf(today);
  const [month, setMonth] = React.useState<SchoolMonth>(opensOn);

  if (months.length === 0) return null;

  const first = months[0];
  const last = months[months.length - 1];
  const weeks = monthGrid(month);

  return (
    /*
      The calendar is deliberately small and the legend sits beside it rather than beneath. Twelve
      months of a fellow's own attendance is a glance, not a document — at full page width the
      squares were the size of buttons and implied they could be pressed, and the legend below
      pushed the whole thing past a phone screen. Side by side, the pair is one block a reader
      takes in at once, and the space the legend was costing vertically it now uses horizontally.
    */
    <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex w-full max-w-[19rem] shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{formatMonth(month)}</h2>
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
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="pb-0.5 text-center text-[0.65rem] font-medium text-muted-foreground"
              >
                {initial}
              </div>
            ))}

            {weeks.flat().map((cell) => {
              const entry = byDay.get(cell.day);
              const kind = kindOf(entry, cell.day, enrolledFrom);
              const meta = CELL[kind];
              const marked = isMarked(kind);

              return (
                <div
                  key={cell.day}
                  title={marked ? describe(cell.day, meta.label, entry) : undefined}
                  className={cn(
                    "relative flex aspect-square items-center justify-center rounded text-[0.65rem] leading-none",
                    !cell.inMonth && "opacity-35",
                    meta.className,
                    // Inset, so the ring cannot be clipped by the square beside it at this size.
                    cell.day === today && "ring-2 ring-ring ring-inset",
                  )}
                >
                  <span className={cn(marked && "font-semibold")}>{Number(cell.day.slice(8))}</span>
                  {/* Late is green, because it counts as attended; the wedge is what says it was
                      not on time. See `LATE_WEDGE_CLASS`. */}
                  {kind === "LATE" && <span aria-hidden="true" className={LATE_WEDGE_CLASS} />}
                  {/*
                    The letter left the square when the square got smaller — two glyphs in 34
                    pixels is unreadable, and the date is the one a reader is scanning for. It
                    stays in the title and here, so the record is still legible to a screen reader
                    and to anybody who cannot use the colour.
                  */}
                  {/*
                    A day with something written about it says so, so the tooltip is discoverable.
                    Bottom-left, clear of the late wedge in the opposite corner.
                  */}
                  {marked && entry?.note && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0.5 left-0.5 size-1 rounded-full bg-current opacity-70"
                    />
                  )}
                  <span className="sr-only">
                    {marked ? describe(cell.day, meta.label, entry) : formatSchoolDay(cell.day)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:max-w-64">
        <Key className="bg-emerald-500/85" label="Present" />
        <Key className="bg-emerald-500/85" label="Late — here, after the on-time window" wedge />
        <Key className="bg-amber-400/90" label="Excused — still a session you missed" />
        <Key className="bg-destructive/85" label="Absent" />
        <Key className="bg-muted-foreground/30" label="A session where nothing was recorded" />
        <li className="pt-1 text-muted-foreground/80">
          A blank square is a day the cohort did not meet.
        </li>
      </ul>
    </section>
  );
}

/**
 * One square, in a sentence.
 *
 * The same string for the tooltip and for a screen reader, so the two cannot come to say different
 * things — and it is the whole of what the list this replaced carried.
 */
function describe(day: SchoolDay, label: string, entry: CalendarDay | undefined): string {
  return [formatSchoolDay(day), label, entry?.detail, entry?.note && `"${entry.note}"`]
    .filter(Boolean)
    .join(" · ");
}

function Key({ className, label, wedge }: { className: string; label: string; wedge?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn("relative mt-0.5 size-3 shrink-0 rounded-sm", className)}>
        {wedge && (
          <span className="absolute top-0 right-0 size-0 border-t-[0.4rem] border-l-[0.4rem] border-t-amber-300 border-l-transparent" />
        )}
      </span>
      {label}
    </li>
  );
}
