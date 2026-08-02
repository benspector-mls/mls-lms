import "server-only";

import { db } from "../prisma";
import { getConfiguredInstallationId } from "../github/app-client";
import { splitRepoFullName } from "../github/archives";
import { postOrUpdatePrComment } from "../github/prs";

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

export type ApprovalResult = {
  submissionId: string;
  finalScore: number;
  finalScorePossible: number;
  isComplete: boolean;
  /** Null when the comment could not be posted. The grade is recorded regardless. */
  postedPrCommentId: bigint | null;
  /** Why posting failed, for the interface to show alongside a recorded grade. */
  commentError: string | null;
};

/** A section as it stands: the instructor's edit where there is one, else the model's. */
export type EffectiveSection = {
  sectionType: string;
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number | null;
};

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
 * Sections are separated by a rule rather than merged, because they are graded against
 * different rubrics and each already carries its own heading and score line. Rewriting
 * them into one narrative would mean editing text an instructor has already approved.
 */
export function buildFeedbackMarkdown(
  sections: { sectionType: string; reportMarkdown: string | null }[],
): string {
  return sections
    .map((section) => section.reportMarkdown?.trim())
    .filter((markdown): markdown is string => Boolean(markdown))
    .join("\n\n---\n\n");
}

/**
 * The score a report's own text claims, or null if it states none.
 *
 * Shared with the cross-check, and needed again at approval because an instructor can
 * change the prose and the number independently. Editing "28/30" into the text without
 * changing the recorded score would hand the student one figure and the gradebook
 * another, which is the failure the whole two-column design exists to avoid.
 */
export function statedScoreInText(
  markdown: string,
): { earned: number; possible: number } | null {
  const match = markdown.match(/^#{1,3}\s.*?Score:\s*([\d.]+)\s*\/\s*([\d.]+)/im);
  return match ? { earned: Number(match[1]), possible: Number(match[2]) } : null;
}

export async function approveDraft(params: {
  draftId: string;
  /** The instructor doing the approving. Recorded as `gradedBy`. */
  approvedByProfileId: string;
}): Promise<ApprovalResult> {
  const draft = await db.gradingDraft.findUnique({
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
    throw new ApprovalError(
      `This draft was superseded by a newer commit. Generate a new one.`,
    );
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
  if (submission.headSha && draft.headSha !== submission.headSha) {
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
  await db.$transaction([
    db.submission.update({
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
    db.gradingDraft.update({
      where: { id: draft.id },
      data: {
        status: "APPROVED",
        approvedAt,
        approvedById: params.approvedByProfileId,
      },
    }),
  ]);

  // ---- Step two: the comment, best effort ---------------------------------
  let postedPrCommentId: bigint | null = null;
  let commentError: string | null = null;

  if (!submission.repoFullName || submission.prNumber === null) {
    commentError = "This submission has no pull request, so nothing was posted.";
  } else {
    try {
      // No existingCommentId: a new comment every time. Earlier rounds of feedback
      // stay on the pull request where a student can read back through them.
      const comment = await postOrUpdatePrComment(getConfiguredInstallationId(), {
        ...splitRepoFullName(submission.repoFullName),
        issueNumber: submission.prNumber,
        body: feedbackMarkdown,
      });

      postedPrCommentId = BigInt(comment.id);
      await db.gradingDraft.update({
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
  if (!submission.repoFullName || submission.prNumber === null) {
    throw new ApprovalError(`This submission has no pull request to post to.`);
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
    commentError: null,
  };
}
