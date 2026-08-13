/**
 * What a student should look at, across every course they are in.
 *
 * **Browser-safe and pure**, like `lib/gradebook/csv.ts` and `lib/student/progress.ts`. The input
 * is the payload `assignments.listMine` returns, already narrowed by that procedure to the courses
 * a student is actively enrolled in and to work that has been handed out.
 *
 * **`now` is a parameter, not a clock read.** `formatRelative` in `lib/status.ts` takes it for the
 * same two reasons: reading the clock during render is what makes the server and the browser
 * disagree about which day a late-evening deadline falls on, which React reports as a hydration
 * mismatch, and a cached render has no meaningful "now" at all. It also makes every rule below
 * testable without mocking time.
 *
 * **Nothing here is dismissible, and that is the design rather than a missing feature.** Every
 * list is derived from real submission state, so the only way to clear a deadline is to hand the
 * work in. A dismiss button would let this screen say a student was finished when they were not,
 * which is the one thing it must never do.
 */

import type { SubmissionStatus } from "@/lib/generated/prisma/enums";
import { feedbackIsUnread, handedIn } from "@/lib/status";

/**
 * The parts of the payload this reads, named structurally rather than taken from `RouterOutputs`.
 *
 * `submission` is one row or null rather than an array: `listMine` flattens the caller-scoped
 * relation before returning it, because a list of at most one is a shape every call site has to
 * unwrap for no reason.
 */
export type DashboardRow = {
  id: string;
  title: string;
  dueAt: Date | null;
  course: { id: string; name: string };
  submission: {
    status: SubmissionStatus;
    finalScore: number | null;
    finalScorePossible: number | null;
    isComplete: boolean | null;
    gradedAt: Date | null;
    feedbackReviewedAt: Date | null;
  } | null;
};

export interface DashboardSections<Row> {
  /** Due, not handed in, deadline still ahead. Soonest first. */
  upcoming: Row[];
  /** Due, not handed in, deadline gone. Oldest first. */
  overdue: Row[];
  /** Graded, with a report the student has not said they read. Newest first, at most ten. */
  unreadFeedback: Row[];
  /** Taken up and not handed in. */
  inProgress: Row[];
}

/**
 * At most ten unread reports.
 *
 * A cap rather than a scroll: this section exists to say "there is something new to read", and a
 * list of thirty says the opposite by being one more thing to work through. Ten is enough to cover
 * a fortnight of a heavy module.
 */
export const UNREAD_FEEDBACK_LIMIT = 10;

/**
 * The four lists, from one pass over the rows.
 *
 * Read the rules together, because what they leave out is deliberate:
 *
 * - **Work with no due date is in no deadline list.** It is outside the ordering rather than at one
 *   end of it, which is the same decision `listForCourse` makes with `nulls: "last"`. It still
 *   appears under In progress once accepted.
 * - **Graded work is never a deadline**, including work that came back below the threshold. That is
 *   `handedIn` doing the deciding, and its comment says why: resubmitting is a second attempt at
 *   work already handed in, and listing it as an outstanding deadline would tell a student they
 *   had missed something they in fact did.
 * - **In progress is `ACCEPTED` and nothing else.** Published work a student has not accepted is
 *   not in progress by any reading, and over a nine-month program it is most of the course — a
 *   student in week two would find forty rows of work they had not started. Where it belongs is
 *   the deadline lists, which is where its due date puts it.
 */
export function dashboardSections<Row extends DashboardRow>(
  rows: readonly Row[],
  now: Date,
): DashboardSections<Row> {
  const upcoming: Row[] = [];
  const overdue: Row[] = [];
  const unreadFeedback: Row[] = [];
  const inProgress: Row[] = [];

  for (const row of rows) {
    const submission = row.submission;

    if (submission != null && feedbackIsUnread(submission)) {
      unreadFeedback.push(row);
    }

    if (submission?.status === "ACCEPTED") {
      inProgress.push(row);
    }

    if (row.dueAt != null && !handedIn(submission?.status)) {
      if (row.dueAt.getTime() >= now.getTime()) upcoming.push(row);
      else overdue.push(row);
    }
  }

  // Ascending in both deadline lists, which means different things in each and is right in both:
  // the next thing due is at the top of one, and the longest-neglected at the top of the other.
  upcoming.sort(byDueAtAscending);
  overdue.sort(byDueAtAscending);

  // Newest first, so the report from this morning is above the one from last week.
  unreadFeedback.sort(
    (a, b) => (b.submission?.gradedAt?.getTime() ?? 0) - (a.submission?.gradedAt?.getTime() ?? 0),
  );

  // Soonest deadline first here too. Work already taken up is ordered by when it is wanted.
  inProgress.sort(byDueAtAscending);

  return {
    upcoming,
    overdue,
    unreadFeedback: unreadFeedback.slice(0, UNREAD_FEEDBACK_LIMIT),
    inProgress,
  };
}

/** Assignments with no due date sit at the foot, never at the head. */
function byDueAtAscending(a: DashboardRow, b: DashboardRow): number {
  if (a.dueAt == null && b.dueAt == null) return 0;
  if (a.dueAt == null) return 1;
  if (b.dueAt == null) return -1;
  return a.dueAt.getTime() - b.dueAt.getTime();
}

/** Whether there is anything at all to show, so the screen can offer one empty state, not four. */
export function dashboardIsEmpty(sections: DashboardSections<DashboardRow>): boolean {
  return (
    sections.upcoming.length === 0 &&
    sections.overdue.length === 0 &&
    sections.unreadFeedback.length === 0 &&
    sections.inProgress.length === 0
  );
}
