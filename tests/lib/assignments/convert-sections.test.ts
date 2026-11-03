import { convertDeclaration } from "@/scripts/convert-sections";
import type { ReportRow } from "@/lib/grade/report-text";

/**
 * How a declaration saved before sections were scored units becomes one: what is read from a
 * round's rows, what from the template, and what is refused rather than guessed.
 */

const rubricId = "6f1d2c2e-1111-4c4c-8a8a-aaaaaaaaaaaa";

const row = (
  label: string,
  possible: number,
  criterion = "technical",
  group: string | null = null,
): ReportRow => ({
  label,
  group,
  criterion,
  scoreEarned: 1,
  scorePossible: possible,
  feedbackMarkdown: "",
  modelReasoning: null,
});

describe("convertDeclaration", () => {
  it("leaves a declaration that already carries keys alone", () => {
    const sections = [{ grading: "manual", key: "a", label: "Overall", pointValue: 10 }];
    const outcome = convertDeclaration(sections, new Map(), null, null);
    expect(outcome).toEqual({ ok: true, sections, changes: [] });
  });

  it("gives a hand-graded section a key and keeps its label", () => {
    const outcome = convertDeclaration(
      [{ grading: "manual", label: "Reflection", pointValue: 10 }],
      new Map(),
      null,
      null,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections[0]).toMatchObject({
      grading: "manual",
      label: "Reflection",
      pointValue: 10,
    });
    expect(typeof outcome.sections[0]!.key).toBe("string");
    expect(outcome.changes).toEqual(['"Reflection" gains a key']);
  });

  it("splits a short response into its questions from the latest round's rows, and keys the writing section", () => {
    const rows = [
      row("Question 1: for loops", 3),
      row("Question 2: while loops", 3),
      row("Writing Quality Score (Entire Assignment)", 3, "writing_quality"),
    ];
    const outcome = convertDeclaration(
      [
        { grading: "ai", type: "short_response", pointValue: 6, rubricId },
        { grading: "ai", type: "short_response_writing", pointValue: 3, rubricId },
      ],
      new Map([["short_response", rows]]),
      null,
      null,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections.map((s) => [s.type, s.label, s.pointValue])).toEqual([
      ["short_response", "Question 1: for loops", 3],
      ["short_response", "Question 2: while loops", 3],
      ["short_response_writing", "Writing Quality", 3],
    ]);
    expect(new Set(outcome.sections.map((s) => s.key)).size).toBe(3);
    expect(outcome.sections.every((s) => s.rubricId === rubricId)).toBe(true);
  });

  it("splits a coding section into exercises under their README headings", () => {
    const rows = [
      row("Question 1: is_even", 3, "algorithm", "From Scratch"),
      row("Question 2: greet", 3, "algorithm", "Modify"),
    ];
    const outcome = convertDeclaration(
      [
        {
          grading: "ai",
          type: "coding_algorithm",
          pointValue: 6,
          rubricId,
          evidence: "tests",
          testNamePattern: "x",
        },
      ],
      new Map([["coding_algorithm", rows]]),
      null,
      null,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections.map((s) => [s.label, s.heading, s.tests])).toEqual([
      ["Question 1: is_even", "From Scratch", undefined],
      ["Question 2: greet", "Modify", undefined],
    ]);
  });

  it("reads the template when no round has rows", () => {
    const outcome = convertDeclaration(
      [{ grading: "ai", type: "coding_algorithm", pointValue: 6, rubricId }],
      new Map(),
      [
        {
          key: "p1",
          label: "Question 1: a",
          heading: "From Scratch",
          pointValue: 3,
          type: "coding_algorithm",
          tests: [{ suite: "t.py", name: "test_a" }],
        },
        {
          key: "p2",
          label: "Question 2: b",
          heading: "From Scratch",
          pointValue: 3,
          type: "coding_algorithm",
        },
      ],
      null,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections.map((s) => [s.label, s.tests])).toEqual([
      ["Question 1: a", [{ suite: "t.py", name: "test_a" }]],
      ["Question 2: b", undefined],
    ]);
    expect(outcome.changes[0]).toContain("from the template");
  });

  it("refuses a section whose units do not add up to what it is worth", () => {
    const outcome = convertDeclaration(
      [{ grading: "ai", type: "coding_algorithm", pointValue: 30, rubricId }],
      new Map([["coding_algorithm", [row("Q1", 3), row("Q2", 3)]]]),
      null,
      null,
    );
    expect(outcome).toEqual({
      ok: false,
      reason:
        "the coding_algorithm section is worth 30 but its 2 units from the latest approved round sum to 6",
    });
  });

  it("refuses a section with nothing to read its units from", () => {
    const outcome = convertDeclaration(
      [{ grading: "ai", type: "coding_sql", pointValue: 5, rubricId }],
      new Map(),
      [],
      null,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("a section that still holds a test pattern", () => {
  const keyed = {
    grading: "ai",
    key: "q1",
    label: "Question 1: is_even",
    type: "coding_algorithm",
    pointValue: 3,
    rubricId,
    evidence: "tests",
    testNamePattern: "(^|[\\s_-])is_even(?=$|[\\s_(:-])",
  };
  const suite = [
    { path: "tests/t.py", suite: "tests/t.py", name: "test_is_even" },
    { path: "tests/t.py", suite: "tests/t.py", name: "test_is_evenly_spaced" },
  ];

  it("resolves the pattern to the template's tests it matches, and drops it", () => {
    const outcome = convertDeclaration([keyed], new Map(), null, suite);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections).toEqual([
      {
        ...keyed,
        testNamePattern: undefined,
        tests: [{ suite: "tests/t.py", name: "test_is_even" }],
      },
    ]);
    expect("testNamePattern" in outcome.sections[0]!).toBe(false);
    expect(outcome.changes[0]).toContain("becomes 1 chosen test");
  });

  it("drops a pattern that matches nothing, and says so", () => {
    const outcome = convertDeclaration(
      [{ ...keyed, testNamePattern: "nothing_here" }],
      new Map(),
      null,
      suite,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections[0]!.tests).toBeUndefined();
    expect(outcome.changes[0]).toContain("matched none");
  });

  it("is left alone when the template could not be read", () => {
    expect(convertDeclaration([keyed], new Map(), null, null)).toEqual({
      ok: false,
      reason: expect.stringContaining("the template could not be read"),
    });
  });
});

describe("a short response declared before the split", () => {
  it("becomes its questions and a Writing Quality section worth the round's writing row", () => {
    const rows = [
      row("Question 1: for loops", 3),
      row("Question 2: while loops", 3),
      row("Question 3: ranges", 3),
      row("Question 4: nesting", 3),
      row("Writing Quality (Entire Assignment)", 3, "writing_quality"),
    ];
    const outcome = convertDeclaration(
      [{ grading: "ai", type: "short_response", pointValue: 15, rubricId }],
      new Map([["short_response", rows]]),
      null,
      null,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections.map((s) => [s.type, s.label, s.pointValue])).toEqual([
      ["short_response", "Question 1: for loops", 3],
      ["short_response", "Question 2: while loops", 3],
      ["short_response", "Question 3: ranges", 3],
      ["short_response", "Question 4: nesting", 3],
      ["short_response_writing", "Writing Quality", 3],
    ]);
    expect(new Set(outcome.sections.map((s) => s.key)).size).toBe(5);
    expect(outcome.changes[0]).toContain("Writing Quality section worth 3");
  });

  it("is refused when the questions and the writing score do not add up to its worth", () => {
    const rows = [row("Question 1: a", 3), row("Writing", 3, "writing_quality")];
    expect(
      convertDeclaration(
        [{ grading: "ai", type: "short_response", pointValue: 15, rubricId }],
        new Map([["short_response", rows]]),
        null,
        null,
      ),
    ).toEqual({ ok: false, reason: expect.stringContaining("writing score of 3") });
  });
});

describe("a coding section declared before the split, with a test pattern", () => {
  it("gives each exercise the tests the template proposes for it, and says the pattern is replaced", () => {
    const rows = [row("Question 1: is_even", 3), row("Question 2: greet", 3)];
    const proposal = [
      {
        key: "p1",
        label: "Question 1: is_even",
        pointValue: 3,
        type: "coding_algorithm" as const,
        tests: [{ suite: "t.py", name: "test_is_even" }],
      },
      { key: "p2", label: "Question 2: greet", pointValue: 3, type: "coding_algorithm" as const },
    ];
    const outcome = convertDeclaration(
      [
        {
          grading: "ai",
          type: "coding_algorithm",
          pointValue: 6,
          rubricId,
          evidence: "tests",
          testNamePattern: "x",
        },
      ],
      new Map([["coding_algorithm", rows]]),
      proposal,
      [],
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sections.map((s) => [s.label, s.tests, "testNamePattern" in s])).toEqual([
      ["Question 1: is_even", [{ suite: "t.py", name: "test_is_even" }], false],
      ["Question 2: greet", undefined, false],
    ]);
    expect(outcome.changes[0]).toContain("replaced by chosen tests on each exercise");
  });
});

describe("a test pattern that is not a valid regular expression", () => {
  it("leaves the assignment alone and says why, rather than stopping the run", () => {
    const outcome = convertDeclaration(
      [
        {
          grading: "ai",
          key: "q1",
          label: "Question 1",
          type: "coding_algorithm",
          pointValue: 3,
          rubricId,
          evidence: "tests",
          testNamePattern: "test_(",
        },
      ],
      new Map(),
      null,
      [],
    );
    expect(outcome).toEqual({
      ok: false,
      reason: expect.stringContaining("not a valid regular expression"),
    });
  });
});
