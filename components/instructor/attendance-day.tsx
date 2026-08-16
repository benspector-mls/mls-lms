"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  ExternalLink,
  Flag,
  MonitorPlay,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Users,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/list-states";
import { AttendanceStatusBadge } from "@/components/status-badge";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { splitForCorrection, type GridRow } from "@/lib/attendance/grid";
import { attendancePresentHref, studentHref } from "@/lib/links";
import { displayNameOf, initials } from "@/lib/people";
import { formatSchoolDay } from "@/lib/school-time";
import { attendanceSourceLabel, formatDateTime } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One morning's check-in: who is here, and what to fix before forgetting.
 *
 * **The one instructor screen in this application that polls.** Every other one is server-rendered
 * and refreshed by `useServerMutation`, which is right when a screen changes because *you* changed
 * it. This one changes because twenty-five other people are doing something, so it re-reads while
 * the session is open and stops the moment it closes. A socket would be a realtime dependency
 * bought for one query every five seconds during the ten minutes a day somebody watches this.
 *
 * **The status buttons deliberately do not use `useServerMutation`.** Its `router.refresh()`
 * re-renders a server component per press, and working down a list of unresolved fellows is six or
 * twenty-seven presses — enough that the screen would stutter under its own correctness. Here the
 * polled query is the source of truth and each press invalidates it. The session controls at the
 * top *do* use it, because starting and ending a session changes the server-rendered frame.
 */

type Grid = RouterOutputs["attendance"]["grid"];

/** How often the board re-reads while a session is open. */
const POLL_MS = 5000;

export function AttendanceDay({ data }: { data: Grid }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const courseId = data.course.id;

  /*
    Seeded from the server render, so the first paint has the grid rather than a spinner — the
    page already fetched this payload. Polling only while a session is open; `false` stops it, and
    the ninety-minute backstop guarantees that eventually happens even if nobody presses end, so a
    tab left open overnight is not a query every five seconds until morning.
  */
  const grid = useQuery({
    ...trpc.attendance.grid.queryOptions({ courseId, day: data.day }),
    initialData: data,
    refetchInterval: (query) => (query.state.data?.session?.state === "open" ? POLL_MS : false),
    staleTime: 0,
  });

  const view = grid.data;
  const session = view.session;

  const start = useMutation(
    trpc.attendance.start.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.started ? "Check-in is open." : "Check-in was already open for today.",
          );
          if (result.swept.length > 0) {
            toast.info(
              `Closed ${result.swept.length} earlier ${
                result.swept.length === 1 ? "session" : "sessions"
              } nobody had ended.`,
            );
          }
        },
      }),
    ),
  );

  const end = useMutation(
    trpc.attendance.endSession.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.alreadyEnded
              ? "That session was already ended."
              : `Check-in closed. ${result.absent} marked absent.`,
          );
        },
      }),
    ),
  );

  const extend = useMutation(
    trpc.attendance.extend.mutationOptions(
      settled({ onSuccess: () => toast.success("Another 30 minutes.") }),
    ),
  );

  const reopen = useMutation(
    trpc.attendance.reopen.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            `Check-in reopened. ${result.absencesRemoved} recorded absence${
              result.absencesRemoved === 1 ? "" : "s"
            } cleared.`,
          ),
      }),
    ),
  );

  const remove = useMutation(
    trpc.attendance.deleteSession.mutationOptions(
      settled({ onSuccess: () => toast.success("That session is gone.") }),
    ),
  );

  const busy =
    start.isPending || end.isPending || extend.isPending || reopen.isPending || remove.isPending;

  const { unresolved, recorded } = splitForCorrection(view.rows);

  return (
    <div className="flex flex-col gap-4">
      {session ? (
        <SessionHeader
          session={session}
          archived={view.course.archived}
          busy={busy}
          courseId={courseId}
          onEnd={() => end.mutate({ sessionId: session.id })}
          onExtend={() => extend.mutate({ sessionId: session.id })}
          onReopen={() => reopen.mutate({ sessionId: session.id })}
          onDelete={() => remove.mutate({ sessionId: session.id })}
        />
      ) : (
        <StartCard
          day={view.day}
          isToday={view.isToday}
          archived={view.course.archived}
          busy={busy}
          onStart={() => start.mutate({ courseId, day: view.day })}
        />
      )}

      {session && (
        <>
          <Counts counts={view.counts} total={view.rows.length} />

          {view.rows.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="Nobody is enrolled yet"
              description="Send the join link from the roster. Fellows appear here once they are in the cohort."
            />
          ) : (
            <>
              {unresolved.length > 0 && (
                <RowGroup
                  heading={`Not checked in · ${unresolved.length}`}
                  rows={unresolved}
                  courseId={courseId}
                  day={view.day}
                  sessionId={session.id}
                  busy={busy}
                />
              )}
              {recorded.length > 0 && (
                <RowGroup
                  heading={`Recorded · ${recorded.length}`}
                  rows={recorded}
                  courseId={courseId}
                  day={view.day}
                  sessionId={session.id}
                  busy={busy}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Before anybody has started today.
 *
 * One button and nothing to configure. Every setting that could have gone here — how long on time
 * lasts, how long the session runs — has a working default and a place to change it afterwards,
 * and a form standing between an instructor and the code at 9:00 is the thing this feature most
 * needs not to be.
 */
function StartCard({
  day,
  isToday,
  archived,
  busy,
  onStart,
}: {
  day: string;
  isToday: boolean;
  archived: boolean;
  busy: boolean;
  onStart: () => void;
}) {
  if (archived) {
    return (
      <EmptyState
        icon={<Clock />}
        title="This cohort has finished"
        description="Its attendance stays readable and exportable, but no new session can be started."
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">No check-in yet for {formatSchoolDay(day)}</span>
        <span className="text-xs text-muted-foreground">
          {isToday
            ? "Starting it puts a code on the screen. Fellows check in with it until you end the session, or for ninety minutes."
            : "Starting it lets you record this day by hand. No code will be useful this long after the fact."}
        </span>
      </div>
      <Button size="sm" disabled={busy} onClick={onStart}>
        <Play data-icon="inline-start" />
        Start check-in
      </Button>
    </div>
  );
}

/**
 * The session's own controls, and the one fact that must not surprise anybody.
 *
 * **The backstop is printed before it bites.** A code that stops working with no warning, in front
 * of a room, is the single failure this design could introduce that the Google Form does not have
 * — so the time is on screen the whole session and Extend is beside it. Once it has lapsed the
 * wording changes and the button becomes Reopen, because those are different acts: one says class
 * is running long, the other says it was closed too soon.
 */
function SessionHeader({
  session,
  archived,
  busy,
  courseId,
  onEnd,
  onExtend,
  onReopen,
  onDelete,
}: {
  session: NonNullable<Grid["session"]>;
  archived: boolean;
  busy: boolean;
  courseId: string;
  onEnd: () => void;
  onExtend: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const open = session.state === "open";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{formatSchoolDay(session.day)}</span>
          <span className="text-xs text-muted-foreground">
            {open ? (
              <>
                Open since {formatDateTime(session.startedAt)} · on time until{" "}
                {onTimeUntil(session)} · closes on its own at {timeOnly(session.endsAt)}
              </>
            ) : session.state === "ended" ? (
              <>Ended at {formatDateTime(session.endedAt)}</>
            ) : (
              <>Closed on its own at {formatDateTime(session.endsAt)} — nobody ended it</>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {open && (
            <>
              {/*
                A plain anchor, not a `window.open` in a mutation callback. A popup opened after an
                `await` is outside the user gesture that asked for it and browsers block it — which
                would be a silent failure at 9:00 in front of twenty-five people.
              */}
              <Button
                size="sm"
                variant="outline"
                render={
                  <a href={attendancePresentHref(courseId)} target="_blank" rel="noreferrer" />
                }
              >
                <MonitorPlay data-icon="inline-start" />
                Show the code
                <ExternalLink className="ml-1 size-3" />
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onExtend}>
                +30 minutes
              </Button>
              <Button size="sm" disabled={busy} onClick={onEnd}>
                <Square data-icon="inline-start" />
                End check-in
              </Button>
            </>
          )}

          {!open && !archived && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReopen}>
              <RotateCcw data-icon="inline-start" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/*
        Inline rather than a dialog, in the manner of the join link's replace confirmation, and it
        names what would be lost rather than asking "are you sure".
      */}
      {confirmingDelete ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Deleting this session removes it from every fellow&apos;s record and from the export, as
            though the cohort never met. Use this for a session started on the wrong day.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onDelete();
                setConfirmingDelete(false);
              }}
            >
              Delete this session
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="mr-1 inline size-3" />
          Started this by mistake?
        </button>
      )}
    </div>
  );
}

function onTimeUntil(session: NonNullable<Grid["session"]>): string {
  return timeOnly(new Date(session.startedAt.getTime() + session.lateAfterMinutes * 60 * 1000));
}

function timeOnly(at: Date): string {
  return at.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Counts({ counts, total }: { counts: Grid["counts"]; total: number }) {
  const cells = [
    { label: "Present", value: counts.present },
    { label: "Late", value: counts.late },
    { label: "Excused", value: counts.excused },
    { label: "Absent", value: counts.absent },
    { label: "Not in", value: counts.unrecorded },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-2"
        >
          <span className="text-lg font-semibold tabular-nums">{cell.value}</span>
          <span className="text-xs text-muted-foreground">{cell.label}</span>
        </div>
      ))}
      <span className="sr-only">{total} fellows in this cohort</span>
    </div>
  );
}

/**
 * Two groups rather than one alphabetical list.
 *
 * Whoever needs an instructor's attention floats to the top. The gradebook and the roster both
 * split their tables for the same reason: a distinction worth acting on should not be something
 * the reader has to find by reading carefully.
 */
function RowGroup({
  heading,
  rows,
  courseId,
  day,
  sessionId,
  busy,
}: {
  heading: string;
  rows: GridRow[];
  courseId: string;
  day: string;
  sessionId: string;
  busy: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <Row
            key={row.enrollmentId}
            row={row}
            courseId={courseId}
            day={day}
            sessionId={sessionId}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

function Row({
  row,
  courseId,
  day,
  sessionId,
  busy,
}: {
  row: GridRow;
  courseId: string;
  day: string;
  sessionId: string;
  busy: boolean;
}) {
  const name = displayNameOf(row.student, "Unnamed");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
            {initials(row.student.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <a
              href={studentHref(courseId, row.student.id)}
              className="truncate text-sm font-medium hover:underline"
            >
              {name}
            </a>
            {row.student.testStudentNumber !== null && <TestStudentBadge />}
          </div>
          <Provenance row={row} />
        </div>
      </div>

      <StatusButtons row={row} courseId={courseId} day={day} sessionId={sessionId} busy={busy} />
    </div>
  );
}

/**
 * Where this mark came from, in words.
 *
 * Words rather than a colour or an icon, for the reason the gradebook writes "Not graded" instead
 * of adding a fourth dot to its legend. This is the distinction a compliance reader is checking,
 * and it has to survive being read quickly.
 */
function Provenance({ row }: { row: GridRow }) {
  if (!row.record) {
    return (
      <span className="text-xs text-muted-foreground">
        {row.pending === "not-yet" ? "Not checked in yet" : "No check-in"}
      </span>
    );
  }

  const when = row.record.checkedInAt ? ` at ${timeOnly(row.record.checkedInAt)}` : "";

  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
      {attendanceSourceLabel(row.record.source, row.record.recordedByName)}
      {when}
      {row.record.note && (
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <Flag className="size-3 shrink-0" />
          <span className="truncate">{row.record.note}</span>
        </span>
      )}
    </span>
  );
}

const STATUSES = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;

/**
 * Four buttons, not a dropdown.
 *
 * A dropdown doubles every correction to two clicks, and this control is used six times on an
 * ordinary morning and twenty-seven on the morning the projector fails. The current value is the
 * filled one, so the row also reads as a status without anything else drawing it.
 */
function StatusButtons({
  row,
  courseId,
  day,
  sessionId,
  busy,
}: {
  row: GridRow;
  courseId: string;
  day: string;
  sessionId: string;
  busy: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  /*
    Invalidating the one polled query rather than going through `useServerMutation`. Its
    `router.refresh()` re-renders a server component per press, and a morning where the projector
    failed is twenty-seven presses — enough that the screen would stutter under its own
    correctness. Here the polled query is the source of truth and this is the only thing that has
    to change.
  */
  const set = useMutation(
    trpc.attendance.setStatus.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.attendance.grid.queryKey({ courseId, day }),
        }),
      onError: (error) => toast.error(error.message),
    }),
  );

  const current = row.record?.status ?? null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      {row.record && <AttendanceStatusBadge status={row.record.status} className="sm:hidden" />}
      {STATUSES.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={current === status ? "default" : "outline"}
          disabled={busy || set.isPending}
          className={cn("h-7 px-2 text-xs", current === status && "pointer-events-none")}
          onClick={() => set.mutate({ sessionId, enrollmentId: row.enrollmentId, status })}
        >
          {status.charAt(0) + status.slice(1).toLowerCase()}
        </Button>
      ))}
    </div>
  );
}
