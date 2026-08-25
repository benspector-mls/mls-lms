import { z } from "zod";

/**
 * Which day it is, in Brooklyn.
 *
 * **This file exists because attendance introduced the first question in the application that a
 * timestamp cannot answer.** Everything else here happens at a moment — a submission, a grade, a
 * test run — and a moment is a `Timestamptz(6)` that every reader agrees about. A school day is
 * not a moment. It is a name for a Tuesday, it is what `attendance_sessions` is unique on, and it
 * is what every report groups by.
 *
 * The zone was a private constant in `lib/status.ts` while it only decided how a due date was
 * printed. It lives here now because it decides what gets *stored*, and because `status.ts` is
 * imported by client components — so this module deliberately carries no `server-only`.
 *
 * **The trap this closes, which is the whole reason to have one module rather than four call
 * sites.** Prisma maps a `@db.Date` column to a JavaScript `Date` at UTC midnight. Send that to a
 * browser in New York and `2026-09-14` renders as "Sep 13", because UTC midnight is 8pm the
 * previous evening there. The rule that prevents it: **a school day crosses the wire as a
 * `"YYYY-MM-DD"` string, never as a `Date`.** The `Date` object exists only between Prisma and the
 * two conversions below.
 */

export const SCHOOL_TIME_ZONE = "America/New_York";

/**
 * A civil date in the school's timezone, written `"YYYY-MM-DD"`.
 *
 * A branded-in-spirit string rather than a type: it is what goes in a URL segment, in a procedure
 * input, in a CSV cell, and in a React key, and every one of those wants a string.
 */
export type SchoolDay = string;

/** `"2026-09-14"` and nothing else. What every procedure taking a day validates with. */
export const schoolDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A school day looks like 2026-09-14.")
  .refine((value) => {
    // Rejects "2026-02-31", which the pattern above is happy with. Round-tripping through the
    // column conversion is the cheapest correct check: an invalid day normalizes to a different
    // one, and a different one is not equal to what came in.
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "That is not a real date.");

/**
 * Which school day an instant falls on.
 *
 * `en-CA` because it is the locale that formats as `YYYY-MM-DD`, which saves assembling the parts
 * by hand from `Intl.DateTimeFormat().formatToParts`. The timezone is the point of the call.
 */
export function schoolDayOf(now: Date): SchoolDay {
  return now.toLocaleDateString("en-CA", { timeZone: SCHOOL_TIME_ZONE });
}

/**
 * A clock time in the school's timezone, written `"23:59"` on the 24-hour clock.
 *
 * The companion to `SchoolDay`, and a string for the same reasons: it is what an
 * `<input type="time">` reads and writes, and holding it as anything else means converting twice.
 */
export type SchoolClock = string;

/** Eleven fifty-nine at night, which is when an assignment is due unless somebody says otherwise. */
export const END_OF_DAY: SchoolClock = "23:59";

/**
 * What time it is in Brooklyn at a given instant, as `"23:59"`.
 *
 * `en-GB` with `hourCycle: "h23"` because that pair formats midnight as `"00:00"` rather than
 * `"24:00"`, and because a time input refuses anything but two-digit 24-hour parts.
 */
export function schoolClockOf(at: Date): SchoolClock {
  return at.toLocaleTimeString("en-GB", {
    timeZone: SCHOOL_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How far the school's clock stands from UTC at a given instant, in milliseconds.
 *
 * Negative all year — Brooklyn is four hours behind UTC in summer and five in winter — and it is
 * measured rather than assumed, because which of the two applies depends on the instant.
 */
function schoolOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);

  const wallClockAsIfUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );

  return wallClockAsIfUtc - at.getTime();
}

/**
 * The instant a wall clock in Brooklyn names. `"2026-08-25"` at `"23:59"` is `03:59Z` the next day.
 *
 * **This is what a due date is set with, and the reason it exists is that a due date is displayed
 * in the school's timezone by `formatDueDate` but was previously *built* in the browser's.** For an
 * instructor in Brooklyn the two agree; for one on a laptop still set to another zone they do not,
 * and the deadline a student reads is then an hour or three from the one the instructor chose.
 *
 * The offset is measured twice: once against the wall clock read as though it were UTC, and again
 * against the instant that first reading produces. One pass is wrong for the few hours either side
 * of a daylight-saving change, because the offset that applies is the one at the instant rather
 * than the one at the wall clock.
 */
export function instantAtSchoolClock(day: SchoolDay, clock: SchoolClock): Date {
  const wallClockAsIfUtc = Date.parse(`${day}T${clock}:00Z`);
  const approximation = wallClockAsIfUtc - schoolOffsetMs(new Date(wallClockAsIfUtc));
  return new Date(wallClockAsIfUtc - schoolOffsetMs(new Date(approximation)));
}

/**
 * The value to hand Prisma for a `@db.Date` column.
 *
 * UTC midnight of that civil date, which is how Prisma and Postgres represent a bare date. It is
 * *not* midnight in Brooklyn and must not be — a `date` column has no zone, and treating this
 * return value as a real instant is exactly the mistake this module is here to prevent.
 */
export function dateColumnFor(day: SchoolDay): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * The inverse, for a row Prisma just returned.
 *
 * Reads the UTC parts, never the local ones. `toISOString().slice(0, 10)` rather than
 * `getFullYear()` and friends, because those read the *server's* zone and would return the
 * previous day on any machine west of UTC — which is every machine this runs on.
 */
export function schoolDayFromColumn(column: Date): SchoolDay {
  return column.toISOString().slice(0, 10);
}

/**
 * A school day as a person would say it. "Friday, Sep 14".
 *
 * Takes the string rather than a `Date` so that callers never have to hold the dangerous shape.
 * The weekday leads because that is how somebody thinks about a class day — the same reasoning
 * `formatDueDate` gives in `lib/status.ts`.
 */
export function formatSchoolDay(day: SchoolDay): string {
  return dateColumnFor(day).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * A clock time in Brooklyn. "9:02 AM".
 *
 * The attendance screens all want this and nothing else — a check-in has a date already, from the
 * session it belongs to, so repeating it beside the time is noise. It lives here rather than in
 * `lib/status.ts` because it is the zone that makes it correct, and three components had begun
 * writing `timeZone: "America/New_York"` out by hand, which is one edit away from disagreeing.
 */
export function formatSchoolTime(at: Date): string {
  return at.toLocaleTimeString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Which weekday a school day falls on, 0 for Sunday through 6 for Saturday.
 *
 * **Read from the civil date rather than from any instant**, which is the whole reason it is here
 * rather than written out at the two call sites that want it. A check-in a few minutes after
 * midnight is a `Timestamptz` whose weekday in the school's zone is the previous day's, so deriving
 * the weekday from the arrival time would file that morning under Sunday. The session's `date` column
 * is the day the school means, and this reads that.
 *
 * `getUTCDay` rather than `getDay`, for the reason `schoolDayFromColumn` reads the UTC parts: the
 * `Date` this builds is UTC midnight of a bare date, and the local reading would be the day before on
 * every machine west of UTC — which is every machine this runs on.
 */
export function weekdayOf(day: SchoolDay): number {
  return dateColumnFor(day).getUTCDay();
}

/** A weekday as a person would say it. "Monday". */
export function formatWeekday(weekday: number): string {
  // The 4th of January 1970 was a Sunday, so adding the weekday lands on the day wanted.
  return new Date(Date.UTC(1970, 0, 4 + weekday)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
  });
}

/** Every weekday, Monday first, because that is the order a school week is read in. */
export const SCHOOL_WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * How far into the school's day an instant falls, in minutes after midnight.
 *
 * The form an average of arrival times has to be computed in: minutes are a number that can be
 * meaned, where a `Date` is not and a `"09:04"` string is not. It goes through `schoolClockOf` rather
 * than reading the parts itself, so there is one definition of what time it is in Brooklyn.
 */
export function minutesAfterMidnight(at: Date): number {
  const [hours, minutes] = schoolClockOf(at).split(":");
  return Number(hours) * 60 + Number(minutes);
}

/**
 * The inverse, for printing an average. 620 becomes "10:20 AM".
 *
 * **It formats a duration rather than an instant, which is why it does not go through
 * `formatSchoolTime`.** An average arrival time is not a moment that happened — nobody arrived at
 * 10:20 — so there is no instant to convert, and building one out of an arbitrary date only to format
 * it back would introduce a timezone into a number that has none.
 *
 * Rounded to the nearest minute on the way in, because a mean of clock times is fractional and
 * "10:20 AM" is what somebody can act on where "10:20:34.8 AM" is noise.
 */
export function formatClockMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hours24 = Math.floor(total / 60) % 24;
  const mins = total % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** The same, without the weekday, for a column heading where the day is one of many. */
export function formatSchoolDayShort(day: SchoolDay): string {
  return dateColumnFor(day).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
  });
}
