import {
  DEFAULT_SESSION_MINUTES,
  OPENS_BEFORE_START_MINUTES,
  defaultEndsAt,
  extendedEndsAt,
  isAcceptingCheckIns,
  isEndingSoon,
  lateFrom,
  opensAt,
  sessionStateOf,
  statusForCheckIn,
  type StartedSession,
} from "@/lib/attendance/window";

/**
 * When a session is open, and what arriving counts as.
 *
 * The boundaries are the whole of this file. Every one of them is a decision somebody could argue
 * with, and a test that only checked the middle of each range would let any of them move.
 */

const STARTED = new Date("2026-09-14T13:00:00Z");

function session(overrides: Partial<StartedSession> = {}): StartedSession {
  return {
    startedAt: STARTED,
    endsAt: defaultEndsAt(STARTED),
    endedAt: null,
    lateAfterMinutes: 5,
    ...overrides,
  };
}

/** A session whose code exists and whose check-in has not opened. Both window columns are null. */
function prepared() {
  return { startedAt: null, endsAt: null, endedAt: null, lateAfterMinutes: 5 };
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

  /*
    The phase that lets a code go on a whiteboard before class. Read from the columns rather than
    from the clock, so it is the same answer at 8:40 and at midnight.
  */
  it("reports pending when check-in has not opened, whatever the time", () => {
    expect(sessionStateOf(prepared(), at(-30))).toBe("pending");
    expect(sessionStateOf(prepared(), at(0))).toBe("pending");
    expect(sessionStateOf(prepared(), at(DEFAULT_SESSION_MINUTES + 600))).toBe("pending");
  });
});

describe("isAcceptingCheckIns", () => {
  it("is true only while open", () => {
    expect(isAcceptingCheckIns(session(), at(10))).toBe(true);
    expect(isAcceptingCheckIns(session(), at(DEFAULT_SESSION_MINUTES))).toBe(false);
    expect(isAcceptingCheckIns(session({ endedAt: at(20) }), at(25))).toBe(false);
  });

  /*
    The line that makes the prepared phase cheap. Every caller refusing a closed session already
    refuses a prepared one, so holding the code never amounted to being able to use it.
  */
  it("is false for a prepared session, which is what keeps the code inert", () => {
    expect(isAcceptingCheckIns(prepared(), at(-10))).toBe(false);
    expect(isAcceptingCheckIns(prepared(), at(10))).toBe(false);
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

describe("a session whose start is still ahead", () => {
  /*
    A session made from a schedule carries a start in the future, so `now` here runs *before* the
    fixture's `STARTED` rather than after it. `at()` takes negatives for exactly this.
  */
  it("is scheduled until two hours before the start", () => {
    expect(sessionStateOf(session(), at(-OPENS_BEFORE_START_MINUTES - 1))).toBe("scheduled");
    expect(sessionStateOf(session(), at(-121))).toBe("scheduled");
  });

  // On the boundary the window is open, matching `statusForCheckIn`, which decides the other
  // boundary in the fellow's favour.
  it("is open exactly at the two-hour mark", () => {
    expect(sessionStateOf(session(), at(-OPENS_BEFORE_START_MINUTES))).toBe("open");
    expect(sessionStateOf(session(), at(-119))).toBe("open");
  });

  it("accepts no check-in before the window opens", () => {
    expect(isAcceptingCheckIns(session(), at(-121))).toBe(false);
    expect(isAcceptingCheckIns(session(), at(-120))).toBe(true);
  });

  /*
    An instructor pressing Start makes a session whose start is this moment, so the window opened
    two hours ago and the press is never refused by its own rule.
  */
  it("is open at once when a person started it", () => {
    expect(sessionStateOf(session(), STARTED)).toBe("open");
  });

  // Somebody arriving during the window, before class, is on time. That is the feature.
  it("counts an arrival before the start as present", () => {
    expect(statusForCheckIn(session(), at(-90))).toBe("PRESENT");
  });

  // A person's decision and the backstop both outrank the window, or a removed day could be
  // reopened into a state that accepts nobody.
  it("reports ended rather than scheduled once somebody ended it", () => {
    expect(sessionStateOf(session({ endedAt: at(-150) }), at(-160))).toBe("ended");
  });

  it("says when the window opens", () => {
    expect(opensAt(session()).toISOString()).toBe(at(-120).toISOString());
  });
});
