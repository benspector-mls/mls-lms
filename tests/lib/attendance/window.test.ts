import {
  DEFAULT_SESSION_MINUTES,
  defaultEndsAt,
  extendedEndsAt,
  isAcceptingCheckIns,
  isEndingSoon,
  lateFrom,
  sessionStateOf,
  statusForCheckIn,
  type WindowSession,
} from "@/lib/attendance/window";

/**
 * When a session is open, and what arriving counts as.
 *
 * The boundaries are the whole of this file. Every one of them is a decision somebody could argue
 * with, and a test that only checked the middle of each range would let any of them move.
 */

const STARTED = new Date("2026-09-14T13:00:00Z");

function session(overrides: Partial<WindowSession> = {}): WindowSession {
  return {
    startedAt: STARTED,
    endsAt: defaultEndsAt(STARTED),
    endedAt: null,
    lateAfterMinutes: 5,
    ...overrides,
  };
}

/** `n` minutes after the session started. */
function at(minutes: number): Date {
  return new Date(STARTED.getTime() + minutes * 60 * 1000);
}

describe("sessionStateOf", () => {
  it("is open before the backstop", () => {
    expect(sessionStateOf(session(), at(10))).toBe("open");
    expect(sessionStateOf(session(), at(DEFAULT_SESSION_MINUTES - 0.01))).toBe("open");
  });

  it("has lapsed exactly at the backstop", () => {
    expect(sessionStateOf(session(), at(DEFAULT_SESSION_MINUTES))).toBe("lapsed");
    expect(sessionStateOf(session(), at(DEFAULT_SESSION_MINUTES + 60))).toBe("lapsed");
  });

  /*
    A person's decision beats the backstop in both directions. That is the reason `endedAt` and
    `endsAt` are separate columns: the log has to be able to say "the instructor ended class at
    10:32" rather than "it timed out", and they are different facts.
  */
  it("reports ended, not lapsed, once somebody ended it", () => {
    const ended = session({ endedAt: at(40) });
    expect(sessionStateOf(ended, at(45))).toBe("ended");
    expect(sessionStateOf(ended, at(500))).toBe("ended");
  });

  it("reports ended even before the backstop, which is the ordinary case", () => {
    expect(sessionStateOf(session({ endedAt: at(40) }), at(41))).toBe("ended");
  });
});

describe("isAcceptingCheckIns", () => {
  it("is true only while open", () => {
    expect(isAcceptingCheckIns(session(), at(10))).toBe(true);
    expect(isAcceptingCheckIns(session(), at(DEFAULT_SESSION_MINUTES))).toBe(false);
    expect(isAcceptingCheckIns(session({ endedAt: at(20) }), at(25))).toBe(false);
  });
});

describe("statusForCheckIn", () => {
  it("counts the boundary itself as on time", () => {
    // Somebody has to decide, and deciding in the fellow's favour never needs defending to the
    // person it was decided against.
    expect(statusForCheckIn(session(), lateFrom(session()))).toBe("PRESENT");
  });

  it("is late one millisecond later", () => {
    const boundary = lateFrom(session());
    expect(statusForCheckIn(session(), new Date(boundary.getTime() + 1))).toBe("LATE");
  });

  it("uses the session's own number, not a constant", () => {
    const generous = session({ lateAfterMinutes: 20 });
    expect(statusForCheckIn(generous, at(15))).toBe("PRESENT");
    expect(statusForCheckIn(session(), at(15))).toBe("LATE");
  });

  it("makes anything after the start late when the course allows no grace", () => {
    const strict = session({ lateAfterMinutes: 0 });
    expect(statusForCheckIn(strict, STARTED)).toBe("PRESENT");
    expect(statusForCheckIn(strict, new Date(STARTED.getTime() + 1))).toBe("LATE");
  });

  it("treats a check-in before the start as on time", () => {
    // Reachable after an instructor corrects a session they started late: `startedAt` moves
    // forward, and the recomputation then asks about check-ins that precede it.
    expect(statusForCheckIn(session(), at(-3))).toBe("PRESENT");
  });
});

describe("extendedEndsAt", () => {
  it("adds thirty minutes to the backstop while the session is still open", () => {
    const extended = extendedEndsAt(session(), at(10));
    expect(extended.getTime()).toBe(at(DEFAULT_SESSION_MINUTES + 30).getTime());
  });

  /*
    Measured from now once the backstop has passed, not from the backstop. Otherwise pressing
    Extend on a session that lapsed twenty minutes ago buys ten minutes, the button appears to do
    nothing, and somebody presses it four times in front of a room.
  */
  it("adds thirty minutes to now when the backstop has already passed", () => {
    const late = at(DEFAULT_SESSION_MINUTES + 20);
    expect(extendedEndsAt(session(), late).getTime()).toBe(late.getTime() + 30 * 60 * 1000);
  });

  it("reopens a lapsed session when applied", () => {
    const now = at(DEFAULT_SESSION_MINUTES + 5);
    const extended = session({ endsAt: extendedEndsAt(session(), now) });
    expect(sessionStateOf(extended, now)).toBe("open");
  });
});

describe("isEndingSoon", () => {
  it("warns inside the last ten minutes and not before", () => {
    expect(isEndingSoon(session(), at(DEFAULT_SESSION_MINUTES - 11))).toBe(false);
    expect(isEndingSoon(session(), at(DEFAULT_SESSION_MINUTES - 9))).toBe(true);
  });

  it("says nothing about a session that is already closed", () => {
    expect(isEndingSoon(session(), at(DEFAULT_SESSION_MINUTES + 1))).toBe(false);
    expect(isEndingSoon(session({ endedAt: at(20) }), at(21))).toBe(false);
  });
});
