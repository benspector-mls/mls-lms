import type { SubmissionCommentAuthor } from "@/lib/generated/prisma/enums";

/**
 * The rules about the conversation on a piece of work.
 *
 * Three screens ask them — the fellow's panel, the triage list, and the thread itself — and they
 * must agree, or a badge stops matching the list beside it.
 *
 * Pure, and with no `server-only`, so the browser and the server use the same functions.
 */

/** Five thousand characters. Written again as a CHECK, because a script does not run this code. */
export const MAX_COMMENT_LENGTH = 5000;

/**
 * How much one person may write in an hour.
 *
 * Not `assertWithinRate`: that guards the two operations costing money and counts `audit_events`,
 * so reusing it would mean writing an audit event per comment just to have something to count.
 * This is against a stuck screen filling a thread, not against expense.
 */
export const COMMENT_RATE_LIMIT = { max: 60, windowMinutes: 60 };

/**
 * Which side of the conversation a role writes from. ADMIN counts as staff.
 *
 * Under an admin's test-fellow view this answers STUDENT, which is the point of that view.
 */
export function commentAuthorRole(role: string): SubmissionCommentAuthor {
  return role === "STUDENT" ? "STUDENT" : "INSTRUCTOR";
}

/**
 * The submission a thread hangs off, given any of a team's rows.
 *
 * One line, and named because skipping it means writing into a conversation the rest of the team
 * cannot see. A trigger refuses that write; this is what stops it being attempted.
 */
export function threadSubmissionId(submission: {
  id: string;
  teamSubmissionId: string | null;
}): string {
  return submission.teamSubmissionId ?? submission.id;
}

/** The columns the rules below read. Structural, so a test can build a thread in three lines. */
export type ThreadComment = {
  authorId: string | null;
  authorRole: SubmissionCommentAuthor;
  createdAt: Date;
  deletedAt: Date | null;
};

/** How far one person has read, or that they never have. */
export type ThreadReader = {
  id: string;
  lastReadAt: Date | null;
};

/**
 * Whether one message is news to one reader.
 *
 * Compared against `lastReadAt` rather than checked for null, so a reader who comes back to a
 * thread is not told every later message is already read — the same reasoning as
 * `feedbackIsUnread`.
 *
 * A withdrawn message says nothing, and your own writing is not news to you. Strictly newer, so a
 * message written in the same instant as the receipt counts as read.
 */
export function isUnread(comment: ThreadComment, reader: ThreadReader): boolean {
  if (comment.deletedAt !== null) return false;
  if (comment.authorId !== null && comment.authorId === reader.id) return false;
  if (reader.lastReadAt === null) return true;
  return comment.createdAt > reader.lastReadAt;
}

/** How many of a thread's messages are news to one reader. */
export function unreadCount(comments: readonly ThreadComment[], reader: ThreadReader): number {
  return comments.reduce((total, comment) => total + (isUnread(comment, reader) ? 1 : 0), 0);
}

/**
 * Whether an instructor owes an answer: the newest message that stands came from a fellow, and
 * nobody has settled it since.
 *
 * "The newest" rather than "any unanswered", because one reply covering three questions has
 * answered them. Expects the comments oldest first.
 *
 * **Two ways off the questions list, and they do not interact.** Replying makes the newest message
 * an instructor's. Resolving says the thread needs nothing, for a question handled in person or
 * worked out — and `resolvedAt` is *compared* against the question rather than checked for null,
 * so a fellow who asks again afterwards is waiting again.
 *
 * Deliberately not a `TriageBucket`: those are a partition of the outstanding grading, and work
 * can need a report and hold a question at once.
 */
export function awaitsReply(
  comments: readonly ThreadComment[],
  resolvedAt: Date | null = null,
): boolean {
  const newest = comments.filter((comment) => comment.deletedAt === null).at(-1);
  if (newest?.authorRole !== "STUDENT") return false;
  return resolvedAt === null || resolvedAt < newest.createdAt;
}

/**
 * A message's text, or nothing once withdrawn.
 *
 * Collapsed on the server so the text never reaches another reader, while an instructor asking
 * what was said can still find it in the column.
 */
export function visibleBody(comment: { body: string; deletedAt: Date | null }): string | null {
  return comment.deletedAt === null ? comment.body : null;
}

/**
 * The first line or so of a question, for the triage row.
 *
 * That row is one line of plain text inside a link, so markdown markers would arrive as literal
 * hashes and backticks. Not a parser: it strips line-leading markers, unwraps links and emphasis,
 * replaces code blocks, and cuts at a word boundary.
 */
export function commentExcerpt(body: string, maxLength = 120): string {
  const flattened = body
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (flattened.length <= maxLength) return flattened;

  const cut = flattened.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
