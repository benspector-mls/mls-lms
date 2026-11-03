import "server-only";

import { randomUUID } from "node:crypto";

import { db, type Tx } from "../prisma";
import {
  declaredUnits,
  hasUnconvertedSections,
  readSections,
  type DeclaredUnit,
} from "../assignments/spec";
import { getConfiguredInstallationId } from "../github/app-client";
import { splitRepoFullName } from "../github/archives";
import { compareCommits, getPullRequestFiles } from "../github/prs";
import type { GradingDraft } from "../generated/prisma/client";
import { testDisplay, testMatches } from "../assignments/test-names";
import type { NormalizedTest } from "../sandbox/parsers";
import { NO_RUNNER, resolveRunner } from "../sandbox/presets";
import { runTestsForSubmission } from "../sandbox/run-tests";
import { GradingAssetsError, loadGradingAssets } from "./assets";
import {
  belongsToSection,
  classifySections,
  partitionForPrompt,
  promptExclusionReason,
  resolveSectionTests,
  summarizeExclusions,
  TEST_EVIDENCE_FLAG,
  type AssignmentSection,
} from "./classify";
import { companionsOf, isCompanion, type SectionType } from "../section-types";
import { crossCheck, type Facts } from "./cross-check";
import { effectiveSection } from "./delivery";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type PreviousReview,
  type PromptSection,
} from "./prompts";
import { getReportGenerator, ProviderError } from "./provider";
import { composeRound } from "./report-text";
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

/**
 * Takes the run, or refuses because somebody else already has it.
 *
 * **One statement, which is what makes this a claim rather than a hope.** Reading for an
 * in-flight draft and then creating one is a check-then-act with a window minutes wide: two
 * requests both see nothing, both create a `GENERATING` row, and the submission is graded twice
 * — two sandboxes, two model calls, two drafts, and only the later one is ever read. That went
 * unnoticed while a person could press the button only once at a time. It stopped being
 * theoretical the moment one press could stand for twenty.
 *
 * `INSERT … SELECT … WHERE NOT EXISTS` decides and writes in the same statement, so there is no
 * window at all. The same reasoning as `modules.reorder`, which reaches for raw SQL to get
 * atomicity rather than opening a transaction: a single statement is atomic by definition and
 * composes with whatever is above it, where an interactive transaction would refuse to nest
 * inside the one the check scripts already hold.
 *
 * **Scoped to the commit, not the submission.** A draft generating against an older commit does
 * not describe this code, so it is not this run's business — the same rule every other reader
 * applies through `draftIsStale`. `IS NOT DISTINCT FROM` rather than `=` because `head_sha` is
 * null for hand-graded work with no commit at all, and `NULL = NULL` is not true.
 *
 * **A claim expires, and that is not a detail.** A run that dies without finishing — a crash, a
 * deploy mid-run — leaves its row `GENERATING` with nothing to move it on, and nothing in the
 * interface clears one. Without an expiry that row would block this submission's report forever,
 * which is a worse failure than the one being prevented. So a claim older than
 * `CLAIM_EXPIRY_MS` is treated as abandoned and may be taken.
 *
 * Fifteen minutes is deliberately far past any honest run. The sandbox is capped at 120 seconds
 * and each section's model call has been measured at 27 to 40, against a function limit of 300 —
 * so a live run cannot reach five minutes, let alone fifteen. The margin is what makes expiry
 * safe: it can only ever release a run that is genuinely gone.
 *
 * **The boundary is computed by the database rather than by this process**, which is what makes
 * the comparison mean fifteen minutes rather than fifteen minutes plus whatever the two clocks
 * disagree by. It also avoids a trap in how a JavaScript `Date` reaches a raw query: it arrives as
 * a timestamp carrying no zone, so Postgres reads it in the session's own time zone. Against a
 * session set to UTC that is right by luck; against one set to anything else — a local Postgres
 * takes the operating system's zone — every live claim read as abandoned and the whole guard was
 * silently off. Both sides of the comparison now come from `now()`, so neither question arises.
 *
 * **What this deliberately does not protect**, so the limit is known rather than assumed. The
 * claim is taken here, late — after the test run and the GitHub reads, immediately before the
 * model calls. Two genuinely simultaneous attempts on one submission therefore both pay for a
 * sandbox, and only then does one discover it lost. Claiming earlier would save that, at the cost
 * of restructuring which failures throw and which become a `FAILED` draft. It is not worth it:
 * what the late claim still prevents is the *model* calls, which are the expensive half by an
 * order of magnitude and the half that writes a report.
 *
 * Note also what it does not fix and is not new. A stuck `GENERATING` row still reads as the
 * `generating` bucket, which triage excludes from outstanding work — so the submission is
 * invisible to a batch until somebody opens it and presses the button. That was true before this
 * function existed; the expiry means pressing the button then works rather than refusing.
 *
 * Exported, and taking a client rather than reaching for one, so a check script can drive it
 * against real rows inside a transaction it then rolls back. That is what `Tx` is for, and it is
 * the only way to check a statement whose whole point is what two callers do at once.
 */
export const CLAIM_EXPIRY_MS = 15 * 60 * 1000;

export async function claimRun(
  db: Tx,
  submissionId: string,
  headSha: string | null,
): Promise<GradingDraft> {
  const id = randomUUID();

  const claimed = await db.$executeRaw`
    INSERT INTO grading_drafts (id, submission_id, head_sha, status, created_at, updated_at)
    SELECT ${id}::uuid, ${submissionId}::uuid, ${headSha}, 'GENERATING', now(), now()
     WHERE NOT EXISTS (
       SELECT 1
         FROM grading_drafts
        WHERE submission_id = ${submissionId}::uuid
          AND status = 'GENERATING'
          AND head_sha IS NOT DISTINCT FROM ${headSha}
          AND created_at > now() - make_interval(secs => ${CLAIM_EXPIRY_MS / 1000})
     )
  `;

  if (claimed === 0) {
    throw new ReportGenerationError(
      "A report for this submission is already being generated. Wait for it to finish — it " +
        "takes a couple of minutes.",
    );
  }

  // Read back rather than returning a hand-built object, so the caller gets the row as the
  // database actually wrote it — including the defaults this insert did not name.
  return db.gradingDraft.findUniqueOrThrow({ where: { id } });
}

export async function generateReportForSubmission(submissionId: string): Promise<GradingDraft> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      repoFullName: true,
      headSha: true,
      prNumber: true,
      headBranch: true,
      student: { select: { githubUsername: true } },
      /*
        Whether this row is one member's copy of their team's grade, and — when it is the team's
        own row — who else the report is addressed to.

        Handles only, deliberately. The report is posted as a pull request comment and rendered on
        every member's page, so putting display names into model-written prose that gets published
        is a new class of mistake for no benefit.
      */
      teamSubmissionId: true,
      team: { select: { name: true } },
      mirrors: { select: { student: { select: { githubUsername: true } } } },
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

  /*
    One member's copy of their team's grade, refused before the pull request check below.

    Order matters here rather than being tidy. A mirror carries no repository and no pull request,
    so the check below would catch it and say "no pull request yet" — which sends an instructor
    looking for one that will never exist, on a row that is not where the work is. Said properly,
    the message names where to go instead.
  */
  if (submission.teamSubmissionId !== null) {
    throw new ReportGenerationError(
      `Submission ${submissionId} is one member's copy of their team's work, so it is not what ` +
        `gets graded. Generate the report on the team's own submission.`,
    );
  }

  if (!submission.repoFullName || !submission.headSha || submission.prNumber === null) {
    throw new ReportGenerationError(
      `Submission ${submissionId} has no pull request yet, so there is nothing to grade.`,
    );
  }

  /*
    Narrowed through `readSections` rather than asserted. The assertion this replaces —
    `as unknown as AssignmentSection[]` — is satisfied by a column holding anything at all, so a
    malformed row reached the loop below and failed there, several steps from the cause.
  */
  const allSections = readSections(submission.assignment.sections) as AssignmentSection[];

  /*
    A declaration from before sections were scored units has no keys, and `declaredUnits` would
    key its sections by type. A round written under such keys is one no later declaration can
    match and one `convert:rounds` would not touch, so nothing is written until the declaration
    has been converted.
  */
  if (hasUnconvertedSections(submission.assignment.sections)) {
    throw new ReportGenerationError(
      `This assignment's sections have not been converted to scored units yet. Run ` +
        `convert:sections, then generate again.`,
    );
  }

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

  // ---- The review the student last received, if this is a resubmission ----
  //
  // Every released round, oldest first: the ordering the student's Feedback tab and the comment
  // thread both number from, so "Review 2" here is the "Review 2" the student sees.
  //
  // The latest round counts as the previous review only when it graded a different commit. When
  // it graded this one, the run is a regeneration of work that round already described, and the
  // prompt is built exactly as for a first submission. A round with no commit at all — written by
  // hand before the pull request existed — counts as different, since the student read it and it
  // describes none of this code.
  const releasedRounds = await db.gradingDraft.findMany({
    where: { submissionId: submission.id, status: "APPROVED" },
    orderBy: { approvedAt: "asc" },
    select: {
      id: true,
      headSha: true,
      summaryMarkdown: true,
      editedSummaryMarkdown: true,
      sections: {
        // The order the round was written in, which is the order it was read in.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          sectionKey: true,
          label: true,
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
  const latestRound = releasedRounds.at(-1);
  const previousRound =
    latestRound && latestRound.headSha !== submission.headSha
      ? { ...latestRound, number: releasedRounds.length }
      : null;

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
        excludedPaths
          .slice(0, 10)
          .map((e) => `${e.path} (${e.reason})`)
          .join(", "),
    );
  }

  // ---- What changed since the previous review -------------------------------
  //
  // A failure here is not a reason to refuse grading. A force push can remove the commit the
  // previous review described, and GitHub then cannot compare against it; the report is still
  // written with the previous review in view, and the instructor is told the diff was missing.
  const reviewReasons: string[] = [];
  let changesSincePrevious: Awaited<ReturnType<typeof compareCommits>>["files"] | null = null;

  if (previousRound?.headSha) {
    try {
      const comparison = await compareCommits(installationId, {
        ...studentRepo,
        base: previousRound.headSha,
        head: submission.headSha,
      });
      changesSincePrevious = comparison.files;
    } catch (err) {
      console.warn(
        `generate-report: could not compare ${submission.id} against its previous review — ` +
          `continuing without the diff. ${err instanceof Error ? err.message : String(err)}`,
      );
      reviewReasons.push(
        `Review ${previousRound.number} was written against ` +
          `${previousRound.headSha.slice(0, 7)}, which GitHub could not compare against the ` +
          `current commit. Graded with the previous review in view but without a diff of what ` +
          `changed.`,
      );
    }
  }

  const classification = classifySections({
    changedPaths,
    declaredSections,
    // From the assignment record, never the student's copy: a student must not be able
    // to change which rubric they are graded against by editing their own package.json.
    // The preset covers Jest, Vitest, and pytest alike, where reading the template's
    // package.json for Jest left every Python assignment matching no section.
    hasTestRunner: submission.assignment.runnerPreset !== NO_RUNNER,
  });

  if (classification.present.length === 0) {
    // The withheld count is named because without it this message can read as an empty
    // pull request when the student committed only files the filter refuses to send —
    // a dependency tree and nothing else, which is a different problem with a different
    // answer.
    const withheld =
      excludedPaths.length > 0
        ? ` ${excludedPaths.length} committed path(s) were withheld from the prompt: ` +
          `${excludedPaths
            .slice(0, 20)
            .map((e) => `${e.path} (${e.reason})`)
            .join(", ")}.`
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
  const draft = await claimRun(db, submission.id, submission.headSha);

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

    reviewReasons.push(`Not submitted: ${classification.notSubmitted.join(", ")}.${unrecognized}`);
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

    /*
      Every declared section as one scored unit, and the skill each is tagged with by name, so
      the prompt can say what a section is evidence of. One read for the whole round.
    */
    const units = declaredUnits(allSections).filter((unit) => unit.type !== "manual");
    const skillIds = [...new Set(units.flatMap((unit) => (unit.skillId ? [unit.skillId] : [])))];
    const skillName = new Map(
      skillIds.length === 0
        ? []
        : (
            await db.skill.findMany({
              where: { id: { in: skillIds } },
              select: { id: true, name: true },
            })
          ).map((skill) => [skill.id, skill.name]),
    );

    /*
      What the round as a whole receives from its calls. A checkpoint is two calls — a short
      response and a coding section, each against its own rubric — and the round has one summary,
      one set of flags and one confidence, so the calls' answers are joined: summaries in order,
      flags and notes together, the lower confidence, and the first process note.
    */
    const summaries: string[] = [];
    const roundFlags = new Set<string>();
    /** How each call's tests resolved, read together after the loop for the round's flag. */
    const testKinds: (keyof typeof TEST_EVIDENCE_FLAG)[] = [];
    const roundNotes: string[] = [];
    let roundConfidence: "HIGH" | "LOW" = "HIGH";
    let processNote: string | null = null;

    for (const sectionType of classification.present) {
      // Filled by its primary's call below, never graded on its own.
      if (isCompanion(sectionType)) continue;

      /*
        The sections this call fills: every declared unit of this type, and of each companion
        type the pull request also presents. For a short response that is the questions and the
        one writing section; for a coding assignment, every exercise.
      */
      const family: SectionType[] = [
        sectionType,
        ...companionsOf(sectionType).filter((companion) =>
          classification.present.includes(companion),
        ),
      ];
      const callUnits = units.filter((unit) => (family as string[]).includes(unit.type));
      if (callUnits.length === 0) {
        throw new Error(
          `The "${sectionType}" section of ${submission.assignment.title} declares no scored ` +
            `units, so there is nothing to ask the model to fill. Edit the assignment's sections.`,
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

      /*
        Which tests count toward this call, or why there are none. When every section of the
        call chose its tests, the call's evidence is those tests together, and a choice none of
        which ran is the fault `TEST_MATCH_MISSING` names; when any section chose none, the
        suite as a whole is the evidence, since that section is read against all of it. Each
        section is then told which of the run's tests are its own below.
      */
      const evidenced = callUnits.find((unit) => unit.hasTestEvidence);
      const chosen = callUnits.every((unit) => unit.tests.length > 0)
        ? callUnits.flatMap((unit) => unit.tests)
        : [];
      const sectionTests = resolveSectionTests(
        evidenced ? { type: evidenced.type, evidence: "tests", tests: chosen } : undefined,
        allTests,
      );
      const sectionResults = sectionTests.kind === "results" ? sectionTests.results : null;

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

      const promptSections: PromptSection[] = callUnits.map((unit) => {
        const own = testsOf(unit, sectionResults?.tests ?? []);
        // Named when a run exists and the choice missed it; with no run at all, the one reason
        // above says so and nothing is repeated per section.
        if (
          own !== null &&
          own.length === 0 &&
          (sectionResults !== null || sectionTests.kind === "pattern-matched-nothing")
        ) {
          reviewReasons.push(
            `${unit.label}: none of its chosen tests (${unit.tests.map(testDisplay).join(", ")}) ` +
              `were among the ${allTests.length} tests in the run, so it was graded without ` +
              `tests of its own. Either the suite changed or the choice is wrong.`,
          );
        }
        return {
          key: unit.key,
          label: unit.label,
          heading: unit.heading,
          pointValue: unit.pointValue,
          skill: unit.skillId ? (skillName.get(unit.skillId) ?? null) : null,
          tests: own,
        };
      });

      const studentFiles = await fetchChangedFiles(installationId, {
        ...studentRepo,
        ref: submission.headSha,
        paths: changedPaths.filter((path) => family.some((type) => belongsToSection(path, type))),
      });

      /*
        The round the student last received, as they read it, restricted to this call's
        sections. Matched by key, which is what a round written before keys lacks — such a
        round's sections are matched by type, the one identity they hold.
      */
      const previous = previousRound ? previousReviewFor(previousRound, callUnits, family) : null;
      const previousReview: PreviousReview | null = previous
        ? {
            ...previous,
            /*
              Through the same two filters as the student's files. The exclusion list first,
              because the comparison's file list is independent of the pull request's, and a
              committed `.env` withheld there would otherwise reach the model here as a patch.
              Then `belongsToSection`, which for a short response admits only the short response
              file — so an edit to LICENSE or README.md made by accident is not presented as a
              change to the answers.
            */
            changes:
              changesSincePrevious === null
                ? null
                : changesSincePrevious
                    .filter(
                      (file) =>
                        promptExclusionReason(file.path) === null &&
                        family.some((type) => belongsToSection(file.path, type)),
                    )
                    .map((file) => ({ path: file.path, kind: file.kind, patch: file.patch })),
          }
        : null;

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
            /*
              Everybody the report is written to: this row's own student, and every teammate who
              holds a mirror of it. One entry for work a student did alone, which reads exactly as
              it did before, so existing reports stay comparable.
            */
            addressees: [
              { githubUsername: submission.student.githubUsername },
              ...submission.mirrors.map((mirror) => ({
                githubUsername: mirror.student.githubUsername,
              })),
            ],
            teamName: submission.team?.name ?? null,
            assignmentTitle: submission.assignment.title,
            sections: promptSections,
            readme,
            studentFiles,
            testResults: sectionResults,
            tamperedPaths,
            headBranch: submission.headBranch,
            previousReview,
          },
        }),
      });

      usageTotals.promptTokens += response.usage.promptTokens;
      usageTotals.completionTokens += response.usage.completionTokens;
      usageTotals.cachedPromptTokens += response.usage.cachedPromptTokens ?? 0;
      usageTotals.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;

      const facts: Facts = {
        tests: sectionResults?.tests ?? null,
        tamperedPaths,
        sections: callUnits.map((unit) => ({
          key: unit.key,
          label: unit.label,
          type: unit.type,
          pointValue: unit.pointValue,
          tests: unit.tests,
        })),
      };
      const check = crossCheck(response.output, facts);

      /*
        One row per declared section, in declared order, whatever the model returned. A section
        the model scored takes its score, feedback and reasoning; one it left out is written with
        no score, which the cross-check has already named and approval refuses until an
        instructor fills it in. A key the model invented is named by the cross-check and written
        nowhere.
      */
      const scored = new Map(response.output.sections.map((entry) => [entry.key, entry]));
      // One create per unit, in declared order, rather than one statement for all: the rows'
      // creation order is the order a reader without the declaration lists them in, and a
      // single statement gives every row the same instant.
      for (const unit of callUnits) {
        const entry = scored.get(unit.key);
        await db.gradingDraftSection.create({
          data: {
            gradingDraftId: draft.id,
            sectionKey: unit.key,
            label: unit.label,
            heading: unit.heading,
            skillId: unit.skillId,
            sectionType: unit.type,
            reportMarkdown: entry?.feedbackMarkdown ?? null,
            scoreEarned: entry?.scoreEarned ?? null,
            scorePossible: unit.pointValue,
            modelReasoning: entry?.modelReasoning ?? null,
          },
        });
      }

      summaries.push(response.output.summaryMarkdown.trim());
      for (const flag of response.output.flags) roundFlags.add(flag);
      testKinds.push(sectionTests.kind);
      for (const finding of check.findings) roundFlags.add(finding.code);
      roundNotes.push(...response.output.instructorNotes);
      if (response.output.confidence === "low") roundConfidence = "LOW";
      processNote ??= response.output.submissionProcessNote?.trim() || null;

      // Recorded twice on purpose, for two readers: as a flag on the round above, which is
      // what an instructor scans, and as a finding here, which names what could not be
      // reconciled and directs attention at it.
      for (const finding of check.findings) {
        reviewReasons.push(`${sectionType}: ${finding.detail}`);
      }
    }

    /*
      One reading of the test evidence for the round, so the review screen says at a glance
      whether the claims were checked against a run. A round whose calls all expected no tests
      says so once; otherwise the flags of the calls that expected tests are recorded, and a
      call that expected none adds nothing, since "no tests by design" beside "checked against
      tests" would read as a contradiction about one round.
    */
    const expectedTests = testKinds.filter((kind) => kind !== "not-expected");
    if (expectedTests.length === 0) roundFlags.add(TEST_EVIDENCE_FLAG["not-expected"]);
    for (const kind of expectedTests) roundFlags.add(TEST_EVIDENCE_FLAG[kind]);

    /*
      The process note is written onto the end of the stored summary, so the student reads it at
      the top of the report. Joining it here rather than inside `composeRound` means every later
      reassembly — an instructor's edit, the review screen's preview — carries it without being
      handed it, and an instructor can edit or delete it in the summary like any other sentence.
    */
    let summaryMarkdown = summaries.filter((summary) => summary !== "").join("\n\n");
    if (processNote) summaryMarkdown = `${summaryMarkdown}\n\n${processNote}`.trim();

    /*
      One ready state, whatever the cross-check found.

      A draft used to be written as `NEEDS_MANUAL_REVIEW` when the cross-check found something
      and `READY` otherwise, and the pair said the wrong thing: every report is reviewed before
      anybody sees it, so "ready for review" against "needs manual review" read as a claim about
      whether a human was required rather than about what the pipeline noticed. The distinction
      that matters is carried by `errorDetail` and by each section's flags, which name the
      specific thing to look at — information the status only ever summarized into a boolean.

      `NEEDS_MANUAL_REVIEW` remains in `GradingDraftStatus` and nothing writes it. Rows from
      before this decision keep it and are presented as ready, which is what they always were.
    */
    return await db.gradingDraft.update({
      where: { id: draft.id },
      data: {
        status: "READY",
        summaryMarkdown,
        flags: [...roundFlags],
        instructorNotes: roundNotes,
        confidence: roundConfidence,
        submissionProcessNote: processNote,
        errorDetail: reviewReasons.length > 0 ? reviewReasons.join("\n") : null,
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
          // The round this report was written with in view, so a report on a resubmission traces
          // to the review it was told about. Null on a first submission and on a regeneration.
          previousRound: previousRound
            ? { id: previousRound.id, headSha: previousRound.headSha }
            : null,
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
/*
  Bumped when the prompt changes in a way that changes what comes back, so a stored report can be
  traced to the wording that produced it. `2026-10-10.1` asks for a summary and one row per scored
  item, each carrying its own feedback, in place of a whole report written as one block of text.
  `2026-10-29.1` describes the summary as three beats ending in one focus, and stops the report
  from mentioning commented-out code. `2026-11-02.1` hands the model the assignment's declared
  sections by key and asks for a score, feedback and reasoning per key, in place of rows the model
  discovered for itself.
*/
const PROMPT_VERSION = "2026-11-02.1";

/**
 * The names of the run's tests that one section chose, or null for a section that chose none
 * and so is read against the whole suite. Empty means none of its choices was in the run, which
 * the caller names for the instructor.
 */
function testsOf(unit: DeclaredUnit, tests: NormalizedTest[]): string[] | null {
  if (unit.tests.length === 0) return null;
  return tests
    .filter((test) => unit.tests.some((choice) => testMatches(choice, test)))
    .map((test) => (test.suite ? `${test.suite} › ${test.name}` : test.name));
}

/**
 * The previous round as the student read it, restricted to the sections this call fills: its
 * summary and the matching sections composed as one report, with their total.
 *
 * A round written before keys holds one section per type with its text whole; such a section is
 * reproduced as it was. `changes` is filled in by the caller.
 */
function previousReviewFor(
  round: {
    number: number;
    headSha: string | null;
    summaryMarkdown: string | null;
    editedSummaryMarkdown: string | null;
    sections: {
      sectionKey: string | null;
      label: string | null;
      sectionType: string;
      reportMarkdown: string | null;
      scoreEarned: number | null;
      scorePossible: number | null;
      editedReportMarkdown: string | null;
      editedScoreEarned: number | null;
    }[];
  },
  callUnits: DeclaredUnit[],
  family: SectionType[],
): PreviousReview | null {
  const keys = new Set(callUnits.map((unit) => unit.key));
  const own = round.sections
    .map(effectiveSection)
    .filter((section) =>
      section.sectionKey !== null
        ? keys.has(section.sectionKey)
        : (family as string[]).includes(section.sectionType),
    );
  if (own.length === 0) return null;

  const keyed = own.every((section) => section.sectionKey !== null);
  const earned = own.reduce((sum, section) => sum + (section.scoreEarned ?? 0), 0);
  const possible = own.reduce((sum, section) => sum + (section.scorePossible ?? 0), 0);
  const reportMarkdown = keyed
    ? composeRound({
        summaryMarkdown: round.editedSummaryMarkdown ?? round.summaryMarkdown ?? "",
        sections: own.map((section) => {
          const unit = callUnits.find((candidate) => candidate.key === section.sectionKey);
          return {
            label: section.label ?? unit?.label ?? section.sectionType,
            heading: unit?.heading ?? null,
            type: section.sectionType,
            scoreEarned: section.scoreEarned,
            scorePossible: section.scorePossible ?? 0,
            feedbackMarkdown: section.reportMarkdown ?? "",
          };
        }),
      })
    : own
        .map((section) => section.reportMarkdown?.trim())
        .filter((text): text is string => Boolean(text))
        .join("\n\n---\n\n");

  return {
    number: round.number,
    headSha: round.headSha,
    reportMarkdown,
    scoreEarned: earned,
    scorePossible: possible,
    changes: null,
  };
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
