import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isManualOnly } from '@/lib/assignments/spec';
import { newJoinToken } from '@/lib/courses/join-token';
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

    /*
      Every enrollment status, not just ACTIVE.

      This is the one reader where "admit a removed student" is not the whole answer. Their
      course stays in their list, because they keep reading the feedback they were given — but
      it has to be *labelled*, or it sits there indistinguishable from the cohorts they are
      still in, and a student who cannot tell the difference has been told something false.
      `enrolledAs` below is what the card reads.
    */
    const courses = await ctx.db.course.findMany({
      where: isAdmin
        ? { archivedAt: null }
        : {
            archivedAt: null,
            OR: [
              { enrollments: { some: { studentId: ctx.profile.id } } },
              { instructors: { some: { userId: ctx.profile.id } } },
            ],
          },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        cohortTerm: true,
        archivedAt: true,
        // Counted here rather than fetched and measured in the interface, so the card
        // does not pull every assignment and enrollment across to say how many there
        // are.
        //
        // ACTIVE only, unlike the `where` above: this is "how many students does this cohort
        // have", which a departed one is not the answer to.
        _count: {
          select: {
            assignments: true,
            enrollments: { where: { status: 'ACTIVE' } },
          },
        },
        // The caller's own enrollment, so a card can say they have left this one.
        enrollments: {
          where: { studentId: ctx.profile.id },
          select: { status: true },
          take: 1,
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

    return courses.map(({ instructors, enrollments, ...course }) => ({
      ...course,
      teaches: isAdmin || instructors.length > 0,
      /** Null when the caller is not a student of this course — an instructor, or an admin. */
      enrolledAs: enrollments[0]?.status ?? null,
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
        // Every status, not just ACTIVE: a removed student keeps reading the course and the
        // feedback they were given. Refusing them here is what would take it back.
        const enrollment = await ctx.db.enrollment.findFirst({
          where: { courseId: course.id, studentId: ctx.profile.id },
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
          archivedAt: true,
          /*
            The join link. Safe here and nowhere a student can reach: this procedure is
            `instructorProcedure` *and* teach-gated above, which is the same pair that guards
            the gradebook itself. It must never appear in `get` or `assignments.listForCourse`,
            both of which answer to students — a link in a payload is a link that has leaked.
          */
          joinToken: true,
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
        /*
          Every status, because this one payload feeds two screens with opposite needs.

          The Roster tab has to *show* a removed student — they are who Restore acts on, and
          omitting them would make removal look like deletion. The gradebook must not count
          them, or a departed student reads as somebody with unfinished work forever. So the
          filtering happens where the figures are computed rather than here, and `status` is
          carried on every row so both screens can ask.
        */
        ctx.db.enrollment.findMany({
          where: { courseId: course.id },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            status: true,
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
          archivedAt: course.archivedAt,
          joinToken: course.joinToken,
          modules: course.modules,
        },
        assignments: assignments.map(({ sections, ...assignment }) => ({
          ...assignment,
          /** Whether this assignment is graded by hand, which the header cell shows. */
          manualOnly: isManualOnly(sections),
        })),
        /**
         * Every enrollment, with its status, for the Roster tab.
         *
         * The gradebook uses `activeEnrollments` instead. Two lists rather than one filtered in
         * the interface, because "who is in this cohort" and "whose figures make up this cohort"
         * are different questions, and a component that had to remember which one it was asking
         * would eventually get it wrong.
         */
        enrollments,
        activeEnrollments: enrollments.filter((enrollment) => enrollment.status === 'ACTIVE'),
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

  // =====================================================================================
  // Creating and retiring a cohort
  //
  // Both teach-gate on the course rather than merely requiring the INSTRUCTOR role, except
  // `create`, which has no course to gate on yet — any instructor may start one, because a
  // cohort belongs to whoever runs it.
  // =====================================================================================

  /**
   * Creates a course, optionally copying another one's modules and assignments.
   *
   * **The creator becomes the primary instructor in the same transaction**, and that is not a
   * convenience. Every authoring procedure checks `CourseInstructor` rather than the role, so a
   * course whose row was not written is a course its own creator cannot add anything to — and
   * it looks entirely normal until they try.
   */
  create: instructorProcedure
    .input(z.object({
      name: z.string().trim().min(1, 'A course needs a name.').max(200),
      cohortTerm: z.string().trim().min(1, 'A course needs a term.').max(120),
      /** Copies its modules and, unpublished, its assignments. */
      copyFromCourseId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      /*
        Read before the transaction opens, and only what a copy needs.

        The source has to be a course the caller teaches — copying from one they cannot see
        would let an instructor read another cohort's assignment configuration, including which
        private repository holds its answer keys.
      */
      let source: {
        modules: { name: string; position: number }[];
        assignmentIds: string[];
      } | null = null;

      if (input.copyFromCourseId) {
        const teachesSource =
          ctx.profile.role === 'ADMIN' ||
          (await ctx.db.courseInstructor.findFirst({
            where: { courseId: input.copyFromCourseId, userId: ctx.profile.id },
            select: { id: true },
          })) !== null;

        if (!teachesSource) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You can only copy from a course you teach.',
          });
        }

        const found = await ctx.db.course.findUnique({
          where: { id: input.copyFromCourseId },
          select: {
            modules: { orderBy: { position: 'asc' }, select: { name: true, position: true } },
            assignments: {
              orderBy: [{ module: { position: 'asc' } }, { title: 'asc' }],
              select: { id: true },
            },
          },
        });

        if (!found) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That course does not exist.' });
        }

        source = {
          modules: found.modules,
          assignmentIds: found.assignments.map((assignment) => assignment.id),
        };
      }

      /*
        The course, its instructor row, and its modules in one transaction.

        The assignments are deliberately *outside* it — see below.
      */
      const course = await ctx.db.$transaction(async (tx) => {
        const created = await tx.course.create({
          data: {
            name: input.name,
            cohortTerm: input.cohortTerm,
            joinToken: newJoinToken(),
            instructors: { create: { userId: ctx.profile.id, isPrimary: true } },
          },
          select: { id: true, name: true, cohortTerm: true },
        });

        if (source && source.modules.length > 0) {
          // Names carried across exactly, because `duplicate` matches a module across courses
          // by name and refuses when it finds none. Renaming them is safe *after* the
          // assignments land, since the module id is the identity.
          await tx.module.createMany({
            data: source.modules.map((module) => ({
              courseId: created.id,
              name: module.name,
              position: module.position,
            })),
          });
        }

        return created;
      });

      /*
        Assignments copied one at a time, after the transaction, and not atomically.

        Each one goes through `assignments.duplicate`, which re-validates against the target
        course — both repositories are reached over the network, so twelve assignments is
        twelve rounds of GitHub calls. Holding a database transaction open across that is how
        a pool gets exhausted, and `duplicate` is written to be called this way.
      */
      let copied = 0;
      const failed: { title: string; reason: string }[] = [];

      if (source) {
        const { copyAssignmentInto, copyableAssignmentSelect } = await import('./assignments');

        for (const assignmentId of source.assignmentIds) {
          const original = await ctx.db.assignment.findUnique({
            where: { id: assignmentId },
            select: copyableAssignmentSelect,
          });
          if (!original) continue;

          try {
            await copyAssignmentInto(ctx.db, {
              source: original,
              targetCourseId: course.id,
              dueAt: null,
            });
            copied += 1;
          } catch (err) {
            /*
              Reported rather than rolled back, and the course keeps the ones that worked.

              An assignment can legitimately fail to copy — a template repository made private
              since last term, an answer key folder renamed upstream — and discarding a whole
              new cohort because one of twelve needs attention would be the wrong trade. The
              instructor is told which, and adds those by hand.
            */
            failed.push({
              title: original.title,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      return { course, copied, failed };
    }),

  /**
   * Retires a cohort, or brings it back.
   *
   * The course leaves every active list and stays readable to the people who were in it;
   * nothing new can be submitted, and its submissions leave triage and the grading queue.
   * Reversible on purpose — a tidying action that cannot be undone gets avoided rather than
   * used, and an instructor who archives the wrong cohort should not need the database.
   */
  setArchived: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertTeachesCourse(ctx, input.courseId);

      return ctx.db.course.update({
        where: { id: input.courseId },
        data: { archivedAt: input.archived ? new Date() : null },
        select: { id: true, name: true, archivedAt: true },
      });
    }),

  /**
   * Replaces the join link, invalidating the old one.
   *
   * **The only control over who can use it.** Anyone holding the link joins immediately, so a
   * link that reached the wrong person is dealt with by replacing it and removing whoever got
   * in. Students already enrolled are unaffected — the token is how you *join*, not how you
   * stay.
   */
  regenerateJoinToken: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTeachesCourse(ctx, input.courseId);

      return ctx.db.course.update({
        where: { id: input.courseId },
        data: { joinToken: newJoinToken() },
        select: { id: true, joinToken: true },
      });
    }),
});

/** Refuses unless the caller teaches this course. Admins teach none and may do anything. */
async function assertTeachesCourse(
  ctx: { db: typeof import('@/lib/prisma').db; profile: { id: string; role: string } },
  courseId: string,
): Promise<void> {
  if (ctx.profile.role === 'ADMIN') return;

  const teaches = await ctx.db.courseInstructor.findFirst({
    where: { courseId, userId: ctx.profile.id },
    select: { id: true },
  });

  if (!teaches) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not teach this course.' });
  }
}
