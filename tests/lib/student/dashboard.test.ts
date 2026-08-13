import type { SubmissionStatus } from "@/lib/generated/prisma/enums";
import {
  dashboardIsEmpty,
  dashboardSections,
  UNREAD_FEEDBACK_LIMIT,
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

describe("dashboardIsEmpty", () => {
  // One empty state rather than four, which is what makes a first week read as calm.
  it("is true when there is nothing at all to show", () => {
    expect(dashboardIsEmpty(dashboardSections([], NOW))).toBe(true);
    expect(dashboardIsEmpty(dashboardSections([row({ status: "SUBMITTED" })], NOW))).toBe(true);
  });

  it("is false as soon as one list has something", () => {
    expect(dashboardIsEmpty(dashboardSections([row({ dueAt: TOMORROW })], NOW))).toBe(false);
  });
});
