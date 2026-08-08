import { extractRubricSection } from "@/lib/grade/assets";
import { gradingReportJsonSchema, parseGradingReport, REPORT_FLAGS } from "@/lib/grade/schema";
import type { GradingReport } from "@/lib/grade/schema";

/**
 * The shape the model is asked for, and what is done with the rubric it is given.
 *
 * Both of these are about the boundary with a third party: the schema is what a provider is
 * handed and has to accept, and the rubric slice is what it is allowed to see.
 */

/** A report that is internally consistent, so each case varies one thing. */
function report(overrides: Partial<GradingReport> = {}): GradingReport {
  return {
    reportMarkdown: "# Report",
    scoreEarned: 10,
    scorePossible: 12,
    rubricItems: [
      { label: "Q1", criterion: "algorithm", scoreEarned: 3, scorePossible: 3, note: null },
      { label: "Q1 style", criterion: "code_style", scoreEarned: 1, scorePossible: 1, note: null },
      { label: "Q2", criterion: "algorithm", scoreEarned: 5, scorePossible: 7, note: "off by one" },
      { label: "Q2 style", criterion: "code_style", scoreEarned: 1, scorePossible: 1, note: null },
    ],
    flags: [],
    instructorNotes: [],
    confidence: "high",
    submissionProcessNote: null,
    testClaims: [],
    ...overrides,
  };
}

describe("gradingReportJsonSchema", () => {
  const schema = gradingReportJsonSchema();
  const serialized = JSON.stringify(schema);

  it("declares no $schema", () => {
    expect("$schema" in schema).toBe(false);
  });

  it("forbids extra properties", () => {
    expect(schema.additionalProperties).toBe(false);
  });

  // Constraints Claude's structured output rejects must not appear anywhere, at any depth —
  // hence the check against the serialized form rather than the top level.
  it("carries no numeric constraints", () => {
    expect(
      ["minimum", "maximum", "exclusiveMinimum", "multipleOf"].filter((key) =>
        serialized.includes(`"${key}"`),
      ),
    ).toEqual([]);
  });

  it("carries no string length constraints", () => {
    expect(["minLength", "maxLength"].filter((key) => serialized.includes(`"${key}"`))).toEqual([]);
  });
});

describe("parseGradingReport", () => {
  it("rejects an incomplete report", () => {
    expect(() => parseGradingReport({ reportMarkdown: "x" })).toThrow(
      expect.objectContaining({ name: "ReportValidationError" }),
    );
  });

  it("accepts a complete one", () => {
    expect(parseGradingReport(report()).scoreEarned).toBe(10);
  });

  // Given `flags` as an unconstrained string array and no description, a real model used it as a
  // notes field and wrote whole sentences into it. Every entry is rendered as a short badge, so
  // that broke the interface and buried the codes. Prose now has somewhere to go, and the flag
  // vocabulary is closed so it cannot land here again.
  it("rejects prose in flags", () => {
    expect(() =>
      parseGradingReport(report({ flags: ["The file I needed was not submitted."] as never })),
    ).toThrow(expect.objectContaining({ name: "ReportValidationError" }));
  });

  it("accepts every flag in the vocabulary", () => {
    expect(parseGradingReport(report({ flags: [...REPORT_FLAGS] })).flags).toHaveLength(
      REPORT_FLAGS.length,
    );
  });

  it("accepts several flags on one section", () => {
    expect(parseGradingReport(report({ flags: ["INCOMPLETE", "CLARITY"] })).flags).toEqual([
      "INCOMPLETE",
      "CLARITY",
    ]);
  });

  // The rename is the kind of change that leaves one stale reference behind.
  it("rejects the retired MECHANICAL_ERRORS spelling", () => {
    expect(() => parseGradingReport(report({ flags: ["MECHANICAL_ERRORS"] as never }))).toThrow(
      expect.objectContaining({ name: "ReportValidationError" }),
    );
  });

  it("takes prose in instructorNotes", () => {
    expect(
      parseGradingReport(report({ instructorNotes: ["The point value does not divide evenly."] }))
        .instructorNotes,
    ).toHaveLength(1);
  });
});

describe("extractRubricSection", () => {
  const rubric = [
    "# Grading Rubric",
    "## SHORT RESPONSE",
    "short response body",
    "## CODING — ALGORITHM FLUENCY",
    "algorithm body",
    "## CODING — SQL FLUENCY",
    "sql body",
  ].join("\n");

  // Sliced rather than sent whole, because the irrelevant sections are actively misleading: a
  // short response report given the algorithm rubric has a plausible scoring scale to reach for
  // that does not apply.
  it("slices a section at the next heading", () => {
    expect(extractRubricSection(rubric, "CODING — ALGORITHM FLUENCY")).toBe(
      "## CODING — ALGORITHM FLUENCY\nalgorithm body",
    );
  });

  // Throws rather than sending an empty rubric, which would be a confident report against no
  // criteria at all. This is what fires if a heading in the registry drifts from the toolkit.
  it("throws when the heading is not there", () => {
    expect(() => extractRubricSection(rubric, "NO SUCH SECTION")).toThrow(
      expect.objectContaining({ name: "GradingAssetsError" }),
    );
  });
});
