import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTRPCRouter, instructorProcedure, profileProcedure } from '../init';

export const submissionsRouter = createTRPCRouter({
  /** Every submission belonging to the caller, newest activity first. */
  mine: profileProcedure.query(async ({ ctx }) =>
    ctx.db.submission.findMany({
      // Scoped to the caller. Prisma bypasses row level security, so this where
      // clause is the only thing preventing one student from reading another's
      // submissions.
      where: { studentId: ctx.profile.id },
      orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        repoUrl: true,
        prUrl: true,
        prNumber: true,
        submittedAt: true,
        isLate: true,
        finalScore: true,
        finalScorePossible: true,
        isComplete: true,
        // The graded feedback, read straight from the submission. There is no separate
        // publish step: approving is what makes these columns non-null, and this page
        // shows them from that moment.
        feedbackMarkdown: true,
        gradedAt: true,
        headSha: true,
        gradedHeadSha: true,
        assignment: { select: { id: true, title: true, moduleTag: true, dueAt: true } },
      },
    }),
  ),

  /**
   * A student declaring that revised work is ready for another look.
   *
   * The deliberate half of resubmission. A push is recorded automatically and means
   * only that newer code exists; students commit while they work and a commit is not a
   * claim of completion. This is the act that says "look again", and it is what
   * distinguishes a student still working from one who finished and is waiting.
   */
  declareResubmission: profileProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await ctx.db.submission.findUnique({
        where: { id: input.submissionId },
        select: { id: true, studentId: true, status: true, headSha: true, gradedHeadSha: true },
      });

      if (!submission) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found.' });
      }

      // Scoped to the caller's own submission. Prisma bypasses row level security, so
      // this comparison is the only thing stopping one student acting on another's.
      if (submission.studentId !== ctx.profile.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This is not your submission.' });
      }

      if (submission.status !== 'GRADED' && submission.status !== 'RESUBMITTED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This submission has not been graded yet, so there is nothing to resubmit. ' +
            'Your work is already in the queue.',
        });
      }

      // Nothing new to look at. Told plainly rather than accepted quietly, because a
      // student who pressed this expecting to send something would otherwise wait on a
      // review of the code that was already graded.
      if (submission.headSha && submission.headSha === submission.gradedHeadSha) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'No new commits since this was graded. Push your changes first, then ' +
            'declare it ready.',
        });
      }

      return ctx.db.submission.update({
        where: { id: submission.id },
        data: { status: 'RESUBMITTED', lastActivityAt: new Date() },
        select: { id: true, status: true },
      });
    }),

  /**
   * Every submission for one assignment. Instructors only.
   *
   * This is the one procedure that deliberately reads across students, which is
   * why it is gated on the caller teaching the course rather than on
   * `instructorProcedure` alone.
   */
  listForAssignment: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { id: true, title: true, courseId: true, dueAt: true },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      }

      const teaches =
        ctx.profile.role === 'ADMIN' ||
        (await ctx.db.courseInstructor.findFirst({
          where: { courseId: assignment.courseId, userId: ctx.profile.id },
          select: { id: true },
        })) !== null;

      if (!teaches) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not teach the course this assignment belongs to.',
        });
      }

      const submissions = await ctx.db.submission.findMany({
        where: { assignmentId: assignment.id },
        orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
        select: {
          id: true,
          status: true,
          repoFullName: true,
          repoUrl: true,
          prUrl: true,
          prNumber: true,
          headSha: true,
          submittedAt: true,
          isLate: true,
          lastActivityAt: true,
          // The grade, and the commit it describes. `headSha !== gradedHeadSha` is how
          // the queue shows that a student has pushed since being graded — two columns,
          // no API call, true the instant the push lands.
          finalScore: true,
          finalScorePossible: true,
          isComplete: true,
          gradedAt: true,
          gradedHeadSha: true,
          student: { select: { id: true, displayName: true, email: true, githubUsername: true } },
        },
      });

      return { assignment, submissions };
    }),
});
