/**
 * When a session is open, and what arriving at a given moment counts as.
 *
 * **Every time rule here is a comparison, never a job**, because there is no scheduler in this
 * project and this feature is not the right reason to introduce one. A session closes on its
 * eight-hour backstop the same way a due date passes: nothing runs, the answer to the question
 * simply changes. The rows that record who was absent are written afterwards, by whoever next
 * writes anything — the first fellow to check in the following morning, or an instructor making or
 * removing a day. See `lib/attendance/grid.ts` for the state that covers the gap, which is what
 * lets a screen be right about a lapsed session before anybody has written its absences down.
 *
 * Pure, and takes `now` as an argument in the manner of `formatRelative`. That is what lets the
 * boundary cases be tested against fixed instants instead of a mocked clock.
 */

/**
 * How long a session accepts check-ins before its backstop, absent any extension.
 *
 * Eight hours, because attendance is taken across a whole day rather than during one lesson. A
 * fellow who arrives after lunch is checking into the same day as the fellow who arrived at nine,
 * and a backstop measured in a single lesson's length would have closed the day before they sat
 * down.
 */
export const DEFAULT_SESSION_MINUTES = 480;

/** How much one press of Extend buys. */
export const EXTEND_MINUTES = 30;

/** Where `Program.attendanceLateAfterMinutes` starts, and what most programs will leave it at. */
export const DEFAULT_LATE_AFTER_MINUTES = 5;

/**
 * How long before class a session starts accepting check-ins.
 *
 * **Two hours, because the alternative to a bound is no bound at all.** A session made a fortnight
 * ahead holds a working code from the moment it is made, and without this a photographed sheet of
 * the term's codes would let somebody mark themselves present at three in the morning for a day
 * they then slept through. Two hours is longer than anybody arrives before class and short enough
 * that a code is worth one early check-in on one day rather than a term of them.
 *
 * It costs nothing for a session an instructor started by hand: its start is the moment of the
 * press, so the window opened two hours before that and the rule is never the thing that refuses.
 */
export const OPENS_BEFORE_START_MINUTES = 120;

/** The parts of a session these functions read. */
export type WindowSession = {
  /** Null before check-in has been opened. See `StartedSession`. */
  startedAt: Date | null;
  /** The backstop. Check-in stops working here whether or not anybody pressed end. */
  endsAt: Date | null;
  /** Set when a person ended it. Beats the backstop in both directions. */
  endedAt: Date | null;
  lateAfterMinutes: number;
};

/**
 * A session whose check-in has opened.
 *
 * **Every clock rule below takes this rather than `WindowSession`**, so the compiler is what stops
 * a lateness question being asked about a session that has not started. A caller narrows once —
 * usually by refusing the prepared case in words — and the rest of its body typechecks unchanged.
 */
export type StartedSession = WindowSession & { startedAt: Date; endsAt: Date };

export type SessionState =
  /**
   * Made, but check-in has not opened.
   *
   * The phase that exists so a code can go on a whiteboard before class. The session holds a
   * secret and therefore a code; it accepts nothing, measures no lateness, and has no closing time
   * to print, because none of those begin until somebody presses start.
   *
   * A program with a schedule never produces one: every day it makes has a clock.
   */
  | "pending"
  /**
   * Made from the schedule, with a start still more than two hours away.
   *
   * Unlike `pending` it has all three times to print — when check-in opens, when class starts,
   * when the code dies — which is why it is a state of its own rather than a reuse. A screen
   * drawing one can tell a room exactly when the code will begin to work.
   */
  | "scheduled"
  /** A person pressed end. */
  | "ended"
  /** Nobody pressed end and the backstop passed. Behaves as closed; says something different. */
  | "lapsed"
  | "open";

export function sessionStateOf(session: WindowSession, now: Date): SessionState {
  // First, because a session that never started cannot have ended, lapsed, or been scheduled —
  // there is no instant for any of them to be measured against.
  if (session.startedAt === null || session.endsAt === null) return "pending";
  if (session.endedAt !== null) return "ended";
  if (now.getTime() >= session.endsAt.getTime()) return "lapsed";

  /*
    Last of the three closed answers, and deliberately after the other two. A day removed from the
    schedule and then reopened, or one whose backstop somebody dragged backwards, must read as
    closed rather than as "not yet" — a screen saying check-in opens at 7:30 about a morning that
    already finished is worse than one saying it is closed.
  */
  if (now.getTime() < opensAt(session as StartedSession).getTime()) return "scheduled";

  return "open";
}

/**
 * Whether a code typed at this moment would be considered at all.
 *
 * Unchanged by prepared sessions, which is the reason that phase is cheap: `pending` is not `open`,
 * so every caller of this already refuses one without a line being added.
 */
export function isAcceptingCheckIns(session: WindowSession, now: Date): boolean {
  return sessionStateOf(session, now) === "open";
}

/**
 * Whether nothing about this session is settled yet.
 *
 * **What `summarize` divides by.** An unsettled session counts for a fellow who already has a
 * record in it and for nobody else, so a morning still running does not read as a morning
 * everybody missed — and neither does a day in March that the schedule made in September.
 *
 * Three states rather than one, and the reason to have the predicate here rather than the
 * disjunction at each call site: there are five of them, they must agree, and the last time a
 * state was added every one of them had to be found by hand.
 */
export function isUnsettled(session: WindowSession, now: Date): boolean {
  return stateIsUnsettled(sessionStateOf(session, now));
}

/**
 * The same question asked of a state that has already been worked out.
 *
 * For the callers holding a `publicSession` payload rather than the row it came from — a server
 * component, a screen — which have the state as a string and no `Date` to re-derive it from.
 */
export function stateIsUnsettled(state: SessionState): boolean {
  return state === "open" || state === "pending" || state === "scheduled";
}

/** The moment after which arriving counts as late. */
export function lateFrom(session: StartedSession): Date {
  return new Date(session.startedAt.getTime() + session.lateAfterMinutes * 60 * 1000);
}

/** The moment this session begins accepting check-ins. */
export function opensAt(session: StartedSession): Date {
  return new Date(session.startedAt.getTime() - OPENS_BEFORE_START_MINUTES * 60 * 1000);
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
export function statusForCheckIn(session: StartedSession, checkedInAt: Date): "PRESENT" | "LATE" {
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
export function extendedEndsAt(session: StartedSession, now: Date): Date {
  const from = Math.max(session.endsAt.getTime(), now.getTime());
  return new Date(from + EXTEND_MINUTES * 60 * 1000);
}

/** Whether the screen should be warning that check-in is about to stop on its own. */
export function isEndingSoon(session: StartedSession, now: Date, withinMinutes = 10): boolean {
  if (sessionStateOf(session, now) !== "open") return false;
  return session.endsAt.getTime() - now.getTime() <= withinMinutes * 60 * 1000;
}
