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
}

/** The columns this rule writes. Every field is set, so a caller cannot half-apply it. */
export interface HandInAfter {
  status: SubmissionStatus;
  submittedAt: Date;
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
 * The two columns together, from the row as it stands.
 *
 * `submittedAt` is recorded on the first hand-in and never moved after it. It is when the work
 * was handed in, and a correction or a revision is not a new answer to that question — moving
 * it would turn an on-time submission into a late one for the offence of having been revised.
 * When a revision happened is `lastActivityAt`, which every caller writes for itself.
 *
 * **Nothing here records whether the work was late.** That is `lateness` below, computed when
 * somebody looks rather than frozen when the work arrived — see its comment for why a frozen
 * answer gave two fellows different verdicts for the same behaviour.
 */
export function handInState(params: { current: HandInBefore | null; now: Date }): HandInAfter {
  const { current, now } = params;

  return {
    status: handInStatus(current?.status ?? "NOT_STARTED"),
    submittedAt: current?.submittedAt ?? now,
  };
}

// ===========================================================================
// Extensions
// ===========================================================================

/**
 * What a submission's timeliness reads as, once a renegotiated deadline is taken into account.
 *
 * Three answers rather than two, because "late" had been carrying two situations a school treats
 * very differently: a fellow who missed a deadline and said nothing, and a fellow who came to their
 * instructor, agreed a new date, and met it. The second is the behaviour the school wants to
 * reinforce, and one word for both could not.
 */
export type Lateness = "onTime" | "extended" | "late";

/**
 * The deadline one fellow is working to: their own, where something was agreed with them.
 *
 * **A sentence rather than a lookup, and named anyway.** It is `extendedDueAt ?? dueAt` and could
 * be written at each call site in less space than reaching this function takes — but the call sites
 * are the dashboard, the course page, and the calendar feed, and those three agreeing is a property
 * the application is checked on rather than one it merely hopes for. `verify:calendar` asserts that
 * the feed holds exactly the dated work the dashboard shows; three spellings of this rule is how
 * that check would start failing for a reason nobody could see.
 *
 * **Display only, and deliberately not what `lateness` reads.** That compares the hand-in against
 * the assignment's own deadline first and the agreed one second, so it can tell "extended" from "on
 * time"; collapsing the two here would lose that distinction. This answers a different question —
 * which date to *show* a fellow, and which one decides that they are missing the work.
 */
export function effectiveDueAt(params: {
  /** The assignment's own deadline, which is every fellow's until one of them agrees otherwise. */
  dueAt: Date | null;
  /** The fellow's own row, or null where they have none. */
  submission: { extendedDueAt: Date | null } | null | undefined;
}): Date | null {
  return params.submission?.extendedDueAt ?? params.dueAt;
}

/** What the verdict reads. Structural, so a test can state a case in one line. */
export interface LatenessFacts {
  /** The assignment's own deadline — the one the class was given. */
  dueAt: Date | string | null;
  /** When the work arrived, or null where nothing has. */
  submittedAt: Date | string | null;
  /** A deadline renegotiated with this fellow, or null where none was agreed. */
  extendedDueAt: Date | string | null;
}

/**
 * Whether work was on time, extended, or late.
 *
 * **Computed when somebody looks, never stored**, and that is the whole of this function's design.
 * A stored verdict was written at hand-in against the deadline as it stood that minute, which gave
 * two fellows opposite records for the same behaviour: an assignment due the 1st, one fellow hands
 * in on the 3rd and is recorded late, an instructor decides on the 4th that the original was not
 * enough time and moves it to the 10th, a second fellow hands in on the 5th and is recorded on
 * time. The fellow who was *closer* to the original deadline read as the worse of the two, and the
 * difference was only when the instructor happened to make the edit. Worse, the first fellow's
 * record corrected itself only if they later resubmitted, because that is when the stored value was
 * recomputed — so whether a record was right depended on whether the work had been revised.
 *
 * Moving a deadline now moves every verdict measured against it, which is what an instructor means
 * by moving it.
 *
 * **Nothing handed in is `onTime`.** Whether that fellow is *missing* the work is `isMissing`'s
 * question, and it is the one that consults an extension for work that has not arrived. Work with
 * no deadline is `onTime` too: there is nothing to be late against.
 *
 * **An extension on work that was never late says nothing.** It reads `onTime` and the grant sits
 * on the row unused, which is the right outcome for one agreed in advance and then not needed.
 *
 * Retroactive excusal needs no separate path: an extension dated at or after a hand-in that
 * already happened satisfies the comparison, which is what granting one after the fact means.
 */
export function lateness(facts: LatenessFacts): Lateness {
  if (facts.submittedAt == null || facts.dueAt == null) return "onTime";

  const submitted = new Date(facts.submittedAt);
  if (submitted <= new Date(facts.dueAt)) return "onTime";

  if (facts.extendedDueAt == null) return "late";
  return submitted <= new Date(facts.extendedDueAt) ? "extended" : "late";
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
}

export function taskVerdict(params: {
  /** True for done, false for an instructor's "this was not done". */
  done: boolean;
  /** The row as it stands, or null when there is not one yet. */
  current: TaskBefore | null;
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
  const { done, current, at, markedById, handedInById } = params;

  /*
    When the work was done, recorded on the first done verdict and never moved after it — the
    same rule `handInState` applies to a hand-in, and for the same reason: a task marked done on
    time and corrected later has not become late by being corrected.

    A *not done* verdict leaves both columns exactly as they stand. It changes what the work is
    worth, not when it was done, and a task nobody has ever marked done has no submission time to
    invent one for.
  */
  const submittedAt = done ? (current?.submittedAt ?? at) : (current?.submittedAt ?? null);

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
 * Every column `taskVerdict` writes is cleared, `submittedAt` included: nothing stands, so nothing
 * may be recorded as standing. `NOT_STARTED` is what puts the task back on the
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
    lastActivityAt: params.at,
    salesforceSyncStatus: "PENDING",
  };
}
