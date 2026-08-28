import type { SubmissionStatus } from "@/lib/generated/prisma/enums";
import {
  dashboardIsEmpty,
  dashboardSections,
  DEFAULT_UPCOMING_WINDOW_DAYS,
  UNREAD_FEEDBACK_LIMIT,
  UPCOMING_WINDOW_CHOICES,
  upcomingWindowOf,
  type DashboardRow,
} from "@/lib/student/dashboard";

/**
 * What a student should look at, across every course they are in.
 *
 * `now` is fixed rather than mocked, which is the whole reason the function takes it. Every case
 * below is a statement about a deadline relative to one instant, and none of them depend on when
 * the suite runs.
 */

const NOW = new Date("2026-10-09T12:00:00Z");

const YESTERDAY = new Date("2026-10-08T03:59:00Z");
const TOMORROW = new Date("2026-10-10T03:59:00Z");
const NEXT_WEEK = new Date("2026-10-16T03:59:00Z");

let counter = 0;

/** One assignment row, with only the parts a case is about spelled out. */
function row(
  overrides: {
    dueAt?: Date | null;
    status?: SubmissionStatus;
    gradedAt?: Date | null;
    feedbackReviewedAt?: Date | null;
    isComplete?: boolean | null;
  } = {},
): DashboardRow {
  counter += 1;
  const { dueAt = null, status, ...submissionOverrides } = overrides;

  return {
    id: `assignment-${counter}`,
    title: `Assignment ${counter}`,
    dueAt,
    course: { id: "course-1", name: "Software Engineering Fellowship" },
    submission:
      status == null
        ? null
        : {
            status,
            finalScore: null,
            finalScorePossible: null,
            isComplete: null,
            gradedAt: null,
            feedbackReviewedAt: null,
            ...submissionOverrides,
          },
  };
}

describe("deadlines", () => {
  it("puts unfinished work due later under upcoming", () => {
    const sections = dashboardSections([row({ dueAt: TOMORROW })], NOW);

    expect(sections.upcoming).toHaveLength(1);
    expect(sections.overdue).toHaveLength(0);
  });

  it("puts unfinished work whose deadline has gone under overdue", () => {
    const sections = dashboardSections([row({ dueAt: YESTERDAY })], NOW);

    expect(sections.overdue).toHaveLength(1);
    expect(sections.upcoming).toHaveLength(0);
  });

  // Accepting is receiving the work, not returning it, so it is still a deadline.
  it("still counts an accepted assignment as a deadline", () => {
    const sections = dashboardSections([row({ dueAt: TOMORROW, status: "ACCEPTED" })], NOW);
    expect(sections.upcoming).toHaveLength(1);
  });

  it("drops an assignment from both lists once it is handed in", () => {
    const sections = dashboardSections(
      [
        row({ dueAt: TOMORROW, status: "SUBMITTED" }),
        row({ dueAt: YESTERDAY, status: "SUBMITTED" }),
      ],
      NOW,
    );

    expect(sections.upcoming).toHaveLength(0);
    expect(sections.overdue).toHaveLength(0);
  });

  /*
    Including work that came back below the threshold. It is not an outstanding deadline — the
    student met it — and listing it as overdue would say they had missed something they did.
  */
  it("never lists graded work as a deadline, complete or not", () => {
    const sections = dashboardSections(
      [
        row({ dueAt: YESTERDAY, status: "GRADED", isComplete: false, gradedAt: NOW }),
        row({ dueAt: YESTERDAY, status: "GRADED", isComplete: true, gradedAt: NOW }),
      ],
      NOW,
    );

    expect(sections.overdue).toHaveLength(0);
    expect(sections.upcoming).toHaveLength(0);
  });

  // Outside the ordering rather than at one end of it, which is what `listForCourse` decides too.
  it("leaves work with no due date out of both lists", () => {
    const sections = dashboardSections([row({ dueAt: null, status: "ACCEPTED" })], NOW);

    expect(sections.upcoming).toHaveLength(0);
    expect(sections.overdue).toHaveLength(0);
    expect(sections.inProgress).toHaveLength(1);
  });

  it("puts the next thing due at the top of upcoming", () => {
    const sections = dashboardSections([row({ dueAt: NEXT_WEEK }), row({ dueAt: TOMORROW })], NOW);
    expect(sections.upcoming.map((r) => r.dueAt)).toEqual([TOMORROW, NEXT_WEEK]);
  });

  it("puts the longest-neglected at the top of overdue", () => {
    const older = new Date("2026-10-01T03:59:00Z");
    const sections = dashboardSections([row({ dueAt: YESTERDAY }), row({ dueAt: older })], NOW);

    expect(sections.overdue.map((r) => r.dueAt)).toEqual([older, YESTERDAY]);
  });
});

describe("unread feedback", () => {
  it("lists a graded assignment nobody has said they read", () => {
    const sections = dashboardSections([row({ status: "GRADED", gradedAt: YESTERDAY })], NOW);
    expect(sections.unreadFeedback).toHaveLength(1);
  });

  it("drops it once the student marks it read", () => {
    const sections = dashboardSections(
      [row({ status: "GRADED", gradedAt: YESTERDAY, feedbackReviewedAt: NOW })],
      NOW,
    );

    expect(sections.unreadFeedback).toHaveLength(0);
  });

  /*
    The case a single null check gets wrong, and the reason `feedbackIsUnread` compares two
    timestamps. Read the first report, resubmit, get graded again — the new report is new.
  */
  it("brings it back when a second grade lands after the read", () => {
    const sections = dashboardSections(
      [
        row({
          status: "GRADED",
          feedbackReviewedAt: new Date("2026-10-02T09:00:00Z"),
          gradedAt: YESTERDAY,
        }),
      ],
      NOW,
    );

    expect(sections.unreadFeedback).toHaveLength(1);
  });

  it("shows the newest report first", () => {
    const sections = dashboardSections(
      [
        row({ status: "GRADED", gradedAt: new Date("2026-10-01T09:00:00Z") }),
        row({ status: "GRADED", gradedAt: new Date("2026-10-08T09:00:00Z") }),
      ],
      NOW,
    );

    expect(sections.unreadFeedback.map((r) => r.submission?.gradedAt)).toEqual([
      new Date("2026-10-08T09:00:00Z"),
      new Date("2026-10-01T09:00:00Z"),
    ]);
  });

  /*
    A cap rather than a scroll. This section exists to say there is something new to read, and a
    list of thirty says the opposite by being one more pile to work through.
  */
  it("caps the list, keeping the newest", () => {
    const rows = Array.from({ length: UNREAD_FEEDBACK_LIMIT + 5 }, (_, i) =>
      row({ status: "GRADED", gradedAt: new Date(2026, 9, i + 1) }),
    );
    const sections = dashboardSections(rows, NOW);

    expect(sections.unreadFeedback).toHaveLength(UNREAD_FEEDBACK_LIMIT);
    expect(sections.unreadFeedback[0].submission?.gradedAt).toEqual(
      new Date(2026, 9, UNREAD_FEEDBACK_LIMIT + 5),
    );
  });

  it("has nothing to report for work still with an instructor", () => {
    const sections = dashboardSections([row({ status: "SUBMITTED" })], NOW);
    expect(sections.unreadFeedback).toHaveLength(0);
  });
});

/**
 * In progress is `ACCEPTED` and nothing else.
 *
 * The broad reading — every published assignment not yet accepted — is most of a nine-month course.
 * A student in week two would find forty rows here, every one of them work they had not started.
 */
describe("in progress", () => {
  it("holds work taken up and not handed in", () => {
    const sections = dashboardSections([row({ status: "ACCEPTED", dueAt: TOMORROW })], NOW);
    expect(sections.inProgress).toHaveLength(1);
  });

  it("does not hold work the student has never accepted", () => {
    const sections = dashboardSections(
      [row({ dueAt: TOMORROW }), row({ status: "NOT_STARTED" })],
      NOW,
    );
    expect(sections.inProgress).toHaveLength(0);
  });

  it.each(["SUBMITTED", "RESUBMITTED", "GRADED", "DRAFT_READY"] as const)(
    "does not hold %s",
    (status) => {
      expect(dashboardSections([row({ status })], NOW).inProgress).toHaveLength(0);
    },
  );

  it("orders by what is wanted soonest", () => {
    const sections = dashboardSections(
      [
        row({ status: "ACCEPTED", dueAt: NEXT_WEEK }),
        row({ status: "ACCEPTED", dueAt: TOMORROW }),
        row({ status: "ACCEPTED", dueAt: null }),
      ],
      NOW,
    );

    expect(sections.inProgress.map((r) => r.dueAt)).toEqual([TOMORROW, NEXT_WEEK, null]);
  });
});

/**
 * One row can be in more than one list, and should be.
 *
 * An accepted assignment due tomorrow is both a deadline and work in progress. Those are two
 * different questions a student asks, and answering only one of them would hide the row from
 * whichever list they happened to look at.
 */
describe("a row appearing in two lists", () => {
  it("counts an accepted assignment as both a deadline and in progress", () => {
    const sections = dashboardSections([row({ status: "ACCEPTED", dueAt: TOMORROW })], NOW);

    expect(sections.upcoming).toHaveLength(1);
    expect(sections.inProgress).toHaveLength(1);
    expect(sections.upcoming[0].id).toBe(sections.inProgress[0].id);
  });
});

/**
 * Coming up is a week deep by default, and what falls outside it is counted rather than listed.
 *
 * The count is the whole point of the window being safe. Rows that are neither drawn nor counted
 * are rows the screen has quietly forgotten, and the empty state would then congratulate a student
 * with a fortnight of work ahead of them. That has to hold at every window a fellow can choose,
 * not only at the default, which is what the last two cases here are for.
 */
describe("the upcoming window", () => {
  const IN_SIX_DAYS = new Date("2026-10-15T12:00:00Z");
  const EXACTLY_SEVEN_DAYS = new Date("2026-10-16T12:00:00Z");
  const IN_EIGHT_DAYS = new Date("2026-10-17T12:00:00Z");
  const IN_A_MONTH = new Date("2026-11-09T12:00:00Z");

  it("lists work due inside the window", () => {
    const sections = dashboardSections([row({ dueAt: IN_SIX_DAYS })], NOW);

    expect(sections.upcoming).toHaveLength(1);
    expect(sections.laterCount).toBe(0);
  });

  // Somebody has to decide where a boundary falls, and deciding in the student's favour is the
  // version that never needs defending to them. `statusForCheckIn` makes the same call.
  it("counts the far edge as inside", () => {
    const sections = dashboardSections([row({ dueAt: EXACTLY_SEVEN_DAYS })], NOW);

    expect(sections.upcoming).toHaveLength(1);
    expect(sections.laterCount).toBe(0);
  });

  it("counts work due past the window without listing it", () => {
    const sections = dashboardSections(
      [row({ dueAt: IN_EIGHT_DAYS }), row({ dueAt: IN_A_MONTH })],
      NOW,
    );

    expect(sections.upcoming).toHaveLength(0);
    expect(sections.laterCount).toBe(2);
  });

  // The window is a statement about deadlines a student can still meet. One they missed in
  // September is still theirs to do, however long ago it was.
  it("does not window overdue work", () => {
    const longAgo = new Date("2026-08-01T12:00:00Z");
    const sections = dashboardSections([row({ dueAt: longAgo })], NOW);

    expect(sections.overdue).toHaveLength(1);
    expect(sections.laterCount).toBe(0);
  });

  it("does not count work that has been handed in", () => {
    const sections = dashboardSections([row({ dueAt: IN_A_MONTH, status: "SUBMITTED" })], NOW);
    expect(sections.laterCount).toBe(0);
  });

  it("does not count work with no due date", () => {
    const sections = dashboardSections([row({ dueAt: null, status: "ACCEPTED" })], NOW);
    expect(sections.laterCount).toBe(0);
  });

  /*
    The state the count exists for: no rows to draw, and a fortnight of work outstanding. The
    screen is empty and the student is not up to date, and those are different sentences.
  */
  it("leaves the screen empty while still reporting the work", () => {
    const sections = dashboardSections([row({ dueAt: IN_A_MONTH })], NOW);

    expect(dashboardIsEmpty(sections)).toBe(true);
    expect(sections.laterCount).toBe(1);
  });

  // The same four rows, read at three windows. This is what the fellow's picker buys them, and
  // the counts moving in opposite directions is the whole of the behaviour.
  it("draws a different line for a different window", () => {
    const rows = [
      row({ dueAt: IN_SIX_DAYS }),
      row({ dueAt: EXACTLY_SEVEN_DAYS }),
      row({ dueAt: IN_EIGHT_DAYS }),
      row({ dueAt: IN_A_MONTH }),
    ];

    const narrow = dashboardSections(rows, NOW, 3);
    expect(narrow.upcoming).toHaveLength(0);
    expect(narrow.laterCount).toBe(4);

    const wide = dashboardSections(rows, NOW, 30);
    expect(wide.upcoming).toHaveLength(3);
    expect(wide.laterCount).toBe(1);
  });

  /*
    Nothing a fellow can choose empties the count of everything, which is what keeps the empty
    state honest at every setting. It is why the offered list stops at thirty days rather than
    offering "everything": `laterCount` would then be permanently zero and the screen would have
    no way left to say that more work exists.
  */
  it("still counts work past the widest window", () => {
    const inTwoMonths = new Date("2026-12-09T12:00:00Z");
    const sections = dashboardSections([row({ dueAt: inTwoMonths })], NOW, 30);

    expect(sections.upcoming).toHaveLength(0);
    expect(sections.laterCount).toBe(1);
  });
});

/**
 * The window comes out of a cookie, and a cookie is a value somebody can set.
 *
 * Reading it as a plain number would honour `100000` — an unbounded Coming up, which is the one
 * thing the window exists to prevent. Checking it against the offered list is the only guard
 * there is, so these are the cases that guard has to get right.
 */
describe("reading a remembered window", () => {
  it("takes every window on offer", () => {
    for (const days of UPCOMING_WINDOW_CHOICES) {
      expect(upcomingWindowOf(String(days))).toBe(days);
    }
  });

  it("falls back to the default when nothing was remembered", () => {
    expect(upcomingWindowOf(undefined)).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
    expect(upcomingWindowOf(null)).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
    expect(upcomingWindowOf("")).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
  });

  // A real number, and not one on offer. `Number` would happily return it.
  it("refuses a window nobody was offered", () => {
    expect(upcomingWindowOf("100000")).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
    expect(upcomingWindowOf("8")).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
    expect(upcomingWindowOf("-7")).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
  });

  it("refuses a value that is not a number at all", () => {
    expect(upcomingWindowOf("everything")).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
    expect(upcomingWindowOf("7; drop")).toBe(DEFAULT_UPCOMING_WINDOW_DAYS);
  });
});

/**
 * Work that came back below the threshold is a second attempt outstanding.
 *
 * Reading the report is not doing the work, which is the distinction this list draws against
 * unread feedback. Marking a 9/15 as read used to take it off this screen entirely, leaving a
 * student who had read every report and revised none of them being told they were up to date.
 */
describe("needs another attempt", () => {
  it("lists graded work below the threshold", () => {
    const sections = dashboardSections(
      [row({ status: "GRADED", isComplete: false, gradedAt: YESTERDAY })],
      NOW,
    );

    expect(sections.needsAnotherAttempt).toHaveLength(1);
  });

  it("keeps it after the report has been marked read", () => {
    const sections = dashboardSections(
      [row({ status: "GRADED", isComplete: false, gradedAt: YESTERDAY, feedbackReviewedAt: NOW })],
      NOW,
    );

    expect(sections.needsAnotherAttempt).toHaveLength(1);
    expect(dashboardIsEmpty(sections)).toBe(false);
  });

  // The two graded lists partition. Incomplete work is a thing to do, not a thing to read, and a
  // row in both would be counted twice by a student reading down the screen.
  it("keeps it out of unread feedback", () => {
    const sections = dashboardSections(
      [row({ status: "GRADED", isComplete: false, gradedAt: YESTERDAY })],
      NOW,
    );

    expect(sections.unreadFeedback).toHaveLength(0);
  });

  it("leaves work that met the threshold to the feedback list", () => {
    const sections = dashboardSections(
      [row({ status: "GRADED", isComplete: true, gradedAt: YESTERDAY })],
      NOW,
    );

    expect(sections.needsAnotherAttempt).toHaveLength(0);
    expect(sections.unreadFeedback).toHaveLength(1);
  });

  /*
    Approval writes the status and the verdict in one transaction, so this row should not exist.
    If one does, it reads as feedback rather than falling out of every list — of the two ways to
    be wrong, showing something stale beats silently dropping it.
  */
  it("treats a graded row with no verdict as feedback", () => {
    const sections = dashboardSections(
      [row({ status: "GRADED", isComplete: null, gradedAt: YESTERDAY })],
      NOW,
    );

    expect(sections.needsAnotherAttempt).toHaveLength(0);
    expect(sections.unreadFeedback).toHaveLength(1);
  });

  // Handing it in again is what clears it, which is the only thing that can.
  it.each(["RESUBMITTED", "SUBMITTED"] as const)("clears once it goes back as %s", (status) => {
    const sections = dashboardSections(
      [row({ status, isComplete: false, gradedAt: YESTERDAY })],
      NOW,
    );

    expect(sections.needsAnotherAttempt).toHaveLength(0);
  });

  it("puts the longest-outstanding at the top", () => {
    const older = new Date("2026-09-20T09:00:00Z");
    const sections = dashboardSections(
      [
        row({ status: "GRADED", isComplete: false, gradedAt: YESTERDAY }),
        row({ status: "GRADED", isComplete: false, gradedAt: older }),
      ],
      NOW,
    );

    expect(sections.needsAnotherAttempt.map((r) => r.submission?.gradedAt)).toEqual([
      older,
      YESTERDAY,
    ]);
  });

  // A cap here would hide work. The feedback list is capped because it is news; this is a to-do.
  it("is not capped", () => {
    const rows = Array.from({ length: UNREAD_FEEDBACK_LIMIT + 5 }, (_, i) =>
      row({ status: "GRADED", isComplete: false, gradedAt: new Date(2026, 9, i + 1) }),
    );

    expect(dashboardSections(rows, NOW).needsAnotherAttempt).toHaveLength(
      UNREAD_FEEDBACK_LIMIT + 5,
    );
  });
});

describe("dashboardIsEmpty", () => {
  // One empty state rather than five, which is what makes a first week read as calm.
  it("is true when there is nothing at all to show", () => {
    expect(dashboardIsEmpty(dashboardSections([], NOW))).toBe(true);
    expect(dashboardIsEmpty(dashboardSections([row({ status: "SUBMITTED" })], NOW))).toBe(true);
  });

  it("is false as soon as one list has something", () => {
    expect(dashboardIsEmpty(dashboardSections([row({ dueAt: TOMORROW })], NOW))).toBe(false);
  });
});
