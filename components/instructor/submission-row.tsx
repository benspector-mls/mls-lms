"use client";

import Link from "next/link";
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
 * Only the label differs, so the label and where it leads are the props. The caller says who or
 * what this row is about; the row says what state it is in.
 */

type QueueRow = RouterOutputs["submissions"]["listForAssignment"]["submissions"][number];

export function SubmissionRow({
  row,
  primary,
  primaryHref,
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
   * Where the label leads, when what it names has a screen of its own.
   *
   * Each of the two screens sends its labels to the other's axis. The grading queue's rows are
   * fellows, and a name there leads to that fellow's record in this course; a fellow's record is
   * a list of assignments, and a title there leads to that assignment's queue. So the label is
   * the way from either screen to the one that crosses it, and an instructor reading one student
   * down the page can turn at any row and read that assignment across the cohort instead.
   */
  primaryHref?: string;
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
    <li className="relative">
      {/*
        Selecting the row, drawn as a layer behind the content rather than wrapped around it.

        A link inside a button is not valid HTML, and a browser given one has no way to decide
        which of the two a click meant. Sibling elements settle it: the button fills the row and
        takes every click, and the one link above it takes the clicks on the name.
      */}
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open ${primary}`}
        className={cn(
          "absolute inset-0 rounded-md border transition-colors",
          active
            ? "border-primary/40 bg-primary/5"
            : "border-transparent hover:border-border hover:bg-muted/50",
        )}
      />
      {/*
        Transparent to the pointer, so that everything drawn here — badges, the score, the line
        saying when the work last moved — passes its clicks down to the button beneath. The name
        below takes its own back.
      */}
      <div className="pointer-events-none relative flex flex-col gap-2 px-3 py-2.5 text-left">
        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              {primaryHref ? (
                <Link href={primaryHref} className="pointer-events-auto hover:underline">
                  {primary}
                </Link>
              ) : (
                primary
              )}
            </span>
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
              lives in `draftStatusAddsSomething` rather than inline, with the row as its one
              reader.
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
      </div>
    </li>
  );
}
