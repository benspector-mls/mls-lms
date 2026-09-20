/**
 * Putting a roster in order.
 *
 * **Its own comparison rather than the gradebook's**, which is worth saying because the two
 * screens look alike. `sortStudents` in `lib/gradebook/filters.ts` ranks a student by a number per
 * column — completed, late, missing, a score — and puts a student it has no number for last. Every
 * column here is text, so reusing it would mean turning names and cohorts into numbers to be
 * ranked and widening the gradebook's `RowSort` with columns no gradebook has. The comparison
 * below is shorter than that adapter would be.
 *
 * What it keeps from the gradebook is the two rules that make a sorted table readable: a row the
 * column says nothing about goes **last whichever way the arrow points**, because a fellow with no
 * GitHub account is not alphabetically first; and ties break on the name, so the order is total
 * and two renders put the rows in the same places.
 */

/** The columns that vary within one table. `Enrollment` is not among them — see `ProgramRoster`. */
export type RosterSortColumn = "name" | "github" | "cohort";

export type RosterSort = {
  by: RosterSortColumn;
  direction: "asc" | "desc";
};

export const DEFAULT_ROSTER_SORT: RosterSort = { by: "name", direction: "asc" };

/**
 * Clicking a header: the same column reverses, a different column opens ascending.
 *
 * Ascending for every column, unlike the gradebook's numbers, which open descending because the
 * question behind them is who has the most. A-to-Z is what a list of people means by sorted.
 */
export function toggleRosterSort(current: RosterSort, by: RosterSortColumn): RosterSort {
  if (current.by === by) {
    return { by, direction: current.direction === "asc" ? "desc" : "asc" };
  }

  return { by, direction: "asc" };
}

/**
 * The rows in the order the chosen sort puts them.
 *
 * `text` answers what one row reads as in one column, and returns null where the row has nothing
 * there — an unlinked GitHub account, a fellow nobody has placed in a cohort.
 */
export function sortRoster<T>(
  rows: readonly T[],
  sort: RosterSort,
  text: (row: T, by: RosterSortColumn) => string | null,
): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  const compare = (left: T, right: T, by: RosterSortColumn, signed: number): number => {
    const a = text(left, by);
    const b = text(right, by);

    // Last either way, so that reversing a column does not haul the blanks to the top.
    if (a === null || a === "") return b === null || b === "" ? 0 : 1;
    if (b === null || b === "") return -1;

    return signed * a.localeCompare(b, undefined, { sensitivity: "base" });
  };

  return [...rows].sort(
    (left, right) => compare(left, right, sort.by, sign) || compare(left, right, "name", 1) || 0,
  );
}
