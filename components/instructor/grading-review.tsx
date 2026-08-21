"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  EyeOff,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  History,
  ListChecks,
  Loader2,
  Pencil,
  PencilLine,
  RotateCcw,
  Sparkles,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { TestRunPanel } from "@/components/instructor/test-run-panel";
import { Markdown } from "@/components/markdown";
import {
  ConfidenceBadge,
  DraftStatusBadge,
  FlagBadge,
  SubmissionStatusBadge,
} from "@/components/status-badge";
import { SubmittedLinkRow } from "@/components/submitted-link";
import { UploadedFileRow } from "@/components/uploaded-file";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import { statedScoreInText } from "@/lib/grade/report-text";
import {
  completionMeta,
  draftStatusAddsSomething,
  formatDateTime,
  formatPercent,
  formatRelative,
  scorePercent,
  sectionLabel,
  shortSha,
} from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

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
 * The score and the approve button belong beside the student's name in the header, which
 * does not scroll — an instructor at the bottom of a long report can still see what they
 * are about to release. But the state those two read is the unsaved edits, which live in
 * `DraftEditor` three levels down, and only one branch of
 * `DraftBody`'s state machine renders it at all: a generating, failed, approved, or
 * empty draft has nothing to approve. Deciding that a second time in the header is how
 * the two readings drift apart. So the header offers a slot and `DraftEditor` fills it.
 */
const HeaderActionsSlot = React.createContext<HTMLElement | null>(null);

/**
 * Which sections have their feedback box open, held above the card that owns the box.
 *
 * On a hand-graded assignment, opening the box is also what creates the round: a draft appears,
 * and everything below the header is rebuilt around it. State kept inside the section card would
 * go with it and close the box the click had just opened, so which boxes are open is remembered
 * out here, where nothing about the round can reach it.
 *
 * Keyed by the section's own label, which is what a hand-graded section has instead of a type
 * and is the same string the round is created with.
 */
const FeedbackBoxes = React.createContext<{
  open: readonly string[];
  setOpen: (sectionType: string, open: boolean) => void;
}>({ open: [], setOpen: () => {} });

type QueueSubmission = RouterOutputs["submissions"]["listForAssignment"]["submissions"][number];
type DraftList = RouterOutputs["gradingDrafts"]["listForSubmission"];
type Draft = DraftList["drafts"][number];
type Section = Draft["sections"][number];

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
  studentHref,
  now,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
  /**
   * Decides whether a test suite is even a possibility for this assignment. Typed from the
   * enum rather than spelled out, so a kind added later is a compile error in the places that
   * have to decide about it rather than a union two files disagree about.
   */
  assignmentKind: AssignmentKind;
  completionThreshold: number;
  /**
   * Where this student's own record lives, if there is somewhere to go.
   *
   * Absent on the student overview, because that *is* their record — a name linking to the page it
   * is already on is a dead control. Present in the grading queue, where "what else has this person
   * done" is the question a report prompts and there was previously no way to answer it.
   */
  studentHref?: string;
  now: Date;
}) {
  const trpc = useTRPC();
  const [actionsSlot, setActionsSlot] = React.useState<HTMLDivElement | null>(null);
  const [openBoxes, setOpenBoxes] = React.useState<readonly string[]>([]);

  const feedbackBoxes = React.useMemo(
    () => ({
      open: openBoxes,
      setOpen: (sectionType: string, open: boolean) =>
        setOpenBoxes((prev) =>
          open
            ? prev.includes(sectionType)
              ? prev
              : [...prev, sectionType]
            : prev.filter((entry) => entry !== sectionType),
        ),
    }),
    [openBoxes],
  );

  /*
    Test evidence exists only where a template repository does. The suite comes from the
    template and runs against a checkout of the student's repository, so a Drive file or an
    uploaded file has nothing to execute — not "no tests configured", which is a real state
    an assignment can be in and worth reporting, but no such thing as tests. The card is
    absent rather than empty, and the query is not made.
  */
  const canHaveTests = assignmentKind === "REPO";

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

  /*
    The newest round that has not been discarded, and null when every one has.

    A discarded round was never sent to anybody, so it is not a state to show or act on — that is
    the whole meaning of `SUPERSEDED`. Reading one as current did two wrong things: it hid a
    released grade behind a report its instructor had just rejected, and on work that had never
    been graded it left the screen with no way forward at all, because the released view offers no
    action on a round it thinks was discarded. Null is the honest answer in that second case, and
    it is the one the rest of this screen already knows how to render: no current round, so offer
    to start one.
  */
  const draft = data.drafts.find((entry) => entry.status !== "SUPERSEDED") ?? null;

  /*
    Rounds worth listing under the grade. A discarded round was never sent to anybody, so it is
    not previous feedback and does not belong in a list called that. The row stays in the
    database — a report that cost a model call and a report an instructor rejected are both
    things a later judgment about the grading wants — and off a screen whose subject is one
    student's record.
  */
  const history = data.drafts.filter((entry) => entry.status !== "SUPERSEDED");

  // The run that describes the code currently on the pull request. An older run is not
  // evidence about this commit, so it is not offered as if it were.
  const currentRun = testRuns.data?.runs.find((run) => run.headSha === submission.headSha) ?? null;

  /*
    Handed to `DraftBody` rather than placed here, because where the evidence belongs depends
    on what is being reviewed: below the report and its rubric breakdown when there is a
    report, and below the panel that offers to write one when there is not. The report is what
    an instructor is here to read; the evidence is why it says what it says, and that is a
    question asked second.
  */
  const testEvidence = canHaveTests ? (
    <TestEvidence
      submissionId={submission.id}
      runs={testRuns.data}
      currentRun={currentRun}
      loading={testRuns.isPending}
      now={now}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <ReviewHeader
        submission={submission}
        draft={draft}
        studentHref={studentHref}
        actionsRef={setActionsSlot}
      />

      <HeaderActionsSlot.Provider value={actionsSlot}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            {/*
              The work itself, first.

              Reading it is what an instructor came to this screen to do, and every card below is
              about it — so on a graded submission the document sits above the grade it was given,
              which is the order the two are read in. It is also the analogue of test evidence for
              work with no suite: the thing the grade rests on.

              Above the grading form rather than inside it, because the form is replaced by the
              editor the moment a round is opened and the file is most needed while the feedback
              is being written.
            */}
            {submission.uploadFilename && (
              <UploadedFileRow
                submissionId={submission.id}
                filename={submission.uploadFilename}
                sizeBytes={submission.uploadSizeBytes}
                isLate={submission.isLate ?? false}
                label="What the student uploaded"
                // Open on arrival. Reading the work is why the instructor is on this screen, and
                // a cohort of resumes graded by downloading each one in turn is most of the work
                // of grading them.
                previewByDefault
              />
            )}

            {/*
              The link a student handed in, beside the uploaded file and above everything about
              the grade, because the work is most needed while the feedback is being written and
              the cards below it change as a round is opened and released. An instructor reading
              the document keeps the way to it for the whole of the grading.

              The address is shown rather than hidden behind the button, which is what
              `SubmittedLinkRow` exists for.
            */}
            {submission.submittedUrl && (
              <SubmittedLinkRow
                url={submission.submittedUrl}
                label="What the student submitted"
                isLate={submission.isLate ?? false}
              />
            )}

            <CommentRecoveryNotice submission={submission} grade={data.grade} />

            {/*
              The provider sits here rather than around the whole pane because this is everything
              that reads it: the section cards are inside, and a card that opens its feedback box
              is rebuilt around a round a moment later.
            */}
            <FeedbackBoxes.Provider value={feedbackBoxes}>
              <DraftBody
                key={draft?.id ?? "none"}
                submission={submission}
                assignmentTitle={assignmentTitle}
                completionThreshold={completionThreshold}
                draft={draft}
                data={data}
                testEvidence={testEvidence}
              />
            </FeedbackBoxes.Provider>

            {history.length > 1 && <DraftHistory drafts={history} activeId={draft?.id} now={now} />}
          </div>
        </div>
      </HeaderActionsSlot.Provider>
    </div>
  );
}

/**
 * "Ana, Ben, Chi and Dev" — a list a person reads rather than one a program prints.
 *
 * Its own function because the release dialog is the one place the whole team is spelled out, and
 * a comma-joined list there would read as data at the moment somebody is being asked to check it.
 */
function listNames(members: { displayName: string | null; email: string | null }[]): string {
  const names = members.map((member) => member.displayName ?? member.email ?? "Unknown");
  if (names.length <= 1) return names[0] ?? "Nobody";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function ReviewHeader({
  submission,
  draft,
  studentHref,
  actionsRef,
}: {
  submission: QueueSubmission;
  draft: Draft | null;
  studentHref?: string;
  /** Filled by whatever is being reviewed — see `HeaderActionsSlot`. */
  actionsRef: (node: HTMLDivElement | null) => void;
}) {
  /*
    A member's own record, built from the link this screen was already given.

    `studentHref` names the student whose row is open, so swapping the id in it is how each
    teammate gets a link without this component being told the course. It is optional — the
    student overview passes none — and where it is absent nobody is linked.
  */
  const memberHref = (memberId: string) =>
    studentHref ? studentHref.replace(submission.student.id, memberId) : "";

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        {/*
          The name, the handle, and the way to the code on one row.

          One link, never two. The pull request is where the work, the commits, and the graded
          diff all are, and a closed pull request still opens, so nothing is lost when a student
          closes theirs. The repository stands in only where there is no pull request to open
          yet — a student who has accepted the assignment and not pushed anything — because that
          is the one state in which an instructor otherwise has no way to the student's code.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            {submission.team ? (
              /*
                The team, not a member of it. What is being read is one piece of work that four
                people did, and heading it with whichever of them happened to claim the row would
                name somebody the report is not about — and would be the same name for every team
                whose work they claimed.

                Unlinked, deliberately: a link on a person's name goes to their record, and a team
                has none. The members below are each linked instead.
              */
              submission.team.name
            ) : studentHref ? (
              <Link href={studentHref} className="hover:underline">
                {submission.student.displayName ?? submission.student.email ?? "Unknown student"}
              </Link>
            ) : (
              (submission.student.displayName ?? submission.student.email ?? "Unknown student")
            )}
          </h2>
          {/*
            The handle only where the repository is named after it. A team's repository is named
            after the team, so a member's handle here would suggest it was theirs.
          */}
          {!submission.team && submission.student.githubUsername && (
            <span className="text-sm text-muted-foreground">
              @{submission.student.githubUsername}
            </span>
          )}
          {submission.prUrl ? (
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-1")}
            >
              <GitPullRequest data-icon="inline-start" />
              PR #{submission.prNumber}
              <ExternalLink data-icon="inline-end" />
            </a>
          ) : (
            submission.repoUrl && (
              <a
                href={submission.repoUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-1")}
              >
                <FolderGit2 data-icon="inline-start" />
                Repository
                <ExternalLink data-icon="inline-end" />
              </a>
            )
          )}
        </div>
        {/*
          Who is on the team, and which of them handed in the version being read.

          Named rather than counted, because the release below goes to all of them and a count
          cannot show a team whose membership is wrong. Each name links to that fellow's own
          record, which is the question a report prompts about a member — the heading above cannot
          carry that link, because a team has no record of its own.
        */}
        {submission.team && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            <Users className="size-3.5 shrink-0" />
            <span>{submission.team.setName}</span>
            <span aria-hidden>·</span>
            {submission.team.members.map((member, index) => {
              const label = member.displayName ?? member.email ?? "Unknown";
              const href = memberHref(member.id);
              return (
                <span key={member.id}>
                  {href ? (
                    <Link href={href} className="text-foreground hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-foreground">{label}</span>
                  )}
                  {index < submission.team!.members.length - 1 && ","}
                </span>
              );
            })}
            {submission.team.handedInBy && (
              <span>
                · handed in by{" "}
                <span className="text-foreground">
                  {submission.team.handedInBy.displayName ?? "a member"}
                </span>
              </span>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SubmissionStatusBadge status={submission.status} />
          {draft && draftStatusAddsSomething(draft.status) && (
            <DraftStatusBadge status={draft.status} />
          )}
          {submission.isLate && (
            <Badge variant="outline" className="font-normal">
              Late
            </Badge>
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
  grade: DraftList["grade"];
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const retry = useMutation(
    trpc.gradingDrafts.retryComment.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Comment posted to the pull request.");
        },
      }),
    ),
  );

  // Only a real failure. `not_applicable` — a hand-graded assignment with no pull request
  // — is a finished grade, and offering it a retry would offer a button that cannot
  // succeed against a fault that does not exist.
  if (grade?.delivery !== "failed") return null;

  return (
    <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      <AlertTriangle className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>The feedback comment was never posted</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>
          This grade is recorded and the student can see it in the application, but the comment did
          not reach the pull request. The score is safe; only the comment is missing.
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
          {retry.isPending ? "Posting…" : "Post the comment"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Test evidence, shown in every state and below the report in each of them, because it is
 * what the report's claims rest on rather than the thing being reviewed.
 */
function TestEvidence({
  submissionId,
  runs,
  currentRun,
  loading,
  now,
}: {
  submissionId: string;
  runs: RouterOutputs["testRuns"]["listForSubmission"] | undefined;
  currentRun: RouterOutputs["testRuns"]["listForSubmission"]["runs"][number] | null;
  loading: boolean;
  now: Date;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const start = useMutation(
    trpc.testRuns.start.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Test run finished.");
        },
      }),
    ),
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
              {start.isPending ? "Running the suite…" : currentRun ? "Run again" : "Run tests"}
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
  testEvidence,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
  completionThreshold: number;
  draft: Draft | null;
  data: DraftList;
  /** The test evidence card, or null on an assignment that cannot have a suite. */
  testEvidence: React.ReactNode;
}) {
  if (!draft) {
    if (submission.status === "NOT_STARTED" || submission.status === "ACCEPTED") {
      return (
        <>
          <StateCard
            icon={GitPullRequest}
            title="Nothing submitted yet"
            description={
              data.manualOnly
                ? "This student has not submitted this assignment, so there is nothing to grade."
                : "This student has a repository but has not opened a pull request, so there is nothing to grade."
            }
          />
          {testEvidence}
        </>
      );
    }
    // One of the two, never both. Which one is decided on the server, from the same reading
    // of the assignment that put this submission in its triage bucket.
    return (
      <>
        {data.manualOnly ? (
          <BlankHandGrade submission={submission} data={data} />
        ) : (
          <GeneratePanel submission={submission} data={data} label="Generate report" />
        )}
        {testEvidence}
      </>
    );
  }

  if (draft.status === "GENERATING") {
    return (
      <>
        <StateCard
          icon={Loader2}
          spin
          title="Generating the report"
          description="A run is in progress. It reads the submission against the rubric and takes up to a couple of minutes."
        />
        {testEvidence}
      </>
    );
  }

  // Surfaced before approval is attempted, because approval refuses it outright. The
  // instructor read a report about one commit; attaching it to different code would
  // record a grade for work nobody has looked at.
  const stale =
    data.currentHeadSha !== null &&
    draft.headSha !== data.currentHeadSha &&
    draft.approvedAt === null;

  if (draft.status === "FAILED") {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The grading run failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              It failed before producing a report. This is an infrastructure error and not a score
              of zero — nothing has been sent to the student.
            </p>
            {draft.errorDetail && (
              <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
                {draft.errorDetail}
              </pre>
            )}
          </AlertDescription>
        </Alert>
        <GeneratePanel submission={submission} data={data} label="Try again" retry />
        {testEvidence}
      </div>
    );
  }

  if (draft.status === "APPROVED") {
    return (
      <ReleasedBody submission={submission} draft={draft} data={data} testEvidence={testEvidence} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {stale && (
        <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
          <RotateCcw className="text-amber-600 dark:text-amber-400" />
          <AlertTitle>This report describes older code</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              The report was written against <code>{shortSha(draft.headSha)}</code>, and the pull
              request is now at <code>{shortSha(data.currentHeadSha)}</code>. Approving is refused
              while that is true — generate a new report so the grade describes the code that is
              there.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {draft.errorDetail && (
        <FindingsNotice draft={draft} hasSections={draft.sections.length > 0} />
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
          testEvidence={testEvidence}
        />
      ) : (
        <>
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
          {testEvidence}
        </>
      )}

      {stale && (
        <GeneratePanel submission={submission} data={data} label="Generate a new report" retry />
      )}
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
  if (typeof withheld !== "object" || withheld === null) return null;

  const record = withheld as Record<string, unknown>;
  const count = typeof record.count === "number" ? record.count : 0;
  if (count === 0) return null;

  const byReason =
    typeof record.byReason === "object" && record.byReason !== null
      ? (record.byReason as Record<string, unknown>)
      : {};
  const reasons = Object.entries(byReason).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  const examples = Array.isArray(record.examples)
    ? record.examples.filter((example): example is string => typeof example === "string")
    : [];

  const secret = reasons.some(
    ([reason]) => reason === "environment file" || reason === "credential file",
  );

  return (
    <Alert
      className={secret ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : undefined}
    >
      {secret ? <AlertTriangle className="text-amber-600 dark:text-amber-400" /> : <EyeOff />}
      <AlertTitle>
        {secret
          ? "This submission commits a secret"
          : count === 1
            ? "1 committed file was kept out of the report"
            : `${count} committed files were kept out of the report`}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>
          {secret
            ? "The student committed an environment file or a private key. It was not sent to the model, and it is still in the repository — deleting it does not remove it from the history, so tell the student to replace the credential itself."
            : "These are build output, dependency trees, or editor files, so the model never saw them. Nothing in the report rests on them."}
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
            {examples.slice(0, 5).join(", ")}
            {count > 5 ? ", …" : ""}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * What the cross-check could not reconcile, named.
 *
 * Rendered from `errorDetail` rather than from a status, because every report is reviewed
 * before anybody sees it and a status saying "needs review" implied the others did not. This
 * says where to look instead of whether to look.
 */
function FindingsNotice({ draft, hasSections }: { draft: Draft; hasSections: boolean }) {
  const reasons = (draft.errorDetail ?? "")
    .split("\n")
    .map((reason) => reason.trim())
    .filter(Boolean);

  return (
    <Alert className="border-violet-500/40 text-violet-700 dark:text-violet-300">
      <AlertTriangle className="text-violet-600 dark:text-violet-400" />
      <AlertTitle>The cross-check found something</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>
          These are the parts of the report the pipeline could not reconcile.{" "}
          {hasSections
            ? "Check them against the code and the tests before approving."
            : "Grade this one directly from the pull request."}
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
  const settled = useServerMutation();

  return useMutation(
    trpc.gradingDrafts.generate.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Report generated. Nothing has been sent to the student.");
        },
      }),
    ),
  );
}

/**
 * How long to wait after the last keystroke before the round is opened.
 *
 * Opening it replaces this form with the editor, which means new boxes: what has been typed is
 * written to the server first and comes back in them, but the caret does not. Waiting for a pause
 * keeps the swap out of the middle of a number being typed — "18" is two keystrokes, and the
 * first of them must not carry the score away.
 */
const OPEN_AFTER_TYPING_MS = 700;

/** What an instructor has typed into one section before there is a round to hold it. */
type Written = { score: number | null; report: string };

/**
 * The hand-graded round, before there is a round.
 *
 * A grade written by hand is a `GradingDraft` like any other and has to exist before a score can
 * be stored against it. But asking an instructor to press a button to bring one into being put a
 * step in front of the work that told them nothing they did not already know, so the form is on
 * the screen from the start: one card per section the assignment declares, an empty score box, and
 * an empty feedback box. Typing into either is what opens the round, and what was typed is written
 * onto the sections the moment they exist — so the round arrives holding the instructor's first
 * sentence rather than blank, and the score, the discard and the release appear in the header
 * where they do for every other round.
 *
 * **Reading the screen creates nothing.** A submission opened, looked at and left alone leaves no
 * round behind, and a score typed and then taken back out again opens none either. That is what
 * keeps triage counting work somebody actually started rather than work somebody glanced at.
 */
function BlankHandGrade({
  submission,
  data,
  revision = false,
}: {
  submission: QueueSubmission;
  data: DraftList;
  /**
   * Whether this is a second round on work that has already been graded once, which changes what
   * the form says above it. "Write the score and the feedback" on a submission with a released
   * report below it says nothing about what happens to the feedback the student has already read.
   */
  revision?: boolean;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const boxes = React.useContext(FeedbackBoxes);

  const start = useMutation(trpc.gradingDrafts.startManual.mutationOptions());
  const updateSection = useMutation(trpc.gradingDrafts.updateSection.mutationOptions());

  const sections = data.handSections;

  const [written, setWritten] = React.useState<Record<string, Written>>({});
  const [opening, setOpening] = React.useState(false);
  /*
    A refusal, kept on the screen rather than in a toast that goes away.

    Two of them are real: this submission is one member's copy of their team's grade and is not
    where the work is graded, and the request did not arrive. Both leave an instructor typing into
    a form that is saving nothing, so the news has to stay in front of them — and while it is
    there, typing stops asking again, because a paragraph written against a refusal that will not
    change is one refusal repeated at every pause.
  */
  const [failure, setFailure] = React.useState<string | null>(null);

  /*
    The same values, readable from outside a render.

    What is written to the server is sent after a round trip, and what it has to send is what has
    been typed by then rather than what had been typed when the write was scheduled.
  */
  const latest = React.useRef(written);
  const started = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Creates the round and writes what has been typed onto it.
   *
   * Once, however many times it is called: the timer and a click on Edit can both arrive, and two
   * rounds for one submission would leave an instructor choosing between forms, one of which their
   * writing is not in. `startManual` refuses to open a second one as well — this is the half of
   * that rule which does not need a request to enforce it.
   */
  async function openRound() {
    if (started.current) return;
    started.current = true;
    if (timer.current) clearTimeout(timer.current);
    setOpening(true);
    setFailure(null);

    try {
      const draft = await start.mutateAsync({ submissionId: submission.id });

      // Matched by label, which is the section's own name and the one thing both sides hold.
      for (const section of draft.sections) {
        const typed = latest.current[section.sectionType];
        if (!typed) continue;

        const report = typed.report.trim();
        if (typed.score === null && report === "") continue;

        await updateSection.mutateAsync({
          sectionId: section.id,
          reportMarkdown: report === "" ? null : typed.report,
          scoreEarned: typed.score,
        });
      }

      /*
        Both, for the reason `useServerMutation` gives: the round is read through a query in this
        pane and through the server-rendered queue beside it, and a submission that has just
        acquired a round is in a different triage bucket than it was a moment ago.
      */
      void queryClient.invalidateQueries();
      router.refresh();
    } catch (error) {
      // Nothing was opened, so another attempt is allowed — asked for by the button the refusal
      // below carries, rather than by the next keystroke.
      started.current = false;
      setOpening(false);
      setFailure(
        error instanceof Error ? error.message : "This round of feedback could not be opened.",
      );
    }
  }

  function write(sectionType: string, patch: Partial<Written>) {
    const current = latest.current[sectionType] ?? { score: null, report: "" };
    const next = { ...latest.current, [sectionType]: { ...current, ...patch } };
    latest.current = next;
    setWritten(next);

    if (timer.current) clearTimeout(timer.current);

    // A score typed and cleared again, or a sentence deleted back to nothing, opens no round:
    // there is nothing left for one to hold.
    const anything = Object.values(next).some(
      (entry) => entry.score !== null || entry.report.trim() !== "",
    );
    if (!anything || failure !== null) return;

    timer.current = setTimeout(() => void openRound(), OPEN_AFTER_TYPING_MS);
  }

  /*
    An assignment that says it is graded by hand and declares nothing to score by hand. Said
    rather than shown as a form with no boxes in it, because the fix is to the assignment and
    nobody reading a blank screen would know that.
  */
  if (sections.length === 0) {
    return (
      <StateCard
        icon={PencilLine}
        tone="warning"
        title="There is nothing here to score"
        description="This assignment is graded by hand, but none of its sections carries both a name and a point value, so there is nothing to score out of. Correct the assignment's sections, then grade this."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {revision ? (
          <>
            This student handed in revised work and asked for another look. Read what they submitted
            above, then write this round&apos;s score and feedback here. The report above is kept as
            the record of the first round — the student keeps both.
          </>
        ) : (
          <>
            This assignment has nothing the pipeline can read, so it is graded by hand. Read the
            student&apos;s work above, then write the score and the feedback here. Nothing reaches
            the student until you release it.
          </>
        )}
      </p>

      {failure && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>This round of feedback could not be opened</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              {failure} Nothing has been recorded. What you have written is still on the screen, and
              it is saved as soon as the round opens.
            </p>
            <Button size="sm" variant="outline" disabled={opening} onClick={() => void openRound()}>
              {opening ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <RotateCcw data-icon="inline-start" />
              )}
              {opening ? "Opening…" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {sections.map((section) => (
        <SectionEditor
          key={section.label}
          section={{ sectionType: section.label, scorePossible: section.pointValue }}
          score={written[section.label]?.score ?? null}
          report={written[section.label]?.report ?? ""}
          onScore={(value) => write(section.label, { score: value })}
          onReport={(value) => write(section.label, { report: value })}
          startsOpen={boxes.open.includes(section.label)}
          onEditingChange={(open) => {
            boxes.setOpen(section.label, open);
            /*
              Opened on the click rather than on the first keystroke, and this is the one case
              that cannot wait for a pause: the box being asked for belongs to the round, and one
              that has to be replaced mid-sentence would take the sentence with it. Closing a box
              opens nothing.
            */
            if (open) void openRound();
          }}
          /*
            Only the card whose box was asked for. A score typed into another section opens the
            round too, and replacing every report on the screen while it happens would announce
            something about sections nobody touched.
          */
          busy={opening && boxes.open.includes(section.label)}
        />
      ))}
    </div>
  );
}

/**
 * Correcting a grade that has already gone out.
 *
 * The way back into a submission nobody is waiting on. A mistyped score or a sentence read back
 * and regretted had no route at all before this: editing an approved draft is refused, and the
 * only other round was the one a student's resubmission started — so a wrong grade stayed wrong
 * until the student acted, which is the wrong person entirely.
 *
 * Deliberately quieter than the two panels it stands in for. Those are work waiting on the
 * instructor and say so; this is an offer on a submission that is finished, and a card competing
 * with the released report above it would read as though something were wrong with it.
 */
function CorrectionPanel({ submission }: { submission: QueueSubmission }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const revise = useMutation(trpc.gradingDrafts.reviseReleased.mutationOptions(settled()));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Pencil className="size-4 text-muted-foreground" />
          Provide new feedback
        </CardTitle>
        <CardDescription>
          Opens a new round of feedback. The current feedback can be viewed in the feedback history.
          {submission.prUrl && " Releasing posts a second comment to the PR thread."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          disabled={revise.isPending}
          onClick={() => revise.mutate({ submissionId: submission.id })}
        >
          {revise.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Pencil data-icon="inline-start" />
          )}
          {revise.isPending ? "Opening…" : "Open a correction"}
        </Button>
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
          {retry ? "Generate another report" : "Generate a report"}
        </CardTitle>
        <CardDescription>
          Runs the assignment&apos;s tests if they have not run at this commit, then reads the
          submission against the rubric and drafts per-section feedback. It records no grade and
          posts nothing — you review the result first.
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
            {generate.isPending ? "Running tests and grading…" : label}
          </Button>

          {generate.isPending && (
            <span className="text-sm text-muted-foreground">
              A couple of minutes: the test suite takes about half a minute, then the report is
              written. Leaving the page cancels nothing — it finishes and the report appears here.
            </span>
          )}

          {submission.prUrl && !generate.isPending && (
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
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
  testEvidence,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
  completionThreshold: number;
  draft: Draft;
  /** True when something else on the screen already refuses approval, e.g. a stale draft. */
  approvalBlocked: boolean;
  /** True when this assignment is graded by hand, so there is no report to generate again. */
  manualOnly: boolean;
  /** Rendered below the sections: the reports come first, the evidence behind them second. */
  testEvidence: React.ReactNode;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const queryClient = useQueryClient();
  const actionsSlot = React.useContext(HeaderActionsSlot);
  const boxes = React.useContext(FeedbackBoxes);

  /*
    Null where a section has no score yet, which is a different thing from a score of zero and
    has to stay different.

    A hand-written draft starts with every section unscored, so collapsing the two to 0 here meant
    an instructor typing 0 changed nothing this editor could see: the section never counted as
    edited, nothing was sent, and approving then refused it as blank. A genuine zero — an empty
    document, a section not attempted — is a grade an instructor is entitled to give, and the
    approval guard has always been willing to record it. It was never reaching the server.
  */
  const [scores, setScores] = React.useState<Record<string, number | null>>(() =>
    Object.fromEntries(draft.sections.map((s) => [s.id, effectiveScore(s)])),
  );
  const [reports, setReports] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(draft.sections.map((s) => [s.id, effectiveReport(s) ?? ""])),
  );
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const updateSection = useMutation(trpc.gradingDrafts.updateSection.mutationOptions());
  const discard = useMutation(
    trpc.gradingDrafts.discard.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Discarded. Nothing was sent to the student.");
        },
      }),
    ),
  );
  const approve = useMutation(
    trpc.gradingDrafts.approve.mutationOptions(
      settled({
        onSuccess: (result) => {
          setConfirmOpen(false);
          // Named outcomes, because "the comment did not post" is a warning on a repository
          // assignment and a falsehood on one that never had a pull request.
          if (result.delivery === "failed") {
            toast.warning(`Grade recorded, but the comment did not post: ${result.commentError}`);
          } else {
            toast.success(
              result.team
                ? `Released ${result.finalScore}/${result.finalScorePossible} to ${result.team.name} — ${result.team.memberCount} ${result.team.memberCount === 1 ? "fellow" : "fellows"}.`
                : `Released ${result.finalScore}/${result.finalScorePossible} to ${
                    submission.student.displayName ?? "the student"
                  }.`,
            );
          }
        },
        onError: (error) => {
          setConfirmOpen(false);
          toast.error(error.message);
        },
      }),
    ),
  );

  const totalEarned = draft.sections.reduce((sum, s) => sum + (scores[s.id] ?? 0), 0);
  const totalPossible = draft.sections.reduce((sum, s) => sum + (s.scorePossible ?? 0), 0);
  const isComplete = totalPossible > 0 && totalEarned / totalPossible >= completionThreshold;

  const changedSections = draft.sections.filter(
    (s) =>
      (scores[s.id] ?? null) !== effectiveScore(s) ||
      (reports[s.id] ?? "") !== (effectiveReport(s) ?? ""),
  );

  /*
    The same check the approval path performs, run here so the instructor sees it while
    they can still fix it. The server refusing remains the guard — this only moves the
    news earlier.
  */
  const mismatches = draft.sections.flatMap((section) => {
    const text = reports[section.id] ?? "";
    const stated = statedScoreInText(text);
    if (!stated) return [];

    /*
      Nothing to disagree with yet. Reading an unscored section as 0 would announce that "the
      score is 0/10" about a section that has no score, and approving refuses it for the plainer
      reason a moment later.
    */
    const recorded = scores[section.id] ?? null;
    if (recorded === null) return [];

    const possible = section.scorePossible ?? 0;
    if (stated.earned === recorded && stated.possible === possible) return [];

    return [{ section, stated, recorded, possible }];
  });

  const faults = [...new Set(draft.sections.flatMap((s) => s.flags))].filter((code) =>
    ["TEST_RUN_MISSING", "TEST_MATCH_MISSING", "PROTECTED_PATHS_CHANGED"].includes(code),
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
   *
   * The model's raw value, not that value or zero. On a hand-written draft there is no model
   * value at all, so `section.scoreEarned` is null — and comparing a score of 0 against null-or-
   * zero made a deliberate zero look like a withdrawn edit, which is the one score this form
   * could not save.
   */
  async function saveEdits() {
    for (const section of changedSections) {
      const report = reports[section.id] ?? "";
      const score = scores[section.id] ?? null;

      await updateSection.mutateAsync({
        sectionId: section.id,
        reportMarkdown: report.trim() === (section.reportMarkdown ?? "").trim() ? null : report,
        scoreEarned: score === section.scoreEarned ? null : score,
      });
    }
  }

  async function save() {
    await saveEdits();
    toast.success(
      changedSections.length === 1 ? "Change saved." : `${changedSections.length} changes saved.`,
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
            This report carries {faults.length === 1 ? "a fault flag" : "fault flags"} (
            {faults.join(", ")}). Its score is not backed by the test evidence it would normally
            rest on.
          </AlertDescription>
        </Alert>
      )}

      {mismatches.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>A report states a different score than the one being recorded</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              The student reads the report and the gradebook reads the score, so these cannot
              disagree. Change whichever is wrong. Approving is refused until they match.
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
            score={scores[section.id] ?? null}
            report={reports[section.id] ?? ""}
            onScore={(value) => setScores((prev) => ({ ...prev, [section.id]: value }))}
            onReport={(value) => setReports((prev) => ({ ...prev, [section.id]: value }))}
            onReset={() => {
              setScores((prev) => ({ ...prev, [section.id]: effectiveScore(section) }));
              setReports((prev) => ({ ...prev, [section.id]: effectiveReport(section) ?? "" }));
            }}
            unsaved={changedSections.some((changed) => changed.id === section.id)}
            /*
              A box opened before this round existed is still open now. Grading by hand opens the
              round from the box itself, so the card the instructor clicked is rebuilt around a
              draft a moment later — and it has to come back the way they left it.
            */
            startsOpen={boxes.open.includes(section.sectionType)}
            onEditingChange={(open) => boxes.setOpen(section.sectionType, open)}
          />
        ))}
      </div>

      {/*
        After the reports, because it is what their claims rest on rather than the thing being
        reviewed. An instructor reads the feedback the student will read, then scrolls to the
        rubric breakdown and the suite output to see whether it holds up.
      */}
      {testEvidence}

      {actionsSlot &&
        createPortal(
          <>
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Total</span>
                {/*
                  Whether the score clears the completion threshold is said in its colour
                  rather than in a badge beside it: green at or above, red below. The classes
                  come from `completionMeta`, so this pane, the queue, and the student's own
                  page use the same green and the same red to mean the same thing.
                */}
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    completionMeta(isComplete)?.className,
                  )}
                >
                  {totalEarned}
                  <span className="text-muted-foreground"> / {totalPossible}</span>
                </span>
              </div>
              {/*
                Said plainly, next to the number it affects. Approving saves first anyway,
                but an instructor should never have to wonder whether what is on screen is
                what would go out.
              */}
              {unsaved && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {changedSections.length === 1
                    ? "1 unsaved change"
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
                  {updateSection.isPending ? "Saving…" : "Save"}
                </Button>
              )}
              {/*
                The way out, beside the way on. A round opened and then not wanted — a correction
                to a grade that turned out to be right, a report an instructor would rather write
                themselves — otherwise had no exit but approving something, and approving a
                correction nobody needed sends a student a second comment for no reason.

                Discarding hides the round everywhere an instructor looks. The row itself stays,
                which is why the message says nothing was sent rather than nothing was kept.

                Ghost rather than outlined: it is the quietest thing on a bar whose other two
                buttons are the work. And absent while an unreleased grade has unsaved edits in
                it, so the discarding press cannot be the one that was meant for Save.
              */}
              {!unsaved && (
                <Button
                  variant="ghost"
                  disabled={busy || discard.isPending}
                  onClick={() => discard.mutate({ draftId: draft.id })}
                >
                  {discard.isPending && (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  )}
                  {discard.isPending ? "Discarding…" : "Discard this feedback"}
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
            <DialogTitle>
              {submission.team
                ? `Release this grade to ${submission.team.name}?`
                : "Release this grade?"}
            </DialogTitle>
            <DialogDescription>
              {/*
                Every member named, not counted. This is the last moment before four people are
                given a grade, and a count cannot show a team whose membership is wrong — which is
                exactly the mistake worth catching here, since fixing it afterwards means
                correcting several released grades rather than one.
              */}
              {submission.team
                ? `${listNames(submission.team.members)} will each see this score and feedback for ${assignmentTitle}. It is posted once, as a new comment on the team's pull request. Earlier rounds of feedback stay where they are.`
                : `${submission.student.displayName ?? "The student"} will see this score and feedback for ${assignmentTitle}, and it is posted as a new comment on the pull request. Earlier rounds of feedback stay where they are.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">Final score</span>
            <span className="text-sm font-semibold tabular-nums">
              {totalEarned} / {totalPossible}
              {/* The words and the colour both from `completionMeta`, so the queue, this pane,
                  and the student's own page say the same thing in the same green. */}
              <span className={cn("ml-2 font-normal", completionMeta(isComplete)?.className)}>
                {completionMeta(isComplete)?.label}
              </span>
            </span>
          </div>

          {changedSections.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {changedSections.length === 1
                ? "Your edit to one section"
                : `Your edits to ${changedSections.length} sections`}{" "}
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
                ? "Saving your edits…"
                : approve.isPending
                  ? "Releasing…"
                  : "Approve and release"}
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
            ? "Save or undo your changes first — a new report replaces this one."
            : "Grading again runs the tests if needed and writes a fresh report. This one is kept."}
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
        {generate.isPending ? "Grading again…" : "Grade again"}
      </Button>
    </div>
  );
}

/** Which model produced this, from which prompt and which assets. Json, so read loosely. */
function ModelMetaBar({ draft }: { draft: Draft }) {
  const meta = (draft.modelMetadata ?? {}) as Record<string, unknown>;
  const usage = (meta.usage ?? {}) as Record<string, unknown>;

  const asNumber = (value: unknown) => (typeof value === "number" ? value : 0);
  const tokens =
    asNumber(usage.promptTokens) +
    asNumber(usage.completionTokens) +
    asNumber(usage.cachedPromptTokens) +
    asNumber(usage.cacheWriteTokens);

  const items = [
    { label: "Model", value: typeof meta.provider === "string" ? meta.provider : "—" },
    { label: "Prompt", value: typeof meta.promptVersion === "string" ? meta.promptVersion : "—" },
    {
      label: "Rubric",
      value:
        typeof meta.gradingAssetsCommitSha === "string"
          ? shortSha(meta.gradingAssetsCommitSha)
          : "—",
    },
    /*
      A second commit, because the answer keys come from a different repository. Shown rather
      than folded into the one above: "this report was written against these reference
      solutions at this commit" is the question an instructor asks when a score looks wrong,
      and the rubric's commit cannot answer it.
    */
    {
      label: "Answer keys",
      value: typeof meta.answerKeyCommitSha === "string" ? shortSha(meta.answerKeyCommitSha) : "—",
    },
    { label: "Tokens", value: tokens > 0 ? tokens.toLocaleString() : "—" },
  ];

  if (items.every((item) => item.value === "—")) return null;

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
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.label !== "string") return [];
    return [
      {
        label: row.label,
        criterion: typeof row.criterion === "string" ? row.criterion : "",
        scoreEarned: typeof row.scoreEarned === "number" ? row.scoreEarned : 0,
        scorePossible: typeof row.scorePossible === "number" ? row.scorePossible : 0,
        note: typeof row.note === "string" ? row.note : null,
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
  unsaved = false,
  startsOpen = false,
  onEditingChange,
  busy = false,
}: {
  /**
   * Enough of a section to read and to score: what it is called and what it is out of.
   *
   * The rest is what a run produced — a rubric breakdown, flags, a confidence, notes — and it is
   * optional because two callers have none of it. A grade written by hand was produced by a
   * person, and this same card is drawn from the assignment's declared sections before any round
   * exists at all, when there is no row to read a flag off.
   */
  section: Pick<Section, "sectionType" | "scorePossible"> &
    Partial<
      Pick<
        Section,
        | "rubricItems"
        | "flags"
        | "instructorNotes"
        | "confidence"
        | "submissionProcessNote"
        | "editedAt"
      >
    >;
  /** Null when this section has no score yet, which the empty box says and a 0 does not. */
  score: number | null;
  report: string;
  onScore: (value: number | null) => void;
  onReport: (value: string) => void;
  onReset?: () => void;
  /** True when this section differs from what is stored. */
  unsaved?: boolean;
  /** Whether the feedback box is open on arrival — see `FeedbackBoxes`. */
  startsOpen?: boolean;
  /** Told whenever the box is opened or closed, so the answer outlives this card. */
  onEditingChange?: (editing: boolean) => void;
  /**
   * True while the round this card belongs to is being created.
   *
   * The feedback box is not offered until it exists, because a box that is about to be replaced
   * would take whatever was typed into it away with it.
   */
  busy?: boolean;
}) {
  const [editing, setEditing] = React.useState(startsOpen);
  const possible = section.scorePossible ?? 0;
  const rubricItems = readRubricItems(section.rubricItems);
  const flags = section.flags ?? [];
  const instructorNotes = section.instructorNotes ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base">
                Section Report — {sectionLabel(section.sectionType)}
              </CardTitle>
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
                {section.confidence && <ConfidenceBadge confidence={section.confidence} />}
                {flags.map((flag) => (
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
                /*
                  Empty for a section with no score yet, rather than a 0 nobody typed. A hand-
                  written draft opens with every box empty, which is what asks to be filled in —
                  a box reading 0 looks like a score that has already been decided.
                */
                value={score ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  /*
                    Clearing the box means "not scored", not zero. `Number("")` is 0, so without
                    this the two are the same keystroke — and they are the distinction the whole
                    form now rests on.
                  */
                  if (raw.trim() === "") {
                    onScore(null);
                    return;
                  }
                  const parsed = Number(raw);
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
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                What the student will read
              </span>
              <div className="flex items-center gap-1">
                {unsaved && onReset && (
                  <Button size="sm" variant="ghost" onClick={onReset}>
                    <Undo2 data-icon="inline-start" />
                    Undo
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const next = !editing;
                    setEditing(next);
                    onEditingChange?.(next);
                  }}
                >
                  <Pencil data-icon="inline-start" />
                  {editing ? "Preview" : "Edit"}
                </Button>
              </div>
            </div>

            {busy ? (
              <p className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Opening this round of feedback…
              </p>
            ) : editing ? (
              <Textarea
                value={report}
                onChange={(event) => onReport(event.target.value)}
                rows={16}
                /*
                  Focused on opening, which is what a box asked for by a click wants — and the one
                  thing the swap from the blank form to the round cannot carry across on its own.
                */
                autoFocus
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

          {instructorNotes.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <span className="text-[11px] font-medium tracking-wide text-amber-700 uppercase dark:text-amber-300">
                For you, never shown to the student
              </span>
              {instructorNotes.map((note, index) => (
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

      {/*
        The score, line by line, in a card of its own below the report.

        These are two different things read in two different ways: the report is the feedback
        the student receives and the instructor may rewrite, and this is the arithmetic behind
        the number beside it. Nothing in this card is ever shown to the student.
      */}
      {rubricItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-muted-foreground" />
              How this score was reached — {sectionLabel(section.sectionType)}
            </CardTitle>
            <CardDescription>
              One row per rubric criterion, summing to the section score. For you, never shown to
              the student.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
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
          </CardContent>
        </Card>
      )}
    </>
  );
}

/**
 * A round that went out: the score, when it went, and the feedback that went with it.
 *
 * One card rather than a summary above a row of section cards. The score and the words that
 * justify it are one thing an instructor reads together — "9 out of 15" and the paragraph
 * explaining why are not two findings — and separating them meant a heading ("As it was sent")
 * whose only job was to say the cards below belonged to the card above.
 */
function ReleasedGradeCard({ draft, data }: { draft: Draft; data: DraftList }) {
  const percent = scorePercent(data.grade?.finalScore, data.grade?.finalScorePossible);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              Released
            </CardTitle>
            <CardDescription>
              Approved {formatDateTime(draft.approvedAt)}. The student can read this.
            </CardDescription>
          </div>

          {data.grade?.finalScore != null && (
            <div className="flex flex-col items-end">
              <span className="text-2xl font-semibold tabular-nums">
                {data.grade.finalScore}
                <span className="text-base text-muted-foreground">
                  {" "}
                  / {data.grade.finalScorePossible}
                </span>
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "font-normal",
                  data.grade.isComplete
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : "border-destructive/40 text-destructive",
                )}
              >
                {data.grade.isComplete ? "Complete" : "Incomplete"}
                {percent != null ? ` · ${formatPercent(percent)}` : ""}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {draft.sections.map((section, index) => (
          <ReleasedSection key={section.id} section={section} first={index === 0} />
        ))}
      </CardContent>
    </Card>
  );
}

/** A round that went out, read-only. What a student was told is a matter of record. */
function ReleasedBody({
  submission,
  draft,
  data,
  testEvidence,
}: {
  submission: QueueSubmission;
  draft: Draft;
  data: DraftList;
  /** Below what was sent, for the same reason it is below the report while one is being edited. */
  testEvidence: React.ReactNode;
}) {
  /*
    Work handed in again since the grade went out, which is the one state in which a released
    report is not the end of the story.

    Two ways to be in it, because the kinds reach it differently and reading only the second
    left hand-graded work with no way to be graded again: a student declaring a revision ready
    is `RESUBMITTED` whatever the kind, while a repository can also have commits pushed past the
    ones the grade describes. A document or an uploaded file has no commit, so the two columns
    are both null and comparing them says nothing.
  */
  const revised =
    submission.status === "RESUBMITTED" ||
    (submission.headSha !== null && submission.headSha !== submission.gradedHeadSha);

  /*
    The grade, then what it rests on, then the way to change it.

    The grade is read first because it is the answer to the only question that matters once a
    submission is graded: what did this student get. The evidence is why it says that, which is a
    question asked second. And the offer to open another round comes after both, because deciding
    to change a grade is something an instructor does having read it — a button above the report
    invites a correction before there is anything to correct.
  */
  return (
    <div className="flex flex-col gap-4">
      <ReleasedGradeCard draft={draft} data={data} />

      {testEvidence}

      {/*
        Revising a released grade means a new round, not an edit of this one. The student keeps
        both, which is the point of having a history at all.

        Which round is offered depends on whether there is new work to judge. Revised work needs
        assessing from the work itself — a blank draft on a hand-graded assignment, a fresh report
        on one the pipeline can read, which is the same choice `DraftBody` makes for a first
        grade. With no new work, what the instructor came here for is to fix what they wrote, so
        the round opens holding it.
      */}
      {revised ? (
        data.manualOnly ? (
          <BlankHandGrade submission={submission} data={data} revision />
        ) : (
          <GeneratePanel submission={submission} data={data} label="Grade the newer commit" retry />
        )
      ) : (
        <CorrectionPanel submission={submission} />
      )}
    </div>
  );
}

/**
 * One section of a round that went out, inside the card that released it.
 *
 * A block rather than a card of its own, because a card inside a card reads as a separate
 * finding. A rule above every section but the first is what keeps them apart instead.
 */
function ReleasedSection({ section, first }: { section: Section; first: boolean }) {
  const report = effectiveReport(section);

  return (
    <div className={cn("flex flex-col gap-2", !first && "border-t border-border pt-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{sectionLabel(section.sectionType)}</h3>
          {section.flags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {section.flags.map((flag) => (
                <FlagBadge key={flag} code={flag} />
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {effectiveScore(section) ?? "—"}
          <span className="text-muted-foreground"> / {section.scorePossible ?? "—"}</span>
        </span>
      </div>
      {report ? (
        <div className="rounded-md border border-border bg-muted/20 p-4">
          <Markdown content={report} />
        </div>
      ) : (
        /*
          Said rather than left blank. Written feedback is optional — the comments frequently live
          in the document the instructor was reading — so a section with a score and no words is a
          choice somebody made, not something missing. The same sentence the student's own page
          uses, so the two screens describe it the same way.
        */
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No written feedback was recorded for this section.
        </p>
      )}
    </div>
  );
}

/**
 * Every round this submission has been through, newest first.
 *
 * **Rounds, not runs.** A run is something the pipeline does — the tests execute, the model
 * reads the work — and only some rounds are that. A grade written by hand, and a correction
 * copied from the round before it, are rounds of feedback that no run produced, so naming the
 * list after runs described the minority of what is in it.
 *
 * The current round is listed too, marked as such. It is shown in full in the card above, and
 * what this adds for it is its place in the sequence.
 */
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
          Previous feedback ({drafts.length})
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
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                  entry.id === activeId
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-muted/20",
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
                  {/*
                    The commit only where there is one. `shortSha` renders an em dash for null,
                    which on a document or an upload gave every round in the list a dash standing
                    in for a concept those kinds do not have — absent reads as not applicable,
                    where a dash reads as missing.
                  */}
                  <span className="mt-1 font-mono text-xs text-muted-foreground">
                    {entry.headSha ? `${shortSha(entry.headSha)} · ` : ""}
                    {formatRelative(entry.createdAt, now)}
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
  tone = "neutral",
  spin = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  tone?: "neutral" | "warning" | "success";
  spin?: boolean;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className={cn("size-6", toneClass, spin && "animate-spin")} />
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
