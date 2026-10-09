"use client";

import * as React from "react";

import { MonthCalendar, squareClass, type CalendarKey } from "@/components/month-calendar";
import { CELL, isMarked, kindOf, LATE_WEDGE_CLASS } from "@/lib/attendance/cells";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import { formatSchoolDay, type SchoolDay } from "@/lib/school-time";
import { cn } from "@/lib/utils";

/**
 * A fellow's own attendance, a month at a time.
 *
 * **The same calendar as the program's days on the attendance schedule**, drawn by `MonthCalendar`,
 * so a fellow's record and the schedule an instructor reads it against are one grid at one size
 * with one style of key. Only the squares differ: there, a square says whether the program met;
 * here, it says whether this fellow was there.
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
  /**
   * Check-in is still open, so a fellow with no status yet can still get one.
   *
   * It does not override a status that is already there — see `kindOf`. A fellow marked present
   * this morning is drawn present, whether or not the day is still accepting codes.
   */
  open: boolean;
  /**
   * A day the program will meet that has not come.
   *
   * Drawn hollow rather than blank, because a schedule's whole value to a fellow is being able to
   * see that next Tuesday is a class day. It is not an absence and not an open check-in, and
   * `kindOf` ranks it behind a status so an excusal set ahead of time still shows.
   */
  upcoming: boolean;
  /**
   * Where the mark came from, already in words: "checked in at 9:02", "marked by Ben Spector".
   *
   * Composed by the caller rather than here, because turning a source and a timestamp into a
   * sentence needs the school's timezone and this is a client component. Null when nothing has been
   * recorded, when there is nothing yet to have come from anywhere.
   */
  detail: string | null;
  /** Why, in an instructor's words or the fellow's own. Rare, and the reason the tooltip exists. */
  note: string | null;
};

/*
  Each swatch is the square's own classes from `CELL`, so the key cannot come to disagree with the
  grid. Scheduled is in the key because a dashed square is otherwise the one shape nobody can guess.
*/
const LEGEND: CalendarKey[] = [
  { swatch: CELL.PRESENT.className, term: "Present" },
  {
    swatch: CELL.LATE.className,
    mark: <span className={LATE_WEDGE_CLASS} />,
    term: "Late",
    detail: "here, after the on-time window",
  },
  { swatch: CELL.EXCUSED.className, term: "Excused", detail: "still a session you missed" },
  { swatch: CELL.ABSENT.className, term: "Absent" },
  { swatch: CELL.unrecorded.className, term: "Not recorded", detail: "a session with no mark" },
  { swatch: CELL.upcoming.className, term: "Scheduled", detail: "class meets this day" },
  {
    swatch: "border border-border",
    term: "No session",
    detail: "the cohort did not meet, or you had not joined",
  },
];

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
  const sessionDays = React.useMemo(() => days.map((entry) => entry.day), [days]);

  return (
    <MonthCalendar days={sessionDays} today={today} legend={LEGEND}>
      {(cell) => {
        const entry = byDay.get(cell.day);
        const kind = kindOf(entry, cell.day, enrolledFrom);
        const meta = CELL[kind];
        const marked = isMarked(kind);

        return (
          <div
            title={marked ? describe(cell.day, meta.label, entry) : undefined}
            className={cn("relative", squareClass(cell, today), meta.className)}
          >
            <span className={cn(marked && "font-semibold")}>{Number(cell.day.slice(8))}</span>
            {/* Late is green, because it counts as attended; the wedge is what says it was
                not on time. See `LATE_WEDGE_CLASS`. */}
            {kind === "LATE" && <span aria-hidden="true" className={LATE_WEDGE_CLASS} />}
            {/*
              The letter left the square when the square got smaller — two glyphs at this size
              are unreadable, and the date is the one a reader is scanning for. It stays in the
              title and here, so the record is still legible to a screen reader and to anybody
              who cannot use the colour.
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
      }}
    </MonthCalendar>
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
