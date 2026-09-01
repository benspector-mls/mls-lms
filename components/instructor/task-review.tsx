"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { CircleCheck, CircleSlash } from "lucide-react";

import { CommentsCard } from "@/components/instructor/review/comments-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { displayNameOf } from "@/lib/people";
import { formatDateTime } from "@/lib/status";
import { useTRPC } from "@/trpc/client";

/** The three columns `displayNameOf` falls through. Structural, so any select carrying them fits. */
type Person = { displayName: string | null; email: string | null; githubUsername: string | null };

/**
 * One fellow's task, and the two buttons that decide it.
 *
 * **Its own pane rather than a branch inside `GradingReview`**, and the reason is what it has to
 * handle rather than what it draws. That component takes a submission — a report, drafts, test
 * runs, a diff, a score against a threshold — and half its body is queries keyed on a submission
 * id. A task has none of those, and the fellow this pane most often opens on does not have a
 * submission at all: a task's queue lists the whole roster, so "nobody has touched this" is an
 * ordinary state here and an impossible one there.
 *
 * What it keeps is the conversation, which is the same `CommentsCard` the review pane draws and is
 * keyed on `(assignment, student)` rather than on a submission — so it works for a fellow with no
 * row, and an instructor sending a task back can say why in the same place they always would.
 */
export function TaskReview({
  assignmentId,
  student,
  /**
   * The verdict as it stands: true for done, false for an instructor's "not done", and null for a
   * task nobody has said anything about.
   *
   * Three states rather than a boolean, because "not done" and "nobody has said" are different
   * facts and the buttons below have to show which one is current. `isComplete` on the submission
   * is exactly this, and null is what a fellow with no row has.
   */
  isComplete,
  /** When the standing verdict was set, and by whom. Null when there is no verdict. */
  markedAt,
  markedBy,
  /**
   * Whether fellows may mark this task themselves, from `taskIsSelfMarked`.
   *
   * Changes nothing about what this pane can do — an instructor sets either verdict on any task —
   * and is shown because it changes what the fellow is waiting for. On a task only the instructor
   * marks, an empty verdict means the fellow may well have done the thing and be waiting to be
   * checked, rather than not having started.
   */
  selfMarked,
  studentHref,
  now,
}: {
  assignmentId: string;
  student: { id: string } & Person;
  isComplete: boolean | null;
  markedAt: Date | null;
  markedBy: Person | null;
  selfMarked: boolean;
  studentHref?: string;
  now: Date;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const set = useMutation(trpc.submissions.setTaskCompletion.mutationOptions(settled()));

  const name = displayNameOf(student, "Unknown student");

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {studentHref ? (
              <Link href={studentHref} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {isComplete === true ? (
              <>
                Marked done
                {markedAt ? ` on ${formatDateTime(markedAt)}` : ""}
                {markedBy ? ` by ${displayNameOf(markedBy, "somebody")}` : ""}.
              </>
            ) : isComplete === false ? (
              <>
                You marked this not done
                {markedAt ? ` on ${formatDateTime(markedAt)}` : ""}. They can see that, and can mark
                it done again once they have redone it.
              </>
            ) : selfMarked ? (
              <>Nobody has marked this yet.</>
            ) : (
              <>
                Not marked yet. Fellows cannot mark this one, so they may have done it and be
                waiting on you.
              </>
            )}
          </p>

          {/*
            Both buttons always, with the standing verdict shown as the pressed one rather than
            hidden. An instructor scanning a roster needs to know which state each fellow is in,
            and a single toggle whose label changes says what pressing it would do rather than what
            is true now — which is the harder of the two to read down a list of twenty.

            Pressing the verdict that already stands is allowed and is a no-op that rewrites the
            same columns. Refusing it would be a rule to explain for no benefit.
          */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={isComplete === true ? "default" : "outline"}
              size="sm"
              disabled={set.isPending}
              onClick={() => set.mutate({ assignmentId, studentId: student.id, done: true })}
            >
              <CircleCheck data-icon="inline-start" />
              Done
            </Button>
            <Button
              variant={isComplete === false ? "destructive" : "outline"}
              size="sm"
              disabled={set.isPending}
              onClick={() => set.mutate({ assignmentId, studentId: student.id, done: false })}
            >
              <CircleSlash data-icon="inline-start" />
              Not done
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Marking it not done is what sends it back: it shows on their dashboard as needing
            another attempt, and they cannot clear it themselves. Say why below.
            {!selfMarked && " Fellows cannot mark this task at all — every verdict on it is yours."}
          </p>
        </CardContent>
      </Card>

      <TaskConversation
        assignmentId={assignmentId}
        studentId={student.id}
        studentName={name}
        now={now}
      />
    </div>
  );
}

/**
 * The thread, fetched here rather than by the pane above.
 *
 * Its own component only so the query is not made until a fellow is open — the pane is keyed on
 * the fellow, so mounting is what starts it, and an instructor stepping down a roster of twenty
 * fetches the thread they are looking at rather than twenty threads.
 */
function TaskConversation({
  assignmentId,
  studentId,
  studentName,
  now,
}: {
  assignmentId: string;
  studentId: string;
  studentName: string;
  now: Date;
}) {
  const trpc = useTRPC();
  const comments = useQuery(
    trpc.submissionComments.thread.queryOptions({ assignmentId, studentId }),
  );

  return (
    <CommentsCard
      assignmentId={assignmentId}
      studentId={studentId}
      studentName={studentName}
      thread={comments.data}
      loading={comments.isPending}
      error={comments.isError}
      onRetry={() => void comments.refetch()}
      now={now}
    />
  );
}
