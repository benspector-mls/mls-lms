'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  ExternalLink,
  FileText,
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
import { AssignmentKindBadge, SubmissionStatusBadge } from '@/components/status-badge';
import { UploadedFileRow } from '@/components/uploaded-file';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { isLinkSubmitted } from '@/lib/assignments/spec';
import type { AssignmentKind } from '@/lib/generated/prisma/enums';
import { gradingQueueHref } from '@/lib/links';
import {
  acceptAttributeFor,
  checkUpload,
  describeAcceptedTypes,
  formatBytes,
  MAX_UPLOAD_BYTES,
} from '@/lib/uploads/file-types';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';
import {
  completionMeta,
  formatDate,
  formatPercent,
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
  const modules = groupByModule(course, assignments);
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

      {modules.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No assignments yet"
          description="When your instructor publishes assignments for this course, they will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {modules.map(({ id, name, rows }) => (
            <ModuleSection
              key={id}
              name={name}
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
 * Every module of the course, in the order the instructor set, with its assignments under it.
 *
 * **Built from the course's modules rather than from the assignments**, so a module a student
 * has nothing in yet still appears. That is the point: the module list is the shape of the
 * course, and a student should be able to see what is coming rather than only what has been
 * handed out. A module whose assignments are all still drafts looks empty to them and full to
 * the instructor, which is what `distributedAt` is for.
 *
 * An assignment whose module is somehow not in the list is still shown, under that module, so
 * nothing can go missing from a student's page because of a data problem they cannot see.
 */
function groupByModule(course: Course, assignments: Assignment[]) {
  const groups = new Map<string, { id: string; name: string; position: number; rows: Assignment[] }>();

  for (const row of course.modules) {
    groups.set(row.id, { ...row, rows: [] });
  }

  for (const assignment of assignments) {
    const existing = groups.get(assignment.module.id);
    if (existing) existing.rows.push(assignment);
    else groups.set(assignment.module.id, { ...assignment.module, rows: [assignment] });
  }

  return [...groups.values()].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
}

function ModuleSection({
  name,
  assignments,
  teaches,
}: {
  name: string;
  assignments: Assignment[];
  teaches: boolean;
}) {
  // Collapsed when there is nothing in it. A module with no assignments yet is worth seeing in
  // the list and not worth taking up space open.
  const [open, setOpen] = React.useState(assignments.length > 0);
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
              {name}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {assignments.length === 0
                ? 'Nothing yet'
                : `${complete} of ${assignments.length} complete`}
            </span>
          </CollapsibleTrigger>
        </h2>

        <CollapsibleContent>
          {assignments.length === 0 ? (
            <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
              Nothing has been handed out for this module yet.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {assignments.map((assignment) => (
                <li key={assignment.id}>
                  <AssignmentRow assignment={assignment} teaches={teaches} />
                </li>
              ))}
            </ul>
          )}
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

  const summary = (
    <RowSummary
      assignment={assignment}
      submission={submission}
      // Rendered inside the left half rather than appended to the row, so a row with a
      // button has the same right-hand columns as one without.
      action={
        !submission || status === 'NOT_STARTED' ? (
          // Neither of these has anything to hand out, so there is nothing for Accept to do.
          assignment.kind === 'FILE_UPLOAD' || assignment.kind === 'EXTERNAL_URL' ? null : (
            <AcceptAssignmentButton assignmentId={assignment.id} kind={assignment.kind} />
          )
        ) : null
      }
    />
  );

  /*
    An assignment with nothing behind it yet has nothing to expand into, so the row is
    not a control — the Accept button is, and it sits on the row where it can be pressed
    without a detour.

    FILE_UPLOAD has no Accept at all: there is no template and nothing to hand out, so the
    first thing that happens to it is the student submitting. Its row therefore opens like
    any other rather than carrying a button, and what it opens into says so.
  */
  if ((!submission || status === 'NOT_STARTED') && assignment.kind !== 'FILE_UPLOAD') {
    return (
      <div className="flex items-center gap-x-3 px-3 py-2.5">
        <span aria-hidden="true" className="size-4 shrink-0" />
        {summary}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* Not wrapping: the two halves keep their columns in line, and a wrap would let the
          right-hand group drop under the title on one row and not the next. */}
      <CollapsibleTrigger className="group flex w-full items-center gap-x-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
        />
        {summary}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-border bg-muted/20 px-3 py-4 sm:pl-10">
          <AssignmentDetail assignment={assignment} submission={submission} />

          {teaches && (
            <Link
              href={gradingQueueHref(assignment.courseId, assignment.id)}
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

/**
 * The scannable part of a row, identical whether or not the row opens.
 *
 * Two halves, and that is the whole point of the shape. The left half holds what varies in
 * length — the title, and a button on the rows that have one — and the right half holds the
 * three columns being scanned down. Laying all five out as siblings put the button in the
 * middle of the row, so every row with one shifted its status, score, and due date out of
 * line with the rows above it. Anything added to a row from now on belongs on the left.
 */
function RowSummary({
  assignment,
  submission,
  action,
}: {
  assignment: Assignment;
  submission: Submission | null;
  /** Sits beside the title. Absent on most rows. */
  action?: React.ReactNode;
}) {
  const status = submission?.status ?? 'NOT_STARTED';
  const graded = submission?.finalScore != null;
  const percent = scorePercent(submission?.finalScore, submission?.finalScorePossible);
  // Null until something is graded, so an ungraded row cannot read as "Incomplete".
  const verdict = graded ? completionMeta(submission?.isComplete) : null;

  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{assignment.title}</span>
        {/*
          What they are handing in, which decides what they do next: push and open a pull
          request, take a copy of a document, or upload a file. Worth knowing before the row is
          opened, and hidden on the narrowest screens where the title needs the width more.
        */}
        <AssignmentKindBadge kind={assignment.kind} className="hidden sm:inline-flex" />
        {action}
      </span>

      {/*
        Fixed widths and right-aligned, so every boundary in this group lands in the same
        place on every row. The badge's own width varies with its label — "Awaiting another
        review" against "Graded" — so it is placed first, where the columns to its right pin
        the edge that is read down the list.
      */}
      <span className="flex shrink-0 items-center gap-x-3">
        <SubmissionStatusBadge status={status} audience="student" />

        {/*
          The score carries the verdict, because it is the number a student looks for and the
          pill beside it deliberately does not say it — "Graded" is blue, and green means
          "complete" here and nowhere else.

          Colour is not the only signal. An icon gives it a shape, and the word itself is read
          out to a screen reader, because red against green is the one pair a colourblind
          student is least likely to distinguish.
        */}
        <span
          className={cn(
            'flex w-24 items-center justify-end gap-1 text-right text-sm whitespace-nowrap tabular-nums sm:w-28',
            verdict?.className,
          )}
        >
          {graded ? (
            <>
              {verdict &&
                (submission?.isComplete ? (
                  <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <CircleSlash aria-hidden="true" className="size-3.5 shrink-0" />
                ))}
              {verdict && <span className="sr-only">{verdict.label}. </span>}
              <span className="font-medium">
                {submission?.finalScore}/{submission?.finalScorePossible}
              </span>
              <span className={verdict ? undefined : 'text-muted-foreground'}>
                {formatPercent(percent)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{assignment.pointValue} pts</span>
          )}
        </span>

        <span className="w-24 text-right text-xs whitespace-nowrap text-muted-foreground">
          {assignment.dueAt ? `Due ${formatDate(assignment.dueAt)}` : 'No due date'}
        </span>
      </span>
    </>
  );
}

/**
 * What is behind a row once it opens. Everything here is student-safe: released
 * feedback, their own repository, and instructions — never a draft, a flag, or an
 * instructor note.
 *
 * `submission` is null for a FILE_UPLOAD assignment nobody has started, because that kind
 * has no Accept to create the row.
 */
function AssignmentDetail({
  assignment,
  submission,
}: {
  assignment: Assignment;
  submission: Submission | null;
}) {
  const rounds = submission ? feedbackRounds(submission) : [];
  const status = submission?.status ?? 'NOT_STARTED';
  const revised =
    submission != null &&
    submission.gradedHeadSha != null &&
    submission.headSha != null &&
    submission.headSha !== submission.gradedHeadSha;

  const inQueue =
    status === 'SUBMITTED' ||
    status === 'DRAFT_READY' ||
    status === 'NEEDS_MANUAL_REVIEW' ||
    status === 'GRADING_FAILED';

  return (
    <div className="flex flex-col gap-4">
      {submission && <RepoLinks submission={submission} />}

      {/*
        The assignment's own instructions, where the instructor wrote any. Above the
        mechanical steps because it says what the work is, and those say how to hand it in.
      */}
      {assignment.submissionInstructions && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="mb-2 text-sm font-medium">Instructions</p>
          <Markdown className="text-sm" content={assignment.submissionInstructions} />
        </div>
      )}

      {assignment.kind === 'REPO' && status === 'ACCEPTED' && (
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
        A Drive assignment has no pull request to observe, so submitting is an act rather than
        something inferred. Offered until the work is in the queue, and again after a grade,
        since revising the document and asking for another look is this kind's resubmission.
      */}
      {isLinkSubmitted(assignment.kind) && !inQueue && status !== 'RESUBMITTED' && (
        <SubmitWorkForm
          assignmentId={assignment.id}
          kind={assignment.kind}
          currentUrl={submission?.submittedUrl ?? null}
          resubmitting={status === 'GRADED'}
        />
      )}

      {submission?.submittedUrl && (
        <a
          href={submission.submittedUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}
        >
          <FileText data-icon="inline-start" />
          {assignment.kind === 'GOOGLE_DRIVE' ? 'The file you submitted' : 'The work you submitted'}
          {submission.isLate ? ' (late)' : ''}
          <ExternalLink data-icon="inline-end" />
        </a>
      )}

      {/*
        The same shape as the Drive form above and offered on the same terms: until the
        work is in the queue, and again after a grade, since uploading a revised file is this
        kind's resubmission.
      */}
      {assignment.kind === 'FILE_UPLOAD' && !inQueue && status !== 'RESUBMITTED' && (
        <UploadWorkForm
          assignmentId={assignment.id}
          acceptedFileTypes={assignment.acceptedFileTypes}
          resubmitting={status === 'GRADED'}
        />
      )}

      {/*
        What they handed in, so a student can tell that the right file went. No link: the
        bucket is private and a download is a signed URL minted per request, which is
        `UploadedFileRow`'s job.
      */}
      {submission?.uploadFilename && (
        <UploadedFileRow
          submissionId={submission.id}
          filename={submission.uploadFilename}
          sizeBytes={submission.uploadSizeBytes}
          isLate={submission.isLate ?? false}
        />
      )}

      {/*
        Every queue state a student can be in reads the same way, deliberately: whether a
        draft exists, failed, or was never attempted is this system's business.
      */}
      {inQueue && (
        <Alert>
          <Clock className="size-4" />
          <AlertTitle>Waiting on your instructor</AlertTitle>
          <AlertDescription>
            {assignment.kind === 'REPO'
              ? 'Your pull request is in. Feedback appears here once it is released.'
              : 'Your work is in. Feedback appears here once it is released.'}
          </AlertDescription>
        </Alert>
      )}

      {status === 'RESUBMITTED' ? (
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
 * Handing in work that has no pull request.
 *
 * The whole of the submission signal for a Drive assignment. A repository assignment is observed —
 * the webhook sees the pull request open and records it — and there is nothing to observe
 * here, so pressing this is what puts the work in front of the instructor. Without it,
 * finished work would read as never started.
 *
 * The link is asked for rather than derived, because the student's copy is theirs and this
 * application never saw it created: Google made the copy in their Drive on their request.
 */
function SubmitWorkForm({
  assignmentId,
  kind,
  currentUrl,
  resubmitting,
}: {
  assignmentId: string;
  /**
   * Both link-submitted kinds use this form, and only the words differ. A Drive assignment
   * assignment handed out a template, so the link wanted is "your own copy"; an external-url
   * assignment handed out nothing, so the link wanted is wherever the student made the work.
   * Asking for "your copy" of a Loom recording would be asking for something that does not
   * exist.
   */
  kind: AssignmentKind;
  currentUrl: string | null;
  /** True after a grade, when submitting again is asking for another look at revised work. */
  resubmitting: boolean;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const [url, setUrl] = React.useState(currentUrl ?? '');

  const submit = useMutation(
    trpc.submissions.submitWork.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate({ assignmentId, submittedUrl: url.trim() });
      }}
    >
      <label className="text-sm font-medium" htmlFor={`submit-url-${assignmentId}`}>
        {kind === 'GOOGLE_DRIVE'
          ? resubmitting
            ? 'Submit your revised file'
            : 'Submit your file'
          : resubmitting
            ? 'Submit the link to your revised work'
            : 'Submit the link to your work'}
      </label>
      <p className="text-sm text-muted-foreground">
        {kind === 'GOOGLE_DRIVE' ? (
          <>
            Paste the link to <strong>your own copy</strong>, and make sure your instructor can
            open it.
          </>
        ) : (
          <>
            Paste the link to your finished work, and{' '}
            <strong>check that the sharing settings let your instructor open it</strong> — a
            private link looks like nothing was submitted.
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`submit-url-${assignmentId}`}
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={
            kind === 'GOOGLE_DRIVE'
              ? 'https://docs.google.com/document/d/… or /presentation/d/…'
              : 'https://www.canva.com/design/… or https://www.loom.com/share/…'
          }
          className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button size="sm" type="submit" disabled={submit.isPending || url.trim() === ''}>
          {submit.isPending ? 'Submitting…' : resubmitting ? 'Submit again' : 'Submit'}
        </Button>
      </div>
      {submit.error && (
        <p className="text-sm text-destructive" role="alert">
          {submit.error.message}
        </p>
      )}
    </form>
  );
}

/**
 * Handing in a file.
 *
 * Posts to `/api/submissions/upload` rather than calling a tRPC mutation, because tRPC's
 * transport is JSON and a file would have to be base64'd into it. One request stores the bytes
 * and marks the work submitted, so there is no state where a student has uploaded something
 * and the submission does not say so — see the route's own comment.
 *
 * The size and type are checked here as well as on the server. Not as the guarantee, which is
 * the server's and the bucket's: as the difference between being told immediately and being
 * told after spending a minute uploading 40MB on a phone tether.
 */
function UploadWorkForm({
  assignmentId,
  acceptedFileTypes,
  resubmitting,
}: {
  assignmentId: string;
  acceptedFileTypes: string[];
  /** True after a grade, when uploading again is asking for another look at revised work. */
  resubmitting: boolean;
}) {
  const router = useRouter();
  const inputId = `upload-${assignmentId}`;
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const choose = (chosen: File | null) => {
    setFile(chosen);
    if (!chosen) return setError(null);

    const check = checkUpload({
      filename: chosen.name,
      sizeBytes: chosen.size,
      acceptedTypes: acceptedFileTypes,
    });
    setError(check.ok ? null : check.reason);
  };

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || error) return;

    setBusy(true);
    setError(null);

    try {
      const body = new FormData();
      body.set('assignmentId', assignmentId);
      body.set('file', file);

      const response = await fetch('/api/submissions/upload', { method: 'POST', body });

      if (!response.ok) {
        // The route answers with a message written for a student on every refusal it makes,
        // so this shows what came back rather than a status code.
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? 'That upload did not go through. Try again.');
        return;
      }

      setFile(null);
      router.refresh();
    } catch {
      setError('That upload did not go through — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4"
      onSubmit={upload}
    >
      <label className="text-sm font-medium" htmlFor={inputId}>
        {resubmitting ? 'Upload your revised file' : 'Upload your file'}
      </label>
      <p className="text-sm text-muted-foreground">
        {describeAcceptedTypes(acceptedFileTypes)}, up to {formatBytes(MAX_UPLOAD_BYTES)}. Your
        instructor is the only person who can open it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="file"
          required
          accept={acceptAttributeFor(acceptedFileTypes)}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
          className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button size="sm" type="submit" disabled={busy || file === null || error !== null}>
          {busy ? 'Uploading…' : resubmitting ? 'Upload again' : 'Upload'}
        </Button>
      </div>
      {file && !error && (
        <p className="text-xs text-muted-foreground">
          {file.name} — {formatBytes(file.size)}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
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
