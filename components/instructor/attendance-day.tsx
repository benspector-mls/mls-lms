"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Flag,
  MessageSquarePlus,
  MonitorPlay,
  Play,
  RefreshCw,
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
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { splitForCorrection, type GridRow } from "@/lib/attendance/grid";
import { attendancePresentHref, studentHref } from "@/lib/links";
import { displayNameOf, initials } from "@/lib/people";
import { formatSchoolDay, formatSchoolTime } from "@/lib/school-time";
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
 * bought for a screen somebody watches for the first half hour of the day.
 *
 * **The status buttons deliberately do not use `useServerMutation`.** Its `router.refresh()`
 * re-renders a server component per press, and working down a list of unresolved fellows is six or
 * twenty-seven presses — enough that the screen would stutter under its own correctness. Here the
 * polled query is the source of truth and each press invalidates it. The session controls at the
 * top *do* use it, because starting and ending a session changes the server-rendered frame.
 */

type Grid = RouterOutputs["attendance"]["grid"];

/**
 * How often the board re-reads while a session is open, at two speeds.
 *
 * **Fast while people are arriving, slow for the rest of the day.** Five seconds is the right
 * answer to the only question this screen is asked at speed — "is everybody in yet" — and it is a
 * ridiculous answer to the eight hours after that, when what arrives is the occasional late fellow.
 * Check-in used to close after ninety minutes, so a single fast interval was self-limiting; a
 * day-long window makes it 5,760 requests for a board nobody is reading.
 *
 * **What the slow speed costs is nothing an instructor notices**, because polling is not how their
 * own work reaches the screen. Each status press invalidates the query directly (see below), so a
 * correction appears at once. Polling only ever reports what *other* people did — a fellow typing
 * the code, a co-teacher fixing a row — and a minute is well inside the time either takes to
 * matter.
 *
 * Measured from `startedAt` rather than from anything about the rows. "Poll fast while somebody is
 * still unaccounted for" reads better and is the wrong rule: one fellow absent all day would hold
 * the screen at full speed all day, which is exactly the case worth avoiding.
 */
const POLL_FAST_MS = 5000;
const POLL_SLOW_MS = 60_000;

/** How long after check-in opens the board stays at `POLL_FAST_MS`. */
const ARRIVAL_MINUTES = 30;

export function AttendanceDay({ data }: { data: Grid }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const programId = data.program.id;

  /*
    Seeded from the server render, so the first paint has the grid rather than a spinner — the
    page already fetched this payload. Polling only while a session is open; `false` stops it, and
    the eight-hour backstop guarantees that eventually happens even if nobody presses end, so a
    tab left open overnight is not a query a minute until morning.
  */
  const grid = useQuery({
    ...trpc.attendance.grid.queryOptions({ programId, day: data.day }),
    initialData: data,
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (session?.state !== "open") return false;

      const arrivalEndsAt = session.startedAt.getTime() + ARRIVAL_MINUTES * 60 * 1000;
      return Date.now() < arrivalEndsAt ? POLL_FAST_MS : POLL_SLOW_MS;
    },
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
          archived={view.program.archived}
          busy={busy}
          programId={programId}
          onEnd={() => end.mutate({ sessionId: session.id })}
          onExtend={() => extend.mutate({ sessionId: session.id })}
          onReopen={() => reopen.mutate({ sessionId: session.id })}
          onDelete={() => remove.mutate({ sessionId: session.id })}
        />
      ) : (
        <StartCard
          day={view.day}
          isToday={view.isToday}
          archived={view.program.archived}
          busy={busy}
          onStart={() => start.mutate({ programId, day: view.day })}
        />
      )}

      {session && (
        <>
          <Counts counts={view.counts} total={view.rows.length} />

          {view.rows.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="Nobody is enrolled yet"
              description="Send the join link from the roster. Fellows appear here once they are on it."
            />
          ) : (
            <>
              {unresolved.length > 0 && (
                <RowGroup
                  heading={`Not checked in · ${unresolved.length}`}
                  rows={unresolved}
                  programId={programId}
                  day={view.day}
                  sessionId={session.id}
                  busy={busy}
                />
              )}
              {recorded.length > 0 && (
                <RowGroup
                  heading={`Recorded · ${recorded.length}`}
                  rows={recorded}
                  programId={programId}
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
        title="This program has finished"
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
            ? "Starting it puts a code on the screen. Fellows check in with it until you end check-in, or for eight hours."
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
  programId,
  onEnd,
  onExtend,
  onReopen,
  onDelete,
}: {
  session: NonNullable<Grid["session"]>;
  archived: boolean;
  busy: boolean;
  programId: string;
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
                {onTimeUntil(session)} · closes on its own at {formatSchoolTime(session.endsAt)}
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
                  <a href={attendancePresentHref(programId)} target="_blank" rel="noreferrer" />
                }
              >
                <MonitorPlay data-icon="inline-start" />
                Project the code
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

      {open && <CodeCard sessionId={session.id} endsAt={session.endsAt} />}

      {/*
        Inline rather than a dialog, in the manner of the join link's replace confirmation, and it
        names what would be lost rather than asking "are you sure".
      */}
      {confirmingDelete ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Deleting this session removes it from every fellow&apos;s record and from the export, as
            though the program never met. Use this for a session started on the wrong day.
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

/**
 * The code, where an instructor can take it without giving up their screen.
 *
 * **This is what a fixed code buys, and the reason it is worth its cost.** The code has to reach the
 * class; it does not have to be *displayed* to the class. An instructor teaching from a shared VS
 * Code window or a slide deck copies four digits from here into the Zoom chat, and the shared screen
 * is never involved — where a rotating code could only be handed over by putting it on screen and
 * leaving it there. A fellow arriving at twenty past reads it out of the chat, and nobody's lesson
 * stops.
 *
 * **Replace is beside it rather than buried**, because a fixed code makes an instructor's judgment
 * the only remedy for a leak. It is worded as what it does and confirmed inline, in the manner of the
 * delete control below: pressing it invalidates the code twenty-five people already have, so it must
 * not be a thing anybody does while aiming for Copy.
 *
 * Reads `attendance.sessionCode` rather than taking the code off the grid payload, so `codeSecret`
 * stays inside the one procedure that already derives from it and `verify:attendance` keeps having
 * one payload to walk.
 */
function CodeCard({ sessionId, endsAt }: { sessionId: string; endsAt: Date }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirmingReplace, setConfirmingReplace] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const code = useQuery({
    ...trpc.attendance.sessionCode.queryOptions({ sessionId }),
    // No interval. The code cannot change on its own now, so the only thing that changes it is the
    // mutation below, which invalidates this itself.
    staleTime: Infinity,
  });

  const replace = useMutation(
    trpc.attendance.rotateCode.mutationOptions({
      onSuccess: () => {
        setConfirmingReplace(false);
        setCopied(false);
        void queryClient.invalidateQueries({
          queryKey: trpc.attendance.sessionCode.queryKey({ sessionId }),
        });
        toast.success("The code is replaced. Give the new one out — the old one no longer works.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const digits = code.data?.code ?? null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-2xl leading-none font-bold tracking-[0.25em] tabular-nums">
            {digits ?? "————"}
          </span>
          <span className="text-xs text-muted-foreground">
            Give this out once — it works until {formatSchoolTime(endsAt)}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!digits}
            onClick={() => {
              if (!digits) return;
              /*
                No await and no error branch on the clipboard itself. It can be refused by the
                browser, and the useful fallback when it is refused is the digits already on screen
                beside this button — a toast explaining a permissions model would be worse than the
                code the instructor can read.
              */
              void navigator.clipboard?.writeText(digits);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      {confirmingReplace ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Replacing the code stops the current one working for everybody, including fellows who
            are typing it now. Use this if the code has reached somebody who is not in class, and
            give the new one out afterwards.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={replace.isPending}
              onClick={() => replace.mutate({ sessionId })}
            >
              {replace.isPending ? "Replacing…" : "Replace the code"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingReplace(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setConfirmingReplace(true)}
        >
          <RefreshCw className="mr-1 inline size-3" />
          Has this code got out?
        </button>
      )}
    </div>
  );
}

function onTimeUntil(session: NonNullable<Grid["session"]>): string {
  return formatSchoolTime(
    new Date(session.startedAt.getTime() + session.lateAfterMinutes * 60 * 1000),
  );
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
      <span className="sr-only">{total} fellows on this roster</span>
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
  programId,
  day,
  sessionId,
  busy,
}: {
  heading: string;
  rows: GridRow[];
  programId: string;
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
            programId={programId}
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
  programId,
  day,
  sessionId,
  busy,
}: {
  row: GridRow;
  programId: string;
  day: string;
  sessionId: string;
  busy: boolean;
}) {
  const name = displayNameOf(row.student, "Unnamed");
  const [editingNote, setEditingNote] = React.useState(false);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initials(row.student.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <a
                href={studentHref(programId, row.student.id)}
                className="truncate text-sm font-medium hover:underline"
              >
                {name}
              </a>
              {row.student.testStudentNumber !== null && <TestStudentBadge />}
            </div>
            <Provenance row={row} />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <StatusButtons
            row={row}
            programId={programId}
            day={day}
            sessionId={sessionId}
            busy={busy}
          />
          {/*
            Only once there is a mark to explain. A note is a sentence about a decision, and
            before a status is set there is no decision for it to be about — offering the button
            first would mean writing "hospital appointment" against nothing.
          */}
          {row.record && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={busy}
              aria-label={row.record.note ? `Edit the note for ${name}` : `Add a note for ${name}`}
              onClick={() => setEditingNote((open) => !open)}
            >
              <MessageSquarePlus />
              {row.record.note ? "Edit note" : "Note"}
            </Button>
          )}
        </div>
      </div>

      {editingNote && row.record && (
        <NoteEditor
          row={row}
          programId={programId}
          day={day}
          sessionId={sessionId}
          busy={busy}
          onDone={() => setEditingNote(false)}
        />
      )}
    </div>
  );
}

/**
 * A sentence about why a mark is what it is.
 *
 * **It writes through `setStatus` with the status the row already has**, rather than through a
 * procedure of its own. A note is not a thing in its own right — it is part of the decision, which
 * is why it lives on the record beside the status and why the audit event for setting one is the
 * same event. The cost is that the note cannot be written before the status, which is the correct
 * order anyway.
 *
 * An empty box clears the note rather than storing an empty string: the field is optional, and
 * `undefined` is what makes the procedure write null.
 */
function NoteEditor({
  row,
  programId,
  day,
  sessionId,
  busy,
  onDone,
}: {
  row: GridRow;
  programId: string;
  day: string;
  sessionId: string;
  busy: boolean;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [text, setText] = React.useState(row.record?.note ?? "");

  const save = useMutation(
    trpc.attendance.setStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.attendance.grid.queryKey({ programId, day }),
        });
        onDone();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!row.record) return null;
  const status = row.record.status;

  return (
    <form
      className="flex flex-wrap items-center gap-2 pl-11"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          sessionId,
          enrollmentId: row.enrollmentId,
          status,
          note: text.trim() || undefined,
        });
      }}
    >
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={500}
        autoFocus
        placeholder="Why — a hospital appointment, a late train"
        className="h-7 min-w-0 flex-1 text-xs"
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
        }}
      />
      <Button
        type="submit"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={busy || save.isPending}
      >
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDone}>
        Cancel
      </Button>
    </form>
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

  const when = row.record.checkedInAt ? ` at ${formatSchoolTime(row.record.checkedInAt)}` : "";

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
  programId,
  day,
  sessionId,
  busy,
}: {
  row: GridRow;
  programId: string;
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
          queryKey: trpc.attendance.grid.queryKey({ programId, day }),
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
