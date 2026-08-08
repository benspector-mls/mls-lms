import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  NoRunnerConfiguredError,
  UnknownRunnerPresetError,
  resolveRunner,
} from "@/lib/sandbox/presets";
import { runTestsForSubmission } from "@/lib/sandbox/run-tests";
import { type AuthedCtx, createTRPCRouter, instructorProcedure } from "../init";

/**
 * Deterministic test execution, instructor-only.
 *
 * Every procedure here reads across students, so each one checks that the caller
 * teaches the course rather than relying on `instructorProcedure` alone.
 */

/** Columns safe to send to the browser. Keeps future additions opt-in. */
const testRunFields = {
  id: true,
  headSha: true,
  trigger: true,
  status: true,
  runnerPreset: true,
  e2bTemplate: true,
  templateCommitSha: true,
  setupExitCode: true,
  testExitCode: true,
  testsTotal: true,
  testsPassed: true,
  testsFailed: true,
  testsSkipped: true,
  passRate: true,
  results: true,
  tamperedPaths: true,
  stdoutTail: true,
  stderrTail: true,
  errorDetail: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  setupDurationMs: true,
} as const;

/**
 * Resolves a submission and confirms the caller teaches its course.
 *
 * Returns the assignment's runner configuration alongside, because every caller
 * needs it and loading it separately would mean a second query.
 */
async function loadSubmissionForInstructor(ctx: AuthedCtx, submissionId: string) {
  const submission = await ctx.db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      repoFullName: true,
      headSha: true,
      prNumber: true,
      assignment: {
        select: {
          id: true,
          title: true,
          courseId: true,
          runnerPreset: true,
          runnerConfig: true,
        },
      },
    },
  });

  if (!submission) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found." });
  }

  const teaches =
    ctx.profile.role === "ADMIN" ||
    (await ctx.db.courseInstructor.findFirst({
      where: { courseId: submission.assignment.courseId, userId: ctx.profile.id },
      select: { id: true },
    })) !== null;

  if (!teaches) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not teach the course this submission belongs to.",
    });
  }

  return submission;
}

export const testRunsRouter = createTRPCRouter({
  /**
   * Runs the assignment's suite against one submission, awaited inside the request.
   *
   * Nothing about awaiting it is production-shaped, and it is not meant to be. It
   * means the sandbox can be debugged from a stack trace rather than through a
   * queue. Automatic triggering from the webhook is a later phase and calls
   * `runTestsForSubmission` unchanged.
   */
  start: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const submission = await loadSubmissionForInstructor(ctx, input.submissionId);

      try {
        return await runTestsForSubmission(submission.id, { trigger: "MANUAL" });
      } catch (err) {
        // An assignment with no tests has not failed at anything, so this is a
        // precondition rather than a server error. The interface should not offer
        // the button at all in this case; reaching here means it did.
        if (err instanceof NoRunnerConfiguredError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        // A configuration mistake, visible before any sandbox was created.
        if (err instanceof UnknownRunnerPresetError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        // A submission with no pull request yet, which is a normal state early on.
        if (err instanceof Error && err.name === "SubmissionNotReadyError") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Every run for one submission, newest first.
   *
   * An empty array is a normal result and never an error. An assignment whose
   * preset is "none" has no runs and never will, which is why `runnerPreset` is
   * returned alongside: the interface needs it to tell "this assignment has no
   * tests" apart from "the tests have not been run yet".
   */
  listForSubmission: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const submission = await loadSubmissionForInstructor(ctx, input.submissionId);

      const runs = await ctx.db.testRun.findMany({
        where: { submissionId: submission.id },
        orderBy: { startedAt: "desc" },
        select: testRunFields,
      });

      let presetError: string | null = null;
      try {
        resolveRunner(submission.assignment);
      } catch (err) {
        presetError = err instanceof Error ? err.message : String(err);
      }

      return {
        runs,
        runnerPreset: submission.assignment.runnerPreset,
        hasRunner: submission.assignment.runnerPreset !== "none" && presetError === null,
        presetError,
        /** False when there is nothing to test yet, so the button can explain why. */
        canRun: Boolean(
          submission.repoFullName && submission.headSha && submission.prNumber !== null,
        ),
      };
    }),

  /** One run in full, including per-test detail. */
  get: instructorProcedure
    .input(z.object({ testRunId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.testRun.findUnique({
        where: { id: input.testRunId },
        select: { ...testRunFields, submissionId: true },
      });

      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Test run not found." });

      // Authorization lives on the submission, so it is checked there rather than
      // duplicated here.
      await loadSubmissionForInstructor(ctx, run.submissionId);
      return run;
    }),
});
