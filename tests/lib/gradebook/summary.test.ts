import {
  ASSIGNMENT_DRIFT_RULE,
  assignmentDriftList,
  awaitingByStudent,
  completionByAssignment,
  completionByStudent,
  completionLabel,
  driftReasons,
  isMissing,
  lateByStudent,
  missingByStudent,
  recentWorkByStudent,
  recentWorkSentence,
  type MissingAssignment,
  type MissingCell,
  type RecentCell,
  type RecentWork,
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

/**
 * How many of a student's submissions were handed in after the deadline and not by a renegotiated
 * one.
 *
 * `isLate` is the column `handInState` writes against the deadline as it stood at hand-in, and it
 * is read here rather than recomputed: a second comparison of a submission time against a due date
 * in the browser is how this figure would come to disagree with the "Late" badge on the grading
 * screen and with the student's own view of the same submission. What the count then does with it
 * is `lateness`, which lets a fellow who agreed a new date and met it out of the figure.
 */
describe("lateByStudent", () => {
  /** The assignment every cell below belongs to, and the deadline they are measured against. */
  const DUE = "2026-09-11T00:00:00.000Z";
  const work = [{ id: "a1", dueAt: DUE }];

  const ON_TIME = "2026-09-10T12:00:00.000Z";
  const AFTER = "2026-09-12T12:00:00.000Z";

  /** A cell with no extension on it, which is what all but the last two cases are about. */
  function cell(studentId: string, submittedAt: string | null) {
    return { assignmentId: "a1", studentId, submittedAt, extendedDueAt: null };
  }

  it("counts the submissions handed in after the deadline", () => {
    const counts = lateByStudent(
      [cell("s1", AFTER), cell("s1", AFTER), cell("s1", ON_TIME), cell("s2", AFTER)],
      work,
    );

    expect(counts.get("s1")).toBe(2);
    expect(counts.get("s2")).toBe(1);
  });

  /*
    Nothing handed in is not the same as handed in on time — and counting it would turn every
    assignment nobody has started into a missed deadline.
  */
  it("counts neither an on-time hand-in nor a missing one", () => {
    const counts = lateByStudent([cell("s1", ON_TIME), cell("s1", null)], work);

    expect(counts.get("s1")).toBeUndefined();
  });

  it("says nothing about a student who has missed no deadline", () => {
    expect(lateByStudent([], work).size).toBe(0);
  });

  /*
    An assignment with no deadline cannot be missed, whatever time the work arrived. Worth its own
    case because the deadline now comes from a second list, and a cell whose assignment is absent
    from it must read as undated rather than as late.
  */
  it("counts nothing for work with no deadline", () => {
    expect(lateByStudent([cell("s1", AFTER)], [{ id: "a1", dueAt: null }]).size).toBe(0);
    expect(lateByStudent([cell("s1", AFTER)], []).size).toBe(0);
  });

  /*
    The renegotiation cases, which are the whole reason this count reads `lateness`. A fellow who
    agreed a new date and met it has done what the school asks; one who agreed a new date and
    missed that too is late, and the count has to say so or an extension would be a way of never
    being counted.
  */
  it("does not count work handed in by a renegotiated deadline", () => {
    const counts = lateByStudent(
      [
        {
          assignmentId: "a1",
          studentId: "s1",
          submittedAt: "2026-09-14T12:00:00.000Z",
          extendedDueAt: "2026-09-15T00:00:00.000Z",
        },
      ],
      work,
    );

    expect(counts.get("s1")).toBeUndefined();
  });

  it("counts work that missed the renegotiated deadline too", () => {
    const counts = lateByStudent(
      [
        {
          assignmentId: "a1",
          studentId: "s1",
          submittedAt: "2026-09-16T12:00:00.000Z",
          extendedDueAt: "2026-09-15T00:00:00.000Z",
        },
      ],
      work,
    );

    expect(counts.get("s1")).toBe(1);
  });
});

/**
 * Whether an assignment is missing for a student, and how many each student has.
 *
 * The rule is `!handedIn`, the same rule that builds the student's own overdue list — so the
 * instructor's "missing" and the student's "overdue" name one fact. And this is the one counter
 * that takes the roster and the assignments as well as the cells, because the central missing case
 * has no cell to count: a student who never took the work up has no submission row at all.
 */
describe("isMissing", () => {
  const AT = new Date("2026-09-11T12:00:00.000Z");
  const PAST = "2026-09-01T00:00:00.000Z";
  const FUTURE = "2026-10-01T00:00:00.000Z";

  function pastDue(overrides: Partial<MissingAssignment> = {}) {
    return { dueAt: PAST, distributedAt: "2026-08-01T00:00:00.000Z", ...overrides };
  }

  /** The student's own row, as this function reads it: a status and whatever they were granted. */
  function against(status: MissingCell["status"], extendedDueAt: string | null = null) {
    return { status, extendedDueAt };
  }

  it("is missing when past due and never taken up, accepted, or reset", () => {
    expect(isMissing(pastDue(), undefined, AT)).toBe(true);
    expect(isMissing(pastDue(), against("NOT_STARTED"), AT)).toBe(true);
    expect(isMissing(pastDue(), against("ACCEPTED"), AT)).toBe(true);
  });

  // Handing in, however late, clears it — a missed deadline becomes a late hand-in, not both.
  it("is not missing once anything is handed in", () => {
    expect(isMissing(pastDue(), against("SUBMITTED"), AT)).toBe(false);
    expect(isMissing(pastDue(), against("GRADED"), AT)).toBe(false);
  });

  // A student cannot miss what was never handed out.
  it("never counts a draft, however far past its due date", () => {
    expect(isMissing(pastDue({ distributedAt: null }), undefined, AT)).toBe(false);
  });

  it("is not missing before the deadline, and no deadline is never missed", () => {
    expect(isMissing(pastDue({ dueAt: FUTURE }), undefined, AT)).toBe(false);
    expect(isMissing(pastDue({ dueAt: null }), undefined, AT)).toBe(false);
  });

  // Strictly before, which is the comparison the student dashboard makes: due *at* this instant
  // is not yet missed.
  it("is not missing at the deadline itself", () => {
    expect(isMissing(pastDue({ dueAt: AT.toISOString() }), undefined, AT)).toBe(false);
  });

  /*
    The one reader of an extension that acts on work which has not arrived. A fellow who agreed a
    new date is not missing the work until that date passes — if they were, agreeing one in advance
    would leave them looking overdue to themselves and to their instructor for the whole of the
    period they had just been granted.
  */
  it("is not missing while a renegotiated deadline has still to pass", () => {
    expect(isMissing(pastDue(), against("ACCEPTED", FUTURE), AT)).toBe(false);
  });

  it("is missing again once the renegotiated deadline has passed with nothing handed in", () => {
    expect(isMissing(pastDue(), against("ACCEPTED", "2026-09-05T00:00:00.000Z"), AT)).toBe(true);
  });
});

describe("missingByStudent", () => {
  const AT = new Date("2026-09-11T12:00:00.000Z");

  function assignment(id: string, overrides: Partial<MissingAssignment> = {}): MissingAssignment {
    return {
      id,
      dueAt: "2026-09-01T00:00:00.000Z",
      distributedAt: "2026-08-01T00:00:00.000Z",
      ...overrides,
    };
  }

  function cell(
    assignmentId: string,
    studentId: string,
    status: MissingCell["status"],
  ): MissingCell {
    return { assignmentId, studentId, status, extendedDueAt: null };
  }

  it("counts absent cells and un-handed-in ones alike", () => {
    const counts = missingByStudent(
      ["s1", "s2"],
      [assignment("a1"), assignment("a2")],
      // s1 accepted one and never touched the other; s2 handed both in.
      [cell("a1", "s1", "ACCEPTED"), cell("a1", "s2", "SUBMITTED"), cell("a2", "s2", "GRADED")],
      AT,
    );

    expect(counts.get("s1")).toBe(2);
    expect(counts.get("s2")).toBeUndefined();
  });

  it("counts nothing for a future deadline or a draft", () => {
    const counts = missingByStudent(
      ["s1"],
      [
        assignment("a1", { dueAt: "2026-10-01T00:00:00.000Z" }),
        assignment("a2", { distributedAt: null }),
      ],
      [],
      AT,
    );

    expect(counts.size).toBe(0);
  });

  it("has nothing to say with no roster or no work", () => {
    expect(missingByStudent([], [assignment("a1")], [], AT).size).toBe(0);
    expect(missingByStudent(["s1"], [], [], AT).size).toBe(0);
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

/**
 * The recent window, which is what separates "drifting" from the term-long counts above.
 *
 * What these protect is that the deadline window is the cohort's last ten deadlines and the verdict
 * window is the fellow's last five verdicts — two different windows, deliberately — and that both
 * read missing and late through the same two functions the columns above read them through.
 */
describe("recentWorkByStudent", () => {
  /** A term of one assignment a day, released the day before it is due. */
  function day(n: number): string {
    return `2026-09-${String(n).padStart(2, "0")}T00:00:00.000Z`;
  }

  function dated(n: number) {
    return { id: `a${n}`, dueAt: day(n), distributedAt: day(n - 1) };
  }

  /** Seen from the 20th, when the first nineteen are due and the twentieth is not. */
  const NOW = new Date("2026-09-20T00:00:00.000Z");

  function handedIn(
    n: number,
    studentId: string,
    when: string,
    isComplete: boolean | null = null,
  ): RecentCell {
    return {
      assignmentId: `a${n}`,
      studentId,
      status: isComplete === null ? "SUBMITTED" : "GRADED",
      submittedAt: when,
      extendedDueAt: null,
      isComplete,
    };
  }

  it("measures deadlines over the last ten that have come due, and nothing before them", () => {
    // Twenty assignments; nineteen are due. The fellow handed in none of the first nine and all
    // of the last ten on time, so the window — the tenth through the nineteenth — is clean.
    const work = Array.from({ length: 20 }, (_, i) => dated(i + 1));
    const cells = work.slice(9, 19).map((assignment, i) => handedIn(i + 10, "s1", day(i + 9)));

    const recent = recentWorkByStudent(["s1"], work, cells, NOW).get("s1");

    expect(recent).toMatchObject({ missed: 0, late: 0, due: ASSIGNMENT_DRIFT_RULE.dueOf });
  });

  it("counts missing and late separately, through the same tests the columns use", () => {
    const work = [dated(1), dated(2), dated(3), dated(4)];
    const cells: RecentCell[] = [
      handedIn(1, "s1", day(1)), // on time: due at midnight, handed in at midnight
      handedIn(2, "s1", day(3)), // late
      // a3 never started: no cell, which is the central missing case
      {
        // a4: an unexpired extension, so neither missing nor late yet
        assignmentId: "a4",
        studentId: "s1",
        status: "ACCEPTED",
        submittedAt: null,
        extendedDueAt: "2026-09-30T00:00:00.000Z",
        isComplete: null,
      },
    ];

    const recent = recentWorkByStudent(["s1"], work, cells, NOW).get("s1");

    expect(recent).toMatchObject({ missed: 1, late: 1, due: 4 });
  });

  it("leaves undated work and drafts out of the deadline window", () => {
    const work = [
      dated(1),
      { id: "undated", dueAt: null, distributedAt: day(1) },
      { id: "draft", dueAt: day(2), distributedAt: null },
    ];

    const recent = recentWorkByStudent(["s1"], work, [], NOW).get("s1");

    expect(recent).toMatchObject({ missed: 1, due: 1 });
  });

  it("does not count an assignment whose deadline is still ahead", () => {
    const recent = recentWorkByStudent(["s1"], [dated(25)], [], NOW).get("s1");

    expect(recent).toMatchObject({ missed: 0, due: 0 });
  });

  it("measures verdicts over the fellow's last five that have one, skipping ungraded work", () => {
    const work = Array.from({ length: 8 }, (_, i) => dated(i + 1));
    const cells = [
      handedIn(1, "s1", day(1), false), // outside the window of five
      handedIn(2, "s1", day(2), false),
      handedIn(3, "s1", day(3), true),
      handedIn(4, "s1", day(4), null), // handed in, not graded: not a verdict
      handedIn(5, "s1", day(5), true),
      handedIn(6, "s1", day(6), false),
      handedIn(7, "s1", day(7), true),
      // a8 never started
    ];

    const recent = recentWorkByStudent(["s1"], work, cells, NOW).get("s1");

    expect(recent).toMatchObject({ incomplete: 2, graded: ASSIGNMENT_DRIFT_RULE.gradedOf });
  });

  // Undated work can still be graded, so it has a place in the verdict window, ordered by release.
  it("counts a verdict on undated work", () => {
    const work = [{ id: "u", dueAt: null, distributedAt: day(1) }];
    const cells = [{ ...handedIn(1, "s1", day(1), false), assignmentId: "u" }];

    const recent = recentWorkByStudent(["s1"], work, cells, NOW).get("s1");

    expect(recent).toMatchObject({ incomplete: 1, graded: 1, due: 0 });
  });

  it("gives every student an entry, including one with nothing at all", () => {
    const recents = recentWorkByStudent(["s1", "s2"], [dated(1)], [handedIn(1, "s1", day(1))], NOW);

    expect(recents.get("s2")).toEqual({
      studentId: "s2",
      missed: 1,
      late: 0,
      due: 1,
      incomplete: 0,
      graded: 0,
    });
  });
});

describe("driftReasons", () => {
  function recent(over: Partial<RecentWork>): RecentWork {
    return { studentId: "s1", missed: 0, late: 0, due: 10, incomplete: 0, graded: 5, ...over };
  }

  it("names deadlines once missed and late together reach the threshold", () => {
    expect(driftReasons(recent({ missed: 2, late: 2 }))).toEqual(["deadlines"]);
    expect(driftReasons(recent({ missed: 2, late: 1 }))).toEqual([]);
  });

  it("names falling short once enough recent verdicts are incomplete", () => {
    expect(driftReasons(recent({ incomplete: 2 }))).toEqual(["falling-short"]);
    expect(driftReasons(recent({ incomplete: 1 }))).toEqual([]);
  });

  it("puts deadlines first when both apply", () => {
    expect(driftReasons(recent({ missed: 4, incomplete: 2 }))).toEqual([
      "deadlines",
      "falling-short",
    ]);
  });
});

describe("assignmentDriftList", () => {
  function recent(studentId: string, over: Partial<RecentWork>): RecentWork {
    return { studentId, missed: 0, late: 0, due: 10, incomplete: 0, graded: 5, ...over };
  }

  it("lists only those who trip the rule, worst first", () => {
    const list = assignmentDriftList([
      recent("fine", {}),
      recent("short", { incomplete: 3 }),
      recent("slipping", { missed: 2, late: 2 }),
      recent("gone", { missed: 6, incomplete: 2 }),
    ]);

    expect(list.map((entry) => entry.recent.studentId)).toEqual(["gone", "slipping", "short"]);
    expect(list[0].reasons).toEqual(["deadlines", "falling-short"]);
  });
});

describe("recentWorkSentence", () => {
  function recent(over: Partial<RecentWork>): RecentWork {
    return { studentId: "s1", missed: 0, late: 0, due: 10, incomplete: 0, graded: 5, ...over };
  }

  it("names both windows", () => {
    expect(recentWorkSentence(recent({ missed: 2, late: 1, incomplete: 1 }))).toBe(
      "2 missed, 1 late of the last 10 due · 1 of the last 5 graded fell short",
    );
  });

  it("says so when nothing slipped, rather than going blank", () => {
    expect(recentWorkSentence(recent({}))).toBe(
      "none of the last 10 due missed or late · 0 of the last 5 graded fell short",
    );
  });

  it("says how much there is to judge while the windows are still filling", () => {
    expect(recentWorkSentence(recent({ late: 1, due: 3, graded: 2 }))).toBe(
      "1 late of the 3 due so far · 0 of the 2 graded so far fell short",
    );
  });

  it("says when there is nothing in a window at all", () => {
    expect(recentWorkSentence(recent({ due: 0, graded: 0 }))).toBe(
      "nothing has come due yet · nothing graded yet",
    );
  });
});
