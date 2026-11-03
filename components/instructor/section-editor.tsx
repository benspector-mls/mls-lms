"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Combobox } from "@base-ui/react/combobox";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Heading,
  ListTree,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProposedSection } from "@/lib/assignments/propose-sections";
import { newSectionKey, normalizedLabel } from "@/lib/assignments/spec";
import {
  testDisplay,
  testKey,
  type DeclaredTest,
  type TemplateTest,
} from "@/lib/assignments/test-names";
import {
  companionOf,
  companionsOf,
  isCompanion,
  PRIMARY_SECTION_TYPES,
  SECTION_TYPE_REGISTRY,
  sectionTypeEntry,
  type SectionType,
} from "@/lib/section-types";
import { sectionLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * The sections of an assignment being authored: one line per scored unit.
 *
 * **A section is one scored unit** — a question, an exercise, a rubric criterion — and every
 * section has a label, points and the skill it is evidence of, whether the model or an
 * instructor scores it. A section the model grades also has a type, which is the rubric and the
 * call that fill it, and for an assignment with a suite the tests that count toward it alone.
 *
 * **Nothing here is typed that can be read instead.** "Propose sections from the template"
 * reads the template repository and lists its questions, exercises or checklist items as
 * sections; "Suggest skills" asks the model for a skill per section, which the instructor
 * confirms. Both are offers: the list is the instructor's to edit, and a suggestion is shown
 * beside the picker until it is taken or replaced.
 *
 * **A heading is written once, above the sections under it.** Each section still stores its
 * heading as text, which is what the comment groups by; the list draws a run of sections sharing
 * a heading as one heading row with the sections nested beneath, so the heading is typed once and
 * a section's heading is whichever heading row stands above it. Arrows move a section up or
 * down, and a section moved past a heading row joins that heading's group.
 *
 * **A section does not name its reference solutions.** Those are every file under the folder
 * the assignment names, which is stated once above this editor rather than per section.
 */

export type SectionDraft =
  | {
      grading: "ai";
      key: string;
      label: string;
      heading?: string;
      pointValue: number;
      skillId?: string;
      type: SectionType;
      rubricId: string;
      reportTemplate?: string;
      evidence?: "tests";
      /** The template's tests that count toward this section alone; absent means the whole suite. */
      tests?: DeclaredTest[];
    }
  | {
      grading: "manual";
      key: string;
      label: string;
      heading?: string;
      pointValue: number;
      skillId?: string;
    };

export type SkillGroups = { id: string; name: string; skills: { id: string; name: string }[] }[];

/** The value the "Skill Assessed" select holds for a section that counts toward nothing. */
const NO_SKILL = "none";

/**
 * The sections with the writing section in place: one `short_response_writing` section after the
 * last `short_response` question when there are questions, and none when there are not.
 *
 * A short response is its questions and one writing score for the whole submission, and the
 * writing score is filled from the questions' call rather than chosen. So the form keeps the pair
 * itself: adding the first question adds the writing section beneath, removing the last question
 * removes it, and an assignment authored before the questions were sections gains it when the
 * form opens. Applied to every change of the list rather than to the one that caused it, so no
 * path through the form can leave half a pair. A writing section that already exists keeps its
 * points, its key and its skill.
 */
export function withCompanions(sections: SectionDraft[]): SectionDraft[] {
  const next: SectionDraft[] = [];
  const companions = new Map<SectionType, SectionDraft[]>();
  for (const section of sections) {
    if (section.grading === "ai" && isCompanion(section.type)) {
      companions.set(section.type, [...(companions.get(section.type) ?? []), section]);
      continue;
    }
    next.push(section);
  }

  for (const primary of PRIMARY_SECTION_TYPES) {
    for (const companion of companionsOf(primary)) {
      const last = next.findLastIndex(
        (section) => section.grading === "ai" && section.type === primary,
      );
      if (last === -1) continue;
      const lastPrimary = next[last] as Extract<SectionDraft, { grading: "ai" }>;
      const existing = companions.get(companion)?.[0];
      next.splice(
        last + 1,
        0,
        existing ?? {
          grading: "ai",
          key: newSectionKey(),
          label: SECTION_TYPE_REGISTRY[companion].label,
          type: companion,
          pointValue: sectionTypeEntry(companion).defaultPointValue ?? 1,
          rubricId: lastPrimary.rubricId,
        },
      );
    }
  }
  return next;
}

/** A section's heading as the list reads it: null for none or for whitespace. */
function headingOf(section: SectionDraft): string | null {
  return section.heading?.trim() ? section.heading : null;
}

/** The section with its heading set, or with none. */
function setHeading(section: SectionDraft, heading: string | null): SectionDraft {
  const next = { ...section };
  delete next.heading;
  return heading ? { ...next, heading } : next;
}

/** One run of consecutive sections sharing a heading: `[start, end)` into the list. */
type Run = { heading: string | null; start: number; end: number };

/** The list divided into runs, in order. A section under no heading is a run of its own kind. */
function runsOf(sections: SectionDraft[]): Run[] {
  const runs: Run[] = [];
  sections.forEach((section, index) => {
    const heading = headingOf(section);
    const last = runs[runs.length - 1];
    if (last && last.heading === heading) last.end = index + 1;
    else runs.push({ heading, start: index, end: index + 1 });
  });
  return runs;
}

/** The number a label such as "Question 13: bad_scope.py" opens with, or null. */
function questionNumber(label: string): string | null {
  return /^question\s+(\d+)\b/i.exec(label.trim())?.[1] ?? null;
}

/**
 * The proposed sections as the form holds them, each with the rubric its type names.
 *
 * A proposed section that is the same section as one already in the list takes that section's
 * key and skill. The key, so that rounds already graded under it still find their declaration
 * after the README is re-read. The skill, so that proposing again after a question was added
 * or renamed does not undo the tagging of every question that stayed.
 *
 * Two sections are the same when their labels match, or failing that when both are of one
 * type and open with the same question number: a README heading that was reworded keeps its
 * number, and the number is what a graded round under the old wording still shares with it.
 * The type matters because a short response and a coding README both count from one. Labels are matched first over
 * the whole list, then numbers over what is left, and each existing section is matched at most
 * once, which keeps keys unique.
 */
function adoptAll(
  proposed: ProposedSection[],
  existing: SectionDraft[],
  rubrics: { id: string; name: string }[],
): SectionDraft[] {
  const unmatched = [...existing];
  const matches = new Map<ProposedSection, SectionDraft>();
  const claim = (same: (old: SectionDraft, section: ProposedSection) => boolean) => {
    for (const section of proposed) {
      if (matches.has(section)) continue;
      const at = unmatched.findIndex((old) => same(old, section));
      if (at !== -1) matches.set(section, unmatched.splice(at, 1)[0]!);
    }
  };
  claim((old, section) => normalizedLabel(old.label) === normalizedLabel(section.label));
  claim((old, section) => {
    const number = questionNumber(section.label);
    return (
      number !== null &&
      old.grading === "ai" &&
      old.type === section.type &&
      questionNumber(old.label) === number
    );
  });

  return proposed.map((section) => {
    const rubric = rubrics.find(
      (candidate) => candidate.name === SECTION_TYPE_REGISTRY[section.type].rubricName,
    );
    const match = matches.get(section) ?? null;
    const adopted: SectionDraft = {
      grading: "ai",
      key: match?.key ?? section.key,
      label: section.label,
      pointValue: section.pointValue,
      type: section.type,
      rubricId: rubric?.id ?? "",
    };
    if (section.heading) adopted.heading = section.heading;
    if (section.tests && section.tests.length > 0) adopted.tests = section.tests;
    if (match?.skillId) adopted.skillId = match.skillId;
    return adopted;
  });
}

type Suggestion = { skillId: string | null; reason: string };

export function SectionList({
  sections,
  rubrics,
  skillGroups,
  findings,
  hasRunner,
  courseId,
  title,
  template,
  onChange,
}: {
  sections: SectionDraft[];
  rubrics: { id: string; name: string }[];
  /** This program's taxonomy, for "Skill Assessed": the groups in order, each with its skills. */
  skillGroups: SkillGroups;
  findings: { path: string; message: string; severity: "error" | "warning" }[];
  /** False when the assignment runs no tests, which makes a test pattern meaningless. */
  hasRunner: boolean;
  courseId: string;
  title: string;
  /** The repository to propose from, or null for a kind with no repository. */
  template: { templateRepo: string; templateRef: string | null; runnerPreset: string } | null;
  onChange: (next: SectionDraft[]) => void;
}) {
  const trpc = useTRPC();

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [bulkSkill, setBulkSkill] = React.useState<string>(NO_SKILL);
  const [suggestions, setSuggestions] = React.useState<ReadonlyMap<string, Suggestion>>(new Map());
  // The prompt text the proposal read for each section, kept for the suggestion and never saved.
  const texts = React.useRef(new Map<string, string>());
  /** The list as it stands, readable when a request answers rather than as it was when sent. */
  const current = React.useRef(sections);
  current.current = sections;

  const skillName = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const group of skillGroups)
      for (const skill of group.skills) names.set(skill.id, skill.name);
    return names;
  }, [skillGroups]);

  const propose = useMutation(
    trpc.assignments.proposeSections.mutationOptions({
      onSuccess: (proposal) => {
        if (proposal.sections.length === 0) {
          toast.error(proposal.notes.join(" "));
          return;
        }
        const typed = sections.some(
          (section) => section.label !== "Total Score" || sections.length > 1,
        );
        if (
          typed &&
          !window.confirm(
            `Replace the ${sections.length === 1 ? "section" : `${sections.length} sections`} ` +
              `below with the ${proposal.sections.length} the template proposes?`,
          )
        ) {
          return;
        }
        const adopted = adoptAll(proposal.sections, current.current, rubrics);
        // Keyed as the form will hold them, since an adopted section may keep an older key.
        texts.current = new Map(
          proposal.sections.flatMap((section, index) =>
            section.text ? [[adopted[index]!.key, section.text] as const] : [],
          ),
        );
        setSuggestions(new Map());
        setSelected(new Set());
        onChange(withCompanions(adopted));
        toast.success(
          `${proposal.sections.length} sections proposed.` +
            (proposal.notes.length > 0 ? ` ${proposal.notes.join(" ")}` : ""),
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const suggest = useMutation(
    trpc.assignments.suggestSkills.mutationOptions({
      onSuccess: (result) => {
        /*
          Kept only for sections still in the list. The request named the sections as they were
          when it was sent, and a proposal adopted or a section removed in the meantime leaves a
          suggestion with no row to sit beside; stored anyway, it would count toward "Use every
          suggestion" and apply to nothing.
        */
        const keys = new Set(current.current.map((section) => section.key));
        const kept = result.filter((entry) => keys.has(entry.key));
        setSuggestions(
          new Map(
            kept.map((entry) => [entry.key, { skillId: entry.skillId, reason: entry.reason }]),
          ),
        );
        if (kept.length === 0) {
          toast.error("The sections changed while the suggestions were being made. Ask again.");
          return;
        }
        toast.success(`${kept.length} suggestions.`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const update = (index: number, next: SectionDraft) =>
    onChange(withCompanions(sections.map((old, i) => (i === index ? next : old))));
  const remove = (index: number) => {
    const key = sections[index]?.key;
    if (key !== undefined) {
      setSelected((current) => {
        const copy = new Set(current);
        copy.delete(key);
        return copy;
      });
    }
    onChange(withCompanions(sections.filter((_, i) => i !== index)));
  };
  const runs = runsOf(sections);

  /*
    The template's suite, read once for the whole list and kept while the form is open. Asked
    for only where a section could choose from it: a repository assignment with a runner and a
    template named.
  */
  const templateTests = useQuery(
    trpc.assignments.templateTests.queryOptions(
      {
        courseId,
        templateRepo: template?.templateRepo ?? "",
        templateRef: template?.templateRef ?? null,
      },
      {
        enabled: template !== null && hasRunner && template.templateRepo.trim() !== "",
        staleTime: Infinity,
      },
    ),
  );
  /** Which section chose each test, by the test's key, for the "also …" note in the picker. */
  const claimedBy = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const section of sections) {
      if (section.grading !== "ai") continue;
      for (const test of section.tests ?? []) {
        const key = testKey(test);
        map.set(key, [...(map.get(key) ?? []), section.label.trim() || "an unnamed section"]);
      }
    }
    return map;
  }, [sections]);

  /**
   * Swaps a section with its neighbour. The moved section takes the heading of the section it
   * jumped over: within a group that is its own heading, and across a heading row it is the
   * group it has just entered, which is what the eye reads it as having done.
   */
  /**
   * The positions a section can be moved among: every section but a writing companion, which
   * `withCompanions` places after the last question whatever is done to the list, so an arrow
   * that moved a question past it would see the companion step back over the question.
   */
  const movable = sections.flatMap((section, index) =>
    section.grading === "ai" && isCompanion(section.type) ? [] : [index],
  );
  const moveSection = (index: number, direction: -1 | 1) => {
    const at = movable.indexOf(index);
    const target = at === -1 ? undefined : movable[at + direction];
    const moved = sections[index];
    const over = target === undefined ? undefined : sections[target];
    if (!moved || !over || target === undefined) return;
    const next = [...sections];
    next[target] = setHeading(moved, headingOf(over));
    next[index] = over;
    onChange(withCompanions(next));
  };
  /** Swaps a whole run with the run beside it. */
  const moveRun = (runIndex: number, direction: -1 | 1) => {
    const run = runs[runIndex];
    const other = runs[runIndex + direction];
    if (!run || !other) return;
    const [first, second] = direction === -1 ? [other, run] : [run, other];
    const next = [
      ...sections.slice(0, first.start),
      ...sections.slice(second.start, second.end),
      ...sections.slice(first.start, first.end),
      ...sections.slice(second.end),
    ];
    onChange(withCompanions(next));
  };
  /** Every section of a run takes the heading, or none, which merges the run into the one above. */
  const setRunHeading = (runIndex: number, heading: string | null) => {
    const run = runs[runIndex];
    if (!run) return;
    const next = heading ?? runs[runIndex - 1]?.heading ?? null;
    onChange(
      withCompanions(
        sections.map((section, index) =>
          index >= run.start && index < run.end ? setHeading(section, next) : section,
        ),
      ),
    );
  };
  /** A new heading over this section and the rest of its run, which the instructor then names. */
  const addHeadingAbove = (index: number) => {
    const run = runs.find((candidate) => index >= candidate.start && index < candidate.end);
    if (!run) return;
    onChange(
      withCompanions(
        sections.map((section, at) =>
          at >= index && at < run.end ? setHeading(section, "New heading") : section,
        ),
      ),
    );
  };

  const setSkill = (section: SectionDraft, skillId: string | null): SectionDraft => {
    const next = { ...section };
    delete next.skillId;
    return skillId ? { ...next, skillId } : next;
  };

  const sectionFindings = findings.filter((finding) => finding.path === "sections");
  const applyToSelected = () => {
    const skillId = bulkSkill === NO_SKILL ? null : bulkSkill;
    onChange(
      sections.map((section) => (selected.has(section.key) ? setSkill(section, skillId) : section)),
    );
    setSelected(new Set());
  };
  const takeAll = () => {
    onChange(
      sections.map((section) => {
        const suggestion = suggestions.get(section.key);
        return suggestion ? setSkill(section, suggestion.skillId) : section;
      }),
    );
    setSuggestions(new Map());
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {template !== null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={propose.isPending || suggest.isPending || template.templateRepo.trim() === ""}
            onClick={() =>
              propose.mutate({
                courseId,
                templateRepo: template.templateRepo,
                templateRef: template.templateRef,
                runnerPreset: template.runnerPreset,
              })
            }
          >
            <ListTree data-icon="inline-start" />
            {propose.isPending ? "Reading the template…" : "Propose sections from the template"}
          </Button>
        )}
        {skillGroups.length > 0 && sections.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={suggest.isPending || propose.isPending}
            onClick={() =>
              suggest.mutate({
                courseId,
                title: title.trim() === "" ? "Untitled assignment" : title,
                sections: sections.map((section) => ({
                  key: section.key,
                  label: section.label.trim() === "" ? "(unnamed)" : section.label,
                  ...(section.heading ? { heading: section.heading } : {}),
                  ...(texts.current.get(section.key)
                    ? { text: texts.current.get(section.key) }
                    : {}),
                })),
              })
            }
          >
            <Sparkles data-icon="inline-start" />
            {suggest.isPending ? "Asking…" : "Suggest skills"}
          </Button>
        )}
        {suggestions.size > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={takeAll}>
            Use every suggestion
          </Button>
        )}
      </div>

      {sections.length > 0 && (
        <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {runs.map((run, runIndex) => (
            <React.Fragment key={sections[run.start]!.key}>
              {run.heading !== null && (
                <HeadingRow
                  heading={run.heading}
                  canMoveUp={runIndex > 0}
                  canMoveDown={runIndex < runs.length - 1}
                  onRename={(text) => setRunHeading(runIndex, text)}
                  onRemove={() => setRunHeading(runIndex, null)}
                  onMove={(direction) => moveRun(runIndex, direction)}
                />
              )}
              {sections.slice(run.start, run.end).map((section, offset) => {
                const index = run.start + offset;
                return (
                  <SectionRow
                    key={section.key}
                    section={section}
                    index={index}
                    rubrics={rubrics}
                    skillGroups={skillGroups}
                    skillName={skillName}
                    findings={findings}
                    hasRunner={hasRunner}
                    selected={selected.has(section.key)}
                    suggestion={suggestions.get(section.key) ?? null}
                    indented={run.heading !== null}
                    canMoveUp={movable.indexOf(index) > 0}
                    canMoveDown={
                      movable.indexOf(index) !== -1 && movable.indexOf(index) < movable.length - 1
                    }
                    // A section already first under a heading has its heading row; the rest
                    // can open a new group starting at themselves.
                    canAddHeading={!(run.heading !== null && offset === 0)}
                    templateTests={templateTests}
                    claimedBy={claimedBy}
                    onMove={(direction) => moveSection(index, direction)}
                    onAddHeading={() => addHeadingAbove(index)}
                    onSelect={(checked) =>
                      setSelected((current) => {
                        const copy = new Set(current);
                        if (checked) copy.add(section.key);
                        else copy.delete(section.key);
                        return copy;
                      })
                    }
                    onChange={(next) => update(index, next)}
                    onTakeSuggestion={() => {
                      const suggestion = suggestions.get(section.key);
                      if (!suggestion) return;
                      update(index, setSkill(section, suggestion.skillId));
                      setSuggestions((current) => {
                        const copy = new Map(current);
                        copy.delete(section.key);
                        return copy;
                      });
                    }}
                    onRemove={() => remove(index)}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </ol>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Skill for the {selected.size === 1 ? "selected section" : `${selected.size} selected`}
          </span>
          <SkillSelect
            value={bulkSkill}
            skillGroups={skillGroups}
            onChange={setBulkSkill}
            className="w-64"
          />
          <Button type="button" size="sm" onClick={applyToSelected}>
            Apply
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {sectionFindings.map((finding, index) => (
        <p key={index} className="text-xs text-destructive">
          {finding.message}
        </p>
      ))}
    </div>
  );
}

function SectionRow({
  section,
  index,
  rubrics,
  skillGroups,
  skillName,
  findings,
  hasRunner,
  selected,
  suggestion,
  indented,
  canMoveUp,
  canMoveDown,
  canAddHeading,
  templateTests,
  claimedBy,
  onMove,
  onAddHeading,
  onSelect,
  onChange,
  onTakeSuggestion,
  onRemove,
}: {
  section: SectionDraft;
  index: number;
  rubrics: { id: string; name: string }[];
  skillGroups: SkillGroups;
  skillName: ReadonlyMap<string, string>;
  findings: { path: string; message: string; severity: "error" | "warning" }[];
  hasRunner: boolean;
  selected: boolean;
  suggestion: Suggestion | null;
  /** True under a heading row, which the section sits in from. */
  indented: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canAddHeading: boolean;
  /** The template's suite as the list read it: loading, failed, or the tests. */
  templateTests: { isPending: boolean; error: { message: string } | null; data?: TemplateTest[] };
  /** The labels of the sections that chose each test, by test key. */
  claimedBy: ReadonlyMap<string, string[]>;
  onMove: (direction: -1 | 1) => void;
  onAddHeading: () => void;
  onSelect: (checked: boolean) => void;
  onChange: (next: SectionDraft) => void;
  onTakeSuggestion: () => void;
  onRemove: () => void;
}) {
  const own = findings.filter((finding) => finding.path.startsWith(`sections.${index}.`));
  const primary = section.grading === "ai" ? companionOf(section.type) : null;
  const testsApply =
    section.grading === "ai" && hasRunner && section.type !== "short_response" && primary === null;

  return (
    <li className={cn("flex flex-col gap-2 py-2 pr-3", indented ? "pl-8" : "pl-3")}>
      {/*
        The first line is what names the section: its label, with every column it does not
        need to share given to it, and its points. A label such as "Question 2: loop_until_done"
        has to be readable whole, because it is the heading the student reads in the comment.
        The rubric, the skill, the heading and the tests sit on the captioned line beneath.
      */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_5rem_auto] items-center gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
          aria-label={`Select section ${index + 1}`}
        />
        <Input
          value={section.label}
          placeholder={section.grading === "manual" ? "Reflection" : "Question 1: is_even"}
          aria-label={`Section ${index + 1} label`}
          onChange={(event) => onChange({ ...section, label: event.target.value })}
        />
        <Input
          type="number"
          min={1}
          value={Number.isFinite(section.pointValue) ? section.pointValue : ""}
          aria-label={`Section ${index + 1} points`}
          onChange={(event) =>
            onChange({ ...section, pointValue: Number.parseInt(event.target.value, 10) })
          }
        />
        {primary === null ? (
          <span className="flex items-center">
            {canAddHeading && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onAddHeading}
                title="Add a heading above"
                aria-label={`Add a heading above section ${index + 1}`}
              >
                <Heading />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
              title="Move up"
              aria-label={`Move section ${index + 1} up`}
            >
              <ChevronUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
              title="Move down"
              aria-label={`Move section ${index + 1} down`}
            >
              <ChevronDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              title="Remove"
              aria-label={`Remove section ${index + 1}`}
            >
              <Trash2 />
            </Button>
          </span>
        ) : (
          <span />
        )}
      </div>

      <div className="grid gap-2 pl-7 sm:grid-cols-2 xl:grid-cols-3">
        <Captioned caption="Rubric">
          {section.grading === "ai" && primary === null ? (
            <Select
              value={section.type}
              onValueChange={(value) => {
                const type = value as SectionType;
                // The rubric follows the type rather than being chosen separately. The
                // procedures refuse a mismatched pairing, so offering the choice would only
                // create a way to be refused.
                const rubric = rubrics.find(
                  (candidate) => candidate.name === SECTION_TYPE_REGISTRY[type].rubricName,
                );
                onChange({ ...section, type, rubricId: rubric?.id ?? section.rubricId });
              }}
              items={Object.fromEntries(
                PRIMARY_SECTION_TYPES.map((type) => [type, sectionLabel(type)]),
              )}
            >
              <SelectTrigger aria-label={`Section ${index + 1} type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIMARY_SECTION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {sectionLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary" className="self-start font-normal">
              {section.grading === "ai" ? sectionLabel(section.type) : "Graded by hand"}
            </Badge>
          )}
        </Captioned>
        <Captioned caption="Skill">
          <SkillSelect
            value={section.skillId ?? NO_SKILL}
            skillGroups={skillGroups}
            ariaLabel={`Section ${index + 1} skill`}
            onChange={(value) => {
              // Absent rather than empty when nothing is chosen, which is what the schema holds.
              const next = { ...section };
              delete next.skillId;
              onChange(value !== NO_SKILL ? { ...next, skillId: value } : next);
            }}
          />
        </Captioned>
        {testsApply && section.grading === "ai" && (
          <Captioned caption="Tests">
            <TestPicker
              chosen={section.tests ?? []}
              suite={templateTests}
              alsoChosenBy={(test) =>
                (claimedBy.get(testKey(test)) ?? []).filter((label) => label !== section.label)
              }
              ariaLabel={`Section ${index + 1} tests`}
              onChange={(tests) => {
                // Absent rather than empty when nothing is chosen, which is what the schema holds.
                const next = { ...section };
                delete next.tests;
                onChange(tests.length > 0 ? { ...next, tests } : next);
              }}
            />
          </Captioned>
        )}
      </div>

      {primary !== null && (
        <p className="pl-7 text-xs text-muted-foreground">
          One score for the whole submission, filled from the questions&apos; report.
        </p>
      )}

      {suggestion !== null && (
        <div className="flex flex-wrap items-center gap-2 pl-7 text-xs">
          <span className="text-muted-foreground">
            Suggested:{" "}
            <span className="font-medium text-foreground">
              {suggestion.skillId === null
                ? "nothing"
                : (skillName.get(suggestion.skillId) ?? "a skill no longer in the taxonomy")}
            </span>
            {suggestion.reason !== "" && <> — {suggestion.reason}</>}
          </span>
          <Button type="button" size="xs" variant="outline" onClick={onTakeSuggestion}>
            Use
          </Button>
        </div>
      )}

      {own.map((finding, i) => (
        <p
          key={i}
          className={
            finding.severity === "error"
              ? "pl-7 text-xs text-destructive"
              : "pl-7 text-xs text-amber-700 dark:text-amber-300"
          }
        >
          {finding.message}
        </p>
      ))}
    </li>
  );
}

/** One choice in the skill picker: a skill, or the "Nothing" entry that clears the tag. */
type SkillChoice = { id: string; name: string };

const NOTHING: SkillChoice = { id: NO_SKILL, name: "Nothing" };

/**
 * The "Skill Assessed" picker: a search box over the taxonomy's groups, each holding its
 * skills, and Nothing.
 *
 * A combobox rather than a select, because a taxonomy has fifty skills and finding one by
 * scrolling nine groups is slower than typing three letters of its name. The box opens on the
 * search field; the list beneath it keeps the groups, filtered to the skills whose name matches
 * what was typed. The trigger fills its column and cuts a long name short rather than running
 * into the field beside it.
 */
function SkillSelect({
  value,
  skillGroups,
  ariaLabel,
  className,
  onChange,
}: {
  value: string;
  skillGroups: SkillGroups;
  ariaLabel?: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const groups = React.useMemo(
    () => [
      { value: "", items: [NOTHING] },
      ...skillGroups.map((group) => ({
        value: group.name,
        items: group.skills.map((skill): SkillChoice => ({ id: skill.id, name: skill.name })),
      })),
    ],
    [skillGroups],
  );
  const selected =
    groups.flatMap((group) => group.items).find((choice) => choice.id === value) ?? NOTHING;

  return (
    <Combobox.Root
      items={groups}
      value={selected}
      onValueChange={(next) => onChange(next?.id ?? NO_SKILL)}
      itemToStringLabel={(choice: SkillChoice) => choice.name}
      isItemEqualToValue={(a: SkillChoice, b: SkillChoice) => a.id === b.id}
    >
      <Combobox.Trigger
        aria-label={ariaLabel ?? "Skill Assessed"}
        className={cn(
          "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <Combobox.Value />
        </span>
        <Combobox.Icon
          render={
            <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          }
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
          {/*
            As wide as its longest name rather than as wide as the trigger, never narrower than
            the trigger, and never wider or taller than the window has room for.
          */}
          <Combobox.Popup className="isolate z-50 flex max-h-(--available-height) w-auto max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input
                placeholder="Search skills"
                aria-label="Search skills"
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-2.5 py-3 text-sm text-muted-foreground empty:hidden">
              No skill matches.
            </Combobox.Empty>
            <Combobox.List className="overflow-y-auto p-1">
              {(group: { value: string; items: SkillChoice[] }) => (
                <Combobox.Group key={group.value} items={group.items}>
                  {group.value !== "" && (
                    <Combobox.GroupLabel className="px-1.5 py-1 text-xs text-muted-foreground">
                      {group.value}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(choice: SkillChoice) => (
                      <Combobox.Item
                        key={choice.id}
                        value={choice}
                        className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <span className="whitespace-nowrap">{choice.name}</span>
                        <Combobox.ItemIndicator
                          render={
                            <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
                          }
                        >
                          <Check className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/**
 * The tests that count toward one section, picked from the template's suite.
 *
 * A list to tick rather than a pattern to type, because the suite is already written: every
 * test the template declares is offered under its file and its describe block, a search box
 * narrows them by name, and a block's own box ticks every test under it. A test another section
 * has chosen says so beside its name and stays tickable, since two sections may share a test
 * on purpose. A chosen test the template no longer declares is listed last so it can be
 * unticked.
 */
function TestPicker({
  chosen,
  suite,
  alsoChosenBy,
  ariaLabel,
  onChange,
}: {
  chosen: DeclaredTest[];
  suite: { isPending: boolean; error: { message: string } | null; data?: TemplateTest[] };
  alsoChosenBy: (test: DeclaredTest) => string[];
  ariaLabel: string;
  onChange: (tests: DeclaredTest[]) => void;
}) {
  const [search, setSearch] = React.useState("");
  const chosenKeys = React.useMemo(() => new Set(chosen.map(testKey)), [chosen]);
  const available = React.useMemo(() => suite.data ?? [], [suite.data]);
  const availableKeys = React.useMemo(() => new Set(available.map(testKey)), [available]);
  const gone = chosen.filter((test) => !availableKeys.has(testKey(test)));

  const needle = search.trim().toLowerCase();
  const shown = available.filter(
    (test) => needle === "" || `${test.path} ${testDisplay(test)}`.toLowerCase().includes(needle),
  );

  /** The shown tests by file, and within a file by describe block, in the order read. */
  const files: { path: string; blocks: { suite: string | null; tests: TemplateTest[] }[] }[] = [];
  for (const test of shown) {
    let file = files[files.length - 1];
    if (!file || file.path !== test.path) {
      file = { path: test.path, blocks: [] };
      files.push(file);
    }
    let block = file.blocks[file.blocks.length - 1];
    if (!block || block.suite !== test.suite) {
      block = { suite: test.suite, tests: [] };
      file.blocks.push(block);
    }
    block.tests.push(test);
  }

  const setChosen = (tests: DeclaredTest[], on: boolean) => {
    const keys = new Set(tests.map(testKey));
    const kept = chosen.filter((test) => !keys.has(testKey(test)));
    onChange(on ? [...kept, ...tests.map(({ suite: s, name }) => ({ suite: s, name }))] : kept);
  };

  const summary =
    chosen.length === 0
      ? "No tests"
      : chosen.length === 1
        ? `1 test: ${testDisplay(chosen[0]!)}`
        : `${chosen.length} tests`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-8 w-full min-w-0 justify-between px-2.5 font-normal"
            aria-label={ariaLabel}
          />
        }
      >
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-96 max-w-(--available-width) flex-col gap-2 p-2"
      >
        <div className="flex items-center gap-2 border-b border-border px-1 pb-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tests"
            aria-label="Search tests"
            className="h-7 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {suite.isPending ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Reading the template…</p>
        ) : suite.error ? (
          <p className="px-1 py-2 text-sm text-destructive">{suite.error.message}</p>
        ) : available.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">The template declares no tests.</p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">No test matches.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {files.map((file) => (
              <div key={file.path} className="flex flex-col gap-1">
                <span className="px-1 font-mono text-xs text-muted-foreground">{file.path}</span>
                {file.blocks.map((block, at) => {
                  const allOn = block.tests.every((test) => chosenKeys.has(testKey(test)));
                  const someOn = block.tests.some((test) => chosenKeys.has(testKey(test)));
                  return (
                    <div key={`${block.suite ?? ""}-${at}`} className="flex flex-col">
                      {block.suite !== null && (
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm font-medium hover:bg-muted/50">
                          <Checkbox
                            checked={allOn}
                            indeterminate={!allOn && someOn}
                            onCheckedChange={(checked) => setChosen(block.tests, checked === true)}
                            aria-label={`Every test in ${block.suite}`}
                          />
                          <span className="min-w-0 truncate">{block.suite}</span>
                        </label>
                      )}
                      {block.tests.map((test) => {
                        const others = alsoChosenBy(test);
                        return (
                          <label
                            key={testKey(test)}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50",
                              block.suite !== null && "pl-6",
                            )}
                          >
                            <Checkbox
                              checked={chosenKeys.has(testKey(test))}
                              onCheckedChange={(checked) => setChosen([test], checked === true)}
                            />
                            <span className="min-w-0 flex-1 truncate">{test.name}</span>
                            {others.length > 0 && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                also {others.join(", ")}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {gone.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <span className="px-1 text-xs text-muted-foreground">Not in the template now</span>
            {gone.map((test) => (
              <label
                key={testKey(test)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50"
              >
                <Checkbox checked onCheckedChange={() => setChosen([test], false)} />
                <span className="min-w-0 flex-1 truncate">{testDisplay(test)}</span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A heading row: the heading's text, typed once for every section beneath it, with arrows that
 * move the whole group and a button that removes the heading and leaves its sections in place,
 * under the heading above them.
 *
 * The text is committed when the box is left or Enter is pressed rather than on every
 * keystroke, because the row exists only while some section carries its text: committing an
 * emptied box on each keystroke would remove the row under the cursor the moment the last
 * character went.
 */
function HeadingRow({
  heading,
  canMoveUp,
  canMoveDown,
  onRename,
  onRemove,
  onMove,
}: {
  heading: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (text: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [text, setText] = React.useState(heading);
  React.useEffect(() => setText(heading), [heading]);
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") onRemove();
    else if (trimmed !== heading) onRename(trimmed);
  };

  return (
    <li className="flex items-center gap-2 bg-muted/40 py-1.5 pr-3 pl-3">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label="Heading"
        className="h-8 flex-1 font-semibold"
      />
      <span className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          title="Move this group up"
          aria-label={`Move ${heading} up`}
        >
          <ChevronUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          title="Move this group down"
          aria-label={`Move ${heading} down`}
        >
          <ChevronDown />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          title="Remove the heading; its sections stay"
          aria-label={`Remove the heading ${heading}`}
        >
          <X />
        </Button>
      </span>
    </li>
  );
}

/**
 * One control on a section's second line, under a caption naming what it holds. A `span`
 * rather than a `label`, because two of the four hold a select or a badge, which a label would
 * either double-toggle or point at nothing; each control names itself with `aria-label`.
 */
function Captioned({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{caption}</span>
      {children}
    </div>
  );
}

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
