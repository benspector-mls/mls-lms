import type { CheckLevel } from "@/lib/generated/prisma/enums";

import { latestAttempt } from "./attempts";
import { effectiveLevel, levelCategory } from "./levels";

/**
 * A fellow's recent checks for understanding in one course, for the Trends section of their record
 * and the top of a coaching session.
 *
 * **Two readings, and deliberately no flag.** Attendance and work turn red when a rule trips; a
 * check never does. A fellow was told a check is an honest reading rather than a verdict, and
 * "Blocked" in red on their record would say the opposite. So this reports, in a sentence, and the
 * instructor decides what it means:
 *
 * - **Answered**: of the course's last few checks, how many they answered at all. Not answering may
 *   be the earliest sign somebody has stopped engaging.
 * - **Blocked, and whether they asked**: of those, how many ended Blocked on their latest attempt,
 *   and on how many of those they asked to go over it. Blocked and asking is somebody to follow up
 *   with and thank for asking; blocked and not asking is somebody to offer help to.
 * - **The average level**: the three categories a fellow sees — 1 Blocked, 2 Understands facts,
 *   3 Making connections — averaged over the latest attempts in the window that have a level. It is
 *   what the roster's Performance grid prints, one figure a column can hold and be sorted by.
 *
 * Recent rather than cumulative, the way the other two readings are: the last `CHECK_TREND_RULE`
 * checks attached in the course, newest first, whether or not the fellow answered them.
 *
 * Browser-safe and free of the database, so the rule can be printed beside the reading and tested
 * on its own.
 */

export const CHECK_TREND_RULE = { checksOf: 5 } as const;

export type TrendAttempt = {
  attempt: number;
  level: CheckLevel | null;
  instructorLevel: CheckLevel | null;
  wantsHelp: boolean;
};

export type RecentChecks = {
  /** How many checks the window holds: the rule's number, or fewer in a course with fewer. */
  checks: number;
  /** Of those, how many the fellow answered at least once. */
  answered: number;
  /** Of those answered, how many ended Blocked on the latest attempt. */
  blocked: number;
  /** Of the blocked ones, how many they asked to go over with an instructor, on any attempt. */
  blockedAskedHelp: number;
  /** Of the ones not blocked, how many they asked for help on anyway. */
  otherAskedHelp: number;
  /**
   * The mean category, from 1 to 3, of the latest attempts that have a level. Null when none has
   * one yet — nothing answered, or every answer still waiting on its review.
   */
  averageLevel: number | null;
};

/**
 * The reading, from every check in one course with the fellow's attempts at each. The caller passes
 * every check; the window is taken here, so the rule lives in one place.
 */
export function recentChecks(
  checks: readonly { createdAt: Date; attempts: readonly TrendAttempt[] }[],
): RecentChecks {
  const window = [...checks]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, CHECK_TREND_RULE.checksOf);

  const reading: RecentChecks = {
    checks: window.length,
    answered: 0,
    blocked: 0,
    blockedAskedHelp: 0,
    otherAskedHelp: 0,
    averageLevel: null,
  };
  let levelled = 0;
  let categoryTotal = 0;

  for (const check of window) {
    const latest = latestAttempt(check.attempts);
    if (!latest) continue;

    reading.answered += 1;
    const askedHelp = check.attempts.some((attempt) => attempt.wantsHelp);

    const level = effectiveLevel(latest);
    if (level) {
      levelled += 1;
      categoryTotal += levelCategory(level);
    }

    if (effectiveLevel(latest) === "BLOCKED") {
      reading.blocked += 1;
      if (askedHelp) reading.blockedAskedHelp += 1;
    } else if (askedHelp) {
      reading.otherAskedHelp += 1;
    }
  }

  reading.averageLevel = levelled === 0 ? null : categoryTotal / levelled;
  return reading;
}

/**
 * The reading as the record prints it, e.g. "answered 4 of the last 5 checks; blocked on 2 of
 * them, and asked for help on 1 of those". Null when the course has no checks, so the caller can
 * leave the course out rather than print a sentence about nothing.
 */
export function recentChecksSentence(reading: RecentChecks): string | null {
  if (reading.checks === 0) return null;

  const window =
    reading.checks === CHECK_TREND_RULE.checksOf
      ? `the last ${reading.checks} checks`
      : reading.checks === 1
        ? "the 1 check so far"
        : `the ${reading.checks} checks so far`;

  const answered =
    reading.answered === 0
      ? `answered none of ${window}`
      : reading.answered === reading.checks && reading.checks > 1
        ? `answered all of ${window}`
        : `answered ${reading.answered} of ${window}`;

  const parts = [answered];

  if (reading.blocked > 0) {
    const onBlocked =
      reading.blocked === 1 ? "blocked on 1 of them" : `blocked on ${reading.blocked} of them`;
    const asked =
      reading.blockedAskedHelp === 0
        ? reading.blocked === 1
          ? "and did not ask for help on it"
          : "and did not ask for help on any of those"
        : reading.blockedAskedHelp === reading.blocked
          ? reading.blocked === 1
            ? "and asked for help on it"
            : "and asked for help on all of those"
          : `and asked for help on ${reading.blockedAskedHelp} of those`;
    parts.push(`${onBlocked}, ${asked}`);
  }

  if (reading.otherAskedHelp > 0) {
    const count = reading.otherAskedHelp;
    parts.push(
      reading.blocked > 0
        ? `asked for help on ${count} other ${count === 1 ? "check" : "checks"}`
        : `asked for help on ${count} of them`,
    );
  }

  return parts.join("; ");
}
