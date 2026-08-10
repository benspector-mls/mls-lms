import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Db } from "@/lib/prisma";

import {
  acceptableAssignmentSelect,
  acceptDriveAssignment,
  acceptRepoAssignment,
  type Accepted,
} from "@/lib/assignments/accept";
import { detectRunnerPreset, NOT_A_REPOSITORY } from "@/lib/assignments/detect";
import { normalizeRepoRef } from "@/lib/assignments/repo-ref";
import { assertKindImplemented } from "@/lib/assignments/spec";
import {
  hasErrors,
  validateAssignmentDraft,
  type ValidationFinding,
} from "@/lib/assignments/validate";
import { assertActiveStudent, assertCourseMember, assertTeaches } from "@/lib/courses/membership";
import { teachableAssignment } from "@/lib/courses/scope";
import { effectiveSection } from "@/lib/grade/approve";
import { listAnswerKeyEntries, listAnswerKeys, MAX_ANSWER_KEYS } from "@/lib/grade/assets";

import {
  courseProcedure,
  createTRPCRouter,
  instructorProcedure,
  profileProcedure,
  studentProcedure,
} from "../init";
import { moduleSummarySelect } from "../selects";

/** Columns of an assignment that are safe to send to any enrolled member. */
const assignmentFields = {
  id: true,
  kind: true,
  title: true,
  /*
    The module as a row. `answerKeyRepo` is deliberately absent: it names a private
    repository of reference solutions, which is nothing a course page needs and the last
    thing a student should be told.
  */
  moduleId: true,
  module: { select: moduleSummarySelect },
  pointValue: true,
  completionThreshold: true,
  dueAt: true,
  assignmentRepoName: true,
  distributedAt: true,
  courseId: true,
  // All three student-facing. The template document is what Accept sends them to a copy of,
  // the accepted types are what their upload control offers and refuses, and the instructions
  // are what the assignment says about turning it in.
  templateDriveUrl: true,
  acceptedFileTypes: true,
  submissionInstructions: true,
} as const;

/** Refuses a draft that would not grade correctly, naming the fields. */
function refuseOnErrors(findings: ValidationFinding[]): void {
  if (!hasErrors(findings)) return;
  const errors = findings.filter((finding) => finding.severity === "error");
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `This assignment cannot be saved as it stands:\n` +
      errors.map((finding) => `  ${finding.path}: ${finding.message}`).join("\n"),
    cause: findings,
  });
}

/** The columns an authored assignment writes. Shared so create and update cannot drift. */
function writableFields(
  spec: NonNullable<Awaited<ReturnType<typeof validateAssignmentDraft>>["spec"]>,
  pointValue: number,
) {
  return {
    kind: spec.kind,
    title: spec.title,
    moduleId: spec.moduleId,
    pointValue,
    completionThreshold: spec.completionThreshold,
    dueAt: spec.dueAt,
    templateRepo: spec.templateRepo,
    answerKeyRepo: spec.answerKeyRepo,
    answerKeyDir: spec.answerKeyDir,
    assignmentRepoName: spec.assignmentRepoName,
    githubOrg: spec.githubOrg,
    templateRef: spec.templateRef,
    runnerPreset: spec.runnerPreset,
    runnerConfig: (spec.runnerConfig ?? null) as never,
    // Both null on a REPO assignment and both spelled out anyway. Every field of the spec
    // appears here, because a key left out of this object is not a compile error — it is a
    // column that silently keeps its old value on update and its default on create, which
    // for `templateDriveUrl` would be a Google Drive assignment with nothing to distribute.
    templateDriveUrl: spec.templateDriveUrl,
    acceptedFileTypes: spec.acceptedFileTypes,
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
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
      const membership = await assertCourseMember(ctx, input.courseId);

      /*
        An unpublished assignment is invisible to a student and visible to an instructor.

        `distributedAt` already meant this and was read by nothing. It is what makes
        authoring safe: an assignment can be built over several sittings, and a section
        mapping corrected, without a student seeing a half-finished one or accepting an
        assignment whose answer keys are still wrong.

        Read off the membership that was just fetched rather than asked again — which is also
        what stops this from being a second implementation of the question
        `modules.listForCourse` asks. It was one, and the two would have had to be changed
        together with nothing to say so.
      */
      const teaches = membership.as !== "student";

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
              // document, or the name and size of the file they uploaded. A student should be
              // able to see what they handed in, which is also how they notice they sent the
              // wrong file.
              submittedUrl: true,
              uploadFilename: true,
              uploadSizeBytes: true,
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
                where: { status: "APPROVED" },
                orderBy: { approvedAt: "asc" },
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
              /*
                Whether an instructor has this open and is writing feedback about it, which is
                what decides whether the student may still replace what they handed in.

                **A count rather than the draft, and a count of exactly the states
                `assertCanHandIn` refuses on**, so the form the screen offers and the mutation
                behind it cannot disagree about whether handing in again is allowed. A student
                shown an Update box that is then refused has been told to do something the
                server will not accept.

                One number and no statuses. Which state a grading draft is in is not a student's
                business — `STUDENT_STATUS_META` collapses the queue for the same reason — and
                "somebody is looking at this" is the only fact the screen needs.
              */
              _count: {
                select: {
                  gradingDrafts: {
                    where: {
                      approvedAt: null,
                      status: { in: ["GENERATING", "READY", "NEEDS_MANUAL_REVIEW"] },
                    },
                  },
                },
              },
            },
          },
        },
        /*
          Module order, then **due date**, then title.

          The order a student meets the work in, which is what this list is. Within a module,
          the sequence that means something is when things are due — alphabetical put "Arrays"
          before "Loops" regardless of which was set first, which is an ordering of the titles
          rather than of the course.

          `nulls: 'last'` is explicit rather than left to the database's default, because it is
          a decision: an assignment with no due date is not earlier or later than every date, it
          is outside the ordering, so it sits at the foot of its module. Title stays as the
          tie-break for work due the same day. (`assignmentRepoName` was the tie-break once and
          only REPO assignments have one, so a course mixing kinds sorted the rest arbitrarily.)
        */
        orderBy: [
          { module: { position: "asc" } },
          { dueAt: { sort: "asc", nulls: "last" } },
          { title: "asc" },
        ],
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
        submissions: assignment.submissions.map(({ _count, ...submission }) => ({
          ...submission,
          /*
            Flattened to the question it answers, so the browser never has to know it was a
            filtered count — the same reason `activeDraft` is flattened off its relation in the
            submissions router. It also means the number itself does not travel: how many drafts
            an instructor has open is not something a student's screen should be able to render.
          */
          instructorHasStarted: _count.gradingDrafts > 0,
          gradingDrafts: submission.gradingDrafts.map((draft) => ({
            ...draft,
            sections: draft.sections.map(effectiveSection),
          })),
        })),
      }));
    }),

  /**
   * Accepts an assignment.
   *
   * Authorize, load, dispatch on kind. **What accepting *is* depends on the kind**, and the two
   * kinds that have one are `lib/assignments/accept.ts` — one of them talks to GitHub five times
   * and this is not the layer that should read as though it does.
   */
  accept: studentProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<Accepted> => {
      const student = ctx.profile;

      /*
        Deliberately a plain read rather than one of the `teachable*` loaders. This is the
        student path: the caller is not an instructor of this course and must not be asked to
        be. `assertActiveStudent` below is the check that belongs here, and it is a different
        question with a different answer.
      */
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: acceptableAssignmentSelect,
      });

      if (!assignment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
      }

      // Checked here as well as in listForCourse, because a mutation must never rely on the
      // caller having gone through a particular query first. `assertActiveStudent` rather
      // than `assertCourseMember`: a removed student can still read this assignment and must
      // not be able to accept it.
      await assertActiveStudent(ctx, assignment.courseId);

      /*
        A `switch` over every kind rather than the ifs this was, so a fifth kind is a compile
        error here rather than a request that quietly falls through to the repository path.

        FILE_UPLOAD and EXTERNAL_URL have no Accept at all, because there is nothing to hand
        out. The refusal is what a request arriving anyway is answered with — the button is not
        drawn for them, so reaching this means something else did.
      */
      switch (assignment.kind) {
        case "GOOGLE_DRIVE":
          return acceptDriveAssignment(ctx.db, { assignment, studentId: student.id });

        case "REPO":
          /*
            `actingAdmin` is the admin looking through a test student, and null for a real student's
            accept. It is what gets push access to a test student's repository, since the handle the
            repository is named after belongs to no GitHub account. See the test-student branch in
            `lib/assignments/accept.ts` for why that account is invited and the student's is not.
          */
          return acceptRepoAssignment(ctx.db, {
            assignment,
            student,
            actingAdmin: ctx.viewingAs?.admin ?? null,
          });

        case "FILE_UPLOAD":
        case "EXTERNAL_URL":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              assignment.kind === "FILE_UPLOAD"
                ? "This assignment is not accepted — there is nothing to hand out. Upload your " +
                  "work and submit it when you are ready."
                : "This assignment is not accepted — there is nothing to hand out. Make your " +
                  "work, then submit the link to it when you are ready.",
          });
      }
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
  authoringContext: courseProcedure.query(async ({ ctx, input }) => {
    const [course, modules, rubrics, siblings] = await Promise.all([
      ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: { id: true, name: true, cohortTerm: true },
      }),
      // The course's own modules, which are the only ones an assignment may be filed
      // under. Empty is a real state and the form has to say so rather than offering an
      // empty select: a course with no modules cannot hold an assignment yet.
      ctx.db.module.findMany({
        where: { courseId: input.courseId },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: moduleSummarySelect,
      }),
      ctx.db.rubric.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ctx.db.assignment.findMany({
        where: { courseId: input.courseId, kind: "REPO" },
        select: { githubOrg: true, answerKeyRepo: true },
        take: 50,
      }),
    ]);

    if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found." });

    /*
        Whatever this course's other repository assignments use, for the two fields that are
        the same for nearly every assignment in a cohort: the organization students'
        repositories are created in, and the repository the reference solutions live in.

        Typing either is a way to get it subtly wrong for one assignment out of twelve, and
        both are fields where being wrong is invisible until somebody presses Accept or a
        report comes back graded without its answer keys. Offered as a default rather than
        enforced, because a cohort legitimately splits its solutions across repositories.
      */
    const commonest = (values: (string | null)[]): string | null => {
      const counts = new Map<string, number>();
      for (const value of values) {
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };

    const defaultGithubOrg = commonest(siblings.map((sibling) => sibling.githubOrg));
    const defaultAnswerKeyRepo = commonest(siblings.map((sibling) => sibling.answerKeyRepo));

    return {
      course: {
        id: course.id,
        name: course.name,
        cohortTerm: course.cohortTerm,
        modules,
      },
      rubrics,
      defaultGithubOrg,
      defaultAnswerKeyRepo,
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
      const assignment = await teachableAssignment(ctx, input.assignmentId, {
        id: true,
        courseId: true,
        kind: true,
        title: true,
        moduleId: true,
        pointValue: true,
        completionThreshold: true,
        dueAt: true,
        distributedAt: true,
        templateRepo: true,
        answerKeyRepo: true,
        answerKeyDir: true,
        assignmentRepoName: true,
        githubOrg: true,
        templateRef: true,
        runnerPreset: true,
        runnerConfig: true,
        templateDriveUrl: true,
        acceptedFileTypes: true,
        submissionInstructions: true,
        sections: true,
        _count: { select: { submissions: true } },
      });

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
  validateDraft: courseProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid().optional(),
        draft: z.unknown(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { findings, pointValue } = await validateAssignmentDraft(ctx.db, input);
      return { findings, pointValue, canSave: !hasErrors(findings) };
    }),

  /**
   * One directory of an assignment's answer-key repository, so the form can walk it.
   *
   * The repository is named by the request rather than read from configuration, which is the
   * whole of Phase 2 in one line: the assignment says where its reference solutions are, and
   * the form lists whatever is there rather than assuming a layout.
   *
   * `dir` is empty for the repository root. `entries` is null when the directory does not
   * exist, which is a real answer while a path is being typed and not an error.
   */
  browseAnswerKeys: courseProcedure
    .input(
      z.object({
        answerKeyRepo: z.string().min(3),
        dir: z.string().default(""),
      }),
    )
    .query(async ({ input }) => {
      return { entries: await listAnswerKeyEntries(input.answerKeyRepo, input.dir) };
    }),

  /**
   * What a directory resolves to: the reference files grading will read, and what it skipped.
   *
   * Recursive, because answer keys nest — `swe-1-3-node-modules` keeps two of its three under
   * `madlib-challenge/`. Read-only, and shown rather than chosen from: an instructor names the
   * folder and this says what naming it means, which is the same list `loadGradingAssets`
   * builds at grading time from the same function.
   */
  answerKeyPreview: courseProcedure
    .input(
      z.object({
        answerKeyRepo: z.string().min(3),
        dir: z.string().default(""),
      }),
    )
    .query(async ({ input }) => {
      const set = await listAnswerKeys(input.answerKeyRepo, input.dir);
      return { ...set, limit: MAX_ANSWER_KEYS };
    }),

  /**
   * What the template repository says about how it runs, so the form does not ask.
   *
   * Called once a template has been named. Returns the reason as well as the preset, because
   * an inference an instructor cannot check is one they have to trust blindly.
   *
   * The reference is normalized here rather than trusted, so a pasted URL works the same as
   * a typed `owner/repo` — the field the form sends holds whichever the instructor produced.
   */
  inferFromTemplate: courseProcedure
    .input(z.object({ templateRepo: z.string().min(3) }))
    .query(async ({ input }) => {
      const fullName = normalizeRepoRef(input.templateRepo);
      return fullName ? detectRunnerPreset(fullName) : NOT_A_REPOSITORY;
    }),

  /**
   * Creates an assignment, unpublished.
   *
   * `pointValue` comes from the validated spec rather than from input, so there is no
   * request that can make the gradebook column disagree with the sections beneath it.
   */
  create: courseProcedure
    .input(z.object({ draft: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const { findings, spec, pointValue } = await validateAssignmentDraft(ctx.db, input);
      refuseOnErrors(findings);
      if (!spec || pointValue === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That draft is not an assignment." });
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

      return { assignment, warnings: findings.filter((f) => f.severity === "warning") };
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
      const existing = await teachableAssignment(ctx, input.assignmentId, {
        courseId: true,
        assignmentRepoName: true,
        _count: { select: { submissions: true } },
      });

      const { findings, spec, pointValue } = await validateAssignmentDraft(ctx.db, {
        courseId: existing.courseId,
        assignmentId: input.assignmentId,
        draft: input.draft,
      });
      refuseOnErrors(findings);
      if (!spec || pointValue === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That draft is not an assignment." });
      }

      if (
        existing._count.submissions > 0 &&
        spec.assignmentRepoName !== existing.assignmentRepoName
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
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

      return { assignment, warnings: findings.filter((f) => f.severity === "warning") };
    }),

  /** Makes an assignment visible to students. Validated again, because publishing is the
   * moment it stops being private — a draft saved with warnings should not become live
   * without them being seen a second time. */
  publish: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await teachableAssignment(ctx, input.assignmentId, {
        courseId: true,
        distributedAt: true,
      });

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
      await teachableAssignment(ctx, input.assignmentId, { id: true });

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
   * sections are re-validated against the target course — the module has to be matched by
   * name there, and both repositories are checked again.
   */
  duplicate: instructorProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        targetCourseId: z.string().uuid(),
        /**
         * Where it lands in the target course. Optional, and when it is absent the module is
         * matched across courses by name — which is right when two cohorts of the same program
         * share a module sequence and useless when they have diverged. Naming it is what the
         * copy dialog does, so the case the matching cannot serve stops being a refusal.
         */
        targetModuleId: z.string().uuid().optional(),
        assignmentRepoName: z.string().min(1).optional(),
        dueAt: z.date().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Both courses, because copying reads one and writes the other. The source is loaded
      // and authorized in one query; the target has no row here to hang a check on.
      const source = await teachableAssignment(ctx, input.assignmentId, copyableAssignmentSelect);
      await assertTeaches(ctx, input.targetCourseId);

      /*
        An archived cohort takes nothing new, the same rule as a student joining one or an
        instructor being added to one. It matters more now than it did: the course list returns
        archived cohorts, so they are a thing somebody can be looking at when they reach for a
        copy, and a finished term quietly gaining an assignment is a change nobody would see.
      */
      const target = await ctx.db.course.findUnique({
        where: { id: input.targetCourseId },
        select: { name: true, archivedAt: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That course does not exist." });
      }
      if (target.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${target.name} is archived, so nothing new can be added to it.`,
        });
      }

      return copyAssignmentInto(ctx.db, {
        source,
        targetCourseId: input.targetCourseId,
        targetModuleId: input.targetModuleId,
        assignmentRepoName: input.assignmentRepoName,
        dueAt: input.dueAt ?? null,
      });
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
      const assignment = await teachableAssignment(ctx, input.assignmentId, {
        id: true,
        courseId: true,
        title: true,
        distributedAt: true,
      });

      const submissions = await ctx.db.submission.findMany({
        where: { assignmentId: input.assignmentId },
        select: {
          repoFullName: true,
          finalScore: true,
          _count: { select: { gradingDrafts: true, testRuns: true } },
          gradingDrafts: { where: { status: "APPROVED" }, select: { id: true } },
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
      const assignment = await teachableAssignment(ctx, input.assignmentId, {
        id: true,
        courseId: true,
        title: true,
      });

      if (input.confirmTitle !== assignment.title) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Type the assignment's title exactly to remove it. Expected "${assignment.title}".`,
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

/** What `copyAssignmentInto` reads off the assignment being copied. */
type CopyableAssignment = {
  courseId: string;
  kind: import("@/lib/generated/prisma/enums").AssignmentKind;
  title: string;
  completionThreshold: number;
  templateRepo: string | null;
  answerKeyRepo: string | null;
  answerKeyDir: string | null;
  assignmentRepoName: string | null;
  githubOrg: string | null;
  templateRef: string | null;
  runnerPreset: string;
  runnerConfig: unknown;
  templateDriveUrl: string | null;
  acceptedFileTypes: string[];
  submissionInstructions: string | null;
  sections: unknown;
  moduleId: string;
  module: { name: string };
};

/** The columns `copyAssignmentInto` needs, as a Prisma select. Shared so the two callers agree. */
export const copyableAssignmentSelect = {
  courseId: true,
  kind: true,
  title: true,
  completionThreshold: true,
  templateRepo: true,
  answerKeyRepo: true,
  answerKeyDir: true,
  assignmentRepoName: true,
  githubOrg: true,
  templateRef: true,
  runnerPreset: true,
  runnerConfig: true,
  templateDriveUrl: true,
  acceptedFileTypes: true,
  submissionInstructions: true,
  sections: true,
  moduleId: true,
  module: { select: { name: true } },
} as const;

/**
 * Copies one assignment into a course, re-validated against where it is going.
 *
 * Extracted from `duplicate` so that creating a course can loop over it, which is what
 * `duplicate` was built at the assignment level for. **Authorization is not here**: both
 * callers check that the caller teaches the source and the target before reaching this, and a
 * function that copied assignments without being asked who wanted it done would be the wrong
 * shape to leave lying around.
 *
 * Re-validated rather than copied column for column, because a mapping legitimate in one course
 * may not be in another — the module has to exist there by name, and both repositories are
 * reached over the network to check they are still readable.
 */
export async function copyAssignmentInto(
  db: Db,
  params: {
    source: CopyableAssignment;
    targetCourseId: string;
    targetModuleId?: string;
    assignmentRepoName?: string;
    dueAt: Date | null;
  },
) {
  const { source, targetCourseId } = params;

  /*
        Where the copy lands, in three cases.

        A module belongs to one course, so copying into a *different* course cannot reuse the
        source's module. When the caller names one, that is the answer — and it is checked
        against the target course rather than merely looked up, because a module id is a
        parameter anybody can pass and one belonging to a third cohort would otherwise file the
        assignment somewhere the caller never chose.

        When nobody names one, it is matched by name, which is the only thing two courses can
        agree about — and refused when the target has none, rather than filing the copy under
        whichever module happened to be first, which is a wrong answer that looks like a right
        one. Naming the module is how the copy dialog serves two cohorts whose module sequences
        have diverged, which is exactly the case that matching cannot.
      */
  const targetModule = params.targetModuleId
    ? await db.module.findFirst({
        where: { id: params.targetModuleId, courseId: targetCourseId },
        select: { id: true },
      })
    : targetCourseId === source.courseId
      ? { id: source.moduleId }
      : await db.module.findFirst({
          where: { courseId: targetCourseId, name: source.module.name },
          select: { id: true },
        });

  if (!targetModule) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: params.targetModuleId
        ? "That module is not in the course you are copying into."
        : `The target course has no module called "${source.module.name}". Create it ` +
          `there first, or say which module the copy should go in.`,
    });
  }

  /*
        Copying inside one course has to rename the repository, and the name is derived here
        rather than asked for.

        `@@unique([courseId, assignmentRepoName])` is per course, so a copy into *another*
        cohort keeps the name — the repositories still differ, because the cohort's short name
        prefixes every one of them. Only a copy beside the original collides, and the caller
        that used to invent a name for it built one out of the assignment's human title, which
        is not a legal repository name the moment a title contains a space.
      */
  const assignmentRepoName =
    params.assignmentRepoName ??
    (targetCourseId === source.courseId && source.assignmentRepoName !== null
      ? await freeRepoNameIn(db, targetCourseId, source.assignmentRepoName)
      : source.assignmentRepoName);

  const draft = {
    kind: source.kind,
    title: source.title,
    moduleId: targetModule.id,
    completionThreshold: source.completionThreshold,
    dueAt: params.dueAt,
    templateRepo: source.templateRepo,
    answerKeyRepo: source.answerKeyRepo,
    answerKeyDir: source.answerKeyDir,
    assignmentRepoName,
    githubOrg: source.githubOrg,
    templateRef: source.templateRef,
    runnerPreset: source.runnerPreset,
    runnerConfig: source.runnerConfig,
    templateDriveUrl: source.templateDriveUrl,
    acceptedFileTypes: source.acceptedFileTypes,
    submissionInstructions: source.submissionInstructions,
    sections: source.sections,
  };

  const { findings, spec, pointValue } = await validateAssignmentDraft(db, {
    courseId: targetCourseId,
    draft,
  });
  refuseOnErrors(findings);
  if (!spec || pointValue === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The assignment being copied is not a valid draft. Edit it first.",
    });
  }

  const assignment = await db.assignment.create({
    data: {
      courseId: targetCourseId,
      distributedAt: null,
      ...writableFields(spec, pointValue),
    },
    select: assignmentFields,
  });

  return { assignment, warnings: findings.filter((f) => f.severity === "warning") };
}

/**
 * A repository name free in this course, starting from `${base}-copy`.
 *
 * For the one case that has to rename: a copy sitting beside its original. `-copy-2` and up
 * exist because duplicating twice is a thing people do, and a second attempt failing on a
 * constraint would be a refusal with nothing for the caller to do about it.
 *
 * Bounded rather than looping until it finds one. Ten copies of a single assignment in one
 * cohort is not a thing anybody is doing on purpose, and a loop with no ceiling around a
 * database query is a worse failure than the refusal.
 */
async function freeRepoNameIn(db: Db, courseId: string, base: string): Promise<string> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const candidate = attempt === 1 ? `${base}-copy` : `${base}-copy-${attempt}`;
    const taken = await db.assignment.findFirst({
      where: { courseId, assignmentRepoName: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `This course already holds ten copies of "${base}". Give the next one a repository ` +
      `name of its own, or remove the ones that are not being used.`,
  });
}
