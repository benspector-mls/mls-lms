import {
  buildDueDateCalendar,
  escapeText,
  foldLine,
  icsTimestamp,
  type CalendarEvent,
} from "@/lib/calendar/ics";

/**
 * The format, checked apart from the deadline arithmetic in `due-dates.test.ts`.
 *
 * Every event here is built by hand rather than by `dueDateEvent`, so a fault in one module cannot
 * hide a fault in the other.
 */

const encoder = new TextEncoder();
const octets = (value: string) => encoder.encode(value).length;

/** Split a folded value back into the physical lines a parser would see. */
const physicalLines = (folded: string) => folded.split("\r\n");

/** What a parser does to a folded value: drop each CRLF and the single space after it. */
const unfold = (folded: string) => folded.replace(/\r\n /g, "");

const event: CalendarEvent = {
  uid: "11111111-1111-4111-8111-111111111111@lms.marcylabschool.org",
  start: new Date("2026-10-09T23:30:00Z"),
  end: new Date("2026-10-10T00:00:00Z"),
  summary: "Due at 11:59 PM: Async and Await",
  description: "Software Engineering Fall 2026\nhttps://lms.example.org/courses/abc?assignment=def",
  url: "https://lms.example.org/courses/abc?assignment=def",
  lastModified: new Date("2026-10-01T13:00:00Z"),
};

describe("escapeText", () => {
  it("escapes the four characters that mean something to a parser", () => {
    expect(escapeText("Arrays, objects; and JSON")).toBe("Arrays\\, objects\\; and JSON");
    expect(escapeText("line one\nline two")).toBe("line one\\nline two");
    expect(escapeText("a\\b")).toBe("a\\\\b");
  });

  it("escapes the backslash before adding any of its own", () => {
    // The order is the whole subtlety. Escaping the comma first and the backslash after would turn
    // `a,b` into `a\\,b`, which a parser reads as a literal backslash followed by a separator.
    expect(escapeText("a,b\\c")).toBe("a\\,b\\\\c");
  });

  it("normalises every flavour of line ending to one escape", () => {
    expect(escapeText("a\r\nb")).toBe("a\\nb");
    expect(escapeText("a\rb")).toBe("a\\nb");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeText("Due at 11:59 PM: Async and Await")).toBe("Due at 11:59 PM: Async and Await");
  });
});

describe("foldLine", () => {
  it("leaves a line inside the limit as one line", () => {
    const line = `SUMMARY:${"a".repeat(60)}`;
    expect(foldLine(line)).toBe(line);
    expect(physicalLines(foldLine(line))).toHaveLength(1);
  });

  it("keeps every physical line inside 75 octets", () => {
    const folded = foldLine(`SUMMARY:${"a".repeat(400)}`);

    for (const line of physicalLines(folded)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
    expect(physicalLines(folded).length).toBeGreaterThan(1);
  });

  it("marks every continuation with a single space", () => {
    const [, ...continuations] = physicalLines(foldLine(`SUMMARY:${"a".repeat(400)}`));

    expect(continuations.length).toBeGreaterThan(0);
    for (const line of continuations) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.startsWith("  ")).toBe(false);
    }
  });

  it("counts octets rather than characters", () => {
    /*
      The failure this catches. Two-byte characters mean a line of 75 *characters* is about 150
      octets, so an implementation that folded on `String.length` would produce physical lines at
      twice the limit — and every one of them would look correct in a terminal.
    */
    const folded = foldLine(`SUMMARY:${"é".repeat(200)}`);

    for (const line of physicalLines(folded)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a character down the middle", () => {
    // An emoji outside the basic plane is four octets and two UTF-16 units, so slicing a string by
    // index is capable of cutting one in half and producing bytes that are not valid UTF-8 at all.
    for (const character of ["é", "—", "🎓"]) {
      const line = `SUMMARY:${character.repeat(120)}`;
      const folded = foldLine(line);

      // Round-tripping is the check: a value that survives folding and unfolding unchanged cannot
      // have had a character broken, because a broken one would not reassemble.
      expect(unfold(folded)).toBe(line);
      for (const physical of physicalLines(folded)) {
        expect(octets(physical)).toBeLessThanOrEqual(75);
      }
    }
  });

  it("reassembles to exactly what it was given", () => {
    const line = `DESCRIPTION:${"Software Engineering Fall 2026 ".repeat(20)}`;
    expect(unfold(foldLine(line))).toBe(line);
  });
});

describe("icsTimestamp", () => {
  it("writes UTC with no punctuation and no fraction", () => {
    expect(icsTimestamp(new Date("2026-10-09T23:59:00Z"))).toBe("20261009T235900Z");
  });

  it("writes the instant in UTC whatever zone it was expressed in", () => {
    // The same moment, written two ways. Both must produce the same value, which is what makes the
    // feed readable by a calendar in any zone without a VTIMEZONE block.
    expect(icsTimestamp(new Date("2026-10-09T23:59:00-04:00"))).toBe(
      icsTimestamp(new Date("2026-10-10T03:59:00Z")),
    );
  });

  it("drops the milliseconds a Date always carries", () => {
    expect(icsTimestamp(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z");
  });
});

describe("buildDueDateCalendar", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("opens and closes a calendar, and ends with a line break", () => {
    const body = buildDueDateCalendar({ events: [event], now });

    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF everywhere and never a bare newline", () => {
    const body = buildDueDateCalendar({ events: [event], now });

    // A feed written with bare newlines is accepted by some clients and mangled by others, which is
    // the worst kind of fault: it passes wherever it is tested and fails for one student.
    expect(body.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("still produces a valid calendar when nothing is due", () => {
    const body = buildDueDateCalendar({ events: [], now });

    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
  });

  it("writes one VEVENT per event, with the properties a client needs", () => {
    const body = buildDueDateCalendar({
      events: [event, { ...event, uid: "second@example" }],
      now,
    });

    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain(`UID:${event.uid}`);
    expect(body).toContain("DTSTART:20261009T233000Z");
    expect(body).toContain("DTEND:20261010T000000Z");
    expect(body).toContain("DTSTAMP:20261005T120000Z");
    expect(body).toContain("LAST-MODIFIED:20261001T130000Z");
  });

  it("names and describes itself in both spellings", () => {
    const body = buildDueDateCalendar({ events: [event], now });

    /*
      Clients are split. `X-WR-CALNAME` is the Apple convention everything grew up on and `NAME` is
      what RFC 7986 added to replace it, so emitting one risks a client that only reads the other.
      Google ignores both for a URL subscription and names it after the address, which no property
      here can change.
    */
    // Anchored to the start of a line, because `NAME:` on its own is a substring of
    // `X-WR-CALNAME:` — a `toContain` would pass with the standard property missing entirely.
    const lines = body.replace(/\r\n /g, "").split("\r\n");

    expect(lines).toContain("NAME:Marcy Lab School — due dates");
    expect(lines).toContain("X-WR-CALNAME:Marcy Lab School — due dates");
    expect(lines.some((line) => line.startsWith("DESCRIPTION:Assignment due dates"))).toBe(true);
    expect(lines.some((line) => line.startsWith("X-WR-CALDESC:Assignment due dates"))).toBe(true);
  });

  it("declares neither METHOD nor SEQUENCE", () => {
    const body = buildDueDateCalendar({ events: [event], now });

    // METHOD makes several clients treat a feed as a one-time import rather than a subscription,
    // and there is no revision counter in this database for SEQUENCE to report honestly.
    expect(body).not.toContain("METHOD:");
    expect(body).not.toContain("SEQUENCE");
  });

  it("escapes the text properties and leaves the URL alone", () => {
    const body = buildDueDateCalendar({
      events: [{ ...event, summary: "Due at 5:00 PM: Arrays, objects; and JSON" }],
      now,
    });

    expect(body).toContain("SUMMARY:Due at 5:00 PM: Arrays\\, objects\\; and JSON");
    // A URI is its own value type in RFC 5545 and takes none of the TEXT escapes. Escaping one
    // would put backslashes into a link a student is meant to be able to follow.
    expect(body).toContain(`URL:${event.url}`);
  });

  it("writes the newline in a description as an escape, not as a line break", () => {
    const body = buildDueDateCalendar({ events: [event], now });

    expect(body).toContain("Software Engineering Fall 2026\\nhttps://");
  });

  it("keeps every physical line inside the limit", () => {
    const body = buildDueDateCalendar({
      events: [{ ...event, summary: `Due at 11:59 PM: ${"Recursion and Trees ".repeat(12)}` }],
      now,
    });

    for (const line of body.split("\r\n")) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
  });

  it("cannot disclose a score or a status, because it is never handed one", () => {
    /*
      The guard on the rule that the feed carries deadlines and nothing else. The extra fields below
      are what a submission row would bring if somebody ever passed one straight through; the cast
      is what a mistake like that would look like. Nothing about them may reach the output.
    */
    const overreaching = {
      ...event,
      finalScore: 92,
      isComplete: true,
      status: "GRADED",
      feedbackMarkdown: "Nicely done, though the second helper repeats the first.",
    } as CalendarEvent;

    const body = buildDueDateCalendar({ events: [overreaching], now });

    expect(body).not.toContain("92");
    expect(body).not.toContain("GRADED");
    expect(body).not.toContain("Nicely done");
    expect(body).not.toMatch(/STATUS/);
  });
});
