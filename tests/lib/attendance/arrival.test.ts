import { arrivalAverages, arrivalSentence, MIN_ARRIVALS } from "@/lib/attendance/arrival";

/**
 * When a fellow arrives, and the four ways this could print a wrong number.
 *
 * The figures are checked against instants written in UTC, because that is what the database hands
 * back and what a wrong timezone conversion would show up in. Brooklyn is four hours behind UTC in
 * September, so `13:04Z` is a 9:04 arrival.
 */

/** 14 September 2026 is a Monday, so the weekdays below are chosen rather than assumed. */
const MONDAY = "2026-09-14";
const TUESDAY = "2026-09-15";
const NEXT_MONDAY = "2026-09-21";
const MONDAY_AFTER = "2026-09-28";

/** An arrival at a given wall-clock time in Brooklyn on a given school day. */
const at = (day: string, hours: number, minutes: number) => ({
  day,
  // September is EDT, four hours behind UTC.
  checkedInAt: new Date(
    `${day}T${String(hours + 4).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`,
  ),
});

describe("the overall average", () => {
  it("is the mean of the arrival times, in the school's timezone", () => {
    const averages = arrivalAverages([
      at(MONDAY, 9, 0),
      at(TUESDAY, 9, 10),
      at(NEXT_MONDAY, 9, 20),
    ]);

    // 9:00, 9:10, 9:20 → 9:10, which is 550 minutes after midnight.
    expect(averages.overall.minutes).toBe(550);
    expect(averages.overall.count).toBe(3);
  });

  it("reports no average below the minimum, and still says how many there were", () => {
    const averages = arrivalAverages([at(MONDAY, 9, 0), at(TUESDAY, 9, 10)]);

    // Two arrivals is not a habit. The count is still reported, because "not enough yet" and
    // "nobody has ever checked in" are different things for a screen to say.
    expect(MIN_ARRIVALS).toBe(3);
    expect(averages.overall.minutes).toBeNull();
    expect(averages.overall.count).toBe(2);
  });

  it("is null over no arrivals at all", () => {
    expect(arrivalAverages([]).overall).toEqual({ minutes: null, count: 0 });
  });
});

describe("by weekday", () => {
  it("names every weekday, Monday first, whether or not it has arrivals", () => {
    const averages = arrivalAverages([at(MONDAY, 9, 0)]);

    expect(averages.byWeekday.map((entry) => entry.label)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  it("averages each weekday over its own arrivals", () => {
    const averages = arrivalAverages([
      at(MONDAY, 10, 30),
      at(NEXT_MONDAY, 10, 40),
      at(MONDAY_AFTER, 10, 50),
      at(TUESDAY, 9, 0),
      at(TUESDAY, 9, 0),
      at(TUESDAY, 9, 0),
    ]);

    const monday = averages.byWeekday.find((entry) => entry.label === "Monday")!;
    const tuesday = averages.byWeekday.find((entry) => entry.label === "Tuesday")!;

    expect(monday.average.minutes).toBe(10 * 60 + 40);
    expect(tuesday.average.minutes).toBe(9 * 60);
  });

  it("holds a weekday to the same minimum as the overall figure", () => {
    // Three arrivals overall, but only two on any one Monday-or-Tuesday, so the overall average
    // exists and neither weekday's does. That asymmetry is the point: a term-long mean says
    // something after three mornings and a Monday mean does not.
    const averages = arrivalAverages([
      at(MONDAY, 9, 0),
      at(NEXT_MONDAY, 9, 10),
      at(TUESDAY, 9, 20),
    ]);

    expect(averages.overall.minutes).toBe(9 * 60 + 10);
    expect(
      averages.byWeekday.find((entry) => entry.label === "Monday")!.average.minutes,
    ).toBeNull();
  });

  /*
    The rule this exists for. A check-in a few minutes after midnight is an instant whose weekday in
    the school's zone is the *previous* day, so a function reading the weekday off the arrival time
    would file this morning under Sunday. The session's day is what the school means.
  */
  it("takes the weekday from the session's day, not from the arrival time", () => {
    const justAfterMidnight = {
      day: MONDAY,
      // 00:10 on Monday in Brooklyn is 04:10Z the same day; read as UTC it is still Monday, but a
      // reader in another zone or one using the local parts could land on Sunday.
      checkedInAt: new Date(`${MONDAY}T04:10:00Z`),
    };

    const averages = arrivalAverages([justAfterMidnight, justAfterMidnight, justAfterMidnight]);

    expect(averages.byWeekday.find((entry) => entry.label === "Monday")!.average.count).toBe(3);
    expect(averages.byWeekday.find((entry) => entry.label === "Sunday")!.average.count).toBe(0);
  });
});

describe("the sentence a screen prints", () => {
  it("names the weekday furthest from the overall average", () => {
    const averages = arrivalAverages([
      at(MONDAY, 10, 45),
      at(NEXT_MONDAY, 10, 45),
      at(MONDAY_AFTER, 10, 45),
      at(TUESDAY, 9, 0),
      at("2026-09-22", 9, 0),
      at("2026-09-29", 9, 0),
    ]);

    // Three at 10:45 and three at 9:00 is a mean of 592.5 minutes, which rounds up to 9:53.
    // The rounding is the reason this is checked against a printed string rather than a number.
    expect(arrivalSentence(averages)).toBe(
      "On average they check in at 9:53 AM, but on Mondays at 10:45 AM.",
    );
  });

  it("says one clause when no weekday drifts, because there is nothing about the week to say", () => {
    const averages = arrivalAverages([
      at(MONDAY, 9, 0),
      at(NEXT_MONDAY, 9, 1),
      at(MONDAY_AFTER, 9, 2),
      at(TUESDAY, 9, 0),
      at("2026-09-22", 9, 1),
      at("2026-09-29", 9, 2),
    ]);

    expect(arrivalSentence(averages)).toBe("On average they check in at 9:01 AM.");
  });

  it("is null when there is not enough to divide, rather than saying so in words", () => {
    // The absence of a figure is not itself a finding, so the screen renders nothing.
    expect(arrivalSentence(arrivalAverages([at(MONDAY, 9, 0)]))).toBeNull();
    expect(arrivalSentence(arrivalAverages([]))).toBeNull();
  });
});
