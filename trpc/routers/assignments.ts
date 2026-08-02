import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  getConfiguredInstallationId,
  isGithubAppConfigured,
} from '@/lib/github/app-client';
import {
  addCollaborator,
  generateRepoFromTemplate,
  getRepo,
  removeClassroomWorkflow,
} from '@/lib/github/repos';

import { createTRPCRouter, profileProcedure, studentProcedure } from '../init';

/** Columns of an assignment that are safe to send to any enrolled member. */
const assignmentFields = {
  id: true,
  title: true,
  moduleTag: true,
  pointValue: true,
  completionThreshold: true,
  dueAt: true,
  assignmentRepoName: true,
  distributedAt: true,
  courseId: true,
} as const;

/**
 * Whether the caller is connected to a course, either enrolled or teaching.
 *
 * Pulled out because every course-scoped read needs it and Prisma is not restricted by
 * row level security: without this check any signed-in user could read any course by
 * guessing an id.
 */
async function assertCourseMember(
  ctx: { db: typeof import('@/lib/prisma').db; profile: { id: string; role: string } },
  courseId: string,
) {
  if (ctx.profile.role === 'ADMIN') return;

  const [enrollment, instructorRow] = await Promise.all([
    ctx.db.enrollment.findFirst({
      where: { courseId, studentId: ctx.profile.id, status: 'ACTIVE' },
      select: { id: true },
    }),
    ctx.db.courseInstructor.findFirst({
      where: { courseId, userId: ctx.profile.id },
      select: { id: true },
    }),
  ]);

  if (!enrollment && !instructorRow) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of this course.',
    });
  }
}

export const assignmentsRouter = createTRPCRouter({
  /**
   * One assignment and the course it belongs to.
   *
   * Exists for the places that hold an assignment id and nothing else — the breadcrumb
   * over the grading queue is the first — where fetching every assignment in the course
   * to find one would be the wrong shape.
   */
  get: profileProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          ...assignmentFields,
          course: { select: { id: true, name: true, cohortTerm: true } },
        },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      }

      await assertCourseMember(ctx, assignment.courseId);
      return assignment;
    }),

  /**
   * Assignments for one course, with the caller's own submission attached.
   *
   * Access is restricted to people connected to the course: an enrolled student
   * or a listed instructor. Without that check any signed-in user could read any
   * course's assignments by guessing an id, because Prisma is not restricted by
   * row level security.
   */
  listForCourse: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);

      return ctx.db.assignment.findMany({
        where: { courseId: input.courseId },
        select: {
          ...assignmentFields,
          submissions: {
            // Scoped to the caller so a student never sees another student's
            // submission through this procedure.
            where: { studentId: ctx.profile.id },
            select: {
              id: true,
              status: true,
              repoUrl: true,
              prUrl: true,
              submittedAt: true,
              isLate: true,
              // The grade, read straight from the submission. Approving is what makes
              // these non-null, and this page shows them from that moment — there is
              // no separate publish step for a student to wait on.
              finalScore: true,
              finalScorePossible: true,
              isComplete: true,
              feedbackMarkdown: true,
              gradedAt: true,
              headSha: true,
              gradedHeadSha: true,
              // Earlier rounds of feedback, oldest first. A student who resubmits gets
              // a second report describing different work rather than an edit of the
              // first, and reading them in order is what shows what changed. Collapsed
              // in the interface, never discarded.
              gradingDrafts: {
                where: { status: 'APPROVED' },
                orderBy: { approvedAt: 'asc' },
                select: {
                  id: true,
                  approvedAt: true,
                  headSha: true,
                  sections: {
                    select: {
                      sectionType: true,
                      reportMarkdown: true,
                      scoreEarned: true,
                      scorePossible: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ moduleTag: 'asc' }, { assignmentRepoName: 'asc' }],
      });
    }),

  /**
   * Accepts an assignment: creates the student's repository from the template,
   * grants access, removes the legacy Classroom workflow, and records the
   * submission.
   *
   * Ordering note: the repository is created before the submission row is
   * written, because the row stores the repository's URL. That means a failure
   * partway through can leave a repository on GitHub with no matching row. The
   * recovery for that is below — an existing repository is reused rather than
   * treated as an error.
   */
  accept: studentProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const student = ctx.profile;

      if (!student.githubUsername) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Link your GitHub account before accepting an assignment. Your repository is named after your GitHub username.',
        });
      }

      if (!isGithubAppConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'The GitHub App is not configured on this deployment. See the GitHub App setup section of the README.',
        });
      }

      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          id: true,
          courseId: true,
          templateRepo: true,
          assignmentRepoName: true,
          githubOrg: true,
        },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      }

      // Enrollment is checked here as well as in listForCourse, because a
      // mutation must never rely on the caller having gone through a particular
      // query first.
      const enrollment = await ctx.db.enrollment.findFirst({
        where: { courseId: assignment.courseId, studentId: student.id, status: 'ACTIVE' },
        select: { id: true },
      });

      if (!enrollment) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not enrolled in the course this assignment belongs to.',
        });
      }

      // Already accepted. Return the existing submission rather than creating a
      // second repository.
      const existing = await ctx.db.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
      });
      if (existing?.repoFullName) {
        return existing;
      }

      const installationId = getConfiguredInstallationId();
      const repoName = `${assignment.assignmentRepoName}-${student.githubUsername}`;
      const [templateOwner, templateRepoName] = assignment.templateRepo.split('/');

      if (!templateOwner || !templateRepoName) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Assignment templateRepo must be in "owner/repo" form, got "${assignment.templateRepo}".`,
        });
      }

      // A repository with this name can already exist on GitHub without a
      // matching submission row: a previous attempt may have created the
      // repository and then failed before the database write, or a local reseed
      // may have cleared submissions without touching GitHub. Reuse it instead of
      // failing on the name collision.
      let repo;
      try {
        repo = await generateRepoFromTemplate(installationId, {
          templateOwner,
          templateRepo: templateRepoName,
          owner: assignment.githubOrg,
          name: repoName,
        });
      } catch (err) {
        const existingRepo = await getRepo(installationId, {
          owner: assignment.githubOrg,
          repo: repoName,
        });
        if (!existingRepo) throw err;
        repo = existingRepo;
      }

      await addCollaborator(installationId, {
        owner: assignment.githubOrg,
        repo: repoName,
        username: student.githubUsername,
        permission: 'push',
      });

      // Every instructor on the course is added, so no repository ever needs
      // manual permission changes.
      const instructors = await ctx.db.courseInstructor.findMany({
        where: { courseId: assignment.courseId },
        select: { user: { select: { githubUsername: true, email: true } } },
      });

      for (const { user } of instructors) {
        if (!user.githubUsername) {
          // An instructor who has not linked GitHub cannot be added. This must
          // not fail the student's accept — they would be blocked by someone
          // else's incomplete setup.
          console.warn(
            `accept: skipping collaborator invite for ${user.email ?? 'an instructor'} — no GitHub account linked`,
          );
          continue;
        }
        await addCollaborator(installationId, {
          owner: assignment.githubOrg,
          repo: repoName,
          username: user.githubUsername,
          permission: 'push',
        });
      }

      await removeClassroomWorkflow(installationId, {
        owner: assignment.githubOrg,
        repo: repoName,
      });

      const repoFullName = `${assignment.githubOrg}/${repoName}`;

      return ctx.db.submission.upsert({
        where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
        create: {
          assignmentId: assignment.id,
          studentId: student.id,
          status: 'ACCEPTED',
          repoFullName,
          repoUrl: repo.html_url,
          repoGithubLoginAtCreation: student.githubUsername,
        },
        update: {
          status: 'ACCEPTED',
          repoFullName,
          repoUrl: repo.html_url,
          repoGithubLoginAtCreation: student.githubUsername,
        },
      });
    }),
});
