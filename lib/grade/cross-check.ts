import { testMatches, type DeclaredTest } from "../assignments/test-names";
import { FLAG_FAMILY, type GradingReport } from "./schema";

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
 * run, each score against the section it was declared for, and every declared section
 * present exactly once. Never its score against the pass rate.
 *
 * Pure, so every rule below is checkable without a model or a database.
 */

export type TestOutcome = {
  suite: string;
  name: string;
  status: "passed" | "failed" | "skipped";
};

/** One section the model was asked to fill, as the assignment declares it. */
export type DeclaredSection = {
  key: string;
  label: string;
  /** The instrument: a type from lib/section-types.ts. */
  type: string;
  pointValue: number;
  /** The tests that count toward this section alone; absent or empty means the whole suite. */
  tests?: DeclaredTest[];
};

/** The verified facts a report is checked against. Absent fields mean no evidence. */
export type Facts = {
  /**
   * Per-test results from the run, or null when the call has no test evidence —
   * which is ordinary for short response and frontend work.
   */
  tests: TestOutcome[] | null;
  /** Protected paths changed in the pull request. Non-empty always routes to review. */
  tamperedPaths: { path: string; kind: string }[];
  /**
   * The sections this call was asked to fill, with what each is worth, from
   * `assignment.sections`. The report must carry each key exactly once and no other.
   */
  sections: DeclaredSection[];
};

export type CrossCheckFinding = {
  /** Machine-readable, so the interface can group findings without parsing prose. */
  code:
    | "INTERNAL_LABEL_IN_REPORT"
    | "SCORE_OUT_OF_RANGE"
    | "SECTION_MISSING"
    | "SECTION_UNKNOWN"
    | "SECTION_REPEATED"
    | "TEST_CLAIM_CONTRADICTION"
    | "UNKNOWN_TEST_CLAIMED"
    | "FULL_CREDIT_DESPITE_FAILURES"
    | "FLAG_WITHOUT_DEDUCTION"
    | "PROTECTED_PATHS_CHANGED";
  detail: string;
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

  // ---- Every declared section, exactly once --------------------------------
  //
  // The model is handed the sections to fill by key. A key it left out is a section with no
  // score, a key it invented is a score for nothing the assignment declares, and a key it wrote
  // twice is two scores for one section. All three are contradictions of the declaration rather
  // than judgments, so each is named and holds the draft.
  const declared = new Map(facts.sections.map((section) => [section.key, section]));
  const seen = new Set<string>();
  for (const section of report.sections) {
    const match = declared.get(section.key);
    if (!match) {
      findings.push({
        code: "SECTION_UNKNOWN",
        detail: `The report scores a section "${section.key}", which this call did not ask for.`,
      });
      continue;
    }
    if (seen.has(section.key)) {
      findings.push({
        code: "SECTION_REPEATED",
        detail: `The report scores "${match.label}" more than once.`,
      });
      continue;
    }
    seen.add(section.key);

    // Each score against the section's own maximum. The schema cannot express this, because
    // Claude's structured output rejects numeric constraints, and for an untested section it is
    // the ONLY automatic check on the number.
    if (section.scoreEarned < -EPSILON || section.scoreEarned - match.pointValue > EPSILON) {
      findings.push({
        code: "SCORE_OUT_OF_RANGE",
        detail: `"${match.label}" scores ${section.scoreEarned} out of ${match.pointValue}.`,
      });
    }
  }
  for (const section of facts.sections) {
    if (!seen.has(section.key)) {
      findings.push({
        code: "SECTION_MISSING",
        detail: `The report has no score for "${section.label}".`,
      });
    }
  }

  // Staff labels that must never reach a student.
  //
  // The prompt forbids these, but a prompt is guidance and this is the one leak with
  // no recovery: approving a draft posts its markdown to the pull request, and a
  // "FLAG: MECHANICAL ERRORS" line that survived review has been delivered. Held here
  // rather than stripped, because silently editing a report would hide the fact that
  // the model ignored an instruction. Every field the student reads is searched.
  const studentText = [
    report.summaryMarkdown,
    ...report.sections.map((section) => section.feedbackMarkdown),
  ].join("\n");
  const internalLabel = studentText.match(/FLAG:\s*[A-Z][A-Z _-]{3,}/);
  if (internalLabel) {
    findings.push({
      code: "INTERNAL_LABEL_IN_REPORT",
      detail:
        `The report text contains "${internalLabel[0].trim()}", which is an internal ` +
        `label rather than feedback. Remove it before approving — this text is posted ` +
        `to the student. The flag itself is recorded separately and is not affected.`,
    });
  }

  // ---- A flag the score does not reflect --------------------------------
  //
  // Every flag names a defect one of the rubric's bands scores: TERMINOLOGY is what
  // separates "uses correct terminology throughout" from "generally uses correct
  // terminology", and MECHANICAL is a Writing band bullet. So a report that raises a flag
  // and still awards every point in that band has reported a defect and deducted for it
  // nowhere. The writing band is the Writing Quality section; the technical band is the
  // short response questions.
  //
  // One direction only, on the same reasoning as FULL_CREDIT_DESPITE_FAILURES: full marks
  // means the defect was accounted for nowhere, while withholding a point without raising
  // a flag is ordinary judgment and is not checked.
  const scoreOf = new Map(report.sections.map((section) => [section.key, section.scoreEarned]));
  for (const family of ["technical", "writing"] as const) {
    const raised = report.flags.filter((flag) => FLAG_FAMILY[flag] === family);
    if (raised.length === 0) continue;

    const band = facts.sections.filter((section) =>
      family === "writing"
        ? section.type === "short_response_writing"
        : section.type === "short_response",
    );
    // No section scores this band, so its marks cannot be located. A check that cannot see
    // the numbers must say nothing rather than guess.
    if (band.length === 0) continue;

    const earned = sum(band.map((section) => scoreOf.get(section.key) ?? 0));
    const possible = sum(band.map((section) => section.pointValue));
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
    // Keyed on every form a model writes back, because the prompt shows tests as
    // "Suite › name" and a model that echoes that back is doing exactly as asked.
    // Matching only the bare name would report every correct claim as unverifiable — a
    // false positive on every submission, which is worse than no check at all.
    //
    // The "suite::name" form is pytest's own node id. The parser splits
    // "tests/test_debug.py::test_describe_mood" into a suite and a name, and the prompt
    // joins them back with "›", but a model that knows pytest writes the id as pytest
    // prints it. Without this key, every claim on a Python assignment was reported as a
    // test that did not run.
    const byName = new Map<string, TestOutcome>();
    for (const test of facts.tests) {
      byName.set(normalizeTestName(test.name), test);
      if (test.suite) {
        byName.set(normalizeTestName(`${test.suite} › ${test.name}`), test);
        byName.set(normalizeTestName(`${test.suite} > ${test.name}`), test);
        byName.set(normalizeTestName(`${test.suite}::${test.name}`), test);
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
    // Each declared section's score once, by key: a key the model repeated or invented is
    // already a finding of its own and must not count toward the total read here.
    const scored = new Map<string, number>();
    for (const section of report.sections) {
      if (!scored.has(section.key)) scored.set(section.key, section.scoreEarned);
    }
    const earned = sum(facts.sections.map((section) => scored.get(section.key) ?? 0));
    const possible = sum(facts.sections.map((section) => section.pointValue));

    // Each section that chose its tests, against those tests: full marks on a section whose own
    // test failed is the case the call's total hides when another section lost a point.
    let sectionFound = false;
    for (const section of facts.sections) {
      const chosen = section.tests ?? [];
      if (chosen.length === 0) continue;
      const own = failed.filter((test) => chosen.some((choice) => testMatches(choice, test)));
      const score = scored.get(section.key);
      if (own.length > 0 && score !== undefined && section.pointValue - score <= EPSILON) {
        sectionFound = true;
        findings.push({
          code: "FULL_CREDIT_DESPITE_FAILURES",
          detail:
            `${section.label} is given full marks (${score}/${section.pointValue}) while its own ` +
            `test${own.length === 1 ? "" : "s"} ${own.map((test) => `"${test.name}"`).join(", ")} failed.`,
        });
      }
    }

    // The call as a whole, where no section's own tests already said it.
    if (!sectionFound && failed.length > 0 && possible > 0 && possible - earned <= EPSILON) {
      findings.push({
        code: "FULL_CREDIT_DESPITE_FAILURES",
        detail:
          `The report awards full marks (${earned}/${possible}) ` +
          `while ${failed.length} test${failed.length === 1 ? "" : "s"} failed.`,
      });
    }
  }

  // ---- Facts that route to review regardless of the report --------------
  if (facts.tamperedPaths.length > 0) {
    findings.push({
      code: "PROTECTED_PATHS_CHANGED",
      detail:
        `This pull request modified ${facts.tamperedPaths.length} grading file(s): ` +
        `${facts.tamperedPaths.map((entry) => `${entry.path} (${entry.kind})`).join(", ")}. ` +
        `The template's versions were restored before the suite ran, so the results are ` +
        `unaffected — but an instructor must decide what the attempt means.`,
    });
  }

  /*
    Confidence is deliberately not a finding.

    It is a column on the round and a pill on the review screen, which says how sure the model
    was on every round always rather than conditionally. Low confidence on work with no suite
    to check against is the ordinary condition of most of this curriculum, so treating it as a
    fault would mark almost every short response and frontend round as exceptional — which is
    the fastest way to teach an instructor that the marking means nothing.
  */

  return {
    findings,
    // Every finding is a contradiction — a section scored above its maximum, a claim
    // about a test that never ran, full marks beside failures — so any of them is a reason a
    // draft must not be passed over.
    needsManualReview: findings.length > 0,
  };
}
