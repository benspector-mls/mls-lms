import Link from "next/link";
import type * as React from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CircleCheck,
  Clock,
  FileClock,
  FileText,
  Inbox,
  Loader2,
  MessageSquareOff,
  PencilLine,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { FlagBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GroupPicker } from "@/components/instructor/group-picker";
import { groupSelectionLabel, parseGroupSelection } from "@/lib/courses/groups";
import { gradingQueueHref } from "@/lib/links";
import { flagMeta, formatRelative, scoreLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * What is waiting on the instructor in one cohort.
 *
 * Organized by what to do about it rather than by assignment, because the question this
 * screen answers is "what next". The buckets together are the whole of the outstanding
 * grading: everything a student has declared finished and nobody has approved is in one of
 * them, so clearing them is being caught up.
 *
 * One cohort at a time, which is what makes "caught up" mean anything. Two terms' work
 * interleaved has no state in which the screen is empty and no order in which to work it.
 */

type Triage = RouterOutputs["submissions"]["triage"];
type Row = Triage["submissions"][number];

/**
 * The buckets that represent work. `generating` is not among them — a run already in
 * flight needs waiting on rather than doing, and it sits at the foot of the screen.
 */
type BucketKey =
  | "needs_report"
  | "needs_manual_grade"
  | "draft_ready"
  | "needs_manual_review"
  | "grading_failed"
  | "comment_not_posted";

/** Every bucket that counts toward "how much is left", in the order they are worked. */
const WORK_BUCKETS: BucketKey[] = [
  "needs_report",
  "needs_manual_grade",
  "draft_ready",
  "needs_manual_review",
  "grading_failed",
  "comment_not_posted",
];

const BUCKET_META: Record<
  BucketKey,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    accent: string;
  }
> = {
  needs_report: {
    label: "No report yet",
    description:
      "Submitted work with no current report. Generating one is the first step; a draft describing code the student has since replaced counts as none.",
    icon: FileText,
    tone: "text-sky-600 dark:text-sky-400",
    accent: "bg-sky-500/10",
  },
  needs_manual_grade: {
    label: "To grade by hand",
    description:
      "Submitted work on an assignment the pipeline cannot grade — a document or an upload. Read the work, write the feedback, and release it the same way.",
    icon: PencilLine,
    tone: "text-violet-600 dark:text-violet-400",
    accent: "bg-violet-500/10",
  },
  draft_ready: {
    label: "Drafts ready to review",
    description: "A report was produced. Read it, edit what you disagree with, then approve.",
    icon: Sparkles,
    tone: "text-primary",
    accent: "bg-primary/10",
  },
  /*
    Distinct from `needs_manual_grade` above, and the labels have to keep them apart: this
    is a report that exists and cannot be trusted, where that one is an assignment that was
    never going to have a report at all. Conflating them would tell an instructor to check a
    cross-check finding that does not exist.
  */
  needs_manual_review: {
    label: "Held for review",
    description:
      "A report was produced but something in it could not be verified, so it is held rather than offered for approval. Check it before releasing.",
    icon: AlertTriangle,
    tone: "text-amber-600 dark:text-amber-400",
    accent: "bg-amber-500/10",
  },
  grading_failed: {
    label: "Grading failed",
    description: "The pipeline errored before producing a report. Run it again or grade by hand.",
    icon: XCircle,
    tone: "text-destructive",
    accent: "bg-destructive/10",
  },
  comment_not_posted: {
    label: "Approved, never delivered",
    description:
      "The grade is recorded but the comment never reached the pull request, so the student has not been told. Post it again.",
    icon: MessageSquareOff,
    tone: "text-amber-600 dark:text-amber-400",
    accent: "bg-amber-500/10",
  },
};

export function TriageOverview({
  triage,
  courseId,
  courseName,
  cohortTerm,
  archived,
  groups,
  now,
}: {
  triage: Triage;
  /*
    Not used for the links out of this screen — each row carries its own assignment's course,
    which is the right source because it comes from the row rather than from the address the
    screen was opened at. It is here for the picker, which records a selection against a course
    rather than against a submission.
  */
  courseId: string;
  courseName: string;
  cohortTerm: string;
  archived: boolean;
  /** The picker's options and the selection this pile was built for, from `resolveGroup`. */
  groups: {
    group: string;
    groups: { id: string; name: string; memberCount: number }[];
    ungroupedCount: number;
  };
  /**
   * Passed in rather than read here, so every relative time on the screen is measured
   * from one instant and a component cannot disagree with its neighbour.
   */
  now: Date;
}) {
  const selection = parseGroupSelection(groups.group);
  const buckets = bucketize(triage.submissions);
  const generating = triage.submissions.filter((row) => row.bucket === "generating");

  // The whole of what is left. Every bucket counts toward it, so the number at the top
  // of the screen and the piles below it are the same claim stated two ways.
  const remaining = WORK_BUCKETS.reduce((total, key) => total + buckets[key].length, 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      {/*
        The cohort in the title, not the instructor's own name. Two cohorts' triage screens
        are otherwise indistinguishable, and telling a reader who they are is the one fact on
        the screen they already had.
      */}
      <PageHeader
        title="Grading triage"
        description={[
          `${courseName} · ${cohortTerm}`,
          /*
            The group, whenever the pile is not the whole cohort. Every figure beside it counts
            the selected students only, so a screen that said "Caught up" without naming what it
            was caught up on would be making a claim about the cohort that it has not checked.
          */
          ...(selection.kind === "all" ? [] : [groupSelectionLabel(selection, groups.groups)]),
          remaining === 0
            ? "Caught up"
            : `${remaining} ${remaining === 1 ? "submission" : "submissions"} left to grade`,
          `${triage.gradedCount} approved`,
        ].join(" · ")}
        /*
          The picker is the only action. There was a button back to the course page, which existed
          because the cohort's other views were tabs on it and this screen was the one place
          outside; every one of them is a sidebar item now, so it led to the one address that is
          not a view at all.
        */
        actions={
          <GroupPicker
            courseId={courseId}
            value={groups.group}
            groups={groups.groups}
            ungroupedCount={groups.ungroupedCount}
          />
        }
      />

      {/*
        Otherwise an archived cohort reads as caught up, which is a different claim and a
        false one. Empty here because the work is finished being waited on, not because it
        was done.
      */}
      {archived && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            This cohort is archived, so nothing here is waiting on you. Its submissions and feedback
            stay readable in the gradebook and in every assignment&apos;s own queue.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/*
          The first card covers both ways of having no usable report — one waiting on the
          pipeline, one waiting on a person — because the summary answers "how much is
          untouched" and the piles below say which kind. Four cards for six buckets is
          deliberate: this row was never exhaustive, and the count in the header is.
        */}
        <StatCard
          label="Not graded yet"
          value={buckets.needs_report.length + buckets.needs_manual_grade.length}
          icon={FileText}
          tone="text-sky-600 dark:text-sky-400"
        />
        <StatCard
          label="Ready to review"
          value={buckets.draft_ready.length}
          icon={Sparkles}
          tone="text-primary"
        />
        <StatCard
          label="Held for review"
          value={buckets.needs_manual_review.length}
          icon={AlertTriangle}
          tone="text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="Failed runs"
          value={buckets.grading_failed.length}
          icon={XCircle}
          tone="text-destructive"
        />
      </div>

      {remaining === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Nothing is waiting on you"
          description="Every submission that has been declared finished has been graded and delivered."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/*
            Ordered as the work is done: everything without a report, then everything with
            one to read, then the two ways a run can end badly. The cards for those last
            two are usually empty and sit side by side so they take one row rather than
            two.
          */}
          <TriageBucket bucketKey="needs_report" rows={buckets.needs_report} now={now} />
          {/*
            Only when it has something in it. A course with no hand-graded assignments would
            otherwise show a permanently empty pile for a kind of work it never has.
          */}
          {buckets.needs_manual_grade.length > 0 && (
            <TriageBucket
              bucketKey="needs_manual_grade"
              rows={buckets.needs_manual_grade}
              now={now}
            />
          )}
          <TriageBucket bucketKey="draft_ready" rows={buckets.draft_ready} now={now} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TriageBucket
              bucketKey="needs_manual_review"
              rows={buckets.needs_manual_review}
              now={now}
            />
            <TriageBucket bucketKey="grading_failed" rows={buckets.grading_failed} now={now} />
          </div>
          {/*
            Rendered only when it has something in it. An empty "approved, never
            delivered" card reads as a warning on a screen where every other empty card
            reads as being caught up.
          */}
          {buckets.comment_not_posted.length > 0 && (
            <TriageBucket
              bucketKey="comment_not_posted"
              rows={buckets.comment_not_posted}
              now={now}
            />
          )}
        </div>
      )}

      {/*
        Runs already in flight. Below the fold and outside the count on purpose: they are
        neither work remaining nor work done, and nothing about them needs deciding.
      */}
      {generating.length > 0 && (
        <>
          <Separator />
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-medium">Reports being generated</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {generating.length}
              </span>
            </div>
            <Card>
              <CardContent className="flex flex-col gap-1 py-2">
                {generating.map((row) => (
                  <TriageRow key={row.id} row={row} now={now} />
                ))}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Files rows under the bucket the procedure assigned. The decision is made there, once,
 * so a card's count and the rows inside it cannot come from two different readings.
 */
function bucketize(rows: Row[]): Record<BucketKey, Row[]> {
  const buckets: Record<BucketKey, Row[]> = {
    needs_report: [],
    needs_manual_grade: [],
    draft_ready: [],
    needs_manual_review: [],
    grading_failed: [],
    comment_not_posted: [],
  };

  for (const row of rows) {
    if (row.bucket && row.bucket in buckets) buckets[row.bucket as BucketKey].push(row);
  }

  return buckets;
}

function TriageBucket({ bucketKey, rows, now }: { bucketKey: BucketKey; rows: Row[]; now: Date }) {
  const meta = BUCKET_META[bucketKey];
  const Icon = meta.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              meta.accent,
            )}
          >
            <Icon className={cn("size-5", meta.tone)} />
          </div>
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {meta.label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            </CardTitle>
            <CardDescription className="mt-1">{meta.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-6 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            Nothing here.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <TriageRow key={row.id} row={row} now={now} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TriageRow({ row, now }: { row: Row; now: Date }) {
  const draft = row.activeDraft;

  /*
    Only the flags an instructor has to decide about. The rest — mechanical errors,
    imprecise terminology — say points were lost, which is what grading is for and not a
    reason to look at one submission before another.
  */
  const faults = draft
    ? [...new Set(draft.sections.flatMap((s) => s.flags))].filter((code) => flagMeta(code).fault)
    : [];

  const lowConfidence = draft?.sections.some((s) => s.confidence === "LOW") ?? false;

  // Two columns compared, no API call: the student has pushed past what was graded.
  const revised =
    row.gradedHeadSha != null && row.headSha != null && row.headSha !== row.gradedHeadSha;

  // Not shown for an out-of-date draft: a number proposed against code the student has
  // replaced is worse than no number, because it reads as this submission's score.
  const suggested =
    draft && !row.draftIsStale
      ? draft.sections.reduce(
          (total, section) => ({
            earned: total.earned + (section.editedScoreEarned ?? section.scoreEarned ?? 0),
            possible: total.possible + (section.scorePossible ?? 0),
          }),
          { earned: 0, possible: 0 },
        )
      : null;

  return (
    <Link
      href={gradingQueueHref(row.assignment.courseId, row.assignment.id, row.id)}
      className="flex items-center gap-4 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-muted/50"
    >
      <Avatar className="size-9">
        <AvatarFallback className="text-xs">{initialsOf(row.student.displayName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {row.student.displayName ?? row.student.email ?? "Unknown student"}
        </p>
        <p className="truncate text-sm text-muted-foreground">{row.assignment.title}</p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:mt-0">
          {row.bucket === "generating" && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Loader2 className="size-3" />
              Generating
            </span>
          )}

          {faults.slice(0, 3).map((code) => (
            <FlagBadge key={code} code={code} />
          ))}
          {lowConfidence && <FlagBadge code="LOW_CONFIDENCE" />}

          {/*
            Why this row is queued rather than ready: the report describes code the
            student has since replaced, and approving it would be refused.
          */}
          {row.draftIsStale && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <FileClock className="size-3" />
              Draft is out of date
            </span>
          )}

          {revised && !row.draftIsStale && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <RotateCcw className="size-3" />
              Revised
            </span>
          )}

          {row.isLate && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Late
            </span>
          )}
        </div>
      </div>

      {suggested && suggested.possible > 0 && (
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium tabular-nums">
            {scoreLabel(suggested.earned, suggested.possible)}
          </p>
          <p className="text-xs text-muted-foreground">proposed</p>
        </div>
      )}

      <div className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground sm:flex">
        <Clock className="size-3.5" />
        {formatRelative(row.lastActivityAt ?? row.submittedAt, now)}
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <Icon className={cn("size-5", tone)} />
        <div>
          <p className="text-2xl leading-none font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
