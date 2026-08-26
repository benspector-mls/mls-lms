"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { CheckInForm } from "@/components/student/check-in-form";
import { Badge } from "@/components/ui/badge";
import { CELL, isMarked, kindOf, LATE_WEDGE_CLASS } from "@/lib/attendance/cells";
import { weekdayInitial } from "@/lib/attendance/calendar";
import { myAttendanceHref } from "@/lib/links";
import { formatPercent } from "@/lib/status";
import { formatSchoolDay } from "@/lib/school-time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * A fellow's week, one block per program, at the top of the dashboard.
 *
 * **One block per program, not per course**, which is what attendance moving up to the program
 * bought here: a fellow taking three courses that all met on a Tuesday had three blocks and three
 * codes to type, and the three said the same thing while pushing the work off the one screen that
 * answers "what is due".
 *
 * Each block is three rows, and the split is what keeps it narrow enough for a phone: the program
 * with its live-session pill and the term's figure, then the week, then the code box for as long
 * as check-in is open. Laid out across a single line, the box and a long program name wrapped into
 * something that read as two programs.
 *
 * **The week is squares and the figure is the term.** A weekly percentage would be a confident
 * wrong number: a session exists only because an instructor pressed start, so a morning nobody
 * opened looks exactly like a morning the program did not meet, and a forgotten Tuesday would read
 * as a full week. Squares report each day and leave the empty ones blank; the percentage beside
 * them is cumulative, which has a denominator worth quoting.
 *
 * **It renders nothing when the week holds no session in any program.** Silence at the
 * weekend and over winter break, for the reason `CheckInCard` gives: a strip of empty squares
 * announcing its own absence is a false alarm on every day nobody meets.
 *
 * Polled at thirty seconds, as the check-in card is, so a fellow who opened this a minute before
 * class sees the code box appear without reloading.
 */

type MyWeek = RouterOutputs["attendance"]["myWeek"];

export function AttendanceStrip({ initial }: { initial: MyWeek }) {
  const trpc = useTRPC();

  const week = useQuery({
    ...trpc.attendance.myWeek.queryOptions(),
    initialData: initial,
    refetchInterval: 30_000,
  });

  const { columns, programs } = week.data;

  // Nothing met this week. Not an empty grid, and not a message about there being no grid.
  const anySession = programs.some((row) => row.days.some((day) => day.session != null));
  if (columns.length === 0 || !anySession) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">Weekly Attendance</h2>

      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
        {programs.map((row) => (
          <ProgramWeek key={row.program.id} row={row} columns={columns} />
        ))}
      </div>
    </section>
  );
}

function ProgramWeek({
  row,
  columns,
}: {
  row: MyWeek["programs"][number];
  columns: MyWeek["columns"];
}) {
  const byDay = new Map(row.days.map((day) => [day.day, day]));

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      {/*
        The program, what is happening in it right now, and how the term has gone — in that order,
        because it is the order somebody asks them in. The pill sits beside the name rather than
        beside the code box: it is a fact about the morning, and it should be legible after the
        fellow has already checked in and the box has gone.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={myAttendanceHref(row.program.id)}
          className="min-w-0 truncate text-sm font-medium hover:underline"
        >
          {row.program.name}
        </Link>

        {row.open && (
          <Badge variant="default" className="gap-1">
            {/*
              A dot that pulses. Every other animation here is a spinner on something the reader
              just pressed; this one reports a state of the world nobody in front of the screen
              caused, which is the case worth spending motion on — the pill is true for ninety
              minutes a day and the cost of not noticing it is a morning marked absent. The word
              beside it carries the whole meaning, so nothing is lost with motion reduced.
            */}
            <span aria-hidden="true" className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-current" />
            </span>
            Live session
          </Badge>
        )}

        {/*
          Cumulative, and stated as the fraction as well as the percentage — "34 of 36" is what a
          fellow can check against their own memory, and the percentage is what they are asked for.
          Nothing at all before the first session closes, rather than a nought that reads as a
          failure to turn up.
        */}
        {row.summary.rate != null && (
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {row.summary.attended} of {row.summary.eligible} ·{" "}
            <span className="font-medium text-foreground">{formatPercent(row.summary.rate)}</span>
          </span>
        )}
      </div>

      <div className="flex items-end gap-1">
        {columns.map((day) => {
          const kind = kindOf(byDay.get(day)?.session, day, row.enrolledFrom);
          const meta = CELL[kind];
          const marked = isMarked(kind);
          const description = marked
            ? `${formatSchoolDay(day)} — ${meta.label}`
            : `${formatSchoolDay(day)} — no session`;

          return (
            <div key={day} className="flex flex-col items-center gap-0.5">
              <span aria-hidden="true" className="text-[0.6rem] text-muted-foreground">
                {weekdayInitial(day)}
              </span>
              <div
                title={description}
                className={cn(
                  "relative size-5 rounded",
                  // A morning with no session is an outline rather than a filled square, so an
                  // empty week reads as nothing having happened rather than as data missing.
                  marked ? meta.className : "border border-dashed border-border",
                )}
              >
                {kind === "LATE" && <span aria-hidden="true" className={LATE_WEDGE_CLASS} />}
                <span className="sr-only">{description}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/*
        A row of its own rather than the tail of the squares, so the box has somewhere to be on a
        phone without pushing the week off the side. It is also the row that is absent for most of
        the day, once check-in has closed, which is why the two above it are self-contained.
      */}
      {row.open &&
        (row.open.checkedIn ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2
              aria-hidden="true"
              className="size-3.5 text-emerald-600 dark:text-emerald-400"
            />
            You checked in today
          </span>
        ) : (
          <CheckInForm programId={row.program.id} programName={row.program.name} compact />
        ))}
    </div>
  );
}
