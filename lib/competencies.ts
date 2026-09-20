/**
 * What the competency list *is*, rather than what is in it.
 *
 * **The list itself lives in three tables** — `competency_groups`, `competencies`,
 * `competency_entries` — which admins author on a screen in the application. This module holds the
 * two things that cannot live there: the disciplines, which are structure rather than content, and
 * the pure functions the picker needs over a list it has been handed.
 *
 * **A goal never reads this module or those tables.** It stores its entry's id and a copy of the
 * wording at the moment it was chosen, so an admin rewording, moving, or deleting an entry cannot
 * reach a goal already written against it. That is what makes the list editable at all.
 *
 * Browser-safe and importing nothing but the generated enums, in the manner of
 * `lib/course-units.ts`: the picker and the authoring screen both run in the browser.
 */

import type { CompetencyEntryKind, Discipline } from "./generated/prisma/enums";

export type { CompetencyEntryKind, Discipline };

/**
 * The fellowships the school runs, in the order they are offered.
 *
 * **Fixed here rather than authored, unlike every other part of the list.** A program names one
 * and the goal procedures filter on it, so a discipline is structure: adding one means deciding
 * what it is called, which competencies it is offered, and which programs run it. A new *section*
 * of the list is none of that, which is why sections are rows.
 */
export const DISCIPLINES = [
  "SOFTWARE_ENGINEERING",
  "DATA_ANALYTICS",
] as const satisfies readonly Discipline[];

/** The two kinds of entry, for the selector that writes one and the zod schema that accepts one. */
export const ENTRY_KINDS = [
  "INDICATOR",
  "PITFALL",
] as const satisfies readonly CompetencyEntryKind[];

export type DisciplineMeta = {
  /** What the fellowship is called on screen. */
  label: string;
};

/**
 * `satisfies` rather than an annotation, so a discipline added to the enum and forgotten here is a
 * compile error — the guarantee `CATEGORY_META` makes in `lib/course-units.ts`.
 */
export const DISCIPLINE_META = {
  SOFTWARE_ENGINEERING: { label: "Software Engineering" },
  DATA_ANALYTICS: { label: "Data Analytics" },
} satisfies Record<Discipline, DisciplineMeta>;

/**
 * The list as every screen receives it: sections holding competencies holding entries.
 *
 * Structural types rather than the generated row types, because what the picker renders is what
 * `competencies.forProgram` selects — a few columns of each table, nested — and a type naming the
 * columns is what keeps the pure functions below usable from a test without a database.
 */
export type CompetencyEntry = {
  id: string;
  kind: CompetencyEntryKind;
  text: string;
};

export type Competency = {
  id: string;
  name: string;
  blurb: string;
  /** Indicators and pitfalls together, in the order an admin put them. */
  entries: readonly CompetencyEntry[];
};

export type CompetencySection = {
  id: string;
  name: string;
  competencies: readonly Competency[];
};

/** One chosen line, carrying everything a goal copies from it. */
export type PickableEntry = {
  entryId: string;
  kind: CompetencyEntryKind;
  text: string;
  competencyName: string;
};

/** The entries of one kind, for the screens that show indicators and pitfalls apart. */
export function entriesOfKind(
  competency: Competency,
  kind: CompetencyEntryKind,
): readonly CompetencyEntry[] {
  return competency.entries.filter((entry) => entry.kind === kind);
}

/**
 * The list a search query leaves standing, pruned to its matching entries.
 *
 * Case-insensitive substring over entry text, competency name, and section name. A query matching
 * a competency's name or its section's name keeps everything under that competency — somebody
 * typing "growth mindset" wants the competency, not the subset of its lines that repeat the words
 * — and a competency left with no entries, or a section left with no competencies, disappears
 * rather than standing as an empty heading. A blank query is the whole list, which is what the
 * picker opens on.
 */
export function filterCompetencies(
  query: string,
  sections: readonly CompetencySection[],
): readonly CompetencySection[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return sections;

  const matches = (text: string) => text.toLowerCase().includes(needle);

  return sections.flatMap((section) => {
    const competencies = section.competencies.flatMap((competency) => {
      if (matches(competency.name) || matches(section.name)) return [competency];

      const entries = competency.entries.filter((entry) => matches(entry.text));
      return entries.length === 0 ? [] : [{ ...competency, entries }];
    });

    return competencies.length === 0 ? [] : [{ ...section, competencies }];
  });
}
