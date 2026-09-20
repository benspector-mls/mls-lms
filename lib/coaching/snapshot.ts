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
  type Completion,
} from "@/lib/gradebook/summary";
import type { Tx } from "@/lib/prisma";

import { SNAPSHOT_VERSION, type CoachingSnapshot } from "../coaching";
import { summarize } from "../attendance/summary";
import { sessionStateOf } from "../attendance/window";
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
};

/**
 * One fellow's standing in every course of a program: the figures the gradebook Overview shows,
 * for one person.
 *
 * **The one computation behind three surfaces.** The program student record renders this, the
 * coaching session form's strip renders it as "what will be recorded", and `assembleSnapshot`
 * below freezes it into a completed session — so the screen, the strip, and the stored snapshot
 * cannot disagree, because they are this function called three times. Every figure goes through
 * the exact functions the gradebook itself uses.
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
  const [courses, units, cells] = await Promise.all([
    db.course.findMany({
      where: { programId: enrollment.programId },
      orderBy: [{ createdAt: "asc" }],
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
    };
  });
}

/**
 * The record a completed coaching session stores: where the fellow stood at the moment the
 * conversation ended, in the shape `parseSnapshot` reads back.
 *
 * **Published courses only, deliberately, and it is the one divergence from the record screen.**
 * The snapshot is fellow-visible forever, so an unpublished course's name and figures must not be
 * frozen into it; the instructor's own screen keeps showing every course. Values never diverge —
 * only coverage.
 *
 * The attendance block shapes its sessions the way `programs.student` and `attendance.history`
 * do, because `summarize` is the shared seam and each call site supplies what its screen counts:
 * a session whose check-in has not opened counts as open, so a code made at 8:30 does not drop
 * the rate until somebody presses start.
 */
export async function assembleSnapshot(
  db: Tx,
  enrollment: EnrollmentKey,
  at: Date,
): Promise<CoachingSnapshot> {
  const [figures, sessions, records] = await Promise.all([
    courseFiguresFor(db, enrollment, at),
    db.attendanceSession.findMany({
      where: { programId: enrollment.programId },
      orderBy: { date: "asc" },
      select: attendanceSessionSelect,
    }),
    db.attendanceRecord.findMany({
      where: { enrollmentId: enrollment.id },
      select: { sessionId: true, status: true },
    }),
  ]);

  const summarySessions = sessions.map((session) => {
    const state = sessionStateOf(session, at);
    return {
      id: session.id,
      day: schoolDayFromColumn(session.date),
      open: state === "open" || state === "pending",
    };
  });

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
