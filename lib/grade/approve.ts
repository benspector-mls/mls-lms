import "server-only";

import { db, type Tx } from "../prisma";
import { getConfiguredInstallationId } from "../github/app-client";
import { splitRepoFullName } from "../github/archives";
import { postOrUpdatePrComment } from "../github/prs";
import {
  buildFeedbackMarkdown,
  deliveryOutcome,
  effectiveSection,
  hasSomewhereToPost,
  undeliveredApprovalWhere,
  type DeliveryOutcome,
  type EffectiveSection,
} from "./delivery";
import { statedScoreInText } from "./report-text";

/**
 * Approving a grading draft: the moment a draft stops being a suggestion and becomes
 * the student's grade.
 *
 * Two steps that deliberately do not share a transaction.
 *
 * The grade is written to PostgreSQL first and on its own. Posting the comment is a
 * network call to GitHub, and holding a database transaction open across one would tie
 * up a pooled connection for as long as GitHub takes to answer — under a cohort's worth
 * of approvals that is how a connection pool runs dry.
 *
 * The comment is then posted best-effort. A GitHub outage must not prevent an
 * instructor from grading: the student's own assignment page reads the graded columns
 * and needs nothing from GitHub, so a failed post leaves a complete grade with an
 * unposted comment, which `retryComment` fixes later. The reverse ordering would be
 * worse in every way — a student receiving a comment about a grade the database does
 * not have.
 *
 * **Each approval posts a new comment rather than editing the last one.** Feedback on
 * a resubmission is not a correction of the earlier feedback; it describes different
 * work, and the pair of them read together is the record of what a student changed.
 * Overwriting would destroy exactly the history that makes growth visible. Interfaces
 * collapse the older rounds; they do not discard them.
 */

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

/**
 * The decisions approval makes before it writes anything, re-exported from `./delivery`.
 *
 * They live there rather than here so that borrowing one does not pull a database client and a
 * GitHub client in behind it — this module reaches both, and the review interface needs some of
 * them in the browser while a unit test needs all of them. Re-exported so every existing caller
 * goes on importing them from the module whose behaviour they describe. The same arrangement,
 * and the same reason, as `statedScoreInText` below.
 */
export {
  buildFeedbackMarkdown,
  deliveryOutcome,
  effectiveSection,
  hasSomewhereToPost,
  undeliveredApprovalWhere,
};
export type { DeliveryOutcome, EffectiveSection };

export type ApprovalResult = {
  submissionId: string;
  finalScore: number;
  finalScorePossible: number;
  isComplete: boolean;
  /** Null when the comment could not be posted. The grade is recorded regardless. */
  postedPrCommentId: bigint | null;
  /**
   * What became of the comment. `not_applicable` is an ordinary, finished outcome — the
   * interface says "released" and offers no retry — so a reader must branch on this rather
   * than on `postedPrCommentId` being null.
   */
  delivery: DeliveryOutcome;
  /**
   * Why posting failed, for the interface to show alongside a recorded grade. Null unless
   * `delivery` is `failed`: having nowhere to post is not an error and has no message.
   */
  commentError: string | null;
};

/**
 * Re-exported from `report-text`, which has no database or network imports so the review
 * interface can run the same check in the browser. Shared with the cross-check, and
 * needed again at approval because an instructor can change the prose and the number
 * independently. Editing "28/30" into the text without changing the recorded score would
 * hand the student one figure and the gradebook another, which is the failure the whole
 * two-column design exists to avoid.
 */
export { statedScoreInText };

export async function approveDraft(params: {
  draftId: string;
  /** The instructor doing the approving. Recorded as `gradedBy`. */
  approvedByProfileId: string;
  /**
   * The client to write through. Defaults to the application's own. A caller passing its
   * transaction gets the two writes below run in order rather than in a nested transaction,
   * since it is already inside one.
   */
  client?: Tx;
}): Promise<ApprovalResult> {
  const client = params.client ?? db;

  const draft = await client.gradingDraft.findUnique({
    where: { id: params.draftId },
    select: {
      id: true,
      headSha: true,
      status: true,
      approvedAt: true,
      submissionId: true,
      sections: {
        select: {
          sectionType: true,
          reportMarkdown: true,
          scoreEarned: true,
          scorePossible: true,
          editedReportMarkdown: true,
          editedScoreEarned: true,
        },
      },
      submission: {
        select: {
          id: true,
          headSha: true,
          prNumber: true,
          repoFullName: true,
          assignment: { select: { completionThreshold: true } },
        },
      },
    },
  });

  if (!draft) throw new ApprovalError(`No grading draft ${params.draftId}.`);

  if (draft.status === "FAILED" || draft.status === "GENERATING") {
    throw new ApprovalError(
      `This draft is ${draft.status.toLowerCase()} and has no report to post. ` +
        `Generate a new one.`,
    );
  }
  if (draft.status === "SUPERSEDED") {
    throw new ApprovalError(`This draft was superseded by a newer commit. Generate a new one.`);
  }

  // Approving twice would post the same feedback to the pull request a second time.
  // Comments accumulate by design now, so a duplicate is not overwritten by the next
  // approval — it sits in the history looking like a second round of review.
  if (draft.approvedAt !== null) {
    throw new ApprovalError(
      `This draft was already approved on ${draft.approvedAt.toLocaleString()}. ` +
        `Approving it again would post the same feedback twice.`,
    );
  }

  const submission = draft.submission;

  // Refused rather than warned about. The instructor read a report describing one
  // commit; approving it would attach that report to different code and record its
  // score as the grade for work nobody has looked at. Regenerating is one click.
  //
  // Both commits are required to compare. A draft with none belongs to work that has none
  // — a document or an upload — and there is nothing it could be out of date against;
  // `startManual` copies the submission's commit whenever there is one, so the two columns
  // are null together rather than one at a time.
  if (submission.headSha && draft.headSha && draft.headSha !== submission.headSha) {
    throw new ApprovalError(
      `This draft describes commit ${draft.headSha.slice(0, 7)}, but the pull request ` +
        `is now at ${submission.headSha.slice(0, 7)}. Regenerate the report so the grade ` +
        `describes the code that is actually there.`,
    );
  }

  if (draft.sections.length === 0) {
    throw new ApprovalError(`This draft has no sections, so there is nothing to post.`);
  }

  // Instructor edits where they exist, the model's output where they do not.
  const sections = draft.sections.map(effectiveSection);

  /*
    A section nobody has filled in. This is what a hand-graded draft starts as — blank text
    and no score — and releasing one would record a real zero for work nobody assessed and
    show the student an empty report. Refused rather than treated as 0, because the two are
    indistinguishable downstream once written and only one of them is ever meant.

    An AI-graded section cannot reach this: the model's output is schema-constrained to carry
    both, and `updateSection` refuses empty text rather than storing it.
  */
  const unscored = sections.filter(
    (section) => section.scoreEarned === null || !section.reportMarkdown?.trim(),
  );

  if (unscored.length > 0) {
    throw new ApprovalError(
      `${unscored.map((section) => `"${section.sectionType}"`).join(", ")} ` +
        `${unscored.length === 1 ? "has" : "have"} no score or no feedback written yet. ` +
        `Fill in every section before releasing — a blank section would be recorded as a ` +
        `zero and shown to the student as an empty report.`,
    );
  }

  // The number in the prose against the number being recorded. An instructor revising a
  // report is expected — writing "27/30" into the text while the recorded score stays
  // 30 is the one edit that must not go out, because the student reads the prose and
  // every other part of the system reads the column.
  //
  // Refused rather than silently reconciled: only the instructor knows which of the two
  // they meant.
  for (const section of sections) {
    if (!section.reportMarkdown) continue;
    const stated = statedScoreInText(section.reportMarkdown);
    if (!stated) continue;

    if (stated.earned !== section.scoreEarned || stated.possible !== section.scorePossible) {
      throw new ApprovalError(
        `The ${section.sectionType.replace(/_/g, " ")} report says ` +
          `${stated.earned}/${stated.possible} but the score being recorded is ` +
          `${section.scoreEarned}/${section.scorePossible}. Change whichever is wrong — ` +
          `the student reads the report and the gradebook reads the score.`,
      );
    }
  }

  // Summed across sections, because each is graded against its own rubric and its own
  // point value. This is the number the gradebook holds.
  const finalScore = sections.reduce((total, s) => total + (s.scoreEarned ?? 0), 0);
  const finalScorePossible = sections.reduce((total, s) => total + (s.scorePossible ?? 0), 0);

  if (finalScorePossible <= 0) {
    throw new ApprovalError(
      `This draft's sections are worth 0 points in total, so completion cannot be ` +
        `determined. Check the assignment's per-section point values.`,
    );
  }

  const threshold = submission.assignment.completionThreshold;
  const isComplete = finalScore / finalScorePossible >= threshold;
  const feedbackMarkdown = buildFeedbackMarkdown(sections);
  const approvedAt = new Date();

  // ---- Step one: the grade ------------------------------------------------
  //
  // Both rows together, because a draft marked APPROVED whose submission is not GRADED
  // — or the reverse — would put the feedback history and the gradebook out of step.
  // Both are local writes, so the transaction closes without waiting on anything.
  const writes = [
    client.submission.update({
      where: { id: submission.id },
      data: {
        status: "GRADED",
        finalScore,
        finalScorePossible,
        isComplete,
        // The current grade, denormalized from the approved draft so a student's page
        // is one read. The drafts remain the history.
        feedbackMarkdown,
        gradedById: params.approvedByProfileId,
        gradedAt: approvedAt,
        // What the grade describes. Everything that later asks "has this been revised
        // since it was graded" compares against this and nothing else.
        gradedHeadSha: draft.headSha,
        salesforceSyncStatus: "PENDING",
      },
    }),
    client.gradingDraft.update({
      where: { id: draft.id },
      data: {
        status: "APPROVED",
        approvedAt,
        approvedById: params.approvedByProfileId,
      },
    }),
  ];

  /*
    Decided from whether a client was handed in, not by asking the client what it is. A
    transaction client still carries `$transaction` at runtime even though its type omits it,
    and calling it opens a *second* transaction on a different connection — which cannot see
    the rows the caller's own transaction has written, and fails with "no record was found for
    an update" on a row that is plainly there.

    So: a caller that passed its client is already inside a transaction and owns the atomicity;
    the two writes run in order. Otherwise this opens the transaction itself, which is what
    every request does.
  */
  if (params.client) {
    for (const write of writes) await write;
  } else {
    await db.$transaction(writes);
  }

  // ---- Step two: the comment, best effort ---------------------------------
  let postedPrCommentId: bigint | null = null;
  let commentError: string | null = null;

  /*
    A submission with no pull request is not a delivery that failed. Every hand-graded
    assignment is in this state permanently — a Google Doc is commented on in the document
    and an uploaded file has nowhere to comment at all — so the grade is complete here and
    `deliveryOutcome` below names it `not_applicable` rather than leaving an error message
    for a step that was never owed.
  */
  if (hasSomewhereToPost(submission)) {
    try {
      // No existingCommentId: a new comment every time. Earlier rounds of feedback
      // stay on the pull request where a student can read back through them.
      const comment = await postOrUpdatePrComment(getConfiguredInstallationId(), {
        ...splitRepoFullName(submission.repoFullName),
        issueNumber: submission.prNumber,
        body: feedbackMarkdown,
      });

      postedPrCommentId = BigInt(comment.id);
      await client.gradingDraft.update({
        where: { id: draft.id },
        data: { postedPrCommentId },
      });
    } catch (err) {
      commentError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    submissionId: submission.id,
    finalScore,
    finalScorePossible,
    isComplete,
    postedPrCommentId,
    delivery: deliveryOutcome({ postedPrCommentId }, submission),
    commentError,
  };
}

/**
 * Posts the comment for an approval whose comment never went out.
 *
 * Exists because the grade and the comment are written separately: a GitHub outage
 * during approval leaves a correct grade with nothing posted, and that state needs a
 * way out that is not "approve it again".
 */
export async function retryComment(submissionId: string): Promise<ApprovalResult> {
  // The most recent approval, which is the one whose comment is missing. Older
  // approvals posted their own comments and are not reposted — that would duplicate
  // history rather than repair it.
  const draft = await db.gradingDraft.findFirst({
    where: { submissionId, status: "APPROVED" },
    orderBy: { approvedAt: "desc" },
    select: {
      id: true,
      postedPrCommentId: true,
      // The same text the approval would have posted, edits included.
      sections: {
        select: {
          sectionType: true,
          reportMarkdown: true,
          scoreEarned: true,
          scorePossible: true,
          editedReportMarkdown: true,
          editedScoreEarned: true,
        },
      },
      submission: {
        select: {
          id: true,
          prNumber: true,
          repoFullName: true,
          finalScore: true,
          finalScorePossible: true,
          isComplete: true,
        },
      },
    },
  });

  if (!draft) {
    throw new ApprovalError(`No approved draft for submission ${submissionId}.`);
  }
  if (draft.postedPrCommentId !== null) {
    throw new ApprovalError(
      `This approval's comment was already posted. Posting again would add a second ` +
        `copy of the same feedback.`,
    );
  }

  const submission = draft.submission;
  if (!hasSomewhereToPost(submission)) {
    // Reached only by a caller that offered a retry it should not have. Nothing is
    // missing on this submission, so the message says that rather than implying a failure.
    throw new ApprovalError(
      `This submission has no pull request, so there is no comment to post. Its feedback ` +
        `is already released and the student can read it.`,
    );
  }

  const comment = await postOrUpdatePrComment(getConfiguredInstallationId(), {
    ...splitRepoFullName(submission.repoFullName),
    issueNumber: submission.prNumber,
    body: buildFeedbackMarkdown(draft.sections.map(effectiveSection)),
  });

  const postedPrCommentId = BigInt(comment.id);
  await db.gradingDraft.update({
    where: { id: draft.id },
    data: { postedPrCommentId },
  });

  return {
    submissionId: submission.id,
    finalScore: submission.finalScore ?? 0,
    finalScorePossible: submission.finalScorePossible ?? 0,
    isComplete: submission.isComplete ?? false,
    postedPrCommentId,
    delivery: "posted",
    commentError: null,
  };
}
