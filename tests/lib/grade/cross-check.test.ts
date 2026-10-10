import { crossCheck, type Facts } from "@/lib/grade/cross-check";
import type { GradingReport } from "@/lib/grade/schema";

/**
 * What a report is checked against before an instructor reads it.
 *
 * **The rule is asymmetric, and a plausible-looking implementation gets it backwards.** Test
 * results are a fact the model must not contradict, and NOT the score. Withholding points from
 * code that passes every test is precisely the judgment the model exists to make, so a check
 * comparing score against pass rate would flag the behaviour we want. There is no such check, and
 * the case that proves it is at the bottom of this file.
 */

/** A report that is internally consistent, so each case varies one thing. */
function report(overrides: Partial<GradingReport> = {}): GradingReport {
  return {
    summaryMarkdown: "Nice work.",
    rubricItems: [
      {
        label: "Q1",
        criterion: "algorithm",
        scoreEarned: 3,
        scorePossible: 3,
        group: null,
        feedbackMarkdown: "",
        modelReasoning: null,
      },
      {
        label: "Q1 style",
        criterion: "code_style",
        scoreEarned: 1,
        scorePossible: 1,
        group: null,
        feedbackMarkdown: "",
        modelReasoning: null,
      },
      {
        label: "Q2",
        criterion: "algorithm",
        scoreEarned: 5,
        scorePossible: 7,
        group: null,
        feedbackMarkdown: "",
        modelReasoning: "off by one",
      },
      {
        label: "Q2 style",
        criterion: "code_style",
        scoreEarned: 1,
        scorePossible: 1,
        group: null,
        feedbackMarkdown: "",
        modelReasoning: null,
      },
    ],
    flags: [],
    instructorNotes: [],
    confidence: "high",
    submissionProcessNote: null,
    testClaims: [],
    ...overrides,
  };
}

/* The default `report()` is scored out of 12, so the fixtures agree with that maximum and only
   the case under test differs from it. */
const noFacts: Facts = { tests: null, tamperedPaths: [], pointValue: 12 };
const codes = (result: ReturnType<typeof crossCheck>) => result.findings.map((f) => f.code).sort();

describe("arithmetic", () => {
  it("passes a consistent report with no facts to check against", () => {
    expect(crossCheck(report(), noFacts).needsManualReview).toBe(false);
  });

  it("catches a row scored above its own maximum, even when the total is in range", () => {
    const [first, second, ...rest] = report().rubricItems;
    expect(
      codes(
        crossCheck(
          report({
            rubricItems: [{ ...first, scoreEarned: 4 }, { ...second, scoreEarned: 0 }, ...rest],
          }),
          noFacts,
        ),
      ),
    ).toEqual(["SCORE_OUT_OF_RANGE"]);
  });

  it("catches earning more than was possible", () => {
    expect(
      codes(
        crossCheck(
          report({
            rubricItems: [
              {
                label: "x",
                criterion: "a",
                scoreEarned: 13,
                scorePossible: 12,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
            ],
          }),
          noFacts,
        ),
      ),
    ).toEqual(["SCORE_OUT_OF_RANGE"]);
  });

  it("accepts half credit", () => {
    expect(
      crossCheck(
        report({
          rubricItems: [
            {
              label: "x",
              criterion: "checklist",
              scoreEarned: 5.5,
              scorePossible: 6,
              group: null,
              feedbackMarkdown: "",
              modelReasoning: null,
            },
          ],
        }),
        { ...noFacts, pointValue: 6 },
      ).needsManualReview,
    ).toBe(false);
  });
});

/**
 * Approving a draft posts its markdown to the pull request, so a staff label left in the text is
 * delivered to the student with no way to take it back. The prompt forbids it; this is the guard
 * that does not depend on the model complying.
 */
describe("staff labels leaking into the report text", () => {
  it("catches a flag left in the prose", () => {
    expect(
      codes(
        crossCheck(
          report({ summaryMarkdown: "**FLAG: MECHANICAL ERRORS**\n\nNice work." }),
          noFacts,
        ),
      ),
    ).toEqual(["INTERNAL_LABEL_IN_REPORT"]);
  });

  it("catches a flag left in a row's feedback", () => {
    const [first, ...rest] = report().rubricItems;
    expect(
      codes(
        crossCheck(
          report({ rubricItems: [{ ...first, feedbackMarkdown: "- FLAG: CLARITY" }, ...rest] }),
          noFacts,
        ),
      ),
    ).toEqual(["INTERNAL_LABEL_IN_REPORT"]);
  });

  it("does not object to the flag recorded in the flags array", () => {
    expect(crossCheck(report({ flags: ["MECHANICAL"] }), noFacts).needsManualReview).toBe(false);
  });

  it("does not trip on the word flag in an ordinary sentence", () => {
    expect(
      crossCheck(
        report({
          summaryMarkdown: "Your code does not flag: invalid input goes unchecked.",
        }),
        noFacts,
      ).needsManualReview,
    ).toBe(false);
  });
});

describe("claims about test outcomes", () => {
  const runTests = [
    { suite: "From Scratch Tests", name: "loop5to10 works", status: "passed" as const },
    { suite: "From Scratch Tests", name: "fizzbuzz works", status: "failed" as const },
  ];
  const withTests: Facts = { tests: runTests, tamperedPaths: [], pointValue: 12 };

  it("passes a claim that matches the run", () => {
    expect(
      crossCheck(
        report({ testClaims: [{ testName: "fizzbuzz works", claimedStatus: "failed" }] }),
        withTests,
      ).needsManualReview,
    ).toBe(false);
  });

  it("catches claiming a failed test passed", () => {
    expect(
      codes(
        crossCheck(
          report({ testClaims: [{ testName: "fizzbuzz works", claimedStatus: "passed" }] }),
          withTests,
        ),
      ),
    ).toEqual(["TEST_CLAIM_CONTRADICTION"]);
  });

  // The prompt shows tests as "Suite › name", so a model echoing that back must match. Before
  // this was handled, every correct claim was reported as an unknown test.
  it("matches a claim using the qualified Suite › name form", () => {
    expect(
      crossCheck(
        report({
          testClaims: [
            { testName: "From Scratch Tests › fizzbuzz works", claimedStatus: "failed" },
          ],
        }),
        withTests,
      ).needsManualReview,
    ).toBe(false);
  });

  it("still catches a contradiction in the qualified form", () => {
    expect(
      codes(
        crossCheck(
          report({
            testClaims: [
              { testName: "From Scratch Tests › fizzbuzz works", claimedStatus: "passed" },
            ],
          }),
          withTests,
        ),
      ),
    ).toEqual(["TEST_CLAIM_CONTRADICTION"]);
  });

  // A pytest test's real name is its node id, "tests/test_file.py::test_name". The prompt
  // shows it joined with "›", but a model that knows pytest writes the id back as pytest
  // prints it, and every claim on a Python assignment was reported as an unknown test.
  it("matches a claim using pytest's file::test node id form", () => {
    const pytestFacts: Facts = {
      tests: [
        { suite: "tests/test_debug.py", name: "test_describe_mood_output", status: "passed" },
        { suite: "tests/test_from_scratch.py", name: "test_is_even", status: "failed" },
      ],
      tamperedPaths: [],
      pointValue: 12,
    };
    expect(
      crossCheck(
        report({
          testClaims: [
            { testName: "tests/test_debug.py::test_describe_mood_output", claimedStatus: "passed" },
            { testName: "tests/test_from_scratch.py::test_is_even", claimedStatus: "failed" },
          ],
        }),
        pytestFacts,
      ).needsManualReview,
    ).toBe(false);

    expect(
      codes(
        crossCheck(
          report({
            testClaims: [
              { testName: "tests/test_from_scratch.py::test_is_even", claimedStatus: "passed" },
            ],
          }),
          pytestFacts,
        ),
      ),
    ).toEqual(["TEST_CLAIM_CONTRADICTION"]);
  });

  it("is not broken by differences of case and whitespace", () => {
    expect(
      crossCheck(
        report({
          testClaims: [
            { testName: "  FROM SCRATCH TESTS ›  Fizzbuzz   Works ", claimedStatus: "failed" },
          ],
        }),
        withTests,
      ).needsManualReview,
    ).toBe(false);
  });

  it("catches a claim about a test that did not run", () => {
    expect(
      codes(
        crossCheck(
          report({ testClaims: [{ testName: "invented test", claimedStatus: "passed" }] }),
          withTests,
        ),
      ),
    ).toEqual(["UNKNOWN_TEST_CLAIMED"]);
  });

  it("catches full marks awarded while a test failed", () => {
    expect(
      codes(
        crossCheck(
          report({
            rubricItems: [
              {
                label: "x",
                criterion: "algorithm",
                scoreEarned: 12,
                scorePossible: 12,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
            ],
          }),
          withTests,
        ),
      ),
    ).toEqual(["FULL_CREDIT_DESPITE_FAILURES"]);
  });

  // THE case. Every test passed and the model withheld points anyway — hardcoded values,
  // inefficiency, style. This must NOT be flagged; a check comparing score against pass rate
  // would flag it, which is why no such check exists.
  it("treats withholding points despite a 100% pass rate as legitimate", () => {
    const allPassed: Facts = {
      tests: [
        { suite: "S", name: "a", status: "passed" },
        { suite: "S", name: "b", status: "passed" },
      ],
      tamperedPaths: [],
      pointValue: 12,
    };

    expect(
      crossCheck(
        report({
          rubricItems: [
            {
              label: "hardcoded",
              criterion: "algorithm",
              scoreEarned: 6,
              scorePossible: 12,
              group: null,
              feedbackMarkdown: "",
              modelReasoning: "returns literals",
            },
          ],
          testClaims: [
            { testName: "a", claimedStatus: "passed" },
            { testName: "b", claimedStatus: "passed" },
          ],
        }),
        allPassed,
      ),
    ).toEqual({ findings: [], needsManualReview: false });
  });
});

/**
 * A flag names a defect the rubric's bands score, so raising one and awarding every point in
 * that band deducts for the defect nowhere.
 *
 * Asymmetric in the same way the test-failure rule is: full marks beside a flag is a fault,
 * and a deduction with no flag is ordinary judgment. Calibration found both tiers raising
 * TERMINOLOGY and awarding near-full technical marks, which is what this exists to name.
 */
describe("a flag the score does not reflect", () => {
  /** These reports are out of 15, so the section they are checked against is worth 15. */
  const srFacts: Facts = { ...noFacts, pointValue: 15 };

  /** Short-response shaped, at full marks, because that is where the flag vocabulary applies. */
  function shortResponse(overrides: Partial<GradingReport> = {}): GradingReport {
    return report({
      rubricItems: [
        {
          label: "Q1",
          criterion: "technical",
          scoreEarned: 3,
          scorePossible: 3,
          group: null,
          feedbackMarkdown: "",
          modelReasoning: null,
        },
        {
          label: "Q2",
          criterion: "technical",
          scoreEarned: 3,
          scorePossible: 3,
          group: null,
          feedbackMarkdown: "",
          modelReasoning: null,
        },
        {
          label: "Q3",
          criterion: "technical",
          scoreEarned: 3,
          scorePossible: 3,
          group: null,
          feedbackMarkdown: "",
          modelReasoning: null,
        },
        {
          label: "Q4",
          criterion: "technical",
          scoreEarned: 3,
          scorePossible: 3,
          group: null,
          feedbackMarkdown: "",
          modelReasoning: null,
        },
        {
          label: "Writing",
          criterion: "writing_quality",
          scoreEarned: 3,
          scorePossible: 3,
          group: null,
          feedbackMarkdown: "",
          modelReasoning: null,
        },
      ],
      ...overrides,
    });
  }

  it("catches a technical flag beside full technical marks", () => {
    expect(codes(crossCheck(shortResponse({ flags: ["TERMINOLOGY"] }), srFacts))).toEqual([
      "FLAG_WITHOUT_DEDUCTION",
    ]);
  });

  it("catches a writing flag beside full writing marks", () => {
    expect(codes(crossCheck(shortResponse({ flags: ["MECHANICAL"] }), srFacts))).toEqual([
      "FLAG_WITHOUT_DEDUCTION",
    ]);
  });

  it("names each band separately when both are at full marks", () => {
    expect(
      codes(crossCheck(shortResponse({ flags: ["TERMINOLOGY", "MECHANICAL"] }), srFacts)),
    ).toEqual(["FLAG_WITHOUT_DEDUCTION", "FLAG_WITHOUT_DEDUCTION"]);
  });

  it("passes when the flagged band lost a point", () => {
    expect(
      codes(
        crossCheck(
          shortResponse({
            flags: ["TERMINOLOGY"],
            rubricItems: [
              {
                label: "Q1",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Q2",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Q3",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Q4",
                criterion: "technical",
                scoreEarned: 2,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: "term",
              },
              {
                label: "Writing",
                criterion: "writing_quality",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
            ],
          }),
          srFacts,
        ),
      ),
    ).toEqual([]);
  });

  it("does not fire on the other band when only one is flagged", () => {
    expect(
      codes(
        crossCheck(
          shortResponse({
            flags: ["MECHANICAL"],
            rubricItems: [
              {
                label: "Q1",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Q2",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Q3",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Q4",
                criterion: "technical",
                scoreEarned: 3,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
              {
                label: "Writing",
                criterion: "writing_quality",
                scoreEarned: 2,
                scorePossible: 3,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: "typos",
              },
            ],
          }),
          srFacts,
        ),
      ),
    ).toEqual([]);
  });

  it("says nothing when no line item names the flagged band", () => {
    expect(codes(crossCheck(report({ flags: ["TERMINOLOGY"] }), noFacts))).toEqual([]);
  });

  it("raises no finding when no flag is raised", () => {
    expect(codes(crossCheck(shortResponse(), srFacts))).toEqual([]);
  });
});

/**
 * The denominator, against the one the section carries.
 *
 * Every other arithmetic rule checks the report against itself, and a report can be entirely
 * self-consistent about the wrong maximum. Calibration produced one: 0 out of 3 on a section
 * worth 15, summing correctly and in range, which no other check here can see. It matters more
 * than it looks because approval copies `scorePossible` into `finalScorePossible`, so an
 * invented denominator reaches the gradebook rather than an error message.
 */
describe("the denominator against the section's point value", () => {
  /** The shape calibration actually returned: internally consistent, wrong scale. */
  function wrongScale(): GradingReport {
    return report({
      rubricItems: [
        {
          label: "Writing Quality",
          criterion: "writing",
          scoreEarned: 0,
          scorePossible: 3,
          group: null,
          feedbackMarkdown: "",
          modelReasoning: null,
        },
      ],
    });
  }

  it("catches a report scored out of the wrong maximum", () => {
    expect(codes(crossCheck(wrongScale(), { ...noFacts, pointValue: 15 }))).toEqual([
      "SCORE_POSSIBLE_MISMATCH",
    ]);
  });

  it("holds that report back rather than letting it reach a gradebook", () => {
    expect(crossCheck(wrongScale(), { ...noFacts, pointValue: 15 }).needsManualReview).toBe(true);
  });

  it("says nothing when the report is scored out of the section's own value", () => {
    expect(codes(crossCheck(report(), { ...noFacts, pointValue: 12 }))).toEqual([]);
  });

  it("catches a maximum that is too large as well as too small", () => {
    expect(codes(crossCheck(report(), { ...noFacts, pointValue: 10 }))).toEqual([
      "SCORE_POSSIBLE_MISMATCH",
    ]);
  });

  it("tolerates a fractional point value, since half credit is normal", () => {
    expect(
      codes(
        crossCheck(
          report({
            rubricItems: [
              {
                label: "Q1",
                criterion: "algorithm",
                scoreEarned: 5.5,
                scorePossible: 12,
                group: null,
                feedbackMarkdown: "",
                modelReasoning: null,
              },
            ],
          }),
          { ...noFacts, pointValue: 12 },
        ),
      ),
    ).toEqual([]);
  });
});

describe("facts that route regardless of the report", () => {
  it("always routes a changed protected path to review", () => {
    expect(
      codes(
        crossCheck(report(), {
          tests: null,
          tamperedPaths: [{ path: "tests/a.spec.js", kind: "modified" }],
          pointValue: 12,
        }),
      ),
    ).toEqual(["PROTECTED_PATHS_CHANGED"]);
  });
});

/**
 * Low confidence is recorded and does NOT hold the draft back.
 *
 * It is the honest answer for a section with no suite to check against — short response and
 * frontend work, most of the curriculum — so gating on it marked nearly everything as exceptional
 * and taught the instructor to ignore the marking. It is a badge on the section instead.
 *
 * All three are asserted together on purpose: it must produce no finding, it must not gate, and a
 * real fault beside it must still gate. Sound only because nothing is ever sent without approval;
 * if automatic approval is ever built, this has to gate again.
 */
describe("confidence", () => {
  it("produces no finding", () => {
    expect(codes(crossCheck(report({ confidence: "low" }), noFacts))).toEqual([]);
  });

  it("does not hold a draft back", () => {
    expect(crossCheck(report({ confidence: "low" }), noFacts).needsManualReview).toBe(false);
  });

  it("does not stop a real fault beside it from holding one back", () => {
    expect(
      crossCheck(
        report({
          confidence: "low",
          rubricItems: [
            {
              label: "x",
              group: null,
              criterion: "a",
              scoreEarned: 13,
              scorePossible: 12,
              feedbackMarkdown: "",
              modelReasoning: null,
            },
          ],
        }),
        noFacts,
      ).needsManualReview,
    ).toBe(true);
  });
});
