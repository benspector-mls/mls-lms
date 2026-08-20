import { formatSchoolTime } from "@/lib/school-time";

import type { CalendarEvent } from "./ics";

/**
 * What one due date becomes in a student's calendar.
 *
 * The companion to `ics.ts`, and the half that makes decisions: where a deadline's block sits, what
 * its title says, and what identifies it forever. `ics.ts` takes the result and writes it down.
 *
 * No `server-only`, and nothing here reads a database — it is handed a row and returns a record, so
 * every rule below is checkable by a Jest suite.
 */

/** The length of the block, and the grid its edges are rounded onto. */
export const HALF_HOUR_MS = 30 * 60 * 1000;

/**
 * The namespace this application's event identifiers live in.
 *
 * **Nothing fetches this and it is not an address.** RFC 5545 asks that a `UID` be unique across
 * every calendar system in the world rather than merely within one application, and the convention
 * it inherits from email `Message-ID` headers is `local-part@a-domain-you-control`. Naming a domain
 * the school owns is what guarantees these identifiers can never collide with ones minted by
 * Google, by a university's system, or by anything else a student subscribes to. It is a namespace
 * that happens to be spelled as a domain.
 *
 * **A constant, and never the host the request arrived on.** A preview deployment and production
 * run this same code against the same database. Built from the request host, one assignment would
 * be `…@mls-lms-abc123.vercel.app` on one and `…@lms.marcylabschool.org` on the other — two
 * different events as far as any calendar can tell — so a student who subscribed from both would
 * hold a duplicate of every deadline.
 */
export const UID_DOMAIN = "lms.marcylabschool.org";

/**
 * The deadline rounded up to the next half hour, and left alone if it is already on one.
 *
 * **Arithmetic on the instant, which is why it needs no timezone.** The half-hour grid is anchored
 * at the Unix epoch, so a boundary here is a boundary in UTC — and because the school's zone stands
 * a whole number of hours from UTC all year, it is the same boundary on a Brooklyn clock too. A
 * zone offset by forty-five minutes would break that, and there is not one in play.
 *
 * Rounding *up* rather than to the nearest, so the block always contains the moment the work is
 * due. Rounding to the nearest would put a deadline of 5:10 PM inside a block that ended at 5:00,
 * which says the opposite of what it means.
 */
export function endsAtHalfHour(at: Date): Date {
  return new Date(Math.ceil(at.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS);
}

/** The columns of an assignment a calendar event is built from, and nothing else. */
export type DueAssignment = {
  id: string;
  title: string;
  /** Non-null: an assignment without one is not a calendar entry and is filtered out before here. */
  dueAt: Date;
  courseId: string;
  updatedAt: Date;
  course: { name: string };
};

/**
 * One assignment as an event.
 *
 * **A thirty-minute block ending at the deadline.** The event needs a duration at all because a
 * calendar draws a zero-length event as a hairline that is easy to scroll past, and because
 * iCalendar forbids a `DTEND` equal to its `DTSTART`. It runs up to the deadline rather than away
 * from it, because the half hour before something is due is the half hour a student is looking for
 * it. So a deadline of 11:59 PM draws from 11:30 PM to 12:00 AM.
 *
 * **The exact minute is not lost — it is in the title.** `Due at 11:59 PM: Async and Await`, using
 * `formatSchoolTime` so the calendar says a time in the same words the dashboard and the attendance
 * screens do. This is the one place in the feed with a literal time in it, and it is in the school's
 * zone deliberately: the timestamps are UTC so that a calendar can convert them, and text cannot be
 * converted by anything.
 *
 * Two consequences of rounding up, both correct and both worth knowing before somebody reports one
 * as a bug. A deadline of 11:59 PM produces a block whose *end* falls on the following calendar day,
 * which is what puts the block on the due date's own evening where a student is looking for it. And
 * a deadline of exactly midnight produces a block on the previous evening, which is the honest
 * reading of "due at midnight".
 */
export function dueDateEvent({
  assignment,
  origin,
}: {
  assignment: DueAssignment;
  /** Where the feed was fetched from, so the link opens on the host the student is actually using. */
  origin: string;
}): CalendarEvent {
  const end = endsAtHalfHour(assignment.dueAt);
  const start = new Date(end.getTime() - HALF_HOUR_MS);

  /*
    The assignment panel, opened from the course page. A student following this from their calendar
    while signed out lands on the sign-in page and is returned here afterwards, because the proxy
    carries `next` — see `lib/supabase/proxy.ts`.
  */
  const url = `${origin}/courses/${assignment.courseId}?assignment=${assignment.id}`;

  return {
    uid: `${assignment.id}@${UID_DOMAIN}`,
    start,
    end,
    summary: `Due at ${formatSchoolTime(assignment.dueAt)}: ${assignment.title}`,
    /*
      The cohort's name and the link. The cohort matters because this feed spans every course a
      student is in, so "which class is this for" is a real question a title alone cannot answer —
      and prefixing every title with it would be noise for a student in one cohort.

      Deliberately not the score, the status, or whether the work has been handed in. The feed
      address is a credential a student may paste into a shared calendar, forward, or lose, and a
      leaked due date is an inconvenience where a leaked grade is not.
    */
    description: `${assignment.course.name}\n${url}`,
    url,
    lastModified: assignment.updatedAt,
  };
}
