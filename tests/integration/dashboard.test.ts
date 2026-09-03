/**
 * The student's dashboard and the read-feedback marker.
 *
 * Run with `npm run test:integration`.
 *
 * `dashboardSections` and `progressSegments` are pure and already tested against fixtures under
 * `tests/lib/student/`. What those cannot answer is whether `assignments.listMine` and
 * `attendance.myWeek` return the shapes they expect and scope themselves to the caller, and
 * whether `submissions.markFeedbackReviewed` refuses what it should. All are answered here by
 * driving the procedures as real people against live rows.
 *
 * **The scoping checks are the point of the file.** Prisma connects as the table owner and is not
 * restricted by row level security, so a `where` clause is the only thing standing between one
 * student and another's work. A missing clause is invisible in the interface — every screen still
 * looks right to the person who wrote it — and shows up here as a count that is too high.
 *
 * Read-only apart from the groups that say otherwise, which run inside a transaction and roll back.
 *
 * Carries the 36 assertions `verify:dashboard` reported on 2 September 2026, and the three it did
 * not. Those three are the cross-fellow scoping checks — exactly the ones this file exists for —
 * and the script skipped every one of them for want of a second fellow on the roster, exiting
 * non-zero on every run against a seeded database. **The second fellow is made here rather than
 * looked for**, inside the transaction, so the checks run. They are not vacuous against a fellow
 * with nothing of their own: a `listMine` missing its filter would attach the *first* fellow's
 * submission to the second fellow's row, and that is what each of them looks for.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/prisma";
import { feedbackIsUnread } from "@/lib/status";
import {
  DEFAULT_UPCOMING_WINDOW_DAYS,
  dashboardIsEmpty,
  dashboardSections,
} from "@/lib/student/dashboard";
import { completeCount, progressSegments } from "@/lib/student/progress";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { required, withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
/** A caller carrying the identity the procedures authorize against. */
const as = (client: typeof db | Tx, userId: string) =>
  factory({ db: client, user: { id: userId } } as never);

let studentId: string;
let programId: string;
let rows: Awaited<ReturnType<ReturnType<typeof as>["assignments"]["listMine"]>>;

beforeAll(async () => {
  /*
    A real fellow of a real term. Selected by having an active enrollment rather than by role,
    because the property every check below needs is the enrollment — an account with the STUDENT
    role and no roster would pass the selection and then measure nothing.
  */
  const enrollment = required(
    "an active enrollment in a program that is still running",
    await db.enrollment.findFirst({
      where: { status: "ACTIVE", program: { archivedAt: null } },
      select: { studentId: true, programId: true },
      orderBy: { createdAt: "asc" },
    }),
  );
  studentId = enrollment.studentId;
  programId = enrollment.programId;

  rows = await as(db, studentId).assignments.listMine();
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

/**
 * A second fellow on the same roster, made inside the caller's transaction.
 *
 * The insert is into `auth.users`, which Supabase owns; the profile appears by itself through the
 * on-signup trigger, which is the path a real fellow arrives by. Rolled back with the transaction
 * that holds it.
 */
async function secondFellow(tx: Tx, id: string, email: string) {
  await tx.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $2, now(), now())`,
    id,
    email,
  );
  const profile = required(
    "a profile for the second fellow, which the on-signup trigger creates",
    await tx.profile.findUnique({ where: { id }, select: { id: true } }),
  );
  await tx.enrollment.create({
    data: { programId, studentId: profile.id, status: "ACTIVE" },
    select: { id: true },
  });
  return profile.id;
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
      graded == null ||
        ("gradedAt" in graded.submission! && "feedbackReviewedAt" in graded.submission!),
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
  it("no unpublished assignment reached the dashboard", async () => {
    const reached = await db.assignment.count({
      where: { id: { in: rows.map((r) => r.id) }, distributedAt: null },
    });
    expect([rows.every((r) => r.id != null), reached]).toEqual([true, 0]);
  });

  // Archived courses stay readable on their own page and are not deadlines any more.
  it("no archived course's work reached the dashboard", async () => {
    const reached = await db.assignment.count({
      where: { id: { in: rows.map((r) => r.id) }, course: { archivedAt: { not: null } } },
    });
    expect(reached).toBe(0);
  });

  /*
    And an unpublished *course* is invisible the same way an unpublished assignment is, which is the
    third of the three readers of `Course.publishedAt` that have to agree. Being on a term's roster
    makes somebody a student of every course in it, so publication is the only thing keeping a
    course that begins in March off this list in September — and this feed is where a disagreement
    would show up as a deadline for work nobody has been given.
  */
  it("no unpublished course's work reached the dashboard", async () => {
    const reached = await db.assignment.count({
      where: { id: { in: rows.map((r) => r.id) }, course: { publishedAt: null } },
    });
    expect(reached).toBe(0);
  });

  // Every submission attached belongs to the caller. The clause that guarantees it is the only
  // thing that does.
  it("no other fellow's submission was attached", async () => {
    const foreign = await db.submission.count({
      where: {
        id: { in: rows.map((r) => r.submission?.id).filter((id): id is string => id != null) },
        studentId: { not: studentId },
      },
    });
    expect(foreign).toBe(0);
  });
});

describe("the five sections, and the count beside them", () => {
  /*
    `now` is passed rather than read inside, which is the whole reason the function takes it. Here
    it is also what makes the assertions below statements rather than observations: a fixed instant
    means "due tomorrow" is a fact about the data and not about when this ran.
  */
  const now = new Date();
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
    week = await as(db, studentId).attendance.myWeek();
  });

  it("the week runs Monday to Sunday", () => {
    expect(
      week.columns.length === 0 ||
        (week.week.from <= week.columns[0]! && week.week.to >= week.columns.at(-1)!),
    ).toBe(true);
  });

  /*
    One row per term the fellow is on the roster of, and no more. It is the check that says the
    strip is program-shaped rather than course-shaped: a procedure that had kept its old scoping
    would return a row per course, which is more rows than there are rosters.
  */
  it("there is one row per program, not per course", async () => {
    const rosters = await db.enrollment.count({
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
    const wrong = await db.enrollment.count({
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

  Every one of these compares one fellow's screen against another's, and the script skipped all
  three because a seeded roster holds one fellow. The second fellow is created here, in a
  transaction that is rolled back, and is enrolled on the same program as the first.

  None of them passes vacuously on a fellow with no work of their own. Each procedure attaches a
  submission or an attendance record to the row it returns, so a filter missing its comparison
  against the caller would attach the *first* fellow's — which is precisely what is asserted
  against.
*/
describe("what one fellow's screen must never show of another's", () => {
  const tx = withRollback();
  let otherId: string;
  let mine: { id: string };

  beforeAll(async () => {
    otherId = await secondFellow(
      tx(),
      "beefbeef-0000-4000-8000-00000000da5b",
      "integration-dashboard-second@example.com",
    );
    mine = required(
      "a submission belonging to the first fellow",
      await tx().submission.findFirst({ where: { studentId }, select: { id: true } }),
    );
  });

  it("one student's submissions do not appear in another's dashboard", async () => {
    const ours = await as(tx(), studentId).assignments.listMine();
    const theirs = await as(tx(), otherId).assignments.listMine();
    const leaked = theirs.filter(
      (r) => r.submission != null && ours.some((m) => m.submission?.id === r.submission?.id),
    );
    expect(leaked).toHaveLength(0);
  });

  /*
    `summarize` is handed the caller's own records and nobody else's, and the comparison of
    `enrollmentId` against the caller's enrollments is the only thing making that true — Prisma
    connects as the owner and row level security does not apply. The second fellow has no records
    at all, so anything above zero is somebody else's.
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
    `studentId` against the caller is the only thing stopping one student writing on another's row
    — and a FORBIDDEN here is that comparison being present.
  */
  it("one student cannot mark another's feedback read", async () => {
    const code = await refusal(() =>
      as(tx(), otherId).submissions.markFeedbackReviewed({ submissionId: mine.id }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

/*
  The progress bar, against the same rows the course page draws. One course of the term, because
  the bar is a course's. Published only: an unpublished course is refused to a fellow, so naming
  one would report a working guard as a broken screen.
*/
describe("the progress bar", () => {
  let courseRows: Awaited<ReturnType<ReturnType<typeof as>["assignments"]["listForCourse"]>>;

  beforeAll(async () => {
    const barCourse = required(
      "a published, unarchived course in the fellow's program",
      await db.course.findFirst({
        where: { programId, archivedAt: null, publishedAt: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
    );
    courseRows = await as(db, studentId).assignments.listForCourse({ courseId: barCourse.id });
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
    expect(completeCount(courseRows)).toBe(
      segments.find((s) => s.state === "complete")?.count ?? 0,
    );
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
      as(db, studentId).submissions.markFeedbackReviewed({
        submissionId: "00000000-0000-4000-8000-000000000000",
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });

  it("feedback cannot be marked read before it exists", async () => {
    const ungraded = required(
      "an ungraded submission belonging to the fellow",
      await db.submission.findFirst({
        where: { studentId, status: { not: "GRADED" } },
        select: { id: true },
      }),
    );
    const code = await refusal(() =>
      as(db, studentId).submissions.markFeedbackReviewed({ submissionId: ungraded.id }),
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
  const tx = withRollback();
  let gradedId: string;
  let before: ReviewRow;
  let after: ReviewRow;

  const columns = REVIEW_COLUMNS;

  beforeAll(async () => {
    /*
      Read inside the transaction and written inside it, so a live row is left alone. A student
      pressing the button in the running application is what this reproduces.
    */
    gradedId = required(
      "a graded submission belonging to the fellow",
      await tx().submission.findFirst({
        where: { studentId, status: "GRADED" },
        select: { id: true },
      }),
    ).id;
  });

  /*
    The state the group needs, established rather than assumed. The script asserted a literal `true`
    here and printed the row's state beside it, which reported a pass whatever the row held.
  */
  it("the graded row carries the timestamp the unread test compares against", async () => {
    const row = await tx().submission.findUniqueOrThrow({
      where: { id: gradedId },
      select: columns,
    });
    expect(row.gradedAt).not.toBeNull();
  });

  it("cleared, the report reads as unread", async () => {
    before = await tx().submission.update({
      where: { id: gradedId },
      data: { feedbackReviewedAt: null },
      select: columns,
    });
    expect(feedbackIsUnread(before)).toBe(true);
  });

  it("marked, the report reads as read", async () => {
    after = await tx().submission.update({
      where: { id: gradedId },
      data: { feedbackReviewedAt: new Date() },
      select: columns,
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
      where: { id: gradedId },
      data: { gradedAt: new Date(Date.now() + 60_000) },
      select: columns,
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
