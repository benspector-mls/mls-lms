"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SECTION_TYPES, type SectionType } from "@/lib/section-types";
import { sectionLabel } from "@/lib/status";

/**
 * One gradable section of an assignment being authored.
 *
 * Two shapes, because a section is graded one of two ways and they need different fields. An
 * AI-graded section carries a type and a rubric; a manually graded one carries a label and a
 * point value and nothing else. The fields that do not apply are absent rather than disabled.
 *
 * **A section does not name its reference solutions.** Those are every file under the folder
 * the assignment names, which is stated once above this editor rather than per section — so
 * there is nothing here to tick, and no way to author a section whose ticked list has gone
 * stale against the folder it came from.
 *
 * Nothing here is typed by hand that can be chosen instead: the section type and the rubric are
 * both selects.
 */

export type SectionDraft =
  | {
      grading: "ai";
      type: SectionType;
      pointValue: number;
      rubricId: string;
      reportTemplate?: string;
      evidence?: "tests";
      testNamePattern?: string;
    }
  /*
    The one AI section an assignment with no repository carries. It has no type to choose,
    because "document" says nothing about the work — the rubric is the whole description of what
    a resume or a reflection is scored against.
  */
  | { grading: "ai"; type: "document"; pointValue: number; rubricId: string }
  | { grading: "manual"; label: string; pointValue: number };

export function SectionEditor({
  section,
  index,
  rubrics,
  findings,
  hasRunner,
  onChange,
  onRemove,
}: {
  section: SectionDraft;
  index: number;
  rubrics: { id: string; name: string }[];
  findings: { path: string; message: string; severity: "error" | "warning" }[];
  /** False when the assignment runs no tests, which makes test evidence meaningless. */
  hasRunner: boolean;
  onChange: (next: SectionDraft) => void;
  onRemove: () => void;
}) {
  const fieldFindings = (field: string) =>
    findings.filter((finding) => finding.path === `sections.${index}.${field}`);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {section.grading === "manual"
              ? "Graded by hand"
              : section.type === "document"
                ? "Graded by the model"
                : sectionLabel(section.type)}
          </Badge>
          <span className="text-xs text-muted-foreground">Section {index + 1}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 data-icon="inline-start" />
          Remove
        </Button>
      </div>

      {section.grading === "manual" ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          {/*
            A new section arrives named "Total Score", which is right for an assignment that is
            simply worth twenty points. The placeholder only shows once that name is cleared,
            and suggests what an assignment with several hand-graded parts calls each of them.
          */}
          <Field label="What this section is called" findings={fieldFindings("label")}>
            <Input
              value={section.label}
              placeholder='e.g. "Reflection" or "Presentation"'
              onChange={(event) => onChange({ ...section, label: event.target.value })}
            />
          </Field>
          <PointValueField
            value={section.pointValue}
            findings={fieldFindings("pointValue")}
            onChange={(pointValue) => onChange({ ...section, pointValue })}
          />
        </div>
      ) : (
        <>
          {section.type !== "document" && (
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label="Files graded" findings={fieldFindings("type")}>
                <SearchableSelect
                  value={section.type}
                  choices={SECTION_TYPES.map((type) => ({
                    value: type,
                    label: sectionLabel(type),
                  }))}
                  searchLabel="Search files graded"
                  emptyText="Nothing matches."
                  onValueChange={(value) => {
                    const type = value as SectionType;
                    if (type === section.type) return;
                    // A rubric chosen for one type is rarely right for another, and the server
                    // does not check the two against each other, so the instructor chooses again.
                    onChange({ ...section, type, rubricId: "" });
                  }}
                />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field
              label="Rubric"
              findings={fieldFindings("rubricId")}
              hint={
                section.type === "document"
                  ? "What the model scores the whole hand-in against. Write one on the Rubrics screen."
                  : "What the model scores this section's work against. Write one on the Rubrics screen."
              }
            >
              <SearchableSelect
                value={section.rubricId}
                choices={rubrics.map((rubric) => ({ value: rubric.id, label: rubric.name }))}
                placeholder="Choose a rubric"
                searchLabel="Search rubrics"
                emptyText="No rubric matches."
                onValueChange={(value) => onChange({ ...section, rubricId: value })}
              />
            </Field>
            <PointValueField
              value={section.pointValue}
              findings={fieldFindings("pointValue")}
              onChange={(pointValue) => onChange({ ...section, pointValue })}
            />
          </div>

          {/*
            No checkbox. Whether the suite covers this section follows from its type and from
            the assignment having a runner at all — a short response has nothing to execute and
            every other type is checked against the suite when there is one. The only two
            settings a checkbox could have had were "correct" and "silently graded without the
            evidence it should have had".
          */}
          {section.type !== "document" && (
            <p className="text-xs text-muted-foreground">
              {section.type === "short_response"
                ? "Graded against the rubric and the reference answer."
                : hasRunner
                  ? "The score is checked against the instructor’s test suite. A report claiming a test passed that failed is held for review."
                  : "This assignment runs no tests, so the score rests on the model reading the code against the rubric."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

type Choice = { value: string; label: string };

/**
 * A dropdown whose list opens on a search field, built the way the grading queue's assignment
 * picker is, so that every searchable list in the application behaves alike.
 *
 * `value` is the chosen choice's `value`, or a string matching none of them (the empty `rubricId`
 * of a section with no rubric yet), in which case the trigger shows the placeholder.
 */
function SearchableSelect({
  value,
  choices,
  placeholder,
  searchLabel,
  emptyText,
  onValueChange,
}: {
  value: string;
  choices: Choice[];
  placeholder?: string;
  searchLabel: string;
  emptyText: string;
  onValueChange: (value: string) => void;
}) {
  const selected = choices.find((choice) => choice.value === value) ?? null;

  return (
    <Combobox.Root
      items={choices}
      value={selected}
      onValueChange={(next: Choice | null) => {
        if (next) onValueChange(next.value);
      }}
      itemToStringLabel={(choice: Choice) => choice.label}
      isItemEqualToValue={(a: Choice, b: Choice) => a.value === b.value}
    >
      <Combobox.Trigger className="flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50">
        <span className="min-w-0 flex-1 truncate text-left">
          <Combobox.Value
            placeholder={<span className="text-muted-foreground">{placeholder}</span>}
          />
        </span>
        <Combobox.Icon
          render={
            <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          }
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
          <Combobox.Popup className="isolate z-50 flex max-h-(--available-height) w-auto max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input
                placeholder={searchLabel}
                aria-label={searchLabel}
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-2.5 py-3 text-sm text-muted-foreground empty:hidden">
              {emptyText}
            </Combobox.Empty>
            <Combobox.List className="overflow-y-auto p-1">
              {(choice: Choice) => (
                <Combobox.Item
                  key={choice.value}
                  value={choice}
                  className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="whitespace-nowrap">{choice.label}</span>
                  <Combobox.ItemIndicator
                    render={
                      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
                    }
                  >
                    <Check className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function PointValueField({
  value,
  findings,
  onChange,
}: {
  value: number;
  findings: { message: string; severity: "error" | "warning" }[];
  onChange: (value: number) => void;
}) {
  return (
    <Field label="Points" findings={findings}>
      <Input
        type="number"
        min={1}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
      />
    </Field>
  );
}

/** A labelled field with its findings underneath, so a message sits where the problem is. */
export function Field({
  label,
  hint,
  findings = [],
  action,
  children,
}: {
  label: string;
  hint?: string;
  findings?: { message: string; severity: "error" | "warning" }[];
  // A control that belongs to this one field rather than to the form — a preview toggle, say.
  // It sits on the label's row so that it reads as part of the field and not as a form button.
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {action}
      </div>
      {children}
      {hint && findings.length === 0 && <p className="text-xs text-muted-foreground">{hint}</p>}
      {findings.map((finding, index) => (
        <p
          key={index}
          className={
            finding.severity === "error"
              ? "text-xs text-destructive"
              : "text-xs text-amber-700 dark:text-amber-300"
          }
        >
          {finding.message}
        </p>
      ))}
    </div>
  );
}
