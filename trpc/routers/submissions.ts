import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isManualOnly } from '@/lib/assignments/spec';
import { undeliveredApprovalWhere } from '@/lib/grade/approve';
import { triageBucket } from '@/lib/grade/triage';

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
        submittedUrl: true,
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
   * A student declaring that work with no pull request is finished.
   *
   * For a repository assignment, opening the pull request is that declaration and the
   * webhook records it — status, `submittedAt`, and `isLate` all follow from the event. The
   * other two kinds have no webhook and nothing to observe, so this procedure does the same
   * job: without it, hand-graded work would never enter triage and would read as never
   * started rather than as waiting, which is the difference between an instructor seeing it
   * and not.
   *
   * The URL is where the student's own copy of the document is. `FILE_UPLOAD` submits with no
   * URL, because what it needs is a stored file — its own piece of work, and deliberately not
   * a text field pretending to be one.
   */
  submitWork: profileProcedure
    .input(
      z.object({
        // The assignment rather than the submission, because FILE_UPLOAD has no row until
        // this runs: submitting is the first thing that happens to it.
        assignmentId: z.string().uuid(),
        /** The student's copy of the document, for GOOGLE_DOC. */
        submittedUrl: z.string().url().max(2000).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { id: true, kind: true, courseId: true, dueAt: true, distributedAt: true },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      }

      // A repository assignment's submission signal is the pull request. Accepting one here
      // would let a student mark work submitted with no code to look at, and the webhook
      // would then be a second authority on the same column.
      if (assignment.kind === 'REPO') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This assignment is submitted by opening a pull request from your draft branch ' +
            'into main. That is what puts it in your instructor\'s queue.',
        });
      }

      if (assignment.distributedAt === null) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That assignment is not available.',
        });
      }

      // Checked here rather than relying on having listed the course first, for the same
      // reason `accept` does: a mutation must not assume which query preceded it.
      const enrollment = await ctx.db.enrollment.findFirst({
        where: { courseId: assignment.courseId, studentId: ctx.profile.id, status: 'ACTIVE' },
        select: { id: true },
      });

      if (!enrollment) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not enrolled in the course this assignment belongs to.',
        });
      }

      if (assignment.kind === 'GOOGLE_DOC' && !input.submittedUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Paste the link to your copy of the document before submitting, so your ' +
            'instructor can open the right one.',
        });
      }

      const submittedAt = new Date();

      /*
        `isLate` is computed here rather than read from anywhere, exactly as the webhook
        computes it for a pull request: the comparison is against the assignment's own
        `dueAt`, and a submission with no due date is never late.

        The row may not exist yet. FILE_UPLOAD has no Accept, so submitting is the first
        thing that happens to it, and an upsert is what lets one procedure serve both that
        and a Google Doc that was accepted earlier.
      */
      return ctx.db.submission.upsert({
        where: {
          assignmentId_studentId: { assignmentId: assignment.id, studentId: ctx.profile.id },
        },
        create: {
          assignmentId: assignment.id,
          studentId: ctx.profile.id,
          status: 'SUBMITTED',
          submittedUrl: input.submittedUrl,
          submittedAt,
          isLate: assignment.dueAt ? submittedAt > assignment.dueAt : false,
          lastActivityAt: submittedAt,
        },
        update: {
          status: 'SUBMITTED',
          submittedUrl: input.submittedUrl,
          submittedAt,
          isLate: assignment.dueAt ? submittedAt > assignment.dueAt : false,
          lastActivityAt: submittedAt,
        },
        select: { id: true, status: true, submittedUrl: true, submittedAt: true, isLate: true },
      });
    }),

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
   * Everything across the caller's courses that is waiting on them. Instructors only.
   *
   * The landing screen for an instructor, so it answers "what do I do next" rather than
   * "what exists". Taken together the buckets are the whole of the outstanding grading:
   * every submission a student has declared finished and nobody has approved appears in
   * exactly one of them, whether or not a report has been generated for it yet.
   *
   * Which bucket is decided by the submission's most recent grading draft, not by
   * `submission.status`. Generating a report writes the draft's status and leaves the
   * submission's alone — only approving moves a submission to GRADED — so `DRAFT_READY`,
   * `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` are values nothing ever writes. Reading
   * them here would leave every bucket permanently empty.
   *
   * Two buckets exist because the work is otherwise invisible. `comment_not_posted` is a
   * grade recorded whose comment never reached the pull request: the submission reads as
   * finished from every other angle, but the student was never told. And a draft
   * describing a commit the student has since pushed past is deliberately not "ready to
   * review" — approving it is refused — so it falls back to `needs_report`.
   */
  triage: instructorProcedure
    .input(z.object({ courseId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      // Which courses the caller may see across. An admin sees every course; an
      // instructor sees only the ones they are listed on. This is what scopes the read,
      // since it deliberately crosses both students and assignments.
      const taught =
        ctx.profile.role === 'ADMIN'
          ? await ctx.db.course.findMany({
              where: { archivedAt: null, ...(input.courseId ? { id: input.courseId } : {}) },
              select: { id: true },
            })
          : await ctx.db.courseInstructor.findMany({
              where: { userId: ctx.profile.id, ...(input.courseId ? { courseId: input.courseId } : {}) },
              select: { courseId: true },
            });

      const courseIds = taught.map((row) => ('id' in row ? row.id : row.courseId));

      if (courseIds.length === 0) {
        return { submissions: [], gradedCount: 0 };
      }

      const submissions = await ctx.db.submission.findMany({
        where: {
          assignment: { courseId: { in: courseIds } },
          OR: [
            // Open work, whether or not a run has happened yet.
            { status: { in: ['SUBMITTED', 'RESUBMITTED'] } },
            // A run that reached some state a person has to act on. Included
            // independently of the submission's status, because a student can push after
            // being graded and have a new draft waiting while the submission still reads
            // GRADED.
            {
              gradingDrafts: {
                some: { status: { in: ['READY', 'NEEDS_MANUAL_REVIEW', 'FAILED', 'GENERATING'] } },
              },
            },
            // Approved, but the comment never reached the pull request. Recoverable —
            // there is a retry — and worth finding without being looked for. Not the same
            // as a submission that never had a pull request to post to, which is every
            // hand-graded one: `undeliveredApprovalWhere` is what keeps those out.
            { gradingDrafts: { some: undeliveredApprovalWhere() } },
          ],
        },
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          status: true,
          isLate: true,
          headSha: true,
          gradedHeadSha: true,
          submittedAt: true,
          lastActivityAt: true,
          student: { select: { id: true, displayName: true, email: true } },
          // `sections` for the grading mode: an assignment the pipeline cannot grade lands
          // in a different bucket, because the action waiting on the instructor is
          // different and generating a report is not one of the things they can do.
          assignment: {
            select: { id: true, title: true, moduleTag: true, courseId: true, sections: true },
          },
          // The most recent run, superseded ones included: a draft that was replaced is
          // still what the row's flags describe until a newer one finishes.
          gradingDrafts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              headSha: true,
              approvedAt: true,
              sections: {
                select: {
                  flags: true,
                  confidence: true,
                  scoreEarned: true,
                  editedScoreEarned: true,
                  scorePossible: true,
                },
              },
            },
          },
        },
      });

      // Counted rather than fetched. The screen shows how many are done, not which.
      const gradedCount = await ctx.db.submission.count({
        where: { assignment: { courseId: { in: courseIds } }, status: 'GRADED' },
      });

      /*
        Which of these have a grade that was approved but never reached the pull request.
        Asked as its own question rather than read off the most recent draft, because the
        undelivered one is frequently not the most recent: the usual sequence is approve,
        the comment fails, the student pushes, a new draft is generated on top.
      */
      const undelivered = await ctx.db.gradingDraft.findMany({
        where: undeliveredApprovalWhere({ id: { in: submissions.map((s) => s.id) } }),
        select: { submissionId: true },
        distinct: ['submissionId'],
      });
      const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));

      const rows = submissions.map(({ gradingDrafts, assignment, ...submission }) => {
        const draft = gradingDrafts[0] ?? null;
        // Read for the bucket and then dropped: the section mapping is what decides how
        // this row is graded, and nothing on the screen renders it.
        const { sections, ...assignmentFields } = assignment;

        // The draft describes a commit the student has pushed past. Approval refuses a
        // stale draft, so the row must not be offered as ready to approve.
        const draftIsStale =
          draft != null && submission.headSha != null && draft.headSha !== submission.headSha;

        return {
          ...submission,
          assignment: assignmentFields,
          bucket: triageBucket(
            submission.status,
            draft,
            draftIsStale,
            undeliveredIds.has(submission.id),
            isManualOnly(sections),
          ),
          draftIsStale,
          // Flattened here rather than in the interface. Delivery is deliberately not on
          // this object: whether a grade reached the student is answered by the bucket,
          // and a second copy of the answer here would be one that could disagree.
          activeDraft: draft
            ? {
                id: draft.id,
                status: draft.status,
                headSha: draft.headSha,
                approvedAt: draft.approvedAt,
                sections: draft.sections,
              }
            : null,
        };
      });

      // A row matching the query but landing in no bucket has nothing for a person to
      // do — a superseded draft on a graded submission, say. Dropped here so the
      // interface never has to decide what to do with one.
      return { submissions: rows.filter((row) => row.bucket != null), gradedCount };
    }),

  /**
   * Every submission for one assignment. Instructors only.
   *
   * This is the one procedure that deliberately reads across students, which is
   * why it is gated on the caller teaching the course rather than on
   * `instructorProcedure` alone.
   *
   * Each row carries the same `bucket` the triage screen sorts on, computed the same
   * way. The grading queue's "needs review" filter is then the same question triage
   * answers — a submission cannot be work to do on one screen and finished on the other.
   */
  listForAssignment: instructorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const assignment = await ctx.db.assignment.findUnique({
        where: { id: input.assignmentId },
        select: { id: true, title: true, courseId: true, dueAt: true, kind: true, sections: true },
      });

      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found.' });
      }

      /*
        Read once for the whole queue rather than per row: every submission here belongs to
        this one assignment, so how it is graded is a property of the page. The review
        surface reads it too — it decides whether the screen offers to generate a report or
        an empty draft to type into.
      */
      const manualOnly = isManualOnly(assignment.sections);

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
          // What the instructor opens when there is no pull request: the document the student
          // submitted. Hand grading needs somewhere to read the work from.
          submittedUrl: true,
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
          // Enough of the most recent draft to label a queue row. The review pane loads
          // the draft in full when a row is selected; a list of forty students does not
          // need forty reports in it.
          gradingDrafts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, headSha: true, approvedAt: true },
          },
        },
      });

      const undelivered = await ctx.db.gradingDraft.findMany({
        where: undeliveredApprovalWhere({ id: { in: submissions.map((s) => s.id) } }),
        select: { submissionId: true },
        distinct: ['submissionId'],
      });
      const undeliveredIds = new Set(undelivered.map((draft) => draft.submissionId));

      return {
        // Spelled out rather than spread, so `sections` does not travel to the browser as a
        // second copy of a question `manualOnly` has already answered.
        assignment: {
          id: assignment.id,
          title: assignment.title,
          courseId: assignment.courseId,
          dueAt: assignment.dueAt,
          kind: assignment.kind,
          manualOnly,
        },
        submissions: submissions.map(({ gradingDrafts, ...submission }) => {
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
              manualOnly,
            ),
            draftIsStale,
            activeDraft: draft,
          };
        }),
      };
    }),
});
