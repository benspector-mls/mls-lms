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
};

export type CrossCheckFinding = {
  /** Machine-readable, so the interface can group findings without parsing prose. */
  code:
    | "ARITHMETIC_MISMATCH"
    | "REPORT_TEXT_SCORE_MISMATCH"
    | "INTERNAL_LABEL_IN_REPORT"
    | "SCORE_OUT_OF_RANGE"
    | "TEST_CLAIM_CONTRADICTION"
    | "UNKNOWN_TEST_CLAIMED"
    | "FULL_CREDIT_DESPITE_FAILURES"
    | "PROTECTED_PATHS_CHANGED";
  detail: string;
};

/**
 * Findings that describe uncertainty rather than a fault.
 *
 * Every finding this module produces today is a contradiction: rubric points that do not sum
 * to the score, a claim about a test that never ran, full marks beside failures. Those are
 * reasons a draft must not be passed over, and they hold it back.
 *
 * The distinction had one member and no longer does. Low confidence was it — the model saying
 * it found the work hard to judge, which is the honest answer for a section with no suite to
 * check against, meaning short response and frontend work, most of the curriculum. Holding
 * those back marked every one of them as exceptional, which is the fastest way to teach an
 * instructor that the marking means nothing. It is now the confidence pill on the section and
 * not a finding at all, so there is nothing left here to exempt.
 *
 * That remains sound only because nothing is sent without approval.
 */
const NON_GATING_FINDINGS: ReadonlySet<CrossCheckFinding["code"]> = new Set([
  // Empty, and kept rather than deleted. Every finding this module produces today is a
  // contradiction, so every one of them gates — but "which findings are only a hint" is a real
  // question that had a member until low confidence stopped being a finding at all, and it is
  // the seam a future non-gating finding belongs in. Deleting it would mean rediscovering the
  // distinction the next time one exists.
]);

/** True when this finding alone should keep a draft from being offered as ready. */
export function findingGatesApproval(code: CrossCheckFinding["code"]): boolean {
  return !NON_GATING_FINDINGS.has(code);
}

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
      detail:
        `The rubric items sum to ${itemsEarned} but the report claims ${report.scoreEarned}.`,
    });
  }
  if (Math.abs(itemsPossible - report.scorePossible) > EPSILON) {
    findings.push({
      code: "ARITHMETIC_MISMATCH",
      detail:
        `The rubric items are out of ${itemsPossible} but the report claims ${report.scorePossible}.`,
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
    Low confidence is deliberately NOT a finding.

    It used to be one, non-gating, whose only effect was a badge on the section — and the
    section already carries a confidence pill, which says the same thing always rather than
    conditionally. Two badges for one fact, and the fact is a column on the row.

    What has not changed is the decision underneath: low confidence does not hold a draft back.
    That is only sound because nothing reaches a student without approval, so if automatic
    approval is ever built, confidence has to gate again — and this is where that would go.
  */

  return {
    findings,
    needsManualReview: findings.some((finding) => findingGatesApproval(finding.code)),
  };
}
