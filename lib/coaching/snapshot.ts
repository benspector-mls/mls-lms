import "server-only";

import {
  allUnits,
  cellsFor,
  courseVerdictByStudent,
  groupByUnit,
  published,
  workOf,
  type UnitVerdict,
} from "@/lib/gradebook/categories";
import {
  completionByStudent,
  lateByStudent,
  missingByStudent,
  recentWorkByStudent,
  type Completion,
  type RecentWork,
} from "@/lib/gradebook/summary";
import { recentChecks, type RecentChecks } from "@/lib/checks/trends";
import type { Tx } from "@/lib/prisma";

import { SNAPSHOT_VERSION, type CoachingSnapshot } from "../coaching";
import { arrivalAverages } from "../attendance/arrival";
import { recentAttendance, summarize } from "../attendance/summary";
import { sessionStateOf, stateIsUnsettled } from "../attendance/window";
import { displayNameOf } from "../people";
import { schoolDayFromColumn, schoolDayOf } from "../school-time";

/**
 * Everything one attendance session's state is decided from — the same columns `programs.student`
 * selects, repeated rather than imported for the reason that router repeats them: a read of this
 * module's own should not depend on another router's internals.
 */
const attendanceSessionSelect = {
  id: true,
  date: true,
  startedAt: true,
  endsAt: true,
  endedAt: true,
  lateAfterMinutes: true,
} as const;

/** The row everything here is scoped by: one fellow's enrollment in one program. */
export type EnrollmentKey = {
  id: string;
  programId: string;
  studentId: string;
  /** When they joined, which decides how many mornings count against them. */
  createdAt: Date;
};

export type CourseFigures = {
  id: string;
  name: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
  /** Where they stand on the whole course, by the rule the gradebook's Overview applies. */
  verdict: UnitVerdict;
  /** Of the course's released assignments, across every category — the Overview's course-wide figure. */
  completedAssignments: Completion;
  missing: number;
  late: number;
  /**
   * The last few weeks rather than the term: the two windows the gradebook's "Needs a conversation"
   * rule reads. The record prints them whether or not the rule trips.
   */
  recent: RecentWork;
  /**
   * Their last few checks for understanding in this course: how many they answered, how many ended
   * Blocked, and whether they asked for help on those. Trends prints it; the snapshot does not
   * freeze it, and nothing flags on it — see `lib/checks/trends.ts`.
   */
  checks: RecentChecks;
};

/**
 * One fellow's standing in every course of a program: the figures the gradebook Overview shows,
 * for one person.
 *
 * **The one computation behind every surface that shows it.** The program student record renders
 * this, the coaching session form renders its Trends and its strip of "what will be recorded" from
 * it, and `assembleSnapshot` below freezes it into a completed session — so no two of them can
 * disagree. Every figure goes through the exact functions the gradebook itself uses.
 *
 * **Every course, published or not.** The instructor's record shows a course they are still
 * writing; what the fellow-visible snapshot may carry is `assembleSnapshot`'s narrowing to make,
 * not this function's.
 */
export async function courseFiguresFor(
  db: Tx,
  enrollment: EnrollmentKey,
  at: Date,
): Promise<CourseFigures[]> {
  const [courses, units, cells, checks] = await Promise.all([
    db.course.findMany({
      where: { programId: enrollment.programId },
      // The order the program's owner put them in. See `courses.reorder`.
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, publishedAt: true, archivedAt: true },
    }),
    db.courseUnit.findMany({
      where: { course: { programId: enrollment.programId } },
      select: {
        id: true,
        courseId: true,
        name: true,
        position: true,
        category: true,
        assignments: {
          select: { id: true, title: true, dueAt: true, courseUnitId: true, distributedAt: true },
        },
      },
    }),
    db.submission.findMany({
      where: {
        studentId: enrollment.studentId,
        assignment: { course: { programId: enrollment.programId } },
      },
      select: {
        assignmentId: true,
        studentId: true,
        isComplete: true,
        status: true,
        submittedAt: true,
        extendedDueAt: true,
      },
    }),
    // Every check in the program, with this fellow's attempts at each; the window is taken per course.
    db.checkForUnderstanding.findMany({
      where: { resource: { courseUnit: { course: { programId: enrollment.programId } } } },
      select: {
        createdAt: true,
        resource: { select: { courseUnit: { select: { courseId: true } } } },
        attempts: {
          where: { studentId: enrollment.studentId },
          select: { attempt: true, level: true, instructorLevel: true, wantsHelp: true },
        },
      },
    }),
  ]);

  return courses.map((course) => {
    const own = units.filter((unit) => unit.courseId === course.id);
    const grouped = groupByUnit(
      own.flatMap((unit) => unit.assignments),
      own,
    );

    /*
      Released work only, for all three counts, because the units query above includes drafts (the
      verdict tolerates them — `published()` inside the unit machinery filters for itself). A draft
      cannot be handed in, so counting it would only widen the denominator with work the fellow has
      never seen.
    */
    const released = published(workOf(allUnits(grouped)));
    const own_cells = cellsFor(cells, released);

    return {
      id: course.id,
      name: course.name,
      publishedAt: course.publishedAt,
      archivedAt: course.archivedAt,
      verdict:
        courseVerdictByStudent(cells, allUnits(grouped), [enrollment.studentId]).get(
          enrollment.studentId,
        ) ?? "pending",
      completedAssignments: completionByStudent(own_cells, released.length).get(
        enrollment.studentId,
      ) ?? { complete: 0, possible: released.length },
      missing:
        missingByStudent([enrollment.studentId], released, own_cells, at).get(
          enrollment.studentId,
        ) ?? 0,
      late: lateByStudent(own_cells, released).get(enrollment.studentId) ?? 0,
      // Never absent: the map holds an entry for every id it was asked about.
      recent: recentWorkByStudent([enrollment.studentId], released, own_cells, at).get(
        enrollment.studentId,
      )!,
      checks: recentChecks(
        checks.filter((check) => check.resource.courseUnit.courseId === course.id),
      ),
    };
  });
}

/**
 * Where one fellow stands on attendance: the whole-term figures, the last few mornings by the drift
 * rule, when they arrive, and every session day with what was recorded for them on it.
 *
 * **One computation behind the record, its Trends, the coaching form, and the snapshot**, for the
 * reason `courseFiguresFor` is one: two screens computing the same rate separately is two chances
 * to disagree about what counts.
 *
 * A session whose check-in has not opened counts as open, as it does in `attendance.history` and
 * for the same arithmetic. `summarize` leaves an open session out of the denominator for anybody
 * with no record in it, so without this, an instructor making today's code at 8:30 would drop this
 * fellow's rate until somebody pressed start.
 *
 * The arrival averages use only records carrying a `checkedInAt`, with the weekday taken from the
 * session's day rather than from the arrival instant; both rules live in `lib/attendance/arrival.ts`.
 * They are computed from this fellow's records alone, rather than by reusing `attendance.history`,
 * which would fetch a year of records for the whole roster to report on one person.
 *
 * **The day list is what the record's calendar draws, and it is built from the same two reads the
 * figures are.** The instructor's calendar and the figures beside it therefore cannot disagree
 * about which mornings exist or what was recorded on them. It leaves out a prepared session whose
 * check-in never opened, as `attendance.myHistory` does: nobody could have checked in to it, so a
 * square for it would read as a morning this fellow has something to answer for. The figures still
 * see that session, where `summarize` skips it for anybody with no record in it.
 */
export async function attendanceStandingFor(db: Tx, enrollment: EnrollmentKey, at: Date) {
  const [sessions, records] = await Promise.all([
    db.attendanceSession.findMany({
      where: { programId: enrollment.programId },
      orderBy: { date: "asc" },
      select: attendanceSessionSelect,
    }),
    db.attendanceRecord.findMany({
      where: { enrollmentId: enrollment.id },
      select: {
        sessionId: true,
        status: true,
        source: true,
        checkedInAt: true,
        note: true,
        recordedBy: { select: { displayName: true, email: true, githubUsername: true } },
      },
    }),
  ]);

  const states = sessions.map((session) => ({
    ...session,
    day: schoolDayFromColumn(session.date),
    state: sessionStateOf(session, at),
  }));

  const summarySessions = states.map((session) => ({
    id: session.id,
    day: session.day,
    unsettled: stateIsUnsettled(session.state),
  }));

  // Nobody reads the name fields of a one-fellow summary; its counts are what every caller shows.
  const [summary] = summarize(
    summarySessions,
    [
      {
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        displayName: null,
        email: null,
        githubUsername: null,
        testStudentNumber: null,
        enrolledFrom: schoolDayOf(enrollment.createdAt),
      },
    ],
    records.map((record) => ({
      enrollmentId: enrollment.id,
      sessionId: record.sessionId,
      status: record.status,
    })),
  );

  const dayBySession = new Map(summarySessions.map((session) => [session.id, session.day]));
  const recordBySession = new Map(records.map((record) => [record.sessionId, record]));

  return {
    summary,
    /** The last few mornings, by the whole-term drift rule. */
    recentAttendance: recentAttendance(summary, summarySessions),
    arrivals: arrivalAverages(
      records.flatMap((record) => {
        const day = record.checkedInAt ? dayBySession.get(record.sessionId) : undefined;
        return day && record.checkedInAt ? [{ day, checkedInAt: record.checkedInAt }] : [];
      }),
    ),
    /**
     * Every session day with what this fellow's record on it says, oldest first. The shape the
     * fellow's own calendar is drawn from, so an instructor and a fellow see the same square for
     * the same morning.
     */
    days: states
      .filter((session) => session.state !== "pending")
      .map((session) => {
        const record = recordBySession.get(session.id) ?? null;
        return {
          day: session.day,
          status: record?.status ?? null,
          /** Check-in is still accepting codes, so a fellow with no status yet can still get one. */
          open: session.state === "open",
          /** A day the schedule has made that has not come. */
          upcoming: session.state === "scheduled",
          source: record?.source ?? null,
          checkedInAt: record?.checkedInAt ?? null,
          note: record?.note ?? null,
          recordedByName: record?.recordedBy
            ? displayNameOf(record.recordedBy, "an instructor")
            : null,
        };
      }),
  };
}

export type AttendanceStanding = Awaited<ReturnType<typeof attendanceStandingFor>>;

/**
 * The record a completed coaching session stores: where the fellow stood at the moment the
 * conversation ended, in the shape `parseSnapshot` reads back.
 *
 * **Published courses only, deliberately, and it is the one divergence from the record screen.**
 * The snapshot is fellow-visible forever, so an unpublished course's name and figures must not be
 * frozen into it; the instructor's own screen keeps showing every course. Values never diverge —
 * only coverage. Nor does it freeze the Trends readings: those are for the instructor, and the
 * snapshot is what the fellow sees.
 */
export async function assembleSnapshot(
  db: Tx,
  enrollment: EnrollmentKey,
  at: Date,
): Promise<CoachingSnapshot> {
  const [figures, attendance] = await Promise.all([
    courseFiguresFor(db, enrollment, at),
    attendanceStandingFor(db, enrollment, at),
  ]);

  return snapshotOf(figures, attendance, at);
}

/**
 * The snapshot from figures already computed, for a caller that shows those figures as well and
 * should not compute them twice.
 */
export function snapshotOf(
  figures: CourseFigures[],
  attendance: AttendanceStanding,
  at: Date,
): CoachingSnapshot {
  const { summary } = attendance;

  return {
    version: SNAPSHOT_VERSION,
    takenAt: at.toISOString(),
    attendance: {
      eligible: summary.eligible,
      present: summary.present,
      late: summary.late,
      excused: summary.excused,
      absent: summary.absent,
      unrecorded: summary.unrecorded,
      rate: summary.rate,
    },
    courses: figures
      .filter((course) => course.publishedAt !== null)
      .map((course) => ({
        courseId: course.id,
        name: course.name,
        completedAssignments: course.completedAssignments,
        missing: course.missing,
        late: course.late,
        verdict: course.verdict,
      })),
  };
}
