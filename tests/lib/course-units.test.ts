import {
  CATEGORY_META,
  UNIT_CATEGORIES,
  compareByDueDate,
  compareByPosition,
  partCount,
  sortByDueDate,
  startingUnitId,
  type SortableWork,
} from "@/lib/course-units";

/**
 * The order work is shown in, and the words used for it.
 *
 * What the comparator protects is that one rule produces the order on every screen. A unit is a
 * sequence of deadlines, so the due date *is* the ordering — there is no per-assignment position
 * for an instructor to drag into agreement with the dates, and the day a screen sorts by
 * something else is the day a student's list stops matching the one the instructor authored
 * against.
 */

function work(title: string, dueAt: string | null): SortableWork {
  return { title, dueAt: dueAt === null ? null : new Date(dueAt) };
}

describe("compareByDueDate", () => {
  it("puts the earlier deadline first", () => {
    const sorted = sortByDueDate([
      work("ERD", "2026-09-10T00:00:00Z"),
      work("Wireframes", "2026-09-03T00:00:00Z"),
    ]);

    expect(sorted.map((w) => w.title)).toEqual(["Wireframes", "ERD"]);
  });

  /*
    Null means "no deadline set yet", which is work an instructor has started and not finished
    describing. Sorting it first would push the dated work down the page every time somebody
    began drafting the next one.
  */
  it("sorts undated work last", () => {
    const sorted = sortByDueDate([
      work("Not yet scheduled", null),
      work("Demo", "2026-10-01T00:00:00Z"),
      work("ERD", "2026-09-01T00:00:00Z"),
    ]);

    expect(sorted.map((w) => w.title)).toEqual(["ERD", "Demo", "Not yet scheduled"]);
  });

  it("keeps undated work in a stable order among itself", () => {
    expect(sortByDueDate([work("Beta", null), work("Alpha", null)]).map((w) => w.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  /*
    Two assignments due the same day is ordinary — an ERD and the queries that go with it.
    Without the tie-break their order would come from whatever the database happened to return,
    which can differ between two renders of the same page.
  */
  it("breaks ties on title so the order is total", () => {
    const sameDay = "2026-09-15T00:00:00Z";
    expect(
      sortByDueDate([work("Queries", sameDay), work("ERD", sameDay)]).map((w) => w.title),
    ).toEqual(["ERD", "Queries"]);
  });

  it("reads a date stored as a string the same as a Date", () => {
    expect(
      compareByDueDate(
        { title: "a", dueAt: "2026-09-01T00:00:00Z" },
        { title: "b", dueAt: new Date("2026-09-02T00:00:00Z") },
      ),
    ).toBeLessThan(0);
  });

  it("does not sort the array it was given", () => {
    const original = [
      work("Later", "2026-10-01T00:00:00Z"),
      work("Sooner", "2026-09-01T00:00:00Z"),
    ];
    sortByDueDate(original);
    expect(original.map((w) => w.title)).toEqual(["Later", "Sooner"]);
  });
});

describe("compareByPosition", () => {
  /*
    One sequence across all three categories, so a project sits between two modules where it
    falls in the term rather than at the end of a list of its own.
  */
  it("orders by position regardless of category", () => {
    const units = [
      { position: 2, name: "Mod 3" },
      { position: 1, name: "Capstone" },
      { position: 0, name: "Mod 1" },
    ].sort(compareByPosition);

    expect(units.map((u) => u.name)).toEqual(["Mod 1", "Capstone", "Mod 3"]);
  });

  // Positions are deliberately not unique — reorder rewrites the whole sequence and passes
  // through states where two units share one. The tie-break is what keeps rendering stable.
  it("breaks a shared position on name", () => {
    const units = [
      { position: 1, name: "Beta" },
      { position: 1, name: "Alpha" },
    ].sort(compareByPosition);

    expect(units.map((u) => u.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("the category vocabulary", () => {
  it("names the work inside a unit after what the unit is", () => {
    expect(CATEGORY_META.MODULE.partNoun).toBe("assignment");
    expect(CATEGORY_META.PROJECT.partNoun).toBe("deliverable");
    expect(CATEGORY_META.ASSESSMENT.partNoun).toBe("part");
  });

  it("counts in the words of the category", () => {
    expect(partCount("PROJECT", 1)).toBe("1 deliverable");
    expect(partCount("PROJECT", 3)).toBe("3 deliverables");
    expect(partCount("MODULE", 2)).toBe("2 assignments");
  });

  // Every category has every word, so no screen has to handle a missing one.
  it("gives every category a full set of words", () => {
    for (const category of UNIT_CATEGORIES) {
      for (const word of Object.values(CATEGORY_META[category])) {
        expect(word.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Which unit a new assignment opens in.
 *
 * The rule is a function rather than a chain of `??` in the form because one of its cases is
 * silent: a `?unit=` naming something that is not one of this course's units would reach the select
 * as a value it has no label for, and the trigger would render a raw uuid where a name should be.
 * That reads as a broken pre-fill rather than as a stale link, and nothing throws.
 */
describe("startingUnitId", () => {
  const units = [{ id: "mod-1" }, { id: "mod-2" }, { id: "project-1" }];

  it("uses the unit the address asked for", () => {
    expect(startingUnitId({ requested: "project-1", units })).toBe("project-1");
  });

  it("falls back to the first unit when the address asked for nothing", () => {
    expect(startingUnitId({ units })).toBe("mod-1");
    expect(startingUnitId({ requested: null, units })).toBe("mod-1");
    expect(startingUnitId({ requested: "", units })).toBe("mod-1");
  });

  /*
    The case the function exists for. A stale link must not put an id the select cannot label into
    the select — the reader would see a uuid and no way to tell whether the form had understood
    them.
  */
  it("ignores a unit that is not one of this course's", () => {
    expect(startingUnitId({ requested: "somebody-elses-unit", units })).toBe("mod-1");
  });

  /*
    An assignment being edited keeps its own unit whatever the address says. A `?unit=` on an edit
    address would be a way to move an assignment by typing, which is a different act from editing
    one — and it would move it silently, since the field would simply show somewhere else.
  */
  it("keeps an existing assignment's own unit, whatever the address asks for", () => {
    expect(startingUnitId({ existing: "mod-2", requested: "project-1", units })).toBe("mod-2");
    expect(startingUnitId({ existing: "mod-2", units })).toBe("mod-2");
  });

  /*
    A course with nothing to put an assignment in. Empty rather than a guess, because the form draws
    an explanation from it — an empty select would read as a list that failed to load.
  */
  it("is empty when the course has no units", () => {
    expect(startingUnitId({ units: [] })).toBe("");
    expect(startingUnitId({ requested: "mod-1", units: [] })).toBe("");
  });
});
