"use client";

/**
 * One section of a report, drawn as a card an instructor can edit.
 *
 * Two cards, for the two ways a section's text comes to exist. A report the model generated is
 * assembled from parts — a summary and one row per scored item — so `AssembledSectionEditor`
 * draws each row with its own score box, its feedback, and the model's reasoning beside them,
 * and the section's total is the rows' sum. A section a person wrote whole — a hand grade, a
 * correction, or a report generated before reports had rows — is one score box and one block of
 * text, which is `SectionEditor`.
 */

import * as React from "react";
import { Eye, Pencil, SaveCheck, SavePen, Undo2 } from "lucide-react";
import { Markdown, sourceOffsetAt } from "@/components/markdown";
import { ConfidenceBadge, FlagBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown-editor";
import { composeReport, rowTotals, type ReportRow } from "@/lib/grade/report-text";
import { sectionLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ReportParts, Section } from "@/components/instructor/review/shared";

/**
 * Enough of a section to read and to score: what it is called and what it is out of.
 *
 * The rest is what a run produced — flags, a confidence, notes — and it is optional because two
 * callers have none of it. A grade written by hand was produced by a person, and this same card
 * is drawn from the assignment's declared sections before any round exists at all, when there is
 * no row to read a flag off.
 */
type SectionFacts = Pick<Section, "sectionType" | "scorePossible"> &
  Partial<Pick<Section, "flags" | "instructorNotes" | "confidence" | "submissionProcessNote">>;

export function SectionEditor({
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
  section: SectionFacts;
  /** Null when this section has no score yet, which the empty box says and a 0 does not. */
  score: number | null;
  report: string;
  onScore: (value: number | null) => void;
  /**
   * Told when the score box loses focus, which is the moment a typed score is finished.
   *
   * The editor opens a hand-graded round from this rather than from the keystrokes, and it is
   * also a flush point for the autosave — see `DraftEditor`.
   */
  onScoreBlur?: () => void;
  onReport: (value: string) => void;
  onReset?: () => void;
  /** True when this section differs from what is stored. */
  unsaved?: boolean;
  /** Told whenever the box is opened or closed. Opening it is what opens a hand-graded round. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const label = sectionLabel(section.sectionType);

  return (
    <Card>
      <SectionHeader section={section} unsaved={unsaved}>
        <ScoreInput
          value={score}
          possible={section.scorePossible ?? 0}
          onChange={onScore}
          onBlur={onScoreBlur}
          ariaLabel={`${label} score`}
        />
      </SectionHeader>

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
        <SectionNotes section={section} />
      </CardContent>
    </Card>
  );
}

/**
 * A model-generated section, edited row by row.
 *
 * The score on each row is the only number an instructor types. The section's total, the score
 * in the report's title and the score the gradebook records are all the rows' sum, computed here
 * for the screen and by the server when the edit is saved — `composeReport` in
 * `lib/grade/report-text.ts` writes the comment both times.
 */
export function AssembledSectionEditor({
  section,
  parts,
  onParts,
  onScoreBlur,
  onReset,
  unsaved = false,
}: {
  section: SectionFacts;
  parts: ReportParts;
  onParts: (next: ReportParts) => void;
  /** Told when a score box loses focus, which flushes the autosave — see `DraftEditor`. */
  onScoreBlur?: () => void;
  onReset?: () => void;
  unsaved?: boolean;
}) {
  /*
    The comment exactly as it will be posted, in place of the rows. The application writes the
    title, the headings and every score, so without this the first time an instructor saw them
    would be on the pull request.
  */
  const [previewing, setPreviewing] = React.useState(false);
  const label = sectionLabel(section.sectionType);
  const total = rowTotals(parts.rows);

  function writeRow(
    index: number,
    change: Partial<Pick<ReportRow, "scoreEarned" | "feedbackMarkdown">>,
  ) {
    onParts({
      ...parts,
      rows: parts.rows.map((row, at) => (at === index ? { ...row, ...change } : row)),
    });
  }

  return (
    <Card>
      <SectionHeader section={section} unsaved={unsaved}>
        <span className="text-sm font-medium tabular-nums">
          {total.earned ?? "–"}
          <span className="text-muted-foreground"> / {total.possible}</span>
        </span>
      </SectionHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-end gap-1">
          {unsaved && onReset && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              <Undo2 data-icon="inline-start" />
              Undo
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPreviewing((open) => !open)}>
            {previewing ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
            {previewing ? "Edit rows" : "Preview comment"}
          </Button>
        </div>

        {previewing ? (
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <Markdown
              content={composeReport({
                sectionType: section.sectionType,
                summaryMarkdown: parts.summaryMarkdown,
                rows: parts.rows,
              })}
            />
          </div>
        ) : (
          <>
            <EditableMarkdown
              heading="Summary"
              value={parts.summaryMarkdown}
              onChange={(summaryMarkdown) => onParts({ ...parts, summaryMarkdown })}
              ariaLabel={`${label} summary`}
              emptyText="No summary was written for this section."
            />

            {parts.rows.map((row, index) => {
              /*
                A checklist item's section heading, drawn above the first item under it with the
                subtotal the comment will show. Every other row is a heading of its own.
              */
              const opensGroup = row.group !== null && parts.rows[index - 1]?.group !== row.group;
              const group = opensGroup
                ? rowTotals(parts.rows.filter((member) => member.group === row.group))
                : null;
              return (
                <React.Fragment key={index}>
                  {group && (
                    <div className="flex items-baseline justify-between gap-3 pt-2">
                      <span className="text-sm font-semibold">{row.group}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {group.earned ?? "–"} / {group.possible}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 pt-2 text-sm font-medium">{row.label}</span>
                      <ScoreInput
                        value={row.scoreEarned}
                        possible={row.scorePossible}
                        onChange={(scoreEarned) => writeRow(index, { scoreEarned })}
                        onBlur={onScoreBlur}
                        ariaLabel={`${row.label} score`}
                      />
                    </div>
                    {row.modelReasoning && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Why this score (not posted): </span>
                        {row.modelReasoning}
                      </p>
                    )}
                    <EditableMarkdown
                      heading="Feedback"
                      value={row.feedbackMarkdown}
                      onChange={(feedbackMarkdown) => writeRow(index, { feedbackMarkdown })}
                      ariaLabel={`${row.label} feedback`}
                      emptyText="No feedback on this row."
                      rows={6}
                      compact
                    />
                  </div>
                </React.Fragment>
              );
            })}
          </>
        )}

        <SectionNotes section={section} />
      </CardContent>
    </Card>
  );
}

/** The section's name, whether its edits are saved, its badges, and whatever sits at the right. */
function SectionHeader({
  section,
  unsaved,
  children,
}: {
  section: SectionFacts;
  unsaved: boolean;
  children: React.ReactNode;
}) {
  const flags = section.flags ?? [];

  return (
    <CardHeader>
      {/*
        The title wraps; the score never moves. `min-w-0` is what lets the title column shrink
        below the width of its own text, and without it flex takes the one way it has left to fit
        both — putting the score on a row of its own, which is a row of height every card then
        pays for because one section was named at length.
      */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {/*
            `min-h-9` is the height of the score box beside it, and the title sits centred in that
            height rather than at the top of it. A one-line title — which is nearly every title —
            then reads level with the number, and a title that has wrapped is taller than the box
            and so is unaffected, which is why the row itself still aligns to the top: the number
            stays beside the first line rather than drifting down the block.
          */}
          <CardTitle className="flex min-h-9 items-center text-base">
            <span>
              {sectionLabel(section.sectionType)}
              {/*
                Whether this section's edits have reached the server, as one icon that is always
                there. A badge that came and went resized the card and moved everything under the
                reader's cursor; the icon holds the same space in both states.

                Inline, inside the same span as the title, so that a title running to two lines
                carries the icon after its last word. As a flex item of its own it would sit level
                with the gap between the lines, attached to nothing.

                `align-middle` puts the centre of the icon on the x-height midline — the baseline
                plus half the height of a lowercase x. The middle a reader sees is the cap-height
                midline, which is two pixels higher at this font size, so the icon is moved up
                those two pixels to land on it. Moved rather than aligned differently: a transform
                does not change the line box, so a title running to two lines keeps its lines the
                same distance apart.
              */}
              {unsaved ? (
                <span
                  title="Not saved yet"
                  className="ml-1.5 inline-flex -translate-y-[2px] align-middle"
                >
                  <SavePen className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="sr-only">This section has changes not saved yet</span>
                </span>
              ) : (
                <span title="Saved" className="ml-1.5 inline-flex -translate-y-[2px] align-middle">
                  <SaveCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span className="sr-only">This section is saved</span>
                </span>
              )}
            </span>
          </CardTitle>
          {(section.confidence || flags.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {section.confidence && <ConfidenceBadge confidence={section.confidence} />}
              {flags.map((flag) => (
                <FlagBadge key={flag} code={flag} />
              ))}
            </div>
          )}
        </div>

        <div className="flex min-h-9 shrink-0 items-center gap-1.5">{children}</div>
      </div>
    </CardHeader>
  );
}

/** A score box and what it is out of. */
function ScoreInput({
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
        className="h-9 w-20 text-right tabular-nums"
        aria-label={ariaLabel}
      />
      <span className="text-sm text-muted-foreground">/ {possible}</span>
    </div>
  );
}

/**
 * Markdown read as it will render, and edited in place.
 *
 * Two ways in. The Edit button says the instructor means to write for a while, so the box stays
 * open until they press Preview. Double-clicking the preview is a quick correction, so the box
 * goes back to the preview as soon as they click anywhere outside it, with no button to find.
 * One button press cannot express both, which is why the two ways in are kept apart.
 */
function EditableMarkdown({
  heading,
  value,
  onChange,
  ariaLabel,
  emptyText,
  rows = 16,
  compact = false,
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
  /** Smaller type and padding, for the many boxes of a report edited row by row. */
  compact?: boolean;
  /** Buttons drawn before Edit, such as Undo. */
  actions?: React.ReactNode;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = React.useState<false | "button" | "double-click">(false);
  /** Where the caret starts when a double-click opened the box: the character under the pointer. */
  const [cursor, setCursor] = React.useState<number | undefined>(undefined);
  /** The label, buttons and box together. A click inside any of them is not a click outside. */
  const writing = React.useRef<HTMLDivElement>(null);

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
      if (writing.current?.contains(event.target as Node)) return;
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

  return (
    <div ref={writing} className="flex flex-col gap-2">
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
          className={cn(
            "rounded-md border border-border bg-muted/20",
            compact ? "px-3 py-2" : "p-4",
          )}
        >
          <Markdown content={value} sourceOffsets />
        </div>
      ) : (
        <p
          onDoubleClick={openAtPointer}
          title="Double-click to edit"
          className={cn(
            "rounded-md border border-dashed border-border px-3 text-center text-sm text-muted-foreground",
            compact ? "py-2" : "py-4",
          )}
        >
          {emptyText}
        </p>
      )}
    </div>
  );
}

/** What the run told the instructor about this section, which never reaches the student. */
function SectionNotes({ section }: { section: SectionFacts }) {
  const instructorNotes = section.instructorNotes ?? [];

  return (
    <>
      {instructorNotes.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <span className="text-[11px] font-medium tracking-wide text-amber-700 uppercase dark:text-amber-300">
            For you, never shown to the student
          </span>
          {instructorNotes.map((note, index) => (
            <p key={index} className="text-xs text-amber-800 dark:text-amber-200">
              {note}
            </p>
          ))}
        </div>
      )}

      {section.submissionProcessNote && (
        <p className="text-xs text-muted-foreground">{section.submissionProcessNote}</p>
      )}
    </>
  );
}
