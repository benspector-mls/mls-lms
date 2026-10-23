import {
  defaultRecentWindow,
  formatRecentWindow,
  inRecentWindow,
  isDefaultRecentWindow,
  parseRecentWindow,
} from "@/lib/recent-window";

/**
 * The days every recent figure is read over. What these protect is that the window can never end
 * after today, whatever an address says, and that a broken address falls back to the default
 * rather than to an empty or reversed window.
 */

const TODAY = "2026-10-23";

describe("defaultRecentWindow", () => {
  it("is the two weeks ending today, today included", () => {
    expect(defaultRecentWindow(TODAY)).toEqual({ from: "2026-10-10", to: "2026-10-23" });
  });
});

describe("parseRecentWindow", () => {
  it("is the default when nothing is asked", () => {
    expect(parseRecentWindow({}, TODAY)).toEqual(defaultRecentWindow(TODAY));
    expect(isDefaultRecentWindow(parseRecentWindow({}, TODAY), TODAY)).toBe(true);
  });

  it("honours a range on or before today", () => {
    expect(parseRecentWindow({ from: "2026-09-01", to: "2026-09-30" }, TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("never ends after today", () => {
    expect(parseRecentWindow({ from: "2026-10-01", to: "2026-12-01" }, TODAY)).toEqual({
      from: "2026-10-01",
      to: TODAY,
    });
  });

  it("reads to today when only a start is given, and two weeks back when only an end is", () => {
    expect(parseRecentWindow({ from: "2026-09-01" }, TODAY)).toEqual({
      from: "2026-09-01",
      to: TODAY,
    });
    expect(parseRecentWindow({ to: "2026-09-30" }, TODAY)).toEqual({
      from: "2026-09-17",
      to: "2026-09-30",
    });
  });

  it("falls back from a start after the end, and from anything that is not a day", () => {
    expect(parseRecentWindow({ from: "2026-10-20", to: "2026-10-10" }, TODAY)).toEqual({
      from: "2026-09-27",
      to: "2026-10-10",
    });
    expect(parseRecentWindow({ from: "soon", to: "2026-02-31" }, TODAY)).toEqual(
      defaultRecentWindow(TODAY),
    );
  });
});

describe("inRecentWindow", () => {
  const window = { from: "2026-10-10", to: "2026-10-23" };

  it("includes both ends", () => {
    expect(inRecentWindow("2026-10-10", window)).toBe(true);
    expect(inRecentWindow("2026-10-23", window)).toBe(true);
    expect(inRecentWindow("2026-10-09", window)).toBe(false);
    expect(inRecentWindow("2026-10-24", window)).toBe(false);
  });
});

describe("formatRecentWindow", () => {
  it("prints both ends", () => {
    expect(formatRecentWindow({ from: "2026-09-29", to: "2026-10-12" })).toBe("9/29 – 10/12");
  });
});
