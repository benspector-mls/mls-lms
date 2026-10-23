import type { AttendanceStatus } from "@/lib/generated/prisma/enums";
import { inRecentWindow, type RecentWindow } from "@/lib/recent-window";
import { addSchoolDays, type SchoolDay } from "@/lib/school-time";

import { weekRange } from "./calendar";

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
 * every other screen does. Everything that reports a number — the Performance tab, the CSV —
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

/**
 * The settled sessions inside the window that this fellow was enrolled for, as positions into
 * `cells`.
 *
 * The window is the cohort's and then narrowed to the fellow: two fellows flagged by the drift rule
 * are being judged against the same days, and one who joined last week is judged against the days
 * since, which are fewer.
 */
function recentSettled(
  summary: FellowSummary,
  sessions: SummarySession[],
  window: RecentWindow,
): number[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => !session.unsettled && inRecentWindow(session.day, window))
    .filter(({ session }) => session.day >= summary.fellow.enrolledFrom)
    .map(({ index }) => index);
}

/**
 * One fellow's recent mornings, as the drift rule reads them.
 *
 * `missedOf` and `lateOf` are the same number: the settled sessions in the window the fellow was
 * enrolled for. Both are kept so each count is printed beside its own denominator.
 */
export type RecentAttendance = {
  /** Of the settled sessions in the window they were enrolled for: */
  missed: number;
  missedOf: number;
  late: number;
  lateOf: number;
  /**
   * How many of `missed` were excused. An excused morning is still a missed one, which is the
   * rule `summarize` states; this count is printed beside the figure so a reader can see how much
   * of a fellow's absence had a reason given for it.
   */
  excused: number;
};

/**
 * The window the drift rule reads, for one fellow — drifting or not.
 *
 * Exported on its own because the fellow's record prints these whether or not the rule trips:
 * "attended 9 of the 10 sessions" is worth reading about somebody who is fine. Which clause a fellow
 * trips is `attendanceDriftReason`.
 */
export function recentAttendance(
  summary: FellowSummary,
  sessions: SummarySession[],
  window: RecentWindow,
): RecentAttendance {
  const inWindow = recentSettled(summary, sessions, window);

  return {
    missed: inWindow.filter((index) => {
      const status = summary.cells[index];
      return status === null || !countsAsAttended(status);
    }).length,
    missedOf: inWindow.length,
    late: inWindow.filter((index) => summary.cells[index] === "LATE").length,
    lateOf: inWindow.length,
    excused: inWindow.filter((index) => summary.cells[index] === "EXCUSED").length,
  };
}

/** Of the window's mornings, the share attended. Null when the window holds none. */
export function recentAttendedShare(recent: RecentAttendance): number | null {
  return recent.missedOf === 0 ? null : (recent.missedOf - recent.missed) / recent.missedOf;
}

/** Of the window's mornings, the share not arrived at late. Null when the window holds none. */
export function recentOnTimeArrivalShare(recent: RecentAttendance): number | null {
  return recent.lateOf === 0 ? null : (recent.lateOf - recent.late) / recent.lateOf;
}

/**
 * Which clause of the rule this fellow trips, or null. Missing outranks late, because absence and
 * lateness are different conversations and the first is the more urgent one.
 */
export function attendanceDriftReason(recent: RecentAttendance): AttendanceDriftReason | null {
  const attended = recentAttendedShare(recent);
  const onTime = recentOnTimeArrivalShare(recent);
  if (attended !== null && attended < DRIFT_RULE.attendedAtLeast) return "missing";
  if (onTime !== null && onTime < DRIFT_RULE.onTimeAtLeast) return "late";
  return null;
}

/**
 * The rule behind an attendance flag on the Performance tab and the fellow's Last few weeks card.
 *
 * **Recent rather than cumulative**, which is the whole point. A fellow at 88 percent over a term
 * who has missed the last four mornings is the one to call today, and a cumulative rate hides them
 * behind twelve good weeks. Two clauses because absence and lateness are different problems with
 * different conversations.
 *
 * **Both clauses read the same window of mornings** — `RecentWindow`, two weeks unless an
 * instructor chose otherwise — so a fellow's recent absences and recent lateness are two counts over
 * one stretch of days and can be read side by side. **Shares rather than counts**, because the
 * window holds however many mornings fell in it, and "three absences" means something different
 * over a holiday week than over a full one. The bar is the one every percentage on the Performance
 * tab is read against, so a reader learns one rule.
 *
 * The thresholds are deliberately not configurable. They are a starting point to be argued with
 * after a term of use, and a setting would freeze the first guess as though it had been reasoned.
 */
export const DRIFT_RULE = {
  /** Flagged as missing below this share of the window's mornings attended. */
  attendedAtLeast: 0.75,
  /** Flagged as late below this share of the window's mornings not arrived at late. */
  onTimeAtLeast: 0.75,
  /** Below this many settled sessions in the term, a fellow is too new to be judged by either clause. */
  needsAtLeast: 5,
} as const;

/** Which clause of the attendance drift rule a fellow trips. */
export type AttendanceDriftReason = "missing" | "late";

/** What each reason is called where it is shown as a label rather than a sentence. */
export const ATTENDANCE_DRIFT_REASON_LABEL: Record<AttendanceDriftReason, string> = {
  missing: "Often absent",
  late: "Arriving late",
};

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

/**
 * Where the last two weeks of a term begin: the index of the first session the grid draws before
 * anybody asks for more.
 *
 * **Two school weeks, counted from the latest session rather than from today.** The grid is read
 * to see how the recent mornings went, and a term of sixty columns puts the recent ones off the
 * right edge of the screen behind fifty-eight that are not. The week the latest session falls in
 * and the whole week before it is enough to see a pattern forming and little enough to fit; the
 * rest is one press away. Counting from the latest session rather than from today means a cohort
 * on a break still opens on its last fortnight of mornings rather than on nothing.
 *
 * `sessions` are in date order, as `history` returns them. Zero when every session is recent, which
 * is what tells the grid there is nothing earlier to offer.
 */
export function recentSessionsFrom(sessions: SummarySession[]): number {
  const latest = sessions[sessions.length - 1];
  if (!latest) return 0;
  // Monday of the week before the latest session's week; `weekRange` runs Monday to Sunday.
  const from = addSchoolDays(weekRange(latest.day).from, -7);
  const index = sessions.findIndex((session) => session.day >= from);
  return index === -1 ? 0 : index;
}

/** How much of the whole roster turned up over the whole term. See `termRate`. */
export type TermRate = {
  /** Sessions counted against anybody, summed over the roster. */
  eligible: number;
  /** Of those, the ones somebody was present or late for. */
  attended: number;
  /** `attended / eligible`, or null when there is nothing yet to divide by. */
  rate: number | null;
};

/**
 * One figure for the roster: how much of the term, across everybody, was attended.
 *
 * **The figure at the head of the Rate column of the term grid**, in the row that already heads
 * each date with that morning's rate. A reader comparing one fellow's 72 percent against the
 * column has twenty-five other percentages to compare it with and no single one to compare it
 * against; this is that one.
 *
 * **Attended over eligible, summed over the roster, rather than a mean of the fellows' rates.** A
 * mean of rates would weigh a fellow who joined last week, with four eligible mornings, the same as
 * one with sixty, so a single absence in their four would move the roster's figure as much as
 * fifteen absences in the sixty. Summing first is the same arithmetic `dailyRates` does for one
 * morning turned on its side, so the figure sits beside the daily ones under one definition.
 *
 * The three rules `summarize` applies apply here unchanged: late counts as attendance and excused
 * does not, a fellow counts only for the sessions they were eligible for, and test students are in
 * no figure. Null before anything is settled.
 */
export function termRate(summaries: FellowSummary[]): TermRate {
  let eligible = 0;
  let attended = 0;

  for (const summary of summaries) {
    if (summary.fellow.testStudentNumber !== null) continue;
    eligible += summary.eligible;
    attended += summary.present + summary.late;
  }

  return { eligible, attended, rate: eligible === 0 ? null : attended / eligible };
}

/** The mean of each count column of the term grid, and when the roster arrives. See `termAverages`. */
export type TermAverages = {
  /** How many fellows the four count means are over. */
  fellows: number;
  /** Mean per counted fellow, or null when nobody is counted. */
  present: number | null;
  late: number | null;
  excused: number | null;
  /** Absent and unrecorded together, which is what the Absent column prints. */
  absent: number | null;
  arrival: {
    /** Minutes after midnight, or null when no fellow has an average yet. */
    minutes: number | null;
    /** How many fellows' averages the mean is over. */
    fellows: number;
  };
};

/**
 * The figure at the head of each of the other five summary columns: what the column averages to.
 *
 * **The counts are a mean per fellow**, over the fellows who have at least one eligible session.
 * A fellow who joined yesterday has zero of everything and no rate, and counting them would pull
 * every mean toward zero for a reason that has nothing to do with attendance. Test students are in
 * no figure, as everywhere.
 *
 * **The arrival is the plain mean of the times the column prints.** A mean weighted by how many
 * check-ins stand behind each fellow's average would be a more exact figure for "when the roster
 * arrives", and a reader could not reproduce it from the column. The rule here is the one a reader
 * would guess: add up the column and divide. A fellow with no average yet — too few check-ins, see
 * `MIN_ARRIVALS` — is a dash in the column and is not in the mean.
 */
export function termAverages(
  summaries: readonly FellowSummary[],
  arrivalOf: (summary: FellowSummary) => number | null,
): TermAverages {
  let fellows = 0;
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  let arrivalFellows = 0;
  let arrivalMinutes = 0;

  for (const summary of summaries) {
    if (summary.fellow.testStudentNumber !== null) continue;

    if (summary.eligible > 0) {
      fellows += 1;
      present += summary.present;
      late += summary.late;
      excused += summary.excused;
      absent += summary.absent + summary.unrecorded;
    }

    const minutes = arrivalOf(summary);
    if (minutes !== null) {
      arrivalFellows += 1;
      arrivalMinutes += minutes;
    }
  }

  return {
    fellows,
    present: fellows === 0 ? null : present / fellows,
    late: fellows === 0 ? null : late / fellows,
    excused: fellows === 0 ? null : excused / fellows,
    absent: fellows === 0 ? null : absent / fellows,
    arrival: {
      minutes: arrivalFellows === 0 ? null : arrivalMinutes / arrivalFellows,
      fellows: arrivalFellows,
    },
  };
}

export type TermSortColumn =
  "name" | "rate" | "arrives" | "present" | "late" | "excused" | "absent";

export type TermSort = { by: TermSortColumn; direction: "asc" | "desc" };

/** First-name order, as `history` returns the rows and as every list of people opens. */
export const DEFAULT_TERM_SORT: TermSort = { by: "name", direction: "asc" };

/**
 * Which way a column of the term grid opens when it is first clicked.
 *
 * **Rate and arrival open with the fellows to talk to on top**: the lowest rate first, the latest
 * arrival first. The grid is read to find who is slipping, and a sort that opened on the best
 * attender would put the answer at the bottom of the page. The counts open highest first, because
 * a count column is read for who has the most of something — the most lates, the most absences —
 * and Present follows the same rule as the other three so that four columns of the same kind
 * behave the same way. Names open A to Z, as every list of people does.
 */
const TERM_OPENS: Record<TermSortColumn, "asc" | "desc"> = {
  name: "asc",
  rate: "asc",
  arrives: "desc",
  present: "desc",
  late: "desc",
  excused: "desc",
  absent: "desc",
};

/** Clicking a header: the same column reverses, a different column opens its own way. */
export function toggleTermSort(current: TermSort, by: TermSortColumn): TermSort {
  if (current.by === by) return { by, direction: current.direction === "asc" ? "desc" : "asc" };
  return { by, direction: TERM_OPENS[by] };
}

/**
 * The rows of the term grid in the order a sort puts them.
 *
 * **A fellow with no figure in the column sorts last in either direction**: a test student's rate,
 * or an arrival time with too few check-ins behind it, is a dash on screen, and reversing the sort
 * should not float a dash to the top as though it were the lowest number. Ties, and the rows with
 * nothing, fall back to name order.
 *
 * The values sorted are the ones the grid prints — `nameOf` is the string in the name column, and
 * `arrivalOf` is the minutes the Arrives cell formats — so the order on screen can be checked
 * against the column by reading down it. The Absent column prints `absent + unrecorded`, and that
 * is what it sorts by.
 */
export function sortSummaries(
  summaries: readonly FellowSummary[],
  sort: TermSort,
  {
    nameOf,
    arrivalOf,
  }: {
    nameOf: (summary: FellowSummary) => string;
    arrivalOf: (summary: FellowSummary) => number | null;
  },
): FellowSummary[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  const valueOf = (summary: FellowSummary): number | string | null => {
    switch (sort.by) {
      case "name":
        return nameOf(summary).toLocaleLowerCase();
      case "rate":
        // A test student's cell is a dash, whatever `rate` holds. See the grid.
        return summary.fellow.testStudentNumber !== null ? null : summary.rate;
      case "arrives":
        return arrivalOf(summary);
      case "present":
        return summary.present;
      case "late":
        return summary.late;
      case "excused":
        return summary.excused;
      case "absent":
        return summary.absent + summary.unrecorded;
    }
  };

  const byName = (a: FellowSummary, b: FellowSummary) => nameOf(a).localeCompare(nameOf(b));

  return [...summaries].sort((a, b) => {
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
