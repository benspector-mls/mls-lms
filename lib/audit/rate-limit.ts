import "server-only";

import { TRPCError } from "@trpc/server";

import type { AuditAction } from "../generated/prisma/client";
import type { Tx } from "../prisma";

/**
 * A ceiling on how often one person can trigger something expensive.
 *
 * **What this is protecting, stated plainly, because it decides the whole design.** The two
 * operations it guards are reachable only by an instructor or an admin, so this is not a defence
 * against a stranger — the procedure builders in `trpc/init.ts` are. It is a defence against a
 * loop: a batch screen retried in a tight loop, a script left running, a button double-clicked
 * forty times. Each one of those spends real money at Anthropic and E2B, and none of them is
 * malicious. A limit that stops a mistake at fifty rather than at fifty thousand is the whole
 * ambition.
 *
 * **Counted out of `audit_events` rather than a counter of its own**, which is worth justifying
 * because a rate limiter with no table is unusual. The event log is already append-only, already
 * carries `actor_id` and `occurred_at`, and already has the index this query wants — so a separate
 * table would be a second write, a second thing to prune, and a second answer to "how many times
 * has this person done that". It also means the limit and the record cannot disagree: an operation
 * that was allowed is one the log knows about, because the log is what allowed it.
 *
 * **Not a distributed limiter, and not trying to be.** Two requests arriving in the same
 * millisecond can both read a count below the ceiling and both proceed. At the size this runs at —
 * one school, a handful of staff — the difference between stopping at fifty and stopping at
 * fifty-one is nothing, and buying exactness would mean Redis, a lease, or a lock held across a
 * call that takes tens of seconds. If this ever needs to be exact, the answer is a unique
 * constraint on a window key, not a bigger cache.
 */

/** How many of one thing, in how long. */
export type RateLimit = {
  max: number;
  windowMinutes: number;
};

/**
 * Generating a grading draft: a model call over a whole repository. Two ceilings, because a loop
 * and a working instructor differ in one specific way — a loop hits the same submission again and
 * again, where an instructor touches each submission once or a few times — and a count per person
 * cannot tell them apart. A per-person ceiling has to sit above the largest honest session, which
 * is a number that has to be raised every time the roster grows.
 *
 * **Per submission.** The worst honest hour on one submission is about five attempts: the first
 * generation; a second after running the tests the first was refused for lacking; a third after a
 * model or sandbox error; a fourth after editing the rubric; a fifth after the fellow pushes a new
 * commit; and a double-click, whose second press `claimRun` refuses but which was already recorded.
 * Ten sits above that with room to spare, and a loop is caught either way, because a stuck screen
 * hits one submission dozens of times. This ceiling grows with the work by itself, because the
 * work is what it counts: a cohort of 25 allows 250 honest generations an hour and a cohort of 200
 * allows 2,000, with no number to raise.
 */
export const DRAFT_GENERATION_PER_SUBMISSION_LIMIT: RateLimit = { max: 10, windowMinutes: 60 };

/**
 * **Per person**, as a statement about money rather than about work. Ten per submission stops a
 * runaway at ten times the cohort, which for a cohort of 200 is 2,000 reports, or about $300 at the
 * measured cost of a report. Five hundred an hour caps that at about $75 whatever the cohort, and
 * no honest session reaches it: that would be a hundred submissions generated five times each in
 * one hour. The only reason to move this number is a change in how much a runaway may spend.
 */
export const DRAFT_GENERATION_LIMIT: RateLimit = { max: 500, windowMinutes: 60 };

/**
 * Running an assignment's tests in a sandbox.
 *
 * Higher than draft generation because it is cheaper per run and legitimately repeated: an
 * instructor checking why a submission failed runs the tests, reads the output, and runs them
 * again.
 */
export const TEST_RUN_LIMIT: RateLimit = { max: 60, windowMinutes: 60 };

/**
 * Summarizing a check for understanding's answers: one model call over a whole room's writing.
 *
 * The same ceiling as draft generation. An instructor writes a summary once a check has been
 * answered and again after a retry wave, so a few a day is a real day's use, and twenty an hour
 * is only reachable by a loop.
 */
export const CHECK_SUMMARY_LIMIT: RateLimit = { max: 20, windowMinutes: 60 };

/**
 * Writing one fellow's Themes: one model call over their figures,
 * writing, sessions, notes and feedback.
 *
 * A coaching afternoon is a handful of fellows, each summarized once or twice, so twenty an hour is
 * only reachable by a loop.
 */
export const COACHING_SUMMARY_LIMIT: RateLimit = { max: 20, windowMinutes: 60 };

/**
 * Refuses when this actor has already done this too many times lately.
 *
 * Takes the real actor id rather than a context, so a caller has to have gone through `auditActor`
 * and cannot accidentally count a test student's activity against a test student while an admin
 * is the one pressing the button.
 *
 * The message says when they can continue rather than only that they cannot, because the person
 * reading it is an instructor in the middle of grading and "try again later" is not something they
 * can plan around.
 */
export async function assertWithinRate(
  db: Tx,
  params: {
    actorId: string | null;
    action: AuditAction;
    limit: RateLimit;
    /**
     * Count only this actor's attempts on one subject, for a ceiling that grows with the work: a
     * loop hits the same subject again and again, where honest work touches each one a few times.
     * The noun is for the refusal: "this submission".
     */
    subject?: { id: string; noun: string };
    /** What they were doing, for the refusal: "generate another draft". */
    whatTheyDid: string;
  },
): Promise<void> {
  // No actor means nothing to count against, and every request would share one bucket. Nothing
  // reaches these procedures without a session, so this is a guard rather than a case.
  if (!params.actorId) return;

  const since = new Date(Date.now() - params.limit.windowMinutes * 60 * 1000);

  const recent = await db.auditEvent.count({
    where: {
      actorId: params.actorId,
      action: params.action,
      ...(params.subject ? { subjectId: params.subject.id } : {}),
      occurredAt: { gte: since },
    },
  });

  if (recent < params.limit.max) return;

  const on = params.subject ? ` on ${params.subject.noun}` : "";
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message:
      `That is ${recent} times${on} in the last ${params.limit.windowMinutes} minutes, which is ` +
      `the limit. This is here to stop a stuck screen or a loop spending money rather than to stop ` +
      `you working — wait a few minutes and ${params.whatTheyDid} again, or ask an admin if you ` +
      `genuinely need a higher ceiling.`,
  });
}
