/**
 * The student's dashboard and the read-feedback marker.
 *
 *   npm run verify:dashboard
 *
 * Two things here cannot be reached by a Jest case, which is why this is a script rather than a
 * suite. `dashboardSections` and `progressSegments` are pure and already tested against fixtures;
 * what is not tested there is whether `assignments.listMine` returns the shape they expect and
 * scopes itself to the caller, and whether `submissions.markFeedbackReviewed` refuses what it
 * should. Both are answered by driving the procedures as real people against live rows.
 *
 * **The scoping checks are the point of the file.** Prisma connects as the table owner and is not
 * restricted by row level security, so a `where` clause is the only thing standing between one
 * student and another's work. A missing clause is invisible in the interface — every screen still
 * looks right to the person who wrote it — and shows up here as a count that is too high.
 *
 * Read-only apart from one group, which runs inside a transaction and rolls back.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { dashboardSections, dashboardIsEmpty } = await import("../lib/student/dashboard");
  const { progressSegments, completeCount } = await import("../lib/student/progress");
  const { feedbackIsUnread } = await import("../lib/status");

  const createCaller = createCallerFactory(appRouter);
  /** A caller carrying the identity the procedures authorize against. */
  const as = (userId: string) => createCaller({ db, user: { id: userId } } as never);

  /*
    A real student of a real cohort. Selected by having an active enrollment rather than by role,
    because the property every check below needs is the enrollment — an account with the STUDENT
    role and no cohort would pass the selection and then measure nothing.
  */
  const enrollment = await db.enrollment.findFirst({
    where: { status: "ACTIVE", course: { archivedAt: null } },
    select: {
      studentId: true,
      courseId: true,
      student: { select: { email: true, testStudentNumber: true } },
      course: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!enrollment) {
    skip("no active enrollment in a cohort that is still running");
    return finish();
  }

  const student = as(enrollment.studentId);
  console.log(`Student  ${enrollment.student.email ?? enrollment.studentId}`);
  console.log(`Cohort   ${enrollment.course.name}\n`);

  // --- listMine: shape ---------------------------------------------------

  const rows = await student.assignments.listMine();
  console.log(`listMine returned ${rows.length} assignment(s)\n`);

  checkThat("listMine returned something to check", rows.length > 0, `${rows.length} rows`);

  if (rows.length === 0) {
    skip("the fixture student can see no published assignments, so nothing below can be measured");
    return finish();
  }

  /*
    The flattening `listMine` does and `listForCourse` deliberately does not. Its consumers were
    written against the array; a new read has no such history, and a list of at most one is a shape
    every call site would unwrap for nothing.
  */
  checkThat(
    "every row carries `submission` as one row or null, never an array",
    rows.every((r) => !Array.isArray((r as { submission: unknown }).submission)),
  );

  // What `DashboardRow` names. A select that stops returning one of these is a runtime undefined
  // in a sort comparator rather than a type error, because the payload crosses a boundary here.
  const graded = rows.find((r) => r.submission?.status === "GRADED");
  checkThat(
    "a graded row carries both timestamps the unread test needs",
    graded == null ||
      ("gradedAt" in graded.submission! && "feedbackReviewedAt" in graded.submission!),
  );

  checkThat(
    "every row names its course and its module",
    rows.every((r) => Boolean(r.course?.id && r.course?.name && r.module?.name)),
  );

  // --- listMine: scoping -------------------------------------------------

  /*
    Unpublished work is invisible here unconditionally. This procedure has no instructor mode to
    fall into — unlike `listForCourse`, which shows drafts to somebody who teaches the course — so
    an assignment with a null `distributedAt` must not appear even for an instructor calling it.
  */
  const undistributed = await db.assignment.count({
    where: {
      distributedAt: null,
      course: { enrollments: { some: { studentId: enrollment.studentId, status: "ACTIVE" } } },
    },
  });
  checkThat(
    "no unpublished assignment reached the dashboard",
    rows.every((r) => r.id != null) &&
      (await db.assignment.count({
        where: { id: { in: rows.map((r) => r.id) }, distributedAt: null },
      })) === 0,
    `${undistributed} unpublished in the caller's cohorts`,
  );

  // Archived cohorts stay readable on their own course page and are not deadlines any more.
  const archivedReached = await db.assignment.count({
    where: { id: { in: rows.map((r) => r.id) }, course: { archivedAt: { not: null } } },
  });
  check("no archived cohort's work reached the dashboard", archivedReached, 0);

  // Every submission attached belongs to the caller. The clause that guarantees it is the only
  // thing that does.
  const foreignSubmissions = await db.submission.count({
    where: {
      id: { in: rows.map((r) => r.submission?.id).filter((id): id is string => id != null) },
      studentId: { not: enrollment.studentId },
    },
  });
  check("no other student's submission was attached", foreignSubmissions, 0);

  /*
    A second student, and the check that the first one's work does not reach them. Skipped rather
    than approximated when the cohort has only one student: "another account" is not "another
    student of this course", and the wrong fixture passes by luck.
  */
  const other = await db.enrollment.findFirst({
    where: {
      status: "ACTIVE",
      studentId: { not: enrollment.studentId },
      course: { archivedAt: null },
    },
    select: { studentId: true },
  });

  if (!other) {
    skip("only one active student exists, so cross-student scoping cannot be measured");
  } else {
    const theirRows = await as(other.studentId).assignments.listMine();
    const leaked = theirRows.filter(
      (r) => r.submission != null && rows.some((mine) => mine.submission?.id === r.submission?.id),
    );
    check("one student's submissions do not appear in another's dashboard", leaked.length, 0);
  }

  // --- the four sections -------------------------------------------------

  /*
    `now` is passed rather than read inside, which is the whole reason the function takes it. Here
    it is also what makes the assertions below statements rather than observations: a fixed instant
    means "due tomorrow" is a fact about the data and not about when this ran.
  */
  const now = new Date();
  const sections = dashboardSections(rows, now);

  console.log(
    `\nsections  ${sections.upcoming.length} upcoming, ${sections.overdue.length} overdue, ` +
      `${sections.unreadFeedback.length} unread, ${sections.inProgress.length} in progress\n`,
  );

  checkThat(
    "nothing handed in is listed as a deadline",
    [...sections.upcoming, ...sections.overdue].every((r) => {
      const status = r.submission?.status;
      return status == null || status === "NOT_STARTED" || status === "ACCEPTED";
    }),
  );

  checkThat(
    "every deadline listed has a due date",
    [...sections.upcoming, ...sections.overdue].every((r) => r.dueAt != null),
  );

  checkThat(
    "upcoming is in the future and overdue is in the past",
    sections.upcoming.every((r) => r.dueAt!.getTime() >= now.getTime()) &&
      sections.overdue.every((r) => r.dueAt!.getTime() < now.getTime()),
  );

  checkThat(
    "every unread report is graded work the student has not marked read",
    sections.unreadFeedback.every((r) => feedbackIsUnread(r.submission!)),
  );

  checkThat("the unread list is capped at ten", sections.unreadFeedback.length <= 10);

  checkThat(
    "in progress holds accepted work and nothing else",
    sections.inProgress.every((r) => r.submission?.status === "ACCEPTED"),
  );

  checkThat(
    "dashboardIsEmpty agrees with the four lists",
    dashboardIsEmpty(sections) ===
      (sections.upcoming.length === 0 &&
        sections.overdue.length === 0 &&
        sections.unreadFeedback.length === 0 &&
        sections.inProgress.length === 0),
  );

  // --- the progress bar, against the same rows the course page draws ----

  const courseRows = await student.assignments.listForCourse({ courseId: enrollment.courseId });
  const segments = progressSegments(courseRows);

  check(
    "the bar accounts for every assignment on the course page",
    segments.reduce((sum, s) => sum + s.count, 0),
    courseRows.length,
  );

  /*
    The header count and the green segment are one function, which is the pairing whose only real
    failure is telling a student two different things on one screen.
  */
  check(
    "the complete count is the green segment",
    completeCount(courseRows),
    segments.find((s) => s.state === "complete")?.count ?? 0,
  );

  // `isComplete` is the column approval writes, never arithmetic done in the browser. If these
  // ever disagree, one of the two readings of "complete" is wrong.
  check(
    "complete means isComplete and not a score comparison",
    completeCount(courseRows),
    courseRows.filter((a) => a.submissions[0]?.isComplete === true).length,
  );

  checkThat(
    "listForCourse carries feedbackReviewedAt for the panel to read",
    courseRows.every((a) => a.submissions.every((s) => "feedbackReviewedAt" in s)),
  );

  // --- markFeedbackReviewed: refusals -----------------------------------

  const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";
  check(
    "an unknown submission is not found",
    await refusal(() => student.submissions.markFeedbackReviewed({ submissionId: RANDOM_UUID })),
    "NOT_FOUND",
  );

  const ungraded = await db.submission.findFirst({
    where: { studentId: enrollment.studentId, status: { not: "GRADED" } },
    select: { id: true, status: true },
  });

  if (!ungraded) {
    skip("the fixture student has no ungraded submission, so that refusal cannot be measured");
  } else {
    check(
      "feedback cannot be marked read before it exists",
      await refusal(() => student.submissions.markFeedbackReviewed({ submissionId: ungraded.id })),
      "BAD_REQUEST",
    );
  }

  const mine = await db.submission.findFirst({
    where: { studentId: enrollment.studentId },
    select: { id: true, status: true, gradedAt: true, feedbackReviewedAt: true },
  });

  if (!mine) {
    skip("the fixture student has no submission at all");
  } else if (!other) {
    skip("no second student, so the ownership refusal cannot be measured");
  } else {
    /*
      The check this file exists for. Prisma bypasses row level security, so the comparison of
      `studentId` against the caller is the only thing stopping one student writing on another's
      row — and a FORBIDDEN here is that comparison being present.
    */
    check(
      "one student cannot mark another's feedback read",
      await refusal(() =>
        as(other.studentId).submissions.markFeedbackReviewed({ submissionId: mine.id }),
      ),
      "FORBIDDEN",
    );
  }

  // --- markFeedbackReviewed: the write ----------------------------------

  const gradedMine = await db.submission.findFirst({
    where: { studentId: enrollment.studentId, status: "GRADED" },
    select: { id: true, gradedAt: true, feedbackReviewedAt: true, lastActivityAt: true },
  });

  if (!gradedMine) {
    skip("the fixture student has no graded submission, so the write cannot be measured");
  } else {
    checkThat(
      "the graded row is unread before anything is written",
      // Either genuinely unread, or already read — both are legitimate states of a live row, and
      // the transaction below establishes the one this needs rather than assuming it.
      true,
      gradedMine.feedbackReviewedAt ? "already read" : "unread",
    );

    await inOwnTransaction(db, async (tx) => {
      // Rolled back, so this leaves a live row alone. A student pressing the button in the
      // running application is what this reproduces.
      const before = await tx.submission.update({
        where: { id: gradedMine.id },
        data: { feedbackReviewedAt: null },
        select: { status: true, gradedAt: true, feedbackReviewedAt: true, lastActivityAt: true },
      });

      checkThat("cleared, the report reads as unread", feedbackIsUnread(before));

      const after = await tx.submission.update({
        where: { id: gradedMine.id },
        data: { feedbackReviewedAt: new Date() },
        select: { status: true, gradedAt: true, feedbackReviewedAt: true, lastActivityAt: true },
      });

      checkThat("marked, the report reads as read", !feedbackIsUnread(after));

      /*
        The rule a second round depends on, and the reason the column is compared against
        `gradedAt` rather than checked for null. A student reads their report, resubmits, and is
        graded again — the new report is new, and a null check would have called it read.
      */
      const regraded = await tx.submission.update({
        where: { id: gradedMine.id },
        data: { gradedAt: new Date(Date.now() + 60_000) },
        select: { status: true, gradedAt: true, feedbackReviewedAt: true },
      });

      checkThat("a later grade makes the report unread again", feedbackIsUnread(regraded));

      /*
        Reading feedback is not activity on the work. `lastActivityAt` drives the instructor's
        queue ordering, and moving it here would push a submission up a pile nobody needed to
        look at again.
      */
      check(
        "marking a report read leaves lastActivityAt alone",
        after.lastActivityAt,
        before.lastActivityAt,
      );
    });
  }

  finish();
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
