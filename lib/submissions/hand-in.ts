import type { Prisma } from "@/lib/generated/prisma/client";
import type { SubmissionStatus } from "@/lib/generated/prisma/enums";

import { TASK_POINT_VALUE } from "@/lib/assignments/spec";

/**
 * What handing work in does to a submission's status, its submission time, and its lateness.
 *
 * One rule, shared by the three places work can arrive: the pull request webhook, the link
 * form's `submitWork`, and the upload route's `storeAndRecordUpload`. Written out three times
 * it was three different rules — the webhook preserved the first submission time and told a
 * revision from a first submission, and the other two did neither, so a student who was graded
 * and then handed in revised work re-entered the queue as an ordinary new submission and was
 * marked late for having done it after the due date.
 *
 * Nothing here reads the database or the assignment kind. What arrives — a commit, a link, a
 * file — is the caller's business; what it means for the row is this.
 */

/** The columns this rule reads, as they stand before the hand-in. Null for a row that does not exist yet. */
export interface HandInBefore {
  status: SubmissionStatus;
  submittedAt: Date | null;
  isLate: boolean | null;
}

/** The columns this rule writes. Every field is set, so a caller cannot half-apply it. */
export interface HandInAfter {
  status: SubmissionStatus;
  submittedAt: Date;
  isLate: boolean;
}

/**
 * The status handing work in produces.
 *
 * Keyed on the status the submission already has, because the act alone does not say what it
 * is. Work handed in on top of a released grade is a revision, and an instructor working
 * through a queue needs to tell a revision from a first submission — that distinction is the
 * whole reason `RESUBMITTED` exists, and it is lost the moment a second hand-in writes
 * `SUBMITTED` over it.
 *
 * `RESUBMITTED` stays `RESUBMITTED`: a student correcting the link on a revision that is
 * already waiting has not gone back to being a first submission.
 */
export function handInStatus(current: SubmissionStatus): SubmissionStatus {
  return current === "GRADED" || current === "RESUBMITTED" ? "RESUBMITTED" : "SUBMITTED";
}

/**
 * The three columns together, from the row as it stands and the assignment's due date.
 *
 * `submittedAt` is recorded on the first hand-in and never moved after it. It is when the work
 * was handed in, and a correction or a revision is not a new answer to that question — moving
 * it turns an on-time submission into a late one for the offence of having been revised, which
 * is what `isLate` then reports to the gradebook and to the student. When a revision happened
 * is `lastActivityAt`, which every caller writes for itself.
 *
 * `isLate` follows from `submittedAt` rather than from the clock, so it is recomputed rather
 * than carried: an instructor who moves an assignment's due date should see the flag follow.
 * With no due date there is nothing to be late against, and the stored value stands — a
 * submission with no deadline is never late, and one whose deadline was removed keeps whatever
 * was already on record.
 */
export function handInState(params: {
  current: HandInBefore | null;
  dueAt: Date | null;
  now: Date;
}): HandInAfter {
  const { current, dueAt, now } = params;
  const submittedAt = current?.submittedAt ?? now;

  return {
    status: handInStatus(current?.status ?? "NOT_STARTED"),
    submittedAt,
    isLate: dueAt ? submittedAt > dueAt : (current?.isLate ?? false),
  };
}

// ===========================================================================
// Tasks
// ===========================================================================

/**
 * What marking a task does to a submission row.
 *
 * A task has nothing to hand in, so the two acts a row can be put through are not "handed in"
 * and "graded" but one thing: somebody said whether it was done. That verdict is written by two
 * procedures — the student's own toggle and the instructor's — and this is the one definition
 * both of them write, so a task marked by a fellow and a task marked by their instructor cannot
 * come to hold different columns.
 *
 * **Why `GRADED` rather than `SUBMITTED`.** A marked task waits on nobody: there is no report to
 * generate and no work for anybody to read. `triageBucket` returns null for `GRADED` and for
 * `NOT_STARTED`, so a task never enters triage, the grading queue's review count, or a batch
 * report run — and that falls out of the status rather than needing any of those three to know
 * what a task is.
 *
 * **Why the score columns at all.** They are what makes a task's gradebook cell read 1/1 or 0/1
 * through the same `scoreLabel` every other cell uses, coloured by `isComplete` like every other
 * cell. A task that recorded only `isComplete` would need the grid to grow a second way of
 * drawing a cell, for a kind that has nothing else different about it.
 *
 * Pure, like `handInState` above: nothing here reads the database, and the caller decides which
 * row the columns land on.
 */

/** The columns a verdict reads from the row as it stands. Null for a row that does not exist yet. */
export interface TaskBefore {
  submittedAt: Date | null;
  isLate: boolean | null;
}

export function taskVerdict(params: {
  /** True for done, false for an instructor's "this was not done". */
  done: boolean;
  /** The row as it stands, or null when there is not one yet. */
  current: TaskBefore | null;
  dueAt: Date | null;
  at: Date;
  /** Who decided. Written to `gradedById`, whether that is the fellow or their instructor. */
  markedById: string;
  /**
   * The fellow, when a fellow pressed the button.
   *
   * Omitted when an instructor did, so that overruling somebody does not rewrite who marked the
   * work — `handedInById` answers "which member of the team did this", and an instructor is not
   * one. On a team it is what the panel's attribution line reads.
   */
  handedInById?: string;
}): Prisma.SubmissionUncheckedUpdateManyInput {
  const { done, current, dueAt, at, markedById, handedInById } = params;

  /*
    When the work was done, recorded on the first done verdict and never moved after it — the
    same rule `handInState` applies to a hand-in, and for the same reason: a task marked done on
    time and corrected later has not become late by being corrected.

    A *not done* verdict leaves both columns exactly as they stand. It changes what the work is
    worth, not when it was done, and a task nobody has ever marked done has no submission time to
    invent one for.
  */
  const submittedAt = done ? (current?.submittedAt ?? at) : (current?.submittedAt ?? null);
  const isLate = done
    ? dueAt
      ? (current?.submittedAt ?? at) > dueAt
      : (current?.isLate ?? false)
    : (current?.isLate ?? null);

  return {
    status: "GRADED",
    // One point, always — see `assignmentPointValue`. The pair is what the cell renders.
    finalScore: done ? TASK_POINT_VALUE : 0,
    finalScorePossible: TASK_POINT_VALUE,
    isComplete: done,
    gradedById: markedById,
    gradedAt: at,
    lastActivityAt: at,
    submittedAt,
    isLate,
    ...(handedInById === undefined ? {} : { handedInById }),
    /*
      No report, and both columns say so rather than being left to whatever a previous act put
      there. A task is graded and yet there is nothing written about it, which is a state no
      other kind reaches.
    */
    feedbackMarkdown: null,
    gradedHeadSha: null,
    /*
      **The one column here that is not obvious, and the reason it is not left out.**

      `feedbackIsUnread` asks whether there is a report the student has not said they read, and
      answers it by comparing this column against `gradedAt` — so a row that is GRADED with this
      null is unread by definition. A task releases no report, so left null every marked task
      would sit on the fellow's dashboard under "Feedback to read", pointing at a tab that does
      not exist for it.

      Written here rather than special-cased in the dashboard, so `feedbackIsUnread` stays the
      only thing that answers its own question. A task is born read because there is nothing to
      read.
    */
    feedbackReviewedAt: at,
    // Every member's record changed, and each syncs separately — the same reason
    // `sharedAfterGrade` sets this.
    salesforceSyncStatus: "PENDING",
  };
}

/**
 * Taking a mark back: the columns that return a task to never having been marked.
 *
 * The student's undo, and only ever theirs. An instructor has two verdicts and no third state to
 * reach for — "not done" is a thing they are saying, where this is the absence of anybody having
 * said anything.
 *
 * Every column `taskVerdict` writes is cleared, including `submittedAt` and `isLate`: nothing
 * stands, so nothing may be recorded as standing. `NOT_STARTED` is what puts the task back on the
 * fellow's overdue and upcoming lists, which is right — they have not done it.
 */
export function taskReset(params: { at: Date }): Prisma.SubmissionUncheckedUpdateManyInput {
  return {
    status: "NOT_STARTED",
    finalScore: null,
    finalScorePossible: null,
    isComplete: null,
    gradedById: null,
    gradedAt: null,
    feedbackMarkdown: null,
    gradedHeadSha: null,
    feedbackReviewedAt: null,
    handedInById: null,
    submittedAt: null,
    isLate: null,
    lastActivityAt: params.at,
    salesforceSyncStatus: "PENDING",
  };
}
