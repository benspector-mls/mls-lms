/**
 * When a session is open, and what arriving at a given moment counts as.
 *
 * **Every time rule here is a comparison, never a job**, because there is no scheduler in this
 * project and this feature is not the right reason to introduce one. A session closes on its
 * ninety-minute backstop the same way a due date passes: nothing runs, the answer to the question
 * simply changes. The rows that record who was absent are written afterwards, by whoever next
 * loads the grid or starts the following session — see `lib/attendance/grid.ts` for the state that
 * covers the gap.
 *
 * Pure, and takes `now` as an argument in the manner of `formatRelative`. That is what lets the
 * boundary cases be tested against fixed instants instead of a mocked clock.
 */

/** How long a session accepts check-ins before its backstop, absent any extension. */
export const DEFAULT_SESSION_MINUTES = 90;

/** How much one press of Extend buys. */
export const EXTEND_MINUTES = 30;

/** Where `Course.attendanceLateAfterMinutes` starts, and what most cohorts will leave it at. */
export const DEFAULT_LATE_AFTER_MINUTES = 5;

/** The parts of a session these functions read. */
export type WindowSession = {
  startedAt: Date;
  /** The backstop. Check-in stops working here whether or not anybody pressed end. */
  endsAt: Date;
  /** Set when a person ended it. Beats the backstop in both directions. */
  endedAt: Date | null;
  lateAfterMinutes: number;
};

export type SessionState =
  /** A person pressed end. */
  | "ended"
  /** Nobody pressed end and the backstop passed. Behaves as closed; says something different. */
  | "lapsed"
  | "open";

export function sessionStateOf(session: WindowSession, now: Date): SessionState {
  if (session.endedAt !== null) return "ended";
  if (now.getTime() >= session.endsAt.getTime()) return "lapsed";
  return "open";
}

/** Whether a code typed at this moment would be considered at all. */
export function isAcceptingCheckIns(session: WindowSession, now: Date): boolean {
  return sessionStateOf(session, now) === "open";
}

/** The moment after which arriving counts as late. */
export function lateFrom(session: WindowSession): Date {
  return new Date(session.startedAt.getTime() + session.lateAfterMinutes * 60 * 1000);
}

/**
 * What a check-in at this instant is worth.
 *
 * **Exactly on the boundary is on time.** Somebody has to decide, and deciding in the fellow's
 * favour is the version that never needs defending to the person it was decided against.
 *
 * A check-in *before* `startedAt` is on time too, which is not a hypothetical: an instructor
 * correcting a session they started five minutes late edits `startedAt` backwards, and the
 * recomputation then asks this about check-ins that precede it.
 */
export function statusForCheckIn(session: WindowSession, checkedInAt: Date): "PRESENT" | "LATE" {
  return checkedInAt.getTime() > lateFrom(session).getTime() ? "LATE" : "PRESENT";
}

/** Where the backstop lands for a session starting now. */
export function defaultEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + DEFAULT_SESSION_MINUTES * 60 * 1000);
}

/**
 * Where Extend moves the backstop.
 *
 * Measured from whichever is later — the current backstop, or now. Pressing Extend on a session
 * that lapsed twenty minutes ago should buy thirty minutes from this moment, not ten; otherwise
 * the button appears to do nothing, which is how somebody ends up pressing it four times in front
 * of a room.
 */
export function extendedEndsAt(session: WindowSession, now: Date): Date {
  const from = Math.max(session.endsAt.getTime(), now.getTime());
  return new Date(from + EXTEND_MINUTES * 60 * 1000);
}

/** Whether the screen should be warning that check-in is about to stop on its own. */
export function isEndingSoon(session: WindowSession, now: Date, withinMinutes = 10): boolean {
  if (sessionStateOf(session, now) !== "open") return false;
  return session.endsAt.getTime() - now.getTime() <= withinMinutes * 60 * 1000;
}
