import {
  CODE_DIGITS,
  codeForSlot,
  codeMatches,
  currentCode,
  newSessionSecret,
  slotAt,
  wasRecentlyValid,
  type CodeSession,
} from "@/lib/attendance/code";

/**
 * The rotating code.
 *
 * Every case here is against a fixed instant, which is the reason these functions take `now`
 * rather than reading the clock — and the only way to test that a code from the previous slot is
 * still accepted while one from two slots ago is not.
 */

const STARTED = new Date("2026-09-14T13:00:00Z");
const SECRET = "a".repeat(64);

function session(overrides: Partial<CodeSession> = {}): CodeSession {
  return { id: "session-1", startedAt: STARTED, codeSecret: SECRET, ...overrides };
}

/** `n` seconds after the session started. */
function at(seconds: number): Date {
  return new Date(STARTED.getTime() + seconds * 1000);
}

describe("slotAt", () => {
  it("is zero for the first thirty seconds and one after that", () => {
    expect(slotAt(STARTED, at(0))).toBe(0);
    expect(slotAt(STARTED, at(29.999))).toBe(0);
    expect(slotAt(STARTED, at(30))).toBe(1);
    expect(slotAt(STARTED, at(59))).toBe(1);
    expect(slotAt(STARTED, at(60))).toBe(2);
  });

  it("is negative before the session starts", () => {
    expect(slotAt(STARTED, at(-1))).toBeLessThan(0);
  });
});

describe("codeForSlot", () => {
  it("is the same code twice for the same inputs", () => {
    expect(codeForSlot(SECRET, "session-1", 4)).toBe(codeForSlot(SECRET, "session-1", 4));
  });

  it("differs by secret, by session, and by slot", () => {
    const base = codeForSlot(SECRET, "session-1", 4);
    expect(codeForSlot("b".repeat(64), "session-1", 4)).not.toBe(base);
    expect(codeForSlot(SECRET, "session-2", 4)).not.toBe(base);
    expect(codeForSlot(SECRET, "session-1", 5)).not.toBe(base);
  });

  it("never disagrees with its neighbour over a hundred slots", () => {
    for (let slot = 0; slot < 100; slot += 1) {
      expect(codeForSlot(SECRET, "session-1", slot)).not.toBe(
        codeForSlot(SECRET, "session-1", slot + 1),
      );
    }
  });

  /*
    The case an unpadded modulo fails one time in ten. It is not a formatting nicety: a
    three-character code reads as a bug on the projector and is refused by the input on the
    fellow's phone, which asks for exactly four digits.
  */
  it("is always exactly four digits, over ten thousand draws", () => {
    const pattern = new RegExp(`^\\d{${CODE_DIGITS}}$`);
    for (let slot = 0; slot < 10_000; slot += 1) {
      expect(codeForSlot(SECRET, "session-1", slot)).toMatch(pattern);
    }
  });

  it("produces a short code somewhere in that range, which is what the padding is for", () => {
    // Proves the previous test is testing something: without padding, some of these are shorter.
    const unpadded = Array.from({ length: 10_000 }, (_, slot) =>
      String(Number(codeForSlot(SECRET, "session-1", slot))),
    );
    expect(unpadded.some((code) => code.length < CODE_DIGITS)).toBe(true);
  });
});

describe("currentCode", () => {
  it("is null before the session has started", () => {
    expect(currentCode(session(), at(-5))).toBeNull();
  });

  it("names when it rotates", () => {
    const view = currentCode(session(), at(10));
    expect(view?.slot).toBe(0);
    expect(view?.rotatesAt.toISOString()).toBe(at(30).toISOString());
  });
});

describe("codeMatches", () => {
  it("accepts the current slot's code", () => {
    const code = codeForSlot(SECRET, "session-1", 3);
    expect(codeMatches(session(), code, at(95))).toBe(true);
  });

  it("accepts the previous slot's code, which is the slow-typist allowance", () => {
    const code = codeForSlot(SECRET, "session-1", 2);
    expect(codeMatches(session(), code, at(95))).toBe(true);
  });

  it("refuses the one before that", () => {
    const code = codeForSlot(SECRET, "session-1", 1);
    expect(codeMatches(session(), code, at(95))).toBe(false);
  });

  it("refuses a code from the future", () => {
    const code = codeForSlot(SECRET, "session-1", 4);
    expect(codeMatches(session(), code, at(95))).toBe(false);
  });

  it("refuses before the session starts", () => {
    expect(codeMatches(session(), codeForSlot(SECRET, "session-1", 0), at(-5))).toBe(false);
  });

  /*
    `timingSafeEqual` throws on buffers of different lengths rather than returning false, so the
    length guard is what stands between an empty form field and a 500.
  */
  it.each(["", "1", "123", "12345", "abcd"])("returns false rather than throwing for %p", (bad) => {
    expect(() => codeMatches(session(), bad, at(10))).not.toThrow();
    expect(codeMatches(session(), bad, at(10))).toBe(false);
  });

  it("refuses a code derived from a different secret, which is what rotation relies on", () => {
    const old = codeForSlot(SECRET, "session-1", 3);
    const rotated = session({ codeSecret: newSessionSecret() });
    expect(codeMatches(rotated, old, at(95))).toBe(false);
  });
});

describe("wasRecentlyValid", () => {
  it("recognises a code that has expired, so the refusal can say so", () => {
    const code = codeForSlot(SECRET, "session-1", 1);
    expect(wasRecentlyValid(session(), code, at(95))).toBe(true);
  });

  it("does not claim a code was ever valid when it was not", () => {
    expect(wasRecentlyValid(session(), "0000", at(600))).toBe(false);
  });

  it("stops recognising a code from long before", () => {
    const ancient = codeForSlot(SECRET, "session-1", 0);
    // Twenty slots later — ten minutes — "expired" has stopped being the useful thing to say.
    expect(wasRecentlyValid(session(), ancient, at(600))).toBe(false);
  });
});

describe("newSessionSecret", () => {
  it("is 64 hex characters, which the CHECK constraint asserts", () => {
    expect(newSessionSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is different every time", () => {
    expect(newSessionSecret()).not.toBe(newSessionSecret());
  });
});
