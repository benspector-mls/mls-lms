import { CELL, isMarked, kindOf } from "@/lib/attendance/cells";

/**
 * Which square a fellow's own attendance draws for one day.
 *
 * **The precedence is the whole of this file.** `kindOf` answers with the first of five rules that
 * applies, and every one of those rules is a decision somebody could argue with — most of all the
 * one that puts a stored status ahead of check-in still being open, which is what stops a fellow
 * who checked in at nine looking at a neutral square until the evening.
 */

const ENROLLED_FROM = "2026-09-01";
const DAY = "2026-09-14";

describe("kindOf", () => {
  it("says no session at all before it says anything else", () => {
    // Not even the enrolment check runs: a day the program did not meet reports nothing about
    // anybody, including somebody who had not joined yet.
    expect(kindOf(undefined, DAY, ENROLLED_FROM)).toBe("no-session");
    expect(kindOf(undefined, "2026-08-01", ENROLLED_FROM)).toBe("no-session");
  });

  it("is blank before a fellow enrolled, whatever the day holds", () => {
    expect(kindOf({ status: "ABSENT", open: false }, "2026-08-31", ENROLLED_FROM)).toBe(
      "not-enrolled",
    );
    expect(kindOf({ status: null, open: true }, "2026-08-31", ENROLLED_FROM)).toBe("not-enrolled");
  });

  it("draws a stored status even while check-in is still open", () => {
    expect(kindOf({ status: "PRESENT", open: true }, DAY, ENROLLED_FROM)).toBe("PRESENT");
    expect(kindOf({ status: "LATE", open: true }, DAY, ENROLLED_FROM)).toBe("LATE");
    expect(kindOf({ status: "EXCUSED", open: true }, DAY, ENROLLED_FROM)).toBe("EXCUSED");
  });

  it("is open only when nothing has been recorded yet", () => {
    expect(kindOf({ status: null, open: true }, DAY, ENROLLED_FROM)).toBe("open");
  });

  it("is unrecorded once a closed day has nothing written down", () => {
    // Not silently present. The distinction is the one an instructor acts on.
    expect(kindOf({ status: null, open: false }, DAY, ENROLLED_FROM)).toBe("unrecorded");
  });

  it("draws a stored status on a closed day", () => {
    expect(kindOf({ status: "ABSENT", open: false }, DAY, ENROLLED_FROM)).toBe("ABSENT");
  });
});

describe("isMarked", () => {
  /*
    The two blank kinds are blank for the same reason — nothing happened to report — and every
    other kind is something a square has to say out loud. A colour for a day the program never met
    would be the calendar inventing an absence.
  */
  it("is false for the two kinds that stand for nothing having happened", () => {
    expect(isMarked("no-session")).toBe(false);
    expect(isMarked("not-enrolled")).toBe(false);
  });

  it("is true for every kind that reports something, open included", () => {
    for (const kind of ["PRESENT", "LATE", "ABSENT", "EXCUSED", "unrecorded", "open"] as const) {
      expect(isMarked(kind)).toBe(true);
    }
  });
});

describe("CELL", () => {
  /*
    Late is green because it counts as attended, and the wedge rather than the colour is what says
    it was not on time. Amber here would put it beside excused, which does not count. The two
    screens drawing this differently is the bug this shared map exists to prevent.
  */
  it("gives late the same colour as present", () => {
    expect(CELL.LATE.className).toBe(CELL.PRESENT.className);
  });

  it("gives every kind that reports something a label a reader can use", () => {
    for (const kind of ["PRESENT", "LATE", "ABSENT", "EXCUSED", "unrecorded", "open"] as const) {
      expect(CELL[kind].label).not.toBe("");
    }
  });
});
