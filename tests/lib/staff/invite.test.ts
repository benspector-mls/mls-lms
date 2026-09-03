/**
 * The invitation policy, as pure functions.
 *
 * These are the rules the staff procedures apply rather than restate, which is why they are worth
 * stating once here: getting `raiseRole` wrong demotes an admin who clicks their own link.
 *
 * They came out of `verify:staff`, where they were the only nine checks that needed no database at
 * all. Everything else that script held is in `tests/integration/staff.test.ts`.
 */
import {
  INVITE_LIFETIME_DAYS,
  inviteExpiry,
  inviteIsUsable,
  inviteState,
} from "@/lib/staff/invite";
import { raiseRole } from "@/lib/staff/invite";

const now = new Date("2026-08-07T12:00:00Z");
const later = new Date("2026-08-07T12:00:01Z");
const past = new Date("2026-08-01T12:00:00Z");
const future = new Date("2026-08-20T12:00:00Z");

describe("what state an invitation is in", () => {
  it("an unused link inside its window is open", () => {
    expect(inviteState({ redeemedAt: null, expiresAt: future }, now)).toBe("open");
  });

  it("an unused link past its window has expired", () => {
    expect(inviteState({ redeemedAt: null, expiresAt: past }, now)).toBe("expired");
  });

  /*
    Redeemed beats expired, and the order is the point. An invitation that was used and has since
    passed its expiry is the record of somebody being given access; calling it "expired" would hide
    the one fact worth keeping.
  */
  it("a used link reads as used even after it would have expired", () => {
    expect(inviteState({ redeemedAt: past, expiresAt: past }, now)).toBe("redeemed");
  });

  it("expiry is exclusive at the boundary, so a link is dead on the second it names", () => {
    expect(inviteState({ redeemedAt: null, expiresAt: now }, later)).toBe("expired");
  });

  it("only an open link is usable", () => {
    expect([
      inviteIsUsable({ redeemedAt: null, expiresAt: future }, now),
      inviteIsUsable({ redeemedAt: null, expiresAt: past }, now),
      inviteIsUsable({ redeemedAt: past, expiresAt: future }, now),
    ]).toEqual([true, false, false]);
  });
});

describe("what redeeming one does to a role", () => {
  it("redeeming raises a student to instructor", () => {
    expect(raiseRole("STUDENT", "INSTRUCTOR")).toBe("INSTRUCTOR");
  });

  it("...leaves an instructor an instructor", () => {
    expect(raiseRole("INSTRUCTOR", "INSTRUCTOR")).toBe("INSTRUCTOR");
  });

  /*
    The one that matters. `role: 'INSTRUCTOR'` is the obvious implementation and it demotes the
    admin who generated the link and clicked it to see what it does.
  */
  it("...and never demotes an admin", () => {
    expect(raiseRole("ADMIN", "INSTRUCTOR")).toBe("ADMIN");
  });
});

describe("how long one lasts", () => {
  it("an invitation expires within the stated window", () => {
    expect(inviteExpiry(now).getTime() - now.getTime()).toBe(
      INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});
