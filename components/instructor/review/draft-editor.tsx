"use client";

/**
 * A report an instructor is reading and changing: the score, the sections, the rubric behind each
 * one, and what it took to produce it.
 *
 * One editor whether or not a round exists yet. A grade written by hand is a `GradingDraft` like
 * any other and has to exist before a score can be stored against it, but the *form* does not:
 * it is drawn from the assignment's declared sections from the first render, the round is created
 * quietly underneath the first score or the first opened feedback box, and nothing on the screen
 * is replaced when it arrives. Sections are keyed by their own label — the one identity the
 * declared section and the stored row share — which is what lets the same boxes, the same focus
 * and the same typed text survive the row coming into existence.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import type { ReleaseGrade } from "@/hooks/use-release-grade";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { panelSurface } from "@/components/ui/card";
import { statedScoreInText } from "@/lib/grade/report-text";
import { completionMeta, sectionLabel, shortSha } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC, useTRPCClient } from "@/trpc/client";
import { SectionEditor } from "@/components/instructor/review/section-editor";
import {
  Draft,
  QueueSubmission,
  Section,
  effectiveReport,
  effectiveScore,
  listNames,
  useGenerateReport,
} from "@/components/instructor/review/shared";

/**
 * How long after the last keystroke an edit is written to the server.
 *
 * Edits live in local state and are saved behind the typing rather than by a button: a short
 * pause writes them, and leaving — a score box blurred, another student opened, the release
 * clicked — flushes whatever the pause has not sent yet. Closing the browser tab inside this
 * window can lose at most this much typing, which is the trade for not wiring beacon machinery
 * to a transport that cannot use it.
 */
const SAVE_DEBOUNCE_MS = 2500;

/** What opening a round in the background hands back: the round, and the sections it created. */
export type OpenedRound = { id: string; sections: { id: string; sectionType: string }[] };

/**
 * What the editor draws before a round exists to draw from: each section's label, what it is out
 * of, and the values it opens holding. Blank for a hand grade being written from nothing; the
 * released values for a correction, which opens holding what the student was sent.
 */
export type Blueprint = {
  key: string;
  scorePossible: number | null;
  score: number | null;
  report: string;
};

/** What the server holds for each section, by the section's label, as far as this editor knows. */
type SavedValues = Record<string, { score: number | null; report: string }>;

/**
 * One row the editor draws: the label both sides hold, what it is out of, and the stored section
 * where a round exists to hold one.
 */
type EditorRow = {
  key: string;
  scorePossible: number | null;
  stored: Section | null;
};

function rowsOf(draft: Draft | null, blueprint: Blueprint[]): EditorRow[] {
  if (draft) {
    return draft.sections.map((section) => ({
      key: section.sectionType,
      scorePossible: section.scorePossible,
      stored: section,
    }));
  }
  return blueprint.map((section) => ({
    key: section.key,
    scorePossible: section.scorePossible,
    stored: null,
  }));
}

function savedOf(rows: EditorRow[], blueprint: Blueprint[]): SavedValues {
  const seeds = new Map(blueprint.map((section) => [section.key, section]));
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      {
        score: row.stored ? effectiveScore(row.stored) : (seeds.get(row.key)?.score ?? null),
        report: row.stored
          ? (effectiveReport(row.stored) ?? "")
          : (seeds.get(row.key)?.report ?? ""),
      },
    ]),
  );
}

function scoresOf(saved: SavedValues): Record<string, number | null> {
  return Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, value.score]));
}

function reportsOf(saved: SavedValues): Record<string, string> {
  return Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, value.report]));
}

export function DraftEditor({
  submission,
  completionThreshold,
  draft,
  blueprint,
  start,
  autoOpen = false,
  approvalBlocked,
  manualOnly,
  onApproved,
  release,
  releasing,
}: {
  submission: QueueSubmission;
  completionThreshold: number;
  /** Null on a submission whose round has not been opened yet. The form works anyway. */
  draft: Draft | null;
  /** What to draw and hold before a round exists — see `Blueprint`. Unread once `draft` is set. */
  blueprint: Blueprint[];
  /**
   * How a round is created when there is none: opening a hand grade, or opening a correction.
   * Absent on a round that can only ever arrive already made — a generated report.
   */
  start?: () => Promise<OpenedRound>;
  /**
   * True when arriving here was itself the request for a round — the pen on a released grade —
   * so the round is created on mount rather than waiting for the first score. A blank hand grade
   * leaves this false: reading the screen creates nothing.
   */
  autoOpen?: boolean;
  /** True when something else on the screen already refuses approval, e.g. a stale draft. */
  approvalBlocked: boolean;
  /** True when this assignment is graded by hand, so there is no report to generate again. */
  manualOnly: boolean;
  /**
   * Called at the moment of release — before the request, not after it — so the screen around
   * this one can move to the next student while the release runs behind them. A release that then
   * fails says so in a toast carrying a way back to this submission.
   */
  onApproved?: () => void;
  /** Runs the release in the background: saving first, then approving, reporting by toast. */
  release: ReleaseGrade;
  /** True while this submission's release is in flight, so the bar does not offer a second one. */
  releasing: boolean;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const settled = useServerMutation();
  const queryClient = useQueryClient();

  const rows = rowsOf(draft, blueprint);

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
    scoresOf(savedOf(rows, blueprint)),
  );
  const [reports, setReports] = React.useState<Record<string, string>>(() =>
    reportsOf(savedOf(rows, blueprint)),
  );
  /** What the server holds, mirrored into state only so the badges and the bar can render it. */
  const [lastSaved, setLastSaved] = React.useState<SavedValues>(() => savedOf(rows, blueprint));

  const [savingCount, setSavingCount] = React.useState(0);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  /*
    A refusal to open the round, kept on the screen rather than in a toast that goes away.

    Two of them are real: this submission is one member's copy of their team's grade and is not
    where the work is graded, and the request did not arrive. Both leave an instructor typing into
    a form that is saving nothing, so the news has to stay in front of them — and while it is
    there, typing stops asking again, because a paragraph written against a refusal that will not
    change is one refusal repeated at every pause. The Try again button, and an Edit click on a
    feedback box, are what ask again.
  */
  const [openFailure, setOpenFailure] = React.useState<string | null>(null);

  /*
    The same values, readable from outside a render. What a save sends is what has been typed by
    the time the request goes out, not what had been typed when it was scheduled.
  */
  const latest = React.useRef({ scores, reports });
  const savedRef = React.useRef<SavedValues>(lastSaved);
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  /** Whether a round exists or has been asked for — the half of `startManual`'s once-only rule that needs no request. */
  const startedRef = React.useRef(draft !== null);
  /** The round being created, so a save scheduled before it exists can wait for its section ids. */
  const openedRef = React.useRef<Promise<OpenedRound> | null>(null);
  /** Save passes run one after another, so two passes never write one section out of order. */
  const chainRef = React.useRef<Promise<void>>(Promise.resolve());
  const timerRef = React.useRef<number | null>(null);
  /** Whether anything was typed this visit, so leaving an untouched pane refetches nothing. */
  const dirtiedRef = React.useRef(false);
  const barRef = React.useRef<HTMLDivElement>(null);

  /*
    Which round this editor's local state belongs to, adjusted during render so a new round never
    paints against the old round's numbers.

    Three transitions mean three different things. From null to an id is the round the
    instructor's own typing just opened arriving from the server — their typing is ahead of it, so
    local state stands and only the bookkeeping updates. From one id to another is a regenerated
    report: what is stored is the truth now, so everything resets from it. From an id to null is a
    discarded round: the form goes back to blank, which is what discarding means.
  */
  const [heldDraftId, setHeldDraftId] = React.useState<string | null>(draft?.id ?? null);
  if ((draft?.id ?? null) !== heldDraftId) {
    const id = draft?.id ?? null;
    setHeldDraftId(id);
    if (heldDraftId === null && id !== null) {
      startedRef.current = true;
    } else {
      const nextRows = rowsOf(draft, blueprint);
      const saved = savedOf(nextRows, blueprint);
      const nextScores = scoresOf(saved);
      const nextReports = reportsOf(saved);
      latest.current = { scores: nextScores, reports: nextReports };
      savedRef.current = saved;
      setScores(nextScores);
      setReports(nextReports);
      setLastSaved(saved);
      startedRef.current = id !== null;
      openedRef.current = null;
      setOpenFailure(null);
      setArmed(false);
    }
  }

  /**
   * Creates the round, once, however many times it is asked.
   *
   * Nothing waits on it: the form keeps working from local state, the promise is kept so saves
   * scheduled before the round exists can wait for its section ids, and when it resolves the one
   * query that reads this round is refreshed in the background — after the typed values have been
   * saved onto it, so what the cache learns is what is on the screen. The server refuses to open
   * a second round; `startedRef` is the half of that rule that needs no request.
   */
  function openRound() {
    if (startedRef.current || draftRef.current !== null || !start) return;
    startedRef.current = true;
    setOpenFailure(null);
    setOpening(true);

    const opened = start();
    openedRef.current = opened;
    opened
      .then(() => queueSave().catch(() => {}))
      .then(() => {
        setOpening(false);
        void queryClient.invalidateQueries({
          queryKey: trpc.gradingDrafts.listForSubmission.queryKey({
            submissionId: submission.id,
          }),
        });
      })
      .catch((error: unknown) => {
        // Nothing was opened, so another attempt is allowed — asked for by the button the
        // refusal carries, or by opening a feedback box, rather than by the next keystroke.
        startedRef.current = false;
        openedRef.current = null;
        setOpening(false);
        setOpenFailure(
          error instanceof Error ? error.message : "This round of feedback could not be opened.",
        );
      });
  }

  /** Where each dirty value goes: the section's id, and the model's raw values null is measured against. */
  async function sectionTargets(): Promise<
    { key: string; id: string; modelReport: string | null; modelScore: number | null }[]
  > {
    const current = draftRef.current;
    if (current) {
      return current.sections.map((section) => ({
        key: section.sectionType,
        id: section.id,
        modelReport: section.reportMarkdown,
        modelScore: section.scoreEarned,
      }));
    }
    /*
      No round and none asked for: nothing to write to, and saving is not what opens one. The
      score blur and the feedback box are — that is what keeps a score typed and cleared again
      from leaving a round behind.
    */
    const opened = openedRef.current;
    if (!opened) return [];
    const round = await opened;
    /*
      Until the refetch delivers the full round, its stored values are known from the blueprint:
      a round opened blank stores nulls, and a correction stores the values it was seeded with.
    */
    const seeds = new Map(blueprint.map((section) => [section.key, section]));
    return round.sections.map((section) => {
      const seed = seeds.get(section.sectionType);
      const seededReport = (seed?.report ?? "").trim();
      return {
        key: section.sectionType,
        id: section.id,
        modelReport: seededReport === "" ? null : (seed?.report ?? null),
        modelScore: seed?.score ?? null,
      };
    });
  }

  /**
   * Writes every section that differs from the last completed save.
   *
   * Two different comparisons, deliberately. Which sections are *dirty* compares against what the
   * server holds. Whether each field is sent as an edit or as null compares against the *model's*
   * values, because null is how an edit is discarded: typing a score back to what the model
   * proposed withdraws the edit rather than making a new one. The model's raw value, not that
   * value or zero — on a hand-written draft there is no model value at all, and comparing a score
   * of 0 against null-or-zero made a deliberate zero look like a withdrawn edit.
   */
  async function saveDirty(): Promise<void> {
    const targets = await sectionTargets();
    if (targets.length === 0) return;

    const current = latest.current;
    const saved = savedRef.current;
    const dirty = targets.filter(
      ({ key }) =>
        (current.scores[key] ?? null) !== (saved[key]?.score ?? null) ||
        (current.reports[key] ?? "") !== (saved[key]?.report ?? ""),
    );
    if (dirty.length === 0) return;

    setSavingCount((count) => count + 1);
    try {
      // In parallel — mutations travel unbatched, one request each — and recorded only if every
      // one of them landed, so a half-saved pass stays dirty and the next pass sends it again.
      await Promise.all(
        dirty.map((target) => {
          const report = current.reports[target.key] ?? "";
          const score = current.scores[target.key] ?? null;
          return client.gradingDrafts.updateSection.mutate({
            sectionId: target.id,
            // An emptied box also goes as null: the input refuses an empty string, and on a
            // hand-written section null and "nothing written" are the same fact.
            reportMarkdown:
              report.trim() === "" || report.trim() === (target.modelReport ?? "").trim()
                ? null
                : report,
            scoreEarned: score === target.modelScore ? null : score,
          });
        }),
      );
      const sent = { ...savedRef.current };
      for (const target of dirty) {
        sent[target.key] = {
          score: current.scores[target.key] ?? null,
          report: current.reports[target.key] ?? "",
        };
      }
      savedRef.current = sent;
      setLastSaved(sent);
      setSaveFailed(false);
    } catch (error) {
      setSaveFailed(true);
      throw error;
    } finally {
      setSavingCount((count) => count - 1);
    }
  }

  /** Queues one save pass behind whatever is already running and answers for that pass alone. */
  function queueSave(): Promise<void> {
    const run = chainRef.current.then(() => saveDirty());
    chainRef.current = run.catch(() => {});
    return run;
  }

  function scheduleSave() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      queueSave().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  function flushNow(): Promise<void> {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return queueSave();
  }

  /*
    The flush that runs when this editor leaves the screen — another student opened, the pane
    put away. The requests go through the raw client and outlive the component; the scoped
    invalidation afterwards is what lets a quick return find what was just saved rather than the
    cache from before it.
  */
  const flushRef = React.useRef(flushNow);
  flushRef.current = flushNow;
  React.useEffect(() => {
    return () => {
      if (!dirtiedRef.current) return;
      void flushRef
        .current()
        .catch(() => {})
        .finally(() => {
          void queryClient.invalidateQueries({
            queryKey: trpc.gradingDrafts.listForSubmission.queryKey({
              submissionId: submission.id,
            }),
          });
        });
    };
  }, [queryClient, trpc, submission.id]);

  /*
    A correction arrives here by a click that already asked for the round, so it is opened on
    mount rather than on the first score — mount-only, like the flush above; the refs carry the
    rest.
  */
  React.useEffect(() => {
    if (autoOpen) openRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function writeScore(key: string, value: number | null) {
    setArmed(false);
    dirtiedRef.current = true;
    const nextScores = { ...latest.current.scores, [key]: value };
    latest.current = { ...latest.current, scores: nextScores };
    setScores(nextScores);
    scheduleSave();
  }

  function writeReport(key: string, value: string) {
    setArmed(false);
    dirtiedRef.current = true;
    const nextReports = { ...latest.current.reports, [key]: value };
    latest.current = { ...latest.current, reports: nextReports };
    setReports(nextReports);
    scheduleSave();
  }

  /**
   * A score box left behind, which is when a score is finished being typed.
   *
   * On a round that does not exist yet this is what opens it — provided something was written,
   * so a box tabbed through or a score typed and cleared again leaves no round behind, and
   * provided no refusal is standing, which is asked again by its own button. Either way the
   * pause's unsent edits are flushed.
   */
  function scoreSettled() {
    if (draftRef.current === null && !startedRef.current && openFailure === null) {
      const anything = rows.some(
        (row) =>
          (latest.current.scores[row.key] ?? null) !== null ||
          (latest.current.reports[row.key] ?? "").trim() !== "",
      );
      if (anything) openRound();
    }
    void flushNow().catch(() => {});
  }

  const discard = useMutation(
    trpc.gradingDrafts.discard.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Discarded. Nothing was sent to the student.");
        },
      }),
    ),
  );

  const totalEarned = rows.reduce((sum, row) => sum + (scores[row.key] ?? 0), 0);
  const totalPossible = rows.reduce((sum, row) => sum + (row.scorePossible ?? 0), 0);
  const isComplete = totalPossible > 0 && totalEarned / totalPossible >= completionThreshold;

  const dirtyKeys = rows
    .filter(
      (row) =>
        (scores[row.key] ?? null) !== (lastSaved[row.key]?.score ?? null) ||
        (reports[row.key] ?? "") !== (lastSaved[row.key]?.report ?? ""),
    )
    .map((row) => row.key);
  const saving = savingCount > 0;
  const unsaved = dirtyKeys.length > 0;

  /*
    The same check the approval path performs, run here so the instructor sees it while
    they can still fix it. The server refusing remains the guard — this only moves the
    news earlier.
  */
  const mismatches = rows.flatMap((row) => {
    const text = reports[row.key] ?? "";
    const stated = statedScoreInText(text);
    if (!stated) return [];

    /*
      Nothing to disagree with yet. Reading an unscored section as 0 would announce that "the
      score is 0/10" about a section that has no score, and approving refuses it for the plainer
      reason a moment later.
    */
    const recorded = scores[row.key] ?? null;
    if (recorded === null) return [];

    const possible = row.scorePossible ?? 0;
    if (stated.earned === recorded && stated.possible === possible) return [];

    return [{ key: row.key, stated, recorded, possible }];
  });

  const faults = [...new Set(rows.flatMap((row) => row.stored?.flags ?? []))].filter((code) =>
    ["TEST_RUN_MISSING", "TEST_MATCH_MISSING", "PROTECTED_PATHS_CHANGED"].includes(code),
  );

  const anythingTyped = rows.some(
    (row) => (scores[row.key] ?? null) !== null || (reports[row.key] ?? "").trim() !== "",
  );
  const canApprove =
    !approvalBlocked &&
    mismatches.length === 0 &&
    totalPossible > 0 &&
    (draft !== null || anythingTyped) &&
    !releasing;

  const releaseLabel = submission.team
    ? submission.team.name
    : (submission.student.displayName ?? "the student");

  /*
    Armed is a state of the bar, not of the page: a click anywhere else, an Escape, or any edit
    stands the button down. No timeout — a pause spent re-reading the total should not silently
    un-arm the button under the hand about to press it.
  */
  React.useEffect(() => {
    if (!armed) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setArmed(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (
        barRef.current &&
        event.target instanceof Node &&
        !barRef.current.contains(event.target)
      ) {
        setArmed(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [armed]);

  /**
   * What the release hands to the hook: everything on the screen saved, then the round's id.
   *
   * Approval reads the stored draft rather than anything the browser sends, so this rejecting is
   * what aborts a release that would otherwise go out missing its last edits.
   */
  async function flushForRelease(): Promise<string> {
    if (draftRef.current === null) openRound();
    await flushNow();
    const current = draftRef.current;
    if (current) return current.id;
    const opened = openedRef.current;
    if (!opened) throw new Error("This round of feedback was never opened.");
    return (await opened).id;
  }

  function releaseNow() {
    setArmed(false);
    /*
      The queue moves on at the click, not at the reply. `onApproved` runs synchronously so the
      list it computes "next" from still contains this submission — and a release that then fails
      comes back as a toast carrying a way here, with the row still in To do after the refresh.
    */
    onApproved?.();
    void release({
      submissionId: submission.id,
      label: releaseLabel,
      flush: flushForRelease,
    });
  }

  function resetRow(key: string) {
    const saved = savedRef.current[key] ?? { score: null, report: "" };
    writeScore(key, saved.score);
    writeReport(key, saved.report);
  }

  return (
    <div className="flex flex-col gap-4">
      {openFailure && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>This round of feedback could not be opened</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              {openFailure} Nothing has been recorded. What you have written is still on the screen,
              and it is saved as soon as the round opens.
            </p>
            <Button size="sm" variant="outline" disabled={opening} onClick={() => openRound()}>
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
              {mismatches.map(({ key, stated, recorded, possible }) => (
                <li key={key}>
                  {sectionLabel(key)}: the text says {stated.earned}/{stated.possible}, the score is{" "}
                  {recorded}/{possible}.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <SectionEditor
            key={row.key}
            section={row.stored ?? { sectionType: row.key, scorePossible: row.scorePossible }}
            score={scores[row.key] ?? null}
            report={reports[row.key] ?? ""}
            onScore={(value) => writeScore(row.key, value)}
            onScoreBlur={scoreSettled}
            onReport={(value) => writeReport(row.key, value)}
            onReset={() => resetRow(row.key)}
            unsaved={dirtyKeys.includes(row.key)}
            /*
              Opened on the click rather than on the first keystroke, because the box being asked
              for belongs to the round. With no round yet, asking for the box is what opens one.
            */
            onEditingChange={(open) => {
              if (open) openRound();
            }}
          />
        ))}
      </div>

      {/*
        The total and the way to release it, pinned (`sticky bottom-0`) to the foot of the form.
        Approving has to be reachable from the bottom of a long report, and the pinned bar keeps
        that exactly while the form is on screen — then parks at the form's end once the reader
        has scrolled past it into the history and the conversation, because a bar for a card that
        is not in view would be a control over something the reader cannot see.
      */}
      <div
        ref={barRef}
        className={cn(
          panelSurface,
          "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 p-3",
        )}
      >
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
                What the autosave is doing, said quietly beside the number it protects — and only
                while something is actually happening: each section's own icon already says saved,
                so a "Saved" here would say it twice.
              */}
          {saving ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </span>
          ) : saveFailed ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Not saved — kept here, and your next change tries again
            </span>
          ) : null}
          {/*
                Every member named, not counted. This is the last moment before several people are
                given a grade, and a count cannot show a team whose membership is wrong — which is
                exactly the mistake worth catching here, since fixing it afterwards means
                correcting several released grades rather than one.
              */}
          {armed && submission.team && (
            <span className="max-w-sm text-xs text-muted-foreground">
              Releases to {listNames(submission.team.members)}.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/*
                The way out, beside the way on. A round opened and then not wanted — a correction
                to a grade that turned out to be right, a report an instructor would rather write
                themselves — otherwise had no exit but approving something, and approving a
                correction nobody needed sends a student a second comment for no reason.

                Discarding hides the round everywhere an instructor looks. The row itself stays,
                which is why the message says nothing was sent rather than nothing was kept.
              */}
          {draft && !armed && (
            <Button
              variant="ghost"
              disabled={discard.isPending || releasing}
              onClick={() => discard.mutate({ draftId: draft.id })}
            >
              {discard.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {discard.isPending ? "Discarding…" : "Discard"}
            </Button>
          )}
          {/*
                Two presses where a dialog used to stand. The first arms the button and renames it
                to say exactly what the second does and to whom; the second releases and the queue
                moves on without waiting for the reply.
              */}
          {armed ? (
            <>
              {/*
                The way to stand the button down, visible. Escape and a click elsewhere both
                cancel too, but an armed destructive button whose only exits are invisible asks
                the instructor to already know them.
              */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setArmed(false)}
                title="Cancel"
                aria-label="Cancel the release"
              >
                <X />
              </Button>
              <Button variant="destructive" onClick={releaseNow}>
                <CheckCircle2 data-icon="inline-start" />
                Release Feedback
              </Button>
            </>
          ) : (
            <Button disabled={!canApprove} onClick={() => setArmed(true)}>
              {releasing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckCircle2 data-icon="inline-start" />
              )}
              {releasing ? "Releasing…" : `Approve ${totalEarned}/${totalPossible}`}
            </Button>
          )}
        </div>
      </div>

      {/*
        Absent when there is nothing to generate. Offering "grade again" on a hand-written
        draft would offer to replace the instructor's own writing with a report the pipeline
        cannot produce — and their way of starting over is to edit what is in front of them.
      */}
      {!manualOnly && draft && (
        <RegenerateRow submissionId={submission.id} unsaved={unsaved || saving} />
      )}

      {/*
        Last, because it is provenance rather than part of the review: which model wrote
        this, from which prompt, against which commit of the grading assets. Worth being
        able to find when a report reads oddly, and worth nothing while reading one.
      */}
      {draft && <ModelMetaBar draft={draft} />}
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
 * Refused while an edit is still being written or sent. A new report supersedes this one, and an
 * edit stored against a superseded draft is no longer what anybody reads — losing an instructor's
 * writing to a button they pressed for a different reason is not a trade worth making. With
 * saving automatic, the refusal clears itself within seconds.
 */
function RegenerateRow({ submissionId, unsaved }: { submissionId: string; unsaved: boolean }) {
  const generate = useGenerateReport();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">Not happy with this report?</span>
        <span className="text-xs text-muted-foreground">
          {unsaved
            ? "Your latest change is still being saved — a moment, then this offers again."
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
