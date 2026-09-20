/**
 * Putting a roster in order: the two rules that make a sorted table readable, and the direction a
 * header opens in.
 */
import {
  DEFAULT_ROSTER_SORT,
  sortRoster,
  toggleRosterSort,
  type RosterSortColumn,
} from "@/lib/roster";

type Row = { name: string; github: string | null; cohort: string | null };

const ROWS: Row[] = [
  { name: "Oswaldo", github: "oswaldo", cohort: "Tuesday" },
  { name: "ana", github: null, cohort: "Monday" },
  { name: "Brianna", github: "bri", cohort: null },
  { name: "Caleb", github: "caleb", cohort: "Monday" },
];

const text = (row: Row, by: RosterSortColumn) =>
  by === "name" ? row.name : by === "github" ? row.github : row.cohort;

const namesOf = (rows: Row[]) => rows.map((row) => row.name);

describe("toggleRosterSort", () => {
  it("opens every column ascending, because they are all text", () => {
    expect(toggleRosterSort(DEFAULT_ROSTER_SORT, "github")).toEqual({
      by: "github",
      direction: "asc",
    });
    expect(toggleRosterSort({ by: "github", direction: "desc" }, "cohort")).toEqual({
      by: "cohort",
      direction: "asc",
    });
  });

  it("reverses the column it is already on", () => {
    expect(toggleRosterSort({ by: "name", direction: "asc" }, "name")).toEqual({
      by: "name",
      direction: "desc",
    });
    expect(toggleRosterSort({ by: "name", direction: "desc" }, "name")).toEqual({
      by: "name",
      direction: "asc",
    });
  });
});

describe("sortRoster", () => {
  it("orders by the chosen column, ignoring case", () => {
    expect(namesOf(sortRoster(ROWS, { by: "name", direction: "asc" }, text))).toEqual([
      "ana",
      "Brianna",
      "Caleb",
      "Oswaldo",
    ]);
  });

  it("reverses", () => {
    expect(namesOf(sortRoster(ROWS, { by: "name", direction: "desc" }, text))).toEqual([
      "Oswaldo",
      "Caleb",
      "Brianna",
      "ana",
    ]);
  });

  /*
    The rule worth having a test for: a fellow with no GitHub account is not alphabetically first,
    and reversing the column must not haul every blank to the top.
  */
  it("puts a row with nothing in that column last, whichever way it points", () => {
    expect(namesOf(sortRoster(ROWS, { by: "github", direction: "asc" }, text)).at(-1)).toBe("ana");
    expect(namesOf(sortRoster(ROWS, { by: "github", direction: "desc" }, text)).at(-1)).toBe("ana");

    expect(namesOf(sortRoster(ROWS, { by: "cohort", direction: "asc" }, text)).at(-1)).toBe(
      "Brianna",
    );
    expect(namesOf(sortRoster(ROWS, { by: "cohort", direction: "desc" }, text)).at(-1)).toBe(
      "Brianna",
    );
  });

  it("breaks ties on the name, so the order is total", () => {
    expect(namesOf(sortRoster(ROWS, { by: "cohort", direction: "asc" }, text))).toEqual([
      "ana",
      "Caleb",
      "Oswaldo",
      "Brianna",
    ]);
  });

  it("leaves the list it was given alone", () => {
    sortRoster(ROWS, { by: "name", direction: "desc" }, text);

    expect(namesOf(ROWS)).toEqual(["Oswaldo", "ana", "Brianna", "Caleb"]);
  });
});
