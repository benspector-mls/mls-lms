import "server-only";

import { db } from "../prisma";
import { repositorySource } from "../assignments/spec";
import { getConfiguredInstallationId } from "../github/app-client";
import {
  downloadRepoArchive,
  getDefaultBranch,
  resolveRefToSha,
  splitRepoFullName,
} from "../github/archives";
import { getPullRequestFileChanges } from "../github/prs";
import type { TestRun, TestRunTrigger } from "../generated/prisma/client";
import {
  RESULTS_DIR,
  TEMPLATE_DIR,
  WORK_DIR,
  createSandbox,
  killSandbox,
  readTextFile,
  revokeNetworkAccess,
  runCommand,
  uploadAndExtract,
  type SandboxHandle,
} from "./e2b";
import { ResultParseError, computePassRate, parseResults } from "./parsers";
import { NoRunnerConfiguredError, resolveRunner, type ResolvedRunner } from "./presets";
import { findTamperedPaths } from "./protected-paths";
import { restoreProtectedPaths } from "./restore";

/**
 * Running an assignment's test suite against a student's submission.
 *
 * The output is a stored, trustworthy answer to one question: what do the
 * instructor's tests say about this student's code at this commit? No language
 * model is involved and nothing is posted to GitHub.
 *
 * `runTestsForSubmission` takes a submission id and reads everything else itself.
 * It does not know what invoked it. That is the whole accommodation this phase
 * makes for the orchestration decision that is still open: whichever design is
 * chosen later, its worker loop or its step function calls exactly this.
 */

/** Truncated before storage. Whole suites can emit megabytes. */
const MAX_OUTPUT_TAIL = 8_000;

function tail(output: string): string | null {
  if (!output) return null;
  return output.length > MAX_OUTPUT_TAIL ? output.slice(-MAX_OUTPUT_TAIL) : output;
}

/**
 * How much longer than the test command the sandbox itself may live.
 *
 * Deliberately generous. If the sandbox expired first, a student's infinite loop
 * would be indistinguishable from an infrastructure failure, and the two need
 * different responses.
 */
const SANDBOX_LIFETIME_MARGIN_MS = 180_000;

class SubmissionNotReadyError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SubmissionNotReadyError";
  }
}

export async function runTestsForSubmission(
  submissionId: string,
  opts: { trigger: TestRunTrigger },
): Promise<TestRun> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      repoFullName: true,
      headSha: true,
      prNumber: true,
      assignment: {
        select: {
          title: true,
          kind: true,
          templateRepo: true,
          assignmentRepoName: true,
          githubOrg: true,
          templateRef: true,
          runnerPreset: true,
          runnerConfig: true,
        },
      },
    },
  });

  if (!submission) throw new SubmissionNotReadyError(`No submission ${submissionId}.`);

  const { assignment } = submission;

  // Thrown rather than written as an ERRORED row. An assignment with no tests has
  // not failed at anything, and a table of ERRORED rows against every short
  // response submission would be noise hiding real infrastructure failures.
  const runner = resolveRunner(assignment);
  if (!runner) throw new NoRunnerConfiguredError(assignment.title);

  if (!submission.repoFullName || !submission.headSha) {
    throw new SubmissionNotReadyError(
      `Submission ${submissionId} has no repository or no head commit yet. ` +
      `A student has to accept the assignment and open a pull request first.`,
    );
  }
  if (submission.prNumber === null) {
    throw new SubmissionNotReadyError(
      `Submission ${submissionId} has no pull request. The tamper report is taken ` +
      `from the pull request's diff, so there is nothing to compare against.`,
    );
  }

  const installationId = getConfiguredInstallationId();
  const studentRepo = splitRepoFullName(submission.repoFullName);
  // Asserted rather than assumed. A kind with no repository cannot reach here today
  // — resolveRunner returns null for it and the check above already threw — but that
  // is a property of the order of two earlier checks, which is not something a reader
  // of this line should have to verify.
  const templateRepo = splitRepoFullName(repositorySource(assignment).templateRepo);

  // RUNNING is written before any slow work begins, so a run that dies partway
  // through leaves a row explaining that it was attempted.
  const run = await db.testRun.create({
    data: {
      submissionId: submission.id,
      headSha: submission.headSha,
      trigger: opts.trigger,
      status: "RUNNING",
      runnerPreset: runner.presetName,
      e2bTemplate: runner.e2bTemplate,
    },
  });

  let handle: SandboxHandle | null = null;
  const startedAt = Date.now();

  try {
    // ---- The template commit whose tests will run -------------------------
    //
    // Null templateRef means the template's default branch, which is the behavior
    // to want during a cohort: a bug fixed in the template reaches every
    // subsequent run, including re-runs for students who accepted before the fix.
    const templateRef =
      assignment.templateRef ?? (await getDefaultBranch(installationId, templateRepo));
    const templateCommitSha = await resolveRefToSha(installationId, {
      ...templateRepo,
      ref: templateRef,
    });

    // ---- The tamper report ------------------------------------------------
    //
    // Taken from the pull request's own diff, which is measured against the
    // template snapshot this student received. It therefore reports exactly what
    // the student changed, and cannot report an instructor's later template fix as
    // a student's edit.
    const changes = await getPullRequestFileChanges(installationId, {
      ...studentRepo,
      pullNumber: submission.prNumber,
    });
    const tamperedPaths = findTamperedPaths(changes, runner.protectedPaths);

    // ---- Both trees, fetched by the server --------------------------------
    //
    // The student's code at the exact commit the webhook recorded, so a push
    // during the run cannot change what these results describe.
    const [studentArchive, templateArchive] = await Promise.all([
      downloadRepoArchive(installationId, { ...studentRepo, ref: submission.headSha }),
      downloadRepoArchive(installationId, { ...templateRepo, ref: templateCommitSha }),
    ]);

    handle = await createSandbox({
      template: runner.e2bTemplate,
      lifetimeMs: runner.timeoutMs + SANDBOX_LIFETIME_MARGIN_MS,
    });

    await db.testRun.update({
      where: { id: run.id },
      data: { sandboxId: handle.sandboxId, templateCommitSha },
    });

    await uploadAndExtract(handle, { tarball: studentArchive.tarball, destDir: WORK_DIR });
    await uploadAndExtract(handle, { tarball: templateArchive.tarball, destDir: TEMPLATE_DIR });

    const { overriddenPackageKeys } = await restoreProtectedPaths(handle, runner);
    const allTamperedPaths = [
      ...tamperedPaths,
      ...overriddenPackageKeys.map((key) => ({ path: key, kind: "modified" as const })),
    ];

    // ---- Setup, with network access ---------------------------------------
    const setup = await runSetup(handle, runner);
    if (setup.exitCode !== 0) {
      // Dependencies could not be installed, so the suite never ran and nothing is
      // known about the student's code. ERRORED, never a zero.
      return await finishErrored(run.id, {
        startedAt,
        setupExitCode: setup.exitCode,
        setupDurationMs: setup.durationMs,
        stdoutTail: tail(setup.stdout),
        stderrTail: tail(setup.stderr),
        tamperedPaths: allTamperedPaths,
        errorDetail:
          `Setup failed with exit code ${setup.exitCode}. The test suite did not run, ` +
          `so this is an infrastructure result and not a score.`,
      });
    }

    // ---- Revoke the network, then run the tests ---------------------------
    //
    // Everything after this line executes student code. Revoking first makes
    // results reproducible and removes the channel to the outside world for
    // exactly the part of the run where student code is what executes.
    await revokeNetworkAccess(handle);

    const test = await runCommand(handle, {
      command: runner.testCommand,
      cwd: WORK_DIR,
      timeoutMs: runner.timeoutMs,
    });

    if (test.timedOut) {
      return await finishRun(run.id, {
        status: "TIMED_OUT",
        startedAt,
        setupExitCode: setup.exitCode,
        setupDurationMs: setup.durationMs,
        testExitCode: test.exitCode,
        stdoutTail: tail(test.stdout),
        stderrTail: tail(test.stderr),
        tamperedPaths: allTamperedPaths,
        errorDetail: `The test command exceeded its ${runner.timeoutMs} ms limit and was killed.`,
      });
    }

    // ---- Read the results back out ----------------------------------------
    if (!runner.resultPath) {
      return await finishErrored(run.id, {
        startedAt,
        setupExitCode: setup.exitCode,
        setupDurationMs: setup.durationMs,
        testExitCode: test.exitCode,
        stdoutTail: tail(test.stdout),
        stderrTail: tail(test.stderr),
        tamperedPaths: allTamperedPaths,
        errorDetail: `Preset "${runner.presetName}" defines no resultPath, so there is nothing to read.`,
      });
    }

    const raw = await readTextFile(handle, runner.resultPath);
    if (raw === null) {
      // A suite that crashes before writing its report produced no information
      // about the student's code. Parse failure is not test failure.
      return await finishErrored(run.id, {
        startedAt,
        setupExitCode: setup.exitCode,
        setupDurationMs: setup.durationMs,
        testExitCode: test.exitCode,
        stdoutTail: tail(test.stdout),
        stderrTail: tail(test.stderr),
        tamperedPaths: allTamperedPaths,
        errorDetail:
          `The test runner wrote no results file at ${runner.resultPath}. It probably ` +
          `crashed before reporting — see stderr.`,
      });
    }

    let results;
    try {
      results = parseResults(runner.resultFormat, raw);
    } catch (err) {
      if (err instanceof ResultParseError) {
        return await finishErrored(run.id, {
          startedAt,
          setupExitCode: setup.exitCode,
          setupDurationMs: setup.durationMs,
          testExitCode: test.exitCode,
          stdoutTail: tail(test.stdout),
          stderrTail: tail(test.stderr),
          tamperedPaths: allTamperedPaths,
          errorDetail: err.message,
        });
      }
      throw err;
    }

    // COMPLETED means the suite ran to completion. Whether the student passed is
    // testsFailed, not this.
    return await finishRun(run.id, {
      status: "COMPLETED",
      startedAt,
      setupExitCode: setup.exitCode,
      setupDurationMs: setup.durationMs,
      testExitCode: test.exitCode,
      stdoutTail: tail(test.stdout),
      stderrTail: tail(test.stderr),
      tamperedPaths: allTamperedPaths,
      results,
    });
  } catch (err) {
    return await finishErrored(run.id, {
      startedAt,
      errorDetail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  } finally {
    // A leaked sandbox bills until its own lifetime expires.
    if (handle) await killSandbox(handle);
  }
}

/**
 * Runs the preset's setup commands in order, stopping at the first failure.
 *
 * Sequential rather than combined into one shell line, so the exit code and output
 * belong to the command that actually failed.
 */
async function runSetup(handle: SandboxHandle, runner: ResolvedRunner) {
  let stdout = "";
  let stderr = "";
  let durationMs = 0;

  for (const command of runner.setupCommands) {
    const result = await runCommand(handle, {
      command,
      cwd: WORK_DIR,
      timeoutMs: runner.timeoutMs,
      // npm writes progress bars and colour codes that make stored output hard to
      // read, and CI=true is what every runner already expects.
      envs: { CI: "true", npm_config_fund: "false", npm_config_audit: "false" },
    });
    stdout += result.stdout;
    stderr += result.stderr;
    durationMs += result.durationMs;
    if (result.exitCode !== 0) {
      return { exitCode: result.exitCode, stdout, stderr, durationMs };
    }
  }

  return { exitCode: 0, stdout, stderr, durationMs };
}

type FinishFields = {
  startedAt: number;
  setupExitCode?: number;
  setupDurationMs?: number;
  testExitCode?: number;
  stdoutTail?: string | null;
  stderrTail?: string | null;
  tamperedPaths?: { path: string; kind: string; previousPath?: string }[];
  errorDetail?: string;
  results?: import("./parsers").NormalizedResults;
};

async function finishRun(
  runId: string,
  fields: FinishFields & { status: "COMPLETED" | "TIMED_OUT" | "ERRORED" },
): Promise<TestRun> {
  const { results } = fields;
  return db.testRun.update({
    where: { id: runId },
    data: {
      status: fields.status,
      finishedAt: new Date(),
      durationMs: Date.now() - fields.startedAt,
      setupExitCode: fields.setupExitCode ?? null,
      setupDurationMs: fields.setupDurationMs ?? null,
      testExitCode: fields.testExitCode ?? null,
      stdoutTail: fields.stdoutTail ?? null,
      stderrTail: fields.stderrTail ?? null,
      errorDetail: fields.errorDetail ?? null,
      tamperedPaths: fields.tamperedPaths ?? [],
      ...(results
        ? {
            testsTotal: results.total,
            testsPassed: results.passed,
            testsFailed: results.failed,
            testsSkipped: results.skipped,
            passRate: computePassRate(results),
            results: results.tests,
          }
        : {}),
    },
  });
}

/**
 * Records an infrastructure failure.
 *
 * Deliberately writes no counts and no pass rate. A run that could not produce
 * results must not look like a run that produced bad ones, because the first is a
 * problem to fix and the second is a grade.
 */
function finishErrored(runId: string, fields: FinishFields): Promise<TestRun> {
  return finishRun(runId, { ...fields, status: "ERRORED" });
}

export { NoRunnerConfiguredError, SubmissionNotReadyError };
export { RESULTS_DIR };
