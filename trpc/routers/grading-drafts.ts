import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isManualOnly, manualSections } from "@/lib/assignments/spec";
import { assertWithinRate, DRAFT_GENERATION_LIMIT } from "@/lib/audit/rate-limit";
import { auditActor, recordEvent } from "@/lib/audit/record";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  approveDraft,
  ApprovalError,
  deliveryOutcome,
  effectiveSection,
  retryComment,
} from "@/lib/grade/approve";
import { teachableSubmission } from "@/lib/courses/scope";
import { GradingAssetsError } from "@/lib/grade/assets";
import { generateReportForSubmission, ReportGenerationError } from "@/lib/grade/generate-report";
import { ProviderError } from "@/lib/grade/provider";
import { ReportValidationError } from "@/lib/grade/schema";
import { createTRPCRouter, instructorProcedure } from "../init";

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

/**
 * Refuses a draft on one member's copy of their team's grade.
 *
 * Drafts hang off the row holding the work, so every procedure that *creates* one has to say so —
 * generating a report, opening a hand-graded round, and correcting a released grade. Without it an
 * instructor arriving from a mirror's gradebook cell opens a blank second round nobody will ever
 * release, and `approveDraft` then refuses it with a message about a different screen.
 *
 * One function rather than three copies of the sentence, for the reason `lib/courses/membership.ts`
 * gives about its own pair: the risk is not writing it differently, it is not noticing there was
 * something to write.
 */
function refuseIfMirror(submission: { teamSubmissionId: string | null }, act: string): void {
  if (submission.teamSubmissionId === null) return;

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `This submission is one member's copy of their team's grade, so it is not where the work ` +
      `is ${act}. Open the team's own submission instead.`,
  });
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
      const submission = await teachableSubmission(ctx, input.submissionId, {
        id: true,
        headSha: true,
        prNumber: true,
        repoFullName: true,
        teamSubmissionId: true,
        assignment: { select: { id: true, title: true, courseId: true, sections: true } },
      });

      /*
        Before the rate limit, deliberately. `generateReportForSubmission` refuses a mirror too,
        but reaching it would already have spent an attempt against the caller's limit — and what
        that limit counts is spending, so a refusal that costs nothing must not count.
      */
      refuseIfMirror(submission, "graded");

      const actor = auditActor(ctx);

      await assertWithinRate(ctx.db, {
        actorId: actor.id,
        action: "DRAFT_GENERATED",
        limit: DRAFT_GENERATION_LIMIT,
        whatTheyDid: "generate another draft",
      });

      /*
        Recorded before the call rather than after, and that ordering is the limit.

        Counting only successful generations would let a failing loop run without bound: every
        attempt spends the model call, and a run that throws after the tokens are gone has cost
        exactly as much as one that returned. What is being limited is spending, so what is
        counted is attempts.
      */
      await recordEvent(ctx.db, {
        action: "DRAFT_GENERATED",
        actor,
        subject: { id: submission.id, label: submission.assignment.title },
        course: { id: submission.assignment.courseId },
      });

      try {
        return await generateReportForSubmission(submission.id);
      } catch (err) {
        // Preconditions rather than server errors: the submission is not ready, or
        // the assignment is not configured. Both are fixable and neither is a bug.
        if (err instanceof ReportGenerationError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        // An unset GRADING_ASSETS_REPO, an installation that cannot see it, or a renamed
        // rubric heading. An operator problem, and the message says which.
        if (err instanceof GradingAssetsError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        // Reached only when the failure happened before a draft row existed;
        // afterwards these are recorded on the row as FAILED instead of thrown.
        if (err instanceof ProviderError || err instanceof ReportValidationError) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Opens an empty draft for an instructor to write into.
   *
   * The whole of hand grading. A manual grade is not a separate screen or a separate record —
   * it is a `GradingDraft` whose sections start blank and whose `modelMetadata` is null,
   * edited through the same editor and released through the same `approve`. Everything
   * downstream of approval already works without caring where the text came from: the
   * gradebook, the student's feedback screen, the score history, and the feedback rounds a
   * resubmission accumulates.
   *
   * One row per section the assignment declares, so the point total the instructor scores out
   * of is the assignment's own rather than a number typed twice.
   */
  startManual: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await teachableSubmission(ctx, input.submissionId, {
        id: true,
        headSha: true,
        prNumber: true,
        repoFullName: true,
        teamSubmissionId: true,
        assignment: { select: { id: true, title: true, courseId: true, sections: true } },
      });

      refuseIfMirror(submission, "graded");

      const sections = manualSections(submission.assignment.sections);

      if (sections.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This assignment has no sections graded by hand, so there is nothing to open. " +
            "Generate a report instead.",
        });
      }

      /*
        An existing draft is returned rather than a second one created. Pressing the button
        twice is the ordinary way this happens — the first press is slow enough to look like
        nothing happened — and two blank drafts for one submission would leave an instructor
        choosing between identical empty forms, one of which their edits are not in.
      */
      const open = await ctx.db.gradingDraft.findFirst({
        where: {
          submissionId: submission.id,
          status: "READY",
          approvedAt: null,
          // `DbNull` rather than `null`: on a nullable Json column, Prisma needs to be told
          // whether it is matching a SQL NULL or the JSON value `null`, and this column being
          // absent is the SQL one.
          modelMetadata: { equals: Prisma.DbNull },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (open) return open;

      return ctx.db.gradingDraft.create({
        data: {
          submissionId: submission.id,
          /*
            The commit the work was at when grading started, and null when there is no commit
            — a document or an upload. Recorded rather than left null for a repository
            assignment graded by hand, because everything that later asks "has this been
            revised since it was graded" compares the two, and a null here would make a
            hand-graded repository submission permanently unable to answer it.
          */
          headSha: submission.headSha,
          // READY, because it is: there is nothing to wait for and nothing to check. The
          // status describes whether the draft can be reviewed, not whether it is finished —
          // an unscored section is refused at approval, which is where it matters.
          status: "READY",
          // Null is what marks this as hand-written rather than generated. The review screen
          // reads it to decide whether to show what a model claimed.
          modelMetadata: undefined,
          sections: {
            create: sections.map((section) => ({
              // The instructor's own label, which is what a manual section has instead of a
              // type. It is what the review screen and the feedback history call it.
              sectionType: section.label,
              reportMarkdown: null,
              scoreEarned: null,
              scorePossible: section.pointValue,
            })),
          },
        },
        select: { id: true },
      });
    }),

  /**
   * Opens a correction to a grade that has already gone out.
   *
   * An instructor who mistypes a score, or reads a sentence back and would put it differently,
   * previously had no way to act on it: `updateSection` refuses to touch an approved draft, and
   * the only route to another round was the student handing work in again. So a wrong grade
   * stayed wrong until the student did something about it, which is the wrong person entirely.
   *
   * **A new round rather than an edit of the released one.** What the student was told is a
   * matter of record — on a repository it is a comment on their pull request, which cannot be
   * unsaid — so a correction is added beside the first round rather than over it, and releasing
   * it posts its own comment. That is the same rule `updateSection` enforces and the same reason:
   * changing the record of what somebody was told, without changing what they saw, leaves the
   * two disagreeing and nobody able to tell which happened.
   *
   * **Pre-filled with what was sent, which is the whole point.** The alternative — the blank
   * draft `startManual` opens — means retyping a whole report to change one number, and an
   * instructor who does that is being asked to rewrite work they already did. The copied values
   * are the *effective* ones, so a section the instructor already edited is carried forward as
   * they left it rather than as the model first wrote it.
   *
   * The model's own artifacts are deliberately not copied. Rubric rows, flags, confidence, and
   * instructor notes describe a run that produced the previous round; attaching them to a round
   * a person wrote by hand would credit the model with a judgment it did not make. `modelMetadata`
   * is null for the same reason, which is also what the review screen reads to know no model
   * wrote this.
   */
  reviseReleased: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await teachableSubmission(ctx, input.submissionId, {
        id: true,
        headSha: true,
        teamSubmissionId: true,
      });

      refuseIfMirror(submission, "corrected");

      /*
        An unapproved draft already is the round in progress, so it is returned rather than a
        second one created — the reason `startManual` does the same. Pressing this twice is the
        ordinary way it happens, and two drafts for one submission leaves an instructor choosing
        between forms, one of which their writing is not in.
      */
      const open = await ctx.db.gradingDraft.findFirst({
        where: {
          submissionId: submission.id,
          approvedAt: null,
          status: { in: ["GENERATING", "READY", "NEEDS_MANUAL_REVIEW"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (open) return open;

      const released = await ctx.db.gradingDraft.findFirst({
        where: { submissionId: submission.id, status: "APPROVED" },
        orderBy: { approvedAt: "desc" },
        select: {
          sections: {
            // Deterministic, so the corrected round reads in the order the released one did.
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              sectionType: true,
              reportMarkdown: true,
              scoreEarned: true,
              scorePossible: true,
              editedReportMarkdown: true,
              editedScoreEarned: true,
            },
          },
        },
      });

      if (!released) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Nothing has been released for this submission yet, so there is no grade to " +
            "correct. Grade it the ordinary way.",
        });
      }

      return ctx.db.gradingDraft.create({
        data: {
          submissionId: submission.id,
          /*
            The commit the work is at now, not the one the released round described. This round
            is a judgment about the code that is there, and everything that later asks "has this
            been revised since it was graded" compares against what approval records from here.
          */
          headSha: submission.headSha,
          status: "READY",
          // Null marks this as written by a person rather than a model — see the note above.
          modelMetadata: undefined,
          sections: {
            create: released.sections.map((section) => {
              // The instructor's edit where they made one, the model's output where they did not.
              // The same function approval uses to decide what to post, so a correction starts
              // from exactly the text and score the student received.
              const sent = effectiveSection(section);

              return {
                sectionType: sent.sectionType,
                reportMarkdown: sent.reportMarkdown,
                scoreEarned: sent.scoreEarned,
                scorePossible: sent.scorePossible,
              };
            }),
          },
        },
        select: { id: true },
      });
    }),

  /**
   * Discards an unreleased round without sending it.
   *
   * The way back out. Opening a correction, or generating a report and deciding not to use it,
   * otherwise left a submission with an unapproved draft on top of it — which reads as work
   * waiting in triage, in the grading queue, and on the review screen, where the released grade
   * it hides is the thing an instructor actually wanted to see. There was no way to say "never
   * mind": the only exit was approving something, and approving a correction nobody needed posts
   * a second comment to a student for no reason.
   *
   * `SUPERSEDED` rather than deleted, and the status is chosen rather than invented: everything
   * already reads it as history rather than as a state to act on. Approval refuses it,
   * `draftStatusAddsSomething` keeps it off the submission's badge, `triageBucket` falls through
   * it to the submission's own status, and every "most recent round" query excludes it — so a
   * discarded round leaves a released grade reading exactly as it did before the correction was
   * opened, and shows up nowhere an instructor looks.
   *
   * **The row stays, and deleting it would cost two things.** A generated report spent real
   * tokens whether or not anyone kept it, and `scripts/cost.ts` prices every draft from the usage
   * it stored — dismissed runs are precisely the ones worth seeing there, being the ones that
   * produced nothing usable. And a report an instructor rejected outright is the strongest
   * evidence the grading is off; keeping only the accepted ones would leave any later judgment
   * of quality reading from a sample that cannot disagree with itself.
   *
   * Two refusals. An approved round is feedback a student has read, and unsaying it is not
   * something this can do. A run still in flight cannot be discarded either — see below.
   */
  discard: instructorProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.db.gradingDraft.findUnique({
        where: { id: input.draftId },
        select: { id: true, submissionId: true, status: true, approvedAt: true },
      });

      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });

      // Authorization lives on the submission, so it is checked there rather than duplicated
      // here — the same arrangement as `get` and `updateSection`.
      await teachableSubmission(ctx, draft.submissionId, { id: true });

      if (draft.approvedAt !== null || draft.status === "APPROVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This feedback has already been released, so it cannot be discarded — the student " +
            "has read it. Open a correction if the grade needs changing.",
        });
      }

      /*
        A run still writing to this row cannot be discarded, because discarding it would not
        stick: `generateReportForSubmission` sets the round it claimed to READY when it finishes,
        which would raise a discarded round from the dead as work waiting on somebody. Refused
        rather than raced, and refused with the wait it needs — the run is a minute or two, and
        discarding afterwards does what was meant.
      */
      if (draft.status === "GENERATING") {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A report is still being generated for this submission. Wait for it to finish — " +
            "a couple of minutes — and discard it then.",
        });
      }

      // Already discarded. Returned rather than refused, because pressing the button twice is
      // not an error and the second press wants the same outcome as the first.
      if (draft.status === "SUPERSEDED") return { id: draft.id, status: draft.status };

      return ctx.db.gradingDraft.update({
        where: { id: draft.id },
        data: { status: "SUPERSEDED" },
        select: { id: true, status: true },
      });
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
      const submission = await teachableSubmission(ctx, input.submissionId, {
        id: true,
        headSha: true,
        prNumber: true,
        repoFullName: true,
        assignment: { select: { id: true, title: true, courseId: true, sections: true } },
      });

      const drafts = await ctx.db.gradingDraft.findMany({
        where: { submissionId: submission.id },
        orderBy: { createdAt: "desc" },
        select: draftFields,
      });

      const declaredSections = Array.isArray(submission.assignment.sections)
        ? (submission.assignment.sections as { type?: string }[])
        : [];

      // Which of the two ways of grading this assignment applies. Answered here rather than
      // by the interface reading `sections` for itself, because it is the same question
      // triage asks to decide the bucket and the two must not disagree — one saying there is
      // a report to generate while the other says the work is waiting on a person.
      const manualOnly = isManualOnly(submission.assignment.sections);

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
        where: { submissionId: input.submissionId, status: "APPROVED" },
        orderBy: { approvedAt: "desc" },
        select: { id: true, postedPrCommentId: true },
      });

      return {
        drafts,
        /**
         * Whether this assignment is graded by hand rather than by the pipeline, which decides
         * which action the review screen offers. Never both: a report cannot be generated for
         * an assignment with nothing the model can read, and offering the button would promise
         * something that cannot happen.
         */
        manualOnly,
        /** Whether an empty draft can be opened to write a grade into. */
        canGradeByHand: manualOnly && manualSections(submission.assignment.sections).length > 0,
        /**
         * True when there is something to grade. A submission with no pull request,
         * or an assignment with no sections mapping, cannot produce a report — and
         * saying so is more useful than a button that throws.
         */
        canGenerate:
          !manualOnly &&
          submission.prNumber !== null &&
          submission.headSha !== null &&
          declaredSections.length > 0,
        blockedReason: manualOnly
          ? null
          : submission.prNumber === null || submission.headSha === null
            ? "The student has not opened a pull request yet."
            : declaredSections.length === 0
              ? "This assignment has no sections mapping, so there is no rubric to grade against."
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
           * What became of the most recent approval's comment, by name. Null when nothing
           * has been approved: there is no comment to have gone out or not.
           *
           * Computed here rather than in the browser, because `deliveryOutcome` is the one
           * authority on the difference between a comment that failed and one there was
           * never anywhere to send — and the interface holds a submission whose null
           * `prNumber` it would otherwise have to interpret for itself.
           */
          delivery: latestApproval ? deliveryOutcome(latestApproval, submission) : null,
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

      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });

      // Authorization lives on the submission, so it is checked there rather than
      // duplicated here.
      await teachableSubmission(ctx, draft.submissionId, { id: true });
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
      if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found." });

      await teachableSubmission(ctx, section.gradingDraft.submissionId, { id: true });

      // An approved draft is a round of feedback the student has already read. Editing
      // it would change the record of what they were told without changing what they
      // saw, so a revision means a new draft and a new comment.
      if (section.gradingDraft.approvedAt !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This draft has already been sent to the student. Generate a new report to " +
            "revise the grade — the student keeps both, which is the point of the history.",
        });
      }

      if (
        input.scoreEarned !== null &&
        section.scorePossible !== null &&
        input.scoreEarned > section.scorePossible
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
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
          editedAt: input.reportMarkdown === null && input.scoreEarned === null ? null : new Date(),
          editedById:
            input.reportMarkdown === null && input.scoreEarned === null ? null : ctx.profile.id,
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
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });

      await teachableSubmission(ctx, draft.submissionId, { id: true });

      try {
        return await approveDraft({
          draftId: input.draftId,
          approvedByProfileId: ctx.profile.id,
          // The request's own client rather than the module's, which is what lets a caller
          // driving this inside a transaction see its own rows — how the approval path is
          // checked against real data without writing any. In production it is the module's
          // client, and `approveDraft` compares the two by identity rather than asking whether
          // a client was passed, so a real request still gets one transaction around the whole
          // release.
          client: ctx.db,
        });
      } catch (err) {
        if (err instanceof ApprovalError) {
          // The caller can act on every one of these — regenerate a stale draft, fix a
          // point value — so the message is theirs to read rather than a 500.
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
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
      await teachableSubmission(ctx, input.submissionId, { id: true });

      try {
        return await retryComment(input.submissionId);
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),
});
