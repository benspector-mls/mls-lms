import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { MAX_ATTEMPTS, nextAttempt } from "@/lib/checks/attempts";
import { CHECK_LEVELS } from "@/lib/checks/levels";
import { CheckReviewError, reviewCheckAnswer } from "@/lib/checks/review";
import { assertActiveStudent, assertCourseMember, enrollmentsIn } from "@/lib/courses/membership";
import { teachableCheck, teachableCheckAttempt } from "@/lib/courses/scope";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Tx } from "@/lib/prisma";
import { formatDateTime } from "@/lib/status";

import { courseProcedure, createTRPCRouter, instructorProcedure, profileProcedure } from "../init";
import { personSelect } from "../selects";

/**
 * Checks for understanding: a fellow's attempts at the question attached to a resource, and what
 * the review made of each.
 *
 * **Nothing here is graded.** No procedure in this file touches a submission, a score, or the
 * gradebook, and no grading screen reads these tables. A check is a reading of understanding — for
 * the fellow, practice in saying what they understood; for the instructor, a picture of how a
 * concept landed across the room.
 *
 * The check itself is written by `resources.create` and `resources.update`, because it is authored
 * in the same dialog as its resource and saved in the same request. What lives here is everything
 * that happens after: answering, reading the answers back, and an instructor's corrections.
 *
 * **Two audiences, kept apart by procedure rather than by filtering one reply.** A fellow's
 * procedures never return the level-2 example, never return the level-3 exemplar until the attempts
 * are used up, and never return model metadata. The instructor's procedures return all three, and
 * each refuses a caller who does not teach the course.
 */

/** One attempt, as the fellow who made it reads it. */
const fellowAttemptSelect = {
  id: true,
  attempt: true,
  submittedAt: true,
  answer: true,
  wantsHelp: true,
  level: true,
  instructorLevel: true,
  explanation: true,
  reviewError: true,
} satisfies Prisma.CheckAttemptSelect;

/** One attempt, as an instructor reads it: the same, plus when a level was set by hand. */
const instructorAttemptSelect = {
  ...fellowAttemptSelect,
  instructorLevelAt: true,
} satisfies Prisma.CheckAttemptSelect;

/** What the review needs to know about a check. */
const reviewableCheckSelect = {
  objective: true,
  question: true,
  factsExample: true,
  exemplar: true,
} satisfies Prisma.CheckForUnderstandingSelect;

type ReviewableCheck = Prisma.CheckForUnderstandingGetPayload<{
  select: typeof reviewableCheckSelect;
}>;

type FellowAttempt = Prisma.CheckAttemptGetPayload<{ select: typeof fellowAttemptSelect }>;

/**
 * A fellow's standing on one check: their attempts, and the exemplar if they have earned it.
 *
 * **The server decides when the exemplar is released**, on the same rule the fellow's screen draws
 * from. A screen that received the exemplar all along and hid it would be a fellow one network tab
 * away from the answer.
 */
function progressOf(
  check: { id: string; retryWaitHours: number; exemplar: string },
  attempts: FellowAttempt[],
  now: Date,
) {
  const released = nextAttempt(attempts, check.retryWaitHours, now).kind === "exhausted";
  return {
    checkId: check.id,
    attempts,
    exemplar: released ? check.exemplar : null,
  };
}

/**
 * Runs the review on one attempt and records what came of it.
 *
 * **The attempt is already stored when this runs**, for the reason `DRAFT_GENERATED` is recorded
 * before the model call in grading: the thing that costs is the attempt, and the thing that matters
 * to the fellow is that their answer landed. So a failed review is recorded on the row, where an
 * instructor can see it and run it again, rather than thrown at the fellow as a failed request. An
 * error the review did not anticipate is recorded the same way and logged, for the same reason.
 *
 * A failure leaves any earlier level and explanation where they were, so re-reviewing an attempt
 * that already had a level and failing does not take the level away.
 */
async function applyReview(
  db: Tx,
  attemptId: string,
  check: ReviewableCheck,
  answer: string,
): Promise<void> {
  try {
    const review = await reviewCheckAnswer({ ...check, answer });
    await db.checkAttempt.update({
      where: { id: attemptId },
      data: {
        level: review.level,
        explanation: review.explanation,
        reviewError: null,
        // The shape `grading_drafts.model_metadata` uses, so `npm run cost` prices both alike.
        modelMetadata: {
          provider: review.provider,
          modelId: review.modelId,
          promptVersion: review.promptVersion,
          usage: review.usage,
          sectionsGraded: ["check_for_understanding"],
        },
      },
    });
  } catch (err) {
    const message =
      err instanceof CheckReviewError
        ? err.message
        : "The review failed for a reason it did not report. Review again to retry.";
    if (!(err instanceof CheckReviewError)) {
      console.error("Check for understanding review failed", err);
    }
    await db.checkAttempt.update({ where: { id: attemptId }, data: { reviewError: message } });
  }
}

export const checksRouter = createTRPCRouter({
  /**
   * The caller's attempts at every check in a course, grouped by check.
   *
   * `profileProcedure` and `assertCourseMember`, the pair `resources.listForCourse` uses: a fellow's
   * course page reads this beside it, and a removed fellow keeps reading what they wrote, the same
   * way they keep reading their feedback. An instructor has no attempts, so an instructor opening
   * the page gets an empty list rather than a refusal that would fail the page.
   */
  myAttempts: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);

      const checks = await ctx.db.checkForUnderstanding.findMany({
        where: {
          resource: { courseUnit: { courseId: input.courseId } },
          attempts: { some: { studentId: ctx.profile.id } },
        },
        select: {
          id: true,
          retryWaitHours: true,
          exemplar: true,
          attempts: {
            where: { studentId: ctx.profile.id },
            orderBy: { attempt: "asc" },
            select: fellowAttemptSelect,
          },
        },
      });

      const now = new Date();
      return checks.map((check) => progressOf(check, check.attempts, now));
    }),

  /**
   * One attempt at a check, reviewed before the call returns.
   *
   * The review takes a few seconds and the fellow waits for it: the level arriving while they are
   * still looking at what they wrote is most of the point.
   */
  answer: profileProcedure
    .input(
      z.object({
        checkId: z.string().uuid(),
        answer: z.string().trim().min(1, "Write an answer first.").max(5_000),
        wantsHelp: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const check = await ctx.db.checkForUnderstanding.findUnique({
        where: { id: input.checkId },
        select: {
          id: true,
          retryWaitHours: true,
          ...reviewableCheckSelect,
          resource: { select: { courseUnit: { select: { courseId: true } } } },
        },
      });
      if (!check) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That check does not exist." });
      }

      // A removed fellow may read their attempts but not make another, the line every hand-in draws.
      await assertActiveStudent(ctx, check.resource.courseUnit.courseId);

      const earlier = await ctx.db.checkAttempt.findMany({
        where: { checkId: check.id, studentId: ctx.profile.id },
        select: { attempt: true, submittedAt: true },
      });

      /*
        The same rule the fellow's screen draws from, so these sentences are the ones the screen
        already shows. A fellow reads them here only if their page was stale.
      */
      const state = nextAttempt(earlier, check.retryWaitHours, new Date());
      if (state.kind === "exhausted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You have used all ${MAX_ATTEMPTS} attempts at this check.`,
        });
      }
      if (state.kind === "waiting") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can try this check again after ${formatDateTime(state.until)}.`,
        });
      }

      /*
        `createMany` with `skipDuplicates` rather than `create` in a try/catch. The unique index on
        (check, fellow, attempt) is what makes a double-click one attempt, and `skipDuplicates`
        compiles to `ON CONFLICT DO NOTHING`, which settles on that index without raising. A raised
        P2002 would abort the surrounding transaction wherever there is one — the integration suites
        run every procedure inside one — which is the reasoning the attendance router records above
        its own `createMany`.
      */
      const inserted = await ctx.db.checkAttempt.createMany({
        data: [
          {
            checkId: check.id,
            studentId: ctx.profile.id,
            attempt: state.attempt,
            answer: input.answer,
            wantsHelp: input.wantsHelp,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "That attempt was already recorded." });
      }

      const attempt = await ctx.db.checkAttempt.findUniqueOrThrow({
        where: {
          checkId_studentId_attempt: {
            checkId: check.id,
            studentId: ctx.profile.id,
            attempt: state.attempt,
          },
        },
        select: { id: true },
      });

      await applyReview(ctx.db, attempt.id, check, input.answer);

      const attempts = await ctx.db.checkAttempt.findMany({
        where: { checkId: check.id, studentId: ctx.profile.id },
        orderBy: { attempt: "asc" },
        select: fellowAttemptSelect,
      });

      // The whole standing on this check, so the third attempt's reply carries the exemplar.
      return progressOf(check, attempts, new Date());
    }),

  /**
   * What the instructor's curriculum screen needs about a course's checks that a fellow must not
   * receive.
   *
   * **Its own procedure rather than more fields on `courseUnits.listForCourse`**, because that one
   * admits fellows, and the objective and the two examples must not be in anything a fellow can
   * call: any of the three can give the answer away.
   *
   * `answered` counts fellows, not attempts: somebody on their second attempt has answered once as
   * far as "how many have answered" is concerned. Both numbers leave test students out, as every
   * reader that reports a number of students does; the attempts page still lists them, badged, so a
   * test course can read "0 of 1 answered" above a page of test students' answers.
   */
  forCourse: courseProcedure.query(async ({ ctx, input }) => {
    const course = await ctx.db.course.findUniqueOrThrow({
      where: { id: input.courseId },
      select: { programId: true },
    });

    const [activeStudents, checks, answeredPairs] = await Promise.all([
      ctx.db.enrollment.count({
        where: {
          ...enrollmentsIn(course.programId),
          status: "ACTIVE",
          student: { testStudentNumber: null },
        },
      }),
      ctx.db.checkForUnderstanding.findMany({
        where: { resource: { courseUnit: { courseId: input.courseId } } },
        select: {
          id: true,
          resourceId: true,
          objective: true,
          factsExample: true,
          exemplar: true,
          retryWaitHours: true,
        },
      }),
      // One row per (check, fellow) pair: distinct fellows, which a `_count` cannot say.
      ctx.db.checkAttempt.groupBy({
        by: ["checkId", "studentId"],
        where: {
          check: { resource: { courseUnit: { courseId: input.courseId } } },
          // Active, real fellows only, so a removed fellow's answer cannot make it "4 of 3".
          student: {
            testStudentNumber: null,
            enrollments: { some: { programId: course.programId, status: "ACTIVE" } },
          },
        },
      }),
    ]);

    const answered = new Map<string, number>();
    for (const pair of answeredPairs) {
      answered.set(pair.checkId, (answered.get(pair.checkId) ?? 0) + 1);
    }

    return {
      activeStudents,
      checks: checks.map((check) => ({
        checkId: check.id,
        resourceId: check.resourceId,
        objective: check.objective,
        factsExample: check.factsExample,
        exemplar: check.exemplar,
        retryWaitHours: check.retryWaitHours,
        answered: answered.get(check.id) ?? 0,
      })),
    };
  }),

  /**
   * One check, and every active fellow's attempts at it — including the fellows who have not
   * answered, whose histories are empty.
   *
   * The roster is the program's, because a course has none of its own. The cohort filter is not
   * applied: a class fits on one screen, and "who has not answered yet" wants everybody.
   */
  attemptsFor: instructorProcedure
    .input(z.object({ checkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const check = await teachableCheck(ctx, input.checkId, {
        id: true,
        objective: true,
        question: true,
        factsExample: true,
        exemplar: true,
        retryWaitHours: true,
        resource: {
          select: {
            title: true,
            courseUnit: { select: { courseId: true, course: { select: { programId: true } } } },
          },
        },
      });

      const enrollments = await ctx.db.enrollment.findMany({
        where: { ...enrollmentsIn(check.resource.courseUnit.course.programId), status: "ACTIVE" },
        select: { student: { select: personSelect } },
      });

      const attempts = await ctx.db.checkAttempt.findMany({
        where: {
          checkId: check.id,
          studentId: { in: enrollments.map((enrollment) => enrollment.student.id) },
        },
        orderBy: { attempt: "asc" },
        select: { ...instructorAttemptSelect, studentId: true },
      });

      const byStudent = new Map<string, typeof attempts>();
      for (const attempt of attempts) {
        byStudent.set(attempt.studentId, [...(byStudent.get(attempt.studentId) ?? []), attempt]);
      }

      return {
        check: {
          id: check.id,
          courseId: check.resource.courseUnit.courseId,
          resourceTitle: check.resource.title,
          objective: check.objective,
          question: check.question,
          factsExample: check.factsExample,
          exemplar: check.exemplar,
          retryWaitHours: check.retryWaitHours,
        },
        rows: enrollments.map(({ student }) => ({
          student,
          attempts: byStudent.get(student.id) ?? [],
        })),
      };
    }),

  /**
   * An instructor's level over the top of the review's, on one attempt — or null to let the
   * review's stand again.
   *
   * Per attempt, because the instructor is correcting a reading of one answer, and a fellow's later
   * attempt is a different answer.
   */
  setLevel: instructorProcedure
    .input(z.object({ attemptId: z.string().uuid(), level: z.enum(CHECK_LEVELS).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await teachableCheckAttempt(ctx, input.attemptId, { id: true });

      return ctx.db.checkAttempt.update({
        where: { id: input.attemptId },
        data:
          input.level === null
            ? { instructorLevel: null, instructorLevelById: null, instructorLevelAt: null }
            : {
                instructorLevel: input.level,
                instructorLevelById: ctx.profile.id,
                instructorLevelAt: new Date(),
              },
        select: instructorAttemptSelect,
      });
    }),

  /**
   * Runs the review on an attempt again.
   *
   * For the morning the API was down during a class, and for after an example was edited. It runs on
   * any attempt, not only a failed one, and it leaves an instructor's level alone: that stands until
   * it is cleared.
   */
  reviewAgain: instructorProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await teachableCheckAttempt(ctx, input.attemptId, {
        id: true,
        answer: true,
        check: { select: reviewableCheckSelect },
      });

      await applyReview(ctx.db, attempt.id, attempt.check, attempt.answer);

      return ctx.db.checkAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        select: instructorAttemptSelect,
      });
    }),
});
