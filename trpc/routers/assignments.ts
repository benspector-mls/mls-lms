import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  assertKindImplemented,
  copyUrlFromTemplate,
  NotRepositoryBackedError,
  repositorySource,
  UnsupportedAssignmentKindError,
} from '@/lib/assignments/spec';
import {
  hasErrors,
  validateAssignmentDraft,
  type ValidationFinding,
} from '@/lib/assignments/validate';
import { effectiveSection } from '@/lib/grade/approve';
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

import { createTRPCRouter, instructorProcedure, profileProcedure, studentProcedure } from '../init';

/** Columns of an assignment that are safe to send to any enrolled member. */
const assignmentFields = {
  id: true,
  kind: true,
  title: true,
  moduleTag: true,
  pointValue: true,
  completionThreshold: true,
  dueAt: true,
  assignmentRepoName: true,
  distributedAt: true,
  courseId: true,
  // Both student-facing. The template document is what Accept sends them to a copy of, and
  // the instructions are what the assignment says about turning it in.
  templateDocUrl: true,
  submissionInstructions: true,
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

/**
 * Whether the caller *teaches* this course, which is stronger than being a member of it.
 *
 * Every authoring procedure needs this rather than `assertCourseMember`: an enrolled student
 * is a member, and holding the INSTRUCTOR role says nothing about *which* courses. Without
 * the course-level check, one cohort's instructor could author or delete assignments in
 * another's.
 */
async function assertTeaches(
  ctx: { db: typeof import('@/lib/prisma').db; profile: { id: string; role: string } },
  courseId: string,
) {
  if (ctx.profile.role === 'ADMIN') return;

  const teaches = await ctx.db.courseInstructor.findFirst({
    where: { courseId, userId: ctx.profile.id },
    select: { id: true },
  });

  if (!teaches) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not teach this course.' });
  }
}

/** Refuses a draft that would not grade correctly, naming the fields. */
function refuseOnErrors(findings: ValidationFinding[]): void {
  if (!hasErrors(findings)) return;
  const errors = findings.filter((finding) => finding.severity === 'error');
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message:
      `This assignment cannot be saved as it stands:\n` +
      errors.map((finding) => `  ${finding.path}: ${finding.message}`).join('\n'),
    cause: findings,
  });
}

/** The columns an authored assignment writes. Shared so create and update cannot drift. */
function writableFields(spec: NonNullable<Awaited<ReturnType<typeof validateAssignmentDraft>>['spec']>, pointValue: number) {
  return {
    kind: spec.kind,
    title: spec.title,
    moduleTag: spec.moduleTag,
    pointValue,
    completionThreshold: spec.completionThreshold,
    dueAt: spec.dueAt,
    templateRepo: spec.templateRepo,
    assignmentRepoName: spec.assignmentRepoName,
    githubOrg: spec.githubOrg,
    templateRef: spec.templateRef,
    runnerPreset: spec.runnerPreset,
    runnerConfig: (spec.runnerConfig ?? null) as never,
    // Both null on a REPO assignment and both spelled out anyway. Every field of the spec
    // appears here, because a key left out of this object is not a compile error — it is a
    // column that silently keeps its old value on update and its default on create, which
    // for `templateDocUrl` would be a Google Doc assignment with nothing to distribute.
    templateDocUrl: spec.templateDocUrl,
    submissionInstructions: spec.submissionInstructions,
    sections: spec.sections as never,
  };
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

      /*
        An unpublished assignment is invisible to a student and visible to an instructor.

        `distributedAt` already meant this and was read by nothing. It is what makes
        authoring safe: an assignment can be built over several sittings, and a section
        mapping corrected, without a student seeing a half-finished one or accepting an
        assignment whose answer keys are still wrong.
      */
      const teaches =
        ctx.profile.role === 'ADMIN' ||
        (await ctx.db.courseInstructor.findFirst({
          where: { courseId: input.courseId, userId: ctx.profile.id },
          select: { id: true },
        })) !== null;

      const assignments = await ctx.db.assignment.findMany({
        where: {
          courseId: input.courseId,
          ...(teaches ? {} : { distributedAt: { not: null } }),
        },
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
              // Where the work is when there is no repository: the student's own copy of a
              // document, which is the only link either side has to it.
              submittedUrl: true,
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
                      // Both columns, because what the student is owed is the instructor's
                      // revision where one exists. They are collapsed below and never
                      // leave this procedure separately.
                      editedReportMarkdown: true,
                      editedScoreEarned: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ moduleTag: 'asc' }, { assignmentRepoName: 'asc' }],
      });

      /*
        Collapsed to the effective values before leaving the server.

        An instructor's edit is what was posted to the pull request and what the gradebook
        recorded, so it is the only version a student may be shown. Reading the model's
        raw output straight out of the column — which this procedure did — showed them
        text their instructor had already corrected.

        Done here rather than in the interface, and by the same `effectiveSection` the
        approval path uses to build the comment, so the two cannot disagree about which
        version won. It also means the model's unedited output never travels to a
        student's browser at all: it is instructor-facing evidence, and there is no
        student-facing question it answers.
      */
      return assignments.map((assignment) => ({
        ...assignment,
        submissions: assignment.submissions.map((submission) => ({
          ...submission,
          gradingDrafts: submission.gradingDrafts.map((draft) => ({
            ...draft,
            sections: draft.sections.map(effectiveSection),
          })),
        })),
      }));
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

      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          id: true,
          courseId: true,
          kind: true,
          templateRepo: true,
          assignmentRepoName: true,
          githubOrg: true,
          templateDocUrl: true,
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

      /*
        What accepting *is* depends on the kind, and this is where that stops being
        incidental.

        For a Google Doc it is being sent to Google's own copy prompt: no repository, no
        collaborators, no credentials, and nothing created on this side beyond the row
        recording that the student started. For a repository it is generating one from the
        template, which is everything below. FILE_UPLOAD reaches neither — it has no Accept
        at all, because there is nothing to hand out, and the refusal below is what a request
        arriving anyway is answered with.
      */
      if (assignment.kind === 'GOOGLE_DOC') {
        if (!assignment.templateDocUrl) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'This assignment has no template document, so there is nothing to copy. ' +
              'Contact your instructor.',
          });
        }

        // Upserted rather than created, so pressing Accept twice is the same as pressing it
        // once: the copy prompt is idempotent on Google's side too — a second press makes a
        // second copy, which is the student's business and not a state this owns.
        const submission = await ctx.db.submission.upsert({
          where: {
            assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id },
          },
          create: {
            assignmentId: assignment.id,
            studentId: student.id,
            status: 'ACCEPTED',
            lastActivityAt: new Date(),
          },
          update: {},
        });

        return { submission, copyUrl: copyUrlFromTemplate(assignment.templateDocUrl) };
      }

      if (assignment.kind === 'FILE_UPLOAD') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'This assignment is not accepted — there is nothing to hand out. Upload your ' +
            'work and submit it when you are ready.',
        });
      }

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

      let source;
      try {
        source = repositorySource(assignment);
      } catch (err) {
        // Worded for the person who hits it rather than for a stack trace. Reaching this
        // with a kind that has no repository means the branches above missed one, which is a
        // defect rather than something a student can act on; a misconfigured REPO row is the
        // ordinary case, where an instructor set up the assignment without a template, org,
        // or repository name.
        if (err instanceof NotRepositoryBackedError || err instanceof UnsupportedAssignmentKindError) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This assignment is not accepted this way. Contact your instructor.',
            cause: err,
          });
        }
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Source repository not found for this assignment. Contact your instructor.',
          cause: err,
        });
      }

      // Already accepted. Return the existing submission rather than creating a
      // second repository.
      const existing = await ctx.db.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
      });
      if (existing?.repoFullName) {
        return { submission: existing, copyUrl: null };
      }

      const installationId = getConfiguredInstallationId();
      const repoName = `${source.assignmentRepoName}-${student.githubUsername}`;
      const [templateOwner, templateRepoName] = source.templateRepo.split('/');

      if (!templateOwner || !templateRepoName) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Assignment templateRepo must be in "owner/repo" form, got "${source.templateRepo}".`,
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
          owner: source.githubOrg,
          name: repoName,
        });
      } catch (err) {
        const existingRepo = await getRepo(installationId, {
          owner: source.githubOrg,
          repo: repoName,
        });
        if (!existingRepo) throw err;
        repo = existingRepo;
      }

      await addCollaborator(installationId, {
        owner: source.githubOrg,
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
          owner: source.githubOrg,
          repo: repoName,
          username: user.githubUsername,
          permission: 'push',
        });
      }

      await removeClassroomWorkflow(installationId, {
        owner: source.githubOrg,
        repo: repoName,
      });

      const repoFullName = `${source.githubOrg}/${repoName}`;

      const submission = await ctx.db.submission.upsert({
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

      // The same shape every kind returns, so the button has one result to handle rather
      // than a union it has to narrow. Null here because a repository is opened from the
      // row's own link, not by being sent somewhere on acceptance.
      return { submission, copyUrl: null };
    }),
  // =====================================================================================
  // Authoring
  //
  // All of these teach-gate on the course rather than merely requiring the INSTRUCTOR
  // role, and all of them write through `validateAssignmentDraft`, which is the same
  // function the form calls as fields change. The interface warns; these refuse.
  // =====================================================================================

  /**
   * Everything the authoring form needs to open, in one request.
   *
   * The module list, the rubrics, and the organization its siblings use. Bundled rather than
   * fetched separately because the form cannot render its first question without the module
   * list, and a form that appears one field at a time as three requests land reads as broken.
   */
  authoringContext: instructorProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      const [course, rubrics, siblings] = await Promise.all([
        ctx.db.course.findUnique({
          where: { id: input.courseId },
          select: { id: true, name: true, cohortTerm: true, moduleStructure: true },
        }),
        ctx.db.rubric.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        ctx.db.assignment.findMany({
          where: { courseId: input.courseId, githubOrg: { not: null } },
          select: { githubOrg: true },
          take: 50,
        }),
      ]);

      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' });

      // Whatever this course's other assignments use. An instructor typing an organization
      // name is a way to get it subtly wrong for one assignment out of twelve.
      const orgCounts = new Map<string, number>();
      for (const sibling of siblings) {
        if (sibling.githubOrg) {
          orgCounts.set(sibling.githubOrg, (orgCounts.get(sibling.githubOrg) ?? 0) + 1);
        }
      }
      const defaultGithubOrg =
        [...orgCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        course: {
          id: course.id,
          name: course.name,
          cohortTerm: course.cohortTerm,
          moduleStructure: Array.isArray(course.moduleStructure)
            ? (course.moduleStructure as unknown[]).filter(
                (tag): tag is string => typeof tag === 'string',
              )
            : [],
        },
        rubrics,
        defaultGithubOrg,
      };
    }),

  /**
   * One assignment in the shape the authoring form edits.
   *
   * Separate from `get`, which returns what any course member may see. This returns the
   * section mapping and the GitHub configuration, which are instructor-only, and it reports
   * whether anybody has accepted — the form disables the repository name when they have,
   * rather than letting an instructor type a change the procedure will refuse.
   */
  getDraft: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          id: true,
          courseId: true,
          kind: true,
          title: true,
          moduleTag: true,
          pointValue: true,
          completionThreshold: true,
          dueAt: true,
          distributedAt: true,
          templateRepo: true,
          assignmentRepoName: true,
          githubOrg: true,
          templateRef: true,
          runnerPreset: true,
          runnerConfig: true,
          templateDocUrl: true,
          submissionInstructions: true,
          sections: true,
          _count: { select: { submissions: true } },
        },
      });

      if (!assignment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      await assertTeaches(ctx, assignment.courseId);

      const { _count, ...rest } = assignment;
      return { ...rest, submissionCount: _count.submissions };
    }),

  /**
   * What the form calls as fields change. No writes.
   *
   * Returns every finding rather than the first, so an instructor fixes one round of
   * problems instead of discovering them one at a time, and returns the point total the
   * sections imply so the form does not compute it a second way.
   */
  validateDraft: instructorProcedure
    .input(z.object({
      courseId: z.string().uuid(),
      assignmentId: z.string().uuid().optional(),
      draft: z.unknown(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);
      const { findings, pointValue } = await validateAssignmentDraft(ctx.db, input);
      return { findings, pointValue, canSave: !hasErrors(findings) };
    }),

  /** The answer keys the curriculum holds for one assignment, for the form to offer. */
  answerKeyOptions: instructorProcedure
    .input(z.object({
      courseId: z.string().uuid(),
      moduleTag: z.string().min(1),
      repoName: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);
      const { listAnswerKeys } = await import('@/lib/grade/assets');
      return { paths: await listAnswerKeys(input.moduleTag, input.repoName) };
    }),

  /** Which assignments the curriculum contains for a module, and which are already added. */
  catalogue: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), moduleTag: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);
      const { listAssignmentDirs } = await import('@/lib/grade/assets');

      const [available, existing] = await Promise.all([
        listAssignmentDirs(input.moduleTag),
        ctx.db.assignment.findMany({
          where: { courseId: input.courseId, moduleTag: input.moduleTag },
          select: { assignmentRepoName: true },
        }),
      ]);

      const added = new Set(existing.map((row) => row.assignmentRepoName));
      // Marked rather than filtered out: an instructor looking for an assignment they
      // already added should see that it is there, not wonder why it is missing.
      return { assignments: available.map((name) => ({ name, alreadyAdded: added.has(name) })) };
    }),

  /**
   * What the template repository says about how it runs, so the form does not ask.
   *
   * Called when an assignment is chosen from the catalogue. Returns the reason as well as the
   * preset, because an inference an instructor cannot check is one they have to trust blindly.
   */
  inferFromTemplate: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), templateRepo: z.string().min(3) }))
    .query(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);
      const { detectRunnerPreset } = await import('@/lib/assignments/detect');
      return detectRunnerPreset(input.templateRepo);
    }),

  /**
   * Creates an assignment, unpublished.
   *
   * `pointValue` comes from the validated spec rather than from input, so there is no
   * request that can make the gradebook column disagree with the sections beneath it.
   */
  create: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), draft: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      const { findings, spec, pointValue } = await validateAssignmentDraft(ctx.db, input);
      refuseOnErrors(findings);
      if (!spec || pointValue === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That draft is not an assignment.' });
      }

      assertKindImplemented(spec.kind);

      const assignment = await ctx.db.assignment.create({
        data: {
          courseId: input.courseId,
          distributedAt: null,
          ...writableFields(spec, pointValue),
        },
        select: assignmentFields,
      });

      return { assignment, warnings: findings.filter((f) => f.severity === 'warning') };
    }),

  /**
   * Edits an assignment.
   *
   * Refuses to change `assignmentRepoName` once anybody has accepted, because student
   * repositories are already named after it: renaming it here would not rename theirs, and
   * every later lookup would miss.
   */
  update: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid(), draft: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          courseId: true,
          assignmentRepoName: true,
          _count: { select: { submissions: true } },
        },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      await assertTeaches(ctx, existing.courseId);

      const { findings, spec, pointValue } = await validateAssignmentDraft(ctx.db, {
        courseId: existing.courseId,
        assignmentId: input.assignmentId,
        draft: input.draft,
      });
      refuseOnErrors(findings);
      if (!spec || pointValue === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That draft is not an assignment.' });
      }

      if (
        existing._count.submissions > 0 &&
        spec.assignmentRepoName !== existing.assignmentRepoName
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            `${existing._count.submissions} student(s) have already accepted this assignment, ` +
            `and their repositories are named after "${existing.assignmentRepoName}". ` +
            `Renaming it here would not rename theirs. Create a new assignment instead.`,
        });
      }

      const assignment = await ctx.db.assignment.update({
        where: { id: input.assignmentId },
        data: writableFields(spec, pointValue),
        select: assignmentFields,
      });

      return { assignment, warnings: findings.filter((f) => f.severity === 'warning') };
    }),

  /** Makes an assignment visible to students. Validated again, because publishing is the
   * moment it stops being private — a draft saved with warnings should not become live
   * without them being seen a second time. */
  publish: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { courseId: true, distributedAt: true },
      });
      if (!assignment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      await assertTeaches(ctx, assignment.courseId);

      return ctx.db.assignment.update({
        where: { id: input.assignmentId },
        data: { distributedAt: assignment.distributedAt ?? new Date() },
        select: assignmentFields,
      });
    }),

  /**
   * Hides an assignment from students again.
   *
   * Allowed even after somebody has accepted, deliberately: the reason to unpublish is
   * usually that something is wrong with it, and that is exactly when it should stop being
   * handed out. Existing submissions and grades are untouched — this controls the listing,
   * not the work.
   */
  unpublish: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { courseId: true },
      });
      if (!assignment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      await assertTeaches(ctx, assignment.courseId);

      return ctx.db.assignment.update({
        where: { id: input.assignmentId },
        data: { distributedAt: null },
        select: assignmentFields,
      });
    }),

  /**
   * Copies a proven assignment into another course.
   *
   * At the assignment level rather than the course level so that course creation, when it
   * comes, is a loop over this rather than new logic. The copy arrives unpublished, and its
   * sections are re-validated against the target course — a module tag legitimate in one
   * cohort may not exist in another's `moduleStructure`.
   */
  duplicate: instructorProcedure
    .input(z.object({
      assignmentId: z.string().uuid(),
      targetCourseId: z.string().uuid(),
      assignmentRepoName: z.string().min(1).optional(),
      dueAt: z.date().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          courseId: true,
          kind: true,
          title: true,
          moduleTag: true,
          completionThreshold: true,
          templateRepo: true,
          assignmentRepoName: true,
          githubOrg: true,
          templateRef: true,
          runnerPreset: true,
          runnerConfig: true,
          templateDocUrl: true,
          submissionInstructions: true,
          sections: true,
        },
      });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });

      // Both courses, because copying reads one and writes the other.
      await assertTeaches(ctx, source.courseId);
      await assertTeaches(ctx, input.targetCourseId);

      const draft = {
        kind: source.kind,
        title: source.title,
        moduleTag: source.moduleTag,
        completionThreshold: source.completionThreshold,
        dueAt: input.dueAt ?? null,
        templateRepo: source.templateRepo,
        assignmentRepoName: input.assignmentRepoName ?? source.assignmentRepoName,
        githubOrg: source.githubOrg,
        templateRef: source.templateRef,
        runnerPreset: source.runnerPreset,
        runnerConfig: source.runnerConfig,
        templateDocUrl: source.templateDocUrl,
        submissionInstructions: source.submissionInstructions,
        sections: source.sections,
      };

      const { findings, spec, pointValue } = await validateAssignmentDraft(ctx.db, {
        courseId: input.targetCourseId,
        draft,
      });
      refuseOnErrors(findings);
      if (!spec || pointValue === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The assignment being copied is not a valid draft. Edit it first.',
        });
      }

      const assignment = await ctx.db.assignment.create({
        data: {
          courseId: input.targetCourseId,
          distributedAt: null,
          ...writableFields(spec, pointValue),
        },
        select: assignmentFields,
      });

      return { assignment, warnings: findings.filter((f) => f.severity === 'warning') };
    }),

  /**
   * What removing an assignment would destroy. Read-only.
   *
   * Exists so the confirmation states facts rather than generalities — "3 submissions, 2
   * released grades" is a sentence somebody can act on, and "this cannot be undone" is not.
   */
  removalImpact: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { id: true, courseId: true, title: true, distributedAt: true },
      });
      if (!assignment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      await assertTeaches(ctx, assignment.courseId);

      const submissions = await ctx.db.submission.findMany({
        where: { assignmentId: input.assignmentId },
        select: {
          repoFullName: true,
          finalScore: true,
          _count: { select: { gradingDrafts: true, testRuns: true } },
          gradingDrafts: { where: { status: 'APPROVED' }, select: { id: true } },
        },
      });

      return {
        title: assignment.title,
        published: assignment.distributedAt !== null,
        submissions: submissions.length,
        releasedGrades: submissions.filter((s) => s.finalScore !== null).length,
        feedbackRounds: submissions.reduce((total, s) => total + s.gradingDrafts.length, 0),
        drafts: submissions.reduce((total, s) => total + s._count.gradingDrafts, 0),
        testRuns: submissions.reduce((total, s) => total + s._count.testRuns, 0),
        // Reported so they can be cleaned up deliberately. Never deleted by `remove` —
        // losing a student's work because an instructor tidied a course would be a worse
        // failure than an orphaned repository.
        orphanedRepositories: submissions
          .map((s) => s.repoFullName)
          .filter((name): name is string => name !== null),
      };
    }),

  /**
   * Deletes an assignment and everything cascading from it.
   *
   * Permitted whatever has been submitted, by decision, and permanent: there is no soft
   * delete and no recovery path in the application. The database's own backups are the only
   * way back.
   *
   * The typed confirmation is enforced here rather than in the dialog. That is the whole
   * point of it: the interface warns, and the procedure is what refuses. A guard that lives
   * only in a dialog is decoration, and this is the one irreversible operation in the
   * application.
   */
  remove: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid(), confirmTitle: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { id: true, courseId: true, title: true },
      });
      if (!assignment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      await assertTeaches(ctx, assignment.courseId);

      if (input.confirmTitle !== assignment.title) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            `Type the assignment's title exactly to remove it. Expected "${assignment.title}".`,
        });
      }

      // Counted before the delete, so what is reported afterwards is what was actually
      // destroyed rather than a guess.
      const submissions = await ctx.db.submission.findMany({
        where: { assignmentId: input.assignmentId },
        select: {
          repoFullName: true,
          _count: { select: { gradingDrafts: true, testRuns: true } },
        },
      });

      await ctx.db.assignment.delete({ where: { id: input.assignmentId } });

      return {
        title: assignment.title,
        submissions: submissions.length,
        drafts: submissions.reduce((total, s) => total + s._count.gradingDrafts, 0),
        testRuns: submissions.reduce((total, s) => total + s._count.testRuns, 0),
        orphanedRepositories: submissions
          .map((s) => s.repoFullName)
          .filter((name): name is string => name !== null),
      };
    }),
});
