/**
 * iCalendar, and only as much of it as one feed of due dates needs.
 *
 * **This module knows nothing about assignments.** It is handed events and it writes them down;
 * what a deadline should look like — where its block starts, what its title says — is decided in
 * `due-dates.ts`. The seam is there because the two halves fail differently: a mistake here
 * produces a document no calendar will parse, and a mistake there produces a document that parses
 * and says the wrong thing. Testing them apart is what tells the two failures from one another.
 *
 * No `server-only`. Everything here decides its answer from its arguments, which is what lets the
 * whole format be checked by a Jest suite that touches no database and no network.
 *
 * The format is RFC 5545. Three of its rules are the only ones that ever bite in practice, and all
 * three are silent rather than loud — a feed that breaks them is accepted by some clients and
 * quietly mangled by others, so each one is its own function below with its own test.
 */

/**
 * A line break in iCalendar is CRLF, always, and not the platform's.
 *
 * A feed written with bare newlines is accepted by Google and refused by others, which is the worst
 * of the three failure modes: it works everywhere it is tested and breaks for one student.
 */
const CRLF = "\r\n";

/** RFC 5545 section 3.1: a line is at most 75 octets before it must be folded. */
const MAX_OCTETS = 75;

/**
 * How the feed names itself in a calendar's sidebar, rather than appearing there as a URL.
 *
 * Written twice below, as `NAME` and as `X-WR-CALNAME`, because clients are split on which they
 * read. `X-WR-CALNAME` is an Apple convention that predates any standard and is what most clients
 * grew up on; `NAME` is the property RFC 7986 added to replace it. Emitting one risks a client that
 * only knows the other, and the cost of both is a line.
 *
 * **A client is free to ignore both.** Google Calendar in particular names a URL subscription after
 * its address and leaves renaming to the person who added it — so a calendar called
 * `https://…/api/calendar/…` is Google's behaviour rather than a missing property, and the fix is
 * the pencil in Google's own sidebar.
 */
export const CALENDAR_NAME = "Marcy Lab School — due dates";

/** The sentence under the name, where a client shows one. Same split, same two spellings. */
const CALENDAR_DESCRIPTION =
  "Assignment due dates from the Marcy Lab School LMS. Titles and deadlines only.";

/** Who generated the document. Convention is `-//organisation//product//language`. */
const PRODUCT_ID = "-//Marcy Lab School//LMS due dates//EN";

/**
 * How often a client is asked to come back. Twelve hours is a request rather than a rule — Google
 * polls a subscribed feed on its own schedule, which is roughly daily, and no property here
 * changes that. It is stated because a client that does honour it should honour something sane.
 */
const REFRESH_INTERVAL = "PT12H";

/**
 * One event, ready to be written down.
 *
 * Every field is supplied by the caller, which is the property the "no score, no status" test in
 * `tests/lib/calendar/ics.test.ts` rests on: this module cannot disclose a fact about a submission
 * because it is never given one.
 */
export type CalendarEvent = {
  /** The permanent name of this event. See `due-dates.ts` for what depends on it never changing. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  /** An address, written as a URI value and therefore deliberately not escaped. */
  url: string;
  /** When the underlying assignment last changed, which is what says an event was revised. */
  lastModified: Date;
};

/**
 * A text value, with the four characters that mean something to a parser escaped.
 *
 * RFC 5545 section 3.3.11. The backslash is replaced first, or every escape added afterwards would
 * be escaped again by the pass that was meant to precede it.
 *
 * This is not fussiness about a hypothetical title. `Arrays, objects; and JSON` is the shape of a
 * real assignment name in this curriculum, and an unescaped comma inside a `SUMMARY` is read as
 * the end of one value and the start of another.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Shared by the folding below, and by the tests that check it counted the right thing. */
const encoder = new TextEncoder();

/**
 * One logical line, folded so no physical line exceeds 75 octets.
 *
 * A fold is CRLF followed by a single space, and the space is not part of the value — a parser
 * removes it when it joins the line back up.
 *
 * **Octets, not characters, and that is the whole difficulty.** A `String.length` of 75 can be 200
 * bytes of UTF-8, and folding by character count would leave a physical line over the limit; worse,
 * slicing a string by index can cut a surrogate pair in half and produce a byte sequence that is
 * not valid UTF-8 at all. So this walks code points — `for...of` over a string yields whole code
 * points rather than UTF-16 units — and measures each one before deciding whether it still fits.
 *
 * The em dash in this calendar's own name is three octets, so the very first line of every feed
 * this application produces already exercises the difference.
 */
export function foldLine(line: string): string {
  const physical: string[] = [];
  let current = "";
  let octets = 0;
  // The first physical line may fill all 75. Every one after it spends an octet on the leading
  // space that marks it as a continuation, so its content may only be 74.
  let limit = MAX_OCTETS;

  for (const character of line) {
    const size = encoder.encode(character).length;

    if (octets + size > limit) {
      physical.push(current);
      current = "";
      octets = 0;
      limit = MAX_OCTETS - 1;
    }

    current += character;
    octets += size;
  }

  physical.push(current);
  return physical.join(`${CRLF} `);
}

/**
 * An instant as iCalendar writes UTC: `20261009T235900Z`.
 *
 * The trailing `Z` is what makes this a UTC value rather than a floating local time, and it is the
 * reason this feed needs no `VTIMEZONE` block and cannot be misread. The calendar application
 * converts it to whatever zone the reader is in, so a deadline set at 11:59 PM in Brooklyn shows as
 * 11:59 PM in Brooklyn and as the same instant everywhere else.
 */
export function icsTimestamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** One event's properties, in the order a reader of the raw file would want to find them. */
function eventLines(event: CalendarEvent, now: Date): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    // When this copy of the document was generated, which is required and is not a property of the
    // event. `LAST-MODIFIED` is the one that says whether the event itself changed.
    `DTSTAMP:${icsTimestamp(now)}`,
    `LAST-MODIFIED:${icsTimestamp(event.lastModified)}`,
    `DTSTART:${icsTimestamp(event.start)}`,
    `DTEND:${icsTimestamp(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    // Not escaped, deliberately: a URI is its own value type in RFC 5545 and takes none of the
    // TEXT escapes. Running `escapeText` over an address would put backslashes into a link.
    `URL:${event.url}`,
    "END:VEVENT",
  ];
}

/**
 * The whole document.
 *
 * **No `METHOD` property.** A feed carrying `METHOD:PUBLISH` is treated by several clients as a
 * one-time import of a set of invitations rather than as a calendar to keep polling, which is the
 * opposite of what this is for.
 *
 * **No `SEQUENCE` either.** It is meant to be a revision counter, and there is nothing in this
 * database to derive one from; a number that did not really increase on a revision would be worse
 * than the default of zero. `LAST-MODIFIED` carries that meaning here.
 *
 * An empty `events` array produces a valid calendar with nothing in it, which is the honest answer
 * for a student with no deadlines and is what a client expects. Refusing would make a subscription
 * that is working perfectly look broken.
 */
export function buildDueDateCalendar({
  events,
  now,
}: {
  events: CalendarEvent[];
  /** Read once by the caller and passed in, so every `DTSTAMP` in one document agrees. */
  now: Date;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    `NAME:${escapeText(CALENDAR_NAME)}`,
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    `DESCRIPTION:${escapeText(CALENDAR_DESCRIPTION)}`,
    `X-WR-CALDESC:${escapeText(CALENDAR_DESCRIPTION)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
    ...events.flatMap((event) => eventLines(event, now)),
    "END:VCALENDAR",
  ];

  // Folded one line at a time, and terminated with a final CRLF: the last line of the document is
  // a line like any other, and a file ending without one is malformed.
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
