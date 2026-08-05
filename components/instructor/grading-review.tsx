'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  EyeOff,
  FlaskConical,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  Loader2,
  Pencil,
  PencilLine,
  RotateCcw,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';

import { TestRunPanel } from '@/components/instructor/test-run-panel';
import { Markdown } from '@/components/markdown';
import { DraftStatusBadge, FlagBadge, SubmissionStatusBadge } from '@/components/status-badge';
import { UploadedFileRow } from '@/components/uploaded-file';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { statedScoreInText } from '@/lib/grade/report-text';
import {
  CONFIDENCE_META,
  formatDateTime,
  formatPercent,
  formatRelative,
  scorePercent,
  sectionLabel,
  shortSha,
  TONE_CLASSES,
} from '@/lib/status';
import { cn } from '@/lib/utils';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';

/**
 * Reviewing one submission's proposed grade.
 *
 * Nothing on this screen is visible to the student until the instructor approves, and
 * approving is the only action here that writes a grade or posts anything. Three things
 * the server refuses outright are surfaced before they are attempted, so the refusal is
 * never the first the instructor hears of them: approving a draft that describes code
 * the student has replaced, approving a report whose prose states a different score than
 * the one being recorded, and approving the same draft twice.
 *
 * The interface warning and the server guard are the same rule, not two readings of it —
 * `statedScoreInText` is imported from the module the approval path uses.
 */

/**
 * Where the approve action renders.
 *
 * The score, the threshold badge, and the approve button belong beside the student's name
 * in the header, which does not scroll — an instructor at the bottom of a long report can
 * still see what they are about to release. But the state those three read is the unsaved
 * edits, which live in `DraftEditor` three levels down, and only one branch of
 * `DraftBody`'s state machine renders it at all: a generating, failed, approved, or
 * empty draft has nothing to approve. Deciding that a second time in the header is how
 * the two readings drift apart. So the header offers a slot and `DraftEditor` fills it.
 */
const HeaderActionsSlot = React.createContext<HTMLElement | null>(null);

type QueueSubmission =
  RouterOutputs['submissions']['listForAssignment']['submissions'][number];
type DraftList = RouterOutputs['gradingDrafts']['listForSubmission'];
type Draft = DraftList['drafts'][number];
type Section = Draft['sections'][number];

/** An instructor's edit where there is one, the model's output where there is not. */
function effectiveScore(section: Section): number | null {
  return section.editedScoreEarned ?? section.scoreEarned;
}
function effectiveReport(section: Section): string | null {
  return section.editedReportMarkdown ?? section.reportMarkdown;
}

export function GradingReview({
  submission,
  assignmentTitle,
  assignmentKind,
  completionThreshold,
  now,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
  /** Decides whether a test suite is even a possibility for this assignment. */
  assignmentKind: 'REPO' | 'GOOGLE_DOC' | 'FILE_UPLOAD';
  completionThreshold: number;
  now: Date;
}) {
  const trpc = useTRPC();
  const [actionsSlot, setActionsSlot] = React.useState<HTMLDivElement | null>(null);

  /*
    Test evidence exists only where a template repository does. The suite comes from the
    template and runs against a checkout of the student's repository, so a Google Doc or an
    uploaded file has nothing to execute — not "no tests configured", which is a real state
    an assignment can be in and worth reporting, but no such thing as tests. The card is
    absent rather than empty, and the query is not made.
  */
  const canHaveTests = assignmentKind === 'REPO';

  const drafts = useQuery(
    trpc.gradingDrafts.listForSubmission.queryOptions({ submissionId: submission.id }),
  );
  const testRuns = useQuery({
    ...trpc.testRuns.listForSubmission.queryOptions({ submissionId: submission.id }),
    enabled: canHaveTests,
  });

  if (drafts.isPending) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (drafts.error) {
    return (
      <div className="p-5">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not load this submission</AlertTitle>
          <AlertDescription>{drafts.error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = drafts.data;
  const draft = data.drafts[0] ?? null;

  // The run that describes the code currently on the pull request. An older run is not
  // evidence about this commit, so it is not offered as if it were.
  const currentRun =
    testRuns.data?.runs.find((run) => run.headSha === submission.headSha) ?? null;

  return (
    <div className="flex h-full flex-col">
      <ReviewHeader submission={submission} draft={draft} actionsRef={setActionsSlot} />

      <HeaderActionsSlot.Provider value={actionsSlot}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/*
              Read first, because it is the answer to the only question that matters once
              a submission is already graded: what did this student get. Everything below
              — the evidence, the editable report — is how that answer was reached, not
              the answer itself.
            */}
            {draft && (draft.status === 'APPROVED' || draft.status === 'SUPERSEDED') && (
              <ReleasedSummaryCard draft={draft} data={data} />
            )}

            <CommentRecoveryNotice submission={submission} grade={data.grade} />

            {canHaveTests && (
              <TestEvidence
                submissionId={submission.id}
                runs={testRuns.data}
                currentRun={currentRun}
                loading={testRuns.isPending}
                now={now}
              />
            )}

            {/*
              The analogue of test evidence for work with no suite: the thing the grade rests
              on. Here rather than inside the hand-grading card, because that card is gone once
              a draft exists and the file is most needed while the feedback is being written.
            */}
            {submission.uploadFilename && (
              <UploadedFileRow
                submissionId={submission.id}
                filename={submission.uploadFilename}
                sizeBytes={submission.uploadSizeBytes}
                isLate={submission.isLate ?? false}
                label="What the student uploaded"
              />
            )}

            <DraftBody
              key={draft?.id ?? 'none'}
              submission={submission}
              assignmentTitle={assignmentTitle}
              completionThreshold={completionThreshold}
              draft={draft}
              data={data}
            />

            {data.drafts.length > 1 && (
              <DraftHistory drafts={data.drafts} activeId={draft?.id} now={now} />
            )}
          </div>
        </div>
      </HeaderActionsSlot.Provider>
    </div>
  );
}

function ReviewHeader({
  submission,
  draft,
  actionsRef,
}: {
  submission: QueueSubmission;
  draft: Draft | null;
  /** Filled by whatever is being reviewed — see `HeaderActionsSlot`. */
  actionsRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-5 py-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">
              {submission.student.displayName ?? submission.student.email ?? 'Unknown student'}
            </h2>
            {submission.student.githubUsername && (
              <span className="text-sm text-muted-foreground">
                @{submission.student.githubUsername}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmissionStatusBadge status={submission.status} />
            {draft && <DraftStatusBadge status={draft.status} />}
            {submission.isLate && (
              <Badge variant="outline" className="font-normal">
                Late
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {submission.repoUrl && (
            <a
              href={submission.repoUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Repository
              <ExternalLink data-icon="inline-end" />
            </a>
          )}
          {submission.prUrl && (
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <GitPullRequest data-icon="inline-start" />
              PR #{submission.prNumber}
              <ExternalLink data-icon="inline-end" />
            </a>
          )}
          {submission.headSha && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              <GitCommitHorizontal className="size-3.5" />
              {shortSha(submission.headSha)}
            </span>
          )}
        </div>
      </div>

      <div ref={actionsRef} className="flex flex-wrap items-center justify-end gap-3" />
    </header>
  );
}

/**
 * A grade that was recorded but whose comment never reached the pull request.
 *
 * The grade and the comment are written in two steps on purpose, so a GitHub outage
 * during approval leaves a real grade and an unsent comment rather than losing both.
 * This is the way out of that state that does not involve approving twice.
 */
function CommentRecoveryNotice({
  submission,
  grade,
}: {
  submission: QueueSubmission;
  grade: DraftList['grade'];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const retry = useMutation(
    trpc.gradingDrafts.retryComment.mutationOptions({
      onSuccess: () => {
        toast.success('Comment posted to the pull request.');
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Only a real failure. `not_applicable` — a hand-graded assignment with no pull request
  // — is a finished grade, and offering it a retry would offer a button that cannot
  // succeed against a fault that does not exist.
  if (grade?.delivery !== 'failed') return null;

  return (
    <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      <AlertTriangle className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>The feedback comment was never posted</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>
          This grade is recorded and the student can see it in the application, but the
          comment did not reach the pull request. The score is safe; only the comment is
          missing.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate({ submissionId: submission.id })}
        >
          {retry.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <RotateCcw data-icon="inline-start" />
          )}
          {retry.isPending ? 'Posting…' : 'Post the comment'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Test evidence, shown in every state, because it is what the report's claims rest on. */
function TestEvidence({
  submissionId,
  runs,
  currentRun,
  loading,
  now,
}: {
  submissionId: string;
  runs: RouterOutputs['testRuns']['listForSubmission'] | undefined;
  currentRun: RouterOutputs['testRuns']['listForSubmission']['runs'][number] | null;
  loading: boolean;
  now: Date;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const start = useMutation(
    trpc.testRuns.start.mutationOptions({
      onSuccess: () => {
        toast.success('Test run finished.');
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (loading) return <Skeleton className="h-20 w-full" />;
  if (!runs) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4 text-muted-foreground" />
            Test evidence
          </CardTitle>
          {runs.hasRunner && runs.canRun && (
            <Button
              size="sm"
              variant="outline"
              disabled={start.isPending}
              onClick={() => start.mutate({ submissionId })}
            >
              {start.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {start.isPending ? 'Running the suite…' : currentRun ? 'Run again' : 'Run tests'}
            </Button>
          )}
        </div>
        {runs.presetError && (
          <CardDescription className="text-destructive">{runs.presetError}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <TestRunPanel
          run={currentRun}
          hasRunner={runs.hasRunner}
          runnerPreset={runs.runnerPreset}
          now={now}
        />
      </CardContent>
    </Card>
  );
}

/** Routes to the presentation for whatever state the grading run is actually in. */
function DraftBody({
  submission,
  assignmentTitle,
  completionThreshold,
  draft,
  data,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
  completionThreshold: number;
  draft: Draft | null;
  data: DraftList;
}) {
  if (!draft) {
    if (submission.status === 'NOT_STARTED' || submission.status === 'ACCEPTED') {
      return (
        <StateCard
          icon={GitPullRequest}
          title="Nothing submitted yet"
          description={
            data.manualOnly
              ? 'This student has not submitted this assignment, so there is nothing to grade.'
              : 'This student has a repository but has not opened a pull request, so there is nothing to grade.'
          }
        />
      );
    }
    // One of the two, never both. Which one is decided on the server, from the same reading
    // of the assignment that put this submission in its triage bucket.
    return data.manualOnly ? (
      <HandGradePanel submission={submission} data={data} />
    ) : (
      <GeneratePanel submission={submission} data={data} label="Generate report" />
    );
  }

  if (draft.status === 'GENERATING') {
    return (
      <StateCard
        icon={Loader2}
        spin
        title="Generating the report"
        description="A run is in progress. It reads the submission against the rubric and takes up to a couple of minutes."
      />
    );
  }

  // Surfaced before approval is attempted, because approval refuses it outright. The
  // instructor read a report about one commit; attaching it to different code would
  // record a grade for work nobody has looked at.
  const stale =
    data.currentHeadSha !== null &&
    draft.headSha !== data.currentHeadSha &&
    draft.approvedAt === null;

  if (draft.status === 'FAILED') {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The grading run failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              It failed before producing a report. This is an infrastructure error and not
              a score of zero — nothing has been sent to the student.
            </p>
            {draft.errorDetail && (
              <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
                {draft.errorDetail}
              </pre>
            )}
          </AlertDescription>
        </Alert>
        <GeneratePanel submission={submission} data={data} label="Try again" retry />
      </div>
    );
  }

  if (draft.status === 'APPROVED' || draft.status === 'SUPERSEDED') {
    return <ReleasedBody submission={submission} draft={draft} data={data} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {stale && (
        <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
          <RotateCcw className="text-amber-600 dark:text-amber-400" />
          <AlertTitle>This report describes older code</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              The report was written against <code>{shortSha(draft.headSha)}</code>, and
              the pull request is now at <code>{shortSha(data.currentHeadSha)}</code>.
              Approving is refused while that is true — generate a new report so the grade
              describes the code that is there.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {draft.status === 'NEEDS_MANUAL_REVIEW' && (
        <ManualReviewNotice draft={draft} hasSections={draft.sections.length > 0} />
      )}

      <WithheldFilesNotice draft={draft} />

      {draft.sections.length > 0 ? (
        <DraftEditor
          submission={submission}
          assignmentTitle={assignmentTitle}
          completionThreshold={completionThreshold}
          draft={draft}
          approvalBlocked={stale}
          manualOnly={data.manualOnly}
        />
      ) : (
        <StateCard
          icon={Pencil}
          tone="warning"
          title="No report to start from"
          description="Open the pull request to read the work, then grade it directly."
        >
          {submission.prUrl && (
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants())}
            >
              <GitPullRequest data-icon="inline-start" />
              Open the pull request
              <ExternalLink data-icon="inline-end" />
            </a>
          )}
        </StateCard>
      )}

      {stale && <GeneratePanel submission={submission} data={data} label="Generate a new report" retry />}
    </div>
  );
}

/**
 * Files the student committed that the prompt withheld.
 *
 * Two very different things arrive through one mechanism, so the notice says which.
 * A committed dependency tree or build directory is ordinary and the only thing an
 * instructor needs is the explanation: those files are not in the report because the
 * model never saw them. A committed environment file or private key is not ordinary and
 * needs an action from the student — deleting the file does not remove it from the
 * repository's history, so the credential itself has to be replaced, and nobody but the
 * student can do that.
 *
 * Not a finding and not gating. Committing `node_modules` is common and is not
 * misconduct, and the filter is what makes it harmless. This exists because the
 * alternative — recording it in `modelMetadata` and showing nobody — means a report
 * written without files the student did commit reads exactly like one written with them.
 */
function WithheldFilesNotice({ draft }: { draft: Draft }) {
  const meta = (draft.modelMetadata ?? {}) as Record<string, unknown>;
  const withheld = meta.excludedFromPrompt;
  if (typeof withheld !== 'object' || withheld === null) return null;

  const record = withheld as Record<string, unknown>;
  const count = typeof record.count === 'number' ? record.count : 0;
  if (count === 0) return null;

  const byReason =
    typeof record.byReason === 'object' && record.byReason !== null
      ? (record.byReason as Record<string, unknown>)
      : {};
  const reasons = Object.entries(byReason).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );
  const examples = Array.isArray(record.examples)
    ? record.examples.filter((example): example is string => typeof example === 'string')
    : [];

  const secret = reasons.some(
    ([reason]) => reason === 'environment file' || reason === 'credential file',
  );

  return (
    <Alert
      className={
        secret ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : undefined
      }
    >
      {secret ? (
        <AlertTriangle className="text-amber-600 dark:text-amber-400" />
      ) : (
        <EyeOff />
      )}
      <AlertTitle>
        {secret
          ? 'This submission commits a secret'
          : count === 1
            ? '1 committed file was kept out of the report'
            : `${count} committed files were kept out of the report`}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>
          {secret
            ? 'The student committed an environment file or a private key. It was not sent to the model, and it is still in the repository — deleting it does not remove it from the history, so tell the student to replace the credential itself.'
            : 'These are build output, dependency trees, or editor files, so the model never saw them. Nothing in the report rests on them.'}
        </p>
        <ul className="ml-4 list-disc text-sm">
          {reasons.map(([reason, number]) => (
            <li key={reason}>
              {number} × {reason}
            </li>
          ))}
        </ul>
        {examples.length > 0 && (
          <p className="font-mono text-xs break-all">
            {examples.slice(0, 5).join(', ')}
            {count > 5 ? ', …' : ''}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ManualReviewNotice({ draft, hasSections }: { draft: Draft; hasSections: boolean }) {
  const reasons = (draft.errorDetail ?? '')
    .split('\n')
    .map((reason) => reason.trim())
    .filter(Boolean);

  return (
    <Alert className="border-violet-500/40 text-violet-700 dark:text-violet-300">
      <AlertTriangle className="text-violet-600 dark:text-violet-400" />
      <AlertTitle>Held back for manual review</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>
          The cross-check found something it could not reconcile, so this was not offered
          as ready.{' '}
          {hasSections
            ? 'The report is below and can still be approved — check every score against the code and the tests first.'
            : 'Grade this one directly from the pull request.'}
        </p>
        {reasons.length > 0 && (
          <ul className="ml-4 list-disc text-sm">
            {reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Runs the pipeline. Awaited inside the request and slow — tens of seconds to a couple of
 * minutes — so the button says what is happening rather than going quiet.
 */
function useGenerateReport() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.gradingDrafts.generate.mutationOptions({
      onSuccess: () => {
        toast.success('Report generated. Nothing has been sent to the student.');
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
}

/**
 * Opens an empty draft to write a grade into.
 *
 * The counterpart to `GeneratePanel` for work the pipeline cannot read. It creates the same
 * kind of record — a draft with a section per declared section — so everything after this
 * point is the editor and the approval an AI-graded submission goes through, rather than a
 * separate path with its own way of being wrong.
 */
function HandGradePanel({
  submission,
  data,
}: {
  submission: QueueSubmission;
  data: DraftList;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const start = useMutation(
    trpc.gradingDrafts.startManual.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PencilLine className="size-4 text-violet-600 dark:text-violet-400" />
          Grade this by hand
        </CardTitle>
        <CardDescription>
          This assignment has nothing the pipeline can read, so there is no report to
          generate. Open the student&apos;s work, then write the feedback and the score here.
          Nothing reaches the student until you release it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!data.canGradeByHand || start.isPending}
          onClick={() => start.mutate({ submissionId: submission.id })}
        >
          {start.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <PencilLine data-icon="inline-start" />
          )}
          {start.isPending ? 'Opening…' : 'Start grading'}
        </Button>

        {submission.submittedUrl && (
          <a
            href={submission.submittedUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Open what the student submitted
            <ExternalLink data-icon="inline-end" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function GeneratePanel({
  submission,
  data,
  label,
  retry = false,
}: {
  submission: QueueSubmission;
  data: DraftList;
  label: string;
  retry?: boolean;
}) {
  const generate = useGenerateReport();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          {retry ? 'Generate another report' : 'Generate a report'}
        </CardTitle>
        <CardDescription>
          Runs the assignment&apos;s tests if they have not run at this commit, then reads
          the submission against the rubric and drafts per-section feedback. It records no
          grade and posts nothing — you review the result first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!data.canGenerate && data.blockedReason && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>Not ready to grade</AlertTitle>
            <AlertDescription>{data.blockedReason}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!data.canGenerate || generate.isPending}
            onClick={() => generate.mutate({ submissionId: submission.id })}
          >
            {generate.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Bot data-icon="inline-start" />
            )}
            {generate.isPending ? 'Running tests and grading…' : label}
          </Button>

          {generate.isPending && (
            <span className="text-sm text-muted-foreground">
              A couple of minutes: the test suite takes about half a minute, then the
              report is written. Leaving the page cancels nothing — it finishes and the
              report appears here.
            </span>
          )}

          {submission.prUrl && !generate.isPending && (
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              Read the pull request first
              <ExternalLink data-icon="inline-end" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The editable review.
 *
 * Edits live in local state while they are being made and are written to the server as
 * part of approving, because approval reads the stored draft rather than anything the
 * browser sends it. An edit stored beside the model's output, never over it: the record
 * of what the model actually produced is what any later judgment about the grading has
 * to rest on.
 */
function DraftEditor({
  submission,
  assignmentTitle,
  completionThreshold,
  draft,
  approvalBlocked,
  manualOnly,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
  completionThreshold: number;
  draft: Draft;
  /** True when something else on the screen already refuses approval, e.g. a stale draft. */
  approvalBlocked: boolean;
  /** True when this assignment is graded by hand, so there is no report to generate again. */
  manualOnly: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const actionsSlot = React.useContext(HeaderActionsSlot);

  const [scores, setScores] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(draft.sections.map((s) => [s.id, effectiveScore(s) ?? 0])),
  );
  const [reports, setReports] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(draft.sections.map((s) => [s.id, effectiveReport(s) ?? ''])),
  );
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const updateSection = useMutation(trpc.gradingDrafts.updateSection.mutationOptions());
  const approve = useMutation(
    trpc.gradingDrafts.approve.mutationOptions({
      onSuccess: (result) => {
        setConfirmOpen(false);
        // Named outcomes, because "the comment did not post" is a warning on a repository
        // assignment and a falsehood on one that never had a pull request.
        if (result.delivery === 'failed') {
          toast.warning(
            `Grade recorded, but the comment did not post: ${result.commentError}`,
          );
        } else {
          toast.success(
            `Released ${result.finalScore}/${result.finalScorePossible} to ${
              submission.student.displayName ?? 'the student'
            }.`,
          );
        }
        void queryClient.invalidateQueries();
      },
      onError: (error) => {
        setConfirmOpen(false);
        toast.error(error.message);
      },
    }),
  );

  const totalEarned = draft.sections.reduce((sum, s) => sum + (scores[s.id] ?? 0), 0);
  const totalPossible = draft.sections.reduce((sum, s) => sum + (s.scorePossible ?? 0), 0);
  const isComplete = totalPossible > 0 && totalEarned / totalPossible >= completionThreshold;

  const changedSections = draft.sections.filter(
    (s) =>
      (scores[s.id] ?? 0) !== (effectiveScore(s) ?? 0) ||
      (reports[s.id] ?? '') !== (effectiveReport(s) ?? ''),
  );

  /*
    The same check the approval path performs, run here so the instructor sees it while
    they can still fix it. The server refusing remains the guard — this only moves the
    news earlier.
  */
  const mismatches = draft.sections.flatMap((section) => {
    const text = reports[section.id] ?? '';
    const stated = statedScoreInText(text);
    if (!stated) return [];

    const recorded = scores[section.id] ?? 0;
    const possible = section.scorePossible ?? 0;
    if (stated.earned === recorded && stated.possible === possible) return [];

    return [{ section, stated, recorded, possible }];
  });

  const faults = [...new Set(draft.sections.flatMap((s) => s.flags))].filter((code) =>
    ['TEST_RUN_MISSING', 'TEST_MATCH_MISSING', 'PROTECTED_PATHS_CHANGED'].includes(code),
  );

  const busy = approve.isPending || updateSection.isPending;
  const canApprove = !approvalBlocked && mismatches.length === 0 && totalPossible > 0;
  const unsaved = changedSections.length > 0;

  /**
   * Writes the sections the instructor has touched.
   *
   * Two different comparisons, deliberately. `changedSections` asks what was touched
   * since the draft was loaded, and compares against the effective values. Whether each
   * field is sent as an edit or as null compares against the *model's* values, because
   * null is how an edit is discarded: typing a score back to what the model proposed
   * withdraws the edit rather than making a new one.
   */
  async function saveEdits() {
    for (const section of changedSections) {
      const report = reports[section.id] ?? '';
      const score = scores[section.id] ?? 0;

      await updateSection.mutateAsync({
        sectionId: section.id,
        reportMarkdown: report.trim() === (section.reportMarkdown ?? '').trim() ? null : report,
        scoreEarned: score === (section.scoreEarned ?? 0) ? null : score,
      });
    }
  }

  async function save() {
    await saveEdits();
    toast.success(
      changedSections.length === 1 ? 'Change saved.' : `${changedSections.length} changes saved.`,
    );
    void queryClient.invalidateQueries();
  }

  /*
    Approving saves first regardless. The explicit Save button exists so an edit can be
    kept without releasing anything, not because approving needs it — approval reads the
    stored draft, so an unsaved edit would silently not be part of the grade.
  */
  async function saveThenApprove() {
    await saveEdits();
    approve.mutate({ draftId: draft.id });
  }

  return (
    <div className="flex flex-col gap-4">
      {faults.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Check this against the code before approving</AlertTitle>
          <AlertDescription>
            This report carries {faults.length === 1 ? 'a fault flag' : 'fault flags'} (
            {faults.join(', ')}). Its score is not backed by the test evidence it would
            normally rest on.
          </AlertDescription>
        </Alert>
      )}

      {mismatches.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>A report states a different score than the one being recorded</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              The student reads the report and the gradebook reads the score, so these
              cannot disagree. Change whichever is wrong. Approving is refused until they
              match.
            </p>
            <ul className="ml-4 list-disc text-sm">
              {mismatches.map(({ section, stated, recorded, possible }) => (
                <li key={section.id}>
                  {sectionLabel(section.sectionType)}: the text says {stated.earned}/
                  {stated.possible}, the score is {recorded}/{possible}.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        {draft.sections.map((section) => (
          <SectionEditor
            key={section.id}
            section={section}
            score={scores[section.id] ?? 0}
            report={reports[section.id] ?? ''}
            onScore={(value) => setScores((prev) => ({ ...prev, [section.id]: value }))}
            onReport={(value) => setReports((prev) => ({ ...prev, [section.id]: value }))}
            onReset={() => {
              setScores((prev) => ({ ...prev, [section.id]: effectiveScore(section) ?? 0 }));
              setReports((prev) => ({ ...prev, [section.id]: effectiveReport(section) ?? '' }));
            }}
            unsaved={changedSections.some((changed) => changed.id === section.id)}
          />
        ))}
      </div>

      {actionsSlot &&
        createPortal(
          <>
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Total</span>
                <span className="text-lg font-semibold tabular-nums">
                  {totalEarned}
                  <span className="text-muted-foreground"> / {totalPossible}</span>
                </span>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <Badge
                variant="outline"
                className={cn(
                  'font-normal',
                  isComplete
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'border-destructive/40 text-destructive',
                )}
              >
                {isComplete ? 'Meets the threshold' : 'Below the threshold'}
              </Badge>
              {/*
                Said plainly, next to the number it affects. Approving saves first anyway,
                but an instructor should never have to wonder whether what is on screen is
                what would go out.
              */}
              {unsaved && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {changedSections.length === 1
                    ? '1 unsaved change'
                    : `${changedSections.length} unsaved changes`}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unsaved && (
                <Button variant="outline" disabled={busy} onClick={() => void save()}>
                  {updateSection.isPending && (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  )}
                  {updateSection.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
              <Button disabled={!canApprove || busy} onClick={() => setConfirmOpen(true)}>
                <CheckCircle2 data-icon="inline-start" />
                Approve and release
              </Button>
            </div>
          </>,
          actionsSlot,
        )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release this grade?</DialogTitle>
            <DialogDescription>
              {submission.student.displayName ?? 'The student'} will see this score and
              feedback for {assignmentTitle}, and it is posted as a new comment on the pull
              request. Earlier rounds of feedback stay where they are.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">Final score</span>
            <span className="text-sm font-semibold tabular-nums">
              {totalEarned} / {totalPossible}
              <span
                className={cn(
                  'ml-2 font-normal',
                  isComplete
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-destructive',
                )}
              >
                {isComplete ? 'Complete' : 'Incomplete'}
              </span>
            </span>
          </div>

          {changedSections.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {changedSections.length === 1
                ? 'Your edit to one section'
                : `Your edits to ${changedSections.length} sections`}{' '}
              will be saved first.
            </p>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={busy}>
                  Cancel
                </Button>
              }
            />
            <Button onClick={() => void saveThenApprove()} disabled={busy}>
              {busy ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckCircle2 data-icon="inline-start" />
              )}
              {updateSection.isPending
                ? 'Saving your edits…'
                : approve.isPending
                  ? 'Releasing…'
                  : 'Approve and release'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Absent when there is nothing to generate. Offering "grade again" on a hand-written
        draft would offer to replace the instructor's own writing with a report the pipeline
        cannot produce — and their way of starting over is to edit what is in front of them.
      */}
      {!manualOnly && <RegenerateRow submissionId={submission.id} unsaved={unsaved} />}

      {/*
        Last, because it is provenance rather than part of the review: which model wrote
        this, from which prompt, against which commit of the grading assets. Worth being
        able to find when a report reads oddly, and worth nothing while reading one.
      */}
      <ModelMetaBar draft={draft} />
    </div>
  );
}

/**
 * Grading this submission again, from beside a report that already exists.
 *
 * The reason this is here rather than only on a failed run: a report can arrive sound but
 * wanting — written before the tests ran, or against a rubric that has since been
 * corrected. Without this, the only way to ask for another was to push a commit.
 *
 * Refused while an edit is unsaved. A new report supersedes this one, and an edit stored
 * against a superseded draft is no longer what anybody reads — losing an instructor's
 * writing to a button they pressed for a different reason is not a trade worth making.
 */
function RegenerateRow({ submissionId, unsaved }: { submissionId: string; unsaved: boolean }) {
  const generate = useGenerateReport();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">Not happy with this report?</span>
        <span className="text-xs text-muted-foreground">
          {unsaved
            ? 'Save or undo your changes first — a new report replaces this one.'
            : 'Grading again runs the tests if needed and writes a fresh report. This one is kept.'}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={unsaved || generate.isPending}
        onClick={() => generate.mutate({ submissionId })}
      >
        {generate.isPending ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <RotateCcw data-icon="inline-start" />
        )}
        {generate.isPending ? 'Grading again…' : 'Grade again'}
      </Button>
    </div>
  );
}

/** Which model produced this, from which prompt and which assets. Json, so read loosely. */
function ModelMetaBar({ draft }: { draft: Draft }) {
  const meta = (draft.modelMetadata ?? {}) as Record<string, unknown>;
  const usage = (meta.usage ?? {}) as Record<string, unknown>;

  const asNumber = (value: unknown) => (typeof value === 'number' ? value : 0);
  const tokens =
    asNumber(usage.promptTokens) +
    asNumber(usage.completionTokens) +
    asNumber(usage.cachedPromptTokens) +
    asNumber(usage.cacheWriteTokens);

  const items = [
    { label: 'Model', value: typeof meta.provider === 'string' ? meta.provider : '—' },
    { label: 'Prompt', value: typeof meta.promptVersion === 'string' ? meta.promptVersion : '—' },
    {
      label: 'Assets',
      value:
        typeof meta.gradingAssetsCommitSha === 'string'
          ? shortSha(meta.gradingAssetsCommitSha)
          : '—',
    },
    { label: 'Tokens', value: tokens > 0 ? tokens.toLocaleString() : '—' },
  ];

  if (items.every((item) => item.value === '—')) return null;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border bg-muted/30 px-4 py-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
            {item.label}
          </span>
          <span className="font-mono text-xs">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

interface RubricItem {
  label: string;
  criterion: string;
  scoreEarned: number;
  scorePossible: number;
  note: string | null;
}

function readRubricItems(value: unknown): RubricItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.label !== 'string') return [];
    return [
      {
        label: row.label,
        criterion: typeof row.criterion === 'string' ? row.criterion : '',
        scoreEarned: typeof row.scoreEarned === 'number' ? row.scoreEarned : 0,
        scorePossible: typeof row.scorePossible === 'number' ? row.scorePossible : 0,
        note: typeof row.note === 'string' ? row.note : null,
      },
    ];
  });
}

function SectionEditor({
  section,
  score,
  report,
  onScore,
  onReport,
  onReset,
  unsaved,
}: {
  section: Section;
  score: number;
  report: string;
  onScore: (value: number) => void;
  onReport: (value: string) => void;
  onReset: () => void;
  /** True when this section differs from what is stored. */
  unsaved: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const possible = section.scorePossible ?? 0;
  const rubricItems = readRubricItems(section.rubricItems);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">{sectionLabel(section.sectionType)}</CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {unsaved && (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                >
                  Unsaved
                </Badge>
              )}
              {section.editedAt && !unsaved && (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  Edited by you
                </Badge>
              )}
              {section.confidence && (
                <Badge
                  variant="outline"
                  className={cn('font-normal', TONE_CLASSES[CONFIDENCE_META[section.confidence].tone])}
                >
                  {CONFIDENCE_META[section.confidence].label}
                </Badge>
              )}
              {section.flags.map((flag) => (
                <FlagBadge key={flag} code={flag} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={possible}
              step="any"
              value={score}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isNaN(parsed)) return;
                onScore(Math.max(0, Math.min(possible, parsed)));
              }}
              className="h-9 w-20 text-right tabular-nums"
              aria-label={`${sectionLabel(section.sectionType)} score`}
            />
            <span className="text-sm text-muted-foreground">/ {possible}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {rubricItems.length > 0 && (
          <div className="flex flex-col gap-2">
            {rubricItems.map((item, index) => (
              <div
                key={index}
                className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.criterion && (
                    <span className="text-xs text-muted-foreground">{item.criterion}</span>
                  )}
                  {item.note && (
                    <span className="mt-1 text-xs text-muted-foreground">{item.note}</span>
                  )}
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {item.scoreEarned}
                  <span className="text-muted-foreground"> / {item.scorePossible}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              What the student will read
            </span>
            <div className="flex items-center gap-1">
              {unsaved && (
                <Button size="sm" variant="ghost" onClick={onReset}>
                  <Undo2 data-icon="inline-start" />
                  Undo
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>
                <Pencil data-icon="inline-start" />
                {editing ? 'Preview' : 'Edit'}
              </Button>
            </div>
          </div>

          {editing ? (
            <Textarea
              value={report}
              onChange={(event) => onReport(event.target.value)}
              rows={16}
              className="font-mono text-xs"
            />
          ) : report.trim() ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <Markdown content={report} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              No report was written for this section.
            </p>
          )}
        </div>

        {section.instructorNotes.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <span className="text-[11px] font-medium tracking-wide text-amber-700 uppercase dark:text-amber-300">
              For you, never shown to the student
            </span>
            {section.instructorNotes.map((note, index) => (
              <p key={index} className="text-xs text-amber-800 dark:text-amber-200">
                {note}
              </p>
            ))}
          </div>
        )}

        {section.submissionProcessNote && (
          <p className="text-xs text-muted-foreground">{section.submissionProcessNote}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The score and release date for an approved or superseded draft.
 *
 * Pulled out of `ReleasedBody` so it can be read at the top of the screen, before the
 * evidence a re-grading instructor would otherwise have to scroll past to find it.
 */
function ReleasedSummaryCard({ draft, data }: { draft: Draft; data: DraftList }) {
  const superseded = draft.status === 'SUPERSEDED';
  const percent = scorePercent(data.grade?.finalScore, data.grade?.finalScorePossible);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {superseded ? (
                <History className="size-4 text-muted-foreground" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              )}
              {superseded ? 'Superseded report' : 'Released'}
            </CardTitle>
            <CardDescription>
              {superseded
                ? 'Replaced by a later run. Kept as part of the record.'
                : `Approved ${formatDateTime(draft.approvedAt)}. The student can read this.`}
            </CardDescription>
          </div>

          {!superseded && data.grade?.finalScore != null && (
            <div className="flex flex-col items-end">
              <span className="text-2xl font-semibold tabular-nums">
                {data.grade.finalScore}
                <span className="text-base text-muted-foreground">
                  {' '}
                  / {data.grade.finalScorePossible}
                </span>
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'font-normal',
                  data.grade.isComplete
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'border-destructive/40 text-destructive',
                )}
              >
                {data.grade.isComplete ? 'Complete' : 'Incomplete'}
                {percent != null ? ` · ${formatPercent(percent)}` : ''}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}

/** An approved or superseded draft, read-only. What was sent is a matter of record. */
function ReleasedBody({
  submission,
  draft,
  data,
}: {
  submission: QueueSubmission;
  draft: Draft;
  data: DraftList;
}) {
  const superseded = draft.status === 'SUPERSEDED';

  return (
    <div className="flex flex-col gap-4">
      {/*
        Revising a released grade means a new report, not an edit of this one. The student
        keeps both, which is the point of having a history at all.
      */}
      {!superseded && submission.headSha !== submission.gradedHeadSha && (
        <GeneratePanel submission={submission} data={data} label="Grade the newer commit" retry />
      )}

      <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        As it was sent
      </p>
      {draft.sections.map((section) => (
        <ReadOnlySection key={section.id} section={section} />
      ))}
    </div>
  );
}

function ReadOnlySection({ section }: { section: Section }) {
  const report = effectiveReport(section);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">{sectionLabel(section.sectionType)}</CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {section.flags.map((flag) => (
                <FlagBadge key={flag} code={flag} />
              ))}
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {effectiveScore(section) ?? '—'}
            <span className="text-muted-foreground"> / {section.scorePossible ?? '—'}</span>
          </span>
        </div>
      </CardHeader>
      {report && (
        <CardContent>
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <Markdown content={report} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function DraftHistory({
  drafts,
  activeId,
  now,
}: {
  drafts: Draft[];
  activeId: string | undefined;
  now: Date;
}) {
  return (
    <Collapsible className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium">
        <span className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          Every run for this submission ({drafts.length})
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {drafts.map((entry) => {
            const earned = entry.sections.reduce((sum, s) => sum + (effectiveScore(s) ?? 0), 0);
            const possible = entry.sections.reduce((sum, s) => sum + (s.scorePossible ?? 0), 0);

            return (
              <div
                key={entry.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border px-3 py-2',
                  entry.id === activeId
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-muted/20',
                )}
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <DraftStatusBadge status={entry.status} />
                    {entry.id === activeId && (
                      <Badge variant="secondary" className="font-normal">
                        Most recent
                      </Badge>
                    )}
                  </div>
                  <span className="mt-1 font-mono text-xs text-muted-foreground">
                    {shortSha(entry.headSha)} · {formatRelative(entry.createdAt, now)}
                  </span>
                </div>
                {possible > 0 && (
                  <span className="text-sm font-medium tabular-nums">
                    {earned}
                    <span className="text-muted-foreground"> / {possible}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StateCard({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  spin = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  tone?: 'neutral' | 'warning' | 'success';
  spin?: boolean;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'success'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-muted-foreground';

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className={cn('size-6', toneClass, spin && 'animate-spin')} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">{title}</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
