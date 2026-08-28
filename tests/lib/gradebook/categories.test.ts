import {
  allUnits,
  cellsFor,
  courseVerdictByStudent,
  groupByUnit,
  published,
  unitCompletionByStudent,
  unitHasVerdict,
  verdictsByStudent,
  workOf,
  type CategorizedAssignment,
  type CategorizedUnit,
  type WorkCell,
} from "@/lib/gradebook/categories";
import { completionByStudent } from "@/lib/gradebook/summary";

/**
 * The three-way split of a course's work, and what "complete" means at each of three levels.
 *
 * Three properties are worth more than the rest. The split is **exhaustive and disjoint** — every
 * assignment lands under exactly one unit on exactly one tab, because a column that is missing
 * looks like work that does not exist. A verdict is read from `isComplete` and never computed
 * from a score, so the tabs agree with each other by construction. And the two roll-up rules —
 * **an empty unit is skipped**, **a draft never blocks a verdict** — are what stop the whole
 * thing lying the moment an instructor starts writing next week's work.
 */

const PUBLISHED = new Date("2026-01-01T00:00:00Z");

function assignment(
  id: string,
  courseUnitId: string,
  overrides: Partial<CategorizedAssignment> = {},
): CategorizedAssignment {
  return { id, title: id, dueAt: null, courseUnitId, distributedAt: PUBLISHED, ...overrides };
}

function unit(id: string, category: CategorizedUnit["category"], position = 0): CategorizedUnit {
  return { id, name: id, position, category };
}

function cell(assignmentId: string, studentId: string, isComplete: boolean | null): WorkCell {
  return { assignmentId, studentId, isComplete };
}

describe("groupByUnit", () => {
  const units = [unit("m1", "MODULE", 0), unit("p1", "PROJECT", 1), unit("s1", "ASSESSMENT", 2)];
  const assignments = [
    assignment("loops", "m1"),
    assignment("erd", "p1", { dueAt: new Date("2026-09-10T00:00:00Z") }),
    assignment("wireframes", "p1", { dueAt: new Date("2026-09-03T00:00:00Z") }),
    assignment("coding", "s1"),
  ];

  const grouped = groupByUnit(assignments, units);

  it("puts every assignment under exactly one unit", () => {
    const placed = [
      ...workOf(grouped.MODULE),
      ...workOf(grouped.PROJECT),
      ...workOf(grouped.ASSESSMENT),
    ].map((a) => a.id);

    expect(placed.sort()).toEqual(assignments.map((a) => a.id).sort());
    expect(new Set(placed).size).toBe(assignments.length);
  });

  it("sorts a unit's work by due date", () => {
    expect(grouped.PROJECT[0].work.map((w) => w.id)).toEqual(["wireframes", "erd"]);
  });

  /*
    An instructor who has just created a unit should see it where they put it. Dropping it would
    make creating one look like it had failed.
  */
  it("keeps a unit that has no work yet", () => {
    const empty = groupByUnit([], [unit("p9", "PROJECT")]);
    expect(empty.PROJECT).toHaveLength(1);
    expect(empty.PROJECT[0].work).toEqual([]);
  });

  // One sequence across all three categories, so a project reads where the instructor put it.
  it("keeps units in course order across categories", () => {
    const ordered = allUnits(
      groupByUnit(
        [],
        [unit("late", "MODULE", 2), unit("mid", "PROJECT", 1), unit("first", "MODULE", 0)],
      ),
    );
    expect(ordered.map((entry) => entry.unit.id)).toEqual(["first", "mid", "late"]);
  });

  /*
    Belongs to a unit this screen is not showing, so there is nowhere on this screen it could
    honestly go. Every real caller passes the whole course.
  */
  it("drops an assignment whose unit was not fetched", () => {
    const grouped = groupByUnit([assignment("orphan", "gone")], [unit("m1", "MODULE")]);
    expect(workOf(allUnits(grouped))).toEqual([]);
  });
});

describe("verdictsByStudent", () => {
  const work = [assignment("a1", "u1"), assignment("a2", "u1")];

  it("is complete only when every assignment is", () => {
    expect(
      verdictsByStudent([cell("a1", "s1", true), cell("a2", "s1", true)], work).get("s1"),
    ).toBe("complete");
  });

  /*
    "Not finished yet" and "finished and did not meet the threshold" are different sentences. A
    unit shown as incomplete while work is still with an instructor would be telling a student
    they had failed something nobody has marked.
  */
  it("is pending when one is complete and the other is unmarked", () => {
    expect(verdictsByStudent([cell("a1", "s1", true)], work).get("s1")).toBe("pending");
    expect(
      verdictsByStudent([cell("a1", "s1", true), cell("a2", "s1", null)], work).get("s1"),
    ).toBe("pending");
  });

  it("is incomplete only once everything has a verdict and one fell short", () => {
    expect(
      verdictsByStudent([cell("a1", "s1", true), cell("a2", "s1", false)], work).get("s1"),
    ).toBe("incomplete");
  });

  // The unmarked one can still change the answer, so no verdict has been reached.
  it("is pending when one failed and another is still unmarked", () => {
    expect(
      verdictsByStudent([cell("a1", "s1", false), cell("a2", "s1", null)], work).get("s1"),
    ).toBe("pending");
  });

  it("omits a student who has started nothing", () => {
    expect(verdictsByStudent([cell("a1", "other", true)], work).has("s1")).toBe(false);
  });

  it("keeps students apart", () => {
    const verdicts = verdictsByStudent(
      [
        cell("a1", "s1", true),
        cell("a2", "s1", true),
        cell("a1", "s2", true),
        cell("a2", "s2", false),
      ],
      work,
    );
    expect(verdicts.get("s1")).toBe("complete");
    expect(verdicts.get("s2")).toBe("incomplete");
  });

  // ---- the draft rule ----

  /*
    The case the published-only rule exists for. Without it, an instructor writing next week's
    assignment silently un-completes the unit for everyone who had finished it.
  */
  it("ignores a draft, so adding one does not take a completion away", () => {
    const withDraft = [...work, assignment("a3", "u1", { distributedAt: null })];
    expect(
      verdictsByStudent([cell("a1", "s1", true), cell("a2", "s1", true)], withDraft).get("s1"),
    ).toBe("complete");
  });

  it("counts the draft once it is published", () => {
    const published = [...work, assignment("a3", "u1")];
    expect(
      verdictsByStudent([cell("a1", "s1", true), cell("a2", "s1", true)], published).get("s1"),
    ).toBe("pending");
  });

  /*
    Zero of zero complete is not an achievement, and reporting it as complete would let an empty
    unit count toward a student's course.
  */
  it("gives a unit with nothing published no verdict at all", () => {
    expect(verdictsByStudent([cell("a1", "s1", true)], []).size).toBe(0);
    expect(
      verdictsByStudent([cell("a1", "s1", true)], [assignment("a1", "u1", { distributedAt: null })])
        .size,
    ).toBe(0);
  });

  it("names which work counts", () => {
    expect(
      published([assignment("a1", "u1"), assignment("a2", "u1", { distributedAt: null })]),
    ).toHaveLength(1);
    expect(unitHasVerdict({ unit: unit("u1", "MODULE"), work: [] })).toBe(false);
    expect(unitHasVerdict({ unit: unit("u1", "MODULE"), work: [assignment("a1", "u1")] })).toBe(
      true,
    );
  });
});

describe("courseVerdictByStudent", () => {
  const units = [unit("m1", "MODULE", 0), unit("m2", "MODULE", 1)];
  const assignments = [assignment("a1", "m1"), assignment("a2", "m2")];
  const grouped = allUnits(groupByUnit(assignments, units));

  it("is complete only when every unit is", () => {
    expect(
      courseVerdictByStudent([cell("a1", "s1", true), cell("a2", "s1", true)], grouped, ["s1"]).get(
        "s1",
      ),
    ).toBe("complete");
    expect(courseVerdictByStudent([cell("a1", "s1", true)], grouped, ["s1"]).get("s1")).toBe(
      "pending",
    );
  });

  it("is incomplete once every unit has settled and one fell short", () => {
    expect(
      courseVerdictByStudent([cell("a1", "s1", true), cell("a2", "s1", false)], grouped, [
        "s1",
      ]).get("s1"),
    ).toBe("incomplete");
  });

  /*
    The rule that keeps a course completable. An instructor creating next term's unit must not
    make the course uncompletable for everybody who has finished what exists.
  */
  it("skips an empty unit rather than letting it block the course", () => {
    const withEmpty = allUnits(groupByUnit(assignments, [...units, unit("m3", "MODULE", 2)]));
    expect(
      courseVerdictByStudent([cell("a1", "s1", true), cell("a2", "s1", true)], withEmpty, [
        "s1",
      ]).get("s1"),
    ).toBe("complete");
  });

  it("skips a unit holding only drafts", () => {
    const withDraftUnit = allUnits(
      groupByUnit(
        [...assignments, assignment("a3", "m3", { distributedAt: null })],
        [...units, unit("m3", "MODULE", 2)],
      ),
    );
    expect(
      courseVerdictByStudent([cell("a1", "s1", true), cell("a2", "s1", true)], withDraftUnit, [
        "s1",
      ]).get("s1"),
    ).toBe("complete");
  });

  // A course where nothing has been handed out yet is not complete for anybody.
  it("has no verdict when the course has nothing published", () => {
    const nothing = allUnits(groupByUnit([], [unit("m1", "MODULE")]));
    expect(courseVerdictByStudent([], nothing, ["s1"]).get("s1")).toBe("pending");
  });

  // Unlike a unit verdict, this must be able to say "complete" about a student who appears in no
  // cell of some unit — so the roster is passed in rather than derived from the cells.
  it("answers for every student named, including one with no cells", () => {
    const result = courseVerdictByStudent([cell("a1", "s1", true)], grouped, ["s1", "s2"]);
    expect(result.get("s2")).toBe("pending");
    expect(result.size).toBe(2);
  });
});

describe("unitCompletionByStudent", () => {
  /*
    "2 of 3 projects" must not become "2 of 4" because somebody created a fourth and has not
    filled it. The denominator is the units that can be judged.
  */
  it("measures against the units that have a verdict", () => {
    const units = [unit("p1", "PROJECT", 0), unit("p2", "PROJECT", 1), unit("p3", "PROJECT", 2)];
    const assignments = [assignment("a1", "p1"), assignment("a2", "p2")];
    const grouped = groupByUnit(assignments, units);

    const completion = unitCompletionByStudent([cell("a1", "s1", true)], grouped.PROJECT);
    expect(completion.get("s1")).toEqual({ complete: 1, possible: 2 });
  });
});

describe("cellsFor", () => {
  /*
    Without this a tab would count every completed assignment in the course in its numerator
    against a denominator of its own columns only, and read as more complete than the cohort is.
  */
  it("narrows a course's cells to one tab's assignments", () => {
    const grouped = groupByUnit(
      [assignment("loose", "m1"), assignment("erd", "p1")],
      [unit("m1", "MODULE", 0), unit("p1", "PROJECT", 1)],
    );
    const cells = [cell("loose", "s1", true), cell("erd", "s1", true)];
    const narrowed = cellsFor(cells, workOf(grouped.MODULE));

    expect(narrowed).toEqual([cell("loose", "s1", true)]);
    expect(completionByStudent(narrowed, 1).get("s1")).toEqual({ complete: 1, possible: 1 });
  });
});
