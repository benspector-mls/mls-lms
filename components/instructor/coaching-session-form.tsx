"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { DataPanel } from "@/components/coaching/data-panel";
import { QuestionField } from "@/components/coaching/question-field";
import { CoachingSnapshotPanel } from "@/components/coaching-snapshot-panel";
import { Trends } from "@/components/instructor/trends";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  isBlankAnswer,
  isPanel,
  parseSnapshot,
  questionsOf,
  type AnswerValue,
} from "@/lib/coaching";
import { programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatSchoolDay, type SchoolDay } from "@/lib/school-time";
import { formatDateTime } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type SessionData = RouterOutputs["coaching"]["session"];

const SAVE_DEBOUNCE_MS = 2500;

/** The staff-only half of the form, as the autosave holds it between a keystroke and a write. */
type PendingSave = {
  temperature: number | null;
  answers: Record<string, AnswerValue>;
  heldOn: SchoolDay;
};

/** The outline entry for the fixed head of every form: the last few weeks and the snapshot. */
export const SESSION_HEAD = { id: "head", label: "Where things stand" } as const;

/**
 * One coaching conversation, drawn from the form it was started with.
 *
 * **Two fixed parts, then the form.** Every session opens the same way: the day it is held, the
 * last few weeks — the same card as the fellow's record, for the coach only — and the data
 * snapshot that completing will record. Everything after that is the session's own `layout`, a
 * copy of the template taken when the session started: its sections in order, each holding the
 * questions and the data panels an admin placed there. The form draws what the layout says and
 * decides nothing itself, which is what lets an admin change the form without a deploy.
 *
 * **The visibility labels are the design.** Every question says who reads its answer — staff
 * only, or shared with the fellow on completion — and every panel says whose it is, because the
 * form is on screen during a shared conversation and the person typing should never have to
 * remember which half is which, or which half is even theirs to write.
 *
 * **Nothing here edits a goal.** They belong to the fellow, who sets and edits them on their own
 * screen; the goals panel shows them so a session can be spent guiding somebody to set one or to
 * move where they say they stand. What an instructor writes on a goal is a comment beneath it.
 *
 * **Autosaved, the draft-editor way.** A coaching conversation is half an hour of prose, and an
 * unpressed Save button is how it gets lost: text answers debounce for a moment and then save,
 * blur flushes, a chosen point or option saves at once, and a quiet "Saved" line says when. The
 * save mutation deliberately skips `useServerMutation` — refreshing every server component on a
 * rhythm of keystrokes buys nothing, since what was saved is exactly what is on screen.
 * Completing, which changes what other screens show, does the full refresh.
 *
 * A completed session renders the same layout as a record: the answers as recorded and the stored
 * figures as its data snapshot. Nothing on it is editable, which is the whole of what completing
 * means — and Discard is gone with the rest, because throwing away an empty form and taking back
 * a snapshot somebody has already read are different acts.
 */
export function CoachingSessionForm({
  programId,
  data,
  today,
}: {
  programId: string;
  data: SessionData;
  /** Read once by the page and handed down, so the server and the browser agree which square is today. */
  today: SchoolDay;
}) {
  const trpc = useTRPC();
  const completed = data.endedAt !== null;
  const fellowName = displayNameOf(data.student, "the fellow");

  // ---- The staff-only half: temperature and answers, autosaved. --------------------------------

  const [temperature, setTemperature] = React.useState<number | null>(data.temperature);
  const [heldOn, setHeldOn] = React.useState<SchoolDay>(data.heldOn);
  const [answers, setAnswers] = React.useState<Record<string, AnswerValue>>(() =>
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
      heldOn: held.heldOn,
      // A blank answer is not sent: an unanswered question is ordinary, not a stored empty.
      answers: Object.entries(held.answers).flatMap(([promptId, answer]) =>
        isBlankAnswer(answer) ? [] : [{ promptId, answer }],
      ),
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
    pending.current = { temperature: next, answers, heldOn };
    flush();
  };

  /*
    The day the conversation is held. A coach who opens the session early to prepare moves it to
    the day they will actually meet; it is what every list dates the session by, on both sides.
    Saved at once, like the temperature: a chosen date is one act, not a stream of keystrokes. The
    browser's date input yields "" while a date is half-typed, which is not a day to save.
  */
  const editHeldOn = (next: string) => {
    if (next === "") return;
    setHeldOn(next);
    pending.current = { temperature, answers, heldOn: next };
    flush();
  };

  /** Text waits for the typing to pause; a chosen point or option is one act and saves at once. */
  const editAnswer = (promptId: string, value: AnswerValue, atOnce: boolean) => {
    const next = { ...answers, [promptId]: value };
    setAnswers(next);
    pending.current = { temperature, answers: next, heldOn };
    if (atOnce) flush();
    else queue(pending.current);
  };

  /** What was recorded, for a completed session: the stored answers by question id. */
  const stored = React.useMemo(
    () => new Map(data.answers.map((answer) => [answer.promptId, answer.answer])),
    [data.answers],
  );

  // ---- Completing. -----------------------------------------------------------------------------

  const settled = useServerMutation();
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);
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

  /*
    Pressing "Start coaching session" on the wrong fellow's record is the mistake this is for, so
    it is offered on drafts and not on completed sessions: those hold a snapshot the fellow has
    already seen, and taking one back is a different act from throwing away an empty form. The
    procedure will delete either — the audit event says which — if that ever needs a button.
  */
  const discard = useMutation(
    trpc.coaching.deleteSession.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Session discarded.");
          router.push(programStudentHref(programId, data.student.id, "coaching"));
        },
      }),
    ),
  );

  const strip = completed ? parseSnapshot(data.snapshot) : data.figures;

  /* How many answers the fellow will see, for the completion dialog to name. */
  const sharedCount =
    data.layout === null
      ? 0
      : questionsOf(data.layout).filter((question) => {
          const answer = answers[question.id];
          return question.shared && answer !== undefined && !isBlankAnswer(answer);
        }).length;

  return (
    <div className="flex flex-col gap-16">
      {/*
        First, before anything else, because it is the one thing a coach who opened this early has
        to change: the day the conversation is held, which every list dates the session by.
      */}
      <section className="flex flex-col gap-1.5">
        <Label htmlFor="coaching-held-on" className="text-sm font-medium">
          Session date
        </Label>
        {completed ? (
          <p className="text-sm">{formatSchoolDay(data.heldOn)}</p>
        ) : (
          <>
            <Input
              id="coaching-held-on"
              type="date"
              value={heldOn}
              onChange={(event) => editHeldOn(event.target.value)}
              className="w-fit"
            />
            <p className="text-xs text-muted-foreground">Cannot be changed after completion.</p>
          </>
        )}
      </section>

      <Part id={SESSION_HEAD.id} title={SESSION_HEAD.label}>
        {/*
          Where the conversation starts: the last few weeks, live, the same component and the same
          figures as the fellow's record. Above the data snapshot, and labelled apart from it,
          because the snapshot is what the fellow will see and this is not.
        */}
        <Trends
          level={3}
          recentAttendance={data.trends.recentAttendance}
          arrivals={data.trends.arrivals}
          courses={data.trends.courses}
          note={
            completed
              ? "As of today, not of this session. Staff only; not recorded and not shown to the fellow."
              : "Staff only; not recorded and not shown to the fellow."
          }
        />

        <section className="flex flex-col gap-2">
          <SectionHeading
            title="Data snapshot"
            audience="fellow"
            fellowName={fellowName}
            completed={completed}
          />
          <p className="text-xs text-muted-foreground">
            {completed
              ? `Recorded when this session was completed, ${formatDateTime(data.endedAt!)}.`
              : "Recorded when you complete this session."}
          </p>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            {strip === null ? (
              <p className="text-sm text-muted-foreground">The stored record cannot be read.</p>
            ) : (
              <CoachingSnapshotPanel snapshot={strip} compact />
            )}
          </div>
        </section>
      </Part>

      {/*
        The form itself: the layout this session was started with, section by section. A layout
        this code cannot read is said so rather than drawn wrongly; the date and the snapshot above
        still work, and completing still records.
      */}
      {data.layout === null ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          This session&apos;s form cannot be read, so its questions cannot be shown.
        </p>
      ) : (
        data.layout.sections.map((section) => (
          <Part key={section.id} id={section.id} title={section.title} caption={section.caption}>
            {section.items.map((item) =>
              isPanel(item) ? (
                <DataPanel
                  key={item.id}
                  item={item}
                  data={data}
                  programId={programId}
                  completed={completed}
                  today={today}
                />
              ) : item.kind === "TEMPERATURE" ? (
                <QuestionField
                  key={item.id}
                  item={item}
                  value={completed ? data.temperature : temperature}
                  completed={completed}
                  fellowName={fellowName}
                  onChange={(value) => editTemperature(value as number)}
                  onBlur={flush}
                />
              ) : (
                <QuestionField
                  key={item.id}
                  item={item}
                  value={completed ? (stored.get(item.id) ?? null) : (answers[item.id] ?? null)}
                  completed={completed}
                  fellowName={fellowName}
                  onChange={(value) =>
                    editAnswer(
                      item.id,
                      value,
                      item.kind !== "SHORT_TEXT" && item.kind !== "LONG_TEXT",
                    )
                  }
                  onBlur={flush}
                />
              ),
            )}
          </Part>
        ))
      )}

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
          <Button
            type="button"
            variant="ghost"
            disabled={discard.isPending}
            onClick={() => setDiscarding(true)}
            className="ml-auto text-destructive hover:text-destructive"
          >
            Discard
          </Button>
        </div>
      )}

      <Dialog open={discarding} onOpenChange={setDiscarding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard this session?</DialogTitle>
            <DialogDescription>
              Everything written here is deleted and cannot be recovered. {fellowName} never saw it,
              and their goals are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDiscarding(false)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={discard.isPending}
              onClick={() => discard.mutate({ programId, sessionId: data.id })}
            >
              {discard.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Discard session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete this session?</DialogTitle>
            <DialogDescription>
              {fellowName} will see the performance figures above
              {sharedCount > 0 &&
                ` and your ${sharedCount === 1 ? "answer to the shared question" : `answers to the ${sharedCount} shared questions`}`}
              , recorded now and dated {formatSchoolDay(heldOn)}. Everything else stays staff-only.
              Nothing can be edited afterwards, including the date.
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

/**
 * One part of the form, each an entry in the page's outline: the fixed head, or one section of the
 * layout.
 *
 * The `id` is what the outline links to, and `scroll-mt-(--outline-offset)` is what lands the
 * heading under the sticky outline rather than behind it; see `OutlinedPage`.
 */
function Part({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-(--outline-offset) flex flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-border pb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </div>
      {children}
    </section>
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
      <h3 className="text-sm font-medium">{title}</h3>
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
