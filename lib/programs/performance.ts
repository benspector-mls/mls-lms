import { ATTENDANCE_DRIFT_REASON_LABEL, type Drift } from "@/lib/attendance/summary";
import {
  DRIFT_REASON_LABEL,
  isMissing,
  type DriftReason,
  type RecentAssignment,
  type RecentCell,
} from "@/lib/gradebook/summary";
import type { CourseUnitCategory } from "@/lib/generated/prisma/enums";
import { handedIn } from "@/lib/status";
import { lateness } from "@/lib/submissions/hand-in";

/**
 * Where each fellow on a roster stands right now: needs support, meeting the bar, or exceeding
 * expectations.
 *
 * **Recent performance in total, which is why any flag decides it.** The two term-long figures —
 * how much of the work was handed in on time, and how many mornings they were here — say whether a
 * fellow has been doing what the school asks. The drift flags say whether that is still true this
 * fortnight. A fellow at 95 percent attendance who has been late every morning this week is the
 * person to talk to today, and a rule that read only the term would file them under exceeding.
 * So a flag on attendance or on work in any course puts a fellow in needs support however good the
 * term has been.
 *
 * **The buckets nest.** Exceeding asks everything meeting asks and more, so a fellow can only climb
 * by doing better on every figure, never by doing well on one.
 *
 * **Too early to say is not a bucket of the three**, deliberately. A fellow with nothing due yet, or
 * with fewer mornings than the attendance drift rule needs before judging anybody, has not given
 * the rule anything to read. Reading that silence as passing would start every new roster in
 * exceeding, and reading it as failing would start it in needs support; both are wrong about
 * somebody.
 *
 * **Read against the courses being looked at.** The Performance screen can narrow to some of a
 * program's courses, and the groups follow: a fellow is placed by their attendance and by the
 * shown courses alone, so the same roster can be sorted by how it is doing in this month's courses,
 * or in one course, or in all of them. `standingAcross` is that computation, and it is the only one.
 *
 * **Browser-safe and pure**, and its inputs are figures other modules already compute: the drift
 * reasons are `driftReasons` and `attendanceDriftReason`, and the rate is `summarize`'s. What this
 * module adds is the on-time figure and the rule that combines them. The server sends one reading
 * per course and the browser combines whichever are shown, so changing the selection asks the
 * server nothing.
 *
 * The thresholds are a first guess to be argued with once there is a term of data behind them, and
 * are deliberately not configurable, for the reason `DRIFT_RULE` and `ASSIGNMENT_DRIFT_RULE` are
 * not: a setting would freeze the first guess as though it had been reasoned.
 */
export const PERFORMANCE_RULE = {
  /** The share of past-due released assignments handed in by their deadline. */
  onTimeAtLeast: 0.9,
  /** `(present + late) / eligible`, the attendance summary's own rate. */
  meetingAttendanceAtLeast: 0.8,
  exceedingAttendanceAtLeast: 0.9,
  /**
   * Below this many counted mornings, attendance says nothing yet. The same number as
   * `DRIFT_RULE.needsAtLeast`, so a fellow the attendance rule is not yet judging is not judged here
   * either.
   */
  needsSessionsAtLeast: 5,
} as const;

/** A reason the fellow's Trends would print in red. */
export type PerformanceFlag =
  | { kind: "work"; courseId: string; courseName: string; reason: DriftReason }
  | { kind: "attendance"; reason: Drift["reason"] };

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

/** How many past-due assignments were handed in by their deadline, of how many came due. */
export type OnTime = { onTime: number; due: number };

/** Everything the rule reads about one fellow. */
export type PerformanceReading = {
  /** Null when nothing has come due in any course. */
  onTime: OnTime | null;
  /** Null until the fellow has `PERFORMANCE_RULE.needsSessionsAtLeast` counted mornings. */
  attendanceRate: number | null;
  /** Every drift flag: work once per course and reason, attendance at most once. */
  flags: readonly PerformanceFlag[];
};

/**
 * Which bucket a fellow belongs in.
 *
 * Too early first, because nothing else can be read without both figures. Then needs support,
 * which any single failing figure or any flag is enough for. Exceeding and meeting differ only in
 * attendance, because the on-time bar and the absence of flags are already asked of both by the
 * time either is reached.
 */
export function performanceBucket(reading: PerformanceReading): PerformanceBucket {
  const { onTime, attendanceRate, flags } = reading;
  if (onTime === null || attendanceRate === null) return "too-early";

  const onTimeRate = onTime.onTime / onTime.due;
  if (
    flags.length > 0 ||
    onTimeRate < PERFORMANCE_RULE.onTimeAtLeast ||
    attendanceRate < PERFORMANCE_RULE.meetingAttendanceAtLeast
  ) {
    return "needs-support";
  }

  return attendanceRate >= PERFORMANCE_RULE.exceedingAttendanceAtLeast ? "exceeding" : "meeting";
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
 * it.
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
 * Every id asked about gets an entry, `{ onTime: 0, due: 0 }` when nothing has come due, so the
 * caller can tell "nothing due" from "not asked".
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
      let due = 0;

      for (const assignment of pastDue) {
        const cell = cellByKey.get(`${assignment.id}:${studentId}`);

        if (cell && handedIn(cell.status)) {
          due += 1;
          if (lateness({ ...cell, dueAt: assignment.dueAt }) !== "late") onTime += 1;
          continue;
        }

        // Nothing handed in: due only once their own deadline has passed as well.
        if (isMissing(assignment, cell, at)) due += 1;
      }

      return [studentId, { onTime, due }];
    }),
  );
}

/** The query string key holding the shown courses, comma separated. Absent means every course. */
export const COURSES_PARAM = "courses";

/**
 * Which of these courses the address asks to show.
 *
 * **Absent means every course**, so the plain address is the whole grid and a course published
 * next week appears without anybody choosing it. An id that names no course here — one since
 * unpublished, or from another program's link — is ignored rather than refused.
 */
export function shownCourseIds(
  param: string | null,
  courses: readonly { id: string }[],
): Set<string> {
  if (param === null) return new Set(courses.map((course) => course.id));
  const asked = new Set(param.split(",").filter(Boolean));
  return new Set(courses.filter((course) => asked.has(course.id)).map((course) => course.id));
}

/** Graded complete, of the released work of one kind. */
export type Completion = { complete: number; possible: number };

/** What one course contributes to a fellow's standing. */
export type CourseStanding = {
  /** Of this course's past-due released work: see `onTimeByStudent`. */
  onTime: OnTime;
  /** By the kind of unit, for each kind this course has released work in. */
  completion: Partial<Record<CourseUnitCategory, Completion>>;
  /** Which clauses of the gradebook's drift rule this course trips. */
  reasons: readonly DriftReason[];
};

/** A fellow's standing across the courses being looked at. */
export type Standing = {
  bucket: PerformanceBucket;
  /** Summed over the shown courses. Null when nothing in them has come due. */
  onTime: OnTime | null;
  /** Summed over the shown courses, for each kind of unit any of them has released work in. */
  completion: Partial<Record<CourseUnitCategory, Completion>>;
  flags: PerformanceFlag[];
};

/**
 * Where a fellow stands, reading attendance and only the courses given.
 *
 * **Sums rather than recomputes**, which is sound because every figure here is a count over
 * assignments and each assignment belongs to one course: the on-time share across three courses is
 * the three courses' counts added, and so is completion. Attendance belongs to the program rather
 * than to any course, so it counts whichever courses are shown.
 */
export function standingAcross(
  attendance: { rate: number | null; reason: Drift["reason"] | null },
  courses: readonly { id: string; name: string }[],
  readings: Readonly<Record<string, CourseStanding>>,
): Standing {
  let onTime = 0;
  let due = 0;
  const completion: Partial<Record<CourseUnitCategory, Completion>> = {};
  const flags: PerformanceFlag[] = attendance.reason
    ? [{ kind: "attendance", reason: attendance.reason }]
    : [];

  for (const course of courses) {
    const reading = readings[course.id];
    if (!reading) continue;

    onTime += reading.onTime.onTime;
    due += reading.onTime.due;

    for (const [category, figures] of Object.entries(reading.completion) as [
      CourseUnitCategory,
      Completion,
    ][]) {
      const total = (completion[category] ??= { complete: 0, possible: 0 });
      total.complete += figures.complete;
      total.possible += figures.possible;
    }

    for (const reason of reading.reasons) {
      flags.push({ kind: "work", courseId: course.id, courseName: course.name, reason });
    }
  }

  const summed = due === 0 ? null : { onTime, due };

  return {
    bucket: performanceBucket({ onTime: summed, attendanceRate: attendance.rate, flags }),
    onTime: summed,
    completion,
    flags,
  };
}
