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
import { CATEGORY_META } from "@/lib/course-units";
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
   * Below this many counted mornings, attendance says nothing yet. The same number as
   * `DRIFT_RULE.needsAtLeast`, so a fellow the attendance rule is not yet judging is not judged here
   * either.
   */
  needsSessionsAtLeast: 5,
} as const;

/** The colour of one cell: green is nothing to say, yellow is short of exceeding, red is a reason to need support. */
export type Band = "green" | "yellow" | "red";

/** The band a term share falls in. */
export function shareBand(share: number, rule: { meeting: number; exceeding: number }): Band {
  if (share < rule.meeting) return "red";
  if (share < rule.exceeding) return "yellow";
  return "green";
}

/** A recent window that is yellow or red, and why. A red one is what the fellow's Trends prints. */
export type PerformanceFlag =
  | {
      kind: "work";
      courseId: string;
      courseName: string;
      reason: DriftReason;
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
  /** Null until the fellow has `PERFORMANCE_RULE.needsSessionsAtLeast` counted mornings. */
  attendanceRate: number | null;
  /** Every yellow or red recent window: work once per course and reason, attendance per reason. */
  flags: readonly PerformanceFlag[];
};

/**
 * Which bucket a fellow belongs in: the worst band on the row.
 *
 * Too early first, because nothing else can be read without the on-time and attendance figures.
 * Then every term share and every flagged window are read as one list of bands, and the worst of
 * them is the group: any red is needs support, any yellow without a red is meeting, and all green
 * is exceeding. A kind of work with nothing past due and graded yet has no share and no band.
 */
export function performanceBucket(reading: PerformanceReading): PerformanceBucket {
  const { onTime, completion, attendanceRate, flags } = reading;
  if (onTime === null || attendanceRate === null) return "too-early";

  const bands: Band[] = [
    shareBand(onTime.onTime / onTime.due, PERFORMANCE_RULE.onTime),
    shareBand(onTime.submitted / onTime.due, PERFORMANCE_RULE.submitted),
    ...Object.values(completion)
      .filter((figures) => figures.possible > 0)
      .map((figures) =>
        shareBand(figures.complete / figures.possible, PERFORMANCE_RULE.completion),
      ),
    shareBand(attendanceRate, PERFORMANCE_RULE.attendance),
    ...flags.map((flag) => flag.band),
  ];

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

  const onTime = recentOnTimeShare(recent);
  const deadlines = onTime === null ? "green" : shareBand(onTime, PERFORMANCE_RULE.recentDeadlines);
  if (deadlines !== "green") {
    flags.push({
      kind: "work",
      courseId: course.id,
      courseName: course.name,
      reason: "deadlines",
      band: deadlines,
    });
  }

  const complete = recentCompleteShare(recent);
  const fallingShort =
    complete === null ? "green" : shareBand(complete, PERFORMANCE_RULE.recentlyCompleted);
  if (fallingShort !== "green") {
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

/** The yellow and red attendance windows: absence first, then lateness, as the grid draws them. */
export function attendanceFlags(recent: RecentAttendance | null): PerformanceFlag[] {
  if (!recent) return [];
  const flags: PerformanceFlag[] = [];

  const attended = recentAttendedShare(recent);
  const missing = attended === null ? "green" : shareBand(attended, PERFORMANCE_RULE.absences);
  if (missing !== "green") flags.push({ kind: "attendance", reason: "missing", band: missing });

  const onTime = recentOnTimeArrivalShare(recent);
  const late = onTime === null ? "green" : shareBand(onTime, PERFORMANCE_RULE.lateArrivals);
  if (late !== "green") flags.push({ kind: "attendance", reason: "late", band: late });

  return flags;
}

/**
 * What a flag is called on the screen: the same label the fellow's Trends prints, with the course
 * named for a work flag, since a roster reads every course at once.
 */
export function performanceFlagLabel(flag: PerformanceFlag): string {
  if (flag.kind === "attendance") return ATTENDANCE_DRIFT_REASON_LABEL[flag.reason];
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
export type MeetingShare = { key: string; title: string; meeting: number; counted: number };

/**
 * For each coloured column, how many fellows are not red in it.
 *
 * **The summary at the top of the Performance tab**, one tile per column the rule reads. Each tile
 * counts only the fellows with a figure in that column: a fellow with too few mornings is in no
 * attendance tile, and one with nothing due is in no work tile, since a fellow the rule has not
 * read is neither meeting the bar nor short of it. The bands are the cells' own, so a tile's count
 * is the number of cells in its column that are yellow or green.
 *
 * One Completed tile per kind of work, in the gradebook's order, for the kinds given.
 */
export function meetingShares(
  rows: readonly {
    attendance: { rate: number | null; recent: RecentAttendance | null };
    standing: Standing;
  }[],
  categories: readonly CourseUnitCategory[],
): MeetingShare[] {
  const tally = (
    key: string,
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
    return { key, title, meeting, counted };
  };

  return [
    tally("attendance", "Attendance Rate", (row) =>
      row.attendance.rate === null
        ? null
        : shareBand(row.attendance.rate, PERFORMANCE_RULE.attendance),
    ),
    tally("absence", "Recent Absence", (row) => {
      const attended = row.attendance.recent ? recentAttendedShare(row.attendance.recent) : null;
      return attended === null ? null : shareBand(attended, PERFORMANCE_RULE.absences);
    }),
    tally("tardiness", "Recent Tardiness", (row) => {
      const onTime = row.attendance.recent ? recentOnTimeArrivalShare(row.attendance.recent) : null;
      return onTime === null ? null : shareBand(onTime, PERFORMANCE_RULE.lateArrivals);
    }),
    tally("onTime", "Deadlines Hit", (row) =>
      row.standing.onTime
        ? shareBand(row.standing.onTime.onTime / row.standing.onTime.due, PERFORMANCE_RULE.onTime)
        : null,
    ),
    tally("submitted", "Assignments Submitted", (row) =>
      row.standing.onTime
        ? shareBand(
            row.standing.onTime.submitted / row.standing.onTime.due,
            PERFORMANCE_RULE.submitted,
          )
        : null,
    ),
    ...categories.map((category) =>
      tally(`completion:${category}`, completedTitle(category), (row) => {
        const figures = row.standing.completion[category];
        return figures && figures.possible > 0
          ? shareBand(figures.complete / figures.possible, PERFORMANCE_RULE.completion)
          : null;
      }),
    ),
  ];
}

/** The query string key holding the shown courses, comma separated. Absent means every course. */
export const COURSES_PARAM = "courses";

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
  /** The shown courses' graded windows added together, as a figure to look at rather than a rule. */
  recentlyGraded: RecentlyGraded;
  /** Every yellow or red window: attendance first, then each shown course in order. */
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
 * **The recent windows are banded per course and never summed into a rule.** Two deadlines slipped
 * in each of two courses is one small slip twice, and a sum that read it as four would flag a
 * fellow no single course is worried about. The graded windows are added up for the All courses
 * band to print, and that figure is not read by the rule.
 */
export function standingAcross(
  attendance: { rate: number | null; recent: RecentAttendance | null },
  courses: readonly { id: string; name: string }[],
  readings: Readonly<Record<string, CourseStanding>>,
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

    flags.push(...workFlags(course, reading.recent));
  }

  const summed = due === 0 ? null : { onTime, submitted, due };

  return {
    bucket: performanceBucket({
      onTime: summed,
      completion,
      attendanceRate: attendance.rate,
      flags,
    }),
    onTime: summed,
    completion,
    recentlyGraded,
    flags,
  };
}
