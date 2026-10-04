"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import * as React from "react";

import { Markdown } from "@/components/markdown";
import { CheckLevelBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { panelSurface } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MarkdownEditor } from "@/components/markdown-editor";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { describeRetryWait, latestAttempt, MAX_ATTEMPTS, nextAttempt } from "@/lib/checks/attempts";
import { effectiveLevel } from "@/lib/checks/levels";
import { formatDate, formatDateTime } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

import type { CheckAttempt, CheckProgress, Resource } from "./types";

type Check = NonNullable<Resource["check"]>;

/**
 * A check for understanding, beneath the resource it asks about: the question, every attempt the
 * fellow has made at it, and — when one is open — the form for the next.
 *
 * **Closed by default**, the way a note is, so a module with several checks is still a list a
 * fellow can scan. The trigger carries where they stand, so the list answers "which of these have I
 * done" without opening anything.
 *
 * **Every attempt stays on the screen**, oldest first, so a fellow reads how their own
 * understanding moved. The level-3 exemplar appears only when the server sends it, which it does
 * once all three attempts are used; this component never decides that on its own.
 */
export function CheckForUnderstanding({
  check,
  progress,
  teaches,
  readOnly = false,
  now,
}: {
  check: Check;
  /** The fellow's attempts and, once earned, the exemplar. Null before the first attempt. */
  progress: CheckProgress | null;
  /**
   * The person looking teaches the course. They read the question as the cohort does and are not
   * offered the form: an instructor's answer would be refused, and a form that can only fail is
   * worse than none.
   */
  teaches: boolean;
  /**
   * An instructor is looking through this fellow's account. Their attempts are shown and the form
   * for the next one is not, for the reason an instructor is not offered it above: an answer would
   * be refused.
   */
  readOnly?: boolean;
  now: Date;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [open, setOpen] = React.useState(false);

  const submit = useMutation(
    trpc.checks.answer.mutationOptions(settled({ onError: shownInPlace })),
  );

  /*
    The reply to an answer is the whole standing on this check, shown the moment it lands. The
    refreshed page catches up behind it, and whichever holds more attempts is the newer of the two,
    so the screen never steps back to the moment before the answer was sent.
  */
  const current =
    submit.data && submit.data.attempts.length > (progress?.attempts.length ?? 0)
      ? submit.data
      : progress;
  const attempts = current?.attempts ?? [];
  const state = nextAttempt(attempts, check.retryWaitHours, now);
  const latest = latestAttempt(attempts);
  const latestLevel = latest ? effectiveLevel(latest) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(panelSurface, "overflow-hidden")}>
      <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50">
        <span className="min-w-0 flex-1 text-sm font-medium">Check for understanding</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {teaches ? null : attempts.length === 0 ? (
            "Not yet answered"
          ) : (
            <>
              {state.kind === "exhausted"
                ? `All ${MAX_ATTEMPTS} attempts used`
                : `Attempt ${attempts.length} of ${MAX_ATTEMPTS}`}
              {latestLevel && <CheckLevelBadge level={latestLevel} />}
            </>
          )}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
          <Markdown content={check.question} />

          {teaches ? (
            <p className="text-sm text-muted-foreground">
              Fellows answer this here, up to {MAX_ATTEMPTS} times,{" "}
              {describeRetryWait(check.retryWaitHours)} apart. Their attempts are on the Curriculum
              screen.
            </p>
          ) : (
            <>
              {attempts.map((attempt) => (
                <AttemptCard key={attempt.id} attempt={attempt} />
              ))}

              {state.kind === "open" && !readOnly && (
                <AnswerForm
                  checkId={check.id}
                  attemptNumber={state.attempt}
                  retryWaitHours={check.retryWaitHours}
                  pending={submit.isPending}
                  error={submit.error?.message ?? null}
                  onSubmit={(values, clear) =>
                    submit.mutate({ checkId: check.id, ...values }, { onSuccess: clear })
                  }
                />
              )}

              {state.kind === "waiting" && (
                <p className="text-sm text-muted-foreground">
                  You can try again after {formatDateTime(state.until)}.
                </p>
              )}

              {state.kind === "exhausted" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    You have used all {MAX_ATTEMPTS} attempts.
                  </p>
                  {current?.exemplar && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-sm font-medium">What a level-3 answer looks like</p>
                      <Markdown content={current.exemplar} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One attempt: its level, what the review said about it, and what the fellow wrote. */
function AttemptCard({ attempt }: { attempt: CheckAttempt }) {
  const level = effectiveLevel(attempt);
  const overridden = attempt.instructorLevel !== null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          Attempt {attempt.attempt} of {MAX_ATTEMPTS}
        </span>
        <span className="text-xs text-muted-foreground">{formatDate(attempt.submittedAt)}</span>
        {level && <CheckLevelBadge level={level} />}
      </div>

      {/*
        The review's explanation argues for the review's level. Once an instructor has set a
        different one, the explanation may argue for the wrong badge, so it is set aside and the
        fellow is told who decided.
      */}
      {overridden ? (
        <p className="text-sm text-muted-foreground">
          Your instructor set this level after reading your answer.
        </p>
      ) : attempt.explanation ? (
        <p className="text-sm">{attempt.explanation}</p>
      ) : attempt.reviewError ? (
        // A fixed sentence rather than the error itself, which is written for an instructor.
        <p className="text-sm text-muted-foreground">
          Your answer is saved; the review did not run. Your instructor can re-run it.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Your answer</span>
        <div className="text-sm">
          <Markdown content={attempt.answer} />
        </div>
      </div>

      {attempt.wantsHelp && (
        <p className="text-xs text-muted-foreground">
          You asked to go over this with an instructor.
        </p>
      )}
    </div>
  );
}

/**
 * The form for the next attempt. The mutation belongs to `CheckForUnderstanding`, which shows its
 * reply; this owns only what is being typed.
 */
function AnswerForm({
  checkId,
  attemptNumber,
  retryWaitHours,
  pending,
  error,
  onSubmit,
}: {
  checkId: string;
  attemptNumber: number;
  retryWaitHours: number;
  pending: boolean;
  error: string | null;
  /** Sends the attempt; `clear` empties the form, and is called only once the server has it. */
  onSubmit: (values: { answer: string; wantsHelp: boolean }, clear: () => void) => void;
}) {
  const [answer, setAnswer] = React.useState("");
  const [wantsHelp, setWantsHelp] = React.useState(false);
  const fieldId = `check-answer-${checkId}`;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        // Cleared only once the server has it, so a refusal leaves the answer to be sent again.
        onSubmit({ answer: answer.trim(), wantsHelp }, () => {
          setAnswer("");
          setWantsHelp(false);
        });
      }}
    >
      <label className="text-sm font-medium" htmlFor={fieldId}>
        {attemptNumber === 1 ? "Your answer" : `Attempt ${attemptNumber} of ${MAX_ATTEMPTS}`}
      </label>
      <MarkdownEditor
        id={fieldId}
        ariaLabel="Your answer"
        rows={5}
        value={answer}
        maxLength={5_000}
        disabled={pending}
        onChange={setAnswer}
      />
      <p className="text-xs text-muted-foreground">Code blocks work here too.</p>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={wantsHelp}
          disabled={pending}
          onCheckedChange={(next) => setWantsHelp(next === true)}
        />
        I&apos;d like to go over this with an instructor
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || answer.trim() === ""}>
          {pending && <Loader2 data-icon="inline-start" className="animate-spin" />}
          {pending ? "Reviewing…" : "Submit answer"}
        </Button>
        <span className="text-xs text-muted-foreground">
          You can try again {describeRetryWait(retryWaitHours)} after each attempt, up to{" "}
          {MAX_ATTEMPTS} attempts in all.
        </span>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
