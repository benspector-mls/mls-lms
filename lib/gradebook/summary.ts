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

import { handedIn } from "@/lib/status";
import { lateness } from "@/lib/submissions/hand-in";
import type { SubmissionStatus } from "@/lib/generated/prisma/enums";

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
 * The denominator is every assignment in the table, and the gradebook's table holds released work
 * only — see the `where` in the `gradebook` procedure. So a student is measured against what has
 * been handed out, and their figure moves when an instructor publishes something: the denominator
 * grows by one that day. That is deliberate, and the alternative is worse — counting unreleased
 * work would measure everybody against assignments nobody can see, and no reader of the screen
 * could check the figure against the cells beside it.
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

/** The parts of a cell the late count reads. Separate again, for the same reason as above. */
export type LateCell = {
  assignmentId: string;
  studentId: string;
  /** When it was handed in, or null where nothing was. */
  submittedAt: Date | string | null;
  /** A deadline renegotiated with this fellow, or null where none was. */
  extendedDueAt: Date | string | null;
};

/** The part of an assignment the late count reads: the deadline the class was given. */
export type LateAssignment = { id: string; dueAt: Date | string | null };

/**
 * Per student: how many of their submissions were handed in after the deadline.
 *
 * **A count rather than a fraction**, for the same reason the waiting column is one: the useful
 * figure is how many times this has happened, not how many of the course's assignments it happened
 * on. Unlike the waiting count, though, this one does not describe anything anybody can clear — it
 * is a record of what already happened, so it climbs and stays climbed.
 *
 * **Computed through `lateness`, which every other reader of timeliness also calls.** A second
 * comparison of a hand-in against a deadline written out here is how this figure would come to
 * disagree with the "Late" badge on the grading screen and with the student's own view of the same
 * submission.
 *
 * **It means the *first* hand-in was late, and a resubmission cannot make it so.** `submittedAt` is
 * recorded once and never moved, deliberately, so that revising work does not retroactively turn an
 * on-time submission into a late one. That is what makes this a count of missed deadlines rather
 * than a count of students who kept working.
 *
 * **Work handed in by a renegotiated deadline is not counted here**, which is `lateness` in
 * lib/submissions/hand-in.ts rather than `isLate` alone. The figure this column is for is whether a
 * fellow meets deadlines *or* renegotiates them and meets the new one; a fellow who came to their
 * instructor, agreed a date, and met it has done the thing the school asks for, and a count that
 * read them the same as somebody who said nothing would discourage the asking.
 *
 * **Settled deliberately, against the other reading.** Counting every missed original deadline,
 * extensions included, would make this a record of what happened rather than a measure of
 * accountability — defensible, and not what the school wants the column for. The figure instructors
 * act on is whether a fellow is managing their commitments, and a fellow who renegotiated and
 * delivered is managing theirs. Recorded here because the alternative reads as the obvious
 * behaviour to anybody meeting this function cold, and it is not an oversight.
 *
 * Nothing handed in is not the same as on time, and neither is counted here: `lateness` reads a
 * null `submittedAt` as `onTime`, and whether that fellow is *missing* the work is `isMissing`'s
 * question a few lines below.
 */
export function lateByStudent(
  cells: readonly LateCell[],
  work: readonly LateAssignment[],
): Map<string, number> {
  /*
    The assignments as a lookup, because lateness is computed rather than stored and every cell
    needs the deadline its own assignment set. Taken as a second list rather than expected on each
    cell — a deadline is not a column on a submission, and `missingByStudent` below is handed both
    lists for the same reason.
  */
  const dueByAssignment = new Map(work.map((item) => [item.id, item.dueAt]));

  const counts = new Map<string, number>();

  for (const cell of cells) {
    const dueAt = dueByAssignment.get(cell.assignmentId) ?? null;
    if (lateness({ ...cell, dueAt }) !== "late") continue;
    counts.set(cell.studentId, (counts.get(cell.studentId) ?? 0) + 1);
  }

  return counts;
}

/** The parts of an assignment the missing count reads. */
export type MissingAssignment = {
  id: string;
  dueAt: Date | string | null;
  /** Null means a draft. A student cannot miss what has not been handed out. */
  distributedAt: Date | string | null;
};

/** The parts of a cell the missing count reads. */
export type MissingCell = {
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  /** A deadline renegotiated with this fellow, which is the one they are judged against. */
  extendedDueAt: Date | string | null;
};

/** What `isMissing` reads from the student's own row. Null or undefined for a row that does not exist. */
export type MissingAgainst = Pick<MissingCell, "status" | "extendedDueAt"> | null | undefined;

/**
 * Whether this assignment is missing for a student: past their deadline with nothing handed in.
 *
 * **"Handed in" is `handedIn` from `lib/status.ts`, which is the rule behind the student's own
 * overdue list** — so the instructor's "missing" and the student's "overdue" name one fact, and a
 * second implementation cannot come to disagree with the screen the student is looking at. An
 * absent cell passes the same test as `NOT_STARTED`, because it is the same fact: the row exists
 * only once a student has taken the work up.
 *
 * **Their deadline, which an extension moves.** A fellow who agreed a new date is not missing the
 * work until that date passes — the whole point of agreeing one in advance is that the days in
 * between are not a period of being in trouble. This is the one reader of an extension that acts on
 * work which has *not* arrived, which is why it takes the cell rather than only its status.
 *
 * A draft is never missing, and neither is an assignment with no deadline. Strictly before `at`,
 * which is the comparison the student dashboard makes — due *at* this instant is not yet missed.
 *
 * **Judged against a clock, where `isLate` is read from a column.** Lateness records an event and
 * is written once, at hand-in; missing is the *absence* of an event, so there is nothing written
 * anywhere to read. `at` comes from the server render, so the markup React sent and the markup it
 * hydrates agree on which deadlines have passed.
 */
export function isMissing(
  assignment: { dueAt: Date | string | null; distributedAt: Date | string | null },
  against: MissingAgainst,
  at: Date,
): boolean {
  if (assignment.dueAt == null || assignment.distributedAt == null) return false;

  const due = against?.extendedDueAt ?? assignment.dueAt;
  return new Date(due).getTime() < at.getTime() && !handedIn(against?.status);
}

/**
 * Per student: how many past-due assignments they have not handed in.
 *
 * **The one counter here that cannot work from cells alone.** A student who never took the work up
 * has no cell at all, and that absent cell is the central missing case — so this takes the roster
 * and the columns, and counts every student-assignment pair the grid draws. `isMissing` above is
 * the same test the grid runs per cell, which is what makes the column equal the marks in its row.
 *
 * Unlike the late count, this figure is clearable: handing in, however late, removes it. It trades
 * one for the other — a missing assignment handed in becomes a late one.
 */
export function missingByStudent(
  studentIds: readonly string[],
  work: readonly MissingAssignment[],
  cells: readonly MissingCell[],
  at: Date,
): Map<string, number> {
  const cellByKey = new Map(cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

  const counts = new Map<string, number>();

  for (const assignment of work) {
    for (const studentId of studentIds) {
      const cell = cellByKey.get(`${assignment.id}:${studentId}`);
      if (!isMissing(assignment, cell, at)) continue;
      counts.set(studentId, (counts.get(studentId) ?? 0) + 1);
    }
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
