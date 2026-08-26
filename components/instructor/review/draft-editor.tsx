"use client";

/**
 * A report an instructor is reading and changing: the score, the sections, the rubric behind each
 * one, and what it took to produce it.
 *
 * The unsaved edits live here, which is why the approve action is a portal into the header rather
 * than a control the header draws — see `HeaderActionsSlot`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { statedScoreInText } from "@/lib/grade/report-text";
import { completionMeta, sectionLabel, shortSha } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { SectionEditor } from "@/components/instructor/review/section-editor";
import {
  Draft,
  FeedbackBoxes,
  HeaderActionsSlot,
  QueueSubmission,
  effectiveReport,
  effectiveScore,
  listNames,
  useGenerateReport,
} from "@/components/instructor/review/shared";
/**
 * The editable review.
 *
 * Edits live in local state while they are being made and are written to the server as
 * part of approving, because approval reads the stored draft rather than anything the
 * browser sends it. An edit stored beside the model's output, never over it: the record
 * of what the model actually produced is what any later judgment about the grading has
 * to rest on.
 */
export function DraftEditor({
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
  /** Rendered below the sections: the reports come first, the evidence behind them second. */
  /** True when the column beside the reports is drawing the rubric breakdowns. */
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
          <React.Fragment key={section.id}>
            <SectionEditor
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
                A box opened before this round existed is still open now. Grading by hand opens
                the round from the box itself, so the card the instructor clicked is rebuilt
                around a draft a moment later — and it has to come back the way they left it.
              */
              startsOpen={boxes.open.includes(section.sectionType)}
              onEditingChange={(open) => boxes.setOpen(section.sectionType, open)}
            />
            {/*
              Directly under the report it explains, which is where it belongs while the two are
              in one column. Where the pane is wide enough to hold two, the breakdown is drawn in
              that one instead — see `evidenceAside` — and this stays silent rather than drawing
              it twice.
            */}
          </React.Fragment>
        ))}
      </div>

      {/*
        After the reports, because it is what their claims rest on rather than the thing being
        reviewed. An instructor reads the feedback the student will read, then scrolls to the
        rubric breakdown and the suite output to see whether it holds up. Null where the column
        beside the reports is holding it instead.
      */}

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
