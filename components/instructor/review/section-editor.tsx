"use client";

/**
 * One section of a report, and the rubric behind its score.
 *
 * Its own file because three places draw a section: a report an instructor is editing, a hand
 * grade being written from nothing, and the column beside the grade where the rubric reads on its
 * own. `RubricBreakdown` used to be the second half of `SectionEditor`, which was fine while the
 * two were always in one column and impossible once the working could sit beside the report.
 */

import * as React from "react";
import { ListChecks, Loader2, Pencil, Undo2 } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { ConfidenceBadge, FlagBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sectionLabel } from "@/lib/status";
import { Section, readRubricItems } from "@/components/instructor/review/shared";
export function SectionEditor({
  section,
  score,
  report,
  onScore,
  onScoreBlur,
  onReport,
  onReset,
  unsaved = false,
  startsOpen = false,
  onEditingChange,
  busy = false,
}: {
  /**
   * Enough of a section to read and to score: what it is called and what it is out of.
   *
   * The rest is what a run produced — flags, a confidence, notes — and it is optional because two
   * callers have none of it. A grade written by hand was produced by a person, and this same card
   * is drawn from the assignment's declared sections before any round exists at all, when there is
   * no row to read a flag off. The score's working is not here at all: it is `RubricBreakdown`,
   * which is drawn beside this card or below it depending on the room.
   */
  section: Pick<Section, "sectionType" | "scorePossible"> &
    Partial<
      Pick<
        Section,
        "flags" | "instructorNotes" | "confidence" | "submissionProcessNote" | "editedAt"
      >
    >;
  /** Null when this section has no score yet, which the empty box says and a 0 does not. */
  score: number | null;
  report: string;
  onScore: (value: number | null) => void;
  /**
   * Told when the score box loses focus, which is the moment a typed score is finished.
   *
   * The blank hand-graded form opens its round from this rather than from the keystrokes — see
   * `BlankHandGrade`, the only caller with anything to do at that moment.
   */
  onScoreBlur?: () => void;
  onReport: (value: string) => void;
  onReset?: () => void;
  /** True when this section differs from what is stored. */
  unsaved?: boolean;
  /** Whether the feedback box is open on arrival — see `FeedbackBoxes`. */
  startsOpen?: boolean;
  /** Told whenever the box is opened or closed, so the answer outlives this card. */
  onEditingChange?: (editing: boolean) => void;
  /**
   * True while the round this card belongs to is being created.
   *
   * The feedback box is not offered until it exists, because a box that is about to be replaced
   * would take whatever was typed into it away with it.
   */
  busy?: boolean;
}) {
  const [editing, setEditing] = React.useState(startsOpen);
  const possible = section.scorePossible ?? 0;
  const flags = section.flags ?? [];
  const instructorNotes = section.instructorNotes ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">
              Section Report — {sectionLabel(section.sectionType)}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {unsaved && (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                >
                  Unsaved
                </Badge>
              )}
              {section.editedAt && !unsaved && (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  Edited by you
                </Badge>
              )}
              {section.confidence && <ConfidenceBadge confidence={section.confidence} />}
              {flags.map((flag) => (
                <FlagBadge key={flag} code={flag} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={possible}
              step="any"
              /*
                  Empty for a section with no score yet, rather than a 0 nobody typed. A hand-
                  written draft opens with every box empty, which is what asks to be filled in —
                  a box reading 0 looks like a score that has already been decided.
                */
              value={score ?? ""}
              onChange={(event) => {
                const raw = event.target.value;
                /*
                    Clearing the box means "not scored", not zero. `Number("")` is 0, so without
                    this the two are the same keystroke — and they are the distinction the whole
                    form now rests on.
                  */
                if (raw.trim() === "") {
                  onScore(null);
                  return;
                }
                const parsed = Number(raw);
                if (Number.isNaN(parsed)) return;
                onScore(Math.max(0, Math.min(possible, parsed)));
              }}
              onBlur={() => onScoreBlur?.()}
              className="h-9 w-20 text-right tabular-nums"
              aria-label={`${sectionLabel(section.sectionType)} score`}
            />
            <span className="text-sm text-muted-foreground">/ {possible}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              What the student will read
            </span>
            <div className="flex items-center gap-1">
              {unsaved && onReset && (
                <Button size="sm" variant="ghost" onClick={onReset}>
                  <Undo2 data-icon="inline-start" />
                  Undo
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const next = !editing;
                  setEditing(next);
                  onEditingChange?.(next);
                }}
              >
                <Pencil data-icon="inline-start" />
                {editing ? "Preview" : "Edit"}
              </Button>
            </div>
          </div>

          {busy ? (
            <p className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Opening this round of feedback…
            </p>
          ) : editing ? (
            <Textarea
              value={report}
              onChange={(event) => onReport(event.target.value)}
              rows={16}
              /*
                  Focused on opening, which is what a box asked for by a click wants — and the one
                  thing the swap from the blank form to the round cannot carry across on its own.
                */
              autoFocus
              className="font-mono text-xs"
            />
          ) : report.trim() ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <Markdown content={report} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              No report was written for this section.
            </p>
          )}
        </div>

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
      </CardContent>
    </Card>
  );
}

/**
 * The score, line by line, in a card of its own.
 *
 * Two different things read in two different ways: the report is the feedback the student
 * receives and the instructor may rewrite, and this is the arithmetic behind the number beside
 * it. Nothing in this card is ever shown to the student.
 *
 * Its own component rather than part of the section card, because where it belongs depends on
 * the room there is. Beneath the report in one column; in the column beside it, with the test
 * output, where the pane is wide enough to hold two — the working and the writing, each on its
 * own side.
 */
export function RubricBreakdown({
  section,
}: {
  section: Pick<Section, "sectionType" | "rubricItems">;
}) {
  const rubricItems = readRubricItems(section.rubricItems);
  if (rubricItems.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4 text-muted-foreground" />
          How this score was reached — {sectionLabel(section.sectionType)}
        </CardTitle>
        <CardDescription>
          One row per rubric criterion, summing to the section score. For you, never shown to the
          student.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rubricItems.map((item, index) => (
          <div
            key={index}
            className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/20 px-3 py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{item.label}</span>
              {item.criterion && (
                <span className="text-xs text-muted-foreground">{item.criterion}</span>
              )}
              {item.note && <span className="mt-1 text-xs text-muted-foreground">{item.note}</span>}
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {item.scoreEarned}
              <span className="text-muted-foreground"> / {item.scorePossible}</span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
