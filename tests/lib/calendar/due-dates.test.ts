import { dueDateEvent, endsAtHalfHour, HALF_HOUR_MS, UID_DOMAIN } from "@/lib/calendar/due-dates";

/**
 * What one deadline becomes.
 *
 * Every deadline below is written as the UTC instant a Brooklyn wall clock names, because that is
 * what the column holds. `2026-10-10T03:59:00Z` is 11:59 PM on 9 October in Brooklyn, which is the
 * default an instructor gets from the authoring form and therefore the case that matters most.
 */

/** The instant a Brooklyn clock reading `hh:mm` on a given day names, during daylight time. */
const edt = (iso: string) => new Date(`${iso}-04:00`);
/** The same, during standard time. */
const est = (iso: string) => new Date(`${iso}-05:00`);

/** What a calendar would print for an instant, in Brooklyn, so the assertions read as clock times. */
const brooklyn = (at: Date) =>
  at.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const assignment = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Async and Await",
  dueAt: edt("2026-10-09T23:59:00"),
  courseId: "22222222-2222-4222-8222-222222222222",
  updatedAt: edt("2026-10-01T09:00:00"),
  course: { name: "Software Engineering Fall 2026" },
};

const eventFor = (dueAt: Date) =>
  dueDateEvent({ assignment: { ...assignment, dueAt }, origin: "https://lms.example.org" });

describe("endsAtHalfHour", () => {
  it("rounds 11:59 PM up to midnight, which is the case the rule exists for", () => {
    expect(brooklyn(endsAtHalfHour(edt("2026-10-09T23:59:00")))).toBe("Oct 10, 12:00 AM");
  });

  it("leaves a deadline already on a half hour alone", () => {
    expect(brooklyn(endsAtHalfHour(edt("2026-10-09T17:00:00")))).toBe("Oct 9, 5:00 PM");
    expect(brooklyn(endsAtHalfHour(edt("2026-10-09T17:30:00")))).toBe("Oct 9, 5:30 PM");
  });

  it("rounds a minute past a boundary up to the next one", () => {
    expect(brooklyn(endsAtHalfHour(edt("2026-10-09T17:31:00")))).toBe("Oct 9, 6:00 PM");
    expect(brooklyn(endsAtHalfHour(edt("2026-10-09T17:01:00")))).toBe("Oct 9, 5:30 PM");
  });

  it("lands on a half-hour boundary of the Brooklyn clock, not merely of UTC", () => {
    // True only because the school's zone stands a whole number of hours from UTC. A zone offset by
    // forty-five minutes would fail this, which is why the module says so rather than assuming it.
    for (const minute of [0, 1, 7, 29, 30, 31, 45, 59]) {
      const rounded = endsAtHalfHour(edt(`2026-10-09T17:${String(minute).padStart(2, "0")}:00`));
      expect(rounded.getTime() % HALF_HOUR_MS).toBe(0);
      expect(brooklyn(rounded)).toMatch(/:(00|30) PM$/);
    }
  });

  it("is unaffected by daylight saving, on both sides of both changes", () => {
    // Spring forward, 8 March 2026: 2 AM becomes 3 AM.
    expect(brooklyn(endsAtHalfHour(est("2026-03-08T01:10:00")))).toBe("Mar 8, 1:30 AM");
    expect(brooklyn(endsAtHalfHour(edt("2026-03-08T03:10:00")))).toBe("Mar 8, 3:30 AM");
    // Fall back, 1 November 2026: 2 AM becomes 1 AM.
    expect(brooklyn(endsAtHalfHour(edt("2026-11-01T01:10:00")))).toBe("Nov 1, 1:30 AM");
    expect(brooklyn(endsAtHalfHour(est("2026-11-01T01:10:00")))).toBe("Nov 1, 1:30 AM");
  });
});

describe("dueDateEvent", () => {
  it("draws an 11:59 PM deadline from 11:30 PM to midnight", () => {
    const event = eventFor(edt("2026-10-09T23:59:00"));

    expect(brooklyn(event.start)).toBe("Oct 9, 11:30 PM");
    expect(brooklyn(event.end)).toBe("Oct 10, 12:00 AM");
  });

  it("ends a 5:00 PM deadline at 5:00 PM rather than pushing it to 5:30", () => {
    const event = eventFor(edt("2026-10-09T17:00:00"));

    expect(brooklyn(event.start)).toBe("Oct 9, 4:30 PM");
    expect(brooklyn(event.end)).toBe("Oct 9, 5:00 PM");
  });

  it("is always exactly half an hour long", () => {
    for (const minute of [0, 1, 14, 29, 30, 31, 44, 59]) {
      const event = eventFor(edt(`2026-10-09T21:${String(minute).padStart(2, "0")}:00`));
      expect(event.end.getTime() - event.start.getTime()).toBe(HALF_HOUR_MS);
    }
  });

  it("puts the real minute in the title, never the rounded one", () => {
    expect(eventFor(edt("2026-10-09T23:59:00")).summary).toBe("Due at 11:59 PM: Async and Await");
    expect(eventFor(edt("2026-10-09T17:01:00")).summary).toBe("Due at 5:01 PM: Async and Await");
  });

  it("says the time on the school's clock, not the machine's", () => {
    // The instant below is 4:07 PM in Brooklyn and a different hour almost everywhere else. A title
    // built from the server's local time would drift with wherever the function happened to run.
    expect(eventFor(edt("2026-10-09T16:07:00")).summary).toContain("4:07 PM");
  });

  it("names the same assignment the same way every time", () => {
    const first = eventFor(edt("2026-10-09T23:59:00"));
    const moved = eventFor(edt("2026-10-16T17:00:00"));

    // The whole reason the UID exists: a moved deadline must update one event rather than add a
    // second. Nothing about the event other than the assignment's identity may enter it.
    expect(first.uid).toBe(`${assignment.id}@${UID_DOMAIN}`);
    expect(moved.uid).toBe(first.uid);
  });

  it("links to the assignment on the host the feed was fetched from", () => {
    const event = dueDateEvent({ assignment, origin: "https://preview.example.dev" });

    expect(event.url).toBe(
      `https://preview.example.dev/courses/${assignment.courseId}?assignment=${assignment.id}`,
    );
    // The UID must not follow the host, or subscribing from two deployments duplicates everything.
    expect(event.uid).toBe(`${assignment.id}@${UID_DOMAIN}`);
  });

  it("puts the course's name and the link in the description, and nothing else", () => {
    const event = eventFor(edt("2026-10-09T23:59:00"));

    expect(event.description).toBe(`${assignment.course.name}\n${event.url}`);
  });
});
