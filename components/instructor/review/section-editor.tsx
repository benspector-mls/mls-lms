"use client";

/**
 * The pieces of a round an instructor reads and changes: the summary, one line per section with
 * its score and feedback, the notes the run left for the instructor, and — for a round written
 * before sections were scored units — a card holding one section's text whole.
 */

import * as React from "react";
import { Check, Eraser, Pencil, SaveCheck, SavePen, Undo2 } from "lucide-react";
import { Markdown, sourceOffsetAt } from "@/components/markdown";
import { HelpTip } from "@/components/help-tip";
import { ConfidenceBadge, FlagBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown-editor";
import { sectionLabel } from "@/lib/status";
import type { Section } from "@/components/instructor/review/shared";

/**
 * What the run told the instructor about the round, which never reaches the student: the flags,
 * how sure the model was, its notes, and the process note. The same shape a section written
 * before rounds held these carries of its own, so the same card draws both.
 */
export type RunNotes = {
  flags?: readonly string[];
  instructorNotes?: readonly string[];
  confidence?: Section["confidence"];
  submissionProcessNote?: string | null;
};

/** The badges and notes a run left, drawn above the summary or inside a section's card. */
export function RoundNotes({ notes }: { notes: RunNotes }) {
  const flags = notes.flags ?? [];
  const instructorNotes = notes.instructorNotes ?? [];
  const nothing =
    !notes.confidence &&
    flags.length === 0 &&
    instructorNotes.length === 0 &&
    !notes.submissionProcessNote;
  if (nothing) return null;

  return (
    <div className="flex flex-col gap-2">
      {(notes.confidence || flags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {notes.confidence && <ConfidenceBadge confidence={notes.confidence} />}
          {flags.map((flag) => (
            <FlagBadge key={flag} code={flag} />
          ))}
        </div>
      )}

      {instructorNotes.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <span className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-amber-700 uppercase dark:text-amber-300">
            Model Summary
            <HelpTip className="text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100">
              Never sent to the student. The model writes these notes for you while it grades, about
              anything you should know that does not belong in the feedback: a file it expected and
              did not receive, an assumption it had to make to give a score, or a rubric criterion
              that does not fit what the student built.
            </HelpTip>
          </span>
          {instructorNotes.map((note, index) => (
            <p key={index} className="text-xs text-amber-800 dark:text-amber-200">
              {note}
            </p>
          ))}
        </div>
      )}

      {notes.submissionProcessNote && (
        <p className="text-xs text-muted-foreground">{notes.submissionProcessNote}</p>
      )}
    </div>
  );
}

/**
 * The round's summary: the opening the student reads before the first scored section, with no
 * score of its own.
 */
export function SummaryEditor({
  value,
  onChange,
  onEditingChange,
  unsaved = false,
  onReset,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Told whenever the box is opened or closed. Opening it is what opens a hand-graded round. */
  onEditingChange?: (editing: boolean) => void;
  unsaved?: boolean;
  onReset?: () => void;
}) {
  return (
    <EditableMarkdown
      heading="Summary"
      value={value}
      onChange={onChange}
      ariaLabel="Summary"
      emptyText="No summary yet. The student reads this before the first section."
      rows={10}
      onEditingChange={onEditingChange}
      actions={
        <>
          <SavedIcon unsaved={unsaved} />
          {unsaved && onReset && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              <Undo2 data-icon="inline-start" />
              Undo
            </Button>
          )}
        </>
      }
    />
  );
}

/**
 * One section: its label and score box on one line, the feedback the student reads, and the
 * model's reasoning beneath it.
 *
 * Built to be short, because a round holds a dozen of these and most full-marks sections have
 * no feedback at all. A section with nothing to say is the label line and the reasoning, with
 * an "Add feedback" button beside the score; one with feedback shows it unboxed, edited by a
 * double-click or the Edit Feedback button beside the score. While the box is open, a Clear
 * button beside Done empties it, and a Restore button then puts the text back.
 */
export function SectionRow({
  label,
  possible,
  score,
  feedback,
  reasoning,
  unsaved,
  onScore,
  onScoreBlur,
  onFeedback,
  onEditingChange,
}: {
  label: string;
  possible: number;
  score: number | null;
  feedback: string;
  reasoning: string | null;
  unsaved: boolean;
  onScore: (value: number | null) => void;
  onScoreBlur?: () => void;
  onFeedback: (value: string) => void;
  /** Told whenever the feedback box is opened or closed. Opening it is what opens a hand-graded round. */
  onEditingChange?: (editing: boolean) => void;
}) {
  /*
    The text the Clear button erased, kept so Restore can put it back. The round's Undo cannot be
    relied on for this: it returns to what was last saved, and the autosave stores the emptied box
    a few seconds later, after which there is nothing left for Undo to return to. Forgotten when
    the box closes or anything new is typed, because by then the instructor has moved on.
  */
  const [cleared, setCleared] = React.useState<string | null>(null);
  const editingChanged = React.useCallback(
    (editing: boolean) => {
      if (!editing) setCleared(null);
      onEditingChange?.(editing);
    },
    [onEditingChange],
  );
  const box = useEditInPlace(feedback, editingChanged);
  const hasFeedback = feedback.trim() !== "";

  return (
    <div ref={box.container} className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm font-medium">
          {label}
          <SavedIcon unsaved={unsaved} />
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {box.editing ? (
            <>
              {cleared !== null && !hasFeedback ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onFeedback(cleared);
                    setCleared(null);
                  }}
                  title="Restore"
                  className="@max-md:pr-1.5"
                >
                  <Undo2 data-icon="inline-start" />
                  <span className="@max-md:sr-only">Restore</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCleared(feedback);
                    onFeedback("");
                  }}
                  disabled={!hasFeedback}
                  title="Clear"
                  className="@max-md:pr-1.5"
                >
                  <Eraser data-icon="inline-start" />
                  <span className="@max-md:sr-only">Clear</span>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={box.close}>
                <Check data-icon="inline-start" />
                Done
              </Button>
            </>
          ) : (
            /*
              When the list is narrow the label is hidden and the button is its icon alone, which
              leaves the section's own label the room to stay on one line. `sr-only` keeps the
              label as the button's accessible name, `title` names it on hover, and the right
              padding is trimmed to match the left so the icon sits centred.
            */
            <Button
              size="sm"
              variant="ghost"
              onClick={() => box.open("button")}
              title={hasFeedback ? "Edit Feedback" : "Add feedback"}
              className="@max-md:pr-1.5"
            >
              <Pencil data-icon="inline-start" />
              <span className="@max-md:sr-only">
                {hasFeedback ? "Edit Feedback" : "Add feedback"}
              </span>
            </Button>
          )}
          <ScoreInput
            value={score}
            possible={possible}
            onChange={onScore}
            onBlur={onScoreBlur}
            ariaLabel={`${label} score`}
          />
        </div>
      </div>

      {box.editing ? (
        <MarkdownEditor
          value={feedback}
          onChange={(value) => {
            setCleared(null);
            onFeedback(value);
          }}
          ariaLabel={`${label} feedback`}
          rows={6}
          autoFocus
          initialCursor={box.editing === "double-click" ? box.cursor : undefined}
          className="font-mono text-xs"
        />
      ) : (
        hasFeedback && (
          <div onDoubleClick={box.openAtPointer} title="Double-click to edit">
            <Markdown content={feedback} sourceOffsets />
          </div>
        )
      )}

      {/*
        Beneath the feedback, so the section reads in the order the student's comment does — the
        score, then what they are told — with the instructor's note after it. In the same amber as
        the notes card above the summary, because it is the same kind of thing: written for the
        instructor and never posted.
      */}
      {reasoning && (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          <span className="font-medium text-amber-700 dark:text-amber-300">Model Reasoning: </span>
          {reasoning}
        </p>
      )}
    </div>
  );
}

/** A heading the sections beneath share, drawn above the first of them with their subtotal. */
export function SectionHeadingRow({
  heading,
  earned,
  possible,
}: {
  heading: string;
  earned: number | null;
  possible: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 bg-muted/40 px-3 py-1.5">
      <span className="text-sm font-semibold">{heading}</span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {earned ?? "–"} / {possible}
      </span>
    </div>
  );
}

/**
 * One section of a round written before sections were scored units, drawn as a card: one score
 * box and one block of text, with the flags and notes such a section carries of its own.
 */
export function LegacySectionEditor({
  section,
  score,
  report,
  onScore,
  onScoreBlur,
  onReport,
  onReset,
  unsaved = false,
  onEditingChange,
}: {
  section: Pick<Section, "sectionType" | "scorePossible"> & RunNotes & { label?: string | null };
  /** Null when this section has no score yet, which the empty box says and a 0 does not. */
  score: number | null;
  report: string;
  onScore: (value: number | null) => void;
  onScoreBlur?: () => void;
  onReport: (value: string) => void;
  onReset?: () => void;
  unsaved?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const label = section.label ?? sectionLabel(section.sectionType);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle className="flex min-h-9 items-center text-base">
              <span>
                {label}
                <SavedIcon unsaved={unsaved} />
              </span>
            </CardTitle>
            <RoundNotes notes={section} />
          </div>
          <div className="flex min-h-9 shrink-0 items-center gap-1.5">
            <ScoreInput
              value={score}
              possible={section.scorePossible ?? 0}
              onChange={onScore}
              onBlur={onScoreBlur}
              ariaLabel={`${label} score`}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <EditableMarkdown
          heading="What the student will read"
          value={report}
          onChange={onReport}
          ariaLabel={`${label} feedback`}
          emptyText="No report was written for this section."
          onEditingChange={onEditingChange}
          actions={
            unsaved &&
            onReset && (
              <Button size="sm" variant="ghost" onClick={onReset}>
                <Undo2 data-icon="inline-start" />
                Undo
              </Button>
            )
          }
        />
      </CardContent>
    </Card>
  );
}

/**
 * Whether a piece's edits have reached the server, as one icon that is always there. A badge
 * that came and went resized the card and moved everything under the reader's cursor; the icon
 * holds the same space in both states.
 */
function SavedIcon({ unsaved }: { unsaved: boolean }) {
  return unsaved ? (
    <span title="Not saved yet" className="ml-1.5 inline-flex -translate-y-[2px] align-middle">
      <SavePen className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="sr-only">Changes not saved yet</span>
    </span>
  ) : (
    <span title="Saved" className="ml-1.5 inline-flex -translate-y-[2px] align-middle">
      <SaveCheck className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">Saved</span>
    </span>
  );
}

/** A score box and what it is out of. */
export function ScoreInput({
  value,
  possible,
  onChange,
  onBlur,
  ariaLabel,
}: {
  value: number | null;
  possible: number;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  ariaLabel: string;
}) {
  /*
    As many characters wide as the score it is out of, so a box out of 15 holds two digits. A typed
    score longer than that, such as 7.5, widens the box to fit rather than scrolling out of sight.
  */
  const characters = Math.max(String(possible).length, String(value ?? "").length);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Input
        type="number"
        min={0}
        max={possible}
        step="any"
        /*
          Empty for a score nobody has given yet, rather than a 0 nobody typed. A hand-written
          draft opens with every box empty, which is what asks to be filled in — a box reading 0
          looks like a score that has already been decided.
        */
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          /*
            Clearing the box means "not scored", not zero. `Number("")` is 0, so without this the
            two are the same keystroke — and they are the distinction the whole form rests on.
          */
          if (raw.trim() === "") {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) return;
          onChange(Math.max(0, Math.min(possible, parsed)));
        }}
        onBlur={() => onBlur?.()}
        /*
          `ch` is the width of a zero in the box's own font, and `tabular-nums` makes every digit
          that wide. The 1.25rem is the box's padding and the 2px its border. The browser's up and
          down arrows are hidden because they alone are wider than two digits; the arrow keys
          still step the score.
        */
        style={{ width: `calc(${characters}ch + 1.25rem + 2px)` }}
        className="h-9 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label={ariaLabel}
      />
      <span className="text-sm text-muted-foreground">/ {possible}</span>
    </div>
  );
}

/**
 * Opening a block of markdown for editing in place, and closing it again.
 *
 * Two ways in. A button says the instructor means to write for a while, so the box stays open
 * until they close it. Double-clicking the rendered text is a quick correction, so the box goes
 * back to the rendered text as soon as they click anywhere outside `container`, with no button to
 * find. One button press cannot express both, which is why the two ways in are kept apart.
 */
function useEditInPlace(value: string, onEditingChange?: (editing: boolean) => void) {
  const [editing, setEditing] = React.useState<false | "button" | "double-click">(false);
  /** Where the caret starts when a double-click opened the box: the character under the pointer. */
  const [cursor, setCursor] = React.useState<number | undefined>(undefined);
  /** The label, buttons and box together. A click inside any of them is not a click outside. */
  const container = React.useRef<HTMLDivElement>(null);

  function open(how: "button" | "double-click", at?: number) {
    setCursor(at);
    setEditing(how);
    onEditingChange?.(true);
  }

  function close() {
    setEditing(false);
    onEditingChange?.(false);
  }

  /*
    On `pointerdown` rather than on the editor losing focus. Focus also leaves when the instructor
    switches to another window or tab, and a box that had closed by the time they came back would
    look as though their place had been lost. A press is only ever a deliberate act on this page.
  */
  React.useEffect(() => {
    if (editing !== "double-click") return;
    function closeOnClickOutside(event: PointerEvent) {
      if (container.current?.contains(event.target as Node)) return;
      setEditing(false);
      onEditingChange?.(false);
    }
    document.addEventListener("pointerdown", closeOnClickOutside);
    return () => document.removeEventListener("pointerdown", closeOnClickOutside);
  }, [editing, onEditingChange]);

  /*
    The caret goes to the character that was double-clicked, or to the end of the text when the
    press was beside it rather than on it, which is where an addition would usually go.
  */
  function openAtPointer(event: React.MouseEvent) {
    open("double-click", sourceOffsetAt(event.clientX, event.clientY) ?? value.length);
  }

  return { editing, cursor, container, open, close, openAtPointer };
}

/** Markdown read as it will render, under a heading, and edited in place — see `useEditInPlace`. */
function EditableMarkdown({
  heading,
  value,
  onChange,
  ariaLabel,
  emptyText,
  rows = 16,
  actions,
  onEditingChange,
}: {
  heading: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /** What the box says when there is nothing written in it. */
  emptyText: string;
  rows?: number;
  /** Buttons drawn before Edit, such as Undo. */
  actions?: React.ReactNode;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { editing, cursor, container, open, close, openAtPointer } = useEditInPlace(
    value,
    onEditingChange,
  );

  return (
    <div ref={container} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {heading}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          <Button size="sm" variant="ghost" onClick={() => (editing ? close() : open("button"))}>
            <Pencil data-icon="inline-start" />
            {editing ? "Preview" : "Edit"}
          </Button>
        </div>
      </div>

      {editing ? (
        <MarkdownEditor
          value={value}
          onChange={onChange}
          ariaLabel={ariaLabel}
          rows={rows}
          // Focused on opening, which is what a box asked for by a click wants.
          autoFocus
          initialCursor={editing === "double-click" ? cursor : undefined}
          className="font-mono text-xs"
        />
      ) : value.trim() ? (
        <div
          onDoubleClick={openAtPointer}
          title="Double-click to edit"
          className="rounded-md border border-border bg-muted/20 p-4"
        >
          <Markdown content={value} sourceOffsets />
        </div>
      ) : (
        <p
          onDoubleClick={openAtPointer}
          title="Double-click to edit"
          className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground"
        >
          {emptyText}
        </p>
      )}
    </div>
  );
}
