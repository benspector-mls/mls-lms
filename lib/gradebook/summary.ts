/**
 * How much of the work is done, read down a column and across a row.
 *
 * **Browser-safe and pure**, like `lib/gradebook/csv.ts` beside it, and taking the same payload
 * the grid is already drawn from. That is what keeps a total from disagreeing with the cells above
 * it: a figure computed from a second read of the database can describe a different cohort than
 * the table it sits in, and a reader holding one screen has no way to notice.
 *
 * **Complete means `isComplete`, and never a comparison of a score against a threshold.** That
 * judgment is made once, in `approveDraft`, in the same transaction that writes the status — so
 * the column is the answer and arithmetic here would be a second implementation of it, free to
 * drift. The student's progress bar reads the same column for the same reason.
 *
 * `isComplete` is nullable, so the test is `=== true` rather than truthiness: null is "no verdict
 * yet", which is not the same as failing and must not be counted as either.
 */

/** The parts of a cell these read. Structural, so a test can build a cohort in a few lines. */
export type SummaryCell = {
  assignmentId: string;
  studentId: string;
  isComplete: boolean | null;
};

export interface Completion {
  /** How many met the threshold. */
  complete: number;
  /** How many could have — students in this table, or assignments in the course. */
  possible: number;
}

/**
 * Per assignment: how many of these students completed it.
 *
 * The denominator is every student in the table rather than every student who handed something
 * in, because the question the column answers is "how is the cohort doing on this", and a student
 * who never started is part of that answer. Counting only submissions would make an assignment
 * nobody has attempted read as 0 of 0, which looks like nothing is outstanding.
 *
 * Keyed lookup rather than a scan per assignment: a cohort of twenty against fifty assignments is
 * a thousand cells, and filtering the whole list once per column is fifty thousand comparisons.
 */
export function completionByAssignment(
  cells: readonly SummaryCell[],
  studentCount: number,
): Map<string, Completion> {
  const counts = new Map<string, number>();

  for (const cell of cells) {
    if (cell.isComplete !== true) continue;
    counts.set(cell.assignmentId, (counts.get(cell.assignmentId) ?? 0) + 1);
  }

  return new Map(
    [...counts].map(([assignmentId, complete]) => [
      assignmentId,
      { complete, possible: studentCount },
    ]),
  );
}

/**
 * Per student: how many assignments they have completed.
 *
 * The denominator is every assignment in the table, which is every assignment in the course —
 * including ones not yet handed out. A student is measured against the course rather than against
 * what has been released so far, so the figure does not move when an instructor publishes
 * something nobody has seen.
 */
export function completionByStudent(
  cells: readonly SummaryCell[],
  assignmentCount: number,
): Map<string, Completion> {
  const counts = new Map<string, number>();

  for (const cell of cells) {
    if (cell.isComplete !== true) continue;
    counts.set(cell.studentId, (counts.get(cell.studentId) ?? 0) + 1);
  }

  return new Map(
    [...counts].map(([studentId, complete]) => [
      studentId,
      { complete, possible: assignmentCount },
    ]),
  );
}

/** The parts of a cell the waiting count reads. Separate, because it needs none of the above. */
export type AwaitingCell = {
  studentId: string;
  /** The triage bucket, or null when the submission needs nobody. */
  bucket: string | null;
};

/**
 * Per student: how many of their submissions are waiting on an instructor.
 *
 * **A count and not a fraction**, unlike the two above. "3 of 10" would invite reading the ten as
 * something to work through, where the useful figure is how many are outstanding right now — a
 * number that should reach zero and stay there rather than climb towards a total.
 *
 * `bucket != null` is exactly what draws the amber dot in the grid, deliberately, so this column
 * counts the dots in its own row. That includes `generating`, which is a run in flight rather than
 * something an instructor can act on this second — but it is still an assignment with no grade on
 * it, and a column that disagreed with the cells beside it would be worse than one that is a
 * moment ahead of itself.
 */
export function awaitingByStudent(cells: readonly AwaitingCell[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const cell of cells) {
    if (cell.bucket == null) continue;
    counts.set(cell.studentId, (counts.get(cell.studentId) ?? 0) + 1);
  }

  return counts;
}

/**
 * What a summary cell reads: "2/5", or an em dash where there is nothing to be a fraction of.
 *
 * Zero out of something is a real and useful figure — nobody has finished this yet — so it is
 * printed. Zero out of *nothing* is not: an empty cohort or a course with no assignments would
 * otherwise read "0/0", which looks like a measurement rather than the absence of one.
 */
export function completionLabel(completion: Completion | undefined, possible: number): string {
  if (possible === 0) return "—";
  return `${completion?.complete ?? 0}/${possible}`;
}
