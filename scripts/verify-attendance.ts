/**
 * Taking attendance: starting a session, checking into it, correcting it, and ending it.
 *
 * Run with `npm run verify:attendance`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. What makes this a
 * script rather than a suite is that most of what these procedures *are* is authorization and
 * database constraints — a unique index deciding a race, a composite foreign key refusing another
 * cohort's student, a rate limit counting rows in the audit log. None of that can be asked of a
 * fixture, and Prisma is not restricted by row level security from ignoring any of it.
 *
 * **Every check is written in pairs.** Allowed and refused at the same call, because a one-sided
 * check passes against a guard that refuses everybody — and the counting checks assert the record
 * count *and* the audit count, because a broken implementation passes either one alone.
 *
 * **The code is derived directly here**, with `codeForSlot`, rather than read back from a
 * procedure. That is the only way to ask the question that matters about the grace window: the
 * previous slot's code is accepted and the one before it is not.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/** Walks a payload looking for a key at any depth. Used to prove the secret never leaves. */
function containsKey(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  return Object.entries(value as Record<string, unknown>).some(
    ([name, nested]) => name === key || containsKey(nested, key),
  );
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { codeForSlot, CODE_DIGITS } = await import("../lib/attendance/code");
  const { DEFAULT_SESSION_MINUTES } = await import("../lib/attendance/window");
  const { schoolDayOf, dateColumnFor } = await import("../lib/school-time");
  const { ownerOf } = await import("../lib/courses/ownership");

  /*
    A course with at least two active students, because half the checks below are about one fellow
    being unaffected by what another does. One would let "the record count did not change" pass
    for the wrong reason.
  */
  const course = await db.course.findFirst({
    where: { archivedAt: null, enrollments: { some: { status: "ACTIVE" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, attendanceLateAfterMinutes: true },
  });

  const instructor = course
    ? ownerOf(
        await db.courseInstructor.findMany({
          where: { courseId: course.id },
          select: { userId: true, isPrimary: true, createdAt: true },
        }),
      )
    : null;

  const enrollments = course
    ? await db.enrollment.findMany({
        where: { courseId: course.id, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { id: true, studentId: true },
      })
    : [];

  /*
    An instructor who does not teach this course, chosen by the property rather than by a proxy.
    "Some other instructor" is not "an instructor who does not teach this one" — see the note at
    the top of the harness about how that passes by luck.
  */
  const outsider = course
    ? await db.profile.findFirst({
        where: {
          role: { in: ["INSTRUCTOR"] },
          instructorOf: { none: { courseId: course.id } },
        },
        select: { id: true },
      })
    : null;

  if (!course || !instructor || enrollments.length < 2) {
    skip("needs a seeded course with an instructor and at least two active students");
    return finish();
  }

  const [first, second] = enrollments;
  const createCaller = createCallerFactory(appRouter);
  const today = schoolDayOf(new Date());

  try {
    await db.$transaction(
      async (tx) => {
        const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        const asStudent = createCaller({ db: tx, user: { id: first.studentId } } as never);
        const asOther = createCaller({ db: tx, user: { id: second.studentId } } as never);
        const asOutsider = outsider
          ? createCaller({ db: tx, user: { id: outsider.id } } as never)
          : null;

        /*
          Any session already recorded for today is removed first, so the script starts from the
          same state whether or not somebody has taken attendance in the running application. Inside
          the transaction, so it is undone with everything else.
        */
        await tx.attendanceSession.deleteMany({
          where: { courseId: course.id, date: dateColumnFor(today) },
        });

        // ---- Starting a session -------------------------------------------------

        const started = await asInstructor.attendance.start({ courseId: course.id });
        check("an instructor starts today's session", started.started, true);
        check("it is dated today", started.day, today);
        check("it is open", started.state, "open");
        check(
          "it copied the course's on-time window",
          started.lateAfterMinutes,
          course.attendanceLateAfterMinutes,
        );

        /*
          The same call again. Asserting the *id* rather than only the flag is the point: a
          procedure that created a second row and reported `started: false` would pass on the flag
          alone, and the room would then be reading one code while the server accepted another.
        */
        const again = await asInstructor.attendance.start({ courseId: course.id });
        check("starting it again does not start a second one", again.started, false);
        check("and hands back the session that exists", again.id, started.id);

        check(
          "a student cannot start a session",
          await refusal(() => asStudent.attendance.start({ courseId: course.id })),
          "FORBIDDEN",
        );
        if (asOutsider) {
          check(
            "an instructor who does not teach this course cannot start one",
            await refusal(() => asOutsider.attendance.start({ courseId: course.id })),
            "FORBIDDEN",
          );
        } else {
          skip("no instructor exists who does not teach the fixture course");
        }

        check(
          "a session cannot be started for a day in the future",
          await refusal(() =>
            asInstructor.attendance.start({ courseId: course.id, day: "2099-01-01" }),
          ),
          "BAD_REQUEST",
        );

        // ---- The secret never leaves ---------------------------------------------
        //
        // The `joinToken` precedent from `courses.roster`, and sharper: this one lets somebody
        // mark themselves present from bed. A check rather than a convention, because the failure
        // is silent and total.

        const todayForStudent = await asStudent.attendance.today();
        checkThat(
          "the fellow's own view carries no code secret",
          !containsKey(todayForStudent, "codeSecret"),
        );

        const session = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: started.id },
          select: { id: true, codeSecret: true, startedAt: true },
        });

        check(
          "a student cannot read the current code",
          await refusal(() => asStudent.attendance.currentCode({ sessionId: session.id })),
          "FORBIDDEN",
        );

        const codeView = await asInstructor.attendance.currentCode({ sessionId: session.id });
        checkThat(
          "the instructor's code view carries no secret either",
          !containsKey(codeView, "codeSecret"),
        );
        check("the code is four digits", codeView.code?.length ?? 0, CODE_DIGITS);

        // ---- Checking in ---------------------------------------------------------

        /*
          The session is backdated by two slots before any code is derived.

          Otherwise the grace-window check depends on when in the minute the script happened to
          run: started in the current slot, there is no previous slot to try, and the group would
          skip — every time on a fast machine. A check whose coverage varies with the clock is one
          that eventually stops covering anything.
        */
        const backdated = await tx.attendanceSession.update({
          where: { id: started.id },
          data: { startedAt: new Date(Date.now() - 75_000) },
          select: { startedAt: true },
        });

        const now = new Date();
        const slot = Math.floor((now.getTime() - backdated.startedAt.getTime()) / 30_000);
        const rightNow = codeForSlot(session.codeSecret, session.id, slot);
        const previous = codeForSlot(session.codeSecret, session.id, Math.max(0, slot - 1));
        const older = codeForSlot(session.codeSecret, session.id, Math.max(0, slot - 2));
        const wrong = String((Number(rightNow) + 5000) % 10_000).padStart(CODE_DIGITS, "0");

        check(
          "a wrong code is refused",
          await refusal(() => asStudent.attendance.checkIn({ courseId: course.id, code: wrong })),
          "UNAUTHORIZED",
        );

        check(
          "a code from two slots ago is refused",
          await refusal(() => asStudent.attendance.checkIn({ courseId: course.id, code: older })),
          "UNAUTHORIZED",
        );

        const grace = await asOther.attendance.checkIn({ courseId: course.id, code: previous });
        check("the previous slot's code is accepted", grace.alreadyCheckedIn, false);

        const checkedIn = await asStudent.attendance.checkIn({
          courseId: course.id,
          code: rightNow,
        });
        check("the current code is accepted", checkedIn.alreadyCheckedIn, false);
        check("and lands as present", checkedIn.status, "PRESENT");

        /*
          A second attempt. All three assertions, because any one of them passes on its own against
          a broken implementation: the flag could be right while a row was written, or the row
          count right while a second audit event was recorded.
        */
        const recordsBefore = await tx.attendanceRecord.count({ where: { sessionId: session.id } });
        const eventsBefore = await tx.auditEvent.count({
          where: { action: "ATTENDANCE_CHECKED_IN", subjectId: first.studentId },
        });

        const twice = await asStudent.attendance.checkIn({ courseId: course.id, code: rightNow });
        check("checking in twice returns the record that exists", twice.alreadyCheckedIn, true);
        check(
          "and writes no second record",
          await tx.attendanceRecord.count({ where: { sessionId: session.id } }),
          recordsBefore,
        );
        check(
          "and writes no second audit event",
          await tx.auditEvent.count({
            where: { action: "ATTENDANCE_CHECKED_IN", subjectId: first.studentId },
          }),
          eventsBefore,
        );

        check(
          "an instructor of the course cannot check in as a student of it",
          await refusal(() =>
            asInstructor.attendance.checkIn({ courseId: course.id, code: rightNow }),
          ),
          "FORBIDDEN",
        );

        // ---- A removed fellow -----------------------------------------------------

        await asInstructor.enrollments.remove({ enrollmentId: second.id });
        const removedRefusal = await refusal(() =>
          asOther.attendance.checkIn({ courseId: course.id, code: rightNow }),
        );
        check("a removed fellow cannot check in", removedRefusal, "FORBIDDEN");
        // They keep reading their own record, for the same reason they keep their feedback.
        const removedHistory = await asOther.attendance.myHistory({ courseId: course.id });
        checkThat(
          "a removed fellow still reads their own attendance",
          removedHistory.days.length > 0,
        );
        await asInstructor.enrollments.restore({ enrollmentId: second.id });

        // ---- The grid shows everybody ----------------------------------------------

        const grid = await asInstructor.attendance.grid({ courseId: course.id });
        const activeCount = await tx.enrollment.count({
          where: { courseId: course.id, status: "ACTIVE" },
        });
        check("the grid has a row per active enrollment", grid.rows.length, activeCount);
        checkThat(
          "including fellows who have not checked in",
          grid.rows.some((row) => row.record === null),
        );

        // ---- Correcting, and what a correction survives -----------------------------

        const marked = await asInstructor.attendance.setStatus({
          sessionId: session.id,
          enrollmentId: second.id,
          status: "EXCUSED",
          note: "Hospital appointment",
        });
        check("an instructor sets a status by hand", marked.status, "EXCUSED");
        check("and it is recorded as theirs", marked.source, "INSTRUCTOR");

        const setEvent = await tx.auditEvent.findFirst({
          where: { action: "ATTENDANCE_STATUS_SET", subjectId: second.studentId },
          orderBy: { occurredAt: "desc" },
          select: { detail: true },
        });
        check(
          "the audit event carries what the status was before",
          (setEvent?.detail as { to?: string } | null)?.to,
          "EXCUSED",
        );

        /*
          A self check-in never overwrites an instructor's decision. This is the reason `checkIn`
          tests for an existing record before it looks at the code at all.
        */
        const overwritten = await asOther.attendance.checkIn({
          courseId: course.id,
          code: rightNow,
        });
        check("a fellow's code does not overwrite an excusal", overwritten.status, "EXCUSED");

        check(
          "a student cannot set anybody's status",
          await refusal(() =>
            asStudent.attendance.setStatus({
              sessionId: session.id,
              enrollmentId: first.id,
              status: "PRESENT",
            }),
          ),
          "FORBIDDEN",
        );

        // ---- Editing the window recomputes one kind of row and not the other --------

        // Backwards, so the check-in that was on time is now well past the threshold.
        const shifted = await asInstructor.attendance.updateSession({
          sessionId: session.id,
          startedAt: new Date(now.getTime() - 60 * 60 * 1000),
          lateAfterMinutes: 1,
        });
        checkThat("moving the window recomputes self check-ins", shifted.recomputed >= 1);

        const afterShift = await tx.attendanceRecord.findUniqueOrThrow({
          where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: first.id } },
          select: { status: true },
        });
        check("the self check-in is now late", afterShift.status, "LATE");

        const excusedAfterShift = await tx.attendanceRecord.findUniqueOrThrow({
          where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: second.id } },
          select: { status: true },
        });
        // The check most likely to catch a real regression: an instructor's decision about a
        // person must not be reverted by a threshold moving.
        check("the instructor's excusal survives untouched", excusedAfterShift.status, "EXCUSED");

        // ---- The backstop, and extending past it -------------------------------------

        await tx.attendanceSession.update({
          where: { id: session.id },
          data: {
            startedAt: new Date(now.getTime() - (DEFAULT_SESSION_MINUTES + 1) * 60 * 1000),
            endsAt: new Date(now.getTime() - 60 * 1000),
          },
          select: { id: true },
        });

        const lapsed = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: session.id },
          select: { codeSecret: true, startedAt: true },
        });
        const lapsedSlot = Math.floor((Date.now() - lapsed.startedAt.getTime()) / 30_000);
        const lapsedCode = codeForSlot(lapsed.codeSecret, session.id, lapsedSlot);

        const lapsedView = await asInstructor.attendance.currentCode({ sessionId: session.id });
        check("a lapsed session shows no code", lapsedView.code, null);

        // A third fellow would be needed to check the refusal without a record in the way, so
        // this asks the one whose record was cleared below instead.
        await tx.attendanceRecord.deleteMany({
          where: { sessionId: session.id, enrollmentId: first.id },
        });
        check(
          "a lapsed session refuses a check-in",
          await refusal(() =>
            asStudent.attendance.checkIn({ courseId: course.id, code: lapsedCode }),
          ),
          "PRECONDITION_FAILED",
        );

        const extended = await asInstructor.attendance.extend({ sessionId: session.id });
        check("extending reopens it", extended.state, "open");

        const afterExtend = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: session.id },
          select: { codeSecret: true, startedAt: true },
        });
        const liveSlot = Math.floor((Date.now() - afterExtend.startedAt.getTime()) / 30_000);
        const liveCode = codeForSlot(afterExtend.codeSecret, session.id, liveSlot);
        const afterExtendCheckIn = await asStudent.attendance.checkIn({
          courseId: course.id,
          code: liveCode,
        });
        check("and a code works again", afterExtendCheckIn.alreadyCheckedIn, false);

        // ---- Rotating -----------------------------------------------------------------

        await asInstructor.attendance.rotateCode({ sessionId: session.id });
        const rotated = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: session.id },
          select: { codeSecret: true },
        });
        checkThat("rotating replaces the secret", rotated.codeSecret !== afterExtend.codeSecret);

        // ---- Ending, and what ending writes ---------------------------------------------

        const ended = await asInstructor.attendance.endSession({ sessionId: session.id });
        check("ending it reports how many were marked absent", typeof ended.absent, "number");
        check("and the session reads as ended", ended.session.state, "ended");

        const withoutRecord = await tx.enrollment.count({
          where: {
            courseId: course.id,
            status: "ACTIVE",
            attendance: { none: { sessionId: session.id } },
          },
        });
        check("every active enrollment now has a record", withoutRecord, 0);

        const finalized = await tx.attendanceRecord.findMany({
          where: { sessionId: session.id, source: "FINALIZED" },
          select: { status: true },
        });
        checkThat(
          "and every finalized row is an absence",
          finalized.every((row) => row.status === "ABSENT"),
        );

        const recordsAfterEnd = await tx.attendanceRecord.count({
          where: { sessionId: session.id },
        });
        const endedAgain = await asInstructor.attendance.endSession({ sessionId: session.id });
        check("ending it twice is harmless", endedAgain.alreadyEnded, true);
        check(
          "and writes nothing",
          await tx.attendanceRecord.count({ where: { sessionId: session.id } }),
          recordsAfterEnd,
        );

        /*
          The fellow who missed the morning entirely, which is the case worth asking about.

          Their own check-in is cleared first and replaced with the row `endSession` writes for
          somebody nobody recorded. Without that they hold a real check-in, and `checkIn` correctly
          hands it back — so the refusal would never be reached and the check would be measuring
          the wrong branch.

          **A finalized absence must not read as "you are already checked in".** It is the absence
          of a decision rather than one, and telling somebody who missed class that they are
          already marked in is both false and the opposite of what they need to hear.
        */
        await tx.attendanceRecord.deleteMany({
          where: { sessionId: session.id, enrollmentId: first.id },
        });
        await tx.attendanceRecord.create({
          data: {
            sessionId: session.id,
            courseId: course.id,
            enrollmentId: first.id,
            status: "ABSENT",
            source: "FINALIZED",
          },
          select: { id: true },
        });

        check(
          "a fellow holding only a finalized absence is refused rather than told they are in",
          await refusal(() =>
            asStudent.attendance.checkIn({ courseId: course.id, code: liveCode }),
          ),
          "PRECONDITION_FAILED",
        );

        // ---- Reopening keeps the decisions and drops the absences ------------------------

        const selfBefore = await tx.attendanceRecord.count({
          where: { sessionId: session.id, source: "SELF_CHECK_IN" },
        });
        const instructorBefore = await tx.attendanceRecord.count({
          where: { sessionId: session.id, source: "INSTRUCTOR" },
        });

        // Counted fresh rather than reused from the assertion above: the finalized-absence check
        // added one, and a stale expectation here would fail for a reason that is about this
        // script rather than about reopening.
        const finalizedNow = await tx.attendanceRecord.count({
          where: { sessionId: session.id, source: "FINALIZED" },
        });

        const reopened = await asInstructor.attendance.reopen({ sessionId: session.id });
        check("reopening reports the absences it cleared", reopened.absencesRemoved, finalizedNow);
        check(
          "the finalized rows are gone",
          await tx.attendanceRecord.count({
            where: { sessionId: session.id, source: "FINALIZED" },
          }),
          0,
        );
        check(
          "the self check-ins survive",
          await tx.attendanceRecord.count({
            where: { sessionId: session.id, source: "SELF_CHECK_IN" },
          }),
          selfBefore,
        );
        check(
          "the instructor's decisions survive",
          await tx.attendanceRecord.count({
            where: { sessionId: session.id, source: "INSTRUCTOR" },
          }),
          instructorBefore,
        );
        check("and it is open again", reopened.session.state, "open");

        // ---- Deleting ---------------------------------------------------------------------

        /*
          A self check-in has to exist for this to be the check it claims to be. By this point the
          fellows' own rows have been overwritten by an excusal and cleared by the finalized-absence
          check above, so one is put back explicitly — otherwise the delete would be allowed and
          the refusal would go untested while the line still read as a pass.
        */
        await tx.attendanceRecord.create({
          data: {
            sessionId: session.id,
            courseId: course.id,
            enrollmentId: first.id,
            status: "PRESENT",
            source: "SELF_CHECK_IN",
            checkedInAt: new Date(),
          },
          select: { id: true },
        });

        check(
          "a session somebody has checked into cannot be deleted",
          await refusal(() => asInstructor.attendance.deleteSession({ sessionId: session.id })),
          "PRECONDITION_FAILED",
        );

        await tx.attendanceRecord.deleteMany({ where: { sessionId: session.id } });
        const deleted = await asInstructor.attendance.deleteSession({ sessionId: session.id });
        check("a session nobody used can be", deleted.day, today);

        // ---- The course setting ------------------------------------------------------------

        const changed = await asInstructor.courses.setAttendanceLateAfter({
          courseId: course.id,
          minutes: 17,
        });
        check("an instructor sets the on-time window", changed.attendanceLateAfterMinutes, 17);

        const afterSetting = await asInstructor.attendance.start({ courseId: course.id });
        check("a new session copies it", afterSetting.lateAfterMinutes, 17);

        check(
          "a student cannot change it",
          await refusal(() =>
            asStudent.courses.setAttendanceLateAfter({ courseId: course.id, minutes: 3 }),
          ),
          "FORBIDDEN",
        );

        throw new Error("ROLLBACK");
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  /*
    ---- The two rules that live in Postgres rather than in a procedure --------------------

    Its own transaction, because each of these provokes a constraint and a failed statement
    poisons the transaction it happened in.
  */
  await inOwnTransaction(db, async (tx) => {
    const other = await tx.course.findFirst({
      where: { id: { not: course.id }, enrollments: { some: {} } },
      select: { id: true, enrollments: { take: 1, select: { id: true } } },
    });

    const session = await tx.attendanceSession.create({
      data: {
        courseId: course.id,
        date: dateColumnFor("2099-12-31"),
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        lateAfterMinutes: 5,
        codeSecret: "f".repeat(64),
      },
      select: { id: true },
    });

    if (other && other.enrollments.length > 0) {
      /*
        A record naming this course and another cohort's enrollment. The procedure refuses it in
        words; this asks whether the *database* would, because that is the guarantee — a second
        write path added later inherits it, and a check in a procedure does not.
      */
      const crossCourse = await refusal(() =>
        tx.attendanceRecord.create({
          data: {
            sessionId: session.id,
            courseId: course.id,
            enrollmentId: other.enrollments[0].id,
            status: "PRESENT",
            source: "INSTRUCTOR",
          },
        }),
      );
      checkThat(
        "the database refuses a record against another cohort's student",
        crossCourse !== "accepted",
        crossCourse,
      );
    } else {
      skip("needs a second course with an enrollment to check the cross-course constraint");
    }
  });

  await inOwnTransaction(db, async (tx) => {
    const session = await tx.attendanceSession.create({
      data: {
        courseId: course.id,
        date: dateColumnFor("2099-12-30"),
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        lateAfterMinutes: 5,
        codeSecret: "f".repeat(64),
      },
      select: { id: true },
    });

    /*
      A finalized row claiming somebody was present. This is the one claim the table must never be
      able to make: it would be the application asserting attendance on the strength of no code
      typed and no instructor's decision — and it is the claim a stipend is paid against.
    */
    const finalizedPresent = await refusal(() =>
      tx.attendanceRecord.create({
        data: {
          sessionId: session.id,
          courseId: course.id,
          enrollmentId: first.id,
          status: "PRESENT",
          source: "FINALIZED",
        },
      }),
    );
    checkThat(
      "the database refuses a finalized row that claims somebody was present",
      finalizedPresent !== "accepted",
      finalizedPresent,
    );

    const selfWithoutTime = await refusal(() =>
      tx.attendanceRecord.create({
        data: {
          sessionId: session.id,
          courseId: course.id,
          enrollmentId: first.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
        },
      }),
    );
    checkThat(
      "and a self check-in with no time, which could never be recomputed",
      selfWithoutTime !== "accepted",
      selfWithoutTime,
    );
  });

  finish();
  await db.$disconnect();
}

void main();
