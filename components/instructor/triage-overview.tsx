import Link from "next/link";
import type * as React from "react";
import {
  Archive,
  ArrowRight,
  CircleCheck,
  Clock,
  FileText,
  Inbox,
  MessageSquareOff,
  PencilLine,
  Sparkles,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import {
  cohortSelectionLabel,
  parseCohortSelection,
  type CohortChoice,
} from "@/lib/programs/cohorts";
import { groupByAssignment, nameSubtext, type AssignmentGroup } from "@/lib/grade/triage-groups";
import { gradingQueueHref } from "@/lib/links";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * What is waiting on the instructor in one course.
 *
 * Organized by what to do about it rather than by assignment, because the question this
 * screen answers is "what next". The buckets together are the whole of the outstanding
 * grading: everything a student has declared finished and nobody has approved is in one of
 * them, so clearing them is being caught up.
 *
 * One course at a time, which is what makes "caught up" mean anything. Two courses' work
 * interleaved has no state in which the screen is empty and no order in which to work it.
 * The cohort picker narrows it further, to the fellows one instructor grades.
 */

type Triage = RouterOutputs["submissions"]["triage"];
type Row = Triage["submissions"][number];

/**
 * The buckets that represent work. `generating` is not among them — a run already in
 * flight needs waiting on rather than doing, and it sits at the foot of the screen.
 */
type BucketKey =
  "needs_report" | "needs_manual_grade" | "draft_ready" | "grading_failed" | "comment_not_posted";

/** Every bucket that counts toward "how much is left", in the order they are worked. */
const WORK_BUCKETS: BucketKey[] = [
  "needs_report",
  "needs_manual_grade",
  "draft_ready",
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
  courseName,
  term,
  archived,
  cohorts,
  now,
}: {
  triage: Triage;
  courseName: string;
  /** The program's term, "Fall 2026". The heading names it beside the course. */
  term: string;
  archived: boolean;
  /** The picker's options and the selection this pile was built for, from `resolveCohort`. */
  cohorts: CohortChoice;
  /**
   * Passed in rather than read here, so every relative time on the screen is measured
   * from one instant and a component cannot disagree with its neighbour.
   */
  now: Date;
}) {
  const selection = parseCohortSelection(cohorts.cohort);
  const buckets = bucketize(triage.submissions);
  const generating = triage.submissions.filter((row) => row.bucket === "generating");

  // The whole of what is left. Every bucket counts toward it, so the number at the top
  // of the screen and the piles below it are the same claim stated two ways.
  const remaining = WORK_BUCKETS.reduce((total, key) => total + buckets[key].length, 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      {/*
        The course and its term in the title, not the instructor's own name. Two courses' triage
        screens are otherwise indistinguishable, and telling a reader who they are is the one fact
        on the screen they already had.
      */}
      <PageHeader
        title="Grading triage"
        description={[
          `${courseName} · ${term}`,
          /*
            The cohort, whenever the pile is not the whole roster. Every figure beside it counts
            the selected fellows only, so a screen that said "Caught up" without naming what it
            was caught up on would be making a claim about the roster that it has not checked.
          */
          ...(selection.kind === "all" ? [] : [cohortSelectionLabel(selection, cohorts.cohorts)]),
          remaining === 0
            ? "Caught up"
            : `${remaining} ${remaining === 1 ? "submission" : "submissions"} left to grade`,
          `${triage.gradedCount} approved`,
        ].join(" · ")}
        /*
          The picker is the only action. There was a button back to the course page, which existed
          because the course's other views were tabs on it and this screen was the one place
          outside; every one of them is a sidebar item now, so it led to the one address that is
          not a view at all.
        */
        actions={<CohortPicker choice={cohorts} />}
      />

      {/*
        Otherwise an archived course reads as caught up, which is a different claim and a
        false one. Empty here because the work is finished being waited on, not because it
        was done.
      */}
      {archived && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            This course is archived, so nothing here is waiting on you. Its submissions and feedback
            stay readable in the gradebook and in every assignment&apos;s own queue.
          </p>
        </div>
      )}

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
          <TriageBucket bucketKey="needs_report" rows={buckets.needs_report} now={now} />
          <TriageBucket bucketKey="draft_ready" rows={buckets.draft_ready} now={now} />
          <TriageBucket bucketKey="grading_failed" rows={buckets.grading_failed} now={now} />
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
                {/* Grouped the same way the buckets are, so one screen has one kind of row. */}
                {groupByAssignment(generating).map((group) => (
                  <AssignmentRow key={group.assignmentId} group={group} now={now} />
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
  const groups = groupByAssignment(rows);

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
              {/*
                Submissions, not assignments. This is the figure the whole screen is counted in,
                and it stays the count of rows even though the rows beneath are now grouped —
                otherwise a bucket holding twelve submissions across four assignments would read
                as four pieces of work outstanding.
              */}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            </CardTitle>
            <CardDescription className="mt-1">{meta.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-6 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            Nothing here.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((group) => (
              <AssignmentRow key={group.assignmentId} group={group} now={now} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One assignment inside a bucket: its title, how many are waiting, and who they are.
 *
 * **A row per assignment rather than per submission**, because that is the unit of work. Opening
 * it goes to the assignment's grading queue with nothing selected, which is where the twelve are
 * worked through one after another — naming a submission here would pick one of them arbitrarily
 * and then require going back for the rest.
 *
 * The names are the reason this stays scannable: an instructor looking for whether a particular
 * student is in the pile can see it without opening the assignment, and past three names the list
 * stops being scannable and becomes a paragraph.
 */
function AssignmentRow({ group, now }: { group: AssignmentGroup<Row>; now: Date }) {
  const anyTestStudent = group.rows.some((row) => row.student.testStudentNumber !== null);
  const anyLate = group.rows.some((row) => row.isLate);
  /*
    So a pile of work says which of it is a second round. Grading a revision is a different job
    from grading a first submission — the previous report and score are what the new one is
    written against — and the row is the last place an instructor sees before opening the queue.
  */
  const anyRevised = group.rows.some((row) => row.status === "RESUBMITTED");

  /*
    The most recent thing that happened across the whole group, which is what "how stale is this
    pile" means once the rows are one row. The oldest would name the submission that has waited
    longest, which is a different and less useful question here — the pile is worked as a unit.
  */
  const lastActivity = group.rows.reduce<Date | null>((latest, row) => {
    const at = row.lastActivityAt ?? row.submittedAt;
    if (at == null) return latest;
    const when = new Date(at);
    return latest === null || when > latest ? when : latest;
  }, null);

  return (
    <Link
      href={gradingQueueHref(group.courseId, group.assignmentId)}
      className="flex items-center gap-4 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{group.title}</p>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {group.rows.length}
          </span>
          {/* So a pile of work to grade says which of it is a rehearsal. */}
          {anyTestStudent && <TestStudentBadge />}
          {anyRevised && (
            <span className="shrink-0 rounded-md border border-violet-500/40 px-2 py-0.5 text-xs text-violet-600 dark:text-violet-400">
              Resubmitted
            </span>
          )}
          {anyLate && (
            <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Late
            </span>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">{nameSubtext(group.studentNames)}</p>
      </div>

      <div className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground sm:flex">
        <Clock className="size-3.5" />
        {lastActivity ? formatRelative(lastActivity, now) : "—"}
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
