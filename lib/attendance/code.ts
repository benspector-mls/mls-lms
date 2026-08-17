import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The code that proves a fellow was where the class was.
 *
 * **Why a code at all, when the application already knows who is signed in.** Identity and presence
 * are two different claims, and the Google Form this replaces asks one three-digit string to make
 * both — which is why it makes neither. Here the session proves *who* and the code proves *where*:
 * it is only known to somebody the instructor gave it to.
 *
 * **One code per session, fixed for as long as check-in is open.** That is the decision this file
 * turns on, and it is a decision about distribution rather than about cryptography. A code that
 * changed every thirty seconds had to be *displayed* continuously, which meant it had to occupy the
 * shared screen — the same screen the lesson needs. So an instructor either surrendered the screen
 * for the first five minutes of every class, or a fellow arriving at twenty past had no way to check
 * in without the lesson stopping for them. A fixed code is *distributed* once instead: said out
 * loud, pasted into the chat, put on the first slide, or left in the corner of a projector. A fellow
 * who arrives late reads it out of the chat or asks the person beside them, and nobody's lesson
 * stops.
 *
 * **What this costs, stated plainly.** A fixed code can be passed to somebody at home and will work
 * until the class ends, where a rotating one worked for a minute. That is a real loss and it is the
 * one this design accepts.
 *
 * **What it does not cost is resistance to guessing**, which is worth separating out because the two
 * are easy to run together. Guessing is bounded by the two attempt ceilings in the router, not by
 * rotation — and a single live code is in fact one draw in ten thousand where a rotating one, which
 * had to accept the previous code as well, was two.
 *
 * **The remedy for a leak is `rotateCode`, not a clock.** Replacing the session secret kills the
 * old code at once, which is the same act the instructor would want if a code reached a group chat
 * under any scheme. It is a deliberate response to something noticed, rather than a churn that runs
 * whether or not anything is wrong.
 *
 * **Derived from the session secret, never stored.** Nothing anywhere holds "the code". That is what
 * makes two instructor screens agree without talking to each other, and a deploy at 9:03 invisible
 * to a room mid-check-in. It also means the code does not depend on `startedAt`, so an instructor
 * correcting a session that began five minutes late does not change the code out from under a room.
 *
 * Pure, and deliberately free of `server-only`: the Jest suite and `scripts/verify-attendance.ts`
 * both derive codes directly, which is the only way to test that a replaced secret invalidates one.
 */

/** How many digits are on the screen. Four: legible from the back of a room, one more than the form. */
export const CODE_DIGITS = 4;

/**
 * The parts of a session this file reads. Structural, so a test can build one in two lines.
 *
 * No `startedAt`. The code is a fact about which session this is, not about how long it has been
 * running, and leaving the clock out of the derivation is what makes it stable across an edit to
 * the session's start time.
 */
export type CodeSession = {
  id: string;
  codeSecret: string;
};

/** 256 bits of hex, per session. The `CHECK` on the column asserts the length. */
export function newSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * The code for one session.
 *
 * The session id is inside the message as well as the secret being per session, which is belt and
 * braces: two sessions could only ever collide if they shared a secret, and they cannot, but the
 * derivation should not depend on that being true.
 *
 * **Padded**, and this is the line worth not deleting. Without `padStart`, one draw in ten is
 * shorter than four characters — it reads as a display bug on the projector and it is refused by
 * the input on the fellow's phone.
 */
export function codeFor(session: CodeSession): string {
  const digest = createHmac("sha256", session.codeSecret).update(session.id).digest();
  const modulus = 10 ** CODE_DIGITS;
  return String(digest.readUInt32BE(0) % modulus).padStart(CODE_DIGITS, "0");
}

/**
 * Whether what a fellow typed is this session's code.
 *
 * No `now`, and that absence is the shape of the whole change: a code is valid for exactly as long
 * as the session accepts check-ins, which the caller has already established before reaching here.
 * There is no third state where the session is open and the code has nevertheless expired, so there
 * is no such refusal to word.
 *
 * `timingSafeEqual` on equal-length buffers, matching `lib/github/webhook-verify.ts`. Honest
 * framing: against four digits behind two attempt ceilings, timing analysis is not the threat — the
 * pattern is three lines and already established here, so there is no reason to reach for `===`.
 */
export function codeMatches(session: CodeSession, submitted: string): boolean {
  // Length-checked first, because `timingSafeEqual` throws rather than returning false on a
  // mismatch, and "" or "12" is what an empty form field and a fat finger produce.
  if (submitted.length !== CODE_DIGITS) return false;

  return timingSafeEqual(Buffer.from(codeFor(session), "utf8"), Buffer.from(submitted, "utf8"));
}
