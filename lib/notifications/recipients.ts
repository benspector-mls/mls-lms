import type { SubmissionCommentAuthor } from "@/lib/generated/prisma/enums";

import { schoolClockOf, schoolDayOf, weekdayOf } from "@/lib/school-time";

/**
 * Who hears about an event, and when a digest is due.
 *
 * Pure functions over structural inputs, like `lib/submissions/comments.ts`, so the immediate
 * path, the digest path, and the unit tests all read one statement of each rule. Test students
 * are excluded where the profiles are fetched (`testStudentNumber: null` in the query), not here
 * — these functions see ids, and the query is the one place every send path passes through.
 */

/**
 * Feedback released on a submission reaches the student and, on team work, every member.
 *
 * The mirrors are the rest of the team — the same set approval writes audit events and grade
 * copies for — and enumerating them once from the team's own row is what makes this one DM per
 * member with no duplicates: mirrors hold no drafts, so no second event can fire.
 */
export function feedbackRecipients(submission: {
  studentId: string;
  mirrors: readonly { studentId: string }[];
}): string[] {
  return [...new Set([submission.studentId, ...submission.mirrors.map((m) => m.studentId)])];
}

/**
 * A comment reaches the other side of the conversation.
 *
 * A fellow's comment goes to the union of every instructor who has written in the thread and the
 * grader of record. A union rather than "thread authors, else the grader", because one predicate
 * then expresses the rule identically here and as a Prisma `where` in the digest query — and the
 * grader hearing about a question on work they graded reads correctly even when a co-teacher also
 * replied. An empty union means nobody is notified; the triage list still carries the question.
 *
 * An instructor's comment goes to the fellow and, on team work, the rest of the team — the thread
 * hangs off the team's own row, so its mirrors are the other members.
 *
 * The author never hears about their own comment.
 */
export function commentRecipients(args: {
  authorId: string | null;
  authorRole: SubmissionCommentAuthor;
  thread: {
    studentId: string;
    gradedById: string | null;
    mirrorStudentIds: readonly string[];
    /** Distinct authors of the thread's existing INSTRUCTOR-role comments. */
    instructorAuthorIds: readonly (string | null)[];
  };
}): string[] {
  const { authorId, authorRole, thread } = args;

  const candidates =
    authorRole === "STUDENT"
      ? [...thread.instructorAuthorIds, thread.gradedById]
      : [thread.studentId, ...thread.mirrorStudentIds];

  return [
    ...new Set(candidates.filter((id): id is string => id !== null && id !== authorId)),
  ];
}

/**
 * The school clock's hour and weekday at an instant.
 *
 * Everything about when a digest goes out is decided from this pair: the cron wakes every hour and
 * each person is sent to when the hour they chose comes round, and on the weekday they chose if
 * they asked for a weekly one. Read from the school's wall clock rather than from UTC, because
 * nine in Brooklyn is a different UTC hour either side of the clock change — the reason the job
 * wakes hourly rather than being scheduled once.
 *
 * The weekday is read from the civil date rather than from the instant, which is `weekdayOf`'s own
 * reason for existing: a UTC-midnight timestamp reads as the previous day in the school's zone.
 */
export function schoolHourAndWeekday(now: Date): { hour: number; weekday: number } {
  return {
    hour: Number(schoolClockOf(now).slice(0, 2)),
    weekday: weekdayOf(schoolDayOf(now)),
  };
}
