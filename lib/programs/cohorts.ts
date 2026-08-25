import { z } from "zod";

/**
 * Which of a program's fellows a screen is currently showing.
 *
 * A cohort is a named division of a program's roster and nothing else — it has no instructor,
 * grants no permission, and decides nothing about who may grade. Picking one narrows the four
 * screens that answer "what is left": grading triage, an assignment's queue, the gradebook, and
 * the curriculum list. Splitting a roster between co-teachers is what it is for, and that works
 * because the piles stop overlapping rather than because anything is refused.
 *
 * **A fellow is in at most one cohort**, so this is a partition rather than a set of memberships:
 * `Enrollment.cohortId` holds it, which is what gives "which cohort is this fellow in" one answer.
 *
 * **No `server-only` import, deliberately.** The picker is a client component and needs the three
 * values and the parser, and a procedure whose only job is to enumerate three constants is a
 * request paid on every screen for nothing. Same reasoning as `lib/sandbox/presets.ts`. Nothing
 * here touches the database; the `where` fragment that does lives in `lib/courses/membership.ts`.
 */

/** Every fellow on the roster. The default, and not a cohort — see below. */
export const ALL_STUDENTS = "all";

/** The active fellows who are in no cohort at all. */
export const UNASSIGNED = "unassigned";

/**
 * The picker's value, as it travels in a query string and over the wire.
 *
 * One string rather than a discriminated union on the input, because that is what a URL holds and
 * what a `<Select>` reads. It is widened into the union below the moment it reaches code that has
 * to branch on it.
 */
export const cohortSelectionInput = z
  .union([z.literal(ALL_STUDENTS), z.literal(UNASSIGNED), z.string().uuid()])
  .default(ALL_STUDENTS);

export type CohortSelection =
  /**
   * Unfiltered, and **not a row in `cohorts`**.
   *
   * An "All Fellows" cohort would have to be kept in step by every path that creates an enrollment,
   * and an instructor could rename it, delete it, or take somebody out of it — any of which puts a
   * fellow outside the default view, which is the invisibility a cohort exists to prevent. As the
   * absence of a filter, "every fellow is in the default view" is true by construction rather than
   * by maintenance.
   */
  | { kind: "all" }
  /**
   * The active fellows belonging to no cohort.
   *
   * How somebody who joined by the link mid-term is noticed in one click, rather than by
   * remembering to look for them. A check rather than a way of working, which is why `setCohort`
   * does not record it.
   */
  | { kind: "unassigned" }
  | { kind: "cohort"; cohortId: string };

/**
 * The picker's string as something to branch on.
 *
 * Anything unrecognized reads as `all`. That is the safe direction: an unfiltered screen shows more
 * work than it should rather than less, and a stale link to a deleted cohort should land on the
 * whole roster rather than on an empty page that looks like being caught up.
 */
export function parseCohortSelection(value: string | null | undefined): CohortSelection {
  if (!value || value === ALL_STUDENTS) return { kind: "all" };
  if (value === UNASSIGNED) return { kind: "unassigned" };
  return { kind: "cohort", cohortId: value };
}

/** The inverse, for putting a selection back into a query string or a select's value. */
export function cohortSelectionValue(selection: CohortSelection): string {
  if (selection.kind === "all") return ALL_STUDENTS;
  if (selection.kind === "unassigned") return UNASSIGNED;
  return selection.cohortId;
}

/**
 * What to call the selected set on a screen that has just counted it.
 *
 * Triage says it is caught up when its piles are empty, and filtered that is a claim about the
 * cohort rather than about the roster — so every screen that narrows has to name what it narrowed
 * to, or the claim is false. One function so the four of them cannot word it differently.
 */
export function cohortSelectionLabel(
  selection: CohortSelection,
  cohorts: { id: string; name: string }[],
): string {
  if (selection.kind === "all") return "All fellows";
  if (selection.kind === "unassigned") return "No cohort";
  return cohorts.find((cohort) => cohort.id === selection.cohortId)?.name ?? "Unknown cohort";
}

/**
 * What a screen carrying the cohort picker was built with.
 *
 * One type for the four screens, because the picker is one control and its options and its current
 * value travel together — a screen holding the list without the selection, or the selection without
 * the program to record it against, is a screen that cannot draw the control. `resolveCohort`
 * produces it on the server and it is passed straight through to `CohortPicker`.
 *
 * It lives here rather than beside `resolveCohort` so a client component can name it:
 * `lib/programs/resolve-cohort.ts` is `server-only` and reaches the database, and this is four
 * fields with no behaviour.
 */
export type CohortChoice = {
  /**
   * The program the cohorts divide.
   *
   * On the screen it is what a remembered choice is written against. It is here at all because
   * three of the four screens are addressed by course, so the identifier is not in their URL.
   */
  programId: string;
  /** The selection this screen was built for, as it travels in a query string. */
  cohort: string;
  cohorts: { id: string; name: string; memberCount: number }[];
  /** How many active fellows are in no cohort, for the picker's No cohort entry. */
  unassignedCount: number;
};
