import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isManualOnly } from '@/lib/assignments/spec';
import { undeliveredApprovalWhere } from '@/lib/grade/approve';
import { triageBucket } from '@/lib/grade/triage';

import { createTRPCRouter, instructorProcedure, profileProcedure } from '../init';

export const coursesRouter = createTRPCRouter({
  /**
   * Courses the caller belongs to, either enrolled as a student or listed as an
   * instructor. Admins see every course.
   */
  listMine: profileProcedure.query(async ({ ctx }) => {
    const isAdmin = ctx.profile.role === 'ADMIN';

    const courses = await ctx.db.course.findMany({
      where: isAdmin
        ? { archivedAt: null }
        : {
            archivedAt: null,
            OR: [
              { enrollments: { some: { studentId: ctx.profile.id, status: 'ACTIVE' } } },
              { instructors: { some: { userId: ctx.profile.id } } },
            ],
          },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        cohortTerm: true,
        archivedAt: true,
        moduleStructure: true,
        // Counted here rather than fetched and measured in the interface, so the card
        // does not pull every assignment and enrollment across to say how many there
        // are.
        _count: {
          select: {
            assignments: true,
            enrollments: { where: { status: 'ACTIVE' } },
          },
        },
        // Whether the caller teaches this particular course, which is not the same as
        // their role: an admin teaches none of them but sees all, and an instructor may
        // be enrolled in a course they do not teach. The instructor link on each card
        // reads this rather than the role.
        instructors: {
          where: { userId: ctx.profile.id },
          select: { id: true },
          take: 1,
        },
      },
    });

    return courses.map(({ instructors, ...course }) => ({
      ...course,
      teaches: isAdmin || instructors.length > 0,
    }));
  }),

  /**
   * One course the caller belongs to.
   *
   * Separate from `listMine` because the course screens need the course's modules — the
   * cohort's own module sequence, which is what puts the assignment groups in teaching
   * order rather than alphabetical order — and fetching every course to find one would
   * be the wrong shape.
   */
  get: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          archivedAt: true,
          modules: {
            orderBy: [{ position: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, position: true },
          },
          instructors: { where: { userId: ctx.profile.id }, select: { id: true }, take: 1 },
        },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' });
      }

      const isAdmin = ctx.profile.role === 'ADMIN';

      if (!isAdmin && course.instructors.length === 0) {
        const enrollment = await ctx.db.enrollment.findFirst({
          where: { courseId: course.id, studentId: ctx.profile.id, status: 'ACTIVE' },
          select: { id: true },
        });

        if (!enrollment) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You are not a member of this course.',
          });
        }
      }

      const { instructors, ...rest } = course;

      return { ...rest, teaches: isAdmin || instructors.length > 0 };
    }),

  /**
   * A whole course at once: its assignments, its roster, and every cell where the two
   * meet. Instructors only.
   *
   * The one read in the application that crosses both students and assignments, which is
   * what a gradebook is. Every other instructor procedure is scoped to one assignment or
   * one submission, and building this out of those would be a request per student per
   * assignment.
   *
   * Each cell carries the same `bucket` the triage screen and the grading queue sort on,
   * so the "still to grade" count against an assignment here is the same count that
   * screen shows.
   */
  gradebook: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const teaches =
        ctx.profile.role === 'ADMIN' ||
        (await ctx.db.courseInstructor.findFirst({
          where: { courseId: input.courseId, userId: ctx.profile.id },
          select: { id: true },
        })) !== null;

      if (!teaches) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not teach this course.',
        });
      }

      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          modules: {
            orderBy: [{ position: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, position: true },
          },
        },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' });
      }

      const [assignments, enrollments] = await Promise.all([
        ctx.db.assignment.findMany({
          where: { courseId: course.id },
          orderBy: [{ module: { position: 'asc' } }, { title: 'asc' }],
          select: {
            id: true,
            title: true,
            module: { select: { id: true, name: true, position: true } },
            pointValue: true,
            dueAt: true,
            githubOrg: true,
            kind: true,
            // Read for the grading mode below and not returned. Each cell's bucket depends
            // on whether the pipeline can grade this assignment at all, and asking the
            // assignment once is cheaper than carrying the answer on every cell.
            sections: true,
            // So the course page can mark an unpublished assignment as a draft. A student
            // cannot see it at all; an instructor needs to know why.
            distributedAt: true,
          },
        }),
        ctx.db.enrollment.findMany({
          where: { courseId: course.id, status: { not: 'REMOVED' } },
          orderBy: { invitedEmail: 'asc' },
          select: {
            id: true,
            status: true,
            invitedEmail: true,
            student: {
              select: { id: true, displayName: true, email: true, githubUsername: true },
            },
          },
        }),
      ]);

      const submissions = await ctx.db.submission.findMany({
        where: { assignment: { courseId: course.id } },
        select: {
          id: true,
          assignmentId: true,
          studentId: true,
          status: true,
          isLate: true,
          headSha: true,
          gradedHeadSha: true,
          finalScore: true,
          finalScorePossible: true,
          isComplete: true,
          gradingDrafts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, headSha: true },
          },
        },
      });

      const undelivered = await ctx.db.gradingDraft.findMany({
        where: undeliveredApprovalWhere({ assignment: { courseId: course.id } }),
        select: { submissionId: true },
        distinct: ['submissionId'],
      });
      const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));
      const manualOnlyByAssignment = new Map(
        assignments.map((assignment) => [assignment.id, isManualOnly(assignment.sections)]),
      );

      return {
        course: {
          id: course.id,
          name: course.name,
          cohortTerm: course.cohortTerm,
          modules: course.modules,
        },
        assignments: assignments.map(({ sections, ...assignment }) => ({
          ...assignment,
          /** Whether this assignment is graded by hand, which the header cell shows. */
          manualOnly: isManualOnly(sections),
        })),
        enrollments,
        /**
         * One entry per submission that exists. A student who has not accepted an
         * assignment has no row, and the grid renders that gap as a gap rather than as a
         * zero — never having started is not the same as having scored nothing.
         */
        cells: submissions.map(({ gradingDrafts, ...submission }) => {
          const draft = gradingDrafts[0] ?? null;
          const draftIsStale =
            draft != null && submission.headSha != null && draft.headSha !== submission.headSha;

          return {
            ...submission,
            bucket: triageBucket(
              submission.status,
              draft,
              draftIsStale,
              undeliveredIds.has(submission.id),
              manualOnlyByAssignment.get(submission.assignmentId) ?? false,
            ),
          };
        }),
      };
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
