import "server-only";

import { effectiveSection } from "@/lib/grade/delivery";
import { displayNameOf } from "@/lib/people";
import { db, type Tx } from "@/lib/prisma";
import { gradingQueueHref, studentAssignmentHref } from "@/lib/links";
import { feedbackIsUnread } from "@/lib/status";

import { schoolHourAndWeekday } from "./recipients";
import { awaitsReply, commentExcerpt, isUnread } from "@/lib/submissions/comments";

import { absoluteHref, commentsDigestLine, digestDm, feedbackDigestLine } from "./messages";
import { resolveSlackUserId } from "./slack";

/**
 * The daily and weekly digests, derived entirely from rows that already exist.
 *
 * There is no notifications table. What a digest says is computed from `GradingDraft.approvedAt`,
 * `SubmissionComment.createdAt`, and the read receipts, over the window since the recipient's
 * `slackDigestedTo` watermark. The watermark advances only when a digest goes out (or the window
 * held nothing), so a failed send needs no retry bookkeeping: tomorrow's digest re-covers the
 * same window. A digest also never repeats what its reader already saw — a thread read in-app
 * produces no line for a fellow, and a question answered before 9am produces none for an
 * instructor.
 */

/** An event strictly after the watermark and at or before the run's own `now`. */
type Window = { gt: Date; lte: Date };

/**
 * A fellow's digest: each round of feedback released in the window, then each thread holding
 * instructor comments they have not read.
 *
 * The score is summed per round from `effectiveSection` — the section as sent, the instructor's
 * edit where one exists — rather than read from `Submission.finalScore`, which a second round in
 * the same window would have overwritten. Two releases in one window are two lines.
 */
export async function studentDigestLines(
  client: Tx,
  studentId: string,
  window: Window,
): Promise<string[]> {
  const ownWork = {
    OR: [{ studentId }, { mirrors: { some: { studentId } } }],
  };

  const rounds = await client.gradingDraft.findMany({
    where: { status: "APPROVED", approvedAt: { gt: window.gt, lte: window.lte }, submission: ownWork },
    orderBy: { approvedAt: "asc" },
    select: {
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
          assignmentId: true,
          // What `feedbackIsUnread` reads, so a round the fellow has already opened is left out
          // here exactly as a comment they have already opened is left out below.
          status: true,
          gradedAt: true,
          feedbackReviewedAt: true,
          assignment: {
            select: { title: true, courseId: true, completionThreshold: true, course: { select: { name: true } } },
          },
        },
      },
    },
  });

  /*
    Read state is one column per submission rather than one per round, so this is asked of the
    submission and answers for every round released into the window. A fellow who opened their
    feedback last night hears nothing this morning; a later round makes `feedbackReviewedAt`
    older than `gradedAt` again, which is what puts the work back in the digest.
  */
  const feedbackLines = rounds
    .filter((round) => feedbackIsUnread(round.submission))
    .map((round) => {
    const sections = round.sections.map(effectiveSection);
    const finalScore = sections.reduce((total, s) => total + (s.scoreEarned ?? 0), 0);
    const finalScorePossible = sections.reduce((total, s) => total + (s.scorePossible ?? 0), 0);
    const { assignment } = round.submission;

    return feedbackDigestLine({
      assignmentTitle: assignment.title,
      courseName: assignment.course.name,
      finalScore,
      finalScorePossible,
      isComplete:
        finalScorePossible > 0 && finalScore / finalScorePossible >= assignment.completionThreshold,
      href: absoluteHref(studentAssignmentHref(assignment.courseId, round.submission.assignmentId)),
    });
  });

  const comments = await client.submissionComment.findMany({
    where: {
      authorRole: "INSTRUCTOR",
      deletedAt: null,
      createdAt: { gt: window.gt, lte: window.lte },
      submission: ownWork,
    },
    orderBy: { createdAt: "asc" },
    select: {
      authorId: true,
      authorRole: true,
      createdAt: true,
      deletedAt: true,
      body: true,
      submissionId: true,
      submission: { select: { assignmentId: true, assignment: { select: { title: true, courseId: true } } } },
    },
  });

  // What this fellow already read in-app says nothing new in a digest. One query for the
  // receipts on the touched threads, then the same `isUnread` every screen uses.
  const receipts = new Map(
    (
      await client.submissionCommentRead.findMany({
        where: { profileId: studentId, submissionId: { in: [...new Set(comments.map((c) => c.submissionId))] } },
        select: { submissionId: true, lastReadAt: true },
      })
    ).map((r) => [r.submissionId, r.lastReadAt]),
  );

  const unread = comments.filter((comment) =>
    isUnread(comment, { id: studentId, lastReadAt: receipts.get(comment.submissionId) ?? null }),
  );

  const threads = new Map<string, typeof unread>();
  for (const comment of unread) {
    threads.set(comment.submissionId, [...(threads.get(comment.submissionId) ?? []), comment]);
  }

  const commentLines = [...threads.values()].map((thread) => {
    const newest = thread[thread.length - 1]!;
    return commentsDigestLine({
      count: thread.length,
      assignmentTitle: newest.submission.assignment.title,
      newestExcerpt: commentExcerpt(newest.body),
      href: absoluteHref(
        studentAssignmentHref(newest.submission.assignment.courseId, newest.submission.assignmentId),
      ),
    });
  });

  return [...feedbackLines, ...commentLines];
}

/**
 * An instructor's digest: the threads where a fellow wrote in the window and still awaits a
 * reply at digest time.
 *
 * The submission predicate is the same union `commentRecipients` states — threads this
 * instructor has written in, plus work they graded — and `awaitsReply` is the read filter, since
 * instructors write no read receipts: a question already answered or resolved during the day
 * produces no line.
 */
export async function instructorDigestLines(
  client: Tx,
  instructorId: string,
  window: Window,
): Promise<string[]> {
  const questions = await client.submissionComment.findMany({
    where: {
      authorRole: "STUDENT",
      deletedAt: null,
      createdAt: { gt: window.gt, lte: window.lte },
      submission: {
        OR: [
          { comments: { some: { authorRole: "INSTRUCTOR", authorId: instructorId, deletedAt: null } } },
          { gradedById: instructorId },
        ],
      },
    },
    select: { submissionId: true },
  });

  const submissionIds = [...new Set(questions.map((q) => q.submissionId))];
  if (submissionIds.length === 0) return [];

  const threads = await client.submission.findMany({
    where: { id: { in: submissionIds } },
    select: {
      id: true,
      assignmentId: true,
      commentsResolvedAt: true,
      assignment: { select: { title: true, courseId: true } },
      student: { select: { displayName: true, email: true, githubUsername: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        select: { authorId: true, authorRole: true, createdAt: true, deletedAt: true, body: true },
      },
    },
  });

  return threads
    .filter((thread) => awaitsReply(thread.comments, thread.commentsResolvedAt))
    .map((thread) => {
      const fromFellow = thread.comments.filter(
        (c) =>
          c.authorRole === "STUDENT" &&
          c.deletedAt === null &&
          c.createdAt > window.gt &&
          c.createdAt <= window.lte,
      );
      const newest = fromFellow[fromFellow.length - 1] ?? thread.comments[thread.comments.length - 1]!;

      return commentsDigestLine({
        count: Math.max(fromFellow.length, 1),
        assignmentTitle: thread.assignment.title,
        fellowName: displayNameOf(thread.student, "a fellow"),
        newestExcerpt: commentExcerpt(newest.body),
        href: absoluteHref(gradingQueueHref(thread.assignment.courseId, thread.assignmentId, thread.id)),
      });
    });
}

export type DigestSend = (
  slackUserId: string,
  text: string,
) => Promise<{ ok: boolean; error?: string }>;

/**
 * Send every due digest. `now` is both the clock and the windows' upper bound — an event landing
 * mid-run falls into the next window rather than between two.
 *
 * `send` is a parameter so the integration tests can capture messages without a token; the cron
 * route passes the real `sendDm`.
 */
export async function runDigests(
  now: Date,
  deps: { send: DigestSend; client?: Tx },
): Promise<{ digested: number; skipped: number; failed: number }> {
  const client = deps.client ?? db;
  const counts = { digested: 0, skipped: 0, failed: 0 };
  const { hour, weekday } = schoolHourAndWeekday(now);

  /*
    Everybody whose chosen hour is the hour it now is in Brooklyn — and, for a weekly digest, whose
    chosen day is today. Asked of the database rather than decided before the query, because the
    hour is per person now: there is no single moment when "the digest" goes out.
  */
  const users = await client.profile.findMany({
    where: {
      testStudentNumber: null,
      slackEventHour: hour,
      OR: [
        { slackEventCadence: "DAILY" },
        { slackEventCadence: "WEEKLY", slackEventWeekday: weekday },
      ],
    },
    select: {
      id: true,
      role: true,
      email: true,
      slackEmail: true,
      slackUserId: true,
      slackEventCadence: true,
      slackDigestedTo: true,
    },
  });

  for (const user of users) {
    // Defensive lower bound: the cadence mutation writes the watermark when a digest is chosen,
    // so a null here is a row written before that rule — one period back, never all history.
    const days = user.slackEventCadence === "WEEKLY" ? 7 : 1;
    const since = user.slackDigestedTo ?? new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const window = { gt: since, lte: now };

    const lines =
      user.role === "STUDENT"
        ? await studentDigestLines(client, user.id, window)
        : await instructorDigestLines(client, user.id, window);

    if (lines.length === 0) {
      // Nothing to say still advances the watermark, or a quiet fortnight becomes one enormous
      // window the first time something happens.
      await client.profile.update({ where: { id: user.id }, data: { slackDigestedTo: now } });
      counts.skipped += 1;
      continue;
    }

    const slackUserId = await resolveSlackUserId(client, user);
    if (!slackUserId) {
      counts.failed += 1;
      continue;
    }

    const sent = await deps.send(slackUserId, digestDm(lines));
    if (sent.ok) {
      await client.profile.update({ where: { id: user.id }, data: { slackDigestedTo: now } });
      counts.digested += 1;
    } else {
      console.error(`slack: digest to profile ${user.id} failed: ${sent.error}`);
      counts.failed += 1;
    }
  }

  return counts;
}
