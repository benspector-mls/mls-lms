"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import * as React from "react";
import {
  CheckCheck,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Lock,
  MessageSquare,
  RotateCcw,
  Users,
} from "lucide-react";

import { AcceptAssignmentButton } from "@/components/accept-assignment-button";
import { EmptyState } from "@/components/list-states";
import { Markdown } from "@/components/markdown";
import { AssignmentKindBadge, SubmissionStatusBadge } from "@/components/status-badge";
import { SubmittedDocumentRow } from "@/components/submitted-document";
import { UploadedFileRow } from "@/components/uploaded-file";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasAcceptStep, isLinkSubmitted } from "@/lib/assignments/spec";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import {
  acceptAttributeFor,
  checkUpload,
  describeAcceptedTypes,
  formatBytes,
  MAX_UPLOAD_BYTES,
} from "@/lib/uploads/file-types";
import { useTRPC } from "@/trpc/client";
import {
  completionMeta,
  feedbackIsUnread,
  formatDate,
  formatDueDate,
  formatPercent,
  handInMode,
  scorePercent,
  sectionLabel,
  shortSha,
  type HandInMode,
} from "@/lib/status";
import { cn } from "@/lib/utils";

import type { Assignment, Submission } from "./types";

/**
 * One assignment, in a panel over the course list.
 *
 * **A panel rather than a row that expands, and rather than a page of its own.** The list stays
 * visible behind it, which is what a student wants when they are working down a module — and it
 * has an address, which a collapsed row does not. That address is what the dashboard links to.
 *
 * **It costs no query.** Everything here comes from the assignment row the course page already
 * fetched, `assignments.listForCourse` included the approved grading drafts, and their sections
 * arrive already collapsed to the instructor's edits by `effectiveSection` on the server. A
 * procedure of its own would have been a second implementation of a question already answered,
 * and the model's unedited output would have had to travel to a student's browser to make it work.
 *
 * Two tabs, because they answer questions asked at different times: what do I hand in and what
 * did I hand in, then what did my instructor say. The Notes tab is the third and is not built yet.
 */
export function AssignmentPanel({
  assignment,
  open,
  onOpenChange,
}: {
  /** Null while nothing is selected, which is what keeps one panel serving a whole page. */
  assignment: Assignment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /*
    Which tab is showing is deliberately not in the address, unlike which assignment is.

    A link to an assignment is a link to the work; a link to a tab of it is a claim about what the
    reader should look at first, and the answer to that changes with the row rather than with the
    link. Feedback opens when there is feedback, which is the same rule for a dashboard link and a
    row press, and neither needs the URL to say so.
  */
  const submission = assignment?.submissions[0] ?? null;
  const rounds = submission ? feedbackRounds(submission) : [];
  const hasFeedback = rounds.length > 0;

  /*
    Keyed on the assignment so the tab resets when the panel is pointed at a different row.
    Without the key, opening a graded assignment, closing it, and opening an ungraded one would
    leave the selection on a tab that is no longer rendered.
  */
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        Wider than the default, which is 384 pixels and too narrow to read a feedback report in.
        The variant prefix has to match the class it replaces — `tailwind-merge` only drops a
        duplicate when the whole chain agrees, so a bare `sm:max-w-2xl` would leave both widths
        in the list and let source order decide.
      */}
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        {assignment && (
          <PanelBody
            key={assignment.id}
            assignment={assignment}
            submission={submission}
            rounds={rounds}
            hasFeedback={hasFeedback}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({
  assignment,
  submission,
  rounds,
  hasFeedback,
}: {
  assignment: Assignment;
  submission: Submission | null;
  rounds: FeedbackRound[];
  hasFeedback: boolean;
}) {
  // Feedback first when there is any, because a student opening a returned assignment came to
  // read it. Before that there is nothing on that tab and the submission is the whole story.
  const [tab, setTab] = React.useState(hasFeedback ? "feedback" : "submission");

  return (
    <>
      <PanelHeader assignment={assignment} submission={submission} />

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0 my-3">
        {/*
          Offered only when there is a second tab to reach. A lone tab is a label pretending to
          be a control, and an ungraded assignment would carry an empty Feedback tab that reads
          as a page that failed to load.
        */}
        {hasFeedback && (
          <TabsList className="mx-4 mb-3 w-auto self-start">
            <TabsTrigger value="submission">Submission</TabsTrigger>
            <TabsTrigger value="feedback">
              Feedback
              {/*
                A count, because a resubmission is graded afresh rather than as an edit and the
                rounds accumulate. "Feedback 2" says there is more than one report to read, which
                the tab alone cannot.
              */}
              {rounds.length > 1 && (
                <span className="ml-1.5 text-xs text-muted-foreground">{rounds.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
        )}

        {/* The panels scroll, not the panel, so the header stays put while a long report moves. */}
        <TabsContent value="submission" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <SubmissionTab assignment={assignment} submission={submission} />
        </TabsContent>

        <TabsContent value="feedback" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {submission && hasFeedback ? (
            <div className="flex flex-col gap-4">
              <MarkFeedbackRead submission={submission} />
              <FeedbackHistory rounds={rounds} />
            </div>
          ) : (
            <EmptyState
              icon={<MessageSquare />}
              title="No feedback yet"
              description="Your instructor's feedback appears here once it is released."
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * The same facts the row carries, so the panel confirms what was pressed rather than surprising
 * the reader with a different summary of it.
 */
function PanelHeader({
  assignment,
  submission,
}: {
  assignment: Assignment;
  submission: Submission | null;
}) {
  const status = submission?.status ?? "NOT_STARTED";
  const graded = submission?.finalScore != null;
  const verdict = graded ? completionMeta(submission?.isComplete) : null;
  const percent = scorePercent(submission?.finalScore, submission?.finalScorePossible);

  return (
    <SheetHeader className="gap-2 border-b border-border p-4 pr-14">
      <SheetTitle className="text-base leading-snug">{assignment.title}</SheetTitle>

      <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span>{assignment.courseUnit.name}</span>
        {/*
          The separator is only drawn where the two sit on one line. Wrapped — which on a phone is
          every long unit name — it was left stranded at the end of the first line with nothing
          after it, which reads as data that failed to load rather than as punctuation. The gap
          separates them once they stack.
        */}
        <span aria-hidden="true" className="hidden sm:inline">
          ·
        </span>
        <span>{assignment.dueAt ? `Due ${formatDueDate(assignment.dueAt)}` : "No due date"}</span>
      </SheetDescription>

      {/*
        Who this is handed in with, said before anything else about the work.

        A student opening a team assignment needs to know two things at once: that one piece of
        work is expected rather than one each, and who else it belongs to. Both are here rather
        than in the submission tab, because they change what every part of the panel below means —
        the score is the team's, the feedback is the team's, and the Update box replaces something
        a teammate may have handed in.

        `team` is null on individual work and on a team assignment nobody has accepted yet, so this
        is absent rather than saying "no team", which would read as something being wrong.
      */}
      {submission?.team && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
          <Users className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{submission.team.name}</span>
          <span className="text-muted-foreground">
            {submission.team.members.length === 1
              ? "— just you, for now"
              : `— ${submission.team.members
                  .map((member) => member.displayName ?? "a teammate")
                  .join(", ")}`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmissionStatusBadge status={status} audience="student" />
        <AssignmentKindBadge kind={assignment.kind} />

        {/* The score carries the verdict, for the reason it does on the row: "Graded" is blue,
            and green means the completion threshold was met and nothing else. */}
        <span className={cn("text-sm tabular-nums", verdict?.className)}>
          {graded ? (
            <>
              {verdict && <span className="sr-only">{verdict.label}. </span>}
              <span className="font-medium">
                {submission?.finalScore}/{submission?.finalScorePossible}
              </span>{" "}
              <span className={verdict ? undefined : "text-muted-foreground"}>
                {formatPercent(percent)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{assignment.pointValue} pts</span>
          )}
        </span>
      </div>
    </SheetHeader>
  );
}

/**
 * A student saying they have read the report.
 *
 * It gates nothing — resubmitting never waits on it — and the wording avoids implying otherwise.
 * What it does is take the assignment off their dashboard, which is the difference between a list
 * of what needs attention and a list of everything that exists.
 */
function MarkFeedbackRead({ submission }: { submission: Submission }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const mark = useMutation(
    trpc.submissions.markFeedbackReviewed.mutationOptions(settled({ onError: shownInPlace })),
  );

  if (!feedbackIsUnread(submission)) {
    /*
      The date rather than a tick, because the useful fact afterwards is when — a student looking
      at a report from three weeks ago wants to know whether they have been back to it since.
      Nothing is shown at all when the column is somehow empty, which only a row this component
      has never written can be.
    */
    return submission.feedbackReviewedAt ? (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCheck aria-hidden="true" className="size-3.5" />
        Marked as read on {formatDate(submission.feedbackReviewedAt)}
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={mark.isPending}
        onClick={() => mark.mutate({ submissionId: submission.id })}
      >
        <CheckCheck data-icon="inline-start" />
        {mark.isPending ? "Saving…" : "Mark as read"}
      </Button>
      {mark.error && (
        <p className="text-sm text-destructive" role="alert">
          {mark.error.message}
        </p>
      )}
    </div>
  );
}
/**
 * The work: what it is, how it is handed in, and what was handed in. Everything here is
 * student-safe — their own repository and the instructions — never a draft, a flag, or an
 * instructor note.
 *
 * `submission` is null for an assignment nobody has started: a FILE_UPLOAD or EXTERNAL_URL one,
 * where there is no Accept to create the row, and a REPO or GOOGLE_DRIVE one before it is
 * accepted.
 *
 * The feedback is deliberately not here. It was, when this was the inside of a collapsed row and
 * there was one surface for everything; a report and a submission form are two different things
 * to be doing, and the tab beside this one is the whole reason they are now apart.
 */
function SubmissionTab({
  assignment,
  submission,
}: {
  assignment: Assignment;
  submission: Submission | null;
}) {
  const status = submission?.status ?? "NOT_STARTED";
  const revised =
    submission != null &&
    submission.gradedHeadSha != null &&
    submission.headSha != null &&
    submission.headSha !== submission.gradedHeadSha;

  /*
    Graded below the threshold, which is a second attempt outstanding rather than a finished
    assignment. `isComplete` and never a comparison of the score against the threshold — that
    judgment is made once, in `approveDraft`, and the threshold is not sent to a student at all.
  */
  const needsAnotherAttempt =
    assignment.kind === "REPO" && status === "GRADED" && submission?.isComplete === false;

  const inQueue =
    status === "SUBMITTED" ||
    status === "DRAFT_READY" ||
    status === "NEEDS_MANUAL_REVIEW" ||
    status === "GRADING_FAILED";

  /*
    Whether this student may hand in, and what handing in would mean right now.

    Only meaningful for the three kinds with no pull request; a REPO assignment is submitted by
    opening one and neither form below is rendered for it. `instructorHasStarted` is false when
    there is no submission at all, which is the same answer the absent row implies.
  */
  const mode = handInMode(submission?.status ?? null, submission?.instructorHasStarted ?? false);

  // Nothing has been handed out yet, on a kind that hands something out. The panel is where
  // this now lives as well as on the row, because a student who opened the panel to read the
  // instructions should be able to start without closing it again.
  const awaitingAccept =
    (!submission || status === "NOT_STARTED") && hasAcceptStep(assignment.kind);

  return (
    <div className="flex flex-col gap-4">
      {awaitingAccept && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">
            {assignment.kind === "REPO"
              ? "Accept to create your repository"
              : "Accept to get your own copy"}
          </p>
          <p className="text-sm text-muted-foreground">
            {assignment.kind === "REPO"
              ? "This makes a private repository for your work and gives you a draft branch to push to."
              : "This copies the template into your own Drive, where only you and your instructor can open it."}
          </p>
          <AcceptAssignmentButton assignmentId={assignment.id} kind={assignment.kind} />
        </div>
      )}

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

      {assignment.kind === "REPO" && status === "ACCEPTED" && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="mb-2 text-sm font-medium">How to submit</p>
          <ol className="ml-4 list-decimal text-sm text-muted-foreground [&>li]:mt-1">
            {/*
              First, because nothing below it is possible until the invitation is accepted, and
              the invitation is the step a student is most likely to miss — it arrives by email
              rather than on this screen, and GitHub cancels it after 7 days. The warning shown
              when Accept is pressed is a toast that goes away; this is where a student who came
              back a day later reads the same thing.
            */}
            <li>
              Accept the GitHub invitation to your repository, which GitHub emails you and also
              shows when you open the repository. It expires 7 days after you accept the assignment,
              and your instructor has to send a new one after that.
            </li>
            <li>
              Commit and push your work to the <code>draft</code> branch of your repository.
            </li>
            <li>
              Open a pull request from <code>draft</code> into <code>main</code>.
            </li>
            <li>Your instructor reviews the pull request and releases feedback here.</li>
          </ol>
        </div>
      )}

      {/*
        What they handed in, before the box that changes it.

        The order is the point: a student opening a row wants to know what is in first, and the
        form to replace it second. It used to be the other way round, which was harmless while
        the form only ever appeared on work that had not been submitted — and became wrong the
        moment the form started appearing under work that had.

        The address is shown rather than hidden behind the button, so a student can see whether
        the link they pasted is the one they meant. That catches the mistake this whole feature
        exists for at the point it can still be fixed silently.
      */}
      {/*
        Which member handed in what is standing.

        Phrased as "handed in by" rather than naming the reader in the second person, because the
        panel does not know which member is reading it — and the sentence is true and useful either
        way. It sits above the work rather than beside the Update box, because what it explains is
        the work: a member who did not hand this in needs to know that before they consider
        replacing it.
      */}
      {submission?.team &&
        submission.handedInBy &&
        (submission.submittedUrl || submission.uploadFilename || submission.prUrl) && (
          <p className="text-sm text-muted-foreground">
            Handed in by{" "}
            <span className="font-medium text-foreground">
              {submission.handedInBy.displayName ?? "a teammate"}
            </span>
            . Anybody on the team can replace it.
          </p>
        )}

      {submission?.submittedUrl && (
        <SubmittedDocumentRow
          url={submission.submittedUrl}
          label={
            assignment.kind === "GOOGLE_DRIVE" ? "The file you submitted" : "The work you submitted"
          }
          isLate={submission.isLate ?? false}
          /*
            Closed on arrival, unlike the review screen. A student knows what they handed in and
            came here to check that it arrived, which the address answers on its own — and the
            document is one click away for the times they want to look.
          */
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
        A Drive assignment has no pull request to observe, so submitting is an act rather than
        something inferred. `handInMode` decides which act it is — a first submission, a
        correction to work still waiting, or a second attempt after a grade — and `locked` is
        where an instructor has it open, which `assertCanHandIn` refuses server-side.
      */}
      {isLinkSubmitted(assignment.kind) && mode !== "locked" && (
        <SubmitWorkForm
          assignmentId={assignment.id}
          kind={assignment.kind}
          currentUrl={submission?.submittedUrl ?? null}
          mode={mode}
        />
      )}

      {/* The same shape as the Drive form above and offered on exactly the same terms. */}
      {assignment.kind === "FILE_UPLOAD" && mode !== "locked" && (
        <UploadWorkForm
          assignmentId={assignment.id}
          acceptedFileTypes={assignment.acceptedFileTypes}
          mode={mode}
        />
      )}

      {/*
        Why the box is gone, said where the box was.

        A control that silently disappears is the same problem as one that refuses without
        explaining: a student who came here to fix a wrong link needs to know it is too late and
        what happens next, not to find nothing and wonder whether the page is broken.

        It says somebody is reading the work and deliberately not which grading state it is in.
        That distinction is the reason the screen is handed one boolean — see `handInMode`.
      */}
      {mode === "locked" && (
        <Alert>
          <Lock className="size-4" />
          <AlertTitle>This can no longer be changed</AlertTitle>
          <AlertDescription>
            Your instructor is reviewing what you handed in, so it is fixed while they work. Once
            their feedback arrives you can hand in revised work and ask for another look.
          </AlertDescription>
        </Alert>
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
            {assignment.kind === "REPO"
              ? "Your pull request is in. Feedback appears here once it is released."
              : "Your work is in. Feedback appears here once it is released."}
          </AlertDescription>
        </Alert>
      )}

      {status === "RESUBMITTED" ? (
        <Alert>
          <RotateCcw className="size-4" />
          <AlertTitle>Your revision is being reviewed</AlertTitle>
          <AlertDescription>
            You asked for another look. Your most recent feedback is on the Feedback tab; a new
            review will be added there when it is ready.
          </AlertDescription>
        </Alert>
      ) : revised ? (
        <Alert>
          <RotateCcw className="size-4" />
          <AlertTitle>You have pushed changes since this feedback</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              Your feedback describes commit {shortSha(submission.gradedHeadSha)}; your repository
              is now at {shortSha(submission.headSha)}. Pushing on its own does not ask for another
              review — say so when you are finished.
            </p>
            <RequestReviewButton submissionId={submission.id} />
          </AlertDescription>
        </Alert>
      ) : needsAnotherAttempt ? (
        /*
          Below the threshold, on a repository, with nothing pushed since. Without this the panel
          says nothing at all in the one state where the student has the most to do — the score is
          red on the row behind it and the report is on the tab beside it, and neither says what
          to do next.

          No button, because there is nothing yet to ask a review of: `declareResubmission` refuses
          while `headSha` still equals `gradedHeadSha`, so offering it here would hand the student
          an error instead of a second attempt. It appears in the branch above, the moment there is
          a commit to review.

          Only REPO. The other kinds carry their own hand-in form directly above this, and
          `handInMode` already labels it "Submit your revised work" — an alert repeating that would
          be a second instruction for one act.
        */
        <Alert>
          <RotateCcw className="size-4" />
          <AlertTitle>This came back incomplete</AlertTitle>
          <AlertDescription>
            Your feedback is on the tab beside this one. Push your improved work to the same pull
            request, and an <strong>Ask for another review</strong> button will appear here — your
            instructor sees a student still working until you press it.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
/**
 * What the link form is called, per act and per kind.
 *
 * A table rather than nested conditionals, which is what this was: two ternaries deep by two
 * kinds wide, and a third act would have made it three. Laid out flat, the six sentences can be
 * read against each other, which is the only way to notice that "Submit your file" and "Update
 * your file" have to differ by more than a verb — the second one is about a link that is already
 * there.
 */
const LINK_FORM_HEADING: Record<Exclude<HandInMode, "locked">, { drive: string; url: string }> = {
  submit: { drive: "Submit your file", url: "Submit the link to your work" },
  update: { drive: "Change the file you submitted", url: "Change the link you submitted" },
  resubmit: {
    drive: "Submit your revised file",
    url: "Submit the link to your revised work",
  },
};

/**
 * What the button says.
 *
 * "Update" rather than "Submit" on a correction, because the two are different promises: one
 * hands work in and the other swaps what was handed in, and a student pressing "Submit" on work
 * already submitted would reasonably expect a second attempt to be recorded.
 */
const LINK_FORM_BUTTON: Record<Exclude<HandInMode, "locked">, string> = {
  submit: "Submit",
  update: "Update",
  resubmit: "Submit again",
};

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
 *
 * **Also where a wrong link is corrected**, which is the same form doing a different job and is
 * why `mode` exists rather than a `resubmitting` boolean. A student who pasted the instructor's
 * template instead of their own copy previously had no way back: the form was hidden the moment
 * the work entered the queue, so the only route to a correct submission was to wait for a grade
 * on work they knew was wrong and then resubmit.
 */
function SubmitWorkForm({
  assignmentId,
  kind,
  currentUrl,
  mode,
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
  /** Which of the three acts this is. `locked` never reaches here — the caller renders a notice. */
  mode: Exclude<HandInMode, "locked">;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [url, setUrl] = React.useState(currentUrl ?? "");

  const submit = useMutation(
    trpc.submissions.submitWork.mutationOptions(settled({ onError: shownInPlace })),
  );

  const changed = url.trim() !== (currentUrl ?? "");

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate({ assignmentId, submittedUrl: url.trim() });
      }}
    >
      <label className="text-sm font-medium" htmlFor={`submit-url-${assignmentId}`}>
        {LINK_FORM_HEADING[mode][kind === "GOOGLE_DRIVE" ? "drive" : "url"]}
      </label>

      {/*
        What replacing it does, and it is only worth saying in this one mode. A correction
        overwrites — there is one `submittedUrl` column — and a student who assumes both links go
        to their instructor would leave the wrong one thinking it had been added to rather than
        swapped. Nothing about the queue changes, which is the reassuring half and the reason
        this is not phrased as a warning.
      */}
      {mode === "update" && (
        <p className="text-sm text-muted-foreground">This replaces the link above.</p>
      )}
      <p className="text-sm text-muted-foreground">
        {kind === "GOOGLE_DRIVE" ? (
          <>
            Paste the link to <strong>your own copy</strong>, and make sure your instructor can open
            it.
          </>
        ) : (
          <>
            Paste the link to your finished work, and{" "}
            <strong>check that the sharing settings let your instructor open it</strong> — a private
            link looks like nothing was submitted.
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
            kind === "GOOGLE_DRIVE"
              ? "https://docs.google.com/document/d/… or /presentation/d/…"
              : "https://www.canva.com/design/… or https://www.loom.com/share/…"
          }
          className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button
          size="sm"
          type="submit"
          /*
            Nothing to send when the box still holds the link that is already stored. Without
            this, Update is a button that appears to work and changes nothing — the mutation
            would run, rewrite the same URL, and move `submittedAt` for no reason.
          */
          disabled={submit.isPending || url.trim() === "" || (mode === "update" && !changed)}
        >
          {submit.isPending ? "Submitting…" : LINK_FORM_BUTTON[mode]}
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

/** The upload form's three headings, for the reason `LINK_FORM_HEADING` is a table. */
const UPLOAD_FORM_HEADING: Record<Exclude<HandInMode, "locked">, string> = {
  submit: "Upload your file",
  update: "Replace the file you uploaded",
  resubmit: "Upload your revised file",
};

const UPLOAD_FORM_BUTTON: Record<Exclude<HandInMode, "locked">, string> = {
  submit: "Upload",
  update: "Replace",
  resubmit: "Upload again",
};

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
  mode,
}: {
  assignmentId: string;
  acceptedFileTypes: string[];
  /** Which of the three acts this is. `locked` never reaches here — the caller renders a notice. */
  mode: Exclude<HandInMode, "locked">;
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
      body.set("assignmentId", assignmentId);
      body.set("file", file);

      const response = await fetch("/api/submissions/upload", { method: "POST", body });

      if (!response.ok) {
        // The route answers with a message written for a student on every refusal it makes,
        // so this shows what came back rather than a status code.
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "That upload did not go through. Try again.");
        return;
      }

      setFile(null);
      router.refresh();
    } catch {
      setError("That upload did not go through — check your connection and try again.");
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
        {UPLOAD_FORM_HEADING[mode]}
      </label>
      <p className="text-sm text-muted-foreground">
        {describeAcceptedTypes(acceptedFileTypes)}, up to {formatBytes(MAX_UPLOAD_BYTES)}. Your
        instructor is the only person who can open it.
      </p>
      {/*
        The same sentence the link form carries, and it matters more here: an uploaded file
        replaces the stored one outright, so a student who uploads a second file is not adding a
        page to their submission.
      */}
      {mode === "update" && (
        <p className="text-sm text-muted-foreground">
          This replaces the file above. Your work stays where it is in your instructor&apos;s queue
          — correcting it does not put you at the back.
        </p>
      )}
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
          {busy ? "Uploading…" : UPLOAD_FORM_BUTTON[mode]}
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
  const settled = useServerMutation();

  const declare = useMutation(
    trpc.submissions.declareResubmission.mutationOptions(settled({ onError: shownInPlace })),
  );

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={declare.isPending}
        onClick={() => declare.mutate({ submissionId })}
      >
        {declare.isPending ? "Sending…" : "Ask for another review"}
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
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
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
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          <GitPullRequest data-icon="inline-start" />
          Your pull request{submission.isLate ? " (late)" : ""}
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
      key: "submission",
      number: 1,
      gradedAt: submission.gradedAt,
      earned: submission.finalScore,
      possible: submission.finalScorePossible,
      sections: [
        {
          sectionType: "feedback",
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
          {multiRound ? `Review ${round.number}` : "Instructor feedback"}
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
