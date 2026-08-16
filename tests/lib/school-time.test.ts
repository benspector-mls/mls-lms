import {
  dateColumnFor,
  formatSchoolDay,
  schoolDayFromColumn,
  schoolDayOf,
  schoolDaySchema,
} from "@/lib/school-time";

/**
 * Which day it is, in Brooklyn.
 *
 * **The highest-value suite in the attendance feature**, because every bug it guards against looks
 * like a display glitch and is actually a wrong compliance number. A session filed under the wrong
 * day is a fellow marked absent for a morning they attended, in a figure somebody is paid against.
 *
 * `now` is a fixed instant in every case rather than a mocked clock — the same reasoning
 * `dashboard.test.ts` gives, and the reason these functions take it as an argument.
 */

describe("schoolDayOf", () => {
  it("is still Sunday at 11pm in Brooklyn, when UTC has already moved on", () => {
    // 03:00 UTC Monday is 23:00 Sunday in New York. This single case is why the module exists:
    // reading the server's own date here would file a Sunday evening under Monday.
    expect(schoolDayOf(new Date("2026-09-14T03:00:00Z"))).toBe("2026-09-13");
  });

  it("has turned over by 9am in Brooklyn", () => {
    expect(schoolDayOf(new Date("2026-09-14T13:00:00Z"))).toBe("2026-09-14");
  });

  it("is right either side of the boundary on an ordinary day", () => {
    // 03:59 UTC is 23:59 the previous evening; 04:00 UTC is midnight.
    expect(schoolDayOf(new Date("2026-09-15T03:59:00Z"))).toBe("2026-09-14");
    expect(schoolDayOf(new Date("2026-09-15T04:00:00Z"))).toBe("2026-09-15");
  });

  it("follows the clocks forward in March", () => {
    // 2026-03-08 is when the United States moves to daylight time. The offset goes from -5 to -4,
    // so midnight arrives an hour earlier in UTC terms from that day on.
    expect(schoolDayOf(new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07");
    expect(schoolDayOf(new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(schoolDayOf(new Date("2026-03-09T03:59:00Z"))).toBe("2026-03-08");
    expect(schoolDayOf(new Date("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
  });

  it("follows the clocks back in November", () => {
    // 2026-11-01 is the return to standard time: -4 becomes -5.
    expect(schoolDayOf(new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(schoolDayOf(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(schoolDayOf(new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01");
    expect(schoolDayOf(new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });
});

describe("the date column round trip", () => {
  it("hands Prisma UTC midnight", () => {
    expect(dateColumnFor("2026-09-14").toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("survives a round trip on every day of a term, including both DST boundaries", () => {
    const days: string[] = [];
    // A full year, so both daylight-saving boundaries are inside the range rather than one.
    for (let offset = 0; offset < 365; offset += 1) {
      const day = schoolDayFromColumn(new Date(Date.UTC(2026, 0, 1 + offset)));
      days.push(day);
      expect(schoolDayFromColumn(dateColumnFor(day))).toBe(day);
    }

    // Both boundaries are inside that range, which is what makes the loop worth running rather
    // than a handful of hand-picked dates.
    expect(days).toContain("2026-03-08");
    expect(days).toContain("2026-11-01");
  });

  it("reads the UTC parts, not the running machine's", () => {
    // A column at UTC midnight is the previous evening in every zone west of Greenwich. Reading
    // `getFullYear()` and friends here would return the day before on every machine this runs on.
    expect(schoolDayFromColumn(new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
  });
});

describe("schoolDaySchema", () => {
  it("accepts a real date", () => {
    expect(schoolDaySchema.safeParse("2026-09-14").success).toBe(true);
  });

  it.each(["2026-9-14", "14/09/2026", "", "2026-09-14T00:00:00Z", "tomorrow"])(
    "rejects %p",
    (value) => {
      expect(schoolDaySchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects a date that matches the pattern but does not exist", () => {
    // The regular expression is happy with this; the round-trip check is what catches it.
    expect(schoolDaySchema.safeParse("2026-02-31").success).toBe(false);
    expect(schoolDaySchema.safeParse("2026-13-01").success).toBe(false);
  });
});

describe("formatSchoolDay", () => {
  it("names the weekday, and names it from the civil date rather than from a zone", () => {
    // 2026-09-14 is a Monday. Formatted through a local `Date` this would read as Sunday on any
    // machine west of UTC — the same bug the storage rules exist to prevent, in the display half.
    expect(formatSchoolDay("2026-09-14")).toBe("Monday, Sep 14");
  });
});
