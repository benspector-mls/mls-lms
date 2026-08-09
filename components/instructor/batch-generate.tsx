"use client";

import * as React from "react";
import { AlertTriangle, Bot, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useBatchGenerate, type BatchState } from "@/hooks/use-batch-generate";
import { batchLabel, planBatch, type BatchCandidate } from "@/lib/grade/batch";

/**
 * "Generate reports for everything outstanding here."
 *
 * One component for both screens that offer it — an assignment's queue, and a student's record —
 * because the two ask the same question of different axes and the answer should not read
 * differently on each. The caller supplies the candidates and their labels; everything about what
 * a batch covers, what it says, and what it does is here.
 *
 * **The count and the subjects come from one call to `planBatch`.** A button that said twelve and
 * then graded thirteen would be worse than one that said nothing, and the way that happens is two
 * traversals of the same list written a few lines apart.
 */
export function BatchGenerate({
  candidates,
  warmFirst,
  className,
  onStateChange,
}: {
  candidates: readonly BatchCandidate[];
  /**
   * Whether every subject shares a prompt, which decides if the first one runs alone to warm the
   * cache. True on an assignment's queue — one assignment, one rubric, one set of answer keys,
   * many students. False on a student's record, where each row is a different assignment.
   */
  warmFirst: boolean;
  className?: string;
  /** Lets the screen draw a spinner on the rows that are in flight. */
  onStateChange?: (state: BatchState) => void;
}) {
  const { state, run, stop, dismiss } = useBatchGenerate();

  const plan = React.useMemo(() => planBatch(candidates), [candidates]);

  React.useEffect(() => onStateChange?.(state), [state, onStateChange]);

  /*
    A finished run's report survives the refresh that follows it, which is the point: the rows
    behind it have just changed, and the failures are the only remaining record of the ones that
    did not. It is dismissed by hand, or replaced by the next run.
  */
  const finished = !state.running && state.total > 0;

  if (state.running) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled>
            <Loader2 data-icon="inline-start" className="animate-spin" />
            {state.done} of {state.total}
          </Button>
          <Button variant="ghost" size="sm" onClick={stop}>
            Stop
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          A couple of minutes each, several at a time. Leaving this page stops what has not
          started; anything already running finishes and its report lands.
        </p>
      </div>
    );
  }

  if (finished) {
    return (
      <div className={className}>
        <BatchReport state={state} onRetry={(subjects) => run(subjects, { warmFirst })} />
        <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={dismiss}>
          <X data-icon="inline-start" />
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        // Disabled with the reason *in the label* rather than in a tooltip, because the reasons
        // are not interchangeable: a run already in flight resolves itself, hand-graded work
        // never had a report to generate, and everything else is simply done.
        disabled={plan.subjects.length === 0}
        onClick={() => run(plan.subjects, { warmFirst })}
      >
        <Bot data-icon="inline-start" />
        {batchLabel(plan)}
      </Button>
    </div>
  );
}

/** What a finished run leaves behind: what failed, and what never started. */
function BatchReport({
  state,
  onRetry,
}: {
  state: BatchState;
  onRetry: (subjects: BatchCandidate[]) => void;
}) {
  const generated = state.total - state.failures.length - state.skipped.length;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2.5 text-xs">
      <p className="font-medium">
        Generated {generated} of {state.total}.
      </p>

      {state.failures.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {/*
            Each failure carries the server's own sentence rather than a generic one. Every
            refusal `generate` produces is written for the person who hit it — a missing answer
            key names the path, a pull request with none of the declared sections lists what it
            changed — and those are the words that say what to fix.
          */}
          {state.failures.map((failure) => (
            <div key={failure.submissionId} className="flex gap-1.5 text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <span className="font-medium text-foreground">{failure.label}</span> —{" "}
                {failure.message}
              </span>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onRetry(
                state.failures.map((failure) => ({
                  submissionId: failure.submissionId,
                  label: failure.label,
                  bucket: "needs_report",
                })),
              )
            }
          >
            Retry {state.failures.length} that failed
          </Button>
        </div>
      )}

      {/*
        Kept apart from the failures, because "you stopped me" and "this cannot be graded" want
        opposite responses: one is resumed unchanged, the other needs something fixed first.
      */}
      {state.skipped.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground">{state.skipped.length} were not started.</p>
          <Button variant="outline" size="sm" onClick={() => onRetry(state.skipped)}>
            Generate the remaining {state.skipped.length}
          </Button>
        </div>
      )}
    </div>
  );
}
