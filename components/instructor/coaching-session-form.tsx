"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { CoachingSnapshotPanel } from "@/components/coaching-snapshot-panel";
import { GoalMarkerBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { CHECK_IN_PROMPTS, TEMPERATURE_MAX, TEMPERATURE_MIN, parseSnapshot } from "@/lib/coaching";
import { displayNameOf } from "@/lib/people";
import { formatDateTime } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type SessionData = RouterOutputs["coaching"]["session"];

const SAVE_DEBOUNCE_MS = 2500;

/** The staff-only half of the form, as the autosave holds it between a keystroke and a write. */
type PendingSave = { temperature: number | null; answers: Record<string, string> };

/**
 * One coaching conversation: the strip saying what completing will record, the staff-only
 * check-in, and the fellow's own goals to talk through.
 *
 * **The visibility labels are the design.** Every section says who reads it — the temperature and
 * the check-in answers are marked staff-only, the goals are marked as the fellow's — because the
 * form is on screen during a shared conversation and the person typing should never have to
 * remember which half is which, or which half is even theirs to write.
 *
 * **Nothing here writes a goal.** They belong to the fellow, who sets and edits them on their own
 * screen; this form shows them so a session can be spent guiding somebody to set one or to move
 * where they say they stand. An instructor who thinks an assessment is off the mark says so out
 * loud, which is what the conversation is for.
 *
 * **Autosaved, the draft-editor way.** A coaching conversation is half an hour of prose, and an
 * unpressed Save button is how it gets lost: edits debounce for a moment and then save, blur
 * flushes, and a quiet "Saved" line says when. The save mutation deliberately skips
 * `useServerMutation` — refreshing every server component on a rhythm of keystrokes buys nothing,
 * since what was saved is exactly what is on screen. Completing, which changes what other screens
 * show, does the full refresh.
 *
 * A completed session renders the same layout as a record: the answers as text and the stored
 * snapshot in the strip. Nothing on it is editable, which is the whole of what completing means.
 */
export function CoachingSessionForm({ programId, data }: { programId: string; data: SessionData }) {
  const trpc = useTRPC();
  const completed = data.endedAt !== null;
  const fellowName = displayNameOf(data.student, "the fellow");

  // ---- The staff-only half: temperature and answers, autosaved. --------------------------------

  const [temperature, setTemperature] = React.useState<number | null>(data.temperature);
  const [answers, setAnswers] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(data.answers.map((answer) => [answer.promptId, answer.answer])),
  );
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);

  const save = useMutation(
    trpc.coaching.saveSession.mutationOptions({
      onSuccess: () => setSavedAt(new Date()),
      onError: (error) => toast.error(error.message),
    }),
  );

  /*
    The pending payload, in a ref, so the debounce timer and the flush points read the same value
    without re-arming on every keystroke.
  */
  const pending = React.useRef<PendingSave | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = React.useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const held = pending.current;
    if (held === null) return;
    pending.current = null;

    save.mutate({
      programId,
      sessionId: data.id,
      temperature: held.temperature,
      answers: CHECK_IN_PROMPTS.flatMap((prompt) => {
        const answer = held.answers[prompt.id] ?? "";
        return answer.trim() === "" ? [] : [{ promptId: prompt.id, answer }];
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save.mutate is stable
  }, [programId, data.id]);

  const queue = (next: PendingSave) => {
    pending.current = next;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  // An unmount mid-debounce must not lose the last edits.
  React.useEffect(() => flush, [flush]);

  /*
    One deliberate click rather than a stream of keystrokes, so there is nothing to wait for: the
    debounce exists for typing, and making a choice sit unsaved for two seconds only risks losing
    it.
  */
  const editTemperature = (next: number) => {
    setTemperature(next);
    pending.current = { temperature: next, answers };
    flush();
  };

  const editAnswer = (promptId: string, value: string) => {
    const next = { ...answers, [promptId]: value };
    setAnswers(next);
    queue({ temperature, answers: next });
  };

  // ---- Completing. -----------------------------------------------------------------------------

  const settled = useServerMutation();
  const [confirming, setConfirming] = React.useState(false);
  const complete = useMutation(
    trpc.coaching.completeSession.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success(`Shared with ${fellowName}.`);
          setConfirming(false);
        },
      }),
    ),
  );

  const strip = completed ? parseSnapshot(data.snapshot) : data.figures;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">
          {completed
            ? `Recorded when this session was completed, ${formatDateTime(data.endedAt!)}. The fellow sees this.`
            : "What you are both looking at is what will be recorded when you complete this session. The fellow will see it."}
        </p>
        {strip === null ? (
          <p className="text-sm text-muted-foreground">The stored record cannot be read.</p>
        ) : (
          <CoachingSnapshotPanel snapshot={strip} compact />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Temperature check" audience="staff" />
        {completed && data.temperature === null ? (
          <p className="text-sm text-muted-foreground">Not asked.</p>
        ) : (
          <TemperatureScale
            value={completed ? data.temperature : temperature}
            disabled={completed}
            onChange={editTemperature}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Check-in" audience="staff" />
        <div className="flex flex-col gap-4">
          {CHECK_IN_PROMPTS.map((prompt) => {
            const stored = data.answers.find((answer) => answer.promptId === prompt.id);
            return (
              <div key={prompt.id} className="flex flex-col gap-1.5">
                {/*
                  A completed session shows the prompt as it was asked — the stored copy — where a
                  draft shows the template's current wording, which is what saving will copy.
                */}
                <Label htmlFor={`coaching-${prompt.id}`} className="text-sm font-medium">
                  {completed && stored ? stored.prompt : prompt.prompt}
                </Label>
                {completed ? (
                  <p className={cn("text-sm", !stored && "text-muted-foreground")}>
                    {stored?.answer || "Not discussed."}
                  </p>
                ) : (
                  <Textarea
                    id={`coaching-${prompt.id}`}
                    value={answers[prompt.id] ?? ""}
                    onChange={(event) => editAnswer(prompt.id, event.target.value)}
                    onBlur={flush}
                    rows={2}
                    maxLength={20_000}
                    placeholder="In their words, roughly."
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">
            {fellowName}&apos;s goals · {data.goals.length}
          </h2>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Theirs to edit
          </Badge>
        </div>
        {/*
          Read-only, and the badge says why: the goals are the fellow's own. A session is where
          they are talked through — guiding somebody to set one, or to move where they say they
          stand — and they do the typing on their own screen, during the conversation or after
          it.
        */}
        <FellowGoals goals={data.goals} />
      </section>

      {!completed && (
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button type="button" onClick={() => setConfirming(true)}>
            Complete session
          </Button>
          <p className="text-xs text-muted-foreground">
            {save.isPending ? (
              "Saving…"
            ) : savedAt !== null ? (
              <>
                Saved ·{" "}
                {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </>
            ) : (
              "Edits save on their own."
            )}
          </p>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete this session?</DialogTitle>
            <DialogDescription>
              {fellowName} will see the performance figures in the strip above, recorded as of this
              moment and dated. The temperature check and the check-in answers stay staff-only, and
              what is recorded cannot be edited afterwards. Their goals are their own either way —
              completing this changes nothing about them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Keep drafting
            </Button>
            <Button
              type="button"
              disabled={complete.isPending}
              onClick={() => {
                flush();
                complete.mutate({ programId, sessionId: data.id });
              }}
            >
              {complete.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Complete and share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The ten points, built once from the bounds the column and the schema already agree on. */
const TEMPERATURE_POINTS = Array.from(
  { length: TEMPERATURE_MAX - TEMPERATURE_MIN + 1 },
  (_, index) => TEMPERATURE_MIN + index,
);

/**
 * The temperature check: ten points with the ends named.
 *
 * **A scale rather than a number box**, because the answer is a position between two named ends
 * and the anchors are what give a 4 its meaning. A number field asks the fellow to make that
 * translation themselves, and it accepts 0, 11, and -3 — which is why choosing a point can only
 * produce a number the column already allows, and the clamping the old input needed is gone.
 *
 * **Native radios sharing one name**, so the arrow keys move along the scale, Tab reaches the
 * group once, and a screen reader reads it as one question with ten answers — all of it the
 * platform's, none of it ours. The input is `sr-only` rather than hidden so it keeps every one of
 * those behaviours; the square beside it is what a pointer sees, and `peer-focus-visible` puts the
 * focus ring on that square when a keyboard moves the selection.
 *
 * A completed session renders the same scale, disabled: a bare "7" would drop the two anchors the
 * number was chosen against, which is most of what it meant.
 */
function TemperatureScale({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-1.5">
      <legend className="pb-1.5 text-sm text-muted-foreground">
        On a scale from {TEMPERATURE_MIN} to {TEMPERATURE_MAX}, how are you feeling at the moment?
      </legend>
      <div className="w-max flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {TEMPERATURE_POINTS.map((point) => (
            <label key={point} className={cn(!disabled && "cursor-pointer")}>
              <input
                type="radio"
                name="coaching-temperature"
                value={point}
                checked={value === point}
                onChange={() => onChange(point)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border border-border text-sm tabular-nums transition-colors",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1",
                  "peer-checked:border-primary peer-checked:bg-primary peer-checked:font-medium peer-checked:text-primary-foreground",
                  disabled ? "text-muted-foreground" : "hover:bg-muted/60",
                )}
              >
                {point}
              </span>
            </label>
          ))}
        </div>

        {/*
          The two ends named, under the numbers they belong to — which is what the `w-max` column
          above is for: left to the fieldset's own width, "Feeling good" would sit at the far edge
          of the form rather than under the 10. This is the whole reason the control is a scale:
          "feeling low" and "feeling good" are what is being answered between.
        */}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Feeling low</span>
          <span>Feeling good</span>
        </div>
      </div>
    </fieldset>
  );
}

/** A section heading that says who reads the section — the form's whole safety story. */
function SectionHeading({
  title,
  audience,
  fellowName,
  completed,
}: {
  title: string;
  audience: "staff" | "fellow";
  fellowName?: string;
  completed?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {audience === "staff" ? (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          Staff only
        </Badge>
      ) : (
        <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-300">
          {completed ? `Shared with ${fellowName}` : `Shared with ${fellowName} on completion`}
        </Badge>
      )}
    </div>
  );
}

/** The fellow's goals as they stand, for talking through. Nothing here is a control. */
function FellowGoals({ goals }: { goals: SessionData["goals"] }) {
  if (goals.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        They have not set any goals yet — a good thing to spend this session on.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
      {goals.map((goal) => (
        <li key={goal.id} className="flex flex-col gap-1 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{goal.competencyName}</span>
            {goal.entryKind === "PITFALL" && (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Pitfall
              </Badge>
            )}
            <span className="ml-auto" />
            <GoalMarkerBadge marker={goal.marker} />
          </div>
          <p className="text-sm">“{goal.entryText}”</p>
          {goal.successCriteria !== "" && (
            <p className="text-sm text-muted-foreground">{goal.successCriteria}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
