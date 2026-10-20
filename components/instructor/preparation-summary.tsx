"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Pencil, Sparkles, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  SUMMARY_FOCUS_MAX_LENGTH,
  SUMMARY_INPUTS,
  THEME_FIELD_MAX_LENGTH,
  THEME_STATUSES,
  type SummaryInput,
  type SummaryTheme,
  type ThemeStatus,
} from "@/lib/coaching";
import { displayNameOf } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Summaries = RouterOutputs["coachingSummaries"]["forStudent"];
type Current = NonNullable<Summaries["current"]>;

/** What each checkbox reads, in the words the coach chooses by. */
const INPUT_LABEL: Record<SummaryInput, string> = {
  figures: "Figures and trends, including GCF and session temperatures",
  writing: "Their goals, updates, comments and topics",
  sessions: "Answers from sessions since the last summary, the five most recent",
  notes: "Instructor notes written or edited since the last summary",
  feedback: "Released grading feedback, the ten most recent rounds since the last summary",
};

/** The same, short, for the line saying what a summary was written from. */
const INPUT_SHORT: Record<string, string> = {
  figures: "figures",
  writing: "their writing",
  sessions: "sessions",
  notes: "notes",
  feedback: "feedback",
};

function fromInputs(inputs: string[]): string {
  return inputs.map((input) => INPUT_SHORT[input] ?? input).join(", ");
}

/**
 * Each status in words and colour. The colours say what moved at a glance: new is sky, a change
 * amber, a resolved theme emerald, and one that simply continues stays muted.
 */
const STATUS_META: Record<ThemeStatus, { label: string; className: string }> = {
  new: { label: "New", className: "border-sky-300 text-sky-700 dark:text-sky-300" },
  continuing: { label: "Continuing", className: "text-muted-foreground" },
  changed: { label: "Changed", className: "border-amber-300 text-amber-700 dark:text-amber-300" },
  resolved: {
    label: "Resolved",
    className: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  },
};

/**
 * Claude's reading of this fellow's record, written for the coach before a conversation, as a short
 * list of themes.
 *
 * **Staff-only, and the section says so**, as the notes do. The caption also says it is Claude's
 * reading, so a coach checks a claim before repeating it to the fellow.
 *
 * **Read at a glance, checked on demand.** Each theme shows what changed, its title, the one detail
 * behind it and the one question to ask; the dated records it rests on, and how Claude got from
 * them to the theme, open beneath it on a click. A coach preparing in the minute before a
 * conversation reads the first part and opens only what they mean to repeat.
 *
 * **The current summary is a draft the coach corrects.** Any theme can be edited or removed, and
 * the next summary reads the themes as the coach left them — a correction made here is one the
 * next summary keeps.
 *
 * The generate panel is shown when there is no summary, and after Regenerate otherwise, so a coach
 * reading the summary is not looking at five checkboxes below it.
 */
export function PreparationSummary({
  id,
  programId,
  studentId,
  name,
  summaries,
}: {
  /** The section's anchor, for the page's outline. */
  id: string;
  programId: string;
  studentId: string;
  name: string;
  summaries: Summaries;
}) {
  const { current, earlier } = summaries;
  const [regenerating, setRegenerating] = React.useState(false);

  return (
    <section id={id} className="flex scroll-mt-(--outline-offset) flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Preparation summary</h2>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Staff only
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Written by Claude from the parts of this record you choose, for you. Never shown to {name}
          . Open a theme to see what it rests on before you repeat it.
        </p>
      </div>

      {current && (
        <CurrentSummary
          // Keyed by the row, so a new summary starts with no edit or confirmation left open.
          key={current.id}
          programId={programId}
          summary={current}
          onRegenerate={() => setRegenerating(true)}
          regenerating={regenerating}
        />
      )}

      {(current === null || regenerating) && (
        <GeneratePanel
          programId={programId}
          studentId={studentId}
          onDone={() => setRegenerating(false)}
          onCancel={current ? () => setRegenerating(false) : undefined}
        />
      )}

      {earlier.length > 0 && <EarlierSummaries programId={programId} summaries={earlier} />}
    </section>
  );
}

function CurrentSummary({
  programId,
  summary,
  onRegenerate,
  regenerating,
}: {
  programId: string;
  summary: Current;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const remove = useMutation(
    trpc.coachingSummaries.remove.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Summary deleted.");
          setConfirmingDelete(false);
        },
      }),
    ),
  );

  const { roundsSkipped, sessionsSkipped } = summary.coveredThrough;

  return (
    <div className="flex flex-col gap-3">
      {summary.themes.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          Every theme in this summary has been removed.
        </p>
      ) : (
        /*
          Two across once there is room, so a coach takes in every theme at a glance before
          opening any. `items-start` keeps each card its own height, so opening one to read its
          evidence does not stretch the card beside it into an empty box.
        */
        <ul className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          {summary.themes.map((theme, index) => (
            <li key={`${index}-${theme.title}`}>
              <ThemeCard theme={theme} edit={{ programId, summaryId: summary.id, index }} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Generated {formatDate(summary.createdAt)} by{" "}
        {summary.author ? displayNameOf(summary.author, "somebody") : "a former instructor"} from{" "}
        {fromInputs(summary.inputs)}
        {summary.editedAt && " · Edited"}
        {roundsSkipped > 0 && ` · ${roundsSkipped} earlier rounds of feedback were left out`}
        {sessionsSkipped > 0 && ` · ${sessionsSkipped} earlier sessions were left out`}
        {summary.focus && ` · Focus: ${summary.focus}`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {!regenerating && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={onRegenerate}
            data-icon="inline-start"
          >
            <Sparkles aria-hidden />
            Regenerate
          </Button>
        )}
        {confirmingDelete ? (
          <span className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ programId, summaryId: summary.id })}
            >
              Delete this summary
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            className="ml-auto text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One theme: what changed, the title, the detail and the question, with the evidence and reasoning
 * opening beneath on a click. `edit` is given for the current summary only, which is the one a
 * coach may change.
 */
function ThemeCard({
  theme,
  edit,
}: {
  theme: SummaryTheme;
  edit?: { programId: string; summaryId: string; index: number };
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [editing, setEditing] = React.useState(false);

  const removeTheme = useMutation(trpc.coachingSummaries.removeTheme.mutationOptions(settled()));
  const status = STATUS_META[theme.status];

  if (editing && edit) {
    return <ThemeEditForm theme={theme} edit={edit} onDone={() => setEditing(false)} />;
  }

  return (
    <Collapsible className="rounded-lg border border-border bg-muted/30">
      <CollapsibleTrigger className="group flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("font-normal", status.className)}>
            {status.label}
          </Badge>
          <span className="text-sm font-medium">{theme.title}</span>
          {theme.edited && <span className="text-xs text-muted-foreground">Edited</span>}
          <ChevronRight
            aria-hidden="true"
            className="ml-auto size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
          />
        </span>
        {theme.callout && <span className="text-sm">{theme.callout}</span>}
        {/*
          In the amber the grading screen gives the model's reasoning, because it is the same kind of
          thing: written by Claude for the instructor, and never shown to the fellow.
        */}
        {theme.question && (
          <span className="text-sm text-amber-800 dark:text-amber-200">
            <span className="font-medium text-amber-700 dark:text-amber-300">Ask: </span>
            {theme.question}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5 text-sm">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How Claude got here
          </h4>
          {theme.evidence.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {theme.evidence.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {theme.reasoning && <p className="text-muted-foreground">{theme.reasoning}</p>}
          {edit && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">
                The next summary builds on this theme as you leave it.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto"
                disabled={removeTheme.isPending}
                onClick={() => setEditing(true)}
                data-icon="inline-start"
              >
                <Pencil aria-hidden />
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={removeTheme.isPending}
                onClick={() => removeTheme.mutate(edit)}
                data-icon="inline-start"
              >
                <X aria-hidden />
                Remove
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Every part of one theme, editable. The evidence is one record per line, because that is how it
 * reads on the card and how the model writes it.
 */
function ThemeEditForm({
  theme,
  edit,
  onDone,
}: {
  theme: SummaryTheme;
  edit: { programId: string; summaryId: string; index: number };
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [status, setStatus] = React.useState<ThemeStatus>(theme.status);
  const [title, setTitle] = React.useState(theme.title);
  const [callout, setCallout] = React.useState(theme.callout);
  const [question, setQuestion] = React.useState(theme.question);
  const [evidence, setEvidence] = React.useState(theme.evidence.join("\n"));
  const [reasoning, setReasoning] = React.useState(theme.reasoning);

  const save = useMutation(
    trpc.coachingSummaries.editTheme.mutationOptions(settled({ onSuccess: onDone })),
  );

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "" || save.isPending) return;
        save.mutate({
          ...edit,
          theme: {
            status,
            title,
            callout,
            question,
            evidence: evidence
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
            reasoning,
          },
        });
      }}
    >
      <p className="text-xs text-muted-foreground">
        The next summary treats your version of this theme as right, unless new material contradicts
        it.
      </p>

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Status</legend>
        {THEME_STATUSES.map((option) => (
          <Button
            key={option}
            type="button"
            size="xs"
            variant={status === option ? "secondary" : "ghost"}
            aria-pressed={status === option}
            onClick={() => setStatus(option)}
          >
            {STATUS_META[option].label}
          </Button>
        ))}
      </fieldset>

      {/*
        The muted style sits on each label's words rather than on the label, because a field inside
        a label inherits its colour and greyed text reads as a placeholder rather than as the words
        being edited.
      */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Title</span>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={THEME_FIELD_MAX_LENGTH.title}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">The detail behind it</span>
        <Input
          value={callout}
          onChange={(event) => setCallout(event.target.value)}
          maxLength={THEME_FIELD_MAX_LENGTH.callout}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Question to ask</span>
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={THEME_FIELD_MAX_LENGTH.question}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Evidence, one record per line
        </span>
        <Textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={5} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">How it adds up</span>
        <Textarea
          value={reasoning}
          onChange={(event) => setReasoning(event.target.value)}
          maxLength={THEME_FIELD_MAX_LENGTH.reasoning}
          rows={2}
        />
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={title.trim() === "" || save.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function GeneratePanel({
  programId,
  studentId,
  onDone,
  onCancel,
}: {
  programId: string;
  studentId: string;
  onDone: () => void;
  /** Absent when there is no summary yet, so the panel is the only thing to show. */
  onCancel?: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [inputs, setInputs] = React.useState<SummaryInput[]>([...SUMMARY_INPUTS]);
  const [focus, setFocus] = React.useState("");

  const generate = useMutation(
    trpc.coachingSummaries.generate.mutationOptions(
      settled({
        onSuccess: () => {
          setFocus("");
          onDone();
        },
      }),
    ),
  );

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (inputs.length === 0 || generate.isPending) return;
        generate.mutate({
          programId,
          studentId,
          inputs,
          focus: focus.trim() === "" ? undefined : focus,
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">
          What Claude reads
        </legend>
        {SUMMARY_INPUTS.map((input) => (
          <label key={input} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={inputs.includes(input)}
              disabled={generate.isPending}
              onCheckedChange={(checked) =>
                setInputs((now) =>
                  checked
                    ? SUMMARY_INPUTS.filter((part) => part === input || now.includes(part))
                    : now.filter((part) => part !== input),
                )
              }
            />
            {INPUT_LABEL[input]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Focus (optional)</span>
        <Input
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          maxLength={SUMMARY_FOCUS_MAX_LENGTH}
          disabled={generate.isPending}
          placeholder="Compare against the goals set last time."
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={inputs.length === 0 || generate.isPending}
          data-icon="inline-start"
        >
          <Sparkles aria-hidden />
          Generate
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={generate.isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        {generate.isPending && (
          <span className="text-xs text-muted-foreground">
            Reading the record and writing. About half a minute.
          </span>
        )}
        {inputs.length === 0 && (
          <span className="text-xs text-muted-foreground">Choose at least one.</span>
        )}
      </div>
    </form>
  );
}

function EarlierSummaries({
  programId,
  summaries,
}: {
  programId: string;
  summaries: Summaries["earlier"];
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const remove = useMutation(
    trpc.coachingSummaries.remove.mutationOptions(
      settled({ onSuccess: () => toast.success("Summary deleted.") }),
    ),
  );
  const [confirming, setConfirming] = React.useState<string | null>(null);

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
        />
        Earlier summaries · {summaries.length}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 flex flex-col gap-4">
          {summaries.map((summary) => (
            <li key={summary.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  {formatDate(summary.createdAt)} ·{" "}
                  {summary.author
                    ? displayNameOf(summary.author, "somebody")
                    : "A former instructor"}{" "}
                  · from {fromInputs(summary.inputs)}
                </span>
                {confirming === summary.id ? (
                  <span className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ programId, summaryId: summary.id })}
                    >
                      Delete this summary
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setConfirming(null)}
                    >
                      Keep it
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setConfirming(summary.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
              <ul className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                {summary.themes.map((theme, index) => (
                  <li key={`${index}-${theme.title}`}>
                    <ThemeCard theme={theme} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
