/**
 * The student's dashboard and the read-feedback marker.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:local` against the disposable
 * local database.
 *
 * `dashboardSections` and `progressSegments` are pure and already tested against fixtures under
 * `tests/lib/student/`. What those cannot answer is whether `assignments.listMine` and
 * `attendance.myWeek` return the shapes they expect and scope themselves to the caller, and whether
 * `submissions.markFeedbackReviewed` refuses what it should. All are answered here by driving the
 * procedures as real people.
 *
 * **The scoping checks are the point of the file.** Prisma connects as the table owner and is not
 * restricted by row level security, so a `where` clause is the only thing standing between one
 * student and another's work. A missing clause is invisible in the interface — every screen still
 * looks right to the person who wrote it — and shows up here as a count that is too high.
 *
 * **One transaction for the whole file**, opened before anything else and rolled back at the end.
 * Everything below is built inside it: two fellows on one roster, a published course, an archived
 * one, an unpublished one, and a piece of work in every state the five sections partition. The
 * script this replaces read whatever the development database happened to hold, which is why three
 * of its checks had never run and why its counts moved when somebody used the application.
 *
 * Carries the 36 assertions `verify:dashboard` reported on 2 September 2026, and the three it did
 * not: that one student's submissions do not reach another's dashboard, that one fellow's
 * attendance is not counted into another's rate, and that one student cannot mark another's
 * feedback read. All three needed a second fellow on the roster, the seed has one, and so the
 * script reported three skips and **exited non-zero on every run** while measuring none of them.
 *
 * None of them is vacuous against a fellow with nothing of their own: a `listMine` missing its
 * filter would attach the *first* fellow's submission to the second fellow's row, and that is what
 * each of them looks for.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import { feedbackIsUnread } from "@/lib/status";
import {
  DEFAULT_UPCOMING_WINDOW_DAYS,
  dashboardIsEmpty,
  dashboardSections,
} from "@/lib/student/dashboard";
import { completeCount, progressSegments } from "@/lib/student/progress";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAssignment, makeCourse, makeSubmission, makeUnit, makeWorld } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
/** A caller carrying the identity the procedures authorize against. */
const as = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/*
  Opened first, so that the hook this registers runs before the one below it that fills it. Two
  minutes, because the fixture is large and the whole file shares this one transaction.
*/
const tx = withRollback(120_000);

/** A fixed instant every deadline below is placed relative to, so the sections are facts. */
const now = new Date();
const days = (count: number) => new Date(now.getTime() + count * 24 * 60 * 60 * 1000);

let studentId: string;
let otherId: string;
let programId: string;
let courseId: string;
let rows: Awaited<ReturnType<ReturnType<typeof as>["assignments"]["listMine"]>>;
/** The pieces of work later groups name. */
let unpublishedWork: { id: string };
let archivedWork: { id: string };
let unpublishedCourseWork: { id: string };
let gradedSubmissionId: string;
let ungradedSubmissionId: string;
let mineOnSharedWork: { id: string };

beforeAll(async () => {
  const world = await makeWorld(tx(), { students: 2 });
  programId = world.programId;
  courseId = world.courseId;
  studentId = world.students[0]!.studentId;
  otherId = world.students[1]!.studentId;

  const unit = world.unitId;

  /*
    One assignment per state the five sections partition, so every list below holds something and no
    check passes by being about an empty array.
  */
  await makeAssignment(tx(), { courseId, courseUnitId: unit, title: "Overdue", dueAt: days(-3) });
  await makeAssignment(tx(), { courseId, courseUnitId: unit, title: "Upcoming", dueAt: days(1) });
  await makeAssignment(tx(), {
    courseId,
    courseUnitId: unit,
    title: "Later",
    dueAt: days(DEFAULT_UPCOMING_WINDOW_DAYS + 10),
  });
  const gradedComplete = await makeAssignment(tx(), {
    courseId,
    courseUnitId: unit,
    title: "Graded, complete, unread",
    dueAt: days(-10),
  });
  const gradedIncomplete = await makeAssignment(tx(), {
    courseId,
    courseUnitId: unit,
    title: "Graded, below the threshold",
    dueAt: days(-9),
  });
  const accepted = await makeAssignment(tx(), {
    courseId,
    courseUnitId: unit,
    title: "In progress",
    dueAt: days(2),
  });
  const handedIn = await makeAssignment(tx(), {
    courseId,
    courseUnitId: unit,
    title: "Handed in, not graded",
    dueAt: days(-1),
  });

  const graded = await makeSubmission(tx(), {
    assignmentId: gradedComplete.id,
    studentId,
    graded: { score: 10, possible: 10, isComplete: true },
  });
  gradedSubmissionId = graded.id;

  /*
    Marked read, so it sits in "needs another attempt" alone. A row below the threshold whose report
    is also unread is legitimately in both lists, and this file has a check that the two partition —
    which is about the rule, not about this row.
  */
  await makeSubmission(tx(), {
    assignmentId: gradedIncomplete.id,
    studentId,
    graded: { score: 4, possible: 10, isComplete: false, reviewed: true },
  });

  await makeSubmission(tx(), {
    assignmentId: accepted.id,
    studentId,
    status: "ACCEPTED",
    submittedAt: null,
  });

  const ungraded = await makeSubmission(tx(), {
    assignmentId: handedIn.id,
    studentId,
    status: "SUBMITTED",
  });
  ungradedSubmissionId = ungraded.id;
  mineOnSharedWork = ungraded;

  /*
    The three that must not appear, each made rather than assumed. A count of zero against rows that
    could never have been there is a check about nothing; these give it something to exclude.
  */
  unpublishedWork = await makeAssignment(tx(), {
    courseId,
    courseUnitId: unit,
    title: "Unpublished",
    dueAt: days(1),
    published: false,
  });

  const archivedCourse = await makeCourse(tx(), { programId });
  await tx().course.update({ where: { id: archivedCourse.id }, data: { archivedAt: now } });
  const archivedUnit = await makeUnit(tx(), { courseId: archivedCourse.id });
  archivedWork = await makeAssignment(tx(), {
    courseId: archivedCourse.id,
    courseUnitId: archivedUnit.id,
    title: "In an archived course",
    dueAt: days(1),
  });

  const unpublishedCourse = await makeCourse(tx(), { programId, published: false });
  const unpublishedUnit = await makeUnit(tx(), { courseId: unpublishedCourse.id });
  unpublishedCourseWork = await makeAssignment(tx(), {
    courseId: unpublishedCourse.id,
    courseUnitId: unpublishedUnit.id,
    title: "In an unpublished course",
    dueAt: days(1),
  });

  rows = await as(tx(), studentId).assignments.listMine();
});

/** What a call refused with, as a string to compare against. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

describe("what listMine returns", () => {
  it("listMine returned something to check", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  /*
    The flattening `listMine` does and `listForCourse` deliberately does not. Its consumers were
    written against the array; a new read has no such history, and a list of at most one is a shape
    every call site would unwrap for nothing.
  */
  it("every row carries `submission` as one row or null, never an array", () => {
    expect(rows.every((r) => !Array.isArray((r as { submission: unknown }).submission))).toBe(true);
  });

  // What `DashboardRow` names. A select that stops returning one of these is a runtime undefined in
  // a sort comparator rather than a type error, because the payload crosses a boundary here.
  it("a graded row carries both timestamps the unread test needs", () => {
    const graded = rows.find((r) => r.submission?.status === "GRADED");
    expect(
      graded != null &&
        "gradedAt" in graded.submission! &&
        "feedbackReviewedAt" in graded.submission!,
    ).toBe(true);
  });

  it("every row names its course and its unit", () => {
    expect(rows.every((r) => Boolean(r.course?.id && r.course?.name && r.courseUnit?.name))).toBe(
      true,
    );
  });
});

describe("what listMine keeps out", () => {
  /*
    Unpublished work is invisible here unconditionally. This procedure has no instructor mode to
    fall into — unlike `listForCourse`, which shows drafts to somebody who teaches the course — so
    an assignment with a null `distributedAt` must not appear even for an instructor calling it.
  */
  it("no unpublished assignment reached the dashboard", () => {
    expect(rows.some((r) => r.id === unpublishedWork.id)).toBe(false);
  });

  // Archived courses stay readable on their own page and are not deadlines any more.
  it("no archived course's work reached the dashboard", () => {
    expect(rows.some((r) => r.id === archivedWork.id)).toBe(false);
  });

  /*
    And an unpublished *course* is invisible the same way an unpublished assignment is, which is the
    third of the three readers of `Course.publishedAt` that have to agree. Being on a term's roster
    makes somebody a student of every course in it, so publication is the only thing keeping a
    course that begins in March off this list in September — and this feed is where a disagreement
    would show up as a deadline for work nobody has been given.
  */
  it("no unpublished course's work reached the dashboard", () => {
    expect(rows.some((r) => r.id === unpublishedCourseWork.id)).toBe(false);
  });

  // Every submission attached belongs to the caller. The clause that guarantees it is the only
  // thing that does.
  it("no other fellow's submission was attached", async () => {
    const foreign = await tx().submission.count({
      where: {
        id: { in: rows.map((r) => r.submission?.id).filter((id): id is string => id != null) },
        studentId: { not: studentId },
      },
    });
    expect(foreign).toBe(0);
  });
});

describe("the five sections, and the count beside them", () => {
  let sections: ReturnType<typeof dashboardSections>;

  beforeAll(() => {
    sections = dashboardSections(rows, now);
  });

  it("nothing handed in is listed as a deadline", () => {
    expect(
      [...sections.upcoming, ...sections.overdue].every((r) => {
        const status = r.submission?.status;
        return status == null || status === "NOT_STARTED" || status === "ACCEPTED";
      }),
    ).toBe(true);
  });

  it("every deadline listed has a due date", () => {
    expect([...sections.upcoming, ...sections.overdue].every((r) => r.dueAt != null)).toBe(true);
  });

  /*
    The default window, because that is what `dashboardSections` was called with above. A fellow's
    own choice lives in a cookie this file has no request to read, and the partition below is the
    thing worth checking against real data — it holds at every window.
  */
  it("upcoming is inside the window and overdue is in the past", () => {
    const windowEnds = now.getTime() + DEFAULT_UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    expect(
      sections.upcoming.every(
        (r) => r.dueAt!.getTime() >= now.getTime() && r.dueAt!.getTime() <= windowEnds,
      ) && sections.overdue.every((r) => r.dueAt!.getTime() < now.getTime()),
    ).toBe(true);
  });

  /*
    Every outstanding deadline is drawn or counted, and none is both. A row that is neither is one
    the screen has quietly forgotten — which is exactly what the count exists to prevent, and the
    only failure of the window that a student could not see for themselves.
  */
  it("every outstanding deadline is either listed or counted", () => {
    const outstanding = rows.filter(
      (r) =>
        r.dueAt != null &&
        (r.submission == null ||
          r.submission.status === "NOT_STARTED" ||
          r.submission.status === "ACCEPTED"),
    );
    expect(sections.overdue.length + sections.upcoming.length + sections.laterCount).toBe(
      outstanding.length,
    );
  });

  it("every unread report is graded work the student has not marked read", () => {
    expect(sections.unreadFeedback.every((r) => feedbackIsUnread(r.submission!))).toBe(true);
  });

  it("the unread list is capped at ten", () => {
    expect(sections.unreadFeedback.length).toBeLessThanOrEqual(10);
  });

  /*
    The two graded lists partition. Work below the threshold is a second attempt outstanding and is
    never also a report to read — a student reading down the screen would otherwise count one
    assignment twice.
  */
  it("needs another attempt holds graded work below the threshold and nothing else", () => {
    expect(
      sections.needsAnotherAttempt.every(
        (r) => r.submission?.status === "GRADED" && r.submission.isComplete === false,
      ),
    ).toBe(true);
  });

  it("no row is both a second attempt and a report to read", () => {
    expect(
      sections.unreadFeedback.every(
        (r) => !sections.needsAnotherAttempt.some((other) => other.id === r.id),
      ),
    ).toBe(true);
  });

  // Reading a report is not doing the work, so nothing in this list is cleared by having been read.
  it("a report already marked read still leaves its work outstanding", () => {
    expect(sections.needsAnotherAttempt.every((r) => r.submission != null)).toBe(true);
  });

  it("in progress holds accepted work and nothing else", () => {
    expect(sections.inProgress.every((r) => r.submission?.status === "ACCEPTED")).toBe(true);
  });

  it("dashboardIsEmpty agrees with the five lists", () => {
    expect(dashboardIsEmpty(sections)).toBe(
      sections.upcoming.length === 0 &&
        sections.overdue.length === 0 &&
        sections.needsAnotherAttempt.length === 0 &&
        sections.unreadFeedback.length === 0 &&
        sections.inProgress.length === 0,
    );
  });
});

/*
  The attendance strip. The second cross-scope read on this screen, and the second place a missing
  `where` clause would hand one fellow another's record. The shape checks matter for a different
  reason: the strip draws squares from `days` and a figure from `summary`, and a procedure that
  returned a week the columns do not cover draws a row of blanks that looks exactly like a quiet
  week.
*/
describe("myWeek, the attendance strip", () => {
  let week: Awaited<ReturnType<ReturnType<typeof as>["attendance"]["myWeek"]>>;

  beforeAll(async () => {
    week = await as(tx(), studentId).attendance.myWeek();
  });

  it("the week runs Monday to Sunday", () => {
    expect(
      week.columns.length === 0 ||
        (week.week.from <= week.columns[0]! && week.week.to >= week.columns.at(-1)!),
    ).toBe(true);
  });

  /*
    One row per term the fellow is on the roster of, and no more. It is the check that says the
    strip is program-shaped rather than course-shaped: this fixture's program holds three courses,
    so a procedure that had kept its old scoping would return three rows saying the same thing.
  */
  it("there is one row per program, not per course", async () => {
    const rosters = await tx().enrollment.count({
      where: { studentId, status: "ACTIVE", program: { archivedAt: null } },
    });
    expect(week.programs).toHaveLength(rosters);
  });

  it("every program draws one square per column", () => {
    expect(week.programs.every((row) => row.days.length === week.columns.length)).toBe(true);
  });

  it("the squares are the columns, in order", () => {
    expect(
      week.programs.every((row) => row.days.every((day, i) => day.day === week.columns[i])),
    ).toBe(true);
  });

  // Cumulative and never a weekly rate: the denominator is mornings somebody opened, so a week with
  // a forgotten one would read as a full week.
  it("the figure beside the squares is the term's, not the week's", () => {
    expect(
      week.programs.every(
        (row) => row.summary.rate == null || row.summary.attended <= row.summary.eligible,
      ),
    ).toBe(true);
  });

  it("no archived or dropped program is in the strip", async () => {
    const wrong = await tx().enrollment.count({
      where: {
        studentId,
        programId: { in: week.programs.map((row) => row.program.id) },
        OR: [{ status: { not: "ACTIVE" } }, { program: { archivedAt: { not: null } } }],
      },
    });
    expect(wrong).toBe(0);
  });
});

/*
  ---- The checks the script could never run ----------------------------------

  Every one compares one fellow's screen against another's, and the script skipped all three
  because a seeded roster holds one fellow. The second fellow is on the same program's roster, made
  by the fixture above.
*/
describe("what one fellow's screen must never show of another's", () => {
  it("one student's submissions do not appear in another's dashboard", async () => {
    const theirs = await as(tx(), otherId).assignments.listMine();
    const leaked = theirs.filter(
      (r) => r.submission != null && rows.some((m) => m.submission?.id === r.submission?.id),
    );
    expect(leaked).toHaveLength(0);
  });

  /*
    `summarize` is handed the caller's own records and nobody else's, and the comparison of
    `enrollmentId` against the caller's enrollments is the only thing making that true — Prisma
    connects as the owner and row level security does not apply. The second fellow has no records at
    all, so anything above zero is somebody else's.
  */
  it("one fellow's attendance is not counted into another's rate", async () => {
    const theirWeek = await as(tx(), otherId).attendance.myWeek();
    const theirAttended = theirWeek.programs.reduce((sum, row) => sum + row.summary.attended, 0);
    const theirOwn = await tx().attendanceRecord.count({
      where: { enrollment: { studentId: otherId }, status: { in: ["PRESENT", "LATE"] } },
    });
    expect(theirAttended).toBeLessThanOrEqual(theirOwn);
  });

  /*
    The check this file exists for. Prisma bypasses row level security, so the comparison of
    `studentId` against the caller is the only thing stopping one student writing on another's row —
    and a FORBIDDEN here is that comparison being present.
  */
  it("one student cannot mark another's feedback read", async () => {
    const code = await refusal(() =>
      as(tx(), otherId).submissions.markFeedbackReviewed({ submissionId: mineOnSharedWork.id }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  The progress bar, against the same rows the course page draws. The published course of the term,
  because an unpublished one is refused to a fellow and naming one would report a working guard as a
  broken screen.
*/
describe("the progress bar", () => {
  let courseRows: Awaited<ReturnType<ReturnType<typeof as>["assignments"]["listForCourse"]>>;

  beforeAll(async () => {
    courseRows = await as(tx(), studentId).assignments.listForCourse({ courseId });
  });

  it("the bar accounts for every assignment on the course page", () => {
    const segments = progressSegments(courseRows);
    expect(segments.reduce((sum, s) => sum + s.count, 0)).toBe(courseRows.length);
  });

  /*
    The header count and the green segment are one function, which is the pairing whose only real
    failure is telling a student two different things on one screen.
  */
  it("the complete count is the green segment", () => {
    const segments = progressSegments(courseRows);
    expect(completeCount(courseRows)).toBe(segments.find((s) => s.state === "complete")?.count ?? 0);
  });

  // `isComplete` is the column approval writes, never arithmetic done in the browser. If these ever
  // disagree, one of the two readings of "complete" is wrong.
  it("complete means isComplete and not a score comparison", () => {
    expect(completeCount(courseRows)).toBe(
      courseRows.filter((a) => a.submissions[0]?.isComplete === true).length,
    );
  });

  it("listForCourse carries feedbackReviewedAt for the panel to read", () => {
    expect(courseRows.every((a) => a.submissions.every((s) => "feedbackReviewedAt" in s))).toBe(
      true,
    );
  });
});

describe("what markFeedbackReviewed refuses", () => {
  it("an unknown submission is not found", async () => {
    const code = await refusal(() =>
      as(tx(), studentId).submissions.markFeedbackReviewed({
        submissionId: "00000000-0000-4000-8000-000000000000",
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });

  it("feedback cannot be marked read before it exists", async () => {
    const code = await refusal(() =>
      as(tx(), studentId).submissions.markFeedbackReviewed({ submissionId: ungradedSubmissionId }),
    );
    expect(code).toBe("BAD_REQUEST");
  });
});

/** The four columns every read in the group below selects, and the row they come back as. */
const REVIEW_COLUMNS = {
  status: true,
  gradedAt: true,
  feedbackReviewedAt: true,
  lastActivityAt: true,
} as const;

type ReviewRow = Prisma.SubmissionGetPayload<{ select: typeof REVIEW_COLUMNS }>;

describe("what marking a report read writes", () => {
  let before: ReviewRow;
  let after: ReviewRow;

  /*
    Last in the file, because it rewrites the graded row every group above reads. Its writes are
    discarded with the transaction like everything else.
  */
  it("the graded row carries the timestamp the unread test compares against", async () => {
    const row = await tx().submission.findUniqueOrThrow({
      where: { id: gradedSubmissionId },
      select: REVIEW_COLUMNS,
    });
    expect(row.gradedAt).not.toBeNull();
  });

  it("cleared, the report reads as unread", async () => {
    before = await tx().submission.update({
      where: { id: gradedSubmissionId },
      data: { feedbackReviewedAt: null },
      select: REVIEW_COLUMNS,
    });
    expect(feedbackIsUnread(before)).toBe(true);
  });

  it("marked, the report reads as read", async () => {
    after = await tx().submission.update({
      where: { id: gradedSubmissionId },
      data: { feedbackReviewedAt: new Date() },
      select: REVIEW_COLUMNS,
    });
    expect(feedbackIsUnread(after)).toBe(false);
  });

  /*
    The rule a second round depends on, and the reason the column is compared against `gradedAt`
    rather than checked for null. A student reads their report, resubmits, and is graded again — the
    new report is new, and a null check would have called it read.
  */
  it("a later grade makes the report unread again", async () => {
    const regraded = await tx().submission.update({
      where: { id: gradedSubmissionId },
      data: { gradedAt: new Date(Date.now() + 60_000) },
      select: REVIEW_COLUMNS,
    });
    expect(feedbackIsUnread(regraded)).toBe(true);
  });

  /*
    Reading feedback is not activity on the work. `lastActivityAt` drives the instructor's queue
    ordering, and moving it here would push a submission up a pile nobody needed to look at again.
  */
  it("marking a report read leaves lastActivityAt alone", () => {
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
  });
});
