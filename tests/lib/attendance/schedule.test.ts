import {
  SCHEDULE_MAX_DAYS,
  meetingDaysBetween,
  meetsOn,
  nextSchoolDay,
  scheduleDiff,
  scheduleOf,
  type Schedule,
} from "@/lib/attendance/schedule";

/**
 * Which days a program meets, and what changing its mind costs.
 *
 * Pure arithmetic over `"YYYY-MM-DD"` strings. The dates below are real: 2026-09-07 is a Monday,
 * so the week that follows runs Monday 7th to Sunday 13th and every weekday number in these tests
 * can be checked against a calendar rather than taken on trust.
 */

const WEEKDAYS = [1, 2, 3, 4, 5];

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    startsOn: "2026-09-07",
    endsOn: "2026-09-18",
    weekdays: WEEKDAYS,
    startsAt: "09:30",
    ...overrides,
  };
}

describe("nextSchoolDay", () => {
  it("crosses a month boundary", () => {
    expect(nextSchoolDay("2026-09-30")).toBe("2026-10-01");
  });

  it("crosses a year boundary", () => {
    expect(nextSchoolDay("2026-12-31")).toBe("2027-01-01");
  });

  /*
    The 8th of March 2026 is when the clocks go forward in Brooklyn. A day-stepper built on local
    time would either repeat or skip a day here; this one reads UTC parts off a bare date and does
    not care.
  */
  it("is unmoved by daylight saving", () => {
    expect(nextSchoolDay("2026-03-07")).toBe("2026-03-08");
    expect(nextSchoolDay("2026-03-08")).toBe("2026-03-09");
  });
});

describe("scheduleOf", () => {
  it("reads the four columns into one value", () => {
    expect(
      scheduleOf({
        attendanceStartsOn: new Date("2026-09-07T00:00:00Z"),
        attendanceEndsOn: new Date("2026-09-18T00:00:00Z"),
        attendanceWeekdays: WEEKDAYS,
        attendanceStartsAt: "09:30",
      }),
    ).toEqual(schedule());
  });

  /*
    Prisma hands a `@db.Date` back as UTC midnight, and reading its local parts on any machine west
    of UTC gives the day before. A schedule that began on the 6th rather than the 7th would make a
    session for a Sunday the program does not meet.
  */
  it("reads the civil date rather than the local one", () => {
    const read = scheduleOf({
      attendanceStartsOn: new Date("2026-09-07T00:00:00Z"),
      attendanceEndsOn: new Date("2026-09-18T00:00:00Z"),
      attendanceWeekdays: WEEKDAYS,
      attendanceStartsAt: "09:30",
    });
    expect(read?.startsOn).toBe("2026-09-07");
  });

  it("is null when the program has no schedule", () => {
    expect(
      scheduleOf({
        attendanceStartsOn: null,
        attendanceEndsOn: null,
        attendanceWeekdays: [],
        attendanceStartsAt: null,
      }),
    ).toBeNull();
  });
});

describe("meetsOn", () => {
  it("is true on a weekday inside the range", () => {
    expect(meetsOn(schedule(), "2026-09-07")).toBe(true);
    expect(meetsOn(schedule(), "2026-09-11")).toBe(true);
  });

  it("is false at the weekend", () => {
    expect(meetsOn(schedule(), "2026-09-12")).toBe(false);
    expect(meetsOn(schedule(), "2026-09-13")).toBe(false);
  });

  // Both ends are inclusive. A program that runs "to the 18th" meets on the 18th.
  it("includes both ends of the range", () => {
    expect(meetsOn(schedule(), "2026-09-07")).toBe(true);
    expect(meetsOn(schedule(), "2026-09-18")).toBe(true);
    expect(meetsOn(schedule(), "2026-09-04")).toBe(false);
    expect(meetsOn(schedule(), "2026-09-21")).toBe(false);
  });

  it("honours a program that does not meet every weekday", () => {
    const fourDays = schedule({ weekdays: [1, 2, 3, 4] });
    expect(meetsOn(fourDays, "2026-09-10")).toBe(true);
    expect(meetsOn(fourDays, "2026-09-11")).toBe(false);
  });
});

describe("meetingDaysBetween", () => {
  it("lists the meeting days in order", () => {
    expect(meetingDaysBetween(schedule(), "2026-09-07", "2026-09-18")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  // The bounds narrow the schedule; they never widen it.
  it("is clipped by the schedule at both ends", () => {
    expect(meetingDaysBetween(schedule(), "2026-08-01", "2026-12-31")).toHaveLength(10);
    expect(meetingDaysBetween(schedule(), "2026-09-16", "2026-12-31")).toEqual([
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  it("is empty when the bounds cross", () => {
    expect(meetingDaysBetween(schedule(), "2026-09-18", "2026-09-07")).toEqual([]);
  });

  it("refuses a span longer than the cap rather than running forever", () => {
    const forever = schedule({ startsOn: "2026-01-01", endsOn: "2400-01-01" });
    expect(() => meetingDaysBetween(forever, "2026-01-01", "2400-01-01")).toThrow(
      `longer than ${SCHEDULE_MAX_DAYS} days`,
    );
  });
});

describe("scheduleDiff", () => {
  const today = "2026-09-09";

  it("makes every meeting day from today when there was no schedule", () => {
    expect(scheduleDiff(null, schedule(), today)).toEqual({
      make: [
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
      ],
      remove: [],
    });
  });

  // Saving the same schedule twice is the common case and must be a no-op.
  it("changes nothing when the schedule is unchanged", () => {
    expect(scheduleDiff(schedule(), schedule(), today)).toEqual({ make: [], remove: [] });
  });

  it("makes only the new stretch when the end moves out", () => {
    const longer = schedule({ endsOn: "2026-09-23" });
    expect(scheduleDiff(schedule(), longer, today)).toEqual({
      make: ["2026-09-21", "2026-09-22", "2026-09-23"],
      remove: [],
    });
  });

  it("removes only the days now outside the range when the end moves in", () => {
    const shorter = schedule({ endsOn: "2026-09-15" });
    expect(scheduleDiff(schedule(), shorter, today)).toEqual({
      make: [],
      remove: ["2026-09-16", "2026-09-17", "2026-09-18"],
    });
  });

  it("makes only the added weekday", () => {
    const withSaturday = schedule({ weekdays: [1, 2, 3, 4, 5, 6] });
    expect(scheduleDiff(schedule(), withSaturday, today)).toEqual({
      make: ["2026-09-12"],
      remove: [],
    });
  });

  it("removes only the dropped weekday", () => {
    const withoutFriday = schedule({ weekdays: [1, 2, 3, 4] });
    expect(scheduleDiff(schedule(), withoutFriday, today)).toEqual({
      make: [],
      remove: ["2026-09-11", "2026-09-18"],
    });
  });

  /*
    The whole reason the diff takes the previous schedule rather than working from the new one
    alone. A day an instructor removed as a holiday is a meeting day under both schedules, so it is
    in neither list and a later save never brings it back.
  */
  it("leaves a day that both schedules meet on alone", () => {
    const laterStart = schedule({ startsAt: "10:00" });
    expect(scheduleDiff(schedule(), laterStart, today)).toEqual({ make: [], remove: [] });
  });

  // Today is made but never removed: today's session may already hold check-ins.
  it("never removes today", () => {
    const withoutWednesday = schedule({ weekdays: [1, 2, 4, 5] });
    const diff = scheduleDiff(schedule(), withoutWednesday, today);
    expect(diff.remove).not.toContain(today);
    expect(diff.remove).toEqual(["2026-09-16"]);
  });

  it("removes everything ahead when the schedule is cleared", () => {
    expect(scheduleDiff(schedule(), null, today)).toEqual({
      make: [],
      remove: [
        "2026-09-10",
        "2026-09-11",
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
      ],
    });
  });

  it("does nothing at all when there is no schedule either side", () => {
    expect(scheduleDiff(null, null, today)).toEqual({ make: [], remove: [] });
  });
});
