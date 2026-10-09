"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";

import { MonthCalendar, squareClass, type CalendarKey } from "@/components/month-calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { attendanceCodesHref, attendanceDayHref } from "@/lib/links";
import { formatSchoolClock, formatSchoolDay, type SchoolDay } from "@/lib/school-time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * The program's days, as a month you can page through.
 *
 * **A calendar rather than two lists, because the question is about days and days have a shape.**
 * What this replaced was a list of earlier sessions and a list of days still to come — twenty rows
 * that said the same thing a month grid says in a glance, and that could not be read against each
 * other at all. A holiday in the middle of a working week is a hole you can see here; in a list it
 * was an absent row nobody counts.
 *
 * **The same calendar a fellow's record draws**, by way of `MonthCalendar`, so the program's days
 * and one fellow's mornings are one grid at one size and an instructor can read one against the
 * other square for square.
 *
 * **Three kinds of square, and no fourth.** A day that was **held** and whose books are closed; a
 * day **scheduled** that has not settled, which is every day ahead and today until it lapses; and
 * a blank square for a day with no session at all. That is the distinction an instructor is
 * checking for when they open this — did we meet, will we meet, is this day a mistake — and a
 * fourth shade would be answering a question nobody asked.
 *
 * **No numbers in the squares.** How many turned up is a fact about a day the term grid reports at
 * the head of each column, and repeating it here at the size of a calendar cell would be two
 * places to read the same figure and one of them illegible.
 *
 * Every day with a session is a link to that day's screen, which is where a status is corrected
 * and where a single day is removed. **A blank square today or later is an offer to make one**,
 * which is how a day removed by mistake comes back and how a make-up Saturday is added — the two
 * cases that otherwise meant finding the day's own screen by editing a URL. A blank square in the
 * past is inert: `prepare` refuses a day that has been and gone, because a code for it is useless.
 */

type DayKind = "held" | "scheduled";

/** A day the calendar knows about: one row of `days`. */
export type CalendarSession = {
  day: SchoolDay;
  state: string;
};

const KIND_CLASS: Record<DayKind, string> = {
  /*
    Filled, because something happened. The same emerald the fellow's own present square uses, at a
    weight that reads as "there is a record here" rather than as "this went well" — a day where
    everybody was absent is still a day that was held, and the colour must not claim otherwise.
  */
  held: "border border-transparent bg-emerald-500/80 text-white hover:bg-emerald-500",
  /** Hollow, because nothing has happened yet. Outlined rather than tinted, so it reads as a plan. */
  scheduled: "border border-dashed border-primary/60 text-foreground hover:bg-primary/10",
};

const KIND_LABEL: Record<DayKind, string> = {
  held: "Held — open it to read or correct the record",
  scheduled: "Scheduled — it will open on its own",
};

const LEGEND: CalendarKey[] = [
  { swatch: KIND_CLASS.held, term: "Held" },
  { swatch: KIND_CLASS.scheduled, term: "Scheduled" },
  { swatch: "border border-border", term: "No session" },
];

/** Which of the three a day is. Undefined means no session, which is the blank square. */
function kindOf(session: CalendarSession | undefined): DayKind | undefined {
  if (!session) return undefined;
  // `ended` and `lapsed` are the two settled states; everything else is still to come or running.
  return session.state === "ended" || session.state === "lapsed" ? "held" : "scheduled";
}

/**
 * The program's days, held and scheduled, as a month of squares — the calendar itself, without
 * the Schedule tab's buttons around it.
 *
 * Drawn on the Schedule tab, where a blank day can be made into a session, and in the Jump to a
 * date dialog on today's board and on any day's screen, where every square with a session is a
 * way into that day's screen and a blank square is inert. It fetches its own days, from `days`,
 * so a screen that carries it owes it nothing but the program.
 */
export function ProgramDaysCalendar({
  programId,
  today,
  blankDay,
}: {
  programId: string;
  /** Passed in rather than read here, so the server and the browser agree on which square is today. */
  today: SchoolDay;
  /**
   * What a day with no session offers: the act of making one, or null for nothing. Left out, every
   * blank square is a plain square; given, a day it answers null for is a plain square too, so a
   * day that cannot be made never looks like a button.
   */
  blankDay?: (day: SchoolDay) => (() => void) | null;
}) {
  const trpc = useTRPC();
  const days = useQuery(trpc.attendance.days.queryOptions({ programId }));

  const byDay = React.useMemo(
    () => new Map<SchoolDay, CalendarSession>((days.data ?? []).map((day) => [day.day, day])),
    [days.data],
  );

  const sessionDays = React.useMemo(() => [...byDay.keys()], [byDay]);

  return (
    <MonthCalendar days={sessionDays} today={today} legend={LEGEND}>
      {(cell) => {
        const kind = kindOf(byDay.get(cell.day));
        const date = Number(cell.day.slice(8));

        const square = (
          <div
            className={cn(
              squareClass(cell, today),
              kind
                ? KIND_CLASS[kind]
                : "border border-transparent text-muted-foreground/50 hover:border-dashed hover:border-border hover:text-foreground",
            )}
          >
            {date}
          </div>
        );

        if (kind) {
          return (
            <Link
              href={attendanceDayHref(programId, cell.day)}
              title={`${formatSchoolDay(cell.day)} — ${KIND_LABEL[kind]}`}
            >
              {square}
            </Link>
          );
        }

        const add = blankDay?.(cell.day) ?? null;

        return add ? (
          <button
            type="button"
            onClick={add}
            title={`${formatSchoolDay(cell.day)} — no session. Add one.`}
            className="rounded"
          >
            {square}
          </button>
        ) : (
          <div title={`${formatSchoolDay(cell.day)} — no session`}>{square}</div>
        );
      }}
    </MonthCalendar>
  );
}

export function AttendanceCalendar({
  programId,
  today,
  hasSchedule,
  startsAt,
}: {
  programId: string;
  /** Passed in rather than read here, so the server and the browser agree on which square is today. */
  today: SchoolDay;
  /*
    Whether this program's days make themselves. Without a schedule there is no start time to give
    a day ahead, so `prepare` refuses one — and a square that opened a dialog whose only button was
    refused would be worse than a square that does nothing.
  */
  hasSchedule: boolean;
  /** What time class starts, so the dialog can say what the day it makes will look like. */
  startsAt: string | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const invalidate = React.useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: trpc.attendance.days.queryKey({ programId }),
      }),
    [queryClient, trpc, programId],
  );

  const [removing, setRemoving] = React.useState(false);
  /** The blank day somebody pressed, or null. Its own state because the dialog names the day. */
  const [adding, setAdding] = React.useState<SchoolDay | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">The program&rsquo;s days</h2>
          <p className="text-xs text-muted-foreground">
            Open a day to read or correct it. Remove the days the program will not meet — a day left
            in place opens itself and marks everybody absent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setRemoving(true)}>
            Remove days
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={<a href={attendanceCodesHref(programId)} target="_blank" rel="noreferrer" />}
          >
            <Printer data-icon="inline-start" />
            Print the coming codes
            <ExternalLink className="ml-1 size-3" />
          </Button>
        </div>
      </div>

      {/*
        A blank day today or later can be made. A day in the past cannot: `prepare` refuses it,
        because a code for a morning that has been and gone is useless, and writing such a day up
        by hand is the day screen's job. Without a schedule only today can be made, which is the
        same rule the server applies — a day ahead would have no start time to be given.
      */}
      <ProgramDaysCalendar
        programId={programId}
        today={today}
        blankDay={(day) =>
          day === today || (day > today && hasSchedule) ? () => setAdding(day) : null
        }
      />

      <AddDay
        programId={programId}
        day={adding}
        startsAt={startsAt}
        onOpenChange={(next) => {
          if (!next) setAdding(null);
        }}
        onDone={invalidate}
      />

      <RemoveDays
        programId={programId}
        open={removing}
        onOpenChange={setRemoving}
        onDone={invalidate}
      />
    </section>
  );
}

/**
 * Making a day the calendar has no session for.
 *
 * **The two cases it exists for are a holiday that turned out not to be one, and a make-up
 * Saturday.** Both were reachable before only by editing the address of a day's own screen, which
 * is to say not reachable. A blank square is where somebody notices the day is missing, so it is
 * where the offer to make it belongs.
 *
 * **It says what the day will look like rather than asking for anything.** There is nothing to
 * fill in: the day comes from the square that was pressed and the clock comes from the program's
 * schedule, so the dialog's whole job is to state both before the act and let it be cancelled.
 */
function AddDay({
  programId,
  day,
  startsAt,
  onOpenChange,
  onDone,
}: {
  programId: string;
  /** The day pressed, or null when the dialog is closed. */
  day: SchoolDay | null;
  startsAt: string | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const add = useMutation(
    trpc.attendance.prepare.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.prepared
              ? `${formatSchoolDay(result.day)} is now a class day.`
              : `${formatSchoolDay(result.day)} already had a session.`,
          );
          onOpenChange(false);
          onDone();
        },
      }),
    ),
  );

  return (
    <Dialog open={day !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a session</DialogTitle>
          <DialogDescription>
            {day === null ? null : startsAt ? (
              <>
                {formatSchoolDay(day)} becomes a class day. It starts at{" "}
                {formatSchoolClock(startsAt)}, like every other day this program meets, and its code
                works from two hours before that until eight hours after it. Nobody needs to press
                anything on the day itself.
              </>
            ) : (
              <>
                {formatSchoolDay(day)} gets a code, ready to write up or project. Check-in does not
                open until somebody presses Start on that day, and being on time is measured from
                when they do.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            size="sm"
            disabled={day === null || add.isPending}
            onClick={() => day !== null && add.mutate({ programId, day })}
          >
            <CalendarPlus data-icon="inline-start" />
            Add the session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Removing days, one or a stretch of them.
 *
 * **One day is the common case and costs one field.** Choosing a first day carries the last day
 * with it, so closing the building for a single Tuesday is: open, pick Tuesday, remove. A stretch
 * is the same act with the second field touched, and once it *has* been touched the first field
 * stops dragging it — otherwise correcting the start of a range would silently throw away the end
 * somebody had just chosen.
 */
function RemoveDays({
  programId,
  open,
  onOpenChange,
  onDone,
}: {
  programId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  /*
    Whether the last day is somebody's choice rather than an echo of the first. A comparison would
    nearly do — carry the last day whenever it falls before the first — but it cannot tell a
    deliberate one-day range from an echoed one, so moving the first day back would quietly widen
    a range the reader had set to a single day.
  */
  const [toChosen, setToChosen] = React.useState(false);

  const remove = useMutation(
    trpc.attendance.removeDays.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.kept.length === 0
              ? `${result.removed.length} day${result.removed.length === 1 ? "" : "s"} removed.`
              : `${result.removed.length} removed. ` +
                  `${result.kept.map(formatSchoolDay).join(", ")} kept, because somebody had ` +
                  `already checked in.`,
          );
          onOpenChange(false);
          setFrom("");
          setTo("");
          setToChosen(false);
          onDone();
        },
      }),
    ),
  );

  const valid = from !== "" && to !== "" && to >= from;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove days</DialogTitle>
          <DialogDescription>
            Every day from the first to the last, today included, stops being a class day. Choose
            only a first day to remove that one day. A day somebody has already checked into is kept
            and named. Days that have already happened are never touched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">From</span>
            <Input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                // The last day follows until somebody chooses one, which is what makes removing a
                // single day a one-field act.
                if (!toChosen) setTo(event.target.value);
              }}
              className="w-40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">To</span>
            <Input
              type="date"
              value={to}
              // Nothing before the first day is a range at all, so the picker will not offer one.
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                setToChosen(event.target.value !== "");
              }}
              className="w-40"
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="destructive"
            disabled={!valid || remove.isPending}
            onClick={() => remove.mutate({ programId, from, to })}
          >
            Remove day(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
