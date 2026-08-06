import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTRPCRouter, instructorProcedure, profileProcedure } from '../init';

/**
 * Getting students into a course, and out of it.
 *
 * **One join link per course.** An instructor copies it and sends it however they already talk
 * to their students; opening it and signing in with GitHub creates the enrollment. This
 * application holds no email credentials and sends nothing, which is the reason the link is per
 * course rather than per student — there is no point generating twenty-five tokens when
 * distributing them is a person's job either way.
 *
 * What that trades away is the allowlist. Anyone holding the link joins immediately, so the
 * controls are after the fact: `courses.regenerateJoinToken` invalidates a link that reached
 * the wrong person, and `remove` deals with whoever got in.
 *
 * **Removing is a status, never a deleted row.** A student who leaves had submissions, grades,
 * and released feedback, and destroying those to tidy a roster is the worse failure. What
 * removal does is stop them appearing — see `lib/courses/membership.ts` for the two questions
 * that come apart because of it.
 */
export const enrollmentsRouter = createTRPCRouter({
  /**
   * What a join link points at, before anybody joins.
   *
   * So the join screen can say which course this is and who teaches it rather than asking for
   * a decision with no information. `profileProcedure`, because the caller is by definition not
   * yet a member of anything — that is what they are here to change.
   *
   * Returns null rather than throwing on an unknown token, so a stale link reads as "this link
   * no longer works" instead of an error page. It reveals only what somebody holding the link
   * is about to see anyway.
   */
  preview: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { joinToken: input.token },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          archivedAt: true,
          instructors: {
            where: { isPrimary: true },
            take: 1,
            select: { user: { select: { displayName: true } } },
          },
        },
      });

      if (!course) return null;

      const existing = await ctx.db.enrollment.findFirst({
        where: { courseId: course.id, studentId: ctx.profile.id },
        select: { status: true },
      });

      return {
        courseId: course.id,
        name: course.name,
        cohortTerm: course.cohortTerm,
        archived: course.archivedAt !== null,
        primaryInstructor: course.instructors[0]?.user.displayName ?? null,
        /** So the screen can say "you are already in this course" rather than offering to join. */
        alreadyIn: existing?.status ?? null,
      };
    }),

  /**
   * Redeems a join link.
   *
   * **Idempotent**, which is what makes a reusable link safe: `@@unique([courseId, studentId])`
   * means a second redemption returns the enrollment that exists rather than adding another, so
   * a student who opens the link twice — or bookmarks it — is not a problem to handle.
   *
   * `profileProcedure` rather than `studentProcedure`: an instructor or admin holding a link may
   * legitimately want to sit in a cohort, and refusing on the strength of a role would refuse
   * them for no reason. What it does not do is make them a *student* of a course they teach —
   * `assertActiveStudent` refuses an instructor separately, so a submission row can never
   * appear in their own queue.
   */
  join: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { joinToken: input.token },
        select: { id: true, name: true, archivedAt: true },
      });

      /*
        The same message whether the link was never real or has been rotated, because from here
        they are the same fact and telling them apart would say something about a course the
        caller has no connection to.
      */
      if (!course) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message:
            'That join link does not work. It may have been replaced — ask your instructor ' +
            'for the current one.',
        });
      }

      if (course.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${course.name} has finished, so it is not taking new students.`,
        });
      }

      /*
        An instructor of this course is refused rather than enrolled.

        Not a technicality: an enrollment would put them in their own roster and their own
        gradebook, and `accept` would then create a submission that appears in the queue they
        are supposed to be working through. They can already see everything in the course.
      */
      const teaches = await ctx.db.courseInstructor.findFirst({
        where: { courseId: course.id, userId: ctx.profile.id },
        select: { id: true },
      });
      if (teaches) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `You teach ${course.name}, so you are already in it.`,
        });
      }

      const existing = await ctx.db.enrollment.findUnique({
        where: { courseId_studentId: { courseId: course.id, studentId: ctx.profile.id } },
        select: { id: true, status: true },
      });

      /*
        A removed student redeeming again is refused, and this is the one place idempotence
        would be the wrong instinct. If the link let them back in, removing somebody would not
        stick while they still held it, and the instructor's only recourse would be rotating
        the link for the whole cohort. `enrollments.restore` is how somebody comes back.
      */
      if (existing?.status === 'REMOVED') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            `You are no longer enrolled in ${course.name}. Everything you submitted and were ` +
            `given feedback on is still available to you. Ask your instructor if this is wrong.`,
        });
      }

      // Already in, from a link opened twice or a bookmark. Returned rather than refused: they
      // asked to be in the course and they are.
      if (existing) {
        return { courseId: course.id, name: course.name, joined: false };
      }

      await ctx.db.enrollment.create({
        data: { courseId: course.id, studentId: ctx.profile.id },
        select: { id: true },
      });

      return { courseId: course.id, name: course.name, joined: true };
    }),

  /**
   * Removes a student from a cohort.
   *
   * Their work, grades, and released feedback are untouched and stay readable to them; what
   * stops is appearing in the roster's active list, the gradebook, the queue, and the counts,
   * and being able to hand anything else in.
   */
  remove: instructorProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollment = await loadTeachableEnrollment(ctx, input.enrollmentId);

      const updated = await ctx.db.enrollment.update({
        where: { id: input.enrollmentId },
        data: { status: 'REMOVED' },
        select: { id: true, status: true },
      });

      return { ...updated, studentName: enrollment.studentName };
    }),

  /**
   * Puts a removed student back.
   *
   * **The counterpart to redeeming being refused for a removed student**, and the reason that
   * refusal is safe. If rejoining were automatic, removing somebody would not stick while they
   * still held the link, and an instructor's only recourse would be rotating the link for the
   * whole cohort. Coming back is the instructor's action.
   */
  restore: instructorProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollment = await loadTeachableEnrollment(ctx, input.enrollmentId);

      const updated = await ctx.db.enrollment.update({
        where: { id: input.enrollmentId },
        data: { status: 'ACTIVE' },
        select: { id: true, status: true },
      });

      return { ...updated, studentName: enrollment.studentName };
    }),
});

/**
 * The enrollment, if the caller teaches the course it belongs to.
 *
 * Loading the row first is what makes the course-level check possible at all: an enrollment id
 * says nothing about which course it is in until the row is read, so without this an instructor
 * could remove a student from another cohort by id.
 */
async function loadTeachableEnrollment(
  ctx: { db: typeof import('@/lib/prisma').db; profile: { id: string; role: string } },
  enrollmentId: string,
): Promise<{ courseId: string; studentName: string }> {
  const found = await ctx.db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      courseId: true,
      student: { select: { displayName: true, email: true, githubUsername: true } },
    },
  });

  if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Enrollment not found.' });

  if (ctx.profile.role !== 'ADMIN') {
    const teaches = await ctx.db.courseInstructor.findFirst({
      where: { courseId: found.courseId, userId: ctx.profile.id },
      select: { id: true },
    });
    if (!teaches) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not teach this course.' });
    }
  }

  return {
    courseId: found.courseId,
    studentName:
      found.student.displayName ??
      found.student.githubUsername ??
      found.student.email ??
      'that student',
  };
}
