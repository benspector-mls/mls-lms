import {
  awaitingByStudent,
  completionByAssignment,
  completionByStudent,
  completionLabel,
  type SummaryCell,
} from "@/lib/gradebook/summary";

/**
 * The gradebook's two totals.
 *
 * What these protect is the meaning of "complete", which is `isComplete` and nothing else. The
 * grid, the CSV, the student's progress bar, and these totals all read that one column, because it
 * is written once by `approveDraft` in the same transaction as the status — and a second reading
 * of it here, however reasonable, is how a row of scores comes to disagree with the figure above
 * it about who passed.
 */

function cell(assignmentId: string, studentId: string, isComplete: boolean | null): SummaryCell {
  return { assignmentId, studentId, isComplete };
}

describe("completionByAssignment", () => {
  const cells = [
    cell("a1", "s1", true),
    cell("a1", "s2", true),
    cell("a1", "s3", false),
    cell("a2", "s1", true),
    cell("a2", "s2", null),
  ];

  it("counts the students who met the threshold", () => {
    const byAssignment = completionByAssignment(cells, 5);

    expect(byAssignment.get("a1")).toEqual({ complete: 2, possible: 5 });
    expect(byAssignment.get("a2")).toEqual({ complete: 1, possible: 5 });
  });

  /*
    The denominator is the table's students, not the students who handed something in. Counting
    only submissions would make an assignment nobody has attempted read as 0 of 0, which looks
    like nothing is outstanding rather than like nobody has started.
  */
  it("measures against every student, not only those who submitted", () => {
    expect(completionByAssignment([cell("a1", "s1", true)], 12)).toEqual(
      new Map([["a1", { complete: 1, possible: 12 }]]),
    );
  });

  // Null is "no verdict yet", which is not failing. Counting it either way would be a claim.
  it("counts neither a false verdict nor a missing one", () => {
    const byAssignment = completionByAssignment(
      [cell("a1", "s1", false), cell("a1", "s2", null)],
      2,
    );

    expect(byAssignment.get("a1")).toBeUndefined();
  });

  it("has nothing to say about an assignment with no cells", () => {
    expect(completionByAssignment([], 5).size).toBe(0);
  });
});

describe("completionByStudent", () => {
  const cells = [
    cell("a1", "s1", true),
    cell("a2", "s1", true),
    cell("a3", "s1", false),
    cell("a1", "s2", true),
  ];

  it("counts the assignments a student has completed", () => {
    const byStudent = completionByStudent(cells, 10);

    expect(byStudent.get("s1")).toEqual({ complete: 2, possible: 10 });
    expect(byStudent.get("s2")).toEqual({ complete: 1, possible: 10 });
  });

  /*
    Against the whole course rather than against what has been handed out, so publishing an
    assignment nobody has seen does not move a figure describing work already done.
  */
  it("measures against every assignment in the course", () => {
    expect(completionByStudent([cell("a1", "s1", true)], 40).get("s1")).toEqual({
      complete: 1,
      possible: 40,
    });
  });

  it("says nothing about a student who has completed nothing", () => {
    expect(completionByStudent([cell("a1", "s1", false)], 10).get("s1")).toBeUndefined();
  });
});

/**
 * The two totals are the same cells counted along different axes, so they have to agree about how
 * many completions exist in the table. A rule applied in one and not the other is exactly the
 * disagreement these figures are there to prevent.
 */
describe("the two axes agree", () => {
  it("sums to the same number of completions either way", () => {
    const cells = [
      cell("a1", "s1", true),
      cell("a1", "s2", true),
      cell("a2", "s1", true),
      cell("a2", "s2", false),
      cell("a3", "s1", null),
    ];

    const down = [...completionByAssignment(cells, 2).values()].reduce(
      (sum, c) => sum + c.complete,
      0,
    );
    const across = [...completionByStudent(cells, 3).values()].reduce(
      (sum, c) => sum + c.complete,
      0,
    );

    expect(down).toBe(3);
    expect(across).toBe(3);
  });
});

/**
 * How many of a student's submissions are waiting on an instructor.
 *
 * The rule is `bucket != null`, which is exactly what draws the amber dot in the grid — so this
 * column counts the dots in its own row, and the two cannot come to disagree about what is
 * outstanding.
 */
describe("awaitingByStudent", () => {
  it("counts the submissions in a triage bucket", () => {
    const counts = awaitingByStudent([
      { studentId: "s1", bucket: "needs_report" },
      { studentId: "s1", bucket: "draft_ready" },
      { studentId: "s1", bucket: null },
      { studentId: "s2", bucket: "grading_failed" },
    ]);

    expect(counts.get("s1")).toBe(2);
    expect(counts.get("s2")).toBe(1);
  });

  /*
    A run in flight is not something an instructor can act on this second, but it is still an
    assignment with no grade on it — and the grid already draws it amber. A column disagreeing
    with the cells beside it would be worse than one a moment ahead of itself.
  */
  it("counts a report being generated, as the amber dot does", () => {
    expect(awaitingByStudent([{ studentId: "s1", bucket: "generating" }]).get("s1")).toBe(1);
  });

  it("says nothing about a student with nothing outstanding", () => {
    expect(awaitingByStudent([{ studentId: "s1", bucket: null }]).get("s1")).toBeUndefined();
    expect(awaitingByStudent([]).size).toBe(0);
  });
});

describe("completionLabel", () => {
  it("reads as a fraction", () => {
    expect(completionLabel({ complete: 2, possible: 5 }, 5)).toBe("2/5");
  });

  // Nobody has finished this yet is a real figure, and worth printing.
  it("prints a zero numerator", () => {
    expect(completionLabel(undefined, 5)).toBe("0/5");
    expect(completionLabel({ complete: 0, possible: 5 }, 5)).toBe("0/5");
  });

  // "0/0" looks like a measurement. An empty cohort or a course with no work has none to give.
  it("has an em dash where there is nothing to be a fraction of", () => {
    expect(completionLabel(undefined, 0)).toBe("—");
    expect(completionLabel({ complete: 0, possible: 0 }, 0)).toBe("—");
  });
});
