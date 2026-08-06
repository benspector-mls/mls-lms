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
