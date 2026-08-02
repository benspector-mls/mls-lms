'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  ListChecks,
  RotateCcw,
  Wrench,
} from 'lucide-react';

import { AcceptAssignmentButton } from '@/components/accept-assignment-button';
import { EmptyState } from '@/components/list-states';
import { Markdown } from '@/components/markdown';
import { PageHeader } from '@/components/page-header';
import { SubmissionStatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';
import {
  formatDate,
  formatPercent,
  moduleLabel,
  moduleOrder,
  scorePercent,
  sectionLabel,
  shortSha,
} from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * A student's assignments for one course.
 *
 * Grouped by module and collapsed down to one row each, because a nine-month program
 * runs to something like fifty assignments and a page of cards is unreadable at that
 * length. A row carries only what you scan for — where it stands, what it is worth, what
 * you got, when it is due — and opens for the feedback itself.
 */

type Course = RouterOutputs['courses']['get'];
type Assignment = RouterOutputs['assignments']['listForCourse'][number];
type Submission = Assignment['submissions'][number];

export function StudentCourseDetail({
  course,
  assignments,
  githubLinked,
}: {
  course: Course;
  assignments: Assignment[];
  githubLinked: boolean;
}) {
  const modules = groupByModule(assignments, course.moduleStructure);
  const complete = assignments.filter((a) => a.submissions[0]?.isComplete).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <Link
        href="/courses"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          '-ml-2 w-fit text-muted-foreground',
        )}
      >
        <ArrowLeft data-icon="inline-start" />
        All courses
      </Link>

      <PageHeader
        title={course.name}
        description={
          assignments.length === 0
            ? course.cohortTerm
            : `${course.cohortTerm} · ${complete} of ${assignments.length} complete`
        }
      />

      {/*
        Accepting an assignment creates a repository named after the GitHub username, so
        without one the button below fails at the point of use. Said here rather than
        found there.
      */}
      {!githubLinked && (
        <Card className="border-amber-500/50">
          <CardContent className="py-4 text-sm">
            <p className="font-medium">Your GitHub account is not linked</p>
            <p className="mt-1 text-muted-foreground">
              Accepting an assignment creates a repository named after your GitHub
              username, so you need to sign in with GitHub at least once first. Sign out,
              then choose &ldquo;Sign in with GitHub&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {assignments.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No assignments yet"
          description="When your instructor publishes assignments for this course, they will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {modules.map(({ moduleTag, rows }) => (
            <ModuleSection
              key={moduleTag}
              moduleTag={moduleTag}
              assignments={rows}
              teaches={course.teaches}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Groups assignments under their module, in the order the cohort declares them.
 * `moduleOrder` handles the tags a course never declared, which would otherwise vanish.
 */
function groupByModule(assignments: Assignment[], moduleStructure: string[]) {
  const groups = new Map<string, Assignment[]>();

  for (const assignment of assignments) {
    const existing = groups.get(assignment.moduleTag);
    if (existing) existing.push(assignment);
    else groups.set(assignment.moduleTag, [assignment]);
  }

  const compare = moduleOrder(moduleStructure);

  return [...groups.keys()]
    .sort(compare)
    .map((moduleTag) => ({ moduleTag, rows: groups.get(moduleTag)! }));
}

function ModuleSection({
  moduleTag,
  assignments,
  teaches,
}: {
  moduleTag: string;
  assignments: Assignment[];
  teaches: boolean;
}) {
  const [open, setOpen] = React.useState(true);
  const complete = assignments.filter((a) => a.submissions[0]?.isComplete).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="overflow-hidden rounded-lg border border-border">
        {/*
          The heading wraps the control rather than sitting inside it: a button may only
          contain phrasing content, so an <h2> within one is invalid markup, and this is
          the shape screen readers expect from a collapsible section anyway.
        */}
        <h2>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70">
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {moduleLabel(moduleTag)}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {complete} of {assignments.length} complete
            </span>
          </CollapsibleTrigger>
        </h2>

        <CollapsibleContent>
          <ul className="divide-y divide-border border-t border-border">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                <AssignmentRow assignment={assignment} teaches={teaches} />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function AssignmentRow({
  assignment,
  teaches,
}: {
  assignment: Assignment;
  teaches: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  // listForCourse scopes the relation to the caller, so this is the student's own
  // submission or nothing at all.
  const submission = assignment.submissions[0] ?? null;
  const status = submission?.status ?? 'NOT_STARTED';

  const summary = <RowSummary assignment={assignment} submission={submission} />;

  /*
    An assignment with nothing behind it yet has nothing to expand into, so the row is
    not a control — the Accept button is, and it sits on the row where it can be pressed
    without a detour.
  */
  if (!submission || status === 'NOT_STARTED') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <span aria-hidden="true" className="size-4 shrink-0" />
        {summary}
        <AcceptAssignmentButton assignmentId={assignment.id} />
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/50">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
        />
        {summary}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-border bg-muted/20 px-3 py-4 sm:pl-10">
          <AssignmentDetail submission={submission} />

          {teaches && (
            <Link
              href={`/instructor/assignments/${assignment.id}`}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Wrench className="size-3.5" />
              Every submission for this assignment
            </Link>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The scannable part of a row, identical whether or not the row opens. */
function RowSummary({
  assignment,
  submission,
}: {
  assignment: Assignment;
  submission: Submission | null;
}) {
  const status = submission?.status ?? 'NOT_STARTED';
  const graded = submission?.finalScore != null;
  const percent = scorePercent(submission?.finalScore, submission?.finalScorePossible);

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{assignment.title}</span>

      <SubmissionStatusBadge status={status} audience="student" />

      <span className="w-24 text-right text-sm whitespace-nowrap tabular-nums sm:w-28">
        {graded ? (
          <>
            <span className="font-medium">
              {submission?.finalScore}/{submission?.finalScorePossible}
            </span>{' '}
            <span className="text-muted-foreground">{formatPercent(percent)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{assignment.pointValue} pts</span>
        )}
      </span>

      <span className="w-24 text-right text-xs whitespace-nowrap text-muted-foreground">
        {assignment.dueAt ? `Due ${formatDate(assignment.dueAt)}` : 'No due date'}
      </span>
    </>
  );
}

/**
 * What is behind a row once it opens. Everything here is student-safe: released
 * feedback, their own repository, and instructions — never a draft, a flag, or an
 * instructor note.
 */
function AssignmentDetail({ submission }: { submission: Submission }) {
  const rounds = feedbackRounds(submission);
  const revised =
    submission.gradedHeadSha != null &&
    submission.headSha != null &&
    submission.headSha !== submission.gradedHeadSha;

  return (
    <div className="flex flex-col gap-4">
      <RepoLinks submission={submission} />

      {submission.status === 'ACCEPTED' && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="mb-2 text-sm font-medium">How to submit</p>
          <ol className="ml-4 list-decimal text-sm text-muted-foreground [&>li]:mt-1">
            <li>
              Commit and push your work to the <code>draft</code> branch of your
              repository.
            </li>
            <li>
              Open a pull request from <code>draft</code> into <code>main</code>.
            </li>
            <li>Your instructor reviews the pull request and releases feedback here.</li>
          </ol>
        </div>
      )}

      {/*
        Every queue state a student can be in reads the same way, deliberately: whether a
        draft exists, failed, or was never attempted is this system's business.
      */}
      {(submission.status === 'SUBMITTED' ||
        submission.status === 'DRAFT_READY' ||
        submission.status === 'NEEDS_MANUAL_REVIEW' ||
        submission.status === 'GRADING_FAILED') && (
        <Alert>
          <Clock className="size-4" />
          <AlertTitle>Waiting on your instructor</AlertTitle>
          <AlertDescription>
            Your pull request is in. Feedback appears here once it is released.
          </AlertDescription>
        </Alert>
      )}

      {submission.status === 'RESUBMITTED' ? (
        <Alert>
          <RotateCcw className="size-4" />
          <AlertTitle>Your revision is being reviewed</AlertTitle>
          <AlertDescription>
            You asked for another look. Your most recent feedback is below; a new review
            will be added when it is ready.
          </AlertDescription>
        </Alert>
      ) : revised ? (
        <Alert>
          <RotateCcw className="size-4" />
          <AlertTitle>You have pushed changes since this feedback</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              The feedback below describes commit {shortSha(submission.gradedHeadSha)};
              your repository is now at {shortSha(submission.headSha)}. Pushing on its own
              does not ask for another review — say so when you are finished.
            </p>
            <RequestReviewButton submissionId={submission.id} />
          </AlertDescription>
        </Alert>
      ) : null}

      {rounds.length > 0 && <FeedbackHistory rounds={rounds} />}
    </div>
  );
}

/**
 * Asks for another review.
 *
 * Deliberately an explicit act rather than something a push implies. A student pushing
 * commits after a grade is ordinary — they may be tidying up, or not finished — and
 * treating every push as a request would fill the instructor's queue with work nobody
 * asked to have reviewed.
 */
function RequestReviewButton({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const router = useRouter();

  const declare = useMutation(
    trpc.submissions.declareResubmission.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={declare.isPending}
        onClick={() => declare.mutate({ submissionId })}
      >
        {declare.isPending ? 'Sending…' : 'Ask for another review'}
      </Button>
      {declare.error && (
        <p className="text-sm text-destructive" role="alert">
          {declare.error.message}
        </p>
      )}
    </div>
  );
}

function RepoLinks({ submission }: { submission: Submission }) {
  if (!submission.repoUrl && !submission.prUrl) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {submission.repoUrl && (
        <a
          href={submission.repoUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          <GitBranch data-icon="inline-start" />
          Your repository
          <ExternalLink data-icon="inline-end" />
        </a>
      )}
      {submission.prUrl && (
        <a
          href={submission.prUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          <GitPullRequest data-icon="inline-start" />
          Your pull request{submission.isLate ? ' (late)' : ''}
          <ExternalLink data-icon="inline-end" />
        </a>
      )}
    </div>
  );
}

interface FeedbackRound {
  key: string;
  number: number;
  gradedAt: Date | null;
  earned: number | null;
  possible: number | null;
  sections: {
    sectionType: string;
    reportMarkdown: string | null;
    scoreEarned: number | null;
    scorePossible: number | null;
  }[];
}

/**
 * The student's feedback history, oldest first.
 *
 * Each approved draft is one round. A resubmission is graded afresh rather than as an
 * edit of the first attempt, so the rounds accumulate and reading them in order is what
 * shows what changed.
 *
 * The fallback covers a submission graded before drafts existed, or graded by hand:
 * `feedbackMarkdown` on the submission is then the only copy of the feedback, and
 * dropping it would silently lose a student's grade.
 */
function feedbackRounds(submission: Submission): FeedbackRound[] {
  if (submission.gradingDrafts.length > 0) {
    return submission.gradingDrafts.map((draft, index) => ({
      key: draft.id,
      number: index + 1,
      gradedAt: draft.approvedAt,
      earned: sumOrNull(draft.sections.map((s) => s.scoreEarned)),
      possible: sumOrNull(draft.sections.map((s) => s.scorePossible)),
      sections: draft.sections,
    }));
  }

  if (!submission.feedbackMarkdown) return [];

  return [
    {
      key: 'submission',
      number: 1,
      gradedAt: submission.gradedAt,
      earned: submission.finalScore,
      possible: submission.finalScorePossible,
      sections: [
        {
          sectionType: 'feedback',
          reportMarkdown: submission.feedbackMarkdown,
          scoreEarned: submission.finalScore,
          scorePossible: submission.finalScorePossible,
        },
      ],
    },
  ];
}

/** Null if any part is missing, because a partial sum is worse than no total. */
function sumOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v == null)) return null;
  return values.reduce((total: number, v) => total + v!, 0);
}

function FeedbackHistory({ rounds }: { rounds: FeedbackRound[] }) {
  const latest = rounds[rounds.length - 1];

  return (
    <div className="flex flex-col gap-3">
      {rounds.map((round) => (
        <FeedbackRoundCard
          key={round.key}
          round={round}
          isLatest={round.key === latest.key}
          multiRound={rounds.length > 1}
        />
      ))}
    </div>
  );
}

function FeedbackRoundCard({
  round,
  isLatest,
  multiRound,
}: {
  round: FeedbackRound;
  isLatest: boolean;
  multiRound: boolean;
}) {
  // The most recent round is open; earlier ones collapse so the history stays readable
  // without being hidden.
  const [open, setOpen] = React.useState(isLatest);
  const percent = scorePercent(round.earned, round.possible);

  const header = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {multiRound ? `Review ${round.number}` : 'Instructor feedback'}
        </span>
        {round.gradedAt && (
          <span className="text-xs text-muted-foreground">{formatDate(round.gradedAt)}</span>
        )}
      </div>
      {round.earned != null && (
        <div className="flex items-center gap-2 text-sm whitespace-nowrap">
          <span className="font-medium tabular-nums">
            {round.earned}/{round.possible}
          </span>
          <span className="text-muted-foreground">{formatPercent(percent)}</span>
        </div>
      )}
    </div>
  );

  const body = <RoundSections round={round} />;

  if (isLatest) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-3">{header}</div>
        <Separator className="mb-3" />
        {body}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-background">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 p-4 text-left">
          {header}
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border p-4">{body}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * A round's sections. Each is scored and reported separately, so they are headed
 * separately — except where there is only one, which needs no heading to tell it apart
 * from itself.
 */
function RoundSections({ round }: { round: FeedbackRound }) {
  const single = round.sections.length === 1;

  return (
    <div className="flex flex-col gap-5">
      {round.sections.map((section) => (
        <div key={section.sectionType} className="flex flex-col gap-2">
          {!single && (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold">{sectionLabel(section.sectionType)}</h4>
              {section.scoreEarned != null && (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {section.scoreEarned}/{section.scorePossible}
                </span>
              )}
            </div>
          )}
          {section.reportMarkdown ? (
            <Markdown content={section.reportMarkdown} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No written feedback was recorded for this section.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
