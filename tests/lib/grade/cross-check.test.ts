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

/** The sections a call was asked to fill: two exercises worth 3 and 7. */
const declared: Facts["sections"] = [
  { key: "q1", label: "Question 1: is_even", type: "coding_algorithm", pointValue: 3 },
  { key: "q2", label: "Question 2: fizzbuzz", type: "coding_algorithm", pointValue: 7 },
];

/** A report that is internally consistent, so each case varies one thing. */
function report(overrides: Partial<GradingReport> = {}): GradingReport {
  return {
    summaryMarkdown: "Nice work.",
    sections: [
      { key: "q1", scoreEarned: 3, feedbackMarkdown: "", modelReasoning: null },
      { key: "q2", scoreEarned: 5, feedbackMarkdown: "", modelReasoning: "off by one" },
    ],
    flags: [],
    instructorNotes: [],
    confidence: "high",
    submissionProcessNote: null,
    testClaims: [],
    ...overrides,
  };
}

const noFacts: Facts = { tests: null, tamperedPaths: [], sections: declared };
const codes = (result: ReturnType<typeof crossCheck>) => result.findings.map((f) => f.code).sort();

describe("every declared section, exactly once", () => {
  it("passes a report that scores each declared section once", () => {
    expect(crossCheck(report(), noFacts).findings).toEqual([]);
  });

  it("names a declared section the report left out", () => {
    const result = crossCheck(
      report({
        sections: [{ key: "q1", scoreEarned: 3, feedbackMarkdown: "", modelReasoning: null }],
      }),
      noFacts,
    );
    expect(codes(result)).toEqual(["SECTION_MISSING"]);
    expect(result.findings[0]!.detail).toContain("Question 2: fizzbuzz");
    expect(result.needsManualReview).toBe(true);
  });

  it("names a section the report invented", () => {
    const result = crossCheck(
      report({
        sections: [
          ...report().sections,
          { key: "q3", scoreEarned: 1, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(codes(result)).toEqual(["SECTION_UNKNOWN"]);
  });

  it("names a section the report scored twice", () => {
    const result = crossCheck(
      report({
        sections: [
          ...report().sections,
          { key: "q1", scoreEarned: 2, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(codes(result)).toEqual(["SECTION_REPEATED"]);
  });
});

describe("arithmetic", () => {
  it("catches a section scored above its own points", () => {
    const result = crossCheck(
      report({
        sections: [
          { key: "q1", scoreEarned: 4, feedbackMarkdown: "", modelReasoning: null },
          { key: "q2", scoreEarned: 5, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(codes(result)).toEqual(["SCORE_OUT_OF_RANGE"]);
    expect(result.findings[0]!.detail).toBe('"Question 1: is_even" scores 4 out of 3.');
  });

  it("catches a negative score", () => {
    const result = crossCheck(
      report({
        sections: [
          { key: "q1", scoreEarned: -1, feedbackMarkdown: "", modelReasoning: null },
          { key: "q2", scoreEarned: 5, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(codes(result)).toEqual(["SCORE_OUT_OF_RANGE"]);
  });

  it("accepts half credit", () => {
    const result = crossCheck(
      report({
        sections: [
          { key: "q1", scoreEarned: 2.5, feedbackMarkdown: "", modelReasoning: null },
          { key: "q2", scoreEarned: 7, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(result.findings).toEqual([]);
  });
});

describe("staff labels leaking into the report text", () => {
  it("catches a flag left in the summary", () => {
    const result = crossCheck(
      report({ summaryMarkdown: "Good.\n\nFLAG: MECHANICAL ERRORS\n" }),
      noFacts,
    );
    expect(codes(result)).toEqual(["INTERNAL_LABEL_IN_REPORT"]);
  });

  it("catches a flag left in a section's feedback", () => {
    const result = crossCheck(
      report({
        sections: [
          {
            key: "q1",
            scoreEarned: 3,
            feedbackMarkdown: "FLAG: TERMINOLOGY",
            modelReasoning: null,
          },
          { key: "q2", scoreEarned: 5, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(codes(result)).toEqual(["INTERNAL_LABEL_IN_REPORT"]);
  });

  it("does not object to the flag recorded in the flags array", () => {
    expect(crossCheck(report({ flags: ["TERMINOLOGY"] }), noFacts).findings).toEqual([]);
  });

  it("does not trip on the word flag in an ordinary sentence", () => {
    const result = crossCheck(
      report({ summaryMarkdown: "The flag: a variable named `done` would read better." }),
      noFacts,
    );
    expect(result.findings).toEqual([]);
  });
});

describe("claims about test outcomes", () => {
  const tests: Facts["tests"] = [
    { suite: "From Scratch", name: "is_even - returns true for evens", status: "passed" },
    { suite: "tests/test_debug.py", name: "test_describe_mood", status: "failed" },
  ];
  const facts: Facts = { tests, tamperedPaths: [], sections: declared };

  it("passes a claim that matches the run", () => {
    const result = crossCheck(
      report({
        testClaims: [{ testName: "is_even - returns true for evens", claimedStatus: "passed" }],
      }),
      facts,
    );
    expect(result.findings).toEqual([]);
  });

  it("catches claiming a failed test passed", () => {
    const result = crossCheck(
      report({ testClaims: [{ testName: "test_describe_mood", claimedStatus: "passed" }] }),
      facts,
    );
    expect(codes(result)).toEqual(["TEST_CLAIM_CONTRADICTION"]);
  });

  it("matches a claim using the qualified Suite › name form", () => {
    const result = crossCheck(
      report({
        testClaims: [
          { testName: "From Scratch › is_even - returns true for evens", claimedStatus: "passed" },
        ],
      }),
      facts,
    );
    expect(result.findings).toEqual([]);
  });

  it("matches a claim using pytest's file::test node id form", () => {
    const result = crossCheck(
      report({
        testClaims: [
          { testName: "tests/test_debug.py::test_describe_mood", claimedStatus: "failed" },
        ],
      }),
      facts,
    );
    expect(result.findings).toEqual([]);
  });

  it("is not broken by differences of case and whitespace", () => {
    const result = crossCheck(
      report({
        testClaims: [{ testName: "  IS_EVEN - returns   true for evens", claimedStatus: "passed" }],
      }),
      facts,
    );
    expect(result.findings).toEqual([]);
  });

  it("catches a claim about a test that did not run", () => {
    const result = crossCheck(
      report({ testClaims: [{ testName: "something else", claimedStatus: "passed" }] }),
      facts,
    );
    expect(codes(result)).toEqual(["UNKNOWN_TEST_CLAIMED"]);
  });

  it("catches full marks awarded while a test failed", () => {
    const result = crossCheck(
      report({
        sections: [
          { key: "q1", scoreEarned: 3, feedbackMarkdown: "", modelReasoning: null },
          { key: "q2", scoreEarned: 7, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      facts,
    );
    expect(codes(result)).toEqual(["FULL_CREDIT_DESPITE_FAILURES"]);
  });

  it("catches full marks on a section whose own chosen test failed, though the call lost a point", () => {
    const own: Facts = {
      tests,
      tamperedPaths: [],
      sections: [
        { ...declared[0]!, tests: [{ suite: "tests/test_debug.py", name: "test_describe_mood" }] },
        declared[1]!,
      ],
    };
    // q1 at 3/3 with its own test failing; q2 at 5/7 keeps the call below full marks.
    const result = crossCheck(report(), own);
    expect(codes(result)).toEqual(["FULL_CREDIT_DESPITE_FAILURES"]);
    expect(result.findings[0]!.detail).toContain("Question 1: is_even");

    const docked = crossCheck(
      report({
        sections: [
          { key: "q1", scoreEarned: 2, feedbackMarkdown: "", modelReasoning: null },
          { key: "q2", scoreEarned: 5, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      own,
    );
    expect(codes(docked)).toEqual([]);
  });

  /*
    The case the whole file exists for. Everything passed and the model still withheld
    points — for hardcoded returns, poor naming, whatever it saw in the code. That is the
    judgment it is there to make, and it produces no finding.
  */
  it("treats withholding points despite a 100% pass rate as legitimate", () => {
    const allPassed: Facts = {
      tests: tests.map((test) => ({ ...test, status: "passed" as const })),
      tamperedPaths: [],
      sections: declared,
    };
    const result = crossCheck(
      report({
        sections: [
          { key: "q1", scoreEarned: 1, feedbackMarkdown: "", modelReasoning: "hardcoded" },
          { key: "q2", scoreEarned: 2, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      allPassed,
    );
    expect(result.findings).toEqual([]);
    expect(result.needsManualReview).toBe(false);
  });
});

describe("a flag the score does not reflect", () => {
  const shortResponse: Facts["sections"] = [
    { key: "q1", label: "Question 1", type: "short_response", pointValue: 3 },
    { key: "q2", label: "Question 2", type: "short_response", pointValue: 3 },
    { key: "writing", label: "Writing Quality", type: "short_response_writing", pointValue: 3 },
  ];
  const facts: Facts = { tests: null, tamperedPaths: [], sections: shortResponse };
  const scored = (q1: number, q2: number, writing: number) => [
    { key: "q1", scoreEarned: q1, feedbackMarkdown: "", modelReasoning: null },
    { key: "q2", scoreEarned: q2, feedbackMarkdown: "", modelReasoning: null },
    { key: "writing", scoreEarned: writing, feedbackMarkdown: "", modelReasoning: null },
  ];

  it("catches a technical flag beside full technical marks", () => {
    const result = crossCheck(report({ sections: scored(3, 3, 2), flags: ["TERMINOLOGY"] }), facts);
    expect(codes(result)).toEqual(["FLAG_WITHOUT_DEDUCTION"]);
    expect(result.findings[0]!.detail).toContain("full technical marks (6/6)");
  });

  it("catches a writing flag beside full writing marks", () => {
    const result = crossCheck(report({ sections: scored(2, 3, 3), flags: ["MECHANICAL"] }), facts);
    expect(codes(result)).toEqual(["FLAG_WITHOUT_DEDUCTION"]);
    expect(result.findings[0]!.detail).toContain("full writing marks (3/3)");
  });

  it("names each band separately when both are at full marks", () => {
    const result = crossCheck(
      report({ sections: scored(3, 3, 3), flags: ["MECHANICAL", "INCOMPLETE"] }),
      facts,
    );
    expect(codes(result)).toEqual(["FLAG_WITHOUT_DEDUCTION", "FLAG_WITHOUT_DEDUCTION"]);
  });

  it("passes when the flagged band lost a point", () => {
    expect(
      crossCheck(report({ sections: scored(3, 2, 3), flags: ["UNDERSTANDING"] }), facts).findings,
    ).toEqual([]);
    expect(
      crossCheck(report({ sections: scored(3, 3, 2), flags: ["MARKDOWN"] }), facts).findings,
    ).toEqual([]);
  });

  it("says nothing when no section scores the flagged band", () => {
    // A coding round carries no writing section, so a writing flag's marks cannot be located.
    expect(crossCheck(report({ flags: ["MECHANICAL"] }), noFacts).findings).toEqual([]);
  });

  it("raises no finding when no flag is raised", () => {
    expect(crossCheck(report({ sections: scored(3, 3, 3) }), facts).findings).toEqual([]);
  });
});

describe("facts that route regardless of the report", () => {
  it("always routes a changed protected path to review", () => {
    const result = crossCheck(report(), {
      ...noFacts,
      tamperedPaths: [{ path: "tests/from-scratch.spec.js", kind: "modified" }],
    });
    expect(codes(result)).toEqual(["PROTECTED_PATHS_CHANGED"]);
    expect(result.needsManualReview).toBe(true);
  });
});

describe("confidence", () => {
  it("produces no finding", () => {
    expect(crossCheck(report({ confidence: "low" }), noFacts).findings).toEqual([]);
  });

  it("does not hold a draft back", () => {
    expect(crossCheck(report({ confidence: "low" }), noFacts).needsManualReview).toBe(false);
  });

  it("does not stop a real fault beside it from holding one back", () => {
    const result = crossCheck(
      report({
        confidence: "low",
        sections: [
          { key: "q1", scoreEarned: 9, feedbackMarkdown: "", modelReasoning: null },
          { key: "q2", scoreEarned: 5, feedbackMarkdown: "", modelReasoning: null },
        ],
      }),
      noFacts,
    );
    expect(result.needsManualReview).toBe(true);
  });
});
