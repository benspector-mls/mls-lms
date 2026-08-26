"use client";

import { Loader2, MessageSquare } from "lucide-react";

import { DraftStatusBadge, SubmissionStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { completionMeta, draftStatusAddsSomething, formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One selectable submission in a two-pane list.
 *
 * Shared by the two screens that read a grid of submissions along one axis: the grading queue,
 * which is one assignment across many students, and a student's overview, which is one student
 * across many assignments. **Everything to the right of the label is identical on both**, which is
 * the reason this is one component — a status badge, a stale-report flag, an undelivered flag and a
 * score rendered two ways would drift, and the difference would read as one screen being wrong.
 *
 * Only the label differs, so only the label is a prop. The caller says who or what this row is
 * about; the row says what state it is in.
 */

type QueueRow = RouterOutputs["submissions"]["listForAssignment"]["submissions"][number];

export function SubmissionRow({
  row,
  primary,
  secondary,
  active,
  onSelect,
  now,
  pending = false,
}: {
  row: QueueRow;
  /** Who or what this row is about — a student's name, or an assignment's title. */
  primary: string;
  /**
   * Under it. The queue shows when the submission last moved; a student's overview shows the
   * module, because forty rows all saying "3 days ago" order nothing.
   */
  secondary?: string;
  active: boolean;
  onSelect: () => void;
  now: Date;
  /**
   * A report is being generated for this row *right now*, by a batch running in this browser.
   *
   * The same fact as the `GENERATING` draft badge below, arriving sooner. Both screens are
   * server-rendered with their list passed down as a prop, so nothing on the row changes until
   * the batch finishes and refreshes — without this, twenty rows would sit unchanged for several
   * minutes and the run would look like it had not started.
   */
  pending?: boolean;
}) {
  const draft = row.activeDraft;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
          active
            ? "border-primary/40 bg-primary/5"
            : "border-transparent hover:border-border hover:bg-muted/50",
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{primary}</span>
            <span className="truncate text-xs text-muted-foreground">
              {secondary ?? formatRelative(row.lastActivityAt ?? row.submittedAt, now)}
            </span>
          </div>
          {/*
            The released grade, right-aligned so the column of scores can be read straight
            down the list without opening each submission. Only a grade that has actually
            gone out is shown here — a superseded score belongs to a report nobody reads
            anymore.
          */}

          {row.status === "GRADED" && row.finalScore != null && (
            <span
              className={cn(
                "shrink-0 text-sm font-semibold tabular-nums",
                // From `completionMeta`, so this screen, the review pane, and the student's own
                // page cannot disagree about what green means or which shade of it.
                completionMeta(row.isComplete)?.className,
              )}
            >
              {row.finalScore}/{row.finalScorePossible}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SubmissionStatusBadge status={row.status} />
          {pending && (
            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Generating
            </Badge>
          )}
          {/*
              The draft's own state, where it says anything the submission's does not —
              generating a report does not move the submission, only approving does. The rule
              lives in `draftStatusAddsSomething` so this screen and the review header cannot
              disagree about it.
            */}
          {draft && draftStatusAddsSomething(draft.status) && (
            <DraftStatusBadge status={draft.status} />
          )}
          {row.draftIsStale && (
            <Badge
              variant="outline"
              className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
            >
              Report out of date
            </Badge>
          )}
          {row.bucket === "comment_not_posted" && (
            <Badge
              variant="outline"
              className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
            >
              Not delivered
            </Badge>
          )}
          {/*
            That there is a conversation, and whether it is waiting. Teal when somebody is owed an
            answer, matching the questions section on the triage screen; muted once it is not, so a
            row still says a record is there without asking to be acted on.
          */}
          {row.commentCount > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1 font-normal",
                row.commentsAwaitReply
                  ? "border-teal-500/40 text-teal-700 dark:text-teal-300"
                  : "text-muted-foreground",
              )}
            >
              <MessageSquare className="size-3" />
              <span className="tabular-nums">{row.commentCount}</span>
              <span className="sr-only">
                {row.commentsAwaitReply ? " comments, waiting on a reply" : " comments"}
              </span>
            </Badge>
          )}
        </div>
      </button>
    </li>
  );
}
