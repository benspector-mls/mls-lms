"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";

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
import {
  addMonths,
  formatMonth,
  monthGrid,
  monthOf,
  monthRange,
  type SchoolMonth,
} from "@/lib/attendance/calendar";
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

/** Sunday first, matching `monthGrid`. */
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

type DayKind = "held" | "scheduled";

/**
 * A day the calendar knows about.
 *
 * Both halves arrive as `state` — `history` carries the days behind, `upcoming` the days ahead —
 * so the split below is the same predicate `summarize` divides by, read once here.
 */
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

/** Which of the three a day is. Undefined means no session, which is the blank square. */
function kindOf(session: CalendarSession | undefined): DayKind | undefined {
  if (!session) return undefined;
  // `ended` and `lapsed` are the two settled states; everything else is still to come or running.
  return session.state === "ended" || session.state === "lapsed" ? "held" : "scheduled";
}

export function AttendanceCalendar({
  programId,
  throughToday,
  today,
  hasSchedule,
  startsAt,
}: {
  programId: string;
  /** Every day dated today or earlier, from `history`, which carries nothing ahead of today. */
  throughToday: CalendarSession[];
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

  const upcoming = useQuery(trpc.attendance.upcoming.queryOptions({ programId }));

  const invalidate = React.useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: trpc.attendance.upcoming.queryKey({ programId }),
      }),
    [queryClient, trpc, programId],
  );

  const [removing, setRemoving] = React.useState(false);
  /** The blank day somebody pressed, or null. Its own state because the dialog names the day. */
  const [adding, setAdding] = React.useState<SchoolDay | null>(null);

  /*
    Two payloads into one map. `history` stops at today and `upcoming` starts at today, so they
    overlap by exactly one day and the later write wins — which is the same row either way.
  */
  const byDay = React.useMemo(() => {
    const all = new Map<SchoolDay, CalendarSession>();
    for (const session of throughToday) all.set(session.day, session);
    for (const session of upcoming.data?.days ?? []) {
      all.set(session.day, { day: session.day, state: session.state });
    }
    return all;
  }, [throughToday, upcoming.data]);

  const months = React.useMemo(() => monthRange([...byDay.keys()], today), [byDay, today]);

  /*
    Opens on the month today is in rather than on the first or last with anything in it. An
    instructor opening this in November is asking about November, and a program that ran last year
    would otherwise open ten months behind.
  */
  const [month, setMonth] = React.useState<SchoolMonth>(monthOf(today));

  if (months.length === 0) return null;

  const first = months[0];
  const last = months[months.length - 1];
  const weeks = monthGrid(month);

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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex w-full max-w-[21rem] shrink-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{formatMonth(month)}</h3>
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

              {weeks.flat().map((cell) => {
                const kind = kindOf(byDay.get(cell.day));
                const date = Number(cell.day.slice(8));

                const square = (
                  <div
                    className={cn(
                      "flex aspect-square items-center justify-center rounded text-xs leading-none tabular-nums",
                      !cell.inMonth && "opacity-35",
                      kind
                        ? KIND_CLASS[kind]
                        : "border border-transparent text-muted-foreground/50 hover:border-dashed hover:border-border hover:text-foreground",
                      // Inset, so the ring cannot be clipped by the square beside it at this size.
                      cell.day === today && "ring-2 ring-ring ring-inset",
                    )}
                  >
                    {date}
                  </div>
                );

                if (kind) {
                  return (
                    <Link
                      key={cell.day}
                      href={attendanceDayHref(programId, cell.day)}
                      title={`${formatSchoolDay(cell.day)} — ${KIND_LABEL[kind]}`}
                    >
                      {square}
                    </Link>
                  );
                }

                /*
                  A blank day today or later can be made. A day in the past cannot: `prepare`
                  refuses it, because a code for a morning that has been and gone is useless, and
                  writing such a day up by hand is the day screen's job.

                  Without a schedule only today can be made, which is the same rule the server
                  applies — a day ahead would have no start time to be given.
                */
                const canAdd = cell.day === today || (cell.day > today && hasSchedule);

                return canAdd ? (
                  <button
                    key={cell.day}
                    type="button"
                    onClick={() => setAdding(cell.day)}
                    title={`${formatSchoolDay(cell.day)} — no session. Add one.`}
                    className="rounded"
                  >
                    {square}
                  </button>
                ) : (
                  <div key={cell.day} title={`${formatSchoolDay(cell.day)} — no session`}>
                    {square}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <dl className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-4 shrink-0 rounded", KIND_CLASS.held)} />
            <dt className="font-medium">Held</dt>
            <dd className="text-muted-foreground">the record is in</dd>
          </div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("size-4 shrink-0 rounded", KIND_CLASS.scheduled)}
            />
            <dt className="font-medium">Scheduled</dt>
            <dd className="text-muted-foreground">opens on its own</dd>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-4 shrink-0 rounded border border-border" />
            <dt className="font-medium">No session</dt>
            <dd className="text-muted-foreground">the program does not meet</dd>
          </div>
        </dl>
      </div>

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
