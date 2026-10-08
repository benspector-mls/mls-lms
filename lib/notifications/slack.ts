import "server-only";

import { displayNameOf } from "@/lib/people";
import { db, type Tx } from "@/lib/prisma";
import { gradingQueueHref, studentAssignmentHref } from "@/lib/links";
import { isSlackConfigured, lookupUserIdByEmail, sendDm } from "@/lib/slack/client";
import { commentExcerpt } from "@/lib/submissions/comments";
import type { SubmissionCommentAuthor } from "@/lib/generated/prisma/enums";

import { absoluteHref, commentDmText, feedbackDmText } from "./messages";
import { commentRecipients, feedbackRecipients } from "./recipients";

/**
 * The immediate Slack sends: one DM at the moment feedback is released, one at the moment a
 * comment is posted.
 *
 * **Neither function can fail its caller.** Both are awaited inside a try/catch that only logs,
 * following the precedent of the GitHub comment inside `approveDraft`: the grade or the comment
 * is already recorded when these run, a DM is a convenience layer over it, and the in-app lists
 * remain the authoritative record. A failed immediate send is dropped rather than retried —
 * digest users get self-healing for free from the watermark, and an immediate user who missed
 * one DM still has the application itself.
 *
 * Both no-op before touching the database when `SLACK_BOT_TOKEN` is unset, which is what makes
 * development and every existing test indifferent to this module's existence.
 */

/** The profile columns a send needs. */
const sendProfileSelect = {
  id: true,
  email: true,
  slackEmail: true,
  slackUserId: true,
} as const;

type SendProfile = { id: string; email: string | null; slackEmail: string | null; slackUserId: string | null };

/**
 * The recipient's Slack member id, or null when they cannot be reached.
 *
 * The cached id wins; otherwise the email they use in Slack (or their sign-in email) is looked
 * up, and the outcome is written back — the id on success, the failed-at mark on
 * `users_not_found`. The lookup runs again on every event while unresolved, so somebody who
 * joins the workspace later starts receiving DMs with nothing to press.
 */
export async function resolveSlackUserId(client: Tx, profile: SendProfile): Promise<string | null> {
  if (profile.slackUserId) return profile.slackUserId;
  if (!isSlackConfigured()) return null;

  const email = (profile.slackEmail ?? profile.email)?.toLowerCase();
  if (!email) return null;

  const result = await lookupUserIdByEmail(email);
  if (result.ok) {
    await client.profile.update({
      where: { id: profile.id },
      data: { slackUserId: result.userId, slackLookupFailedAt: null },
    });
    return result.userId;
  }

  if (result.notFound) {
    await client.profile.update({
      where: { id: profile.id },
      data: { slackLookupFailedAt: new Date() },
    });
  } else {
    console.error(`slack: lookup for profile ${profile.id} failed: ${result.error}`);
  }
  return null;
}

/**
 * The recipients who want a DM right now: the named profiles, minus test students, minus
 * everyone whose event cadence is not IMMEDIATE. One query, and the `testStudentNumber: null` is
 * the single place every immediate send excludes test rows.
 */
async function immediateProfiles(client: Tx, profileIds: string[]): Promise<SendProfile[]> {
  if (profileIds.length === 0) return [];
  return client.profile.findMany({
    where: { id: { in: profileIds }, testStudentNumber: null, slackEventCadence: "IMMEDIATE" },
    select: sendProfileSelect,
  });
}

/** Sequential on purpose: Slack allows roughly one message per second per channel. */
async function sendToEach(client: Tx, profiles: SendProfile[], text: string): Promise<void> {
  for (const profile of profiles) {
    const slackUserId = await resolveSlackUserId(client, profile);
    if (!slackUserId) continue;

    const sent = await sendDm(slackUserId, text);
    if (!sent.ok) console.error(`slack: DM to profile ${profile.id} failed: ${sent.error}`);
  }
}

/**
 * Step three of releasing a grade: tell the student (and, on team work, every member) over
 * Slack. Called by `approveDraft` after the grade is committed and the GitHub comment attempted,
 * so a DM can never precede the recorded grade.
 */
export async function notifyFeedbackReleased(args: {
  client?: Tx;
  submission: {
    studentId: string;
    mirrors: readonly { studentId: string }[];
    assignmentId: string;
    assignment: { title: string; courseId: string; course: { name: string } };
  };
  finalScore: number;
  finalScorePossible: number;
  isComplete: boolean;
}): Promise<void> {
  if (!isSlackConfigured()) return;
  const client = args.client ?? db;

  try {
    const profiles = await immediateProfiles(client, feedbackRecipients(args.submission));
    if (profiles.length === 0) return;

    const text = feedbackDmText({
      assignmentTitle: args.submission.assignment.title,
      courseName: args.submission.assignment.course.name,
      finalScore: args.finalScore,
      finalScorePossible: args.finalScorePossible,
      isComplete: args.isComplete,
      href: absoluteHref(
        studentAssignmentHref(args.submission.assignment.courseId, args.submission.assignmentId),
      ),
    });

    await sendToEach(client, profiles, text);
  } catch (err) {
    console.error("slack: feedback notification failed", err);
  }
}

/**
 * A comment reaching the other side of the conversation: the fellow (and team) for an
 * instructor's comment, the participating instructors and the grader for a fellow's. Called by
 * `submissionComments.post` after the comment is written.
 */
export async function notifyCommentPosted(args: {
  client?: Tx;
  /** The thread's own row — already collapsed through team mirrors by the caller. */
  submissionId: string;
  body: string;
  author: {
    id: string;
    role: SubmissionCommentAuthor;
    displayName: string | null;
    email: string | null;
    githubUsername: string | null;
  };
}): Promise<void> {
  if (!isSlackConfigured()) return;
  const client = args.client ?? db;

  try {
    const thread = await client.submission.findUnique({
      where: { id: args.submissionId },
      select: {
        studentId: true,
        gradedById: true,
        assignmentId: true,
        mirrors: { select: { studentId: true } },
        assignment: { select: { title: true, courseId: true } },
        comments: {
          where: { authorRole: "INSTRUCTOR", deletedAt: null },
          distinct: ["authorId"],
          select: { authorId: true },
        },
      },
    });
    if (!thread) return;

    const recipientIds = commentRecipients({
      authorId: args.author.id,
      authorRole: args.author.role,
      thread: {
        studentId: thread.studentId,
        gradedById: thread.gradedById,
        mirrorStudentIds: thread.mirrors.map((m) => m.studentId),
        instructorAuthorIds: thread.comments.map((c) => c.authorId),
      },
    });

    const profiles = await immediateProfiles(client, recipientIds);
    if (profiles.length === 0) return;

    // A fellow's question sends the instructor to the grading queue; an instructor's answer
    // sends the fellow to their own assignment page. The recipient set never mixes the two.
    const href =
      args.author.role === "STUDENT"
        ? gradingQueueHref(thread.assignment.courseId, thread.assignmentId, args.submissionId)
        : studentAssignmentHref(thread.assignment.courseId, thread.assignmentId);

    const text = commentDmText({
      authorName: displayNameOf(args.author, "Someone"),
      assignmentTitle: thread.assignment.title,
      excerpt: commentExcerpt(args.body),
      href: absoluteHref(href),
    });

    await sendToEach(client, profiles, text);
  } catch (err) {
    console.error("slack: comment notification failed", err);
  }
}
