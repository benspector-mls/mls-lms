import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import type { SchoolDay } from "@/lib/school-time";

/**
 * A term of attendance, reduced to the two questions anybody asks of it.
 *
 * **"How much of this has a fellow been to", for compliance**, and **"who is quietly slipping",
 * for the instructor who could still do something about it. The second is the one that needs a
 * function rather than a table: a cohort of twenty-five against sixty sessions is fifteen hundred
 * letters, and nobody reads fifteen hundred letters looking for three people.
 *
 * Three rules are built in here rather than left to each caller, because each of them is a way to
 * report a wrong number:
 *
 * - **Excused counts as missed.** The note explains the absence; it does not undo it. One
 *   denominator, one rate, and nothing for a reader to interpret before quoting it.
 * - **A fellow is only measured against sessions they were enrolled for.** Somebody who joined in
 *   March cannot have missed February, and counting it would put a real number in a real report
 *   that is wrong in the fellow's disfavour.
 * - **Test students are excluded from every figure.** They are listed on screen and badged, as
 *   they are everywhere else, and they are in no count.
 */

/** A session, as the term view holds it. */
export type SummarySession = {
  id: string;
  day: SchoolDay;
  /** Sessions still open are reported apart rather than folded into anybody's rate. */
  open: boolean;
};

export type SummaryFellow = {
  enrollmentId: string;
  studentId: string;
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
  testStudentNumber: number | null;
  /** The first school day this fellow could have attended. */
  enrolledFrom: SchoolDay;
};

export type SummaryRecord = {
  enrollmentId: string;
  sessionId: string;
  status: AttendanceStatus;
};

export type FellowSummary = {
  fellow: SummaryFellow;
  /** Sessions counted against this fellow: closed, and on or after they enrolled. */
  eligible: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** Eligible sessions with no record. Counted as missed; they are what ending a session writes. */
  unrecorded: number;
  /** `(present + late) / eligible`, or null when there is nothing yet to divide by. */
  rate: number | null;
  /** In session order, for the wide grid. Null where the fellow was not yet enrolled. */
  cells: (AttendanceStatus | null)[];
};

/** Whether a status counts as having turned up. Late is here; excused deliberately is not. */
export function countsAsAttended(status: AttendanceStatus): boolean {
  return status === "PRESENT" || status === "LATE";
}

/**
 * One row per fellow, whether or not they count.
 *
 * **Test students are summarized rather than dropped**, because the grid draws them badged the way
 * every other screen does. Everything that reports a number — `driftList`, `cohortRate`, the CSV —
 * filters on `testStudentNumber` itself. Removing them here instead would make the grid disagree
 * with the roster about who is in the cohort.
 */
export function summarize(
  sessions: SummarySession[],
  fellows: SummaryFellow[],
  records: SummaryRecord[],
): FellowSummary[] {
  const byPair = new Map(
    records.map((record) => [`${record.enrollmentId}:${record.sessionId}`, record]),
  );

  return fellows.map((fellow) => {
    const summary: FellowSummary = {
      fellow,
      eligible: 0,
      present: 0,
      late: 0,
      excused: 0,
      absent: 0,
      unrecorded: 0,
      rate: null,
      cells: [],
    };

    for (const session of sessions) {
      const enrolled = session.day >= fellow.enrolledFrom;
      const record = byPair.get(`${fellow.enrollmentId}:${session.id}`) ?? null;

      // The grid shows every session; the arithmetic below only ever touches the closed ones.
      summary.cells.push(enrolled ? (record?.status ?? null) : null);

      if (!enrolled || session.open) continue;

      summary.eligible += 1;
      if (!record) summary.unrecorded += 1;
      else if (record.status === "PRESENT") summary.present += 1;
      else if (record.status === "LATE") summary.late += 1;
      else if (record.status === "EXCUSED") summary.excused += 1;
      else summary.absent += 1;
    }

    if (summary.eligible > 0) {
      summary.rate = (summary.present + summary.late) / summary.eligible;
    }

    return summary;
  });
}

/** How many of the last `window` closed sessions this fellow missed. */
function recentMisses(summary: FellowSummary, sessions: SummarySession[], window: number): number {
  const closedIndexes = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => !session.open)
    .slice(-window);

  let missed = 0;
  for (const { session, index } of closedIndexes) {
    if (session.day < summary.fellow.enrolledFrom) continue;
    const status = summary.cells[index];
    if (status === null || !countsAsAttended(status)) missed += 1;
  }

  return missed;
}

/** How many of the last `window` closed sessions this fellow arrived late to. */
function recentLates(summary: FellowSummary, sessions: SummarySession[], window: number): number {
  const closedIndexes = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => !session.open)
    .slice(-window);

  return closedIndexes.filter(({ index }) => summary.cells[index] === "LATE").length;
}

/**
 * The rule the drift list applies, printed on the screen beside it.
 *
 * **Recent rather than cumulative**, which is the whole point. A fellow at 88 percent over a term
 * who has missed the last four mornings is the one to call today, and a cumulative rate hides them
 * behind twelve good weeks. Two clauses because absence and lateness are different problems with
 * different conversations.
 *
 * The thresholds are deliberately not configurable. They are a starting point to be argued with
 * after a term of use, and a setting would freeze the first guess as though it had been reasoned.
 */
export const DRIFT_RULE = {
  missedOf: 5,
  missedAtLeast: 2,
  lateOf: 10,
  lateAtLeast: 3,
  /** Below this many closed sessions, a fellow is too new to be judged by either clause. */
  needsAtLeast: 5,
} as const;

export type Drift = {
  summary: FellowSummary;
  missedRecently: number;
  lateRecently: number;
  reason: "missing" | "late";
};

export function driftList(summaries: FellowSummary[], sessions: SummarySession[]): Drift[] {
  const drifting: Drift[] = [];

  for (const summary of summaries) {
    if (summary.fellow.testStudentNumber !== null) continue;
    if (summary.eligible < DRIFT_RULE.needsAtLeast) continue;

    const missedRecently = recentMisses(summary, sessions, DRIFT_RULE.missedOf);
    const lateRecently = recentLates(summary, sessions, DRIFT_RULE.lateOf);

    if (missedRecently >= DRIFT_RULE.missedAtLeast) {
      drifting.push({ summary, missedRecently, lateRecently, reason: "missing" });
    } else if (lateRecently >= DRIFT_RULE.lateAtLeast) {
      drifting.push({ summary, missedRecently, lateRecently, reason: "late" });
    }
  }

  // Worst first, because the list is read from the top and acted on until somebody runs out of
  // morning.
  return drifting.sort(
    (a, b) => b.missedRecently - a.missedRecently || b.lateRecently - a.lateRecently,
  );
}

/** The cohort's own figure, over the fellows who count. */
export function cohortRate(summaries: FellowSummary[]): number | null {
  const counted = summaries.filter((summary) => summary.fellow.testStudentNumber === null);
  const eligible = counted.reduce((total, summary) => total + summary.eligible, 0);
  if (eligible === 0) return null;

  const attended = counted.reduce((total, summary) => total + summary.present + summary.late, 0);
  return attended / eligible;
}
