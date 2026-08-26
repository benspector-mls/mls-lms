import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { distributedToStudent } from "@/lib/assignments/scope";
import { teachableAssignment, teachableSubmission } from "@/lib/courses/scope";
import { displayNameOf } from "@/lib/people";
import type { Db, Tx } from "@/lib/prisma";
import {
  awaitsReply,
  COMMENT_RATE_LIMIT,
  commentAuthorRole,
  MAX_COMMENT_LENGTH,
  threadSubmissionId,
  unreadCount,
  visibleBody,
} from "@/lib/submissions/comments";
import { claimTeamWork, syncTeamRows, teamForStudent } from "@/lib/submissions/team";

import { createTRPCRouter, profileProcedure } from "../init";
import { personNameSelect } from "../selects";

/**
 * The conversation about a piece of work: one thread per submission, and one per team where a team
 * hands the work in. A fellow may write at any point in its life, and may name one released round
 * of feedback.
 *
 * In the application only — nothing here reaches GitHub, which delivers grades and not
 * conversations.
 *
 * Every procedure is `profileProcedure`, because both sides use all of them. `resolveThread`
 * decides what a caller may see, and it is a query rather than a role test.
 */

/** What a comment's body must be. Shared by the input and, as a CHECK, by the database. */
const commentBody = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(MAX_COMMENT_LENGTH, `A comment can be at most ${MAX_COMMENT_LENGTH} characters.`);

/**
 * Which thread, and on whose work.
 *
 * Keyed on the assignment rather than the submission, because a fellow's panel often has no
 * submission to name — for a kind with no Accept the row does not exist until they write.
 */
const threadInput = z.object({
  assignmentId: z.string().uuid(),
  /** Omitted means "my own work", which is what a fellow sends. */
  studentId: z.string().uuid().optional(),
});

/** The assignment and the fellow a thread belongs to, once the caller has been admitted. */
type ThreadScope = {
  assignmentId: string;
  studentId: string;
  teamSetId: string | null;
  /** The row holding the work, already resolved through any mirror. Null before one exists. */
  submissionId: string | null;
  /** Whether the caller is reading somebody else's work, which is the instructor's case. */
  asInstructor: boolean;
};

/**
 * Who may see this thread, answered by loading it. Each path is a query whose `where` is the
 * check, because Prisma bypasses row level security.
 *
 * A fellow reaches their own work through `distributedToStudent`. Deliberately not
 * `assertCanHandIn`, which refuses while an instructor has a draft open — being unable to replace
 * your work is not a reason to be unable to ask about it.
 *
 * An instructor reaches anybody's through `teachableAssignment`, and the fellow they name must be
 * on the program's roster.
 */
async function resolveThread(
  ctx: { db: Db; profile: { id: string; role: string } },
  input: z.infer<typeof threadInput>,
): Promise<ThreadScope> {
  const studentId = input.studentId ?? ctx.profile.id;
  const asInstructor = studentId !== ctx.profile.id;

  let teamSetId: string | null;

  if (asInstructor) {
    const assignment = await teachableAssignment(ctx, input.assignmentId, {
      teamSetId: true,
      course: { select: { programId: true } },
    });

    const enrolled = await ctx.db.enrollment.findFirst({
      where: { programId: assignment.course.programId, studentId, status: "ACTIVE" },
      select: { id: true },
    });

    if (!enrolled) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "That fellow is not on this program's roster.",
      });
    }

    teamSetId = assignment.teamSetId;
  } else {
    const assignment = await ctx.db.assignment.findFirst({
      where: { id: input.assignmentId, ...distributedToStudent(ctx.profile.id) },
      select: { teamSetId: true },
    });

    // Not found rather than forbidden: saying which would report that it exists.
    if (!assignment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
    }

    teamSetId = assignment.teamSetId;
  }

  // Resolved through the mirror, which is what makes a team share one conversation.
  const submission = await ctx.db.submission.findUnique({
    where: { assignmentId_studentId: { assignmentId: input.assignmentId, studentId } },
    select: { id: true, teamSubmissionId: true },
  });

  return {
    assignmentId: input.assignmentId,
    studentId,
    teamSetId,
    submissionId: submission ? threadSubmissionId(submission) : null,
    asInstructor,
  };
}

/**
 * The row a comment belongs to, creating it when there is none.
 *
 * On a team assignment this goes through `claimTeamWork` and `syncTeamRows`, never a plain upsert —
 * the same path `storeAndRecordUpload` takes. A plain upsert would give a member a row with no team
 * on it, and since `claimTeamWork` never adopts an existing row they would sit outside their team's
 * grade permanently.
 *
 * `NOT_STARTED`, which every reader downstream already treats as the same fact as no row at all, so
 * asking a question does not read as starting work.
 */
async function threadRowForWriting(db: Tx, scope: ThreadScope): Promise<string> {
  if (scope.submissionId) return scope.submissionId;

  const team = scope.teamSetId
    ? await teamForStudent(db, { teamSetId: scope.teamSetId, studentId: scope.studentId })
    : null;

  if (team) {
    const { submissionId } = await claimTeamWork(db, {
      assignmentId: scope.assignmentId,
      studentId: scope.studentId,
      team,
      statusIfNew: "NOT_STARTED",
    });

    await syncTeamRows(db, { submissionId });
    return submissionId;
  }

  const created = await db.submission.upsert({
    where: {
      assignmentId_studentId: { assignmentId: scope.assignmentId, studentId: scope.studentId },
    },
    create: { assignmentId: scope.assignmentId, studentId: scope.studentId, status: "NOT_STARTED" },
    // The row existing is all this needed; every column on it means something else.
    update: {},
    select: { id: true },
  });

  return created.id;
}

/** What an author whose account has gone is called. One string, used twice in one expression. */
const GONE = "Someone who has left";

/** What a comment looks like once it has been loaded, before it is collapsed for a reader. */
const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  deletedAt: true,
  authorId: true,
  authorRole: true,
  gradingDraftId: true,
  author: { select: personNameSelect },
} as const;

/**
 * The thread as one reader is owed it.
 *
 * Three things are settled here rather than in a browser, because settling them twice is how two
 * screens disagree: `round.number` uses the ordering `feedbackRounds` uses, so "Review 2" means
 * one round; `visibleBody` withholds a withdrawn message; and `isMine` is sent instead of an
 * author id, since it is exactly the permission to withdraw.
 */
async function readThread(db: Db, params: { submissionId: string | null; readerId: string }) {
  if (!params.submissionId) {
    return {
      comments: [],
      unreadCount: 0,
      lastCommentId: null as string | null,
      awaitsReply: false,
      resolvedAt: null as Date | null,
    };
  }

  const [comments, rounds, receipt, submission] = await Promise.all([
    db.submissionComment.findMany({
      where: { submissionId: params.submissionId },
      orderBy: { createdAt: "asc" },
      select: commentSelect,
    }),
    db.gradingDraft.findMany({
      where: { submissionId: params.submissionId, status: "APPROVED" },
      orderBy: { approvedAt: "asc" },
      select: { id: true },
    }),
    db.submissionCommentRead.findUnique({
      where: {
        submissionId_profileId: {
          submissionId: params.submissionId,
          profileId: params.readerId,
        },
      },
      select: { lastReadAt: true },
    }),
    db.submission.findUnique({
      where: { id: params.submissionId },
      select: { commentsResolvedAt: true },
    }),
  ]);

  const roundNumbers = new Map(rounds.map((round, index) => [round.id, index + 1]));
  const reader = { id: params.readerId, lastReadAt: receipt?.lastReadAt ?? null };

  const resolvedAt = submission?.commentsResolvedAt ?? null;

  return {
    unreadCount: unreadCount(comments, reader),
    lastCommentId: comments[comments.length - 1]?.id ?? null,
    resolvedAt,
    // The same function the triage list uses, so the badge and the list cannot disagree.
    awaitsReply: awaitsReply(comments, resolvedAt),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: visibleBody(comment),
      createdAt: comment.createdAt,
      deletedAt: comment.deletedAt,
      isMine: comment.authorId !== null && comment.authorId === params.readerId,
      author: {
        // The fallback covers an author whose account has gone: `authorId` is SetNull, so what
        // somebody said survives them leaving.
        name: comment.author ? displayNameOf(comment.author, GONE) : GONE,
        // Which side of the conversation, and nothing more.
        isInstructor: comment.authorRole === "INSTRUCTOR",
      },
      round:
        comment.gradingDraftId && roundNumbers.has(comment.gradingDraftId)
          ? { id: comment.gradingDraftId, number: roundNumbers.get(comment.gradingDraftId)! }
          : null,
    })),
  };
}

export const submissionCommentsRouter = createTRPCRouter({
  /**
   * One thread, oldest first. No `canPost`: anybody who can read this can post to it.
   */
  thread: profileProcedure.input(threadInput).query(async ({ ctx, input }) => {
    const scope = await resolveThread(ctx, input);
    const thread = await readThread(ctx.db, {
      submissionId: scope.submissionId,
      readerId: ctx.profile.id,
    });

    return { submissionId: scope.submissionId, ...thread };
  }),

  /**
   * Write one message.
   *
   * No `lastActivityAt`: that orders the grading queue, and a question is not activity on the work
   * — the same decision `markFeedbackReviewed` makes. No audit event either; this table is already
   * a record of who said what and when.
   */
  post: profileProcedure
    .input(
      threadInput.extend({
        body: commentBody,
        /** The released round this is about, or nothing for a comment about no round. */
        gradingDraftId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveThread(ctx, input);

      // A ceiling on how much one person can write. See `COMMENT_RATE_LIMIT` for why this is not
      // `assertWithinRate`.
      const since = new Date(Date.now() - COMMENT_RATE_LIMIT.windowMinutes * 60 * 1000);
      const recent = await ctx.db.submissionComment.count({
        where: { authorId: ctx.profile.id, createdAt: { gte: since } },
      });

      if (recent >= COMMENT_RATE_LIMIT.max) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            `That is ${recent} comments in the last ${COMMENT_RATE_LIMIT.windowMinutes} minutes, ` +
            `which is the limit. Wait a few minutes and post again.`,
        });
      }

      // An instructor only ever answers a thread that exists; a fellow's first comment makes one.
      const submissionId = scope.asInstructor
        ? scope.submissionId
        : await threadRowForWriting(ctx.db, scope);

      if (!submissionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "There is nothing here to comment on yet.",
        });
      }

      // A foreign key holds the round to this submission; only its status is left to check.
      if (input.gradingDraftId) {
        const round = await ctx.db.gradingDraft.findFirst({
          where: { id: input.gradingDraftId, submissionId, status: "APPROVED" },
          select: { id: true },
        });

        if (!round) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That round of feedback is not one of this submission's.",
          });
        }
      }

      await ctx.db.submissionComment.create({
        data: {
          submissionId,
          authorId: ctx.profile.id,
          authorRole: commentAuthorRole(ctx.profile.role),
          gradingDraftId: input.gradingDraftId ?? null,
          body: input.body,
        },
        select: { id: true },
      });

      // The whole thread back, so the screen can replace what it holds rather than ask again.
      return {
        submissionId,
        ...(await readThread(ctx.db, { submissionId, readerId: ctx.profile.id })),
      };
    }),

  /**
   * Withdraw your own message.
   *
   * A tombstone, so a reply is not left answering whatever floats into the gap. The author only:
   * an instructor removing somebody else's words is moderation, which would need its own record.
   */
  remove: profileProcedure
    .input(z.object({ commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await ctx.db.submissionComment.findUnique({
        where: { id: input.commentId },
        select: { id: true, authorId: true, submissionId: true, deletedAt: true },
      });

      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
      }

      // Prisma bypasses row level security, so this comparison is the whole of the rule.
      if (comment.authorId !== ctx.profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your comment." });
      }

      // Twice is the same intention twice, and the first timestamp is the true one.
      if (!comment.deletedAt) {
        await ctx.db.submissionComment.update({
          where: { id: comment.id },
          data: { deletedAt: new Date() },
          select: { id: true },
        });
      }

      return {
        submissionId: comment.submissionId,
        ...(await readThread(ctx.db, {
          submissionId: comment.submissionId,
          readerId: ctx.profile.id,
        })),
      };
    }),

  /**
   * An instructor saying this conversation needs nothing from them.
   *
   * The other way off the questions list, for a question already handled in person or one the
   * fellow worked out — where replying would mean writing "no need" into somebody's record.
   *
   * **The clock rather than a boolean**, so a fellow who asks again afterwards is waiting again
   * without anybody having to clear a flag. `awaitsReply` is that comparison.
   *
   * **Settled for every instructor at once, not for the caller alone.** A question is answered or
   * it is not, and `ProgramInstructor` already says a co-teacher must be able to finish what
   * somebody else started.
   *
   * Written to the row holding the work, so a team's thread has one answer.
   */
  resolve: profileProcedure
    .input(z.object({ submissionId: z.string().uuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // Instructors only, and `teachableSubmission` is both the load and the check.
      const submission = await teachableSubmission(ctx, input.submissionId, {
        id: true,
        teamSubmissionId: true,
      });

      // Resolve the mirror, or a member's copy would carry a settlement the thread cannot see.
      const threadId = threadSubmissionId(submission);

      await ctx.db.submission.update({
        where: { id: threadId },
        data: input.resolved
          ? { commentsResolvedAt: new Date(), commentsResolvedById: ctx.profile.id }
          : { commentsResolvedAt: null, commentsResolvedById: null },
        select: { id: true },
      });

      return {
        submissionId: threadId,
        ...(await readThread(ctx.db, { submissionId: threadId, readerId: ctx.profile.id })),
      };
    }),

  /**
   * A reader saying they have been through the thread as far as one message.
   *
   * `upTo` names a message rather than sending a clock, so anything landing between the read and
   * this write is genuinely later and stays unread. Fired from an effect; nothing waits for it.
   */
  markRead: profileProcedure
    .input(z.object({ submissionId: z.string().uuid(), upTo: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await ctx.db.submissionComment.findFirst({
        where: { id: input.upTo, submissionId: input.submissionId },
        select: { createdAt: true },
      });

      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
      }

      // Whether the caller may read this thread at all, asked before writing a row about it.
      const submission = await ctx.db.submission.findFirst({
        where: {
          id: input.submissionId,
          OR: [
            // Their own work, or their team's.
            { studentId: ctx.profile.id },
            { mirrors: { some: { studentId: ctx.profile.id } } },
            // Or an instructor of the program, which is where authority lives.
            {
              assignment: {
                course: { program: { instructors: { some: { userId: ctx.profile.id } } } },
              },
            },
          ],
        },
        select: { id: true },
      });

      if (!submission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found." });
      }

      /*
        Two writes, because the receipt must only move forwards and one upsert cannot say so. Two
        tabs settling out of order would otherwise light the badge again for nothing.
      */
      const advanced = await ctx.db.submissionCommentRead.updateMany({
        where: {
          submissionId: input.submissionId,
          profileId: ctx.profile.id,
          lastReadAt: { lt: comment.createdAt },
        },
        data: { lastReadAt: comment.createdAt },
      });

      if (advanced.count === 0) {
        await ctx.db.submissionCommentRead.upsert({
          where: {
            submissionId_profileId: {
              submissionId: input.submissionId,
              profileId: ctx.profile.id,
            },
          },
          create: {
            submissionId: input.submissionId,
            profileId: ctx.profile.id,
            lastReadAt: comment.createdAt,
          },
          update: {},
          select: { id: true },
        });
      }

      return { submissionId: input.submissionId, lastReadAt: comment.createdAt };
    }),
});
