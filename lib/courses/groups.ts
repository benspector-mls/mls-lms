import { z } from "zod";

/**
 * Which of a course's students a screen is currently showing.
 *
 * A group is a named set of students and nothing else — it has no instructor, grants no
 * permission, and decides nothing about who may grade. Picking one narrows the four screens
 * that answer "what is left": grading triage, an assignment's queue, the gradebook, and the
 * assignments list. Splitting a cohort between co-teachers is what it is for, and that works
 * because the piles stop overlapping rather than because anything is refused.
 *
 * **No `server-only` import, deliberately.** The picker is a client component and needs the
 * three values and the parser, and a procedure whose only job is to enumerate three constants
 * is a request paid on every screen for nothing. Same reasoning as `lib/sandbox/presets.ts`.
 * Nothing here touches the database; the `where` fragment that does lives in `membership.ts`.
 */

/** Every student in the cohort. The default, and not a group — see below. */
export const ALL_STUDENTS = "all";

/** The active students who are in no group at all. */
export const UNGROUPED = "ungrouped";

/**
 * The picker's value, as it travels in a query string and over the wire.
 *
 * One string rather than a discriminated union on the input, because that is what a URL holds
 * and what a `<Select>` reads. It is widened into the union below the moment it reaches code
 * that has to branch on it.
 */
export const groupSelectionInput = z
  .union([z.literal(ALL_STUDENTS), z.literal(UNGROUPED), z.string().uuid()])
  .default(ALL_STUDENTS);

export type GroupSelection =
  /**
   * Unfiltered, and **not a row in `course_groups`**.
   *
   * An "All Students" group would have to be kept in step by every path that creates an
   * enrollment, and an instructor could rename it, delete it, or take somebody out of it — any
   * of which puts a student outside the default view, which is the invisibility a group exists
   * to prevent. As the absence of a filter, "every student is in the default view" is true by
   * construction rather than by maintenance.
   */
  | { kind: "all" }
  /**
   * The active students belonging to no group.
   *
   * How somebody who joined by the link mid-term is noticed in one click, rather than by
   * remembering to look for them. A check rather than a way of working, which is why
   * `setGradingGroup` does not record it.
   */
  | { kind: "ungrouped" }
  | { kind: "group"; groupId: string };

/**
 * The picker's string as something to branch on.
 *
 * Anything unrecognized reads as `all`. That is the safe direction: an unfiltered screen shows
 * more work than it should rather than less, and a stale link to a deleted group should land on
 * the whole cohort rather than on an empty page that looks like being caught up.
 */
export function parseGroupSelection(value: string | null | undefined): GroupSelection {
  if (!value || value === ALL_STUDENTS) return { kind: "all" };
  if (value === UNGROUPED) return { kind: "ungrouped" };
  return { kind: "group", groupId: value };
}

/** The inverse, for putting a selection back into a query string or a select's value. */
export function groupSelectionValue(selection: GroupSelection): string {
  if (selection.kind === "all") return ALL_STUDENTS;
  if (selection.kind === "ungrouped") return UNGROUPED;
  return selection.groupId;
}

/**
 * What to call the selected set on a screen that has just counted it.
 *
 * Triage says it is caught up when its piles are empty, and filtered that is a claim about the
 * group rather than about the cohort — so every screen that narrows has to name what it
 * narrowed to, or the claim is false. One function so the four of them cannot word it
 * differently.
 */
export function groupSelectionLabel(
  selection: GroupSelection,
  groups: { id: string; name: string }[],
): string {
  if (selection.kind === "all") return "All students";
  if (selection.kind === "ungrouped") return "Ungrouped";
  return groups.find((group) => group.id === selection.groupId)?.name ?? "Unknown group";
}
