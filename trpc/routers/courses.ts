import { z } from 'zod';

import { createTRPCRouter, instructorProcedure, profileProcedure } from '../init';

export const coursesRouter = createTRPCRouter({
  /**
   * Courses the caller belongs to, either enrolled as a student or listed as an
   * instructor. Admins see every course.
   */
  listMine: profileProcedure.query(async ({ ctx }) => {
    if (ctx.profile.role === 'ADMIN') {
      return ctx.db.course.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    }

    return ctx.db.course.findMany({
      where: {
        archivedAt: null,
        OR: [
          { enrollments: { some: { studentId: ctx.profile.id, status: 'ACTIVE' } } },
          { instructors: { some: { userId: ctx.profile.id } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  /** Roster for one course. Instructors only. */
  roster: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // An instructor may only read the roster of a course they teach. Admins may
      // read any. Without this an instructor could read another cohort's roster.
      const teaches =
        ctx.profile.role === 'ADMIN' ||
        (await ctx.db.courseInstructor.findFirst({
          where: { courseId: input.courseId, userId: ctx.profile.id },
          select: { id: true },
        })) !== null;

      if (!teaches) return null;

      return ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          instructors: {
            select: {
              isPrimary: true,
              user: { select: { id: true, displayName: true, email: true, githubUsername: true } },
            },
          },
          enrollments: {
            orderBy: { invitedEmail: 'asc' },
            select: {
              id: true,
              status: true,
              invitedEmail: true,
              student: {
                select: { id: true, displayName: true, email: true, githubUsername: true },
              },
            },
          },
        },
      });
    }),
});
