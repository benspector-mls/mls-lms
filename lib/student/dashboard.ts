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
 * work in, and the only way to clear a second attempt is to hand it in again. A dismiss button
 * would let this screen say a student was finished when they were not, which is the one thing it
 * must never do.
 *
 * **Reading a report is not doing the work, and the two graded lists are that distinction.**
 * Marking feedback read clears the report from Feedback to read, because a report that has been
 * read is not news. It clears nothing from Needs another attempt, because work that came back
 * below the threshold is still outstanding after the student has read why.
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
  /** Due within the window, not handed in. Soonest first. */
  upcoming: Row[];
  /** Due, not handed in, deadline gone. Oldest first. */
  overdue: Row[];
  /** Graded below the threshold. Longest outstanding first. */
  needsAnotherAttempt: Row[];
  /** Graded, passed, with a report the student has not said they read. Newest first, at most ten. */
  unreadFeedback: Row[];
  /** Taken up and not handed in. */
  inProgress: Row[];
  /**
   * How much outstanding work is due past the window.
   *
   * A number and never a list, which is the whole of why it exists. The screen draws no rows for
   * this work, so without a count the empty state would tell a student with a fortnight of
   * assignments ahead of them that they were up to date — the same lie a dismiss button would let
   * this screen tell.
   */
  laterCount: number;
}

/**
 * At most ten unread reports.
 *
 * A cap rather than a scroll: this section exists to say "there is something new to read", and a
 * list of thirty says the opposite by being one more thing to work through. Ten is enough to cover
 * a fortnight of a heavy module.
 *
 * Nothing else here is capped, and the difference is what each list is for. Unread feedback is
 * news; the deadline lists and Needs another attempt are work, and a cap on a list of work hides
 * some of it.
 */
export const UNREAD_FEEDBACK_LIMIT = 10;

/**
 * The windows a student may choose between, in days.
 *
 * Bounded rather than open, and that is the point of the list. Published work runs to most of a
 * nine-month course, so an "everything" option would put forty assignments a student in week two
 * has no reason to start at the top of their screen — and it would make `laterCount` permanently
 * zero, which is the number the empty state depends on to stay honest. Every choice here still
 * leaves work outside the window.
 */
export const UPCOMING_WINDOW_CHOICES = [3, 7, 14, 30] as const;

/**
 * How far ahead Coming up looks until a student says otherwise.
 *
 * A week rather than everything, because a week is the horizon most people plan against: nothing
 * can be done about work due in twelve days that cannot be done about it in five. It is a good
 * default and a poor universal rule, which is why it is only the default — somebody who plans a
 * fortnight at a time can say so, from the picker in the dashboard's own header.
 */
export const DEFAULT_UPCOMING_WINDOW_DAYS = 7;

/**
 * The cookie holding a student's choice.
 *
 * `mls_` prefixed to keep it clear of Supabase's own `sb-*` cookies, the way `LAST_PLACE_COOKIE`
 * is. A cookie rather than a column on `Profile` for the reason `RememberPlace` gives: this is a
 * remembered way of looking at a screen and nothing else, so it needs no migration, no mutation
 * and no round trip. The cost is that it is remembered per browser, and a student who also opens
 * the application on their phone gets the default there.
 */
export const UPCOMING_WINDOW_COOKIE = "mls_upcoming_window";

/**
 * A remembered window, or the default for anything this does not recognise.
 *
 * **Checked against the offered list rather than parsed as a number**, because the value comes
 * from a cookie and a cookie is a value somebody can set. `Number("100000")` is a perfectly good
 * number, and honouring it would turn Coming up into exactly the unbounded list the window exists
 * to prevent. Nothing else guards this: the reader is the only check there is.
 *
 * The same care `viewPlaceOf` takes with `mls_last_place`, and for the same reason.
 */
export function upcomingWindowOf(value: string | undefined | null): number {
  const days = Number(value);

  return (UPCOMING_WINDOW_CHOICES as readonly number[]).includes(days)
    ? days
    : DEFAULT_UPCOMING_WINDOW_DAYS;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The five lists and the count, from one pass over the rows.
 *
 * Read the rules together, because what they leave out is deliberate:
 *
 * - **Work with no due date is in no deadline list.** It is outside the ordering rather than at one
 *   end of it, which is the same decision `listForCourse` makes with `nulls: "last"`. It still
 *   appears under In progress once accepted.
 * - **Graded work is never a deadline**, including work that came back below the threshold. That is
 *   `handedIn` doing the deciding, and its comment says why: resubmitting is a second attempt at
 *   work already handed in, and listing it as an outstanding deadline would tell a student they
 *   had missed something they in fact did. What that work gets instead is `needsAnotherAttempt`,
 *   which is a list of what to do rather than a list of what was missed.
 * - **In progress is `ACCEPTED` and nothing else.** Published work a student has not accepted is
 *   not in progress by any reading, and over a nine-month program it is most of the course — a
 *   student in week two would find forty rows of work they had not started. Where it belongs is
 *   the deadline lists, which is where its due date puts it.
 * - **Work due past the window is counted, not listed.** How deep Coming up goes is the caller's
 *   to say and a week by default; see `UPCOMING_WINDOW_CHOICES`. Every offered window leaves work
 *   outside it, so the count is never nothing merely because somebody widened their view.
 *
 * The two graded lists partition rather than overlap. Work that came back below the threshold is
 * in `needsAnotherAttempt` whether or not its report has been read, and nowhere else; everything
 * else that is graded and unread is feedback. A student who has read the report on a 9/15 has
 * finished reading and has not finished the work, and only one of those is what this screen is
 * counting.
 */
export function dashboardSections<Row extends DashboardRow>(
  rows: readonly Row[],
  now: Date,
  /**
   * How far ahead Coming up looks, in days. The student's own choice, resolved by the page from
   * `UPCOMING_WINDOW_COOKIE`. Defaulted here so that a caller with no opinion — the tests, and any
   * future reader that does not offer the picker — needs none.
   */
  windowDays: number = DEFAULT_UPCOMING_WINDOW_DAYS,
): DashboardSections<Row> {
  const upcoming: Row[] = [];
  const overdue: Row[] = [];
  const needsAnotherAttempt: Row[] = [];
  const unreadFeedback: Row[] = [];
  const inProgress: Row[] = [];
  let laterCount = 0;

  // Inclusive at the far edge, following `statusForCheckIn`: where a boundary has to fall one way,
  // the version decided in the student's favour is the one that never needs defending to them.
  const windowEnds = now.getTime() + windowDays * MS_PER_DAY;

  for (const row of rows) {
    const submission = row.submission;

    /*
      Below the threshold is a second attempt outstanding, and reading the report does not make it
      one fewer. `isComplete === false` rather than a comparison of the score against the
      assignment's threshold, which `lib/student/progress.ts` explains at more length: that
      judgment is made once, in `approveDraft`, and a second one in the browser is how a screen
      comes to disagree with the gradebook about who passed. The column is not even sent here.
    */
    const incomplete = submission?.status === "GRADED" && submission.isComplete === false;

    if (incomplete) {
      needsAnotherAttempt.push(row);
    } else if (submission != null && feedbackIsUnread(submission)) {
      /*
        `else` on `incomplete` rather than on `isComplete === true`, so a graded row carrying no
        verdict at all is read as feedback rather than falling out of both lists. Approval writes
        the status and the verdict in one transaction and cannot produce that row, but `handedIn`
        makes the same argument for the same reason: of the two ways to be wrong about a list like
        this, showing a student something they can see is stale beats silently dropping it.
      */
      unreadFeedback.push(row);
    }

    if (submission?.status === "ACCEPTED") {
      inProgress.push(row);
    }

    if (row.dueAt != null && !handedIn(submission?.status)) {
      if (row.dueAt.getTime() < now.getTime()) overdue.push(row);
      else if (row.dueAt.getTime() <= windowEnds) upcoming.push(row);
      else laterCount += 1;
    }
  }

  // Ascending in both deadline lists, which means different things in each and is right in both:
  // the next thing due is at the top of one, and the longest-neglected at the top of the other.
  upcoming.sort(byDueAtAscending);
  overdue.sort(byDueAtAscending);

  // Oldest grade first, which is the overdue list's reasoning applied to revision: the work that
  // has been waiting longest to be gone back to is the work to go back to.
  needsAnotherAttempt.sort(
    (a, b) => (a.submission?.gradedAt?.getTime() ?? 0) - (b.submission?.gradedAt?.getTime() ?? 0),
  );

  // Newest first, so the report from this morning is above the one from last week.
  unreadFeedback.sort(
    (a, b) => (b.submission?.gradedAt?.getTime() ?? 0) - (a.submission?.gradedAt?.getTime() ?? 0),
  );

  // Soonest deadline first here too. Work already taken up is ordered by when it is wanted.
  inProgress.sort(byDueAtAscending);

  return {
    upcoming,
    overdue,
    needsAnotherAttempt,
    unreadFeedback: unreadFeedback.slice(0, UNREAD_FEEDBACK_LIMIT),
    inProgress,
    laterCount,
  };
}

/** Assignments with no due date sit at the foot, never at the head. */
function byDueAtAscending(a: DashboardRow, b: DashboardRow): number {
  if (a.dueAt == null && b.dueAt == null) return 0;
  if (a.dueAt == null) return 1;
  if (b.dueAt == null) return -1;
  return a.dueAt.getTime() - b.dueAt.getTime();
}

/**
 * Whether there are any rows to draw, so the screen can offer one empty state, not five.
 *
 * `laterCount` is deliberately not part of this. Work due in a fortnight draws no rows and so
 * leaves the screen empty, but it is not nothing — which is why the empty state reads the count to
 * choose its words rather than assuming the student is finished.
 */
export function dashboardIsEmpty(sections: DashboardSections<DashboardRow>): boolean {
  return (
    sections.upcoming.length === 0 &&
    sections.overdue.length === 0 &&
    sections.needsAnotherAttempt.length === 0 &&
    sections.unreadFeedback.length === 0 &&
    sections.inProgress.length === 0
  );
}
