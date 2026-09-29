import type { CheckLevel } from "@/lib/generated/prisma/enums";

import { latestAttempt } from "./attempts";
import { CHECK_LEVELS, type CheckCategory, effectiveLevel, levelCategory } from "./levels";

/**
 * The arithmetic behind a check's attempts page: where the room stood on its first attempts and
 * where it stands now, and the order the table's columns sort in.
 *
 * Browser-safe and free of the database. The page sorts and counts rows it already holds, and a
 * rule written here can be tested without drawing anything.
 */

type Attempt = {
  attempt: number;
  submittedAt: Date;
  wantsHelp: boolean;
  level: CheckLevel | null;
  instructorLevel: CheckLevel | null;
};

type Row = { attempts: readonly Attempt[] };

/** The attempt with the lowest number, or null when there are none. */
export function firstAttempt<T extends { attempt: number }>(attempts: readonly T[]): T | null {
  let first: T | null = null;
  for (const attempt of attempts) {
    if (!first || attempt.attempt < first.attempt) first = attempt;
  }
  return first;
}

export type UnderstandingTally = {
  /** How many fellows' first attempts, or latest attempts, fall in each category. */
  first: Record<CheckCategory, number>;
  current: Record<CheckCategory, number>;
  /** Fellows who asked to go over it with an instructor, on any attempt. */
  askedForHelp: number;
  notYetAnswered: number;
};

/**
 * Where the room stood on its first attempts, and where it stands on its latest.
 *
 * **Both, because the difference is the point.** The first attempt reads how the lesson landed;
 * the latest reads what going back to the material did. An attempt the review could not
 * level, and no instructor has, is counted in neither.
 */
export function understandingTally(rows: readonly Row[]): UnderstandingTally {
  const tally: UnderstandingTally = {
    first: { 1: 0, 2: 0, 3: 0 },
    current: { 1: 0, 2: 0, 3: 0 },
    askedForHelp: 0,
    notYetAnswered: 0,
  };

  for (const row of rows) {
    const first = firstAttempt(row.attempts);
    const latest = latestAttempt(row.attempts);
    if (!first || !latest) {
      tally.notYetAnswered += 1;
      continue;
    }

    const firstLevel = effectiveLevel(first);
    const latestLevel = effectiveLevel(latest);
    if (firstLevel) tally.first[levelCategory(firstLevel)] += 1;
    if (latestLevel) tally.current[levelCategory(latestLevel)] += 1;
    if (row.attempts.some((attempt) => attempt.wantsHelp)) tally.askedForHelp += 1;
  }

  return tally;
}

export type AttemptsSortColumn = "name" | "first" | "current" | "attempts" | "submitted";

export type AttemptsSort = { by: AttemptsSortColumn; direction: "asc" | "desc" };

export const DEFAULT_ATTEMPTS_SORT: AttemptsSort = { by: "name", direction: "asc" };

/**
 * Which way a column opens when it is first clicked.
 *
 * Levels open lowest first, because the fellows to talk to are the Blocked ones. Attempts and the
 * time submitted open highest and newest first, because those are the questions — who has tried
 * most, who answered last. Names open A to Z, as every list of people does.
 */
const OPENS: Record<AttemptsSortColumn, "asc" | "desc"> = {
  name: "asc",
  first: "asc",
  current: "asc",
  attempts: "desc",
  submitted: "desc",
};

/** Clicking a header: the same column reverses, a different column opens its own way. */
export function toggleAttemptsSort(current: AttemptsSort, by: AttemptsSortColumn): AttemptsSort {
  if (current.by === by) return { by, direction: current.direction === "asc" ? "desc" : "asc" };
  return { by, direction: OPENS[by] };
}

/**
 * The rows in the order a sort puts them.
 *
 * **A fellow with nothing in the column sorts last in either direction**: somebody who has not
 * answered is not the lowest level or the oldest submission, and reversing the sort should not
 * float them to the top. Ties, and the rows with nothing, fall back to name order.
 */
export function sortAttemptRows<T extends Row>(
  rows: readonly T[],
  sort: AttemptsSort,
  nameOf: (row: T) => string,
): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  const valueOf = (row: T): number | string | null => {
    switch (sort.by) {
      case "name":
        return nameOf(row).toLocaleLowerCase();
      case "first": {
        const first = firstAttempt(row.attempts);
        const level = first ? effectiveLevel(first) : null;
        return level ? CHECK_LEVELS.indexOf(level) : null;
      }
      case "current": {
        const latest = latestAttempt(row.attempts);
        const level = latest ? effectiveLevel(latest) : null;
        return level ? CHECK_LEVELS.indexOf(level) : null;
      }
      case "attempts":
        return row.attempts.length === 0 ? null : row.attempts.length;
      case "submitted": {
        const latest = latestAttempt(row.attempts);
        return latest ? latest.submittedAt.getTime() : null;
      }
    }
  };

  const byName = (a: T, b: T) => nameOf(a).localeCompare(nameOf(b));

  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    const compared =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : (left as number) - (right as number);
    return compared === 0 ? byName(a, b) : compared * sign;
  });
}
