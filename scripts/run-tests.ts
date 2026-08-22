/**
 * Runs an assignment's test suite against one submission, from the terminal.
 *
 *   npm run tests:run                      # the most recently active submission
 *   npm run tests:run -- <submission-id>
 *   npm run tests:run -- <repo-full-name>  # e.g. marcy-lms/swe-1-4-loops-benspector3
 *
 * Why this exists: the tRPC mutation is the real entry point, but reaching it
 * needs a signed-in instructor session, and a failure inside the sandbox is far
 * easier to diagnose from a stack trace than through a browser. This calls exactly
 * the same function the mutation calls.
 *
 * The `--conditions=react-server` flag in the npm script is load-bearing. The
 * sandbox modules import "server-only", which throws under a normal Node
 * resolution; that condition resolves it to an empty module instead.
 */
import { config as loadEnv } from "dotenv";

// Before importing anything that reads process.env at module load, which
// lib/prisma.ts does.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const { db } = await import("../lib/prisma");
  const { runTestsForSubmission } = await import("../lib/sandbox/run-tests");

  const target = process.argv[2];
  const isUuid = target && /^[0-9a-f-]{36}$/i.test(target);

  const submission = target
    ? await db.submission.findFirst({
        where: isUuid ? { id: target } : { repoFullName: target },
        select: selection,
      })
    : await db.submission.findFirst({
        where: { headSha: { not: null } },
        orderBy: { lastActivityAt: "desc" },
        select: selection,
      });

  if (!submission) {
    console.error(
      target
        ? `No submission matching "${target}".`
        : "No submission with a head commit yet. A student has to open a pull request first.",
    );
    process.exit(1);
  }

  console.log(`Submission   ${submission.id}`);
  console.log(`Repository   ${submission.repoFullName}`);
  console.log(`Commit       ${submission.headSha?.slice(0, 7)} (PR #${submission.prNumber})`);
  console.log(`Assignment   ${submission.assignment.title}`);
  console.log(`Preset       ${submission.assignment.runnerPreset}`);
  console.log(`Template     ${submission.assignment.templateRepo}\n`);

  const startedAt = Date.now();
  const run = await runTestsForSubmission(submission.id, { trigger: "MANUAL" });
  const wall = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n── ${run.status} in ${wall}s ${"─".repeat(30)}`);
  console.log(`Sandbox          ${run.sandboxId ?? "(none created)"}`);
  console.log(`Template commit  ${run.templateCommitSha?.slice(0, 7) ?? "(unresolved)"}`);
  console.log(`Setup exit       ${run.setupExitCode ?? "-"}   (${fmt(run.setupDurationMs)})`);
  console.log(`Test exit        ${run.testExitCode ?? "-"}`);

  if (run.status === "COMPLETED") {
    console.log(
      `Tests            ${run.testsPassed}/${run.testsTotal} passing, ` +
        `${run.testsFailed} failing, ${run.testsSkipped} skipped`,
    );
    // Not the score. Test outcomes are one rubric input among several.
    console.log(
      `Pass rate        ${run.passRate === null ? "n/a (no tests found)" : `${Math.round(run.passRate * 100)}%`}`,
    );
  }

  const tampered = Array.isArray(run.tamperedPaths) ? run.tamperedPaths : [];
  console.log(`\nGrading files changed by the student: ${tampered.length}`);
  for (const entry of tampered as { path: string; kind: string; previousPath?: string }[]) {
    console.log(
      `  ${entry.kind.padEnd(9)} ${entry.path}${entry.previousPath ? ` (was ${entry.previousPath})` : ""}`,
    );
  }
  if (tampered.length > 0) {
    console.log("  The template's versions were restored before the suite ran.");
  }

  const tests = Array.isArray(run.results) ? run.results : [];
  const failures = (
    tests as { status: string; suite: string; name: string; failureMessage?: string }[]
  ).filter((test) => test.status === "failed");

  if (failures.length > 0) {
    console.log(`\nFailing tests (${failures.length}):`);
    for (const test of failures) {
      console.log(`  ✗ ${test.suite ? `${test.suite} › ` : ""}${test.name}`);
      if (test.failureMessage) {
        console.log(indent(test.failureMessage.split("\n").slice(0, 6).join("\n")));
      }
    }
  }

  if (run.errorDetail) console.log(`\nError detail:\n${indent(run.errorDetail)}`);
  if (run.status !== "COMPLETED" && run.stderrTail) {
    console.log(`\nstderr tail:\n${indent(run.stderrTail.split("\n").slice(-25).join("\n"))}`);
  }

  await db.$disconnect();
  // Non-zero only for an infrastructure failure. Failing tests are a result, not
  // an error, so they exit 0.
  process.exit(run.status === "ERRORED" ? 1 : 0);
}

const selection = {
  id: true,
  repoFullName: true,
  headSha: true,
  prNumber: true,
  assignment: {
    select: { title: true, runnerPreset: true, templateRepo: true, templateRef: true },
  },
} as const;

function fmt(ms: number | null): string {
  return ms === null ? "-" : `${(ms / 1000).toFixed(1)}s`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
