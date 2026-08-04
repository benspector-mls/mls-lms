import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { approveDraft, ApprovalError, retryComment } from '@/lib/grade/approve';
import { GradingAssetsError } from '@/lib/grade/assets';
import { generateReportForSubmission, ReportGenerationError } from '@/lib/grade/generate-report';
import { ProviderError } from '@/lib/grade/provider';
import { ReportValidationError } from '@/lib/grade/schema';
import { createTRPCRouter, instructorProcedure } from '../init';

/**
 * AI grading drafts, instructor-only.
 *
 * Generating a draft posts nothing and records no grade — a draft is a proposal with a
 * status. `approve` is the one procedure here that changes a student's grade and puts
 * text in front of them, and it is deliberately a separate, explicit action.
 */

/** Columns safe to send to the browser. Keeps future additions opt-in. */
const draftFields = {
  id: true,
  headSha: true,
  status: true,
  errorDetail: true,
  modelMetadata: true,
  createdAt: true,
  // An approved draft is a round of feedback the student has actually received, not a
  // discarded proposal. The interface keeps them apart on this.
  approvedAt: true,
  postedPrCommentId: true,
  sections: {
    select: {
      id: true,
      sectionType: true,
      reportMarkdown: true,
      scoreEarned: true,
      scorePossible: true,
      rubricItems: true,
      flags: true,
      instructorNotes: true,
      confidence: true,
      submissionProcessNote: true,
      // Both versions travel to the browser. The interface edits the effective text but
      // has to be able to say what the model wrote and offer a way back to it.
      editedReportMarkdown: true,
      editedScoreEarned: true,
      editedAt: true,
    },
  },
} as const;

/** Resolves a submission and confirms the caller teaches its course. */
async function loadSubmissionForInstructor(
  ctx: { db: typeof import('@/lib/prisma').db; profile: { id: string; role: string } },
  submissionId: string,
) {
  const submission = await ctx.db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      headSha: true,
      prNumber: true,
      repoFullName: true,
      assignment: { select: { id: true, title: true, courseId: true, sections: true } },
    },
  });

  if (!submission) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found.' });
  }

  const teaches =
    ctx.profile.role === 'ADMIN' ||
    (await ctx.db.courseInstructor.findFirst({
      where: { courseId: submission.assignment.courseId, userId: ctx.profile.id },
      select: { id: true },
    })) !== null;

  if (!teaches) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not teach the course this submission belongs to.',
    });
  }

  return submission;
}

export const gradingDraftsRouter = createTRPCRouter({
  /**
   * Generates a draft, awaited inside the request.
   *
   * Takes tens of seconds and is deliberately synchronous for this phase, for the
   * same reason test runs are: a stack trace in the terminal beats debugging through
   * a queue. Automatic triggering is Phase 4 and calls the same function.
   */
  generate: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await loadSubmissionForInstructor(ctx, input.submissionId);

      try {
        return await generateReportForSubmission(submission.id);
      } catch (err) {
        // Preconditions rather than server errors: the submission is not ready, or
        // the assignment is not configured. Both are fixable and neither is a bug.
        if (err instanceof ReportGenerationError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        // An unset GRADING_ASSETS_REPO, an installation that cannot see it, or a renamed
        // rubric heading. An operator problem, and the message says which.
        if (err instanceof GradingAssetsError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        // Reached only when the failure happened before a draft row existed;
        // afterwards these are recorded on the row as FAILED instead of thrown.
        if (err instanceof ProviderError || err instanceof ReportValidationError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Every draft for one submission, newest first.
   *
   * An empty array is normal: no assignment has a draft until someone asks for one.
   * `canGenerate` is returned so the interface can explain why the button is absent
   * rather than showing a control that fails.
   */
  listForSubmission: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const submission = await loadSubmissionForInstructor(ctx, input.submissionId);

      const drafts = await ctx.db.gradingDraft.findMany({
        where: { submissionId: submission.id },
        orderBy: { createdAt: 'desc' },
        select: draftFields,
      });

      const declaredSections = Array.isArray(submission.assignment.sections)
        ? (submission.assignment.sections as { type?: string }[])
        : [];

      const graded = await ctx.db.submission.findUnique({
        where: { id: input.submissionId },
        select: {
          status: true,
          finalScore: true,
          finalScorePossible: true,
          isComplete: true,
          gradedAt: true,
          gradedHeadSha: true,
        },
      });

      // Whether the most recent approval's comment actually went out. Read from the
      // draft rather than the submission, because each approval posts its own comment
      // and it is the latest one that could be missing.
      const latestApproval = await ctx.db.gradingDraft.findFirst({
        where: { submissionId: input.submissionId, status: 'APPROVED' },
        orderBy: { approvedAt: 'desc' },
        select: { id: true, postedPrCommentId: true },
      });

      return {
        drafts,
        /**
         * True when there is something to grade. A submission with no pull request,
         * or an assignment with no sections mapping, cannot produce a report — and
         * saying so is more useful than a button that throws.
         */
        canGenerate:
          submission.prNumber !== null &&
          submission.headSha !== null &&
          declaredSections.length > 0,
        blockedReason:
          submission.prNumber === null || submission.headSha === null
            ? 'The student has not opened a pull request yet.'
            : declaredSections.length === 0
              ? 'This assignment has no sections mapping, so there is no rubric to grade against.'
              : null,
        /**
         * Whether the draft on top describes the commit that is currently at the head
         * of the pull request. A draft against an older commit is not wrong, but it
         * describes different code and should not be read as current.
         */
        currentHeadSha: submission.headSha,
        /**
         * The grade already on record, if there is one. Lets the review interface show
         * that a submission is settled, and surface a grade whose comment never
         * reached GitHub — which is a recoverable state rather than a failure, but
         * only if somebody can see it.
         */
        grade: graded && {
          ...graded,
          /**
           * Null when nothing has been approved: there is no comment to have gone out or
           * not, and saying `true` there — which `latestApproval?.postedPrCommentId !==
           * null` did, because `undefined !== null` — claims a delivery that never
           * happened. Three states, so three values.
           */
          commentPosted: latestApproval ? latestApproval.postedPrCommentId !== null : null,
        },
      };
    }),

  /** One draft in full. */
  get: instructorProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const draft = await ctx.db.gradingDraft.findUnique({
        where: { id: input.draftId },
        select: { ...draftFields, submissionId: true },
      });

      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found.' });

      // Authorization lives on the submission, so it is checked there rather than
      // duplicated here.
      await loadSubmissionForInstructor(ctx, draft.submissionId);
      return draft;
    }),

  /**
   * Revises one section of a draft before it is approved.
   *
   * The edit is stored beside the model's output rather than over it. Overwriting would
   * destroy the only record of what the model actually produced, and that record is
   * what any later judgment about whether the grading is good enough has to rest on.
   *
   * Passing null for a field discards the edit and restores the model's version, which
   * is why the inputs are nullable rather than optional.
   */
  updateSection: instructorProcedure
    .input(
      z.object({
        sectionId: z.string().uuid(),
        reportMarkdown: z.string().trim().min(1).nullable(),
        scoreEarned: z.number().min(0).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const section = await ctx.db.gradingDraftSection.findUnique({
        where: { id: input.sectionId },
        select: {
          id: true,
          scorePossible: true,
          gradingDraft: { select: { submissionId: true, approvedAt: true } },
        },
      });
      if (!section) throw new TRPCError({ code: 'NOT_FOUND', message: 'Section not found.' });

      await loadSubmissionForInstructor(ctx, section.gradingDraft.submissionId);

      // An approved draft is a round of feedback the student has already read. Editing
      // it would change the record of what they were told without changing what they
      // saw, so a revision means a new draft and a new comment.
      if (section.gradingDraft.approvedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This draft has already been sent to the student. Generate a new report to ' +
            'revise the grade — the student keeps both, which is the point of the history.',
        });
      }

      if (
        input.scoreEarned !== null &&
        section.scorePossible !== null &&
        input.scoreEarned > section.scorePossible
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `This section is out of ${section.scorePossible} points.`,
        });
      }

      return ctx.db.gradingDraftSection.update({
        where: { id: section.id },
        data: {
          editedReportMarkdown: input.reportMarkdown,
          editedScoreEarned: input.scoreEarned,
          // Cleared alongside the edit, so a section restored to the model's version
          // does not keep claiming it was revised.
          editedAt: input.reportMarkdown === null && input.scoreEarned === null
            ? null
            : new Date(),
          editedById: input.reportMarkdown === null && input.scoreEarned === null
            ? null
            : ctx.profile.id,
        },
        select: { id: true, editedAt: true },
      });
    }),

  /**
   * Approves a draft: records the grade and posts the report to the pull request.
   *
   * The one action in this router that a student can see the effects of, and the only
   * one that writes outside the drafts tables.
   */
  approve: instructorProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.db.gradingDraft.findUnique({
        where: { id: input.draftId },
        select: { submissionId: true },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found.' });

      await loadSubmissionForInstructor(ctx, draft.submissionId);

      try {
        return await approveDraft({
          draftId: input.draftId,
          approvedByProfileId: ctx.profile.id,
        });
      } catch (err) {
        if (err instanceof ApprovalError) {
          // The caller can act on every one of these — regenerate a stale draft, fix a
          // point value — so the message is theirs to read rather than a 500.
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Posts the comment for an already-approved grade.
   *
   * The grade and the comment are written separately on purpose, so a GitHub outage
   * during approval leaves a recorded grade and an unposted comment. This is the way
   * out of that state that does not involve approving twice.
   */
  retryComment: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadSubmissionForInstructor(ctx, input.submissionId);

      try {
        return await retryComment(input.submissionId);
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),
});
