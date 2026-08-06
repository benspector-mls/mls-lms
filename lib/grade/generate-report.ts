import "server-only";

import { db } from "../prisma";
import { repositorySource } from "../assignments/spec";
import { getConfiguredInstallationId } from "../github/app-client";
import { splitRepoFullName } from "../github/archives";
import { getPullRequestFiles } from "../github/prs";
import type { GradingDraft } from "../generated/prisma/client";
import type { NormalizedTest } from "../sandbox/parsers";
import { resolveRunner } from "../sandbox/presets";
import { runTestsForSubmission } from "../sandbox/run-tests";
import { GradingAssetsError, loadGradingAssets } from "./assets";
import {
  belongsToSection,
  classifySections,
  findSection,
  partitionForPrompt,
  resolveSectionTests,
  summarizeExclusions,
  TEST_EVIDENCE_FLAG,
  type AssignmentSection,
} from "./classify";
import { crossCheck, type Facts } from "./cross-check";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { getReportGenerator, ProviderError } from "./provider";
import { ReportValidationError } from "./schema";

/**
 * Generating a grading draft for one submission.
 *
 * The stages: load the submission and its most recent test run if one exists,
 * classify which sections the pull request contains, fetch the answer keys and rubric
 * for each, generate a report per section, cross-check it, and record the draft.
 *
 * No test execution happens here. Where it happened at all, it happened already and
 * its results are read from the database — which is what allows a report to be
 * regenerated without paying for another sandbox run.
 *
 * Nothing is posted to GitHub. The output is a draft with a status, and an instructor
 * decides what becomes of it.
 */

export class ReportGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportGenerationError";
  }
}

/** How much of a file to fetch. A minified bundle is not worth reading. */
const MAX_FETCHED_FILE_BYTES = 200_000;

export async function generateReportForSubmission(
  submissionId: string,
): Promise<GradingDraft> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      repoFullName: true,
      headSha: true,
      prNumber: true,
      headBranch: true,
      student: { select: { githubUsername: true } },
      assignment: {
        select: {
          title: true,
          sections: true,
          kind: true,
          templateRepo: true,
          answerKeyRepo: true,
          answerKeyDir: true,
          assignmentRepoName: true,
          githubOrg: true,
          pointValue: true,
          // Read so the run below can be started when one is missing.
          runnerPreset: true,
          runnerConfig: true,
        },
      },
    },
  });

  if (!submission) throw new ReportGenerationError(`No submission ${submissionId}.`);
  if (!submission.repoFullName || !submission.headSha || submission.prNumber === null) {
    throw new ReportGenerationError(
      `Submission ${submissionId} has no pull request yet, so there is nothing to grade.`,
    );
  }

  const allSections = Array.isArray(submission.assignment.sections)
    ? (submission.assignment.sections as unknown as AssignmentSection[])
    : [];

  if (allSections.length === 0) {
    throw new ReportGenerationError(
      `Assignment "${submission.assignment.title}" has no sections mapping, so there is ` +
      `no way to know what to grade or which rubric applies. Fix assignments.sections.`,
    );
  }

  /*
    Manually graded sections are removed before anything else looks at them. They carry no
    rubric, no answer keys, and no section type, so classification has nothing to match and
    the model has nothing to be told — an instructor scores them by hand in the review
    screen. Filtering here rather than at each use keeps the rest of this function unable to
    reach one by accident.
  */
  const declaredSections = allSections.filter((section) => section.grading !== "manual");

  if (declaredSections.length === 0) {
    throw new ReportGenerationError(
      `Every section of "${submission.assignment.title}" is graded by hand, so there is ` +
      `no report to generate. Score it in the review screen instead.`,
    );
  }

  const installationId = getConfiguredInstallationId();
  const studentRepo = splitRepoFullName(submission.repoFullName);

  // ---- Run the tests first, if this assignment has any and none have run ----
  //
  // Grading an assignment with a runnable suite against no results produced a report
  // that rested on reading the code, plus a note telling the instructor to run the tests
  // and generate again. That is two deliberate actions to reach the state the first one
  // should have produced, and the intermediate report is worth nothing — nobody wants
  // the version written without the evidence.
  //
  // Failures here are swallowed on purpose. Test results are evidence, not a gate: a
  // sandbox that will not start is not a reason to refuse to grade, and the section
  // below already records "graded without test results" as a reason for an instructor
  // to look. That note is now truthful about having tried.
  const runner = (() => {
    try {
      return resolveRunner(submission.assignment);
    } catch {
      // A misconfigured preset. Reported by testRuns.listForSubmission where it can be
      // fixed; here it simply means there is nothing to run.
      return null;
    }
  })();

  if (runner) {
    const existing = await db.testRun.findFirst({
      where: { submissionId: submission.id, headSha: submission.headSha, status: "COMPLETED" },
      select: { id: true },
    });

    if (!existing) {
      try {
        await runTestsForSubmission(submission.id, { trigger: "MANUAL" });
      } catch (err) {
        console.warn(
          `generate-report: could not run tests for ${submission.id} before grading — ` +
          `continuing without them. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ---- The most recent run, if there is one --------------------------------
  //
  // Keyed on the commit being graded, not merely the submission: a run against an
  // older commit describes different code and must not be presented as evidence
  // about this one.
  const testRun = await db.testRun.findFirst({
    where: { submissionId: submission.id, headSha: submission.headSha, status: "COMPLETED" },
    orderBy: { startedAt: "desc" },
    select: { id: true, results: true, tamperedPaths: true, passRate: true },
  });

  const allTests: NormalizedTest[] = Array.isArray(testRun?.results)
    ? (testRun.results as unknown as NormalizedTest[])
    : [];
  const tamperedPaths = Array.isArray(testRun?.tamperedPaths)
    ? (testRun.tamperedPaths as unknown as { path: string; kind: string }[])
    : [];

  // ---- What the pull request contains -------------------------------------
  //
  // Filtered before anything reads it. A student can commit a file git was told to
  // ignore, and some of those must never be sent — a `.env` would put the student's own
  // secrets into a third party's logs, which is not recoverable afterwards, and a
  // committed dependency tree can exceed the context window on its own. Filtering here
  // rather than at each section's fetch means classification and the prompt agree about
  // which paths are student work.
  const { included: changedPaths, excluded: excludedPaths } = partitionForPrompt(
    await getPullRequestFiles(installationId, {
      ...studentRepo,
      pullNumber: submission.prNumber,
    }),
  );

  if (excludedPaths.length > 0) {
    console.warn(
      `generate-report: withheld ${excludedPaths.length} committed path(s) from the prompt ` +
      `for ${submission.id} — ` +
      excludedPaths.slice(0, 10).map((e) => `${e.path} (${e.reason})`).join(", "),
    );
  }

  const classification = classifySections({
    changedPaths,
    declaredSections,
    // From the template, never the student's copy: a student must not be able to
    // change which rubric they are graded against by editing their own package.json.
    hasJest: await templateHasJest(
      installationId,
      repositorySource(submission.assignment).templateRepo,
    ),
  });

  if (classification.present.length === 0) {
    // The withheld count is named because without it this message can read as an empty
    // pull request when the student committed only files the filter refuses to send —
    // a dependency tree and nothing else, which is a different problem with a different
    // answer.
    const withheld =
      excludedPaths.length > 0
        ? ` ${excludedPaths.length} committed path(s) were withheld from the prompt: ` +
          `${excludedPaths.slice(0, 20).map((e) => `${e.path} (${e.reason})`).join(", ")}.`
        : "";

    throw new ReportGenerationError(
      `The pull request contains none of the sections this assignment declares ` +
      `(${declaredSections.map((s) => s.type).join(", ")}). Changed paths: ` +
      `${changedPaths.slice(0, 20).join(", ")}.${withheld}`,
    );
  }

  // ---- One draft, one row per section -------------------------------------
  //
  // GENERATING is written first, so a run that dies partway through leaves a row
  // explaining that it was attempted rather than no trace at all.
  const draft = await db.gradingDraft.create({
    data: {
      submissionId: submission.id,
      headSha: submission.headSha,
      status: "GENERATING",
    },
  });

  const reviewReasons: string[] = [];

  // An unexpected section means either the student submitted something the
  // assignment does not describe, or the sections mapping is wrong. Both need a
  // person, and neither is the model's to resolve.
  if (classification.unexpected.length > 0) {
    reviewReasons.push(
      `The pull request contains ${classification.unexpected.join(", ")}, which this ` +
      `assignment does not declare.`,
    );
  }
  if (classification.notSubmitted.length > 0) {
    // Named together, because a section can be missing for two very different reasons
    // and only one of them is the student's doing. An assignment shipping
    // SHORT_RESPONSE.MD instead of short-response.md reported the work as not
    // submitted while it sat in the pull request; listing what went unrecognized is
    // what makes a naming mistake look like a naming mistake.
    const unrecognized =
      classification.unclassified.length > 0
        ? ` No section matched these changed files, which may be a filename the ` +
          `matcher does not recognize rather than work the student skipped: ` +
          `${classification.unclassified.join(", ")}.`
        : "";

    reviewReasons.push(
      `Not submitted: ${classification.notSubmitted.join(", ")}.${unrecognized}`,
    );
  }

  try {
    const generator = await getReportGenerator();
    // All four counts, because the first three alone cannot answer "is prompt caching
    // working". Claude reports cached and newly-written tokens *separately* from
    // `promptTokens` rather than as a subset of it, so a run that writes the cache
    // shows zero reads and an unchanged prompt count — indistinguishable from caching
    // being broken until the write count is visible.
    const usageTotals = {
      promptTokens: 0,
      completionTokens: 0,
      cachedPromptTokens: 0,
      cacheWriteTokens: 0,
    };
    let assetsCommitSha: string | null = null;
    let answerKeyCommitSha: string | null = null;

    for (const sectionType of classification.present) {
      const section = findSection(declaredSections, sectionType);

      // Refused rather than defaulted. Told nothing about the maximum, a model will
      // invent one — an early run produced a report scored out of 40 for a 30-point
      // assignment — and a plausible score against an invented denominator is worse
      // than no score, because nothing downstream can tell it apart from a real one.
      const sectionPointValue = section?.pointValue;
      if (typeof sectionPointValue !== "number") {
        throw new Error(
          `The "${sectionType}" section of ${submission.assignment.title} has no ` +
          `pointValue, so there is no maximum to score it against. Point values are ` +
          `per section rather than per assignment; a row seeded before that change ` +
          `carries the old shape. Re-run \`npm run db:seed\` for this assignment.`,
        );
      }

      const assets = await loadGradingAssets({
        sectionType,
        // The assignment's own repository, not one named by the environment. The rubric and
        // the agent rules still come from the configured one — those are program-wide.
        answerKeyRepo: submission.assignment.answerKeyRepo,
        answerKeyDir: submission.assignment.answerKeyDir,
      });
      assetsCommitSha = assets.commitSha;
      answerKeyCommitSha = assets.answerKeyCommitSha ?? answerKeyCommitSha;

      // Which tests count toward this section, or why there are none. Absent pattern
      // with evidence "tests" means the whole suite counts.
      const sectionTests = resolveSectionTests(section, allTests);
      const sectionResults =
        sectionTests.kind === "results" ? sectionTests.results : null;

      // A section that was supposed to be checked against a suite and was not. The
      // report still gets written — a model reading the code is better than nothing —
      // but it rests on judgment alone where it was meant to rest on facts, and that
      // is an instructor's call rather than something to pass over quietly.
      if (sectionTests.kind === "run-missing") {
        reviewReasons.push(
          `${sectionType}: graded without test results. This section expects them and ` +
          `the submission has no completed run at ${submission.headSha.slice(0, 7)}. ` +
          `Run the tests and regenerate.`,
        );
      }
      if (sectionTests.kind === "pattern-matched-nothing") {
        reviewReasons.push(
          `${sectionType}: graded without test results. The tests ran, but this ` +
          `section's testNamePattern ` +
          `(${JSON.stringify(section?.testNamePattern ?? "")}) matched none of the ` +
          `${allTests.length} tests in the suite. Either the pattern is wrong or the ` +
          `tests it names do not exist.`,
        );
      }

      const studentFiles = await fetchChangedFiles(installationId, {
        ...studentRepo,
        ref: submission.headSha,
        paths: changedPaths.filter((path) => belongsToSection(path, sectionType)),
      });

      const readme = await fetchFile(installationId, {
        ...studentRepo,
        ref: submission.headSha,
        path: "README.md",
      });

      const response = await generator.generate({
        system: buildSystemPrompt({ sectionType, assets }),
        user: buildUserPrompt({
          assets,
          context: {
            studentGithubUsername: submission.student.githubUsername,
            assignmentTitle: submission.assignment.title,
            pointValue: sectionPointValue,
            readme,
            studentFiles,
            testResults: sectionResults,
            tamperedPaths,
            headBranch: submission.headBranch,
          },
        }),
      });

      usageTotals.promptTokens += response.usage.promptTokens;
      usageTotals.completionTokens += response.usage.completionTokens;
      usageTotals.cachedPromptTokens += response.usage.cachedPromptTokens ?? 0;
      usageTotals.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;

      const facts: Facts = { tests: sectionResults?.tests ?? null, tamperedPaths };
      const check = crossCheck(response.output, facts);

      await db.gradingDraftSection.create({
        data: {
          gradingDraftId: draft.id,
          sectionType,
          reportMarkdown: response.output.reportMarkdown,
          scoreEarned: response.output.scoreEarned,
          scorePossible: response.output.scorePossible,
          rubricItems: response.output.rubricItems,
          flags: [
            ...response.output.flags,
            // Recorded on the row so the review interface can show, at a glance,
            // which sections had their claims verified against a run and which rest
            // entirely on the model's reading of the code.
            TEST_EVIDENCE_FLAG[sectionTests.kind],
            ...check.findings.map((finding) => finding.code),
          ],
          instructorNotes: response.output.instructorNotes,
          confidence: response.output.confidence === "low" ? "LOW" : "HIGH",
          submissionProcessNote: response.output.submissionProcessNote,
        },
      });

      // Recorded twice on purpose, for two readers: as a flag on the section above, which is
      // what an instructor scans, and as a review reason here, which is what holds the draft
      // back and says why.
      for (const finding of check.findings) {
        reviewReasons.push(`${sectionType}: ${finding.detail}`);
      }
    }

    const needsReview = reviewReasons.length > 0;

    return await db.gradingDraft.update({
      where: { id: draft.id },
      data: {
        status: needsReview ? "NEEDS_MANUAL_REVIEW" : "READY",
        errorDetail: needsReview ? reviewReasons.join("\n") : null,
        modelMetadata: {
          provider: generator.name,
          promptVersion: PROMPT_VERSION,
          gradingAssetsCommitSha: assetsCommitSha,
          // The answer keys come from the repository the assignment names, which is a
          // different repository with its own history. Recorded separately so a report
          // traces back to the exact reference solutions it was written against, not only
          // to the rubric — null when the section named no keys.
          answerKeyRepo: submission.assignment.answerKeyRepo,
          answerKeyCommitSha,
          usage: usageTotals,
          sectionsGraded: classification.present,
          sectionsNotSubmitted: classification.notSubmitted,
          testRunId: testRun?.id ?? null,
          // Null when nothing was withheld, which is the ordinary case. Recorded rather
          // than only logged so that a report whose prompt was missing files the student
          // did commit says so, and a committed `.env` is traceable after the fact — a
          // student whose secret was committed needs to be told to replace it.
          excludedFromPrompt: summarizeExclusions(excludedPaths),
        },
      },
    });
  } catch (err) {
    // A failure to produce a report is never a score. FAILED with the reason
    // attached, so an instructor knows to grade it by hand rather than seeing a
    // fabricated number.
    const detail =
      err instanceof ProviderError ||
      err instanceof ReportValidationError ||
      err instanceof GradingAssetsError
        ? `${err.name}: ${err.message}`
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err);

    return await db.gradingDraft.update({
      where: { id: draft.id },
      data: { status: "FAILED", errorDetail: detail },
    });
  }
}

/**
 * Bumped whenever the prompt builders change in a way that could alter output.
 * Recorded on every draft, so a report can be traced to the prompt that produced it.
 */
const PROMPT_VERSION = "2026-08-02.3";

/**
 * Narrows the suite to the tests that count toward one section.
 *
 * Returns null when the section declares no test evidence, which is what keeps an
 * untested section from being handed results that describe someone else's work.
 */

/**
 * Whether a changed path is part of a section, so a short response report is not
 * handed a stylesheet to read.
 *
 * Deliberately permissive: a file that matches nothing specific is included, because
 * omitting a file the model needed is worse than including one it does not.
 */
async function templateHasJest(installationId: number, templateRepo: string): Promise<boolean> {
  const { owner, repo } = splitRepoFullName(templateRepo);
  const packageJson = await fetchFile(installationId, {
    owner,
    repo,
    ref: "HEAD",
    path: "package.json",
  });
  if (!packageJson) return false;
  try {
    const parsed = JSON.parse(packageJson) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    return Boolean(parsed.devDependencies?.jest ?? parsed.dependencies?.jest);
  } catch {
    return false;
  }
}

/** Returns null when the file does not exist, which is an ordinary outcome. */
async function fetchFile(
  installationId: number,
  params: { owner: string; repo: string; ref: string; path: string },
): Promise<string | null> {
  const { getInstallationOctokit } = await import("../github/app-client");
  const octokit = await getInstallationOctokit(installationId);
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    });
    if (!("content" in data) || typeof data.content !== "string") return null;
    if (typeof data.size === "number" && data.size > MAX_FETCHED_FILE_BYTES) return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function fetchChangedFiles(
  installationId: number,
  params: { owner: string; repo: string; ref: string; paths: string[] },
): Promise<{ path: string; content: string }[]> {
  const files = await Promise.all(
    params.paths.map(async (path) => {
      const content = await fetchFile(installationId, { ...params, path });
      return content === null ? null : { path, content };
    }),
  );
  return files.filter((file): file is { path: string; content: string } => file !== null);
}
