import Link from "next/link";
import type * as React from "react";
import {
  Archive,
  ArrowRight,
  CircleCheck,
  Clock,
  FileText,
  Inbox,
  MessageCircleQuestion,
  MessageSquareOff,
  PencilLine,
  Sparkles,
  XCircle,
} from "lucide-react";

import { ResolveQuestionButton } from "@/components/comments/resolve-button";
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
import { gradingQueueHref, studentHref } from "@/lib/links";
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
type Waiting = Triage["awaitingReply"][number];

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

  // Not folded into `remaining`, which is spent in "N submissions left to grade".
  const waiting = triage.awaitingReply.length;

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
          // Its own clause rather than added to the figure above, because it is a different job.
          ...(waiting === 0
            ? []
            : [`${waiting} ${waiting === 1 ? "question" : "questions"} to answer`]),
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

      {/*
        First, because it is the most blocking thing here: a fellow is stopped until somebody
        answers, where work awaiting a grade is finished work sitting still.
      */}
      {waiting > 0 && <TriageQuestions rows={triage.awaitingReply} now={now} />}

      {/* Guarded on both, or the screen denies there is anything above a card full of questions. */}
      {remaining === 0 && waiting === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Nothing is waiting on you"
          description="Every submission that has been declared finished has been graded and delivered."
        />
      ) : remaining === 0 ? null : (
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

/**
 * The box every pile on this screen is drawn in. It knows nothing about buckets, which is how the
 * questions list uses it without being one.
 */
function TriageSection({
  label,
  description,
  icon: Icon,
  tone,
  accent,
  count,
  children,
}: {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  accent: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent)}
          >
            <Icon className={cn("size-5", tone)} />
          </div>
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {label}
              {/*
                Submissions, not assignments. This is the figure the whole screen is counted in,
                and it stays the count of rows even though the rows beneath are now grouped —
                otherwise a bucket holding twelve submissions across four assignments would read
                as four pieces of work outstanding.
              */}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Threads where a fellow asked something and nobody has answered.
 *
 * A list of its own rather than a bucket: `triageBucket` returns one value per submission, and work
 * can need a report and hold a question at once.
 *
 * Teal, because the buckets have taken the other colours and emerald means a pass.
 */
function TriageQuestions({ rows, now }: { rows: Waiting[]; now: Date }) {
  return (
    <TriageSection
      label="Unread comments"
      description="A fellow asked something and nobody has answered."
      icon={MessageCircleQuestion}
      tone="text-teal-600 dark:text-teal-400"
      accent="bg-teal-500/10"
      count={rows.length}
    >
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <QuestionRow key={row.submissionId} row={row} now={now} />
        ))}
      </div>
    </TriageSection>
  );
}

/**
 * One person waiting on one answer.
 *
 * A row per question rather than per assignment, unlike `AssignmentRow`: grouping would throw away
 * both the asker and what they asked.
 *
 * **It opens the fellow's record, not the grading queue.** The queue drops `NOT_STARTED` rows and
 * falls back to the first of its list, so a question asked before anything was handed in would
 * open a different fellow's report under a URL naming this one.
 */
function QuestionRow({ row, now }: { row: Waiting; now: Date }) {
  return (
    /*
      A link with a button beside it rather than a link containing one, which is not allowed and
      would swallow the press. The hover treatment moves out here so both halves still light up as
      one row.
    */
    <div className="flex items-center gap-2 rounded-lg border border-transparent pr-3 transition-colors hover:border-border hover:bg-muted/50">
      <Link
        href={studentHref(row.assignment.courseId, row.student.id, row.submissionId)}
        className="flex min-w-0 flex-1 items-center gap-4 px-3 py-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium">{row.askedBy}</p>
            {row.team && (
              <span className="shrink-0 text-xs text-muted-foreground">{row.team.name}</span>
            )}
            {row.student.testStudentNumber !== null && <TestStudentBadge />}
            {/* How many have piled up since the last thing an instructor said. */}
            {row.waitingCount > 1 && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {row.waitingCount}
              </span>
            )}
          </div>
          {/*
          The question itself, because the assignment alone does not say whether this is thirty
          seconds or a conversation. One line: the answer is written on the other screen.
        */}
          <p className="truncate text-sm text-muted-foreground">
            {row.assignment.title} — {row.excerpt}
          </p>
        </div>

        <div className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground sm:flex">
          <Clock className="size-3.5" />
          {formatRelative(row.lastCommentAt, now)}
        </div>

        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>

      {/*
        Answering is not the only way a question stops waiting: some are settled in person, and some
        the fellow works out before anybody reads this. Clearing one from here means not opening it
        to write a reply that says nothing.
      */}
      <ResolveQuestionButton submissionId={row.submissionId} resolved={false} size="icon" />
    </div>
  );
}

function TriageBucket({ bucketKey, rows, now }: { bucketKey: BucketKey; rows: Row[]; now: Date }) {
  const meta = BUCKET_META[bucketKey];
  const groups = groupByAssignment(rows);

  return (
    <TriageSection
      label={meta.label}
      description={meta.description}
      icon={meta.icon}
      tone={meta.tone}
      accent={meta.accent}
      count={rows.length}
    >
      <>
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
      </>
    </TriageSection>
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
