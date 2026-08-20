import type { SubmissionStatus } from "@/lib/generated/prisma/enums";

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
