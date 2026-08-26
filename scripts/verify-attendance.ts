/**
 * Taking attendance: starting a day, checking into it, correcting it, ending it, and when people
 * arrive.
 *
 * Run with `npm run verify:attendance`.
 *
 * **One morning per program, not one per course**, which is the change this script now checks.
 * A fellow taking three courses that all met on a Tuesday used to have three sessions to check into
 * and three codes to type; there is one session, one code, and one record.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. What makes this a
 * script rather than a suite is that most of what these procedures *are* is authorization and
 * database constraints — a unique index deciding a race, a composite foreign key refusing another
 * program's fellow, a rate limit counting rows in the audit log. None of that can be asked of
 * a fixture, and Prisma is not restricted by row level security from ignoring any of it.
 *
 * **Every check is written in pairs.** Allowed and refused at the same call, because a one-sided
 * check passes against a guard that refuses everybody — and the counting checks assert the record
 * count *and* the audit count, because a broken implementation passes either one alone.
 *
 * **The code is derived directly here**, with `codeFor`, rather than read back from a procedure.
 * That is what lets this ask the question the procedure cannot be trusted to answer about itself:
 * that the code a fellow is refused is genuinely a different code, and that replacing the session
 * secret invalidates the one twenty-five people were already given.
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
  const { codeFor, CODE_DIGITS } = await import("../lib/attendance/code");
  const { DEFAULT_SESSION_MINUTES } = await import("../lib/attendance/window");
  const { schoolDayOf, dateColumnFor } = await import("../lib/school-time");
  const { ownerOf } = await import("../lib/programs/ownership");
  const { arrivalAverages, arrivalSentence, MIN_ARRIVALS } =
    await import("../lib/attendance/arrival");
  const { formatClockMinutes, minutesAfterMidnight, weekdayOf } =
    await import("../lib/school-time");

  /**
   * The instant at which the school clock reads a given time on a given day.
   *
   * Solved for rather than computed from an offset, because the offset is the thing being checked.
   * Four Mondays in March 2026 straddle the change to daylight saving — the second is in EST and the
   * rest are in EDT — so an arrival written at a fixed UTC hour would read as two different times of
   * the morning and the weekday average would be an artefact of the calendar. Sliding the instant
   * until `minutesAfterMidnight` agrees is what makes the fixture say what it means.
   *
   * It throws rather than returning a near miss. A silent wrap onto the previous evening would file
   * the arrival under the wrong weekday, which is precisely the mistake these checks exist to catch.
   */
  function schoolInstant(day: string, hours: number, minutes: number): Date {
    const target = hours * 60 + minutes;
    let at = new Date(new Date(`${day}T00:00:00Z`).getTime() + target * 60_000);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const drift = minutesAfterMidnight(at) - target;
      if (drift === 0) break;
      at = new Date(at.getTime() - drift * 60_000);
    }

    if (minutesAfterMidnight(at) !== target || schoolDayOf(at) !== day) {
      throw new Error(`could not place ${hours}:${minutes} on ${day}`);
    }
    return at;
  }

  /*
    A term with at least two active fellows, because half the checks below are about one
    fellow being unaffected by what another does. One would let "the record count did not change"
    pass for the wrong reason.
  */
  const program = await db.program.findFirst({
    where: { archivedAt: null, enrollments: { some: { status: "ACTIVE" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, attendanceLateAfterMinutes: true },
  });

  const instructor = program
    ? ownerOf(
        await db.programInstructor.findMany({
          where: { programId: program.id },
          select: { userId: true, isPrimary: true, createdAt: true },
        }),
      )
    : null;

  const enrollments = program
    ? await db.enrollment.findMany({
        where: { programId: program.id, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { id: true, studentId: true },
      })
    : [];

  /*
    An instructor who does not instruct this term, chosen by the property rather than by a
    proxy. "Some other instructor" is not "an instructor who does not instruct this one" — see the
    note at the top of the harness about how that passes by luck.
  */
  const outsider = program
    ? await db.profile.findFirst({
        where: {
          role: { in: ["INSTRUCTOR"] },
          programsInstructing: { none: { programId: program.id } },
        },
        select: { id: true },
      })
    : null;

  if (!program || !instructor || enrollments.length < 2) {
    skip("needs a seeded program with an instructor and at least two active fellows");
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
          where: { programId: program.id, date: dateColumnFor(today) },
        });

        // ---- Starting a session -------------------------------------------------

        const started = await asInstructor.attendance.start({ programId: program.id });
        check("an instructor starts today's session", started.started, true);
        check("it is dated today", started.day, today);
        check("it is open", started.state, "open");
        check(
          "it copied the program's on-time window",
          started.lateAfterMinutes,
          program.attendanceLateAfterMinutes,
        );

        /*
          The same call again. Asserting the *id* rather than only the flag is the point: a
          procedure that created a second row and reported `started: false` would pass on the flag
          alone, and the room would then be reading one code while the server accepted another.
        */
        const again = await asInstructor.attendance.start({ programId: program.id });
        check("starting it again does not start a second one", again.started, false);
        check("and hands back the session that exists", again.id, started.id);

        check(
          "a student cannot start a session",
          await refusal(() => asStudent.attendance.start({ programId: program.id })),
          "FORBIDDEN",
        );
        if (asOutsider) {
          check(
            "an instructor who does not instruct this program cannot start one",
            await refusal(() => asOutsider.attendance.start({ programId: program.id })),
            "FORBIDDEN",
          );
        } else {
          skip("no instructor exists who does not instruct the fixture program");
        }

        check(
          "a session cannot be started for a day in the future",
          await refusal(() =>
            asInstructor.attendance.start({ programId: program.id, day: "2099-01-01" }),
          ),
          "BAD_REQUEST",
        );

        // ---- The secret never leaves ---------------------------------------------
        //
        // The `joinToken` precedent from `programs.roster`, and sharper: this one lets somebody
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
          "a student cannot read the session code",
          await refusal(() => asStudent.attendance.sessionCode({ sessionId: session.id })),
          "FORBIDDEN",
        );

        const codeView = await asInstructor.attendance.sessionCode({ sessionId: session.id });
        checkThat(
          "the instructor's code view carries no secret either",
          !containsKey(codeView, "codeSecret"),
        );
        check("the code is four digits", codeView.code?.length ?? 0, CODE_DIGITS);

        // ---- Checking in ---------------------------------------------------------

        const rightNow = codeFor(session);
        const wrong = String((Number(rightNow) + 5000) % 10_000).padStart(CODE_DIGITS, "0");

        check("the procedure and this script derive the same code", codeView.code, rightNow);

        /*
          The session's start time is moved, the code is asked for again, and the start time is then
          put back.

          This is the property that made a fixed code worth having, and it is the one a reader is
          most likely to doubt: the code is a fact about which session this is, not about how long it
          has been running, so an instructor correcting a session that began five minutes late does
          not change the digits twenty-five people have already been given.

          **Restored immediately, because everything below depends on it.** Left backdated, the
          check-in two lines down lands outside the on-time window and reads LATE, and the recompute
          check further on then has nothing to change — two failures whose cause is this block rather
          than the behaviour either one is about.
        */
        await tx.attendanceSession.update({
          where: { id: started.id },
          data: { startedAt: new Date(Date.now() - 600_000) },
          select: { id: true },
        });

        const afterBackdate = await asInstructor.attendance.sessionCode({ sessionId: session.id });
        check("moving the session's start leaves the code alone", afterBackdate.code, rightNow);

        await tx.attendanceSession.update({
          where: { id: started.id },
          data: { startedAt: session.startedAt },
          select: { id: true },
        });

        check(
          "a wrong code is refused",
          await refusal(() => asStudent.attendance.checkIn({ programId: program.id, code: wrong })),
          "UNAUTHORIZED",
        );

        const later = await asOther.attendance.checkIn({ programId: program.id, code: rightNow });
        check("the code the instructor gave out is accepted", later.alreadyCheckedIn, false);

        const checkedIn = await asStudent.attendance.checkIn({
          programId: program.id,
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

        const twice = await asStudent.attendance.checkIn({ programId: program.id, code: rightNow });
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
          "an instructor of the program cannot check in as a fellow of it",
          await refusal(() =>
            asInstructor.attendance.checkIn({ programId: program.id, code: rightNow }),
          ),
          "FORBIDDEN",
        );

        // ---- A removed fellow -----------------------------------------------------

        await asInstructor.enrollments.remove({ enrollmentId: second.id });
        const removedRefusal = await refusal(() =>
          asOther.attendance.checkIn({ programId: program.id, code: rightNow }),
        );
        check("a removed fellow cannot check in", removedRefusal, "FORBIDDEN");
        // They keep reading their own record, for the same reason they keep their feedback.
        const removedHistory = await asOther.attendance.myHistory({ programId: program.id });
        checkThat(
          "a removed fellow still reads their own attendance",
          removedHistory.days.length > 0,
        );
        await asInstructor.enrollments.restore({ enrollmentId: second.id });

        // ---- The grid shows everybody ----------------------------------------------

        const grid = await asInstructor.attendance.grid({ programId: program.id });
        const activeCount = await tx.enrollment.count({
          where: { programId: program.id, status: "ACTIVE" },
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
          programId: program.id,
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

        // One instant for the three window edits below, so each is a statement about the data
        // rather than about how long the script took to reach this line.
        const now = new Date();

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
          select: { id: true, codeSecret: true },
        });
        const lapsedCode = codeFor(lapsed);

        const lapsedView = await asInstructor.attendance.sessionCode({ sessionId: session.id });
        check("a lapsed session shows no code", lapsedView.code, null);

        /*
          The code is still derivable — the secret has not changed — and is refused anyway. That
          pairing is the whole of what "valid for as long as check-in is open" means, and it is why
          `codeMatches` no longer takes a clock: the session decides, not the code.
        */
        checkThat("the code itself is unchanged by lapsing", lapsedCode === rightNow);

        // A third fellow would be needed to check the refusal without a record in the way, so
        // this asks the one whose record was cleared below instead.
        await tx.attendanceRecord.deleteMany({
          where: { sessionId: session.id, enrollmentId: first.id },
        });
        check(
          "a lapsed session refuses a check-in",
          await refusal(() =>
            asStudent.attendance.checkIn({ programId: program.id, code: lapsedCode }),
          ),
          "PRECONDITION_FAILED",
        );

        const extended = await asInstructor.attendance.extend({ sessionId: session.id });
        check("extending reopens it", extended.state, "open");

        const afterExtend = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: session.id },
          select: { id: true, codeSecret: true },
        });
        const liveCode = codeFor(afterExtend);
        // The same digits as before it lapsed, which is what an instructor pressing Extend expects:
        // class ran long, and the code they gave out at nine still works.
        check("extending brings back the same code", liveCode, rightNow);

        const afterExtendCheckIn = await asStudent.attendance.checkIn({
          programId: program.id,
          code: liveCode,
        });
        check("and that code works again", afterExtendCheckIn.alreadyCheckedIn, false);

        // ---- Replacing a code that got out --------------------------------------------

        /*
          The only remedy for a leaked code now that nothing rotates on a clock, so these three
          checks stand where the grace-window checks used to. The pairing is the point: the old code
          stops working *and* a new one works, because a broken implementation passes either alone —
          one by refusing everything, the other by changing nothing.
        */
        await asInstructor.attendance.rotateCode({ sessionId: session.id });
        const rotated = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: session.id },
          select: { id: true, codeSecret: true },
        });
        checkThat(
          "replacing the code replaces the secret",
          rotated.codeSecret !== afterExtend.codeSecret,
        );

        const replacement = codeFor(rotated);
        checkThat("and derives different digits", replacement !== rightNow);

        await tx.attendanceRecord.deleteMany({
          where: { sessionId: session.id, enrollmentId: first.id },
        });
        check(
          "the code fellows were already given no longer works",
          await refusal(() =>
            asStudent.attendance.checkIn({ programId: program.id, code: rightNow }),
          ),
          "UNAUTHORIZED",
        );

        const afterReplace = await asStudent.attendance.checkIn({
          programId: program.id,
          code: replacement,
        });
        check("and the replacement does", afterReplace.alreadyCheckedIn, false);

        // ---- Ending, and what ending writes ---------------------------------------------

        const ended = await asInstructor.attendance.endSession({ sessionId: session.id });
        check("ending it reports how many were marked absent", typeof ended.absent, "number");
        check("and the session reads as ended", ended.session.state, "ended");

        const withoutRecord = await tx.enrollment.count({
          where: {
            programId: program.id,
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
            programId: program.id,
            enrollmentId: first.id,
            status: "ABSENT",
            source: "FINALIZED",
          },
          select: { id: true },
        });

        check(
          "a fellow holding only a finalized absence is refused rather than told they are in",
          await refusal(() =>
            asStudent.attendance.checkIn({ programId: program.id, code: liveCode }),
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
            programId: program.id,
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

        // ---- The program setting -----------------------------------------------------------

        const changed = await asInstructor.programs.setAttendanceLateAfter({
          programId: program.id,
          minutes: 17,
        });
        check("an instructor sets the on-time window", changed.attendanceLateAfterMinutes, 17);

        const afterSetting = await asInstructor.attendance.start({ programId: program.id });
        check("a new session copies it", afterSetting.lateAfterMinutes, 17);

        check(
          "a student cannot change it",
          await refusal(() =>
            asStudent.programs.setAttendanceLateAfter({ programId: program.id, minutes: 3 }),
          ),
          "FORBIDDEN",
        );

        /*
          ---- When people arrive, against real rows -----------------------------------------

          The detail that per-course attendance used to carry, recovered as the fact it actually was.
          Taking attendance once a day loses "which course were they late to" and this replaces it
          with "which morning of the week do they arrive late on", which is the question anybody was
          ever really asking.

          `arrivalAverages` is unit-tested against invented pairs; what earns a place here is the
          arithmetic against rows the database produced, and the three rules that are easy to state
          and easy to get wrong in a query:

          - **only records carrying a `checkedInAt` count**, so an absence neither raises the figure
            nor lowers it;
          - **the weekday comes from the session's own day**, not from the arrival instant, so a
            check-in a few minutes after midnight is not filed under the following day;
          - **a weekday with fewer than three arrivals reports nothing**, because a mean over one
            morning is a number somebody would quote.

          Six Mondays and one Friday, written directly: the procedures cannot produce a term of
          history inside one transaction, and the shape being checked is the aggregate rather than
          the writing of a row.
        */
        await tx.attendanceSession.deleteMany({ where: { programId: program.id } });

        /*
          Mondays, Tuesdays and Wednesdays in a real month, so `weekdayOf` has something to agree
          with rather than a date this script asserted the weekday of. **March 2026 deliberately**,
          because daylight saving starts on the 8th: the first Monday is in EST and the rest are in
          EDT, so four arrivals averaging exactly 10:45 is the school clock being read correctly
          across the change rather than a fixed offset happening to work.

          **Four late Mondays against five on-time Tuesdays**, and the proportion is the point rather
          than the pattern being visible. `arrivalSentence` names the weekday furthest from the
          overall mean, and the mean is pulled toward whichever weekday has more arrivals — so a
          fixture with more Mondays than Tuesdays would make *Tuesday* the outlier and the sentence
          would name the ordinary day rather than the exceptional one. More of the ordinary day is
          what a real week looks like, and it is what makes "on Mondays" the answer.

          The two Wednesdays are the floor: two arrivals is below `MIN_ARRIVALS`, so that weekday
          reports no average while the ones around it do.
        */
        const mondays = ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"];
        const tuesdays = ["2026-03-03", "2026-03-10", "2026-03-17", "2026-03-24", "2026-03-31"];
        const wednesdays = ["2026-03-04", "2026-03-11"];
        checkThat(
          "the fixture days really are Mondays, Tuesdays and Wednesdays",
          mondays.every((day) => weekdayOf(day) === 1) &&
            tuesdays.every((day) => weekdayOf(day) === 2) &&
            wednesdays.every((day) => weekdayOf(day) === 3),
          `${mondays.length} + ${tuesdays.length} + ${wednesdays.length} days`,
        );

        /** One closed session on a given day, with one arrival at a given school-clock time. */
        const programId = program.id;
        async function arrivalOn(day: string, hours: number, minutes: number) {
          const session = await tx.attendanceSession.create({
            data: {
              programId,
              date: dateColumnFor(day),
              startedAt: new Date(`${day}T${String(hours).padStart(2, "0")}:00:00Z`),
              endsAt: new Date(`${day}T23:00:00Z`),
              endedAt: new Date(`${day}T23:00:00Z`),
              lateAfterMinutes: 5,
              codeSecret: "a".repeat(64),
            },
            select: { id: true },
          });

          await tx.attendanceRecord.create({
            data: {
              sessionId: session.id,
              programId,
              enrollmentId: first.id,
              status: "PRESENT",
              source: "SELF_CHECK_IN",
              checkedInAt: schoolInstant(day, hours, minutes),
            },
          });
        }

        for (const day of mondays) await arrivalOn(day, 10, 45);
        for (const day of tuesdays) await arrivalOn(day, 9, 0);
        for (const day of wednesdays) await arrivalOn(day, 9, 5);

        /*
          And one absence, which must not move either figure. On a Monday deliberately — the weekday
          that already has an average — because an absence dropped into a weekday with none would
          leave both readings unchanged whether the rule held or not. Written FINALIZED, which is the
          only source the CHECK constraints allow with no `checkedInAt`.
        */
        const absentSession = await tx.attendanceSession.create({
          data: {
            programId: program.id,
            date: dateColumnFor("2026-03-30"),
            startedAt: new Date("2026-03-30T13:00:00Z"),
            endsAt: new Date("2026-03-30T23:00:00Z"),
            endedAt: new Date("2026-03-30T23:00:00Z"),
            lateAfterMinutes: 5,
            codeSecret: "b".repeat(64),
          },
          select: { id: true },
        });
        await tx.attendanceRecord.create({
          data: {
            sessionId: absentSession.id,
            programId: program.id,
            enrollmentId: first.id,
            status: "ABSENT",
            source: "FINALIZED",
          },
        });

        const history = await asInstructor.attendance.history({ programId: program.id });
        const theirs = history.arrivals[first.id];

        checkThat("the roster's arrivals are keyed by enrollment", theirs !== undefined, first.id);

        check(
          "the overall average counts every arrival and no absence",
          theirs?.overall.count,
          mondays.length + tuesdays.length + wednesdays.length,
        );
        check(
          "...and every weekday is present, Monday first",
          theirs?.byWeekday.map((entry) => entry.weekday),
          [1, 2, 3, 4, 5, 6, 0],
        );
        check(
          "Monday reports its own average",
          theirs?.byWeekday.find((entry) => entry.weekday === 1)?.average.minutes,
          10 * 60 + 45,
        );
        check(
          "...and Tuesday a different one",
          theirs?.byWeekday.find((entry) => entry.weekday === 2)?.average.minutes,
          9 * 60,
        );
        /*
          The floor. Two arrivals is one short, so the weekday reports its count and no average — a
          mean over two mornings is a number somebody would quote, and quoting it would be wrong.
        */
        check(
          `a weekday with fewer than ${MIN_ARRIVALS} arrivals reports none`,
          theirs?.byWeekday.find((entry) => entry.weekday === 3)?.average,
          { minutes: null, count: wednesdays.length },
        );
        /*
          A weekday nobody has arrived on. Reported as an entry with a null average rather than
          omitted, so a screen draws a stable set of rows — a table whose weekdays appeared and
          disappeared as the term went on would move under the reader. And it is a different fact
          from the one above: "not enough yet" and "never" both read as blank and are not the same.
        */
        check(
          "...and a weekday with none at all says so too",
          theirs?.byWeekday.find((entry) => entry.weekday === 4)?.average,
          { minutes: null, count: 0 },
        );

        /*
          The sentence the three screens print, and the reason it is one function: a weekday within
          five minutes of the overall mean is rounding rather than a pattern, and naming it would
          invent one. Here Monday is more than an hour late against a mean pulled down by five
          on-time Tuesdays, so Monday is the weekday named.
        */
        const sentence = arrivalSentence(theirs!);
        checkThat(
          "the sentence names the weekday that drifts furthest",
          sentence !== null &&
            sentence.includes("Monday") &&
            sentence.includes(formatClockMinutes(10 * 60 + 45)),
          sentence ?? "null",
        );
        check(
          "...and says nothing at all before there is anything to say",
          arrivalSentence(arrivalAverages([])),
          null,
        );

        // The fellow's own screen reads the same figures, which is what stops an instructor and a
        // fellow being shown different accounts of the same mornings.
        const asFirst = createCaller({ db: tx, user: { id: first.studentId } } as never);
        check(
          "a fellow's own record carries the same overall average",
          (await asFirst.attendance.myHistory({ programId: program.id })).arrivals.overall.minutes,
          theirs?.overall.minutes,
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
    const other = await tx.program.findFirst({
      where: { id: { not: program.id }, enrollments: { some: {} } },
      select: { id: true, enrollments: { take: 1, select: { id: true } } },
    });

    const session = await tx.attendanceSession.create({
      data: {
        programId: program.id,
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
        A record naming this term and another one's enrollment. The procedure refuses it in
        words; this asks whether the *database* would, because that is the guarantee — a second write
        path added later inherits it, and a check in a procedure does not.

        The key is `(enrollmentId, programId) → enrollments(id, programId)`, which is the same
        composite device with a new scoping column: `programId` is copied from the session the server
        has already loaded and never taken from input, so `setStatus` cannot write against another
        term's fellow even when its input says to.
      */
      const crossProgram = await refusal(() =>
        tx.attendanceRecord.create({
          data: {
            sessionId: session.id,
            programId: program.id,
            enrollmentId: other.enrollments[0].id,
            status: "PRESENT",
            source: "INSTRUCTOR",
          },
        }),
      );
      checkThat(
        "the database refuses a record against another program's fellow",
        crossProgram !== "accepted",
        crossProgram,
      );
    } else {
      skip("needs a second program with an enrollment to check the cross-program constraint");
    }
  });

  await inOwnTransaction(db, async (tx) => {
    const session = await tx.attendanceSession.create({
      data: {
        programId: program.id,
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
          programId: program.id,
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
          programId: program.id,
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
