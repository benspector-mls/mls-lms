"use client";

/**
 * One round of grading, in whichever state it is in: none yet, being written, failed, ready to
 * read, or released.
 *
 * `DraftBody` is the state machine; everything else in here is one of its branches — the panel
 * that offers to write a report, and the panel for correcting a grade that has already gone out.
 * A hand-graded submission with no round yet is not a state of its own: it takes the same editor
 * branch as a round that exists, with `draft` null, so the round arriving replaces nothing on the
 * screen. The editor itself owns that transition — see `DraftEditor`.
 */

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
import type { ReleaseGrade } from "@/hooks/use-release-grade";
import { Markdown } from "@/components/markdown";
import { FlagBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatPercent, scorePercent, sectionLabel, shortSha } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPCClient } from "@/trpc/client";
import { Blueprint, DraftEditor } from "@/components/instructor/review/draft-editor";
import {
  Draft,
  DraftList,
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
  completionThreshold,
  draft,
  data,
  onApproved,
  release,
  releasing,
}: {
  submission: QueueSubmission;
  completionThreshold: number;
  draft: Draft | null;
  data: DraftList;
  /** Called at the moment of release, so the screen around this one can move on immediately. */
  onApproved?: () => void;
  /** Runs the release in the background — see `useReleaseGrade`. */
  release: ReleaseGrade;
  /** True while this submission's release is in flight. */
  releasing: boolean;
}) {
  const client = useTRPCClient();

  /*
    Whether the released grade is being corrected. The pen on the released card flips this and
    nothing else: the correction editor is on screen at the click, seeded from what was sent,
    while `reviseReleased` creates the round underneath it.

    Cleared, during render, whenever the round on top changes — the correction arriving from the
    server routes to the editor on its own, and a correction discarded puts the released card
    back, where leaving this set would open another round on the spot.
  */
  const [correcting, setCorrecting] = React.useState(false);
  const [heldDraftId, setHeldDraftId] = React.useState<string | null>(draft?.id ?? null);
  if ((draft?.id ?? null) !== heldDraftId) {
    setHeldDraftId(draft?.id ?? null);
    if (correcting) setCorrecting(false);
  }

  if (!draft) {
    /*
      Nothing to say here yet. The card saying so is in the column beside this one, with the work
      it is about, so this column holds only the conversation until there is something to grade.
    */
    if (submission.status === "NOT_STARTED" || submission.status === "ACCEPTED") {
      return null;
    }
    // One of the two, never both. Which one is decided on the server, from the same reading
    // of the assignment that put this submission in its triage bucket. A hand-graded
    // submission falls through to the editor below, with no round to hand it yet.
    if (!data.manualOnly) {
      return <GeneratePanel submission={submission} data={data} label="Generate report" />;
    }
    if (data.handSections.length === 0) {
      return <NothingToScore />;
    }
  }

  if (draft?.status === "GENERATING") {
    return (
      <StateCard
        icon={Loader2}
        spin
        title="Generating the report"
        description="A run is in progress. It reads the submission against the rubric and takes up to a couple of minutes."
      />
    );
  }

  if (draft?.status === "FAILED") {
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

  if (draft?.status === "APPROVED" && !correcting) {
    return (
      <ReleasedBody
        submission={submission}
        draft={draft}
        data={data}
        completionThreshold={completionThreshold}
        onApproved={onApproved}
        release={release}
        releasing={releasing}
        onEdit={() => setCorrecting(true)}
      />
    );
  }

  /*
    The released round being corrected, when that is what is happening. The editor is handed no
    draft — the correction round does not exist yet — and a blueprint holding exactly what the
    student was sent, which is also what `reviseReleased` seeds the round with server-side.
  */
  const correction = draft?.status === "APPROVED" ? draft : null;
  const editorDraft = correction ? null : draft;

  const blueprint: Blueprint[] = correction
    ? correction.sections.map((section) => ({
        key: section.sectionType,
        scorePossible: section.scorePossible,
        score: effectiveScore(section),
        report: effectiveReport(section) ?? "",
      }))
    : data.handSections.map((section) => ({
        key: section.label,
        scorePossible: section.pointValue,
        score: null,
        report: "",
      }));

  const start = correction
    ? () => client.gradingDrafts.reviseReleased.mutate({ submissionId: submission.id })
    : data.manualOnly
      ? () => client.gradingDrafts.startManual.mutate({ submissionId: submission.id })
      : undefined;

  // Surfaced before approval is attempted, because approval refuses it outright. The
  // instructor read a report about one commit; attaching it to different code would
  // record a grade for work nobody has looked at.
  const stale =
    editorDraft !== null &&
    data.currentHeadSha !== null &&
    editorDraft.headSha !== data.currentHeadSha &&
    editorDraft.approvedAt === null;

  /*
    One static tree for "no round yet" and "a round being edited", so the moment a round comes
    into being — a hand grade opened by typing, a correction opened by the pen — changes nothing
    about where the editor sits: React keeps the same instance, the same boxes, the same focus.
    That is the whole trick behind opening a draft without interrupting the typing that opened it.
  */
  return (
    <div className="flex flex-col gap-4">
      {stale && editorDraft && (
        <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
          <RotateCcw className="text-amber-600 dark:text-amber-400" />
          <AlertTitle>This report describes older code</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              The report was written against <code>{shortSha(editorDraft.headSha)}</code>, and the
              pull request is now at <code>{shortSha(data.currentHeadSha)}</code>. Approving is
              refused while that is true — generate a new report so the grade describes the code
              that is there.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {editorDraft?.errorDetail && (
        <FindingsNotice draft={editorDraft} hasSections={editorDraft.sections.length > 0} />
      )}

      {editorDraft && <WithheldFilesNotice draft={editorDraft} />}

      {editorDraft === null || editorDraft.sections.length > 0 ? (
        <DraftEditor
          submission={submission}
          completionThreshold={completionThreshold}
          draft={editorDraft}
          blueprint={blueprint}
          start={start}
          autoOpen={correction !== null}
          approvalBlocked={stale}
          manualOnly={data.manualOnly}
          onApproved={onApproved}
          release={release}
          releasing={releasing}
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

      {stale && (
        <GeneratePanel submission={submission} data={data} label="Generate a new report" retry />
      )}
    </div>
  );
}

/*
  An assignment that says it is graded by hand and declares nothing to score by hand. Said
  rather than shown as a form with no boxes in it, because the fix is to the assignment and
  nobody reading a blank screen would know that.
*/
function NothingToScore() {
  return (
    <StateCard
      icon={PencilLine}
      tone="warning"
      title="There is nothing here to score"
      description="This assignment is graded by hand, but none of its sections carries both a name and a point value, so there is nothing to score out of. Correct the assignment's sections, then grade this."
    />
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
export function ReleasedGradeCard({
  draft,
  data,
  onEdit,
}: {
  draft: Draft;
  data: DraftList;
  /**
   * Opens a correction to this grade, offered as a pen on the card itself. Absent where a
   * correction is not what comes next — work handed in again is graded anew instead.
   */
  onEdit?: () => void;
}) {
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
            <CardDescription>{formatDateTime(draft.approvedAt)}</CardDescription>
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

        {/*
          The way to change what went out, at the foot of the thing that went out — where an
          instructor lands having read it, which is when a correction is decided on. A card
          offering to "provide new feedback" underneath said the same thing in a paragraph and
          pushed the conversation down to say it; this opens the correction editor on the click,
          already holding what the student was sent.
        */}
        {onEdit && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A round that went out, read-only. What a student was told is a matter of record. */
function ReleasedBody({
  submission,
  draft,
  data,
  completionThreshold,
  onApproved,
  release,
  releasing,
  onEdit,
}: {
  submission: QueueSubmission;
  draft: Draft;
  data: DraftList;
  completionThreshold: number;
  onApproved?: () => void;
  release: ReleaseGrade;
  releasing: boolean;
  /** Opens a correction to this grade — the pen on the released card. */
  onEdit: () => void;
}) {
  const client = useTRPCClient();

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
      {/*
        The pen on the card opens a correction — a new round pre-filled with what was sent — and
        only where a correction is what comes next. Revised work is graded anew from the work
        itself, by the round offered below, so the pen would be a second, worse way in.
      */}
      <ReleasedGradeCard draft={draft} data={data} onEdit={revised ? undefined : onEdit} />

      {/*
        Revising a released grade means a new round, not an edit of this one. The student keeps
        both, which is the point of having a history at all.

        Which round is offered depends on whether there is new work to judge. Revised work needs
        assessing from the work itself — a blank hand-graded round on a hand-graded assignment, a
        fresh report on one the pipeline can read, which is the same choice `DraftBody` makes for
        a first grade.
      */}
      {revised &&
        (data.manualOnly ? (
          data.handSections.length === 0 ? (
            <NothingToScore />
          ) : (
            <DraftEditor
              submission={submission}
              completionThreshold={completionThreshold}
              draft={null}
              blueprint={data.handSections.map((section) => ({
                key: section.label,
                scorePossible: section.pointValue,
                score: null,
                report: "",
              }))}
              start={() => client.gradingDrafts.startManual.mutate({ submissionId: submission.id })}
              approvalBlocked={false}
              manualOnly={data.manualOnly}
              onApproved={onApproved}
              release={release}
              releasing={releasing}
            />
          )
        ) : (
          <GeneratePanel submission={submission} data={data} label="Grade the newer commit" retry />
        ))}
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
