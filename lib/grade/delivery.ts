import type { Prisma } from "../generated/prisma/client";

/**
 * Everything approval decides before it writes anything.
 *
 * Split out of `approve.ts` for the reason `report-text.ts` was: that module reaches Prisma and
 * Octokit, so borrowing one of these functions meant pulling a database client and a GitHub
 * client in behind it. The review interface needs some of these in the browser, a unit test
 * needs all of them, and neither can carry an installation token to get them.
 *
 * The rule for what belongs here is the one that makes it useful: **no imports that do
 * anything.** A type from the generated client is fine, because it is erased. Everything in
 * `approve.ts` proper writes rows or posts a comment.
 *
 * `approve.ts` re-exports all of these, so no caller had to move.
 */

/**
 * Whether there is anywhere to post a comment at all.
 *
 * Both columns, because addressing a comment needs both and either being null means there is no
 * pull request to address. A Google Doc or an uploaded file never has one, so this is false for
 * every hand-graded submission rather than being a fault of one.
 */
export function hasSomewhereToPost<
  T extends { prNumber: number | null; repoFullName: string | null },
>(submission: T): submission is T & { prNumber: number; repoFullName: string } {
  return submission.prNumber !== null && submission.repoFullName !== null;
}

/**
 * Approved drafts whose comment never reached a pull request that exists.
 *
 * A function rather than an object so the submission condition cannot be dropped: every caller
 * scopes the query differently — one submission, one assignment, a whole course — and merging
 * their scope in here is what stops the deliverability test from being forgotten at one of the
 * four call sites. Forgetting it is not a near miss. `triageBucket` reads `comment_not_posted`
 * ahead of every other bucket, so a hand-graded submission matched by a query without it sits in
 * triage, the grading queue, and the gradebook as work forever, and nothing an instructor can do
 * clears it.
 *
 * The same rule as `hasSomewhereToPost` above, expressed for the database. They are deliberately
 * adjacent: one decides what a loaded row means and the other decides which rows come back, and
 * a difference between them would be invisible from either side.
 */
export function undeliveredApprovalWhere(
  submission: Prisma.SubmissionWhereInput = {},
): Prisma.GradingDraftWhereInput {
  return {
    status: "APPROVED",
    postedPrCommentId: null,
    submission: { ...submission, prNumber: { not: null }, repoFullName: { not: null } },
  };
}

/**
 * What became of an approval's feedback comment.
 *
 * Three outcomes rather than two, decided here rather than re-derived by each reader.
 * `postedPrCommentId` alone cannot tell the difference between a comment that failed to send and
 * one there was never anywhere to send: both are null. Collapsing them reported an impossibility
 * as a fault in three places at once — a toast saying the comment did not post, a retry button
 * that could never succeed, and a triage entry nothing could clear.
 *
 * A pure function over a loaded draft and its submission, not a column, so there is nothing to
 * backfill and nothing that can fall out of step with the grade beside it. One edge follows from
 * that and is worth knowing: a repository assignment hand-graded before the student opens a pull
 * request reads as `not_applicable` until they open one, and as `failed` afterwards. That is
 * arguably right — there is somewhere to post now — but it is a behaviour a stored column would
 * not have, and recording the outcome at approval time is the alternative if it ever reads as
 * wrong.
 */
export type DeliveryOutcome =
  /** The comment is on the pull request. */
  | "posted"
  /** There is a pull request and the comment did not reach it. Retryable. */
  | "failed"
  /** There is no pull request. Nothing was owed to GitHub and nothing is missing. */
  | "not_applicable";

export function deliveryOutcome(
  draft: { postedPrCommentId: bigint | null },
  submission: { prNumber: number | null; repoFullName: string | null },
): DeliveryOutcome {
  if (draft.postedPrCommentId !== null) return "posted";
  return hasSomewhereToPost(submission) ? "failed" : "not_applicable";
}

/** A section as it stands: the instructor's edit where there is one, else the model's. */
export type EffectiveSection = {
  sectionType: string;
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number | null;
};

/**
 * Which version of a section a student is owed.
 *
 * `??` rather than `||`, which is the whole of it: a score of 0 is a real edit and a falsy one,
 * so `||` would silently restore the model's score every time an instructor zeroed a section.
 */
export function effectiveSection(section: {
  sectionType: string;
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number | null;
  editedReportMarkdown?: string | null;
  editedScoreEarned?: number | null;
}): EffectiveSection {
  return {
    sectionType: section.sectionType,
    reportMarkdown: section.editedReportMarkdown ?? section.reportMarkdown,
    scoreEarned: section.editedScoreEarned ?? section.scoreEarned,
    scorePossible: section.scorePossible,
  };
}

/**
 * Joins each section's report into the single document posted to the pull request.
 *
 * Sections are separated by a rule rather than merged, because they are graded against different
 * rubrics and each already carries its own heading and score line. Rewriting them into one
 * narrative would mean editing text an instructor has already approved.
 */
export function buildFeedbackMarkdown(
  sections: { sectionType: string; reportMarkdown: string | null }[],
): string {
  return sections
    .map((section) => section.reportMarkdown?.trim())
    .filter((markdown): markdown is string => Boolean(markdown))
    .join("\n\n---\n\n");
}
