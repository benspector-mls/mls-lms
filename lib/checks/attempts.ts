/**
 * When a fellow may answer a check for understanding again: the whole rule, in one place.
 *
 * **The server refuses with this and the fellow's screen draws with it**, for the reason
 * `taskIsSelfMarked` is read in one place: a form drawn where the server will refuse it is a fellow
 * pressing a button and being told no. The server also releases the level-3 exemplar on the same
 * answer — `exhausted` — so the card a fellow sees and the text the server sends agree.
 *
 * **The maximum is a constant and the wait is a column.** Nobody has asked for a per-check maximum,
 * and three is the number the design is built around; the wait is the instructor's choice per
 * check, because a check on this morning's reading and a check on a whole module want different
 * gaps.
 *
 * Browser-safe and free of imports, so a client component can call it with the time it rendered at.
 */

export const MAX_ATTEMPTS = 3;

/** Seven days, which is what a check is given unless the instructor says otherwise. */
export const DEFAULT_RETRY_WAIT_HOURS = 7 * 24;

const HOUR_MS = 60 * 60 * 1000;

export type AttemptState =
  /** The fellow may make attempt number `attempt` now. */
  | { kind: "open"; attempt: number }
  /** Attempt number `attempt` opens at `until`. */
  | { kind: "waiting"; attempt: number; until: Date }
  /** All three are used. This is also what releases the level-3 exemplar to the fellow. */
  | { kind: "exhausted" };

/**
 * What a fellow may do next, given their attempts so far.
 *
 * Measured from the **latest** attempt by number rather than by position in the array, so a
 * caller that happens to pass the rows in another order gets the same answer.
 */
export function nextAttempt(
  attempts: readonly { attempt: number; submittedAt: Date }[],
  retryWaitHours: number,
  now: Date,
): AttemptState {
  if (attempts.length >= MAX_ATTEMPTS) return { kind: "exhausted" };

  const latest = latestAttempt(attempts);
  if (!latest) return { kind: "open", attempt: 1 };

  const next = latest.attempt + 1;
  if (next > MAX_ATTEMPTS) return { kind: "exhausted" };

  const until = new Date(latest.submittedAt.getTime() + retryWaitHours * HOUR_MS);
  return now.getTime() >= until.getTime()
    ? { kind: "open", attempt: next }
    : { kind: "waiting", attempt: next, until };
}

/** The attempt with the highest number, or null when there are none. */
export function latestAttempt<T extends { attempt: number }>(attempts: readonly T[]): T | null {
  let latest: T | null = null;
  for (const attempt of attempts) {
    if (!latest || attempt.attempt > latest.attempt) latest = attempt;
  }
  return latest;
}

/** A stored wait, as the days and hours the authoring form shows. */
export function retryWaitParts(hours: number): { days: number; hours: number } {
  return { days: Math.floor(hours / 24), hours: hours % 24 };
}

/** Days and hours from the authoring form, as the one number the column stores. */
export function retryWaitHoursOf(parts: { days: number; hours: number }): number {
  return parts.days * 24 + parts.hours;
}

/** "7 days", "1 day and 6 hours", "12 hours" — a wait as a fellow reads it. */
export function describeRetryWait(hours: number): string {
  const parts = retryWaitParts(hours);
  const days = parts.days === 1 ? "1 day" : `${parts.days} days`;
  const rest = parts.hours === 1 ? "1 hour" : `${parts.hours} hours`;
  if (parts.days === 0) return rest;
  if (parts.hours === 0) return days;
  return `${days} and ${rest}`;
}
