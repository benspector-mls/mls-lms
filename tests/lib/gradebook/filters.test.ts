import {
  activeFilterCount,
  encodeColumnFilter,
  filterAssignments,
  filterIsActive,
  matchesColumnFilter,
  matchesStudent,
  namesSameColumn,
  NO_COLUMN_FILTER,
  parseColumnFilter,
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

    describe("a custom range", () => {
      const range = (from: string | null, to: string | null): ColumnFilter => ({
        ...NO_COLUMN_FILTER,
        due: { from, to },
      });

      it("keeps the work due between the two dates", () => {
        const filter = range("2026-03-05", "2026-03-15");
        expect(
          filterAssignments([overdue, soon, later, undated], filter, NOW).map((a) => a.id),
        ).toEqual(["soon"]);
      });

      /*
        Both ends inclusive, and read as a wall clock in Brooklyn. Work due at 11:59pm on the day
        named in `to` is 4am the next day in UTC, so a boundary read as an instant would put the
        one deadline a reader was certainly asking about outside the range they drew around it.
      */
      it("includes work due late on the closing day", () => {
        const lastMinute = assignment({ id: "last", dueAt: "2026-03-15T03:59:00Z" });
        expect(matchesColumnFilter(lastMinute, range("2026-03-05", "2026-03-14"), NOW)).toBe(true);
      });

      it("leaves an open end unbounded", () => {
        expect(
          filterAssignments([overdue, soon, later], range("2026-03-05", null), NOW).map((a) => a.id),
        ).toEqual(["soon", "later"]);
        expect(
          filterAssignments([overdue, soon, later], range(null, "2026-03-14"), NOW).map((a) => a.id),
        ).toEqual(["past", "soon"]);
      });

      // A range is a question about the calendar, and work with no deadline is not an answer.
      it("never counts undated work as inside a range", () => {
        expect(matchesColumnFilter(undated, range("2026-01-01", "2026-12-31"), NOW)).toBe(false);
      });

      /*
        Choosing "Custom range" sets one before either date is typed, so both ends open has to
        narrow nothing — otherwise the badge claims a restriction and "Clear the filter" clears
        something the reader never chose.
      */
      it("narrows nothing while both ends are still empty", () => {
        expect(filterIsActive(range(null, null))).toBe(false);
        expect(activeFilterCount(range(null, null))).toBe(0);
        expect(matchesColumnFilter(undated, range(null, null), NOW)).toBe(true);
      });
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

describe("a filter as an address", () => {
  const known = { unitIds: new Set(["u1", "u2"]) };
  const parse = (query: string) => parseColumnFilter(new URLSearchParams(query), known);
  const encode = (filter: ColumnFilter) => encodeColumnFilter(filter).toString();

  /*
    An unfiltered screen has a clean URL, which is what makes the cleared state and the opening
    state the same address rather than two that differ by a string of empty parameters.
  */
  it("writes nothing when nothing is narrowed", () => {
    expect(encode(NO_COLUMN_FILTER)).toBe("");
    expect(parse("")).toEqual(NO_COLUMN_FILTER);
  });

  it("round-trips every shape of the filter", () => {
    const filters: ColumnFilter[] = [
      { unitIds: ["u1", "u2"], kinds: [], due: "all" },
      { unitIds: [], kinds: ["REPO", "GOOGLE_DRIVE"], due: "all" },
      { unitIds: [], kinds: [], due: "overdue" },
      { unitIds: [], kinds: [], due: { from: null, to: null } },
      { unitIds: [], kinds: [], due: { from: "2026-01-06", to: "2026-02-14" } },
      { unitIds: [], kinds: [], due: { from: "2026-01-06", to: null } },
      { unitIds: [], kinds: [], due: { from: null, to: "2026-02-14" } },
      { unitIds: ["u2"], kinds: ["SELF_DIRECTED"], due: "undated" },
    ];

    for (const filter of filters) {
      expect(parse(encode(filter))).toEqual(filter);
    }
  });

  /*
    A stale link or a hand-edited address lands on a wider screen than whoever wrote it intended,
    never on an empty one with a uuid showing in the menu — which reads as "there is no work here"
    rather than as "that link is out of date".
  */
  it("discards a unit this screen does not have", () => {
    expect(parse("units=u1,u9").unitIds).toEqual(["u1"]);
  });

  it("discards a kind that is not one of the three", () => {
    expect(parse("kinds=REPO,PIGEON").kinds).toEqual(["REPO"]);
  });

  it("discards a date that is not a date", () => {
    expect(parse("due=2026-02-31..2026-13-40").due).toEqual({ from: null, to: null });
    expect(parse("due=13th-of-never").due).toBe("all");
    expect(parse("due=..2026-02-14").due).toEqual({ from: null, to: "2026-02-14" });
  });

  /*
    The state the menu is in between choosing "Custom range" and typing a date. It has to survive
    the write, or the two date fields disappear the instant they are asked for — the choice would
    have nowhere to live but the address, and an address that dropped it would report "all" back.

    It still narrows nothing, which is the badge's question rather than this one.
  */
  it("keeps a range that has no dates in it yet", () => {
    expect(encode({ ...NO_COLUMN_FILTER, due: { from: null, to: null } })).toBe("due=..");
    expect(parse("due=..").due).toEqual({ from: null, to: null });
    expect(filterIsActive(parse("due=.."))).toBe(false);
  });

  it("ignores a repeated unit, so a hand-written address cannot double one up", () => {
    expect(parse("units=u1,u1,u2").unitIds).toEqual(["u1", "u2"]);
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
