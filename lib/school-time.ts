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

/** The same, without the weekday, for a column heading where the day is one of many. */
export function formatSchoolDayShort(day: SchoolDay): string {
  return dateColumnFor(day).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
  });
}
