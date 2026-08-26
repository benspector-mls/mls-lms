"use client";

/**
 * One round of grading, in whichever state it is in: none yet, being written, failed, ready to
 * read, or released.
 *
 * `DraftBody` is the state machine; everything else in here is one of its branches — the panel
 * that offers to write a report, the first typed word that starts a hand grade, and the panel for
 * correcting a grade that has already gone out.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  EyeOff,
  GitPullRequest,
  Loader2,
  Pencil,
  PencilLine,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Markdown } from "@/components/markdown";
import { FlagBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatPercent, scorePercent, sectionLabel, shortSha } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { DraftEditor } from "@/components/instructor/review/draft-editor";
import { SectionEditor } from "@/components/instructor/review/section-editor";
import {
  Draft,
  DraftList,
  FeedbackBoxes,
  QueueSubmission,
  Section,
  StateCard,
  effectiveReport,
  effectiveScore,
  useGenerateReport,
} from "@/components/instructor/review/shared";
/** Routes to the presentation for whatever state the grading run is actually in. */
export function DraftBody({
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
    /*
      Nothing to say here yet. The card saying so is in the column beside this one, with the work
      it is about, so this column holds only the conversation until there is something to grade.
    */
    if (submission.status === "NOT_STARTED" || submission.status === "ACCEPTED") {
      return null;
    }
    // One of the two, never both. Which one is decided on the server, from the same reading
    // of the assignment that put this submission in its triage bucket.
    // One of the two, never both. Which one is decided on the server, from the same reading
    // of the assignment that put this submission in its triage bucket.
    return data.manualOnly ? (
      <BlankHandGrade submission={submission} data={data} />
    ) : (
      <GeneratePanel submission={submission} data={data} label="Generate report" />
    );
  }

  if (draft.status === "GENERATING") {
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
      </div>
    );
  }

  if (draft.status === "APPROVED") {
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

/** What an instructor has typed into one section before there is a round to hold it. */
type Written = { score: number | null; report: string };

/**
 * The hand-graded round, before there is a round.
 *
 * A grade written by hand is a `GradingDraft` like any other and has to exist before a score can
 * be stored against it. But asking an instructor to press a button to bring one into being put a
 * step in front of the work that told them nothing they did not already know, so the form is on
 * the screen from the start: one card per section the assignment declares, an empty score box, and
 * an empty feedback box. Filling in either one is what opens the round, and what was written is
 * put onto the sections the moment they exist — so the round arrives holding the instructor's
 * first score rather than blank, and the total, the discard and the release appear in the header
 * where they do for every other round.
 *
 * **A score is written when its box is left rather than as it is typed.** Opening the round
 * replaces this form with the editor, which means new boxes: a round opened on the first keystroke
 * of "18" would take away the box the second was meant for. Leaving the box — clicking elsewhere,
 * tabbing on, moving to the next section — is the moment a score is finished, and it is also what
 * happens on the way to anything else an instructor does next. A feedback box is different and
 * opens the round on the click, because the box being asked for belongs to the round.
 *
 * **Reading the screen creates nothing.** A submission opened, looked at and left alone leaves no
 * round behind, and a score typed and then taken back out again opens none either. That is what
 * keeps triage counting work somebody actually started rather than work somebody glanced at.
 */
function BlankHandGrade({ submission, data }: { submission: QueueSubmission; data: DraftList }) {
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
  }

  /**
   * A score box left behind, which is when a score is finished being typed.
   *
   * Nothing happens where nothing was written: a box tabbed through, or a score typed and then
   * cleared out again, leaves no round behind, because there is nothing for one to hold. Nothing
   * happens while a refusal is standing either — that one is asked again by its own button.
   */
  function scoreSettled() {
    const anything = Object.values(latest.current).some(
      (entry) => entry.score !== null || entry.report.trim() !== "",
    );
    if (!anything || failure !== null) return;
    void openRound();
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
          onScoreBlur={scoreSettled}
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
 * A round that went out: the score, when it went, and the feedback that went with it.
 *
 * One card rather than a summary above a row of section cards. The score and the words that
 * justify it are one thing an instructor reads together — "9 out of 15" and the paragraph
 * explaining why are not two findings — and separating them meant a heading ("As it was sent")
 * whose only job was to say the cards below belonged to the card above.
 */
export function ReleasedGradeCard({ draft, data }: { draft: Draft; data: DraftList }) {
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
            <CardDescription>Approved {formatDateTime(draft.approvedAt)}.</CardDescription>
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
}: {
  submission: QueueSubmission;
  draft: Draft;
  data: DraftList;
  /** Below what was sent, for the same reason it is below the report while one is being edited. */
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
    The grade, then the way to change it. The offer to open another round comes second because
    deciding to change a grade is something an instructor does having read it — a button above the
    report invites a correction before there is anything to correct.
  */
  return (
    <div className="flex flex-col gap-4">
      <ReleasedGradeCard draft={draft} data={data} />

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
          <BlankHandGrade submission={submission} data={data} />
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
