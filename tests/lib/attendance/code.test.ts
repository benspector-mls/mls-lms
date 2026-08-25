import { CODE_DIGITS, codeFor, codeMatches, newSessionSecret } from "@/lib/attendance/code";

/**
 * The code that proves a fellow was where the class was.
 *
 * **One code per session, and the tests are mostly about what that means.** There is no clock in the
 * derivation, so the interesting cases are no longer boundaries in time — they are which sessions
 * agree, which disagree, and what a replaced secret does. The one case worth keeping from the
 * rotating design is the padding, because it fails one draw in ten and looks like a display bug.
 */

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

function session(overrides: { id?: string; codeSecret?: string } = {}) {
  return { id: "session-1", codeSecret: SECRET, ...overrides };
}

describe("codeFor", () => {
  it("is the same code every time it is asked", () => {
    expect(codeFor(session())).toBe(codeFor(session()));
  });

  /*
    The property the whole change rests on. A rotating code was a function of the clock, so asking
    twice half an hour apart gave two answers and the code had to stay on screen. This asks nothing
    of the clock, which is why an instructor can give it out once.
  */
  it("does not depend on the clock, so a session has one code all morning", () => {
    const first = codeFor(session());
    // Nothing to advance — there is no time input. The absence of one is the assertion.
    expect(codeFor(session())).toBe(first);
    expect(codeFor({ ...session() })).toBe(first);
  });

  it("differs by secret and by session", () => {
    const base = codeFor(session());
    expect(codeFor(session({ codeSecret: OTHER_SECRET }))).not.toBe(base);
    expect(codeFor(session({ id: "session-2" }))).not.toBe(base);
  });

  /*
    Two matriculations meeting on the same Tuesday must not share a code, or a fellow in one could check
    into the other. Each session carries its own secret, so this holds twice over — but the id is in
    the message as well, and this is the case that says so.
  */
  it("gives two sessions different codes even where a secret was somehow shared", () => {
    expect(codeFor({ id: "morning", codeSecret: SECRET })).not.toBe(
      codeFor({ id: "afternoon", codeSecret: SECRET }),
    );
  });

  it("is always four digits, padded", () => {
    const pattern = new RegExp(`^\\d{${CODE_DIGITS}}$`);

    // Enough real secrets that a code needing a leading zero is drawn many times over. Without
    // `padStart` this fails at roughly one in ten.
    for (let i = 0; i < 500; i += 1) {
      expect(codeFor({ id: `session-${i}`, codeSecret: newSessionSecret() })).toMatch(pattern);
    }
  });
});

describe("codeMatches", () => {
  it("accepts this session's code", () => {
    expect(codeMatches(session(), codeFor(session()))).toBe(true);
  });

  it("refuses another session's code", () => {
    expect(codeMatches(session(), codeFor(session({ id: "session-2" })))).toBe(false);
  });

  /*
    The remedy for a leak, and the only thing that invalidates a code now. Everything a fellow was
    told before this stops working, which is exactly what an instructor pressing Replace is asking
    for.
  */
  it("refuses the old code once the secret is replaced", () => {
    const before = codeFor(session());
    const after = session({ codeSecret: newSessionSecret() });

    expect(codeMatches(after, before)).toBe(false);
    expect(codeMatches(after, codeFor(after))).toBe(true);
  });

  /*
    `timingSafeEqual` throws on buffers of different lengths rather than returning false, so a short
    entry has to be caught before it reaches the comparison. An empty field and a fat finger are the
    two ways this arrives.
  */
  it.each(["", "1", "12", "123", "12345"])("refuses %p without throwing", (submitted) => {
    expect(codeMatches(session(), submitted)).toBe(false);
  });

  it("refuses a code of the right length that is simply wrong", () => {
    const right = codeFor(session());
    const wrong = String((Number(right) + 1) % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");

    expect(codeMatches(session(), wrong)).toBe(false);
  });
});

describe("newSessionSecret", () => {
  it("is 64 hex characters, which the column's CHECK asserts", () => {
    expect(newSessionSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    expect(newSessionSecret()).not.toBe(newSessionSecret());
  });
});
