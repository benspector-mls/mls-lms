import {
  activeFilterCount,
  filterAssignments,
  filterIsActive,
  matchesColumnFilter,
  matchesStudent,
  namesSameColumn,
  NO_COLUMN_FILTER,
  searchStudents,
  sortStudents,
  toggleSort,
  type ColumnFilter,
  type FilterableAssignment,
  type RowSort,
} from "@/lib/gradebook/filters";

const NOW = new Date("2026-03-10T12:00:00Z");

function assignment(overrides: Partial<FilterableAssignment> = {}): FilterableAssignment {
  return {
    id: "a1",
    title: "Loops",
    courseUnitId: "u1",
    kind: "REPO",
    dueAt: null,
    ...overrides,
  };
}

function student(
  overrides: {
    id?: string;
    displayName?: string | null;
    email?: string | null;
    githubUsername?: string | null;
  } = {},
) {
  return {
    id: "s1",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    githubUsername: "ada",
    ...overrides,
  };
}

describe("searching for a student", () => {
  it("matches on the display name, case-insensitively", () => {
    expect(matchesStudent(student(), "ADA")).toBe(true);
    expect(matchesStudent(student(), "lovelace")).toBe(true);
  });

  /*
    Every name a student can be known by, not only the display name. A cohort is half people whose
    display name is set and half who are still only a GitHub handle, and a search reading one
    column would silently find nobody for the other half.
  */
  it("matches on the email and the GitHub handle too", () => {
    const anonymous = student({ displayName: null });
    expect(matchesStudent(anonymous, "ada@example")).toBe(true);
    expect(matchesStudent(anonymous, "ada")).toBe(true);
  });

  it("tolerates a null in every field without matching everything", () => {
    const blank = student({ displayName: null, email: null, githubUsername: null });
    expect(matchesStudent(blank, "ada")).toBe(false);
  });

  it("matches everybody on an empty or whitespace query", () => {
    expect(matchesStudent(student(), "")).toBe(true);
    expect(matchesStudent(student(), "   ")).toBe(true);
  });

  it("narrows the roster and leaves the rest alone", () => {
    const roster = [student(), student({ id: "s2", displayName: "Grace Hopper" })];
    expect(searchStudents(roster, "grace").map((s) => s.id)).toEqual(["s2"]);
    expect(searchStudents(roster, "").map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("the column filter", () => {
  /*
    Empty means "no restriction" rather than "nothing". That is what makes the unfiltered state
    the same value as the cleared state — there is no way to reach a grid with no columns by
    ticking things off one at a time.
  */
  it("keeps everything when nothing is chosen", () => {
    expect(matchesColumnFilter(assignment(), NO_COLUMN_FILTER, NOW)).toBe(true);
    expect(filterIsActive(NO_COLUMN_FILTER)).toBe(false);
    expect(activeFilterCount(NO_COLUMN_FILTER)).toBe(0);
  });

  it("keeps only the chosen units", () => {
    const filter: ColumnFilter = { ...NO_COLUMN_FILTER, unitIds: ["u2"] };
    expect(matchesColumnFilter(assignment({ courseUnitId: "u1" }), filter, NOW)).toBe(false);
    expect(matchesColumnFilter(assignment({ courseUnitId: "u2" }), filter, NOW)).toBe(true);
  });

  it("keeps only the chosen kinds", () => {
    const filter: ColumnFilter = { ...NO_COLUMN_FILTER, kinds: ["SELF_DIRECTED"] };
    expect(matchesColumnFilter(assignment({ kind: "REPO" }), filter, NOW)).toBe(false);
    expect(matchesColumnFilter(assignment({ kind: "SELF_DIRECTED" }), filter, NOW)).toBe(true);
  });

  describe("the due-date windows", () => {
    const overdue = assignment({ id: "past", dueAt: new Date("2026-03-01T12:00:00Z") });
    const soon = assignment({ id: "soon", dueAt: new Date("2026-03-13T12:00:00Z") });
    const later = assignment({ id: "later", dueAt: new Date("2026-04-20T12:00:00Z") });
    const undated = assignment({ id: "undated", dueAt: null });

    it("finds what is past due", () => {
      const filter: ColumnFilter = { ...NO_COLUMN_FILTER, due: "overdue" };
      expect(
        filterAssignments([overdue, soon, later, undated], filter, NOW).map((a) => a.id),
      ).toEqual(["past"]);
    });

    it("finds the coming week, and not the month after it", () => {
      const filter: ColumnFilter = { ...NO_COLUMN_FILTER, due: "upcoming" };
      expect(
        filterAssignments([overdue, soon, later, undated], filter, NOW).map((a) => a.id),
      ).toEqual(["soon"]);
    });

    it("finds the work with no deadline set", () => {
      const filter: ColumnFilter = { ...NO_COLUMN_FILTER, due: "undated" };
      expect(
        filterAssignments([overdue, soon, later, undated], filter, NOW).map((a) => a.id),
      ).toEqual(["undated"]);
    });

    // A date-dependent window must exclude undated work rather than admit it by accident, or
    // "past due" would list assignments that have no due date to be past.
    it("never counts undated work as dated", () => {
      for (const due of ["overdue", "upcoming"] as const) {
        expect(matchesColumnFilter(undated, { ...NO_COLUMN_FILTER, due }, NOW)).toBe(false);
      }
    });

    it("accepts an ISO string as readily as a Date, since a payload carries one", () => {
      const asString = assignment({ dueAt: "2026-03-01T12:00:00Z" });
      expect(matchesColumnFilter(asString, { ...NO_COLUMN_FILTER, due: "overdue" }, NOW)).toBe(
        true,
      );
    });
  });

  it("applies every restriction at once", () => {
    const filter: ColumnFilter = { unitIds: ["u1"], kinds: ["REPO"], due: "all" };
    expect(activeFilterCount(filter)).toBe(2);
    expect(matchesColumnFilter(assignment({ courseUnitId: "u1", kind: "REPO" }), filter, NOW)).toBe(
      true,
    );
    expect(
      matchesColumnFilter(assignment({ courseUnitId: "u1", kind: "SELF_DIRECTED" }), filter, NOW),
    ).toBe(false);
  });
});

describe("sorting the rows", () => {
  const ada = student({ id: "ada", displayName: "Ada" });
  const grace = student({ id: "grace", displayName: "Grace" });
  const katherine = student({ id: "kat", displayName: "Katherine" });

  const values = {
    completed: (id: string) => ({ ada: 3, grace: 1, kat: 2 })[id] ?? 0,
    waiting: (id: string) => ({ ada: 0, grace: 5, kat: 2 })[id] ?? 0,
    score: (id: string) => ({ ada: 0.9, grace: 0.5 })[id] ?? null,
  };

  const roster = [grace, ada, katherine];

  it("puts names in alphabetical order", () => {
    const sorted = sortStudents(roster, { by: "name", direction: "asc" }, values);
    expect(sorted.map((s) => s.id)).toEqual(["ada", "grace", "kat"]);
  });

  it("reverses on the other direction", () => {
    const sorted = sortStudents(roster, { by: "name", direction: "desc" }, values);
    expect(sorted.map((s) => s.id)).toEqual(["kat", "grace", "ada"]);
  });

  it("orders by how much is waiting", () => {
    const sorted = sortStudents(roster, { by: "waiting", direction: "desc" }, values);
    expect(sorted.map((s) => s.id)).toEqual(["grace", "kat", "ada"]);
  });

  it("orders by how much is complete", () => {
    const sorted = sortStudents(roster, { by: "completed", direction: "desc" }, values);
    expect(sorted.map((s) => s.id)).toEqual(["ada", "kat", "grace"]);
  });

  /*
    A missing score is not a low one — the same distinction the cells draw between an empty ring
    and a zero. Sorting by an assignment nobody has started should not reorder the roster into
    something arbitrary.
  */
  it("puts a student with no score last, whichever way it points", () => {
    for (const direction of ["asc", "desc"] as const) {
      const sorted = sortStudents(
        roster,
        { by: "assignment", assignmentId: "a1", direction },
        values,
      );
      expect(sorted.at(-1)!.id).toBe("kat");
    }
  });

  it("breaks a tie on name, so two renders put the rows in the same places", () => {
    const flat = {
      completed: () => 1,
      waiting: () => 1,
      score: () => 1,
    };
    const sorted = sortStudents(roster, { by: "completed", direction: "desc" }, flat);
    expect(sorted.map((s) => s.id)).toEqual(["ada", "grace", "kat"]);
  });

  it("does not sort the array it was given", () => {
    const original = [...roster];
    sortStudents(roster, { by: "name", direction: "asc" }, values);
    expect(roster).toEqual(original);
  });
});

describe("clicking a header", () => {
  const byName: RowSort = { by: "name", direction: "asc" };

  it("reverses the column that is already sorted", () => {
    expect(toggleSort(byName, { by: "name" })).toEqual({ by: "name", direction: "desc" });
  });

  it("opens a name ascending, because A-to-Z is what sorted means for people", () => {
    expect(toggleSort({ by: "waiting", direction: "asc" }, { by: "name" })).toEqual({
      by: "name",
      direction: "asc",
    });
  });

  /*
    The question behind sorting by "waiting on you" is who has the most. Offering zero first would
    put every student with nothing outstanding at the top, which is the answer nobody clicked for.
  */
  it("opens a number descending, because the question is who has the most", () => {
    expect(toggleSort(byName, { by: "waiting" })).toEqual({ by: "waiting", direction: "desc" });
    expect(toggleSort(byName, { by: "completed" })).toEqual({ by: "completed", direction: "desc" });
  });

  it("tells two assignment columns apart", () => {
    const onA1: RowSort = { by: "assignment", assignmentId: "a1", direction: "desc" };

    expect(namesSameColumn(onA1, { by: "assignment", assignmentId: "a1" })).toBe(true);
    expect(namesSameColumn(onA1, { by: "assignment", assignmentId: "a2" })).toBe(false);

    // Clicking the other assignment starts fresh rather than reversing this one.
    expect(toggleSort(onA1, { by: "assignment", assignmentId: "a2" })).toEqual({
      by: "assignment",
      assignmentId: "a2",
      direction: "desc",
    });
  });
});
