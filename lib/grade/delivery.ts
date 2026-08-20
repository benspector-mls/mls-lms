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
 * Why a draft may not be released yet, or null when it is ready.
 *
 * **A score is required on every section. Written feedback is not.**
 *
 * The score is what the gradebook records, what completion is judged against, and the one thing
 * no other place can supply — so a section without one cannot be released. A hand-graded draft
 * starts with every box empty, and releasing that would record a zero nobody chose. A score of
 * zero *is* a score: zero for an empty document is a grade an instructor is entitled to give, so
 * the test is `=== null` and never a falsiness check — the same hazard `effectiveSection` above
 * is written around.
 *
 * Feedback is optional because it is frequently written somewhere else. An instructor grading a
 * Google Doc leaves their comments in the document, where the student is already reading, and
 * repeating them here would be transcription. The student's own page says a section had no
 * written feedback rather than showing them a blank.
 *
 * The exception is a submission with a pull request. There the comment this posts *is* how the
 * feedback reaches the student, so a grade with no text anywhere would post an empty comment —
 * and an empty comment is not merely unhelpful. It fails to send, `deliveryOutcome` reads the
 * absent comment id as a delivery that failed, and the submission then sits in
 * `comment_not_posted` permanently with a retry that cannot succeed. One section with something
 * in it is enough; `buildFeedbackMarkdown` drops the empty ones.
 *
 * Pure, and here rather than in `approve.ts`, so the rule can be read and tested without a
 * database or a GitHub client behind it.
 */
export function blankSectionRefusal(
  sections: { sectionType: string; reportMarkdown: string | null; scoreEarned: number | null }[],
  options: {
    /**
     * Whether this submission has a pull request to post the feedback comment to.
     * `hasSomewhereToPost` above is what answers it at the call site.
     */
    hasPullRequest: boolean;
  },
): string | null {
  const noScore = sections.filter((section) => section.scoreEarned === null);

  if (noScore.length > 0) {
    const named =
      `${noScore.map((section) => `"${section.sectionType}"`).join(", ")} ` +
      `${noScore.length === 1 ? "has" : "have"}`;

    return (
      `${named} no score. Every section needs one before releasing — a section left blank ` +
      `would be recorded as a zero nobody chose. Written feedback is optional and a score of ` +
      `zero is a real grade; the score itself is what cannot be missing.`
    );
  }

  if (options.hasPullRequest && sections.every((section) => !section.reportMarkdown?.trim())) {
    return (
      `Every section is blank, and this grade posts a comment to the pull request — which is ` +
      `where the student reads their feedback, so an empty one tells them nothing. Write ` +
      `feedback in at least one section.`
    );
  }

  return null;
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
