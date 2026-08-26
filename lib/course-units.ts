/**
 * What a module, a project, and an assessment are called, and the order their work is shown in.
 *
 * All three are a `CourseUnit`: a named, ordered container of assignments and resources. The
 * category is the only thing that differs, and what it says is what the unit is *for* — a module
 * demonstrates skill development, a project skill application, an assessment skill evaluation.
 * There is no second table and no second parent for an assignment.
 *
 * **Browser-safe and importing nothing but the generated enum**, in the manner of
 * `lib/section-types.ts`: the gradebook tabs, the curriculum screen, and a student's course page
 * all read this, and anything needing the database or the network would put it out of reach of
 * the ones that run in the browser.
 */

import type { CourseUnitCategory } from "./generated/prisma/enums";

export type { CourseUnitCategory };

/**
 * The three categories, in the order screens present them.
 *
 * A tuple rather than the keys of the record below, because the order is a decision rather than
 * an accident of how an object literal was typed: this is the order of the gradebook's tabs and
 * of a student's progress bars, and modules come first because they are most of what a course
 * contains.
 */
export const UNIT_CATEGORIES = [
  "MODULE",
  "PROJECT",
  "ASSESSMENT",
] as const satisfies readonly CourseUnitCategory[];

export type CategoryMeta = {
  /**
   * What the *work* in this category is called where it is measured: the gradebook's tabs and a
   * student's progress bars. Title case, plural.
   *
   * A module's is "Assignments" rather than "Modules", and that is the one place the three do not
   * read alike. It is deliberate: the Projects tab is a grid of projects and the Assessments tab a
   * grid of assessments, but the third is where every ordinary assignment in the course lives, and
   * "Modules" named the containers rather than the thing an instructor went there to read. See
   * `unitsLabel` for the times the containers themselves are being listed.
   */
  tabLabel: string;
  /**
   * What the *containers* are called, for a list of units to pick one from. Title case, plural.
   *
   * Separate from `tabLabel` because a select offering somewhere to file an assignment is naming
   * modules, not assignments — a group heading reading "Assignments" over a list of modules would
   * describe the wrong thing entirely.
   */
  unitsLabel: string;
  /** One of them, for a sentence. Sentence case, because it appears mid-sentence. */
  noun: string;
  /** Several of them. */
  pluralNoun: string;
  /**
   * What one assignment inside it is called: "deliverable" in a project, "part" in an
   * assessment, and simply "assignment" in a module.
   *
   * Here rather than chosen at each call site, because several screens need the word — the
   * unit's heading, its "Add …" button, the gradebook's nested rows, and a student's course
   * page — and several independent guesses is how an interface comes to call the same thing
   * three names.
   */
  partNoun: string;
  /** Several of them. */
  partPluralNoun: string;
  /** One line saying what this kind of unit is for, shown where a category is chosen. */
  blurb: string;
};

/**
 * `satisfies` rather than an annotation, so a category added to the enum and forgotten here is a
 * compile error — the whole point of the two sitting in one file.
 */
export const CATEGORY_META = {
  MODULE: {
    tabLabel: "Assignments",
    unitsLabel: "Modules",
    noun: "module",
    pluralNoun: "modules",
    partNoun: "assignment",
    partPluralNoun: "assignments",
    blurb: "Skill development: the ordinary teaching unit.",
  },
  PROJECT: {
    tabLabel: "Projects",
    unitsLabel: "Projects",
    noun: "project",
    pluralNoun: "projects",
    partNoun: "deliverable",
    partPluralNoun: "deliverables",
    blurb: "Skill application: several assignments that add up to one piece of work.",
  },
  ASSESSMENT: {
    tabLabel: "Assessments",
    unitsLabel: "Assessments",
    noun: "assessment",
    pluralNoun: "assessments",
    partNoun: "part",
    partPluralNoun: "parts",
    blurb: "Skill evaluation: several assignments, each handed in separately.",
  },
} satisfies Record<CourseUnitCategory, CategoryMeta>;

export function categoryMeta(category: CourseUnitCategory): CategoryMeta {
  return CATEGORY_META[category];
}

/** "3 deliverables", or the singular when there is one. */
export function partCount(category: CourseUnitCategory, count: number): string {
  const meta = CATEGORY_META[category];
  return `${count} ${count === 1 ? meta.partNoun : meta.partPluralNoun}`;
}

/**
 * The parts of an assignment the ordering reads, structural so a test can build one in a line
 * and so both a tRPC payload and a Prisma row satisfy it.
 */
export type SortableWork = {
  title: string;
  dueAt: Date | string | null;
};

/**
 * Assignments inside a unit sort by due date, everywhere.
 *
 * **One comparator, used by every screen that lists them**, which is what makes the order a
 * student sees the order the instructor authored against.
 *
 * **An assignment with no due date sorts last**, not first. Null here means "no deadline set
 * yet", which is the state of work an instructor has started and not finished describing;
 * putting it at the top would push the dated work down the page every time somebody began
 * drafting the next one.
 *
 * Ties break on title, so the order is total. Two assignments due the same day is ordinary — an
 * ERD and the queries that go with it — and without the tie-break their order would come from
 * whatever the database happened to return, which can differ between two renders of the same
 * page.
 */
export function compareByDueDate(a: SortableWork, b: SortableWork): number {
  const left = a.dueAt == null ? null : new Date(a.dueAt).getTime();
  const right = b.dueAt == null ? null : new Date(b.dueAt).getTime();

  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  }

  return a.title.localeCompare(b.title);
}

/** The work in the order every screen shows it. Copies rather than sorting in place. */
export function sortByDueDate<T extends SortableWork>(work: readonly T[]): T[] {
  return [...work].sort(compareByDueDate);
}

/**
 * Units in the order an instructor put them, which is one sequence across all three categories.
 *
 * Name as the tie-break, so two units that somehow share a position still have a stable order
 * rather than one that changes between requests — the same rule the server's `orderBy` applies,
 * repeated here because a merged or filtered list has to be re-sorted in the browser.
 */
export function compareByPosition(
  a: { position: number; name: string },
  b: { position: number; name: string },
): number {
  return a.position - b.position || a.name.localeCompare(b.name);
}

/**
 * Which unit a new assignment starts in, given what the address asked for.
 *
 * **The `?unit=` in the address is the whole point of the "Add …" button being *inside* a unit on
 * the Curriculum screen.** Pressing it there has already answered "which unit does this go in", so
 * the form arrives with the answer chosen rather than asking again.
 *
 * Three rules, in this order:
 *
 * - **An assignment being edited keeps its own unit.** It already has one, the column is not
 *   nullable, and a `?unit=` on an edit address would be a way to move an assignment by typing —
 *   which is a different act from editing one and is not offered.
 * - **A requested unit is used only if it is one of this course's.** This is the case worth having
 *   a function for: an id that is not in the list reaches the select as a value it has no label
 *   for, and the trigger then renders a raw uuid where the unit's name should be. It happens
 *   whenever the link has gone stale — a unit removed in another tab, an address kept from last
 *   term — and it fails silently, looking like the pre-fill is broken rather than like the link is.
 * - **Otherwise the first unit**, which is the first module in course order. Not an empty
 *   selection: every assignment belongs to a unit, so the form should open on a real one and let
 *   somebody change it, rather than on a blank the save would refuse.
 *
 * Returns `""` for a course with no units at all, which the form draws as an explanation rather
 * than as an empty select — a course with nothing to put an assignment in cannot hold one, and the
 * foreign key says so.
 */
export function startingUnitId({
  existing,
  requested,
  units,
}: {
  /** The unit an assignment already belongs to, when one is being edited. */
  existing?: string | null;
  /** What the address asked for, which is not to be trusted. */
  requested?: string | null;
  /** This course's units, in the order they will be offered. */
  units: readonly { id: string }[];
}): string {
  if (existing) return existing;
  if (requested && units.some((unit) => unit.id === requested)) return requested;
  return units[0]?.id ?? "";
}
