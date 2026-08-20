import type { GradingReport } from "./schema";

/**
 * Verifying a report against the facts, before an instructor ever sees it.
 *
 * The asymmetry here is the whole point, and a naive implementation gets it
 * backwards. Test results are a fact the model must not contradict, and one rubric
 * input among several. They are **not** the score.
 *
 * So a check written as "the claimed score must match the pass rate" would flag
 * exactly the judgment the model is there to make. A student who returns hardcoded
 * values to satisfy the assertions passes every test and has demonstrated nothing;
 * withholding points from them is correct, and a check comparing score to pass rate
 * would call that correct judgment an error.
 *
 * What is checked instead: the model's *claims about test outcomes* against the
 * run, and its arithmetic against itself. Never its score against the pass rate.
 *
 * Pure, so every rule below is checkable without a model or a database.
 */

export type TestOutcome = {
  suite: string;
  name: string;
  status: "passed" | "failed" | "skipped";
};

/** The verified facts a section is checked against. Absent fields mean no evidence. */
export type Facts = {
  /**
   * Per-test results from the run, or null when the section has no test evidence —
   * which is ordinary for short response and frontend work.
   */
  tests: TestOutcome[] | null;
  /** Protected paths the student changed. Non-empty always routes to review. */
  tamperedPaths: { path: string; kind: string }[];
  /**
   * What the section is worth, from `assignment.sections`.
   *
   * Required rather than optional, so a caller cannot omit the one number that makes the
   * score mean anything. Every caller has it: the pipeline refuses to grade a section
   * without a `pointValue` at all, and calibration reads it from the instructor's report.
   */
  pointValue: number;
};

export type CrossCheckFinding = {
  /** Machine-readable, so the interface can group findings without parsing prose. */
  code:
    | "ARITHMETIC_MISMATCH"
    | "REPORT_TEXT_SCORE_MISMATCH"
    | "INTERNAL_LABEL_IN_REPORT"
    | "SCORE_OUT_OF_RANGE"
    | "SCORE_POSSIBLE_MISMATCH"
    | "TEST_CLAIM_CONTRADICTION"
    | "UNKNOWN_TEST_CLAIMED"
    | "FULL_CREDIT_DESPITE_FAILURES"
    | "FLAG_WITHOUT_DEDUCTION"
    | "PROTECTED_PATHS_CHANGED";
  detail: string;
};

/**
 * Which rubric band each flag belongs to, so a raised flag can be checked against the marks
 * awarded in the band that scores it. Keyed by the flag vocabulary in `schema.ts`, whose
 * comments already group them as Writing Quality and Technical Score band bullets.
 *
 * Every flag the model may raise appears here. Codes the pipeline writes itself — the
 * cross-check's own findings, TEST_EVIDENCE, LOW_CONFIDENCE — are added after this runs and
 * belong to no band, so they map to nothing and are skipped.
 */
const FLAG_CRITERION_FAMILY: Partial<
  Record<GradingReport["flags"][number], "technical" | "writing">
> = {
  MECHANICAL: "writing",
  CLARITY: "writing",
  MARKDOWN: "writing",
  STRUCTURE: "writing",
  INCOMPLETE: "technical",
  UNDERSTANDING: "technical",
  TERMINOLOGY: "technical",
};

export type CrossCheckResult = {
  findings: CrossCheckFinding[];
  /** True when an instructor must look before this can reach a student. */
  needsManualReview: boolean;
};

/** Scores are floats — half credit is normal — so compare with a tolerance. */
const EPSILON = 0.001;

/**
 * Collapses whitespace and case so a claim matches despite cosmetic differences.
 *
 * Deliberately conservative: it does not fuzzy-match. A claim about a test that
 * genuinely did not run must still be reported, because an unverifiable statement
 * about a fact is the thing this check exists to catch.
 */
function normalizeTestName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function crossCheck(report: GradingReport, facts: Facts): CrossCheckResult {
  const findings: CrossCheckFinding[] = [];

  // ---- Arithmetic -------------------------------------------------------
  //
  // This applies to every section, tested or not, and for an untested section it
  // is the ONLY automatic check available. Worth remembering when weighing whether
  // it is redundant with schema validation: it is not, because the schema cannot
  // express numeric relationships on either provider.
  const itemsEarned = sum(report.rubricItems.map((item) => item.scoreEarned));
  const itemsPossible = sum(report.rubricItems.map((item) => item.scorePossible));

  if (Math.abs(itemsEarned - report.scoreEarned) > EPSILON) {
    findings.push({
      code: "ARITHMETIC_MISMATCH",
      detail: `The rubric items sum to ${itemsEarned} but the report claims ${report.scoreEarned}.`,
    });
  }
  if (Math.abs(itemsPossible - report.scorePossible) > EPSILON) {
    findings.push({
      code: "ARITHMETIC_MISMATCH",
      detail: `The rubric items are out of ${itemsPossible} but the report claims ${report.scorePossible}.`,
    });
  }

  // Staff labels that must never reach a student.
  //
  // The prompt forbids these, but a prompt is guidance and this is the one leak with
  // no recovery: approving a draft posts its markdown to the pull request, and a
  // "FLAG: MECHANICAL ERRORS" line that survived review has been delivered. Held here
  // rather than stripped, because silently editing a report would hide the fact that
  // the model ignored an instruction.
  const internalLabel = report.reportMarkdown.match(/FLAG:\s*[A-Z][A-Z _-]{3,}/);
  if (internalLabel) {
    findings.push({
      code: "INTERNAL_LABEL_IN_REPORT",
      detail:
        `The report text contains "${internalLabel[0].trim()}", which is an internal ` +
        `label rather than feedback. Remove it before approving — this text is posted ` +
        `to the student. The flag itself is recorded separately and is not affected.`,
    });
  }

  // The headline score in the markdown against the structured one.
  //
  // These are written by the same call but are not the same field, and a real
  // generation produced a report whose prose said 8/15 while its rubric items summed
  // to 10. The student reads the markdown; the gradebook records the number. Nothing
  // else compares them, so a disagreement would hand a student one score and keep
  // another, with no error anywhere.
  const stated = report.reportMarkdown.match(/^#{1,3}\s.*?Score:\s*([\d.]+)\s*\/\s*([\d.]+)/im);
  if (stated) {
    const statedEarned = Number(stated[1]);
    const statedPossible = Number(stated[2]);
    if (
      Math.abs(statedEarned - report.scoreEarned) > EPSILON ||
      Math.abs(statedPossible - report.scorePossible) > EPSILON
    ) {
      findings.push({
        code: "REPORT_TEXT_SCORE_MISMATCH",
        detail:
          `The report text says ${statedEarned}/${statedPossible} but the recorded ` +
          `score is ${report.scoreEarned}/${report.scorePossible}. The student would ` +
          `read one number and the gradebook would hold the other.`,
      });
    }
  }

  if (report.scoreEarned < -EPSILON) {
    findings.push({
      code: "SCORE_OUT_OF_RANGE",
      detail: `A negative score (${report.scoreEarned}) is not meaningful.`,
    });
  }
  if (report.scorePossible <= 0) {
    findings.push({
      code: "SCORE_OUT_OF_RANGE",
      detail: `The score is out of ${report.scorePossible}, which cannot be right.`,
    });
  }
  if (report.scoreEarned - report.scorePossible > EPSILON) {
    findings.push({
      code: "SCORE_OUT_OF_RANGE",
      detail: `The score ${report.scoreEarned} exceeds the maximum ${report.scorePossible}.`,
    });
  }

  /*
    The denominator, against the one the section actually carries.

    Every check above is the report against itself, and a report can be perfectly consistent
    about the wrong maximum: 0 out of 3 for a section worth 15 sums correctly, sits in range,
    and says nothing false about any test. The prompt is told the point value and the model is
    expected to restate it, which makes a different number a contradiction of a fact rather
    than a judgment — the same shape as a claim about a test outcome.

    This is the second half of a defence whose first half already exists. `generateReportForSubmission`
    refuses to grade a section with no `pointValue` at all, because a model told nothing about the
    maximum invents one; what was missing was checking the number that came back. Left unchecked it
    is not a visible fault but a silent one: approval copies `scorePossible` into
    `finalScorePossible`, so the gradebook records the invented denominator and computes completion
    against it.
  */
  if (Math.abs(report.scorePossible - facts.pointValue) > EPSILON) {
    findings.push({
      code: "SCORE_POSSIBLE_MISMATCH",
      detail:
        `The report is scored out of ${report.scorePossible}, but this section is worth ` +
        `${facts.pointValue}. Every score in it describes a different maximum than the one ` +
        `the gradebook will record.`,
    });
  }

  // ---- A flag the score does not reflect --------------------------------
  //
  // Every flag names a defect one of the rubric's bands scores: TERMINOLOGY is what
  // separates "uses correct terminology throughout" from "generally uses correct
  // terminology", and MECHANICAL is a Writing band bullet. So a report that raises a flag
  // and still awards every point in that band has reported a defect and deducted for it
  // nowhere.
  //
  // One direction only, on the same reasoning as FULL_CREDIT_DESPITE_FAILURES: full marks
  // means the defect was accounted for nowhere, while withholding a point without raising
  // a flag is ordinary judgment and is not checked.
  for (const family of ["technical", "writing"] as const) {
    const raised = report.flags.filter((flag) => FLAG_CRITERION_FAMILY[flag] === family);
    if (raised.length === 0) continue;

    const items = report.rubricItems.filter((item) =>
      item.criterion.toLowerCase().includes(family),
    );
    // No line item names this family, so its scores cannot be located. A check that cannot
    // see the numbers must say nothing rather than guess — the alternative is a finding on
    // every report whose criterion labels happen to be worded differently.
    if (items.length === 0) continue;

    const earned = sum(items.map((item) => item.scoreEarned));
    const possible = sum(items.map((item) => item.scorePossible));
    if (possible - earned <= EPSILON) {
      findings.push({
        code: "FLAG_WITHOUT_DEDUCTION",
        detail:
          `The report raises ${raised.join(", ")} but awards full ${family} marks ` +
          `(${earned}/${possible}), so nothing was deducted for what it reported.`,
      });
    }
  }

  // ---- Claims about test outcomes ---------------------------------------
  if (facts.tests !== null) {
    // Keyed on both forms, because the prompt shows tests as "Suite › name" and a
    // model that echoes that back is doing exactly as asked. Matching only the bare
    // name would report every correct claim as unverifiable — a false positive on
    // every submission, which is worse than no check at all.
    const byName = new Map<string, TestOutcome>();
    for (const test of facts.tests) {
      byName.set(normalizeTestName(test.name), test);
      if (test.suite) {
        byName.set(normalizeTestName(`${test.suite} › ${test.name}`), test);
        byName.set(normalizeTestName(`${test.suite} > ${test.name}`), test);
      }
    }

    for (const claim of report.testClaims) {
      const actual = byName.get(normalizeTestName(claim.testName));

      if (!actual) {
        // A test name that is not in the run means the report is describing
        // something that did not execute. Not necessarily dishonest — a
        // paraphrased name would do it — but it cannot be verified, and an
        // unverifiable claim about a fact is exactly what this check exists for.
        findings.push({
          code: "UNKNOWN_TEST_CLAIMED",
          detail: `The report claims a status for "${claim.testName}", which is not in the run's results.`,
        });
        continue;
      }

      if (actual.status !== claim.claimedStatus) {
        findings.push({
          code: "TEST_CLAIM_CONTRADICTION",
          detail:
            `The report says "${claim.testName}" ${claim.claimedStatus}, ` +
            `but the run recorded it as ${actual.status}.`,
        });
      }
    }

    // Full marks while tests failed. This is the one score-shaped check that is
    // safe, and it only fires in one direction: awarding everything means the
    // failures were not accounted for anywhere. The reverse — withholding points
    // when everything passed — is legitimate judgment and is deliberately allowed.
    const failed = facts.tests.filter((test) => test.status === "failed");
    if (failed.length > 0 && report.scorePossible - report.scoreEarned <= EPSILON) {
      findings.push({
        code: "FULL_CREDIT_DESPITE_FAILURES",
        detail:
          `The report awards full marks (${report.scoreEarned}/${report.scorePossible}) ` +
          `while ${failed.length} test${failed.length === 1 ? "" : "s"} failed.`,
      });
    }
  }

  // ---- Facts that route to review regardless of the report --------------
  if (facts.tamperedPaths.length > 0) {
    findings.push({
      code: "PROTECTED_PATHS_CHANGED",
      detail:
        `The student changed ${facts.tamperedPaths.length} grading file(s): ` +
        `${facts.tamperedPaths.map((entry) => `${entry.path} (${entry.kind})`).join(", ")}. ` +
        `The template's versions were restored before the suite ran, so the results are ` +
        `unaffected — but an instructor must decide what the attempt means.`,
    });
  }

  /*
    Confidence is deliberately not a finding.

    It is a column on the section and a pill on the review screen, which says how sure the model
    was on every section always rather than conditionally. Low confidence on work with no suite
    to check against is the ordinary condition of most of this curriculum, so treating it as a
    fault would mark almost every short response and frontend section as exceptional — which is
    the fastest way to teach an instructor that the marking means nothing.
  */

  return {
    findings,
    // Every finding is a contradiction — rubric points that do not sum to the score, a claim
    // about a test that never ran, full marks beside failures — so any of them is a reason a
    // draft must not be passed over.
    needsManualReview: findings.length > 0,
  };
}
