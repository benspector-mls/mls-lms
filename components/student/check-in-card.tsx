"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, Clock } from "lucide-react";
import * as React from "react";

import { AttendanceStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSchoolTime } from "@/lib/school-time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Check in, on the attendance screen of the course it belongs to.
 *
 * **It sits here rather than on the dashboard**, which costs a click at nine in the morning and
 * buys one place where a fellow's attendance lives. Three courses meant three cards stacked above
 * the work on the one screen that is supposed to answer "what is due", and typing a code for
 * Technical Interview Prep is not a thing anybody does from a list of overdue assignments. The
 * sidebar puts this one click away from anywhere inside the course.
 *
 * **It renders nothing at all when no session is open**, rather than saying "no check-in today".
 * That distinction matters more than it looks: a card that announced its own absence would be a
 * false alarm every Saturday, over winter break, and on every morning an instructor is running
 * fifteen minutes behind. Silence is the correct thing to show when there is nothing to do.
 *
 * Three details that sound small and are not:
 *
 * **No autofocus.** On a phone it throws the keyboard up and scrolls the dashboard out from under
 * somebody who came here to read their overdue list.
 *
 * **A wrong code is answered inline, never in a toast.** A toast about what you just typed
 * disappears while you are still typing the next attempt.
 *
 * **The checked-in state persists all day.** A fellow who reloads at two in the afternoon should be
 * reassured, not asked again.
 */

type Today = RouterOutputs["attendance"]["today"];

export function CheckInCard({ courseId, initial }: { courseId: string; initial: Today }) {
  const trpc = useTRPC();

  /*
    Re-read on a slow interval as well as after a check-in, so a fellow who opened this screen a
    minute before class sees the card appear without reloading. Thirty seconds is far below the
    cost of noticing.

    `attendance.today` answers for every course a fellow is in — it is one query either way, and
    narrowing it here rather than adding a per-course procedure keeps one answer to "what is open
    right now" for the whole application.
  */
  const today = useQuery({
    ...trpc.attendance.today.queryOptions(),
    initialData: initial,
    refetchInterval: 30_000,
  });

  const entry = today.data.find((row) => row.courseId === courseId);
  if (!entry) return null;

  return <CourseCheckIn entry={entry} />;
}

function CourseCheckIn({ entry }: { entry: Today[number] }) {
  const trpc = useTRPC();
  const [code, setCode] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);

  const queryClient = useQueryClient();

  const checkIn = useMutation(
    trpc.attendance.checkIn.mutationOptions({
      onSuccess: () => {
        setCode("");
        setProblem(null);
        // Flips this card to its checked-in state. `useServerMutation` is the wrong tool here —
        // the dashboard around this card has not changed and does not need re-rendering.
        void queryClient.invalidateQueries({ queryKey: trpc.attendance.today.queryKey() });
      },
      onError: (error) => setProblem(error.message),
    }),
  );

  const record = entry.record;
  const open = entry.session.state === "open";

  if (record) {
    return (
      <Shell tone="done">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            {entry.courseName}
            <AttendanceStatusBadge status={record.status} />
          </span>
          <span className="text-xs text-muted-foreground">
            {record.source === "SELF_CHECK_IN" && record.checkedInAt
              ? `Checked in at ${formatSchoolTime(record.checkedInAt)}.`
              : record.recordedByName
                ? `Marked by ${record.recordedByName}.`
                : "Recorded by your instructor."}
            {record.status === "LATE" &&
              " If you were here on time, tell your instructor — they can change this."}
          </span>
        </div>
      </Shell>
    );
  }

  if (!open) {
    return (
      <Shell tone="closed">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <CircleSlash className="size-4 text-muted-foreground" />
            Check-in closed for {entry.courseName}
          </span>
          <span className="text-xs text-muted-foreground">
            You are not marked in for today. Speak to your instructor — they can record it.
          </span>
        </div>
      </Shell>
    );
  }

  return (
    <Shell tone="open">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Clock className="size-4 text-primary" />
            Check in — {entry.courseName}
          </span>
          <span className="text-xs text-muted-foreground">
            Type the code on the screen. It changes every 30 seconds.
          </span>
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            checkIn.mutate({ courseId: entry.courseId, code });
          }}
        >
          <Input
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 4));
              setProblem(null);
            }}
            // Numeric on a phone, and no autofocus — see the note at the top of this file.
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Check-in code for ${entry.courseName}`}
            placeholder="0000"
            className="w-28 text-center font-mono text-lg tracking-[0.3em] tabular-nums"
          />
          <Button type="submit" disabled={code.length !== 4 || checkIn.isPending}>
            Check in
          </Button>
        </form>

        {problem && <p className="text-xs text-destructive-foreground">{problem}</p>}
      </div>
    </Shell>
  );
}

function Shell({
  tone,
  children,
}: {
  tone: "open" | "done" | "closed";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
        tone === "open" && "border-primary/40 bg-primary/5",
        tone === "done" && "border-border bg-muted/30",
        tone === "closed" && "border-dashed border-border",
      )}
    >
      {children}
    </div>
  );
}
