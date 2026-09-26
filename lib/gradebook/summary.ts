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

// ===========================================================================
// Drifting: the recent window, rather than the term
// ===========================================================================

/**
 * The rule the gradebook's "Needs a conversation" list applies, printed on the screen beside it.
 *
 * **Recent rather than cumulative, which is the whole point**, and the same point the attendance
 * drift rule in `lib/attendance/summary.ts` makes: a fellow who finished every module in September
 * and has handed nothing in for a fortnight is the one to talk to today, and a term-long missing
 * count hides them behind the good weeks. Two clauses because not handing work in and handing in
 * work that falls short are different problems with different conversations.
 *
 * **Ten deadlines, not five, because assignments go out in pairs.** Two are released on one day and
 * four in a week, so one bad day is two missed deadlines, and a window of five would put a fellow
 * on the list for one afternoon. Four of ten is two bad days.
 *
 * **Missed and late are one count.** Handing in a missing assignment turns it into a late one, so a
 * combined figure holds steady across that trade, where two separate thresholds would let a fellow
 * drop off the list by handing in a week late. That is unlike the attendance rule, where turning up
 * late is still turning up.
 *
 * **The second clause is over graded work, not due work.** The last ten assignments due are often
 * mostly ungraded, and ungraded work must count neither way, so it is measured over the fellow's
 * last five assignments that carry a verdict.
 *
 * No minimum before a fellow is judged, unlike the attendance rule. The thresholds are absolute,
 * so fewer than four deadlines cannot trip the first clause and fewer than two verdicts cannot trip
 * the second — and a fellow who joined late is missing the earlier work by policy, which the rule
 * inherits rather than excuses.
 *
 * Deliberately not configurable, for the reason the attendance thresholds are not: they are a first
 * guess to be argued with after a term of use, and a setting would freeze it as though reasoned.
 */
export const ASSIGNMENT_DRIFT_RULE = {
  dueOf: 10,
  slippedAtLeast: 4,
  gradedOf: 5,
  incompleteAtLeast: 2,
} as const;

/** The parts of an assignment the recent window reads. Released work only; see `recentWorkByStudent`. */
export type RecentAssignment = MissingAssignment;

/** The parts of a cell the recent window reads: everything the two counts above read, plus the verdict. */
export type RecentCell = MissingCell & LateCell & { isComplete: boolean | null };

/** One fellow's last few weeks in one course, as the two windows the rule reads. */
export type RecentWork = {
  studentId: string;
  /** Of the last `dueOf` assignments whose class deadline has passed: */
  missed: number;
  late: number;
  /** How many were in that window, which is fewer than `dueOf` early in a course. */
  due: number;
  /** Of the fellow's last `gradedOf` assignments with a verdict: */
  incomplete: number;
  /** How many were in that window, which is fewer than `gradedOf` until enough has been graded. */
  graded: number;
};

/** When an assignment happened, for ordering: its deadline, or its release where it has none. */
function whenOf(assignment: RecentAssignment): number {
  const at = assignment.dueAt ?? assignment.distributedAt;
  return at == null ? 0 : new Date(at).getTime();
}

/**
 * Per student: the two windows the drift rule reads, for everybody — drifting or not.
 *
 * **Every student gets an entry**, unlike the counters above, because the fellow's record prints
 * these figures whether or not they trip the rule: "1 of the last 10 due late" is a sentence worth
 * reading about somebody who is doing fine. The list of who is drifting is `assignmentDriftList`.
 *
 * **The deadline window is the cohort's, and the verdict window is the fellow's.** The last ten
 * assignments due are the same ten for everybody in the course, ordered by the class deadline, so
 * two fellows on the list are being measured against the same work. The last five graded are
 * whichever five of the fellow's own assignments most recently came due and have a verdict, because
 * grading happens in whatever order an instructor takes it and the question is about the fellow's
 * recent work rather than the instructor's recent afternoons.
 *
 * Missing is `isMissing` and late is `lateness`, the same two tests every other reader of those
 * words runs — a fellow with an unexpired extension is neither, and one who met a renegotiated
 * deadline is not late. Drafts and undated work cannot be missed, and are left out of the deadline
 * window for the same reason they are left out of the missing count.
 */
export function recentWorkByStudent(
  studentIds: readonly string[],
  work: readonly RecentAssignment[],
  cells: readonly RecentCell[],
  at: Date,
): Map<string, RecentWork> {
  const ordered = [...work].sort((a, b) => whenOf(a) - whenOf(b));

  const dueWindow = ordered
    .filter(
      (assignment) =>
        assignment.dueAt != null &&
        assignment.distributedAt != null &&
        new Date(assignment.dueAt).getTime() < at.getTime(),
    )
    .slice(-ASSIGNMENT_DRIFT_RULE.dueOf);

  const cellByKey = new Map(cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

  return new Map(
    studentIds.map((studentId) => {
      let missed = 0;
      let late = 0;
      for (const assignment of dueWindow) {
        const cell = cellByKey.get(`${assignment.id}:${studentId}`);
        if (isMissing(assignment, cell, at)) missed += 1;
        else if (cell && lateness({ ...cell, dueAt: assignment.dueAt }) === "late") late += 1;
      }

      const gradedWindow = ordered
        .filter((assignment) => {
          const cell = cellByKey.get(`${assignment.id}:${studentId}`);
          return cell !== undefined && cell.isComplete !== null;
        })
        .slice(-ASSIGNMENT_DRIFT_RULE.gradedOf);
      const incomplete = gradedWindow.filter(
        (assignment) => cellByKey.get(`${assignment.id}:${studentId}`)?.isComplete === false,
      ).length;

      return [
        studentId,
        {
          studentId,
          missed,
          late,
          due: dueWindow.length,
          incomplete,
          graded: gradedWindow.length,
        },
      ];
    }),
  );
}

export type DriftReason = "deadlines" | "falling-short";

/**
 * Which clauses of the rule this fellow trips, worse first, or none.
 *
 * Deadlines rank above falling short: work that was not handed in is a conversation about whether
 * the fellow is still in the course, where work that fell short is a conversation about the work.
 */
export function driftReasons(recent: RecentWork): DriftReason[] {
  const reasons: DriftReason[] = [];
  if (recent.missed + recent.late >= ASSIGNMENT_DRIFT_RULE.slippedAtLeast) {
    reasons.push("deadlines");
  }
  if (recent.incomplete >= ASSIGNMENT_DRIFT_RULE.incompleteAtLeast) reasons.push("falling-short");
  return reasons;
}

export type AssignmentDrift = { recent: RecentWork; reasons: DriftReason[] };

/**
 * Who is drifting, worst first, because the list is read from the top and acted on until somebody
 * runs out of afternoon. Missed deadlines sort ahead of work that fell short, and within each, more
 * ahead of fewer.
 */
export function assignmentDriftList(recents: Iterable<RecentWork>): AssignmentDrift[] {
  const drifting: AssignmentDrift[] = [];
  for (const recent of recents) {
    const reasons = driftReasons(recent);
    if (reasons.length > 0) drifting.push({ recent, reasons });
  }

  return drifting.sort(
    (a, b) =>
      b.recent.missed + b.recent.late - (a.recent.missed + a.recent.late) ||
      b.recent.incomplete - a.recent.incomplete,
  );
}

/**
 * The two windows in words: "2 missed, 1 late of the last 10 due · 1 of the last 5 graded fell
 * short". Composed here so the gradebook's list and the fellow's record cannot word it differently.
 *
 * The counts are printed even when they are zero, because "none of the last 10 due missed or late"
 * is the sentence a reader wants about somebody who is fine, and a blank would say only that
 * something failed to render. A window with nothing in it yet says so rather than printing "0 of 0".
 */
export function recentWorkSentence(recent: RecentWork): string {
  const { missed, late, due, incomplete, graded } = recent;

  const dueWindow =
    due === ASSIGNMENT_DRIFT_RULE.dueOf ? `the last ${due} due` : `the ${due} due so far`;
  const slipped = [missed > 0 && `${missed} missed`, late > 0 && `${late} late`]
    .filter(Boolean)
    .join(", ");
  const deadlines =
    due === 0
      ? "nothing has come due yet"
      : slipped === ""
        ? `none of ${dueWindow} missed or late`
        : `${slipped} of ${dueWindow}`;

  const gradedWindow =
    graded === ASSIGNMENT_DRIFT_RULE.gradedOf
      ? `the last ${graded} graded`
      : `the ${graded} graded so far`;
  const verdicts =
    graded === 0 ? "nothing graded yet" : `${incomplete} of ${gradedWindow} fell short`;

  return `${deadlines} · ${verdicts}`;
}

/** What each reason is called where it is shown as a label rather than a sentence. */
export const DRIFT_REASON_LABEL: Record<DriftReason, string> = {
  deadlines: "Missing deadlines",
  "falling-short": "Falling short",
};
