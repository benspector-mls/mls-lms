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
  /**
   * Nothing about this session is settled yet.
   *
   * True while check-in is open, while a code is prepared and not yet opened, and for every day
   * the schedule has made that has not come. An unsettled session counts for a fellow who already
   * has a record in it and for nobody else — see `summarize`.
   *
   * **The name is the guard.** It was `open` while a session existed only because somebody pressed
   * a button, and the two meant the same thing. A program that declares nine months of meeting
   * days has a row for every one of them from the day its schedule is saved, and a flag that asked
   * "is check-in live" would have reported the whole roster absent until June.
   */
  unsettled: boolean;
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
  /**
   * Sessions counted against this fellow: on or after they enrolled, and either closed or already
   * recorded.
   */
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
 * every other screen does. Everything that reports a number — `driftList`, `programRate`, the CSV —
 * filters on `testStudentNumber` itself. Removing them here instead would make the grid disagree
 * with the roster about who is on it.
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

      // The grid shows every session; the arithmetic below skips the ones nothing is settled in.
      summary.cells.push(enrolled ? (record?.status ?? null) : null);

      if (!enrolled) continue;

      /*
        **An unsettled session counts once there is a record, and not before.** A fellow who
        checked in this morning should watch the figure move rather than wait until the evening for
        a day they have already finished with — that is the whole reason this is not simply
        `session.unsettled`. A fellow who has not checked in is skipped, because the day is still
        running, or has not begun, and counting them would be reporting an absence that has not
        happened yet.

        The cost is that on a day still in progress two fellows are measured against different
        denominators, and it is the right cost to pay: what separates them is a record, which only
        exists because the fellow checked in or an instructor decided something about them. A
        decision to mark somebody absent at eleven counts against them from eleven, which is what
        the instructor meant by making it. The difference disappears the moment the day closes and
        everybody is counted.
      */
      if (session.unsettled && !record) continue;

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

/** How many of the last `window` settled sessions this fellow missed. */
function recentMisses(summary: FellowSummary, sessions: SummarySession[], window: number): number {
  const settledIndexes = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => !session.unsettled)
    .slice(-window);

  let missed = 0;
  for (const { session, index } of settledIndexes) {
    if (session.day < summary.fellow.enrolledFrom) continue;
    const status = summary.cells[index];
    if (status === null || !countsAsAttended(status)) missed += 1;
  }

  return missed;
}

/** How many of the last `window` settled sessions this fellow arrived late to. */
function recentLates(summary: FellowSummary, sessions: SummarySession[], window: number): number {
  const settledIndexes = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => !session.unsettled)
    .slice(-window);

  return settledIndexes.filter(({ index }) => summary.cells[index] === "LATE").length;
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
  /** Below this many settled sessions, a fellow is too new to be judged by either clause. */
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

/**
 * How much of the roster turned up, one figure per day, in the order the sessions came.
 *
 * **The heading of each column of the term grid.** A grid of letters answers "who", and reading a
 * column of twenty-five letters to work out "how many" is the arithmetic a reader should not be
 * doing — one bad morning in a term is exactly the thing that ought to be visible without counting.
 *
 * **Computed from the summaries the grid already holds, rather than from the records.** It is the
 * same `cells` array each row draws its letters from, so the figure above a column and the letters
 * beneath it cannot disagree. A second pass over the records would be a second definition of what
 * a missing row means, and that is the one thing the two would come to differ about.
 *
 * The three rules `summarize` applies apply here unchanged: late counts as attendance and excused
 * does not, a fellow counts only from the day they enrolled, and test students are in no figure.
 * A day with nothing settled has no rate, and neither does a day nobody was enrolled for.
 */
export function dailyRates(
  sessions: SummarySession[],
  summaries: FellowSummary[],
): (number | null)[] {
  const counted = summaries.filter((summary) => summary.fellow.testStudentNumber === null);

  return sessions.map((session, index) => {
    // Nothing is settled on a morning still running or still to come. `summarize` skips exactly
    // these for a fellow with no record, so a figure here would be dividing by a moving number.
    if (session.unsettled) return null;

    let enrolled = 0;
    let attended = 0;

    for (const summary of counted) {
      if (session.day < summary.fellow.enrolledFrom) continue;
      enrolled += 1;

      // A null cell on a settled day is a fellow nobody recorded, which is a fellow who missed it
      // — the same reading `summarize` gives it through `unrecorded`.
      const status = summary.cells[index];
      if (status !== null && countsAsAttended(status)) attended += 1;
    }

    return enrolled === 0 ? null : attended / enrolled;
  });
}

/** The whole roster's figure, over the fellows who count. */
export function programRate(summaries: FellowSummary[]): number | null {
  const counted = summaries.filter((summary) => summary.fellow.testStudentNumber === null);
  const eligible = counted.reduce((total, summary) => total + summary.eligible, 0);
  if (eligible === 0) return null;

  const attended = counted.reduce((total, summary) => total + summary.present + summary.late, 0);
  return attended / eligible;
}
