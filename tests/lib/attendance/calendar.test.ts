import { addMonths, formatMonth, monthGrid, monthOf, monthRange } from "@/lib/attendance/calendar";

/**
 * The month grid a fellow pages through.
 *
 * **Every case here is really the same case:** that none of this asks the running machine what
 * day it is. A grid built with `new Date(year, month, 1)` is a day out for everybody west of
 * Greenwich, and the failure is invisible on the developer's screen if they happen to be east of
 * it. That is why the assertions name exact dates rather than counting cells.
 */

describe("monthOf", () => {
  it("takes the month off a school day", () => {
    expect(monthOf("2026-09-14")).toBe("2026-09");
  });
});

describe("addMonths", () => {
  it("moves forward and back within a year", () => {
    expect(addMonths("2026-09", 1)).toBe("2026-10");
    expect(addMonths("2026-09", -1)).toBe("2026-08");
  });

  it("crosses the year in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("crosses several years at once", () => {
    expect(addMonths("2026-06", 14)).toBe("2027-08");
    expect(addMonths("2026-06", -14)).toBe("2025-04");
  });

  it("does not land on the 31st of a month that has 30 days", () => {
    // The classic date-arithmetic bug: adding a month to 31 January gives 3 March. This works
    // from the 1st for that reason, and the test is here so it keeps doing so.
    expect(addMonths("2026-01", 1)).toBe("2026-02");
    expect(addMonths("2026-03", -1)).toBe("2026-02");
  });
});

describe("monthGrid", () => {
  it("starts on the Sunday on or before the first of the month", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Sunday 30 August.
    const weeks = monthGrid("2026-09");
    expect(weeks[0][0].day).toBe("2026-08-30");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][2].day).toBe("2026-09-01");
    expect(weeks[0][2].inMonth).toBe(true);
  });

  it("gives whole weeks of seven", () => {
    for (const month of ["2026-01", "2026-02", "2026-09", "2026-12"]) {
      for (const week of monthGrid(month)) expect(week).toHaveLength(7);
    }
  });

  it("contains every day of the month exactly once, in order", () => {
    const days = monthGrid("2026-09")
      .flat()
      .filter((cell) => cell.inMonth)
      .map((cell) => cell.day);

    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-01");
    expect(days[29]).toBe("2026-09-30");
    expect([...days].sort()).toEqual(days);
  });

  it("handles a February that starts on a Sunday and needs no padding at the front", () => {
    // 1 February 2026 is a Sunday.
    const weeks = monthGrid("2026-02");
    expect(weeks[0][0].day).toBe("2026-02-01");
    expect(weeks[0][0].inMonth).toBe(true);
  });

  it("drops a trailing week that belongs entirely to the next month", () => {
    // Without the trim a short month draws an empty sixth row that reads as a bug.
    for (const month of ["2026-02", "2026-09", "2027-02"]) {
      const weeks = monthGrid(month);
      expect(weeks[weeks.length - 1].some((cell) => cell.inMonth)).toBe(true);
    }
  });

  it("crosses a daylight-saving boundary without losing or repeating a day", () => {
    // The clocks change on 8 March 2026. Local-time arithmetic drops or doubles a day here.
    const days = monthGrid("2026-03")
      .flat()
      .filter((cell) => cell.inMonth)
      .map((cell) => cell.day);

    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(days).toContain("2026-03-08");
  });

  it("does the same in November, when the clocks go back", () => {
    const days = monthGrid("2026-11")
      .flat()
      .filter((cell) => cell.inMonth)
      .map((cell) => cell.day);

    expect(days).toHaveLength(30);
    expect(new Set(days).size).toBe(30);
    expect(days).toContain("2026-11-01");
  });
});

describe("monthRange", () => {
  it("is empty when there are no sessions", () => {
    expect(monthRange([], "2026-09-14")).toEqual([]);
  });

  it("runs from the first session's month through today", () => {
    expect(monthRange(["2026-07-14", "2026-08-02"], "2026-09-14")).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("reaches today even when the cohort has not met for months", () => {
    // Otherwise a cohort on a summer break opens on a month with nothing in it and no way forward.
    expect(monthRange(["2026-05-04"], "2026-08-16")).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("reaches the last session even when it is somehow after today", () => {
    expect(monthRange(["2026-09-01", "2026-11-02"], "2026-09-14")).toContain("2026-11");
  });

  it("is one month when everything happened in it", () => {
    expect(monthRange(["2026-09-01", "2026-09-30"], "2026-09-14")).toEqual(["2026-09"]);
  });
});

describe("formatMonth", () => {
  it("names the month and the year, from the civil date rather than a zone", () => {
    expect(formatMonth("2026-09")).toBe("September 2026");
    expect(formatMonth("2026-01")).toBe("January 2026");
  });
});
