import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The code on the screen at the front of the room.
 *
 * **Why a code at all, when the application already knows who is signed in.** Identity and
 * presence are two different claims, and the Google Form this replaces asks one three-digit
 * string to make both — which is why it makes neither. Here the session proves *who* and the code
 * proves *where*: it is only readable by somebody who can see the projector or the shared Zoom
 * window at that moment.
 *
 * **Derived from a per-session secret and a clock slot, never stored.** Nothing anywhere holds
 * "the current code". That is what makes two instructor screens agree without talking to each
 * other, and what makes a deploy at 9:03 invisible to a room mid-check-in. A stored-and-rotated
 * code would need a writer, and the writer would be a scheduler this project does not have.
 *
 * **What this does not solve, so that nobody believes it does.** A fellow in the room can
 * photograph the code and send it to somebody at home who types it inside the minute. No rotating
 * code fixes collusion; the technical answers are all worse than the problem, and two of the five
 * days are remote anyway. What rotation *does* fix is the failure the form has today — a static
 * code posted in the group chat at 9:00 that still works at 11:00 for somebody who never arrived.
 *
 * Pure, and deliberately free of `server-only`: the Jest suite and `scripts/verify-attendance.ts`
 * both derive codes directly, which is the only way to test acceptance of the previous slot.
 */

/** How long one code lives before the next replaces it. */
export const SLOT_SECONDS = 30;

/** How many digits are on the screen. Four: legible from the back of a room, one more than the form. */
export const CODE_DIGITS = 4;

/**
 * The number of past slots still accepted, beyond the current one.
 *
 * One, which makes a code good for between thirty and sixty seconds depending on when the fellow
 * looked up. That is the allowance a slow typist needs, and it matters more than it sounds over
 * Zoom, where screen-share encoding puts a second or two between the instructor's display and the
 * fellow's eyes. Two would double the guessing surface for no further gain.
 */
const SLOT_GRACE = 1;

/** The parts of a session this file reads. Structural, so a test can build one in three lines. */
export type CodeSession = {
  id: string;
  startedAt: Date;
  codeSecret: string;
};

/** 256 bits of hex, per session. The `CHECK` on the column asserts the length. */
export function newSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Which slot an instant falls in, counted from the moment the session started.
 *
 * Anchored on `startedAt` rather than the Unix epoch so the sequence belongs to this session and
 * nothing else, and so the countdown on the instructor's screen needs no convention shared with
 * the server beyond the row they are both reading. Negative before the session starts, which
 * `currentCode` refuses rather than trying to interpret.
 */
export function slotAt(startedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - startedAt.getTime()) / (SLOT_SECONDS * 1000));
}

/** When the given slot gives way to the next one. */
export function slotEndsAt(startedAt: Date, slot: number): Date {
  return new Date(startedAt.getTime() + (slot + 1) * SLOT_SECONDS * 1000);
}

/**
 * The code for one slot.
 *
 * The session id is inside the message as well as the secret being per session, which is belt and
 * braces: two sessions could only ever collide if they shared a secret, and they cannot, but the
 * derivation should not depend on that being true.
 *
 * **Padded**, and this is the line worth not deleting. Without `padStart`, one draw in ten is
 * shorter than four characters — it reads as a display bug on the projector and it is refused by
 * the input on the fellow's phone.
 */
export function codeForSlot(secret: string, sessionId: string, slot: number): string {
  const digest = createHmac("sha256", secret).update(`${sessionId}:${slot}`).digest();
  const modulus = 10 ** CODE_DIGITS;
  return String(digest.readUInt32BE(0) % modulus).padStart(CODE_DIGITS, "0");
}

/** What to put on the screen right now, and when it changes. Null before the session starts. */
export function currentCode(
  session: CodeSession,
  now: Date,
): { code: string; slot: number; rotatesAt: Date } | null {
  const slot = slotAt(session.startedAt, now);
  if (slot < 0) return null;

  return {
    code: codeForSlot(session.codeSecret, session.id, slot),
    slot,
    rotatesAt: slotEndsAt(session.startedAt, slot),
  };
}

/**
 * Whether what a fellow typed is the code, now or a moment ago.
 *
 * `timingSafeEqual` on equal-length buffers, matching `lib/github/webhook-verify.ts`. Honest
 * framing: against four digits behind two attempt ceilings, timing analysis is not the threat —
 * the pattern is three lines and already established here, so there is no reason to reach for
 * `===` instead.
 */
export function codeMatches(session: CodeSession, submitted: string, now: Date): boolean {
  // Length-checked before the loop, because `timingSafeEqual` throws rather than returning false
  // on a mismatch, and "" or "12" is what an empty form field and a fat finger produce.
  if (submitted.length !== CODE_DIGITS) return false;

  const current = slotAt(session.startedAt, now);
  if (current < 0) return false;

  const offered = Buffer.from(submitted, "utf8");

  let matched = false;
  for (let slot = current; slot >= current - SLOT_GRACE && slot >= 0; slot -= 1) {
    const expected = Buffer.from(codeForSlot(session.codeSecret, session.id, slot), "utf8");
    // No early return: comparing every candidate regardless keeps the work constant, which is the
    // only reason using a constant-time comparison inside the loop would otherwise be theatre.
    if (timingSafeEqual(expected, offered)) matched = true;
  }

  return matched;
}

/**
 * Whether a code was right recently enough to be worth saying so.
 *
 * Used only to word the refusal. "That code has expired" and "that is not the code" send a fellow
 * to two different places — one to look up at the screen again, the other to wonder whether they
 * are even in the right course — and the server is the only thing that can tell them apart.
 */
export function wasRecentlyValid(session: CodeSession, submitted: string, now: Date): boolean {
  if (submitted.length !== CODE_DIGITS) return false;

  const current = slotAt(session.startedAt, now);
  // Ten slots is five minutes, which covers a fellow who typed the code, got distracted, and came
  // back. Beyond that "expired" stops being the useful thing to say.
  for (let slot = current - SLOT_GRACE - 1; slot >= current - 10 && slot >= 0; slot -= 1) {
    if (codeForSlot(session.codeSecret, session.id, slot) === submitted) return true;
  }

  return false;
}
