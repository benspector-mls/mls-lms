import {
  ATTENDANCE_DRIFT_REASON_LABEL,
  DRIFT_RULE,
  recentAttendedShare,
  recentOnTimeArrivalShare,
  type AttendanceDriftReason,
  type RecentAttendance,
} from "@/lib/attendance/summary";
import {
  ASSIGNMENT_DRIFT_RULE,
  DRIFT_REASON_LABEL,
  isMissing,
  recentCompleteShare,
  recentOnTimeShare,
  type DriftReason,
  type RecentAssignment,
  type RecentCell,
  type RecentWork,
} from "@/lib/gradebook/summary";
import { CATEGORY_META, UNIT_CATEGORIES } from "@/lib/course-units";
import type { CourseUnitCategory } from "@/lib/generated/prisma/enums";
import { handedIn } from "@/lib/status";
import { lateness } from "@/lib/submissions/hand-in";

/**
 * Where each fellow on a roster stands right now: needs support, meeting the bar, or exceeding
 * expectations.
 *
 * **Every coloured cell on the row has three bands, and the group is the worst of them.** A red
 * cell is a figure past the bar the school asks of everybody; a yellow one is a figure short of
 * what the best fellows do; a green one is neither. Any red puts a fellow in needs support, any
 * yellow with no red is meeting the bar, and all green is exceeding. One rule, read the same way
 * on every cell, so an instructor scanning the grid can see why a fellow is where they are without
 * learning a different rule for each column.
 *
 * **Term figures and recent windows are both read, which is why one cell is enough to decide.**
 * The term-long shares — how much of the work was handed in by its deadline, handed in at all, and
 * graded complete, and how many mornings they were here — say whether a fellow has been doing what
 * the school asks. The recent windows say whether that is still true over the window chosen, two
 * weeks unless the instructor picked a range. A fellow at 95 percent attendance who has been late
 * every morning this week is the person to talk to today, and a rule that read only the term would
 * file them under exceeding.
 *
 * **Every coloured cell is a share read against one pair of bars**, red under 75 percent and
 * yellow under 90, so a reader learns one rule. Red on a recent window is the drift rule's own
 * bar, so the Performance tab and the fellow's Trends section never disagree about who is
 * drifting.
 *
 * **Too early to say is not a bucket of the three**, deliberately. A fellow with nothing due yet, or
 * with fewer mornings than the attendance drift rule needs before judging anybody, has not given
 * the rule anything to read. Reading that silence as passing would start every new roster in
 * exceeding, and reading it as failing would start it in needs support; both are wrong about
 * somebody.
 *
 * **Read against the courses being looked at.** The Performance tab can narrow to some of a
 * program's courses, and the groups follow: a fellow is placed by their attendance and by the
 * shown courses alone, so the same roster can be sorted by how it is doing in this month's courses,
 * or in one course, or in all of them. `standingAcross` is that computation, and it is the only one.
 *
 * **Read against the measures chosen, too.** A measure is a family of coloured columns that count
 * the same thing: attendance, deadlines, submissions, or completion. The Performance tab can leave
 * measures out, and the rule then reads only the chosen ones, so an instructor can ask who needs
 * support for attendance and deadlines and get a group that holds nobody who is there for
 * completion alone. Every measure is read when none is chosen.
 *
 * **Browser-safe and pure**, and its inputs are figures other modules already compute: the recent
 * windows are `recentWorkByStudent`'s and `recentAttendance`'s, and the rate is `summarize`'s. What
 * this module adds is the on-time figure, the bands, and the rule that combines them. The server
 * sends one reading per course and the browser combines whichever are shown, so changing the
 * selection asks the server nothing.
 *
 * The thresholds are a first guess to be argued with once there is a term of data behind them, and
 * are deliberately not configurable, for the reason `DRIFT_RULE` and `ASSIGNMENT_DRIFT_RULE` are
 * not: a setting would freeze the first guess as though it had been reasoned.
 */
export const PERFORMANCE_RULE = {
  /**
   * The four term shares, read the same way: red under `meeting`, yellow under `exceeding`, and
   * green from there. `onTime` is the share of past-due released assignments handed in by their
   * deadline and `submitted` the share handed in at all; `completion` is the share of a fellow's
   * past-due graded work of one kind that was graded complete, see `gradedCompletionByStudent`;
   * `attendance` is `(present + late) / eligible`, the attendance summary's own rate. One pair of
   * bars for all four, so a reader learns one rule for every percentage on the screen.
   */
  onTime: { meeting: 0.75, exceeding: 0.9 },
  submitted: { meeting: 0.75, exceeding: 0.9 },
  completion: { meeting: 0.75, exceeding: 0.9 },
  attendance: { meeting: 0.75, exceeding: 0.9 },
  /**
   * The four recent windows, as shares of what went right over the window: mornings attended,
   * mornings not arrived at late, deadlines hit, and graded work complete. Each red bar is the
   * drift rule's own, named rather than copied, so a change there reaches here.
   */
  absences: { meeting: DRIFT_RULE.attendedAtLeast, exceeding: 0.9 },
  lateArrivals: { meeting: DRIFT_RULE.onTimeAtLeast, exceeding: 0.9 },
  recentDeadlines: { meeting: ASSIGNMENT_DRIFT_RULE.onTimeAtLeast, exceeding: 0.9 },
  recentlyCompleted: { meeting: ASSIGNMENT_DRIFT_RULE.completeAtLeast, exceeding: 0.9 },
  /**
   * Below this many assignments behind a term share, the share is printed and never coloured: one
   * miss of one due is not a pattern. The drift rule's own minimum, so a figure needs the same
   * amount behind it whether it is a term share or a window.
   */
  needsAtLeast: ASSIGNMENT_DRIFT_RULE.needsAtLeast,
  /**
   * Below this many counted mornings, attendance says nothing yet. The same number as
   * `DRIFT_RULE.needsAtLeast`, so a fellow the attendance rule is not yet judging is not judged here
   * either.
   */
  needsSessionsAtLeast: 5,
} as const;

/** The colour of one cell: green is nothing to say, yellow is short of exceeding, red is a reason to need support. */
export type Band = "green" | "yellow" | "red";

/** The band a share falls in, or null for a share with too little behind it to be read. */
export function shareBand(
  share: number | null,
  rule: { meeting: number; exceeding: number },
): Band | null {
  if (share === null) return null;
  if (share < rule.meeting) return "red";
  if (share < rule.exceeding) return "yellow";
  return "green";
}

/**
 * A term figure as a share, or null under `PERFORMANCE_RULE.needsAtLeast`. The recent share
 * functions apply the same minimum to their windows, so three of three is grey in every column.
 */
export function termShare(done: number, of: number): number | null {
  return of < PERFORMANCE_RULE.needsAtLeast ? null : done / of;
}

/**
 * A cell of one course that is yellow or red, and why: a recent window, or one kind of work's term
 * completion. A red one is what the fellow's Trends prints.
 */
export type PerformanceFlag =
  | {
      kind: "work";
      courseId: string;
      courseName: string;
      reason: DriftReason;
      band: "yellow" | "red";
    }
  | {
      kind: "completion";
      courseId: string;
      courseName: string;
      category: CourseUnitCategory;
      band: "yellow" | "red";
    }
  | { kind: "attendance"; reason: AttendanceDriftReason; band: "yellow" | "red" };

export type PerformanceBucket = "needs-support" | "meeting" | "exceeding" | "too-early";

/** The three bucket names first, in the order the screen reads them, and the fourth last. */
export const PERFORMANCE_BUCKETS: readonly PerformanceBucket[] = [
  "needs-support",
  "meeting",
  "exceeding",
  "too-early",
];

export const PERFORMANCE_BUCKET_LABEL: Record<PerformanceBucket, string> = {
  "needs-support": "Needs support",
  meeting: "Meeting the bar",
  exceeding: "Exceeding expectations",
  "too-early": "Too early to say",
};

/**
 * What a coloured column measures. The measure filter chooses among these and the rule reads only
 * the chosen ones. Attendance is the attendance rate and the two recent attendance windows;
 * deadlines is Deadlines Hit and each course's recent deadlines; submissions is Assignments
 * Submitted; completion is every Graded … Completed share, pooled and per course, and the recent
 * graded work, pooled and per course.
 */
export type Measure = "attendance" | "deadlines" | "submissions" | "completion";

/** Every measure, in the order the grid draws their columns. */
export const MEASURES: readonly Measure[] = [
  "attendance",
  "deadlines",
  "submissions",
  "completion",
];

export const MEASURE_LABEL: Record<Measure, string> = {
  attendance: "Attendance",
  deadlines: "Deadlines",
  submissions: "Submissions",
  completion: "Completion",
};

const EVERY_MEASURE: ReadonlySet<Measure> = new Set(MEASURES);

/** Which measure a flagged window belongs to, so the filter leaves it out along with its columns. */
export function measureOf(flag: PerformanceFlag): Measure {
  if (flag.kind === "attendance") return "attendance";
  if (flag.kind === "completion") return "completion";
  return flag.reason === "deadlines" ? "deadlines" : "completion";
}

/**
 * Of the past-due assignments, how many were handed in by their deadline, how many were handed in
 * at all, and how many came due.
 */
export type OnTime = { onTime: number; submitted: number; due: number };

/** Everything the rule reads about one fellow. */
export type PerformanceReading = {
  /** Null when nothing has come due in any course. */
  onTime: OnTime | null;
  /** Graded complete of past-due graded work, by kind, summed over the shown courses. */
  completion: Partial<Record<CourseUnitCategory, Completion>>;
  /** The shown courses' graded windows added together; see `standingAcross`. */
  recentlyGraded: RecentlyGraded;
  /** Null until the fellow has `PERFORMANCE_RULE.needsSessionsAtLeast` counted mornings. */
  attendanceRate: number | null;
  /** Every yellow or red course cell: windows once per course and reason, completion per course and kind, attendance per reason. */
  flags: readonly PerformanceFlag[];
};

/**
 * Which bucket a fellow belongs in: the worst band on the row, among the measures chosen.
 *
 * **Too early first.** A chosen measure with nothing to read yet makes the fellow too early,
 * because placing them by whatever can be read would start every new roster in exceeding under a
 * single measure. Attendance has nothing to read until `attendanceRate` is set, and the three work
 * measures have nothing until work has come due. Completion counts as readable whenever work has
 * come due, so a fellow whose past-due work is all waiting on a grade is still placed by the other
 * chosen measures.
 *
 * **Then the worst band.** Every chosen term share, the pooled recent graded work, and every flagged
 * course cell of a chosen measure are read as one list of bands: any red is needs support, any
 * yellow without a red is meeting, and all green is exceeding. A share with fewer than
 * `PERFORMANCE_RULE.needsAtLeast` behind it has no band, so a kind of work with little past due and graded yet has no share and no
 * band. An empty list, which completion alone produces while nothing graded exists, is too early
 * rather than exceeding, since silence is not a pass.
 */
export function performanceBucket(
  reading: PerformanceReading,
  measures: ReadonlySet<Measure> = EVERY_MEASURE,
): PerformanceBucket {
  const { onTime, completion, recentlyGraded, attendanceRate, flags } = reading;
  const readsWork =
    measures.has("deadlines") || measures.has("submissions") || measures.has("completion");
  if (measures.has("attendance") && attendanceRate === null) return "too-early";
  if (readsWork && onTime === null) return "too-early";

  const read: (Band | null)[] = [];
  if (measures.has("deadlines") && onTime) {
    read.push(shareBand(termShare(onTime.onTime, onTime.due), PERFORMANCE_RULE.onTime));
  }
  if (measures.has("submissions") && onTime) {
    read.push(shareBand(termShare(onTime.submitted, onTime.due), PERFORMANCE_RULE.submitted));
  }
  if (measures.has("completion")) {
    for (const figures of Object.values(completion)) {
      read.push(
        shareBand(termShare(figures.complete, figures.possible), PERFORMANCE_RULE.completion),
      );
    }
    read.push(
      shareBand(
        termShare(recentlyGraded.complete, recentlyGraded.graded),
        PERFORMANCE_RULE.recentlyCompleted,
      ),
    );
  }
  if (measures.has("attendance")) {
    read.push(shareBand(attendanceRate, PERFORMANCE_RULE.attendance));
  }
  for (const flag of flags) {
    if (measures.has(measureOf(flag))) read.push(flag.band);
  }

  const bands = read.filter((band): band is Band => band !== null);
  if (bands.length === 0) return "too-early";
  if (bands.includes("red")) return "needs-support";
  if (bands.includes("yellow")) return "meeting";
  return "exceeding";
}

/**
 * The yellow and red windows of one course, in the order the grid draws them: deadlines, then
 * graded work. A green window is left out, because a flag is a reason and green has none.
 */
export function workFlags(
  course: { id: string; name: string },
  recent: RecentWork | null,
): PerformanceFlag[] {
  if (!recent) return [];
  const flags: PerformanceFlag[] = [];

  const deadlines = shareBand(recentOnTimeShare(recent), PERFORMANCE_RULE.recentDeadlines);
  if (deadlines && deadlines !== "green") {
    flags.push({
      kind: "work",
      courseId: course.id,
      courseName: course.name,
      reason: "deadlines",
      band: deadlines,
    });
  }

  const fallingShort = shareBand(recentCompleteShare(recent), PERFORMANCE_RULE.recentlyCompleted);
  if (fallingShort && fallingShort !== "green") {
    flags.push({
      kind: "work",
      courseId: course.id,
      courseName: course.name,
      reason: "falling-short",
      band: fallingShort,
    });
  }

  return flags;
}

/**
 * The yellow and red Graded … Completed shares of one course, one per kind of work it has released,
 * in the gradebook's order of kinds. Read per course as well as pooled across the shown courses,
 * because a kind of work a fellow is failing in one course can hide inside a pooled share the
 * other courses hold up.
 */
export function completionFlags(
  course: { id: string; name: string },
  completion: Partial<Record<CourseUnitCategory, Completion>>,
): PerformanceFlag[] {
  const flags: PerformanceFlag[] = [];
  for (const category of UNIT_CATEGORIES) {
    const figures = completion[category];
    if (!figures) continue;
    const band = shareBand(
      termShare(figures.complete, figures.possible),
      PERFORMANCE_RULE.completion,
    );
    if (band && band !== "green") {
      flags.push({
        kind: "completion",
        courseId: course.id,
        courseName: course.name,
        category,
        band,
      });
    }
  }
  return flags;
}

/** The yellow and red attendance windows: absence first, then lateness, as the grid draws them. */
export function attendanceFlags(recent: RecentAttendance | null): PerformanceFlag[] {
  if (!recent) return [];
  const flags: PerformanceFlag[] = [];

  const missing = shareBand(recentAttendedShare(recent), PERFORMANCE_RULE.absences);
  if (missing && missing !== "green") {
    flags.push({ kind: "attendance", reason: "missing", band: missing });
  }

  const late = shareBand(recentOnTimeArrivalShare(recent), PERFORMANCE_RULE.lateArrivals);
  if (late && late !== "green") flags.push({ kind: "attendance", reason: "late", band: late });

  return flags;
}

/**
 * What a flag is called on the screen: the same label the fellow's Trends prints, with the course
 * named for a work flag, since a roster reads every course at once.
 */
export function performanceFlagLabel(flag: PerformanceFlag): string {
  if (flag.kind === "attendance") return ATTENDANCE_DRIFT_REASON_LABEL[flag.reason];
  if (flag.kind === "completion") {
    return `Incomplete ${CATEGORY_META[flag.category].tabLabel.toLowerCase()} · ${flag.courseName}`;
  }
  return `${DRIFT_REASON_LABEL[flag.reason]} · ${flag.courseName}`;
}

/**
 * Per student: of the released assignments whose deadline has passed, how many they handed in by
 * it, and how many they handed in at all.
 *
 * **`submitted` counts a hand-in whenever it arrived**, late or on time, so the Assignments
 * Submitted column can say how much of the past-due work exists at all, where Deadlines Hit says
 * how much of it arrived when asked. The two share one denominator, so a reader can subtract one
 * from the other and get the work handed in late.
 *
 * **On time means handed in by the class deadline or by an agreed extension**, which is `lateness`
 * reading `onTime` or `extended` — the same test the late count and the grading screen's badge run,
 * so a fellow counted late here is counted late everywhere. No grading verdict is consulted: work
 * that is handed in on time and not yet graded is on time, and whether it fell short is the
 * "Falling short" flag's question.
 *
 * **The deadline window is the class's, with one exception per fellow.** An assignment counts as
 * due once its class deadline has passed, the same three-way test `recentWorkByStudent` applies:
 * released, dated, and strictly before `at`. A fellow still inside an extension who has handed
 * nothing in is left out of their own denominator, because their deadline has not passed and
 * `isMissing` says so. Counting it would mark them down for keeping the arrangement they made.
 *
 * Every id asked about gets an entry, `{ onTime: 0, submitted: 0, due: 0 }` when nothing has come
 * due, so the caller can tell "nothing due" from "not asked".
 */
export function onTimeByStudent(
  studentIds: readonly string[],
  work: readonly RecentAssignment[],
  cells: readonly RecentCell[],
  at: Date,
): Map<string, OnTime> {
  const pastDue = work.filter(
    (assignment) =>
      assignment.dueAt != null &&
      assignment.distributedAt != null &&
      new Date(assignment.dueAt).getTime() < at.getTime(),
  );

  const cellByKey = new Map(cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

  return new Map(
    studentIds.map((studentId) => {
      let onTime = 0;
      let submitted = 0;
      let due = 0;

      for (const assignment of pastDue) {
        const cell = cellByKey.get(`${assignment.id}:${studentId}`);

        if (cell && handedIn(cell.status)) {
          due += 1;
          submitted += 1;
          if (lateness({ ...cell, dueAt: assignment.dueAt }) !== "late") onTime += 1;
          continue;
        }

        // Nothing handed in: due only once their own deadline has passed as well.
        if (isMissing(assignment, cell, at)) due += 1;
      }

      return [studentId, { onTime, submitted, due }];
    }),
  );
}

/**
 * Per student: of their past-due work that has been graded, how much was graded complete.
 *
 * **The denominator is the fellow's own, and it leaves out only work waiting on an instructor.**
 * A share over everything released would mark a fellow down for work not yet due and for work
 * sitting in the grading queue, neither of which says anything about them. So an assignment enters
 * a fellow's denominator once its deadline has passed for them and either their submission has a
 * verdict or they handed nothing in. Missing work is counted, as incomplete: a fellow who hands
 * nothing in has not completed it, and leaving it out would let them vanish from their own figure.
 * A revision handed back for another look has its verdict cleared and waits again.
 *
 * **Past due is the same test `onTimeByStudent` runs**, extension included, so the denominators of
 * the three term shares differ only by the work still waiting on a grade.
 *
 * Every id asked about gets an entry, `{ complete: 0, possible: 0 }` when nothing is graded yet.
 * The gradebook's own Completed column keeps everything released as its denominator, because it
 * sits beside the cells it counts; this share is for reading a fellow's standing.
 */
export function gradedCompletionByStudent(
  studentIds: readonly string[],
  work: readonly RecentAssignment[],
  cells: readonly RecentCell[],
  at: Date,
): Map<string, Completion> {
  const pastDue = work.filter(
    (assignment) =>
      assignment.dueAt != null &&
      assignment.distributedAt != null &&
      new Date(assignment.dueAt).getTime() < at.getTime(),
  );

  const cellByKey = new Map(cells.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell]));

  return new Map(
    studentIds.map((studentId) => {
      let complete = 0;
      let possible = 0;

      for (const assignment of pastDue) {
        const cell = cellByKey.get(`${assignment.id}:${studentId}`);

        if (cell && handedIn(cell.status)) {
          // Handed in and not yet graded: nothing to read, so it is not counted either way.
          if (cell.isComplete === null) continue;
          possible += 1;
          if (cell.isComplete) complete += 1;
          continue;
        }

        // Nothing handed in: incomplete once their own deadline has passed as well.
        if (isMissing(assignment, cell, at)) possible += 1;
      }

      return [studentId, { complete, possible }];
    }),
  );
}

/** What a Completed column is called, by the kind of work it counts. */
export function completedTitle(category: CourseUnitCategory): string {
  return `Graded ${CATEGORY_META[category].tabLabel} Completed`;
}

/** How many fellows are at or above the bar in one column, of how many have a figure there. */
export type MeetingShare = {
  key: string;
  measure: Measure;
  title: string;
  meeting: number;
  counted: number;
};

/**
 * For each coloured column, how many fellows are not red in it.
 *
 * **The summary at the top of the Performance tab**, one tile per column the rule reads. Each tile
 * counts only the fellows with a figure in that column: a fellow with too few mornings is in no
 * attendance tile, and one with nothing due is in no work tile, since a fellow the rule has not
 * read is neither meeting the bar nor short of it. The bands are the cells' own, so a tile's count
 * is the number of cells in its column that are yellow or green.
 *
 * One Completed tile per kind of work, in the gradebook's order, for the kinds given. Only the
 * chosen measures' columns are listed, since a column the rule is not reading has no bar to be at.
 */
export function meetingShares(
  rows: readonly {
    attendance: { rate: number | null; recent: RecentAttendance | null };
    standing: Standing;
  }[],
  categories: readonly CourseUnitCategory[],
  measures: ReadonlySet<Measure> = EVERY_MEASURE,
): MeetingShare[] {
  const tally = (
    key: string,
    measure: Measure,
    title: string,
    bandOf: (row: (typeof rows)[number]) => Band | null,
  ): MeetingShare => {
    let meeting = 0;
    let counted = 0;
    for (const row of rows) {
      const band = bandOf(row);
      if (band === null) continue;
      counted += 1;
      if (band !== "red") meeting += 1;
    }
    return { key, measure, title, meeting, counted };
  };

  const shares: MeetingShare[] = [
    tally("attendance", "attendance", "Attendance Rate", (row) =>
      shareBand(row.attendance.rate, PERFORMANCE_RULE.attendance),
    ),
    tally("absence", "attendance", "Recent Absence", (row) =>
      shareBand(
        row.attendance.recent ? recentAttendedShare(row.attendance.recent) : null,
        PERFORMANCE_RULE.absences,
      ),
    ),
    tally("tardiness", "attendance", "Recent Tardiness", (row) =>
      shareBand(
        row.attendance.recent ? recentOnTimeArrivalShare(row.attendance.recent) : null,
        PERFORMANCE_RULE.lateArrivals,
      ),
    ),
    tally("onTime", "deadlines", "Deadlines Hit", (row) =>
      shareBand(
        row.standing.onTime ? termShare(row.standing.onTime.onTime, row.standing.onTime.due) : null,
        PERFORMANCE_RULE.onTime,
      ),
    ),
    tally("submitted", "submissions", "Assignments Submitted", (row) =>
      shareBand(
        row.standing.onTime
          ? termShare(row.standing.onTime.submitted, row.standing.onTime.due)
          : null,
        PERFORMANCE_RULE.submitted,
      ),
    ),
    tally("recentlyGraded", "completion", "Recently Completed", (row) =>
      shareBand(
        termShare(row.standing.recentlyGraded.complete, row.standing.recentlyGraded.graded),
        PERFORMANCE_RULE.recentlyCompleted,
      ),
    ),
    ...categories.map((category) =>
      tally(`completion:${category}`, "completion", completedTitle(category), (row) => {
        const figures = row.standing.completion[category];
        return shareBand(
          figures ? termShare(figures.complete, figures.possible) : null,
          PERFORMANCE_RULE.completion,
        );
      }),
    ),
  ];

  return shares.filter((share) => measures.has(share.measure));
}

/** The query string key holding the shown courses, comma separated. Absent means every course. */
export const COURSES_PARAM = "courses";

/** The query string key holding the chosen measures, comma separated. Absent means every measure. */
export const MEASURES_PARAM = "measures";

/**
 * Which measures the address asks the rule to read.
 *
 * **Absent means every measure**, so the plain address is the tab as it has always been. A name
 * that is no measure is ignored rather than refused. A parameter naming no measure at all also
 * means every measure: a rule reading nothing would file every fellow under too early to say,
 * which answers no question, and the filter never writes such an address.
 */
export function chosenMeasures(param: string | null): Set<Measure> {
  if (param === null) return new Set(MEASURES);
  const asked = new Set(param.split(","));
  const chosen = MEASURES.filter((measure) => asked.has(measure));
  return new Set(chosen.length === 0 ? MEASURES : chosen);
}

/**
 * Which courses the Performance tab reads when nobody has chosen.
 *
 * **The courses still running.** An archived course is over, and its last few deadlines stop being
 * recent the day it ends — a fellow who missed Prework's final week would otherwise carry that
 * flag, and that group, for the rest of the year. Archiving a course is how an instructor says it
 * has finished, so it leaves the default without anybody touching the filter. It stays one tick
 * away in the filter's menu.
 *
 * **Every course, once the program itself is archived.** A finished program is read as a whole
 * term, and every one of its courses is over, so leaving the archived ones out would leave nothing.
 * The same fallback covers a running program all of whose courses are archived, for the same
 * reason: an empty default would read every fellow as too early to say.
 */
export function defaultCourseIds(
  courses: readonly { id: string; archived: boolean }[],
  programArchived: boolean,
): Set<string> {
  const running = courses.filter((course) => !course.archived);
  const chosen = programArchived || running.length === 0 ? courses : running;
  return new Set(chosen.map((course) => course.id));
}

/**
 * Which of these courses the address asks to show.
 *
 * **Absent means the default**, `defaultCourseIds`, so the plain address follows the program as it
 * changes: a course published next week appears without anybody choosing it, and one archived next
 * week leaves. A link that names courses keeps naming them. An id that names no course here — one
 * since unpublished, or from another program's link — is ignored rather than refused.
 */
export function shownCourseIds(
  param: string | null,
  courses: readonly { id: string; archived: boolean }[],
  programArchived: boolean,
): Set<string> {
  if (param === null) return defaultCourseIds(courses, programArchived);
  const asked = new Set(param.split(",").filter(Boolean));
  return new Set(courses.filter((course) => asked.has(course.id)).map((course) => course.id));
}

/** Graded complete, of a fellow's past-due graded work of one kind. See `gradedCompletionByStudent`. */
export type Completion = { complete: number; possible: number };

/** Graded complete, of the fellow's last few graded assignments. */
export type RecentlyGraded = { complete: number; graded: number };

/** What one course contributes to a fellow's standing. */
export type CourseStanding = {
  /** Of this course's past-due released work: see `onTimeByStudent`. */
  onTime: OnTime;
  /** By the kind of unit, for each kind this course has released work in: see `gradedCompletionByStudent`. */
  completion: Partial<Record<CourseUnitCategory, Completion>>;
  /** The two windows the drift rule reads, or null when the course has no released work. */
  recent: RecentWork | null;
};

/** A fellow's standing across the courses being looked at. */
export type Standing = {
  bucket: PerformanceBucket;
  /** Summed over the shown courses. Null when nothing in them has come due. */
  onTime: OnTime | null;
  /** Summed over the shown courses, for each kind of unit any of them has released work in. */
  completion: Partial<Record<CourseUnitCategory, Completion>>;
  /** The shown courses' graded windows added together, read against the recent bars. */
  recentlyGraded: RecentlyGraded;
  /** Every yellow or red window of a chosen measure: attendance first, then each shown course in order. */
  flags: PerformanceFlag[];
};

/**
 * Where a fellow stands, reading attendance and only the courses given.
 *
 * **Sums rather than recomputes**, which is sound because every figure here is a count over
 * assignments and each assignment belongs to one course: the on-time share across three courses is
 * the three courses' counts added, and so is completion. Attendance belongs to the program rather
 * than to any course, so it counts whichever courses are shown.
 *
 * **The deadline windows are banded per course and never summed into a rule.** Two deadlines
 * slipped in each of two courses is one small slip twice, and a sum that read it as four would
 * flag a fellow no single course is worried about. The graded windows are banded per course and
 * read pooled as well: a window of three graded in one course is under the minimum and says
 * nothing on its own, and the pooled figure is where enough graded work exists to be judged.
 * Completion is read per course and kind as well as pooled, for the opposite reason: a kind of
 * work a fellow is failing in one course can hide inside a pooled share the other courses hold up.
 *
 * **Only the chosen measures' flags are kept.** The grid's worst-first order counts flags by
 * colour, so a flag from a measure left out would push a fellow up a group they are not in for
 * that reason.
 */
export function standingAcross(
  attendance: { rate: number | null; recent: RecentAttendance | null },
  courses: readonly { id: string; name: string }[],
  readings: Readonly<Record<string, CourseStanding>>,
  measures: ReadonlySet<Measure> = EVERY_MEASURE,
): Standing {
  let onTime = 0;
  let submitted = 0;
  let due = 0;
  const completion: Partial<Record<CourseUnitCategory, Completion>> = {};
  const recentlyGraded: RecentlyGraded = { complete: 0, graded: 0 };
  const flags: PerformanceFlag[] = attendanceFlags(attendance.recent);

  for (const course of courses) {
    const reading = readings[course.id];
    if (!reading) continue;

    onTime += reading.onTime.onTime;
    submitted += reading.onTime.submitted;
    due += reading.onTime.due;

    for (const [category, figures] of Object.entries(reading.completion) as [
      CourseUnitCategory,
      Completion,
    ][]) {
      const total = (completion[category] ??= { complete: 0, possible: 0 });
      total.complete += figures.complete;
      total.possible += figures.possible;
    }

    if (reading.recent) {
      recentlyGraded.complete += reading.recent.graded - reading.recent.incomplete;
      recentlyGraded.graded += reading.recent.graded;
    }

    flags.push(
      ...workFlags(course, reading.recent),
      ...completionFlags(course, reading.completion),
    );
  }

  const summed = due === 0 ? null : { onTime, submitted, due };
  const chosen = flags.filter((flag) => measures.has(measureOf(flag)));

  return {
    bucket: performanceBucket(
      {
        onTime: summed,
        completion,
        recentlyGraded,
        attendanceRate: attendance.rate,
        flags: chosen,
      },
      measures,
    ),
    onTime: summed,
    completion,
    recentlyGraded,
    flags: chosen,
  };
}
