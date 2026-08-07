import "server-only";

import { TRPCError } from "@trpc/server";

import type { db as Db } from "../prisma";

/**
 * Who may read a course, and who may still act in one.
 *
 * **These are two questions, and they are here together on purpose.** A student removed from a
 * cohort keeps reading the feedback they were given — the course stays in their list, labelled,
 * and their released grades stay visible — and cannot accept, submit, or upload anything new.
 * An archived course behaves the same way for everyone in it. So "is this person in this
 * course" has two different right answers depending on why it is being asked.
 *
 * They live in one file, adjacent, because the two `where` clauses differ by one enum value in
 * code that otherwise reads identically. Written out at each call site, the failure is not
 * spotting a difference — it is not noticing there was a decision to make. A new caller has to
 * pick a function, and the names say what picking one means.
 *
 * Neither is a substitute for `assertTeaches`, which is stronger than both: holding the
 * INSTRUCTOR role says nothing about *which* courses, so authoring anything checks the
 * `CourseInstructor` row instead.
 *
 * Both exist because **Prisma is not restricted by row level security.** It connects as the
 * table owner, so without a check in the procedure any signed-in user could read any course by
 * guessing an id.
 */

/** Just enough of the tRPC context to ask, so a caller can pass a transaction as `db`. */
type Ctx = {
  db: typeof Db;
  profile: { id: string; role: string };
};

/** What the caller is to this course, or null when they are nothing to it. */
export type Membership =
  | { as: "admin" }
  | { as: "instructor" }
  | { as: "student"; active: boolean };

/**
 * How the caller is connected to this course, without deciding what that permits.
 *
 * Returned rather than thrown so a screen can render differently — a removed student's course
 * page is readable and says so — while the two assertions below make the refusals.
 */
export async function membershipIn(ctx: Ctx, courseId: string): Promise<Membership | null> {
  if (ctx.profile.role === "ADMIN") return { as: "admin" };

  const [enrollment, instructorRow] = await Promise.all([
    ctx.db.enrollment.findFirst({
      // Every status, deliberately. Which ones *permit* what is the question the two
      // functions below answer; this one only reports.
      where: { courseId, studentId: ctx.profile.id },
      select: { status: true },
    }),
    ctx.db.courseInstructor.findFirst({
      where: { courseId, userId: ctx.profile.id },
      select: { id: true },
    }),
  ]);

  if (instructorRow) return { as: "instructor" };
  if (enrollment) return { as: "student", active: enrollment.status === "ACTIVE" };
  return null;
}

/**
 * Refuses unless the caller may **read** this course.
 *
 * Admits a removed student, which is the whole point: they were shown grades and feedback, and
 * taking those back because they left the cohort is worse than a course they can still open.
 *
 * For reads. Anything that creates or changes a submission wants `assertActiveStudent` below.
 */
export async function assertCourseMember(ctx: Ctx, courseId: string): Promise<Membership> {
  const membership = await membershipIn(ctx, courseId);
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this course.",
    });
  }
  return membership;
}

/**
 * Refuses unless the caller is an **active student** of this course.
 *
 * For `accept`, `submitWork`, the upload route — anything that hands work in. A removed
 * student reaching one of these is told why, rather than being told the assignment does not
 * exist: they can see it, so a refusal that pretends otherwise would read as a bug.
 *
 * An instructor is refused too, and not because of a technicality. Instructors are not
 * students of their own course; one submitting work would create a submission row that appears
 * in their own queue.
 */
export async function assertActiveStudent(ctx: Ctx, courseId: string): Promise<void> {
  const enrollment = await ctx.db.enrollment.findFirst({
    where: { courseId, studentId: ctx.profile.id, status: "ACTIVE" },
    select: { id: true },
  });

  if (enrollment) return;

  // Which of the two refusals this is decides what the message can say, and the difference
  // matters to the person reading it: one is "you left this cohort", which is a fact they can
  // act on, and the other is "you were never in it", which is not.
  const removed = await ctx.db.enrollment.findFirst({
    where: { courseId, studentId: ctx.profile.id, status: "REMOVED" },
    select: { id: true },
  });

  throw new TRPCError({
    code: "FORBIDDEN",
    message: removed
      ? "You are no longer enrolled in this course, so you cannot hand in new work. " +
        "Everything you have already submitted and been given feedback on stays available. " +
        "Ask your instructor if this is wrong."
      : "You are not enrolled in the course this assignment belongs to.",
  });
}

// =======================================================================================
// The same two questions, asked about a cohort's work rather than about the caller
//
// A removed student's submissions are not deleted and are not the cohort's outstanding work.
// So every instructor-facing read of a course's submissions is one of two kinds, and it has to
// know which: a **list of work waiting to be done**, which a departed student contributes
// nothing to, or a **record of what happened**, which they are part of.
//
// Getting it wrong in the first direction leaves a removed student in grading triage forever —
// work nobody will ever do, that cannot be cleared, sitting in the count that says whether an
// instructor is caught up. Getting it wrong in the second direction deletes their history from
// the gradebook, which is the thing that must not happen.
//
// Two helpers rather than one, for the same reason as the pair above: a new reader picks one,
// and the names say what picking means.
// =======================================================================================

/**
 * A `where` fragment on `Submission` restricting it to students currently in the cohort.
 *
 * For the work lists — grading triage, and the counts that have to agree with it. Spread into an
 * existing `where`; it composes with anything because it only constrains the student.
 *
 * Scoped to *this* course on purpose. Enrollment status is per cohort, so asking "is this student
 * active" without naming the course would let a student's enrollment in some other cohort keep
 * their work in this one's triage.
 */
export function activeStudentWork(courseId: string) {
  return { student: { enrollments: { some: { courseId, status: "ACTIVE" as const } } } };
}

/**
 * Which students in this cohort have been removed, for the reads that return both sets.
 *
 * For the reads that return both sets and have to tell them apart — the grading queue, which
 * keeps a removed student out of the pile while still opening one by link. Partitioning one
 * result is what makes the two sets exhaustive: a filter and its complement written as separate
 * queries can each miss a row and nothing would say so.
 *
 * `courses.gradebook` reads the same fact off the roster it already fetched rather than calling
 * this, because it needs every enrollment's status anyway for the Roster tab.
 */
export async function removedStudentIds(
  db: Ctx["db"],
  courseId: string,
): Promise<Set<string>> {
  const removed = await db.enrollment.findMany({
    // Not active, rather than `REMOVED`. This has to be the exact complement of
    // `activeStudentWork` above, or a status that is neither would fall out of both sets — out
    // of the pile and out of the record, which is an absence nothing reports.
    where: { courseId, status: { not: "ACTIVE" } },
    select: { studentId: true },
  });
  return new Set(removed.map((row) => row.studentId));
}
