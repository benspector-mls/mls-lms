"use client";

import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { TestStudentBadge } from "@/components/test-student-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  stickyColumn,
  stickyColumnContent,
  stickyHeader,
  stickyHeaderContainer,
} from "@/components/ui/table";
import { arrivalSentence, type ArrivalAverages } from "@/lib/attendance/arrival";
import {
  DEFAULT_TERM_SORT,
  dailyRates,
  recentSessionsFrom,
  sortSummaries,
  termAverages,
  termRate,
  toggleTermSort,
  type FellowSummary,
  type SummarySession,
  type TermSort,
  type TermSortColumn,
} from "@/lib/attendance/summary";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import { attendanceDayHref, programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatClockMinutes, formatSchoolDay, formatSchoolDayShort } from "@/lib/school-time";
import { formatPercent } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Every fellow against every session: the attendance record for the whole term.
 *
 * **It opens on the last two weeks.** A term is sixty columns, and the ones a reader wants are
 * the most recent, which a grid that drew the whole term put off the right edge of the screen
 * behind fifty-eight that are not. So it draws the latest session's week and the week before it —
 * `recentSessionsFrom` says exactly which — and the column before the first date holds a double
 * arrow that brings the earlier dates in. The same arrow, turned around, puts them away again.
 * The summary columns count the whole term whichever is showing, because a rate over two weeks
 * would be a different figure under the same heading.
 *
 * **Rows open in first-name order**, as `history` returns them, so a name is found by reading down
 * the frozen column rather than by scanning it. Each summary column sorts the rows when its heading
 * is pressed — the lowest rate or the latest arrival first, because those are the fellows the grid
 * is read to find — and the rule for which way a column opens is `toggleTermSort`. The rate at the
 * head of the Rate column is the whole roster's, so a fellow's figure has one number to be read
 * against rather than twenty-five; it is `termRate`, and the note there says why it is not a mean
 * of the column.
 *
 * The grid copies `gradebook.tsx`: an `overflow-x-auto` wrapper, a sticky name column, summary
 * columns before the day columns. One thing it does not copy is pinning a second column — see the
 * note there about why the summary columns scroll.
 *
 * A client component for the two pieces of state it holds, the arrow's and the sort's; every cell
 * is still static and every link is a link.
 */

const LETTER: Record<AttendanceStatus, string> = {
  PRESENT: "P",
  LATE: "L",
  ABSENT: "A",
  EXCUSED: "E",
};

export const LETTER_CLASS: Record<AttendanceStatus, string> = {
  PRESENT: "text-emerald-700 dark:text-emerald-300",
  LATE: "text-amber-700 dark:text-amber-300",
  ABSENT: "text-destructive",
  EXCUSED: "text-muted-foreground",
};

export function AttendanceGrid({
  programId,
  sessions,
  fellows,
  arrivals,
}: {
  programId: string;
  /** In date order, as `history` returns them. */
  sessions: SummarySession[];
  fellows: FellowSummary[];
  /** One fellow's arrival averages, by enrollment id. See `lib/attendance/arrival.ts`. */
  arrivals: Record<string, ArrivalAverages>;
}) {
  // One figure per column, from the same summaries the letters below come from. See `dailyRates`.
  const rates = dailyRates(sessions, fellows);
  const roster = termRate(fellows);
  const averages = termAverages(
    fellows,
    (summary) => arrivals[summary.fellow.enrollmentId]?.overall.minutes ?? null,
  );
  const recent = recentSessionsFrom(sessions);
  const [showingEarlier, setShowingEarlier] = React.useState(false);
  const [sort, setSort] = React.useState<TermSort>(DEFAULT_TERM_SORT);

  // Sorted on the strings and minutes the cells print, so the order can be checked by reading down
  // the column. See `sortSummaries`.
  const rows = React.useMemo(
    () =>
      sortSummaries(fellows, sort, {
        nameOf: (summary) => displayNameOf(summary.fellow, "Unnamed"),
        arrivalOf: (summary) => arrivals[summary.fellow.enrollmentId]?.overall.minutes ?? null,
      }),
    [fellows, sort, arrivals],
  );

  /*
    The first column drawn. Everything is sliced from the same index — the sessions, each fellow's
    cells, and the rates — because all three are in session order and a slice taken at two
    different points would put a Tuesday's letters under a Wednesday's date.
  */
  const from = showingEarlier ? 0 : recent;
  const shown = sessions.slice(from);
  const hasEarlier = recent > 0;
  const earlierLabel = showingEarlier
    ? "Show only the last two weeks"
    : `View more — the ${recent} earlier ${recent === 1 ? "session" : "sessions"}`;

  /*
    The border's `overflow-hidden` is not a scroller: the container inside `Table` scrolls both
    axes, and this div's overflow only clips the opaque frozen cells to the rounded corner. The
    same arrangement `gradebook-grid.tsx` uses, and the note there explains it at length.
  */
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table containerClassName={stickyHeaderContainer}>
        <TableHeader className={stickyHeader}>
          <TableRow>
            {/*
              Only the name column is pinned. Pinning the summary columns too would leave a phone
              with nothing but frozen columns and no grid — the same note `gradebook.tsx` makes.
            */}
            <SortableHead
              className={stickyColumn}
              label="Fellow"
              by="name"
              sort={sort}
              onSort={setSort}
            />
            <SortableHead
              className="text-right"
              label="Rate"
              by="rate"
              sort={sort}
              onSort={setSort}
            />
            <SortableHead
              className="text-right"
              label="Arrives"
              by="arrives"
              sort={sort}
              onSort={setSort}
            />
            <SortableHead
              className="text-right"
              label="P"
              by="present"
              sort={sort}
              onSort={setSort}
            />
            <SortableHead className="text-right" label="L" by="late" sort={sort} onSort={setSort} />
            <SortableHead
              className="text-right"
              label="E"
              by="excused"
              sort={sort}
              onSort={setSort}
            />
            <SortableHead
              className="text-right"
              label="A"
              by="absent"
              sort={sort}
              onSort={setSort}
            />
            {/*
              Between the term's figures and the first date, which is where the dates it brings in
              will appear. Absent entirely when there is nothing earlier, rather than disabled: a
              control that can never do anything is a question the reader has to answer for
              themselves.
            */}
            {hasEarlier && (
              <TableHead className="w-8 px-0 text-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={earlierLabel}
                  aria-expanded={showingEarlier}
                  title={earlierLabel}
                  onClick={() => setShowingEarlier((current) => !current)}
                >
                  {showingEarlier ? <ChevronsRight /> : <ChevronsLeft />}
                </Button>
              </TableHead>
            )}
            {shown.map((session) => (
              <TableHead key={session.id} className="text-center whitespace-nowrap">
                <Link
                  href={attendanceDayHref(programId, session.day)}
                  className="hover:underline"
                  title={formatSchoolDay(session.day)}
                >
                  {formatSchoolDayShort(session.day)}
                </Link>
              </TableHead>
            ))}
          </TableRow>
          {/*
            How much of the roster turned up each day, directly under the date and above the
            fellows.

            **In the header group, so it stays put with the dates.** Reading down a column of
            letters is reading one morning, and the figure that says how that morning went as a
            whole is the thing to keep in view while doing it — a rate that scrolled away with the
            rows was gone by the time the reader reached the fellow they were looking for. The
            cells stay `<th>`s, so each one says what its column is about rather than naming a
            fellow, and the row takes no hover.
          */}
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(stickyColumn, "text-xs font-normal text-muted-foreground")}>
              Average
            </TableHead>
            {/*
              The whole roster's rate over the whole term, at the head of the column of each
              fellow's. The hover gives the two counts it divides, so a reader can see how much
              of a term the figure stands on.
            */}
            <TableHead
              className="text-right text-xs font-medium tabular-nums text-muted-foreground"
              title={
                roster.rate === null
                  ? undefined
                  : `Whole roster: ${roster.attended} of ${roster.eligible} eligible sessions attended.`
              }
            >
              {roster.rate === null ? "—" : formatPercent(roster.rate)}
            </TableHead>
            {/*
              What each of the other columns averages to, so a fellow's figure is read against
              the roster's rather than against twenty-four others. Each is the plain mean of what
              the column prints; `termAverages` says who is counted.
            */}
            <TableHead
              className="text-right text-xs font-medium tabular-nums whitespace-nowrap text-muted-foreground"
              title={
                averages.arrival.minutes === null
                  ? undefined
                  : `Mean of ${averages.arrival.fellows} fellows' average arrival times.`
              }
            >
              {averages.arrival.minutes === null
                ? "—"
                : formatClockMinutes(averages.arrival.minutes)}
            </TableHead>
            <AverageHead value={averages.present} fellows={averages.fellows} />
            <AverageHead value={averages.late} fellows={averages.fellows} />
            <AverageHead value={averages.excused} fellows={averages.fellows} />
            <AverageHead value={averages.absent} fellows={averages.fellows} />
            {hasEarlier && <TableHead />}
            {rates.slice(from).map((rate, index) => (
              <TableHead
                key={shown[index].id}
                className="text-center text-xs font-medium tabular-nums text-muted-foreground"
              >
                {/*
                  A dash where a fellow's own rate would show one: a day still running or still to
                  come has settled nothing, and a figure over a moving denominator is worse than
                  no figure.
                */}
                {rate === null ? "—" : formatPercent(rate)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((summary) => (
            <TableRow key={summary.fellow.enrollmentId}>
              <TableCell className={stickyColumn}>
                <div className={stickyColumnContent}>
                  {summary.fellow.testStudentNumber !== null && <TestStudentBadge />}
                  <Link
                    href={programStudentHref(programId, summary.fellow.studentId)}
                    className="font-medium hover:underline"
                  >
                    {displayNameOf(summary.fellow, "Unnamed")}
                  </Link>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {/*
                  A test student has a dash rather than a figure. They are excluded from every
                  count on this screen, and a percentage beside a badge saying "not real" would
                  invite somebody to read it as one of the roster's numbers.
                */}
                {summary.fellow.testStudentNumber !== null || summary.rate === null
                  ? "—"
                  : formatPercent(summary.rate)}
              </TableCell>
              <ArrivesCell averages={arrivals[summary.fellow.enrollmentId]} />
              <TableCell className="text-right tabular-nums">{summary.present}</TableCell>
              <TableCell className="text-right tabular-nums">{summary.late}</TableCell>
              <TableCell className="text-right tabular-nums">{summary.excused}</TableCell>
              <TableCell className="text-right tabular-nums">
                {summary.absent + summary.unrecorded}
              </TableCell>
              {hasEarlier && <TableCell />}
              {summary.cells.slice(from).map((status, index) => (
                <TableCell key={shown[index].id} className="text-center">
                  {status === null ? (
                    <span className="text-muted-foreground">·</span>
                  ) : (
                    <span className={cn("font-medium", LETTER_CLASS[status])}>
                      {LETTER[status]}
                    </span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * When this fellow usually checks in, as one clock time, with the weekday sentence on hover.
 *
 * A dash until there are enough check-ins for an average — `MIN_ARRIVALS` of them — for the reason
 * `arrival.ts` gives: a mean over one morning is a number somebody would quote. The sentence in the
 * title is `arrivalSentence`, the same words the fellow's record prints, so the two cannot differ.
 */
function ArrivesCell({ averages }: { averages: ArrivalAverages | undefined }) {
  const minutes = averages?.overall.minutes ?? null;
  const sentence = averages ? arrivalSentence(averages) : null;

  return (
    <TableCell className="text-right tabular-nums whitespace-nowrap" title={sentence ?? undefined}>
      {minutes === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        formatClockMinutes(minutes)
      )}
    </TableCell>
  );
}

/**
 * The mean of one count column, per fellow, to one decimal place.
 *
 * One decimal because the mean of whole numbers is rarely one, and a figure rounded to "4" above a
 * column of 3s and 5s would read as a count rather than an average. A dash until somebody is
 * counted.
 */
function AverageHead({ value, fellows }: { value: number | null; fellows: number }) {
  return (
    <TableHead
      className="text-right text-xs font-medium tabular-nums text-muted-foreground"
      title={value === null ? undefined : `Per fellow, over ${fellows} counted.`}
    >
      {value === null ? "—" : value.toFixed(1)}
    </TableHead>
  );
}

/** A header that sorts the rows, with the arrow showing which way when it is the active one. */
function SortableHead({
  label,
  by,
  sort,
  onSort,
  className,
}: {
  label: string;
  by: TermSortColumn;
  sort: TermSort;
  onSort: (sort: TermSort) => void;
  className?: string;
}) {
  const active = sort.by === by;

  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(toggleTermSort(sort, by))}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {!active ? (
          <ChevronsUpDown className="size-3 shrink-0" aria-hidden />
        ) : sort.direction === "asc" ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}
