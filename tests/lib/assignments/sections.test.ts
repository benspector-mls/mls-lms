import {
  derivesTestEvidence,
  inDeclaredOrder,
  declaredUnits,
  isManualOnly,
  sectionGradingModes,
} from "@/lib/assignments/spec";

/**
 * Reading the `sections` JSON column.
 *
 * These three take `unknown` because the column is JSON and every caller holds it that way.
 * They are the one place it is narrowed, which is what stops three screens each narrowing it
 * slightly differently — the failure that had `isShortResponseFile` written twice and drifting.
 *
 * What is being held here is mostly the behaviour on malformed input, because that is where a
 * silent wrong answer costs the most: `isManualOnly` deciding wrongly either hides the only way
 * to grade real work, or offers a button that cannot do anything.
 */

const ai = { grading: "ai", type: "coding_algorithm", pointValue: 30 };
const manual = { grading: "manual", label: "Reflection", pointValue: 10 };

describe("a short response's two sections", () => {
  const split = [
    { grading: "ai", type: "short_response", pointValue: 12 },
    { grading: "ai", type: "short_response_writing", pointValue: 3 },
  ];

  // Hand grading opens one box per declared section, so a short response graded by hand gets
  // a technical box and a writing box rather than one score for both.
  it("open as two boxes for hand grading", () => {
    expect(declaredUnits(split).map((s) => [s.key, s.label, s.pointValue])).toEqual([
      ["short_response", "Short Response", 12],
      ["short_response_writing", "Writing Quality", 3],
    ]);
  });

  it("read in declared order, writing after technical", () => {
    const rows = [{ sectionType: "short_response_writing" }, { sectionType: "short_response" }];
    expect(inDeclaredOrder(split, rows).map((row) => row.sectionType)).toEqual([
      "short_response",
      "short_response_writing",
    ]);
  });

  it("read in declared order by key when the round carries keys", () => {
    const keyed = [
      { grading: "ai", key: "q1", label: "Question 1", type: "short_response", pointValue: 3 },
      { grading: "ai", key: "q2", label: "Question 2", type: "short_response", pointValue: 3 },
      { grading: "ai", key: "w", label: "Writing", type: "short_response_writing", pointValue: 3 },
    ];
    const rows = [
      { sectionKey: "w", sectionType: "short_response_writing" },
      { sectionKey: "q2", sectionType: "short_response" },
      { sectionKey: "q1", sectionType: "short_response" },
    ];
    expect(inDeclaredOrder(keyed, rows).map((row) => row.sectionKey)).toEqual(["q1", "q2", "w"]);
  });

  it("never derive test evidence", () => {
    expect(derivesTestEvidence("short_response_writing", "jest")).toBe(false);
  });
});

describe("sectionGradingModes", () => {
  it("reads each section's mode", () => {
    expect(sectionGradingModes([ai, manual])).toEqual(["ai", "manual"]);
  });

  it("counts an entry with no grading key as ai", () => {
    /*
      The safe direction, and deliberate. A migration backfilled the column so none should
      exist; if one does, `ai` leaves the generate button on an assignment that has always had
      it, where the reverse would quietly hide the only way to grade real work.
    */
    expect(sectionGradingModes([{ type: "coding_algorithm", pointValue: 30 }])).toEqual(["ai"]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an object", { grading: "manual" }],
    ["a string", "manual"],
    ["a number", 3],
  ])("is empty for %s, which is not an array of sections", (_label, value) => {
    expect(sectionGradingModes(value)).toEqual([]);
  });
});

describe("isManualOnly", () => {
  it("is true when every section is graded by hand", () => {
    expect(isManualOnly([manual, { ...manual, label: "Second" }])).toBe(true);
  });

  it("is false when any section is graded by the pipeline", () => {
    expect(isManualOnly([ai])).toBe(false);
    expect(isManualOnly([ai, manual])).toBe(false);
  });

  it("is false for an assignment with no sections at all", () => {
    /*
      The length check inside is load-bearing: `every` is true for an empty array, so without
      it a misconfigured assignment would read as hand-graded and land in `needs_manual_grade`
      — a pile an instructor cannot clear, because there are no sections to write into.
    */
    expect(isManualOnly([])).toBe(false);
  });

  it("is false for a column that is not an array", () => {
    expect(isManualOnly(null)).toBe(false);
    expect(isManualOnly({ grading: "manual" })).toBe(false);
  });

  it("is false for a section that names no grading mode, because that counts as ai", () => {
    /*
      Rows written before the column existed carry no `grading` key at all. Reading one as the
      pipeline's keeps the generate button on assignments that have always had it, where the
      reverse would move them into `needs_manual_grade` — a pile whose only action is writing into
      sections these assignments do not declare.
    */
    expect(isManualOnly([{ type: "coding_algorithm" }])).toBe(false);
  });
});

describe("declaredUnits", () => {
  const unit = (over: Record<string, unknown>) => ({
    heading: null,
    skillId: null,
    tests: [],
    hasTestEvidence: false,
    ...over,
  });

  it("reads a manual section's key, label and point value", () => {
    expect(declaredUnits([{ ...manual, key: "r1" }])).toEqual([
      unit({ key: "r1", label: "Reflection", type: "manual", pointValue: 10 }),
    ]);
  });

  it("reads an AI section's type, heading, skill and chosen tests beside the core", () => {
    expect(
      declaredUnits([
        {
          ...ai,
          key: "q1",
          label: "Question 1: is_even",
          heading: "From Scratch",
          skillId: "skill-1",
          evidence: "tests",
          tests: [{ suite: null, name: "is_even" }],
        },
      ]),
    ).toEqual([
      {
        key: "q1",
        label: "Question 1: is_even",
        heading: "From Scratch",
        type: "coding_algorithm",
        pointValue: 30,
        skillId: "skill-1",
        tests: [{ suite: null, name: "is_even" }],
        hasTestEvidence: true,
      },
    ]);
  });

  /*
    A section saved before sections had keys is keyed by what a round written then stored as its
    `sectionType`: the declared label of a hand-graded section, the type of a generated one. That
    is what lets such a round still match its declaration.
  */
  it("keys a section saved before keys by its label or its type, and labels a type in words", () => {
    expect(declaredUnits([manual])).toEqual([
      unit({ key: "Reflection", label: "Reflection", type: "manual", pointValue: 10 }),
    ]);
    expect(declaredUnits([ai])).toEqual([
      unit({
        key: "coding_algorithm",
        label: "Algorithm Fluency",
        type: "coding_algorithm",
        pointValue: 30,
      }),
    ]);
  });

  it("keys an entry with no grading mode by its type, because that counts as ai", () => {
    expect(declaredUnits([{ type: "coding_algorithm", pointValue: 30 }]).map((s) => s.key)).toEqual(
      ["coding_algorithm"],
    );
  });

  it("keeps the declared order", () => {
    const technical = { grading: "ai", key: "t", type: "technical", pointValue: 20 };
    expect(declaredUnits([ai, technical]).map((section) => section.key)).toEqual([
      "coding_algorithm",
      "t",
    ]);
  });

  it("skips a section with no point value rather than defaulting one", () => {
    /*
      A section scored out of an invented total is the failure the "pointValue is required and
      never defaulted" rule exists to prevent. Skipping is visible where a zero would not be:
      `startManual` refuses to open a draft with no sections.
    */
    expect(declaredUnits([{ grading: "manual", label: "Reflection" }])).toEqual([]);
    expect(declaredUnits([{ grading: "ai", type: "coding_algorithm" }])).toEqual([]);
  });

  it("skips a section with no key", () => {
    expect(declaredUnits([{ grading: "manual", pointValue: 10 }])).toEqual([]);
    expect(declaredUnits([{ grading: "manual", label: "", pointValue: 10 }])).toEqual([]);
    expect(declaredUnits([{ grading: "ai", pointValue: 30 }])).toEqual([]);
  });

  it("skips a point value that is not a finite number", () => {
    for (const pointValue of ["10", NaN, Infinity, null]) {
      expect(declaredUnits([{ grading: "manual", label: "Reflection", pointValue }])).toEqual([]);
    }
  });

  it("is empty for a column that is not an array", () => {
    expect(declaredUnits(null)).toEqual([]);
    expect(declaredUnits("Reflection")).toEqual([]);
  });
});

describe("derivesTestEvidence", () => {
  it("is false for a short response, which has nothing to execute", () => {
    expect(derivesTestEvidence("short_response", "node-jest")).toBe(false);
  });

  it("is false for any section when the assignment has no suite", () => {
    // `none` is a real preset and the default. Short response assignments have nothing to run
    // and frontend assignments have tests this build cannot run yet.
    expect(derivesTestEvidence("coding_algorithm", "none")).toBe(false);
  });

  it("is true for a coding section on an assignment that has a suite", () => {
    expect(derivesTestEvidence("coding_algorithm", "node-jest")).toBe(true);
    expect(derivesTestEvidence("coding_frontend", "node-vitest")).toBe(true);
    expect(derivesTestEvidence("coding_sql", "python-pytest")).toBe(true);
  });
});

describe("inDeclaredOrder", () => {
  /*
    A round's section rows carry no order of their own, and saving an edit rewrites the row, which
    moves it — so the grading queue showed four sections an instructor had typed in order as 3, 4,
    1, 2 after they edited the first two. The assignment's own array is the only place the order
    lives, and this is what reads it.
  */
  const tasks = [1, 2, 3, 4].map((n) => ({
    grading: "manual",
    label: `Task ${n}`,
    pointValue: 1,
  }));
  const rows = (...labels: string[]) => labels.map((label) => ({ sectionType: label }));

  it("puts a round's sections back into the order the assignment declares them", () => {
    expect(inDeclaredOrder(tasks, rows("Task 3", "Task 4", "Task 1", "Task 2"))).toEqual(
      rows("Task 1", "Task 2", "Task 3", "Task 4"),
    );
  });

  it("matches a section the pipeline graded by its type, not its label", () => {
    // A generated round stores the declared `type`; a hand-graded one stores the `label`. One
    // assignment can declare both, so both keys have to resolve against the same array.
    expect(inDeclaredOrder([manual, ai], rows("coding_algorithm", "Reflection"))).toEqual(
      rows("Reflection", "coding_algorithm"),
    );
  });

  it("keeps a section the assignment no longer declares, after the ones it does", () => {
    /*
      Renaming a section after a round was graded leaves rows matching nothing. Dropping them
      would hide feedback a student was already sent, so they sort to the end instead — and the
      sort is stable, which is why the callers fetch in a deterministic order.
    */
    expect(inDeclaredOrder(tasks, rows("Old name", "Task 2", "Another old one"))).toEqual(
      rows("Task 2", "Old name", "Another old one"),
    );
  });

  it("returns the rows untouched when the column is not an array of sections", () => {
    const unsorted = rows("Task 3", "Task 1");
    expect(inDeclaredOrder(null, unsorted)).toEqual(unsorted);
    expect(inDeclaredOrder("Task 1", unsorted)).toEqual(unsorted);
  });

  it("does not modify the array it is given", () => {
    const given = rows("Task 2", "Task 1");
    inDeclaredOrder(tasks, given);
    expect(given).toEqual(rows("Task 2", "Task 1"));
  });
});
