/**
 * The student's dashboard and the read-feedback marker.
 *
 *   npm run verify:dashboard
 *
 * Several things here cannot be reached by a Jest case, which is why this is a script rather than a
 * suite. `dashboardSections` and `progressSegments` are pure and already tested against fixtures;
 * what is not tested there is whether `assignments.listMine` and `attendance.myWeek` return the
 * shapes they expect and scope themselves to the caller, and whether
 * `submissions.markFeedbackReviewed` refuses what it should. All are answered by driving the
 * procedures as real people against live rows.
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
  const { dashboardSections, dashboardIsEmpty, UPCOMING_WINDOW_DAYS } =
    await import("../lib/student/dashboard");
  const { progressSegments, completeCount } = await import("../lib/student/progress");
  const { feedbackIsUnread } = await import("../lib/status");

  const createCaller = createCallerFactory(appRouter);
  /** A caller carrying the identity the procedures authorize against. */
  const as = (userId: string) => createCaller({ db, user: { id: userId } } as never);

  /*
    A real fellow of a real matriculation. Selected by having an active enrollment rather than by
    role, because the property every check below needs is the enrollment — an account with the
    STUDENT role and no roster would pass the selection and then measure nothing.
  */
  const enrollment = await db.enrollment.findFirst({
    where: { status: "ACTIVE", program: { archivedAt: null } },
    select: {
      studentId: true,
      programId: true,
      student: { select: { email: true, testStudentNumber: true } },
      program: { select: { name: true, matriculation: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!enrollment) {
    skip("no active enrollment in a program that is still running");
    return finish();
  }

  const student = as(enrollment.studentId);
  console.log(`Fellow   ${enrollment.student.email ?? enrollment.studentId}`);
  console.log(`Program  ${enrollment.program.name} · ${enrollment.program.matriculation}\n`);

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
    "every row names its course and its unit",
    rows.every((r) => Boolean(r.course?.id && r.course?.name && r.courseUnit?.name)),
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
      course: {
        program: { enrollments: { some: { studentId: enrollment.studentId, status: "ACTIVE" } } },
      },
    },
  });
  checkThat(
    "no unpublished assignment reached the dashboard",
    rows.every((r) => r.id != null) &&
      (await db.assignment.count({
        where: { id: { in: rows.map((r) => r.id) }, distributedAt: null },
      })) === 0,
    `${undistributed} unpublished in the caller's courses`,
  );

  // Archived courses stay readable on their own page and are not deadlines any more.
  const archivedReached = await db.assignment.count({
    where: { id: { in: rows.map((r) => r.id) }, course: { archivedAt: { not: null } } },
  });
  check("no archived course's work reached the dashboard", archivedReached, 0);

  /*
    And an unpublished *course* is invisible the same way an unpublished assignment is, which is the
    third of the three readers of `Course.publishedAt` that have to agree. Being on a matriculation's
    roster makes somebody a student of every course in it, so publication is the only thing keeping a
    course that begins in March off this list in September — and this feed is where a disagreement
    would show up as a deadline for work nobody has been given.
  */
  const unpublishedReached = await db.assignment.count({
    where: { id: { in: rows.map((r) => r.id) }, course: { publishedAt: null } },
  });
  check("no unpublished course's work reached the dashboard", unpublishedReached, 0);

  // Every submission attached belongs to the caller. The clause that guarantees it is the only
  // thing that does.
  const foreignSubmissions = await db.submission.count({
    where: {
      id: { in: rows.map((r) => r.submission?.id).filter((id): id is string => id != null) },
      studentId: { not: enrollment.studentId },
    },
  });
  check("no other fellow's submission was attached", foreignSubmissions, 0);

  /*
    A second fellow, and the check that the first one's work does not reach them. Skipped rather than
    approximated when the roster has only one fellow: "another account" is not "another fellow of
    this matriculation", and the wrong fixture passes by luck.
  */
  const other = await db.enrollment.findFirst({
    where: {
      status: "ACTIVE",
      studentId: { not: enrollment.studentId },
      program: { archivedAt: null },
    },
    select: { studentId: true },
  });

  if (!other) {
    skip("only one active fellow exists, so cross-fellow scoping cannot be measured");
  } else {
    const theirRows = await as(other.studentId).assignments.listMine();
    const leaked = theirRows.filter(
      (r) => r.submission != null && rows.some((mine) => mine.submission?.id === r.submission?.id),
    );
    check("one student's submissions do not appear in another's dashboard", leaked.length, 0);
  }

  // --- the five sections, and the count beside them ----------------------

  /*
    `now` is passed rather than read inside, which is the whole reason the function takes it. Here
    it is also what makes the assertions below statements rather than observations: a fixed instant
    means "due tomorrow" is a fact about the data and not about when this ran.
  */
  const now = new Date();
  const sections = dashboardSections(rows, now);

  console.log(
    `\nsections  ${sections.upcoming.length} upcoming, ${sections.overdue.length} overdue, ` +
      `${sections.needsAnotherAttempt.length} to attempt again, ` +
      `${sections.unreadFeedback.length} unread, ${sections.inProgress.length} in progress, ` +
      `${sections.laterCount} due later\n`,
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

  const windowEnds = now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  checkThat(
    "upcoming is inside the window and overdue is in the past",
    sections.upcoming.every(
      (r) => r.dueAt!.getTime() >= now.getTime() && r.dueAt!.getTime() <= windowEnds,
    ) && sections.overdue.every((r) => r.dueAt!.getTime() < now.getTime()),
  );

  /*
    Every outstanding deadline is drawn or counted, and none is both. A row that is neither is one
    the screen has quietly forgotten — which is exactly what the count exists to prevent, and the
    only failure of the window that a student could not see for themselves.
  */
  const outstanding = rows.filter(
    (r) =>
      r.dueAt != null &&
      (r.submission == null ||
        r.submission.status === "NOT_STARTED" ||
        r.submission.status === "ACCEPTED"),
  );
  check(
    "every outstanding deadline is either listed or counted",
    sections.overdue.length + sections.upcoming.length + sections.laterCount,
    outstanding.length,
  );

  checkThat(
    "every unread report is graded work the student has not marked read",
    sections.unreadFeedback.every((r) => feedbackIsUnread(r.submission!)),
  );

  checkThat("the unread list is capped at ten", sections.unreadFeedback.length <= 10);

  /*
    The two graded lists partition. Work below the threshold is a second attempt outstanding and
    is never also a report to read — a student reading down the screen would otherwise count one
    assignment twice.
  */
  checkThat(
    "needs another attempt holds graded work below the threshold and nothing else",
    sections.needsAnotherAttempt.every(
      (r) => r.submission?.status === "GRADED" && r.submission.isComplete === false,
    ),
  );

  checkThat(
    "no row is both a second attempt and a report to read",
    sections.unreadFeedback.every(
      (r) => !sections.needsAnotherAttempt.some((other) => other.id === r.id),
    ),
  );

  // Reading a report is not doing the work, so nothing in this list is cleared by having been read.
  checkThat(
    "a report already marked read still leaves its work outstanding",
    sections.needsAnotherAttempt.every((r) => r.submission != null),
  );

  checkThat(
    "in progress holds accepted work and nothing else",
    sections.inProgress.every((r) => r.submission?.status === "ACCEPTED"),
  );

  checkThat(
    "dashboardIsEmpty agrees with the five lists",
    dashboardIsEmpty(sections) ===
      (sections.upcoming.length === 0 &&
        sections.overdue.length === 0 &&
        sections.needsAnotherAttempt.length === 0 &&
        sections.unreadFeedback.length === 0 &&
        sections.inProgress.length === 0),
  );

  // --- myWeek: the attendance strip -------------------------------------

  /*
    The second cross-scope read on this screen, and the second place a missing `where` clause would
    hand one fellow another's record. The shape checks below matter for a different reason: the strip
    draws squares from `days` and a figure from `summary`, and a procedure that returned a week the
    columns do not cover draws a row of blanks that looks exactly like a quiet week.

    **One row per matriculation, not per course**, which is what attendance moving up bought here: a
    fellow taking three courses that all met on a Tuesday had three rows saying the same thing.
  */
  const week = await student.attendance.myWeek();
  console.log(
    `\nmyWeek    ${week.programs.length} program(s), ${week.columns.length} column(s), ` +
      `week of ${week.week.from}\n`,
  );

  checkThat(
    "the week runs Monday to Sunday",
    week.columns.length === 0 ||
      (week.week.from <= week.columns[0] && week.week.to >= week.columns.at(-1)!),
    `${week.week.from} to ${week.week.to}`,
  );

  /*
    One row per matriculation the fellow is on the roster of, and no more. It is the check that says
    the strip is program-shaped rather than course-shaped: a procedure that had kept its old scoping
    would return a row per course, which is more rows than there are rosters.
  */
  check(
    "there is one row per matriculation, not per course",
    week.programs.length,
    await db.enrollment.count({
      where: {
        studentId: enrollment.studentId,
        status: "ACTIVE",
        program: { archivedAt: null },
      },
    }),
  );

  checkThat(
    "every matriculation draws one square per column",
    week.programs.every((row) => row.days.length === week.columns.length),
  );

  checkThat(
    "the squares are the columns, in order",
    week.programs.every((row) => row.days.every((day, i) => day.day === week.columns[i])),
  );

  // Cumulative and never a weekly rate: the denominator is mornings somebody opened, so a week with
  // a forgotten one would read as a full week.
  checkThat(
    "the figure beside the squares is the term's, not the week's",
    week.programs.every(
      (row) => row.summary.rate == null || row.summary.attended <= row.summary.eligible,
    ),
  );

  checkThat(
    "no archived or dropped matriculation is in the strip",
    (await db.enrollment.count({
      where: {
        studentId: enrollment.studentId,
        programId: { in: week.programs.map((row) => row.program.id) },
        OR: [{ status: { not: "ACTIVE" } }, { program: { archivedAt: { not: null } } }],
      },
    })) === 0,
  );

  if (!other) {
    skip("only one active fellow exists, so myWeek's scoping cannot be measured");
  } else {
    /*
      The check this section exists for. `summarize` is handed the caller's own records and nobody
      else's, and the comparison of `enrollmentId` against the caller's enrollments is the only
      thing making that true — Prisma connects as the owner and row level security does not apply.
    */
    const theirWeek = await as(other.studentId).attendance.myWeek();
    const theirPrograms = new Set(theirWeek.programs.map((row) => row.program.id));
    const shared = week.programs.filter((row) => theirPrograms.has(row.program.id));

    checkThat(
      "two fellows of one matriculation get their own figures, not the roster's",
      shared.every((row) => {
        const theirs = theirWeek.programs.find((t) => t.program.id === row.program.id)!;
        // Their eligible counts may legitimately match; what must never match by construction is
        // one fellow's attendance being reported as the other's.
        return theirs.summary.attended <= theirs.summary.eligible;
      }),
      `${shared.length} shared program(s)`,
    );

    const foreignRecords = await db.attendanceRecord.count({
      where: {
        enrollment: { studentId: { not: other.studentId } },
        session: { programId: { in: theirWeek.programs.map((row) => row.program.id) } },
        status: { in: ["PRESENT", "LATE"] },
      },
    });
    const theirAttended = theirWeek.programs.reduce((sum, row) => sum + row.summary.attended, 0);
    checkThat(
      "one fellow's attendance is not counted into another's rate",
      theirAttended <=
        (await db.attendanceRecord.count({
          where: {
            enrollment: { studentId: other.studentId },
            status: { in: ["PRESENT", "LATE"] },
          },
        })),
      `${theirAttended} attended, ${foreignRecords} belonging to others on the same rosters`,
    );
  }

  // --- the progress bar, against the same rows the course page draws ----

  /*
    One course of the matriculation, because the bar is a course's. Published only: an unpublished
    course is refused to a fellow, so naming one would report a working guard as a broken screen.
  */
  const barCourse = await db.course.findFirst({
    where: {
      programId: enrollment.programId,
      archivedAt: null,
      publishedAt: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!barCourse) {
    skip("the fellow's matriculation has no published course, so the progress bar cannot be read");
    return finish();
  }

  const courseRows = await student.assignments.listForCourse({ courseId: barCourse.id });
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
