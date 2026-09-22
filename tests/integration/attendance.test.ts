/**
 * Taking attendance: starting a day, checking into it, correcting it, ending it, and when people
 * arrive.
 *
 * Run with `npm run test:integration`.
 *
 * **One morning per program, not one per course.** A fellow taking three courses that all met on a
 * Tuesday used to have three sessions to check into and three codes to type; there is one session,
 * one code, and one record.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. What makes this need a
 * database rather than a unit test is that most of what these procedures *are* is authorization and
 * database constraints — a unique index deciding a race, a composite foreign key refusing another
 * program's fellow, a status a CHECK constraint will not let the table express. None of that can be
 * asked of a fixture, and Prisma is not restricted by row level security from ignoring any of it.
 *
 * **Every check is written in pairs.** Allowed and refused at the same call, because a one-sided
 * check passes against a guard that refuses everybody — and the counting checks assert the record
 * count *and* the audit count, because a broken implementation passes either one alone.
 *
 * **The code is derived here**, with `codeFor`, rather than read back from a procedure. That is
 * what lets these ask the question the procedure cannot be trusted to answer about itself: that the
 * code a fellow is refused is genuinely a different code, and that replacing the session secret
 * invalidates the one twenty-five people were already given.
 *
 * Carries the 76 assertions `verify:attendance` held, **none of which had run in weeks**. The
 * script needed a seeded program with an instructor and at least two active fellows; a seeded
 * database has one, so it reported a skip and exited non-zero on every run while measuring nothing.
 * Two fellows are what the checks require — half of them are about one fellow being unaffected by
 * what another does, and with one "the record count did not change" passes for the wrong reason —
 * so the fixture makes two, and makes the outsider instructor and the second program that two more
 * of its checks had also been standing down for.
 */
import { MIN_ARRIVALS, arrivalAverages, arrivalSentence } from "@/lib/attendance/arrival";
import { CODE_DIGITS, codeFor } from "@/lib/attendance/code";
import { DEFAULT_SESSION_MINUTES, defaultEndsAt } from "@/lib/attendance/window";
import {
  dateColumnFor,
  formatClockMinutes,
  instantAtSchoolClock,
  minutesAfterMidnight,
  schoolDayFromColumn,
  schoolDayOf,
  weekdayOf,
} from "@/lib/school-time";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

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

/** What a call refused with, in words. For the refusals whose wording is the point. */
async function refusalMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return (err as Error).message;
  }
}

/** Walks a payload looking for a key at any depth. Used to show the secret never leaves. */
function containsKey(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  return Object.entries(value as Record<string, unknown>).some(
    ([name, nested]) => name === key || containsKey(nested, key),
  );
}

/**
 * The instant at which the school clock reads a given time on a given day.
 *
 * Solved for rather than computed from an offset, because the offset is the thing being checked.
 * Four Mondays in March 2026 straddle the change to daylight saving — the first is in EST and the
 * rest are in EDT — so an arrival written at a fixed UTC hour would read as two different times of
 * the morning and the weekday average would be an artefact of the calendar.
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

describe("a day of attendance, from starting it to reading the averages", () => {
  const tx = withRollback(180_000);

  let world: World;
  let outsiderId: string;
  const today = schoolDayOf(new Date());

  /** The two fellows, named as the checks name them. */
  let firstEnrollment: { id: string; studentId: string };
  let secondEnrollment: { id: string; studentId: string };

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), firstEnrollment.studentId);
  const asOther = () => createCaller(tx(), secondEnrollment.studentId);

  let started: Awaited<ReturnType<ReturnType<typeof asInstructor>["attendance"]["start"]>>;
  let sessionId: string;
  let originalStartedAt: Date;
  let rightNow: string;
  let liveCode: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    firstEnrollment = world.students[0]!;
    secondEnrollment = world.students[1]!;
    /*
      An instructor who does not instruct this program, made rather than searched for. The script
      asked the database for one, found none on a seeded database, and reported a skip.
    */
    outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });
  });

  describe("starting a session", () => {
    beforeAll(async () => {
      started = await asInstructor().attendance.start({ programId: world.programId });
      sessionId = started.id;
      const row = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { startedAt: true },
      });
      originalStartedAt = row.startedAt!;
    });

    it("an instructor starts today's session", () => {
      expect(started.started).toBe(true);
    });

    it("it is dated today", () => {
      expect(started.day).toBe(today);
    });

    it("it is open", () => {
      expect(started.state).toBe("open");
    });

    it("it copied the program's on-time window", async () => {
      const program = await tx().program.findUniqueOrThrow({
        where: { id: world.programId },
        select: { attendanceLateAfterMinutes: true },
      });
      expect(started.lateAfterMinutes).toBe(program.attendanceLateAfterMinutes);
    });

    /*
      The same call again. Asserting the *id* rather than only the flag is the point: a procedure
      that created a second row and reported `started: false` would pass on the flag alone, and the
      room would then be reading one code while the server accepted another.
    */
    it("starting it again does not start a second one", async () => {
      const again = await asInstructor().attendance.start({ programId: world.programId });
      expect(again.started).toBe(false);
    });

    it("and hands back the session that exists", async () => {
      const again = await asInstructor().attendance.start({ programId: world.programId });
      expect(again.id).toBe(started.id);
    });

    it("a student cannot start a session", async () => {
      const code = await refusal(() =>
        asStudent().attendance.start({ programId: world.programId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("an instructor who does not instruct this program cannot start one", async () => {
      const code = await refusal(() =>
        createCaller(tx(), outsiderId).attendance.start({ programId: world.programId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a session cannot be started for a day in the future", async () => {
      const code = await refusal(() =>
        asInstructor().attendance.start({ programId: world.programId, day: "2099-01-01" }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });

  /*
    The `joinToken` precedent from `programs.roster`, and sharper: this one lets somebody mark
    themselves present from bed. A check rather than a convention, because the failure is silent and
    total.
  */
  describe("the secret never leaves", () => {
    it("the fellow's own view carries no code secret", async () => {
      const todayForStudent = await asStudent().attendance.today();
      expect(containsKey(todayForStudent, "codeSecret")).toBe(false);
    });

    it("a student cannot read the session code", async () => {
      const code = await refusal(() => asStudent().attendance.sessionCode({ sessionId }));
      expect(code).toBe("FORBIDDEN");
    });

    it("the instructor's code view carries no secret either", async () => {
      const codeView = await asInstructor().attendance.sessionCode({ sessionId });
      expect(containsKey(codeView, "codeSecret")).toBe(false);
    });

    it("the code is four digits", async () => {
      const codeView = await asInstructor().attendance.sessionCode({ sessionId });
      expect(codeView.code?.length ?? 0).toBe(CODE_DIGITS);
    });

    it("the procedure and this suite derive the same code", async () => {
      const session = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { id: true, codeSecret: true },
      });
      rightNow = codeFor(session);
      const codeView = await asInstructor().attendance.sessionCode({ sessionId });
      expect(codeView.code).toBe(rightNow);
    });

    /*
      The session's start time is moved, the code is asked for again, and the start time is then put
      back.

      This is the property that made a fixed code worth having, and the one a reader is most likely
      to doubt: the code is a fact about which session this is, not about how long it has been
      running, so an instructor correcting a session that began five minutes late does not change
      the digits twenty-five people have already been given.

      **Restored immediately, because everything below depends on it.** Left backdated, the check-in
      two groups down lands outside the on-time window and reads LATE.
    */
    it("moving the session's start leaves the code alone", async () => {
      await tx().attendanceSession.update({
        where: { id: sessionId },
        data: { startedAt: new Date(Date.now() - 600_000) },
        select: { id: true },
      });
      const afterBackdate = await asInstructor().attendance.sessionCode({ sessionId });
      await tx().attendanceSession.update({
        where: { id: sessionId },
        data: { startedAt: originalStartedAt },
        select: { id: true },
      });
      expect(afterBackdate.code).toBe(rightNow);
    });
  });

  describe("checking in", () => {
    let wrong: string;

    beforeAll(() => {
      wrong = String((Number(rightNow) + 5000) % 10_000).padStart(CODE_DIGITS, "0");
    });

    it("a wrong code is refused", async () => {
      const code = await refusal(() =>
        asStudent().attendance.checkIn({ programId: world.programId, code: wrong }),
      );
      expect(code).toBe("UNAUTHORIZED");
    });

    it("the code the instructor gave out is accepted", async () => {
      const later = await asOther().attendance.checkIn({
        programId: world.programId,
        code: rightNow,
      });
      expect(later.alreadyCheckedIn).toBe(false);
    });

    it("the current code is accepted", async () => {
      const checkedIn = await asStudent().attendance.checkIn({
        programId: world.programId,
        code: rightNow,
      });
      expect(checkedIn.alreadyCheckedIn).toBe(false);
    });

    it("and lands as present", async () => {
      const row = await tx().attendanceRecord.findUniqueOrThrow({
        where: { sessionId_enrollmentId: { sessionId, enrollmentId: firstEnrollment.id } },
        select: { status: true },
      });
      expect(row.status).toBe("PRESENT");
    });

    /*
      A second attempt. All three assertions, because any one of them passes on its own against a
      broken implementation: the flag could be right while a row was written, or the row count right
      while a second audit event was recorded.
    */
    describe("a second attempt", () => {
      let recordsBefore: number;
      let eventsBefore: number;
      let twice: { alreadyCheckedIn: boolean };

      beforeAll(async () => {
        recordsBefore = await tx().attendanceRecord.count({ where: { sessionId } });
        eventsBefore = await tx().auditEvent.count({
          where: { action: "ATTENDANCE_CHECKED_IN", subjectId: firstEnrollment.studentId },
        });
        twice = await asStudent().attendance.checkIn({
          programId: world.programId,
          code: rightNow,
        });
      });

      it("checking in twice returns the record that exists", () => {
        expect(twice.alreadyCheckedIn).toBe(true);
      });

      it("and writes no second record", async () => {
        expect(await tx().attendanceRecord.count({ where: { sessionId } })).toBe(recordsBefore);
      });

      it("and writes no second audit event", async () => {
        const now = await tx().auditEvent.count({
          where: { action: "ATTENDANCE_CHECKED_IN", subjectId: firstEnrollment.studentId },
        });
        expect(now).toBe(eventsBefore);
      });
    });

    it("an instructor of the program cannot check in as a fellow of it", async () => {
      const code = await refusal(() =>
        asInstructor().attendance.checkIn({ programId: world.programId, code: rightNow }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("a removed fellow", () => {
    let removedRefusal: string;
    let stillReads: boolean;

    beforeAll(async () => {
      await asInstructor().enrollments.remove({ enrollmentId: secondEnrollment.id });
      removedRefusal = await refusal(() =>
        asOther().attendance.checkIn({ programId: world.programId, code: rightNow }),
      );
      const history = await asOther().attendance.myHistory({ programId: world.programId });
      stillReads = history.days.length > 0;
      await asInstructor().enrollments.restore({ enrollmentId: secondEnrollment.id });
    });

    it("a removed fellow cannot check in", () => {
      expect(removedRefusal).toBe("FORBIDDEN");
    });

    // They keep reading their own record, for the same reason they keep their feedback.
    it("a removed fellow still reads their own attendance", () => {
      expect(stillReads).toBe(true);
    });
  });

  describe("the grid shows everybody", () => {
    it("the grid has a row per active enrollment", async () => {
      const grid = await asInstructor().attendance.grid({ programId: world.programId });
      const activeCount = await tx().enrollment.count({
        where: { programId: world.programId, status: "ACTIVE" },
      });
      expect(grid.rows).toHaveLength(activeCount);
    });

    it("including fellows who have not checked in", async () => {
      /*
        The second fellow's own check-in is cleared first, so there is genuinely somebody with no
        record. Both fellows checked in above, and a grid asked before this would have nothing to
        say about the case the check is named for.
      */
      await tx().attendanceRecord.deleteMany({
        where: { sessionId, enrollmentId: secondEnrollment.id },
      });
      const grid = await asInstructor().attendance.grid({ programId: world.programId });
      expect(grid.rows.some((row) => row.record === null)).toBe(true);
    });
  });

  describe("correcting, and what a correction survives", () => {
    let marked: { status: string; source: string };

    beforeAll(async () => {
      marked = await asInstructor().attendance.setStatus({
        sessionId,
        enrollmentId: secondEnrollment.id,
        status: "EXCUSED",
        note: "Hospital appointment",
      });
    });

    it("an instructor sets a status by hand", () => {
      expect(marked.status).toBe("EXCUSED");
    });

    it("and it is recorded as theirs", () => {
      expect(marked.source).toBe("INSTRUCTOR");
    });

    it("the audit event carries what the status was before", async () => {
      const setEvent = await tx().auditEvent.findFirst({
        where: { action: "ATTENDANCE_STATUS_SET", subjectId: secondEnrollment.studentId },
        orderBy: { occurredAt: "desc" },
        select: { detail: true },
      });
      expect((setEvent?.detail as { to?: string } | null)?.to).toBe("EXCUSED");
    });

    /*
      A self check-in never overwrites an instructor's decision. This is the reason `checkIn` tests
      for an existing record before it looks at the code at all.
    */
    it("a fellow's code does not overwrite an excusal", async () => {
      const overwritten = await asOther().attendance.checkIn({
        programId: world.programId,
        code: rightNow,
      });
      expect(overwritten.status).toBe("EXCUSED");
    });

    it("a student cannot set anybody's status", async () => {
      const code = await refusal(() =>
        asStudent().attendance.setStatus({
          sessionId,
          enrollmentId: firstEnrollment.id,
          status: "PRESENT",
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("editing the window recomputes one kind of row and not the other", () => {
    let shifted: { recomputed: number };

    beforeAll(async () => {
      // Backwards, so the check-in that was on time is now well past the threshold.
      shifted = await asInstructor().attendance.updateSession({
        sessionId,
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        lateAfterMinutes: 1,
      });
    });

    it("moving the window recomputes self check-ins", () => {
      expect(shifted.recomputed).toBeGreaterThanOrEqual(1);
    });

    it("the self check-in is now late", async () => {
      const row = await tx().attendanceRecord.findUniqueOrThrow({
        where: { sessionId_enrollmentId: { sessionId, enrollmentId: firstEnrollment.id } },
        select: { status: true },
      });
      expect(row.status).toBe("LATE");
    });

    // The check most likely to catch a real regression: an instructor's decision about a person
    // must not be reverted by a threshold moving.
    it("the instructor's excusal survives untouched", async () => {
      const row = await tx().attendanceRecord.findUniqueOrThrow({
        where: { sessionId_enrollmentId: { sessionId, enrollmentId: secondEnrollment.id } },
        select: { status: true },
      });
      expect(row.status).toBe("EXCUSED");
    });
  });

  describe("the backstop, and extending past it", () => {
    let lapsedCode: string;
    let secretBeforeRotate: string;

    beforeAll(async () => {
      const now = Date.now();
      await tx().attendanceSession.update({
        where: { id: sessionId },
        data: {
          startedAt: new Date(now - (DEFAULT_SESSION_MINUTES + 1) * 60 * 1000),
          endsAt: new Date(now - 60 * 1000),
        },
        select: { id: true },
      });
      const lapsed = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { id: true, codeSecret: true },
      });
      lapsedCode = codeFor(lapsed);
    });

    it("a lapsed session shows no code", async () => {
      const lapsedView = await asInstructor().attendance.sessionCode({ sessionId });
      expect(lapsedView.code).toBeNull();
    });

    /*
      The code is still derivable — the secret has not changed — and is refused anyway. That pairing
      is the whole of what "valid for as long as check-in is open" means, and it is why `codeMatches`
      no longer takes a clock: the session decides, not the code.
    */
    it("the code itself is unchanged by lapsing", () => {
      expect(lapsedCode).toBe(rightNow);
    });

    it("a lapsed session refuses a check-in", async () => {
      await tx().attendanceRecord.deleteMany({
        where: { sessionId, enrollmentId: firstEnrollment.id },
      });
      const code = await refusal(() =>
        asStudent().attendance.checkIn({ programId: world.programId, code: lapsedCode }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("extending reopens it", async () => {
      const extended = await asInstructor().attendance.extend({ sessionId });
      expect(extended.state).toBe("open");
    });

    // The same digits as before it lapsed, which is what an instructor pressing Extend expects:
    // class ran long, and the code they gave out at nine still works.
    it("extending brings back the same code", async () => {
      const afterExtend = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { id: true, codeSecret: true },
      });
      secretBeforeRotate = afterExtend.codeSecret;
      liveCode = codeFor(afterExtend);
      expect(liveCode).toBe(rightNow);
    });

    it("and that code works again", async () => {
      const afterExtendCheckIn = await asStudent().attendance.checkIn({
        programId: world.programId,
        code: liveCode,
      });
      expect(afterExtendCheckIn.alreadyCheckedIn).toBe(false);
    });

    /*
      Replacing a code that got out is the only remedy now that nothing rotates on a clock. The
      pairing is the point: the old code stops working *and* a new one works, because a broken
      implementation passes either alone — one by refusing everything, the other by changing nothing.
    */
    describe("replacing a code that got out", () => {
      let replacement: string;
      let rotatedSecret: string;

      beforeAll(async () => {
        await asInstructor().attendance.rotateCode({ sessionId });
        const rotated = await tx().attendanceSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { id: true, codeSecret: true },
        });
        rotatedSecret = rotated.codeSecret;
        replacement = codeFor(rotated);
      });

      it("replacing the code replaces the secret", () => {
        expect(rotatedSecret).not.toBe(secretBeforeRotate);
      });

      it("and derives different digits", () => {
        expect(replacement).not.toBe(rightNow);
      });

      it("the code fellows were already given no longer works", async () => {
        await tx().attendanceRecord.deleteMany({
          where: { sessionId, enrollmentId: firstEnrollment.id },
        });
        const code = await refusal(() =>
          asStudent().attendance.checkIn({ programId: world.programId, code: rightNow }),
        );
        expect(code).toBe("UNAUTHORIZED");
      });

      it("and the replacement does", async () => {
        const afterReplace = await asStudent().attendance.checkIn({
          programId: world.programId,
          code: replacement,
        });
        expect(afterReplace.alreadyCheckedIn).toBe(false);
        liveCode = replacement;
      });
    });
  });

  describe("ending, and what ending writes", () => {
    let ended: { absent: number; session: { state: string } };
    let recordsAfterEnd: number;

    beforeAll(async () => {
      ended = await asInstructor().attendance.endSession({ sessionId });
      recordsAfterEnd = await tx().attendanceRecord.count({ where: { sessionId } });
    });

    it("ending it reports how many were marked absent", () => {
      expect(typeof ended.absent).toBe("number");
    });

    it("and the session reads as ended", () => {
      expect(ended.session.state).toBe("ended");
    });

    it("every active enrollment now has a record", async () => {
      const withoutRecord = await tx().enrollment.count({
        where: {
          programId: world.programId,
          status: "ACTIVE",
          attendance: { none: { sessionId } },
        },
      });
      expect(withoutRecord).toBe(0);
    });

    it("and every finalized row is an absence", async () => {
      const finalized = await tx().attendanceRecord.findMany({
        where: { sessionId, source: "FINALIZED" },
        select: { status: true },
      });
      expect(finalized.every((row) => row.status === "ABSENT")).toBe(true);
    });

    it("ending it twice is harmless", async () => {
      const endedAgain = await asInstructor().attendance.endSession({ sessionId });
      expect(endedAgain.alreadyEnded).toBe(true);
    });

    it("and writes nothing", async () => {
      expect(await tx().attendanceRecord.count({ where: { sessionId } })).toBe(recordsAfterEnd);
    });

    /*
      The fellow who missed the morning entirely, which is the case worth asking about. Their own
      check-in is cleared first and replaced with the row `endSession` writes for somebody nobody
      recorded — without that they hold a real check-in, `checkIn` correctly hands it back, and the
      refusal would never be reached while the line still read as a pass.

      **A finalized absence must not read as "you are already checked in".** It is the absence of a
      decision rather than one, and telling somebody who missed class that they are already marked in
      is both false and the opposite of what they need to hear.
    */
    it("a fellow holding only a finalized absence is refused rather than told they are in", async () => {
      await tx().attendanceRecord.deleteMany({
        where: { sessionId, enrollmentId: firstEnrollment.id },
      });
      await tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: firstEnrollment.id,
          status: "ABSENT",
          source: "FINALIZED",
        },
        select: { id: true },
      });

      const code = await refusal(() =>
        asStudent().attendance.checkIn({ programId: world.programId, code: liveCode }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });
  });

  describe("reopening keeps the decisions and drops the absences", () => {
    let selfBefore: number;
    let instructorBefore: number;
    let finalizedNow: number;
    let reopened: { absencesRemoved: number; session: { state: string } };

    beforeAll(async () => {
      selfBefore = await tx().attendanceRecord.count({
        where: { sessionId, source: "SELF_CHECK_IN" },
      });
      instructorBefore = await tx().attendanceRecord.count({
        where: { sessionId, source: "INSTRUCTOR" },
      });
      // Counted fresh rather than reused: the finalized-absence check above added one, and a stale
      // expectation here would fail for a reason about this file rather than about reopening.
      finalizedNow = await tx().attendanceRecord.count({
        where: { sessionId, source: "FINALIZED" },
      });
      reopened = await asInstructor().attendance.reopen({ sessionId });
    });

    it("reopening reports the absences it cleared", () => {
      expect(reopened.absencesRemoved).toBe(finalizedNow);
    });

    it("the finalized rows are gone", async () => {
      expect(await tx().attendanceRecord.count({ where: { sessionId, source: "FINALIZED" } })).toBe(
        0,
      );
    });

    it("the self check-ins survive", async () => {
      expect(
        await tx().attendanceRecord.count({ where: { sessionId, source: "SELF_CHECK_IN" } }),
      ).toBe(selfBefore);
    });

    it("the instructor's decisions survive", async () => {
      expect(
        await tx().attendanceRecord.count({ where: { sessionId, source: "INSTRUCTOR" } }),
      ).toBe(instructorBefore);
    });

    it("and it is open again", () => {
      expect(reopened.session.state).toBe("open");
    });
  });

  describe("deleting", () => {
    /*
      A self check-in has to exist for this to be the check it claims to be. By this point the
      fellows' own rows have been overwritten by an excusal and cleared by the finalized-absence
      check above, so one is put back explicitly — otherwise the delete would be allowed and the
      refusal would go untested while the line still read as a pass.
    */
    it("a session somebody has checked into cannot be deleted", async () => {
      await tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: firstEnrollment.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date(),
        },
        select: { id: true },
      });

      const code = await refusal(() => asInstructor().attendance.deleteSession({ sessionId }));
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("a session nobody used can be", async () => {
      await tx().attendanceRecord.deleteMany({ where: { sessionId } });
      const deleted = await asInstructor().attendance.deleteSession({ sessionId });
      expect(deleted.day).toBe(today);
    });
  });

  describe("the program setting", () => {
    it("an instructor sets the on-time window", async () => {
      const changed = await asInstructor().programs.setAttendanceLateAfter({
        programId: world.programId,
        minutes: 17,
      });
      expect(changed.attendanceLateAfterMinutes).toBe(17);
    });

    it("a new session copies it", async () => {
      const afterSetting = await asInstructor().attendance.start({ programId: world.programId });
      expect(afterSetting.lateAfterMinutes).toBe(17);
    });

    it("a student cannot change it", async () => {
      const code = await refusal(() =>
        asStudent().programs.setAttendanceLateAfter({ programId: world.programId, minutes: 3 }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    ---- When people arrive, against real rows ---------------------------------

    The detail that per-course attendance used to carry, recovered as the fact it actually was.
    Taking attendance once a day loses "which course were they late to" and this replaces it with
    "which morning of the week do they arrive late on", which is the question anybody was ever
    really asking.

    `arrivalAverages` is unit-tested against invented pairs; what earns a place here is the
    arithmetic against rows the database produced, and the three rules that are easy to state and
    easy to get wrong in a query:

    - **only records carrying a `checkedInAt` count**, so an absence neither raises the figure nor
      lowers it;
    - **the weekday comes from the session's own day**, not from the arrival instant, so a check-in
      a few minutes after midnight is not filed under the following day;
    - **a weekday with fewer than three arrivals reports nothing**, because a mean over one morning
      is a number somebody would quote.
  */
  describe("when people arrive", () => {
    /*
      Mondays, Tuesdays and Wednesdays in a real month, so `weekdayOf` has something to agree with
      rather than a date this file asserted the weekday of. **March 2026 deliberately**, because
      daylight saving starts on the 8th: the first Monday is in EST and the rest are in EDT, so four
      arrivals averaging exactly 10:45 is the school clock being read correctly across the change
      rather than a fixed offset happening to work.

      **Four late Mondays against five on-time Tuesdays**, and the proportion is the point rather
      than the pattern being visible. `arrivalSentence` names the weekday furthest from the overall
      mean, and the mean is pulled toward whichever weekday has more arrivals — so a fixture with
      more Mondays than Tuesdays would make *Tuesday* the outlier and the sentence would name the
      ordinary day rather than the exceptional one.

      The two Wednesdays are the floor: two arrivals is below `MIN_ARRIVALS`, so that weekday reports
      no average while the ones around it do.
    */
    const mondays = ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"];
    const tuesdays = ["2026-03-03", "2026-03-10", "2026-03-17", "2026-03-24", "2026-03-31"];
    const wednesdays = ["2026-03-04", "2026-03-11"];

    let theirs: NonNullable<
      Awaited<
        ReturnType<ReturnType<typeof asInstructor>["attendance"]["history"]>
      >["arrivals"][string]
    >;

    beforeAll(async () => {
      await tx().attendanceSession.deleteMany({ where: { programId: world.programId } });

      /** One closed session on a given day, with one arrival at a given school-clock time. */
      const arrivalOn = async (day: string, hours: number, minutes: number) => {
        const session = await tx().attendanceSession.create({
          data: {
            programId: world.programId,
            date: dateColumnFor(day),
            startedAt: new Date(`${day}T${String(hours).padStart(2, "0")}:00:00Z`),
            endsAt: new Date(`${day}T23:00:00Z`),
            endedAt: new Date(`${day}T23:00:00Z`),
            lateAfterMinutes: 5,
            codeSecret: "a".repeat(64),
          },
          select: { id: true },
        });

        await tx().attendanceRecord.create({
          data: {
            sessionId: session.id,
            programId: world.programId,
            enrollmentId: firstEnrollment.id,
            status: "PRESENT",
            source: "SELF_CHECK_IN",
            checkedInAt: schoolInstant(day, hours, minutes),
          },
        });
      };

      for (const day of mondays) await arrivalOn(day, 10, 45);
      for (const day of tuesdays) await arrivalOn(day, 9, 0);
      for (const day of wednesdays) await arrivalOn(day, 9, 5);

      /*
        And one absence, which must not move either figure. On a Monday deliberately — the weekday
        that already has an average — because an absence dropped into a weekday with none would leave
        both readings unchanged whether the rule held or not. Written FINALIZED, which is the only
        source the CHECK constraints allow with no `checkedInAt`.
      */
      const absentSession = await tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: dateColumnFor("2026-03-30"),
          startedAt: new Date("2026-03-30T13:00:00Z"),
          endsAt: new Date("2026-03-30T23:00:00Z"),
          endedAt: new Date("2026-03-30T23:00:00Z"),
          lateAfterMinutes: 5,
          codeSecret: "b".repeat(64),
        },
        select: { id: true },
      });
      await tx().attendanceRecord.create({
        data: {
          sessionId: absentSession.id,
          programId: world.programId,
          enrollmentId: firstEnrollment.id,
          status: "ABSENT",
          source: "FINALIZED",
        },
      });

      const history = await asInstructor().attendance.history({ programId: world.programId });
      theirs = history.arrivals[firstEnrollment.id]!;
    });

    it("the fixture days really are Mondays, Tuesdays and Wednesdays", () => {
      expect(
        mondays.every((day) => weekdayOf(day) === 1) &&
          tuesdays.every((day) => weekdayOf(day) === 2) &&
          wednesdays.every((day) => weekdayOf(day) === 3),
      ).toBe(true);
    });

    it("the roster's arrivals are keyed by enrollment", () => {
      expect(theirs).toBeDefined();
    });

    it("the overall average counts every arrival and no absence", () => {
      expect(theirs.overall.count).toBe(mondays.length + tuesdays.length + wednesdays.length);
    });

    it("...and every weekday is present, Monday first", () => {
      expect(theirs.byWeekday.map((entry) => entry.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    it("Monday reports its own average", () => {
      expect(theirs.byWeekday.find((entry) => entry.weekday === 1)?.average.minutes).toBe(
        10 * 60 + 45,
      );
    });

    it("...and Tuesday a different one", () => {
      expect(theirs.byWeekday.find((entry) => entry.weekday === 2)?.average.minutes).toBe(9 * 60);
    });

    /*
      The floor. Two arrivals is one short, so the weekday reports its count and no average — a mean
      over two mornings is a number somebody would quote, and quoting it would be wrong.
    */
    it(`a weekday with fewer than ${MIN_ARRIVALS} arrivals reports none`, () => {
      expect(theirs.byWeekday.find((entry) => entry.weekday === 3)?.average).toEqual({
        minutes: null,
        count: wednesdays.length,
      });
    });

    /*
      A weekday nobody has arrived on. Reported as an entry with a null average rather than omitted,
      so a screen draws a stable set of rows — a table whose weekdays appeared and disappeared as the
      term went on would move under the reader. And it is a different fact from the one above: "not
      enough yet" and "never" both read as blank and are not the same.
    */
    it("...and a weekday with none at all says so too", () => {
      expect(theirs.byWeekday.find((entry) => entry.weekday === 4)?.average).toEqual({
        minutes: null,
        count: 0,
      });
    });

    /*
      The sentence the three screens print, and the reason it is one function: a weekday within five
      minutes of the overall mean is rounding rather than a pattern, and naming it would invent one.
      Here Monday is more than an hour late against a mean pulled down by five on-time Tuesdays.
    */
    it("the sentence names the weekday that drifts furthest", () => {
      const sentence = arrivalSentence(theirs);
      expect(
        sentence !== null &&
          sentence.includes("Monday") &&
          sentence.includes(formatClockMinutes(10 * 60 + 45)),
      ).toBe(true);
    });

    it("...and says nothing at all before there is anything to say", () => {
      expect(arrivalSentence(arrivalAverages([]))).toBeNull();
    });

    // The fellow's own screen reads the same figures, which is what stops an instructor and a fellow
    // being shown different accounts of the same mornings.
    it("a fellow's own record carries the same overall average", async () => {
      const mine = await asStudent().attendance.myHistory({ programId: world.programId });
      expect(mine.arrivals.overall.minutes).toBe(theirs.overall.minutes);
    });
  });
});

/*
  ---- The two rules that live in Postgres rather than in a procedure ----------

  Each in a transaction of its own, because each provokes a constraint and a failed statement
  poisons the transaction it happens in.
*/
describe("a record against another program's fellow", () => {
  const tx = withRollback();

  /*
    The procedure refuses it in words; this asks whether the *database* would, because that is the
    guarantee — a second write path added later inherits it, and a check in a procedure does not.

    The key is `(enrollmentId, programId) → enrollments(id, programId)`: `programId` is copied from
    the session the server has already loaded and never taken from input, so `setStatus` cannot write
    against another term's fellow even when its input says to.
  */
  it("the database refuses a record against another program's fellow", async () => {
    const world = await makeWorld(tx());
    const otherWorld = await makeWorld(tx());

    const session = await tx().attendanceSession.create({
      data: {
        programId: world.programId,
        date: dateColumnFor("2099-12-31"),
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        lateAfterMinutes: 5,
        codeSecret: "f".repeat(64),
      },
      select: { id: true },
    });

    const crossProgram = await refusal(() =>
      tx().attendanceRecord.create({
        data: {
          sessionId: session.id,
          programId: world.programId,
          enrollmentId: otherWorld.student.id,
          status: "PRESENT",
          source: "INSTRUCTOR",
        },
      }),
    );
    expect(crossProgram).not.toBe("accepted");
  });
});

describe("what a record may claim", () => {
  const tx = withRollback();
  let world: World;
  let sessionId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    const session = await tx().attendanceSession.create({
      data: {
        programId: world.programId,
        date: dateColumnFor("2099-12-30"),
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        lateAfterMinutes: 5,
        codeSecret: "f".repeat(64),
      },
      select: { id: true },
    });
    sessionId = session.id;
  });

  /*
    A finalized row claiming somebody was present. This is the one claim the table must never be
    able to make: it would be the application asserting attendance on the strength of no code typed
    and no instructor's decision — and it is the claim a stipend is paid against.
  */
  it("the database refuses a finalized row that claims somebody was present", async () => {
    const finalizedPresent = await refusal(() =>
      tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: world.student.id,
          status: "PRESENT",
          source: "FINALIZED",
        },
      }),
    );
    expect(finalizedPresent).not.toBe("accepted");
  });

  it("and a self check-in with no time, which could never be recomputed", async () => {
    const selfWithoutTime = await refusal(() =>
      tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: world.student.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
        },
      }),
    );
    expect(selfWithoutTime).not.toBe("accepted");
  });
});

/**
 * Making the code before check-in opens, so it can go on a whiteboard before class.
 *
 * **The check that matters is that the code does not move.** An instructor who writes four digits
 * on a board at 8:40 and presses start at 9:05 has to still be looking at the same code, or the
 * feature is worse than not having it — so the code is derived directly, before and after, rather
 * than trusted to a procedure to report about itself.
 *
 * Its own world and its own transaction, because the day this fills is today and the block above
 * has already started today's session in its own.
 */
describe("making the code before starting check-in", () => {
  const tx = withRollback(120_000);

  let world: World;
  const today = schoolDayOf(new Date());

  let prepared: Awaited<ReturnType<ReturnType<typeof asInstructor>["attendance"]["prepare"]>>;
  let sessionId: string;
  let preparedCode: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), world.student.studentId);

  /** The code as the database would derive it right now, read past every procedure. */
  async function codeFromRow(): Promise<string> {
    const row = await tx().attendanceSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { id: true, codeSecret: true },
    });
    return codeFor(row);
  }

  beforeAll(async () => {
    world = await makeWorld(tx());
    prepared = await asInstructor().attendance.prepare({ programId: world.programId });
    sessionId = prepared.id;
    preparedCode = await codeFromRow();
  });

  describe("what preparing makes", () => {
    it("an instructor makes today's code without opening check-in", () => {
      expect(prepared.prepared).toBe(true);
      expect(prepared.day).toBe(today);
    });

    it("the session reports itself as pending rather than open", () => {
      expect(prepared.state).toBe("pending");
    });

    /*
      Both null, together. The `_pending_is_paired` CHECK is what makes every screen able to read
      one and narrow on the other, so a row holding a start without a backstop is worth asserting
      does not exist.
    */
    it("it has neither a start nor a closing time", async () => {
      const row = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { startedAt: true, endsAt: true, endedAt: true, startedById: true },
      });
      expect(row.startedAt).toBeNull();
      expect(row.endsAt).toBeNull();
      expect(row.endedAt).toBeNull();
      // Nobody has opened check-in, so the column naming who did is answered by nobody.
      expect(row.startedById).toBeNull();
    });

    it("its code is four digits and readable by the instructor", async () => {
      const view = await asInstructor().attendance.sessionCode({ sessionId });
      expect(view.code).toMatch(new RegExp(`^\\d{${CODE_DIGITS}}$`));
      expect(view.code).toBe(preparedCode);
    });

    it("and the payload carrying it still never carries the secret", async () => {
      const view = await asInstructor().attendance.sessionCode({ sessionId });
      expect(containsKey(view, "codeSecret")).toBe(false);
    });

    it("nobody has checked in, and the count says so rather than being absent", async () => {
      const view = await asInstructor().attendance.sessionCode({ sessionId });
      expect(view.checkedIn).toBe(0);
      expect(view.expected).toBeGreaterThan(0);
    });

    it("preparing again makes no second session", async () => {
      const again = await asInstructor().attendance.prepare({ programId: world.programId });
      expect(again.prepared).toBe(false);
      expect(again.id).toBe(sessionId);
    });
  });

  /*
    The whole point of the phase: the code exists and is inert. Written as a pair — the correct code
    refused now, the same code accepted after start — because refusing everything would pass the
    first half on its own.
  */
  describe("while check-in has not started", () => {
    it("a fellow typing the correct code is refused", async () => {
      const refused = await refusal(() =>
        asStudent().attendance.checkIn({ programId: world.programId, code: preparedCode }),
      );
      expect(refused).toBe("NOT_FOUND");
    });

    /*
      Refused on the not-opened branch rather than as a wrong code, which is what keeps a room full
      of fellows typing the board's code three minutes early from spending the twenty-per-session
      attempt ceiling.
    */
    it("and that refusal writes no failed-attempt event", async () => {
      const failures = await tx().auditEvent.count({
        where: { action: "ATTENDANCE_CHECK_IN_FAILED", programId: world.programId },
      });
      expect(failures).toBe(0);
    });

    it("no record was written for anybody", async () => {
      const records = await tx().attendanceRecord.count({ where: { sessionId } });
      expect(records).toBe(0);
    });

    it("the fellow's own screens show nothing for today", async () => {
      const today_ = await asStudent().attendance.today();
      expect(today_).toHaveLength(0);

      const history = await asStudent().attendance.myHistory({ programId: world.programId });
      expect(history.days).toHaveLength(0);
    });

    it("and their week has no square for it", async () => {
      const week = await asStudent().attendance.myWeek();
      const mine = week.programs.find((row) => row.program.id === world.programId);
      expect(mine?.open).toBeNull();
      expect(mine?.days.every((day) => day.session === undefined)).toBe(true);
    });

    it("the instructor's grid shows everybody as not-yet rather than absent", async () => {
      const grid = await asInstructor().attendance.grid({ programId: world.programId });
      expect(grid.session?.state).toBe("pending");
      expect(grid.rows.every((row) => row.pending === "not-yet")).toBe(true);
      expect(grid.counts.absent).toBe(0);
    });

    /*
      A prepared session is left out of the rate denominator, because `summarize` skips an open
      session for anybody with no record. Preparing a code at 8:30 must not drop a term's figure
      until somebody presses start.
    */
    it("and it does not count against anybody's attendance rate", async () => {
      const history = await asInstructor().attendance.history({ programId: world.programId });
      const [fellow] = history.active;
      expect(fellow!.eligible).toBe(0);
      expect(history.openSessions).toHaveLength(0);
    });
  });

  /*
    Every instructor act on a clock that has not started. Each is refused in words rather than
    half-performed, and the pair for each is the same call succeeding after start, below.
  */
  describe("what cannot be done to it yet", () => {
    it("a status cannot be set, which is what keeps it record-free and deletable", async () => {
      const refused = await refusal(() =>
        asInstructor().attendance.setStatus({
          sessionId,
          enrollmentId: world.student.id,
          status: "EXCUSED",
        }),
      );
      expect(refused).toBe("PRECONDITION_FAILED");
    });

    it("its start time cannot be corrected, because it has none", async () => {
      const refused = await refusal(() =>
        asInstructor().attendance.updateSession({ sessionId, lateAfterMinutes: 20 }),
      );
      expect(refused).toBe("PRECONDITION_FAILED");
    });

    it("it cannot be extended", async () => {
      expect(await refusal(() => asInstructor().attendance.extend({ sessionId }))).toBe(
        "PRECONDITION_FAILED",
      );
    });

    it("it cannot be ended, which would mark the whole roster absent", async () => {
      expect(await refusal(() => asInstructor().attendance.endSession({ sessionId }))).toBe(
        "PRECONDITION_FAILED",
      );
    });

    it("and it cannot be reopened", async () => {
      expect(await refusal(() => asInstructor().attendance.reopen({ sessionId }))).toBe(
        "PRECONDITION_FAILED",
      );
    });

    it("none of those refusals wrote a record", async () => {
      const records = await tx().attendanceRecord.count({ where: { sessionId } });
      expect(records).toBe(0);
    });
  });

  /*
    Replacing the code is allowed, and it is the one act that must be: a code copied down wrongly or
    photographed by somebody outside the room is wrong at 8:45, and the remedy cannot wait for nine.
  */
  describe("replacing the code before class", () => {
    it("rotating is allowed and changes the code", async () => {
      const before = await codeFromRow();
      await asInstructor().attendance.rotateCode({ sessionId });
      const after = await codeFromRow();
      expect(after).not.toBe(before);

      // The session is the same one; only its secret moved.
      const view = await asInstructor().attendance.sessionCode({ sessionId });
      expect(view.session.id).toBe(sessionId);
      expect(view.code).toBe(after);
      preparedCode = after;
    });
  });

  /**
   * Starting it, which is the check the whole feature rests on.
   */
  describe("starting the prepared session", () => {
    let startedResult: Awaited<ReturnType<ReturnType<typeof asInstructor>["attendance"]["start"]>>;
    let codeBefore: string;

    beforeAll(async () => {
      codeBefore = await codeFromRow();
      startedResult = await asInstructor().attendance.start({ programId: world.programId });
    });

    it("it is the same session rather than a second one", async () => {
      expect(startedResult.started).toBe(true);
      expect(startedResult.id).toBe(sessionId);

      const count = await tx().attendanceSession.count({
        where: { programId: world.programId, date: dateColumnFor(today) },
      });
      expect(count).toBe(1);
    });

    /*
      **The line the board depends on.** The derivation reads the session id and the secret, and
      start touches neither — so the four digits an instructor wrote up before class are the four
      digits the server now accepts.
    */
    it("and the code is unchanged by starting it", async () => {
      expect(await codeFromRow()).toBe(codeBefore);
    });

    it("it now reports itself open, with a window", async () => {
      expect(startedResult.state).toBe("open");
      expect(startedResult.startedAt).not.toBeNull();

      const row = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { startedAt: true, endsAt: true, startedById: true },
      });
      expect(row.startedAt).not.toBeNull();
      expect(row.endsAt!.getTime() - row.startedAt!.getTime()).toBe(
        DEFAULT_SESSION_MINUTES * 60 * 1000,
      );
      // Whoever opened check-in, which is the act this column names.
      expect(row.startedById).toBe(world.instructorId);
    });

    it("the audit log carries both acts, and says the second followed a prepared code", async () => {
      const prepareEvents = await tx().auditEvent.count({
        where: { action: "ATTENDANCE_SESSION_PREPARED", subjectId: sessionId },
      });
      expect(prepareEvents).toBe(1);

      const startEvent = await tx().auditEvent.findFirstOrThrow({
        where: { action: "ATTENDANCE_SESSION_STARTED", subjectId: sessionId },
        select: { detail: true },
      });
      expect((startEvent.detail as { fromPrepared?: boolean }).fromPrepared).toBe(true);
    });

    /*
      Lateness runs from the press, not from when the code was made. This is the reason the two acts
      were separated at all: preparing a code at 8:40 used to mean marking the room late.
    */
    it("a fellow checking in a moment later is present, not late", async () => {
      const result = await asStudent().attendance.checkIn({
        programId: world.programId,
        code: codeBefore,
      });
      expect(result.status).toBe("PRESENT");
    });

    it("starting it again does not start a second one", async () => {
      const again = await asInstructor().attendance.start({ programId: world.programId });
      expect(again.started).toBe(false);
      expect(again.id).toBe(sessionId);
    });
  });
});

/**
 * What tomorrow does with a code nobody used.
 *
 * **A prepared session from an earlier day is deleted, not finalized**, and that is the difference
 * worth a test of its own. Finalizing writes an ABSENT row for every fellow on the roster, which is
 * the right record of a morning that was open and missed. A morning whose check-in never opened is
 * not that — nobody could have checked in, so nobody failed to — and marking a cohort absent for a
 * class that did not happen is a wrong number in a report nobody thinks to question.
 */
describe("sweeping a prepared session nobody started", () => {
  const tx = withRollback(120_000);

  let world: World;
  let staleId: string;
  let openId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx());

    // Two days ago: a code made and never used. One day ago: a session opened and never ended.
    const prepared = await tx().attendanceSession.create({
      data: {
        programId: world.programId,
        date: dateColumnFor(daysAgo(2)),
        startedAt: null,
        endsAt: null,
        lateAfterMinutes: 5,
        codeSecret: "a".repeat(64),
      },
      select: { id: true },
    });
    staleId = prepared.id;

    const opened = await tx().attendanceSession.create({
      data: {
        programId: world.programId,
        date: dateColumnFor(daysAgo(1)),
        startedAt: schoolInstant(daysAgo(1), 9, 0),
        endsAt: schoolInstant(daysAgo(1), 17, 0),
        lateAfterMinutes: 5,
        codeSecret: "b".repeat(64),
      },
      select: { id: true },
    });
    openId = opened.id;

    await asInstructor().attendance.start({ programId: world.programId });
  });

  it("the prepared day is gone, as though its code had never been made", async () => {
    const row = await tx().attendanceSession.findUnique({ where: { id: staleId } });
    expect(row).toBeNull();
  });

  it("and it left no absences behind", async () => {
    const records = await tx().attendanceRecord.count({ where: { sessionId: staleId } });
    expect(records).toBe(0);
  });

  /*
    The pair. A session that genuinely was open is still finalized at its own backstop — so the
    deletion above is about the prepared phase and not about the sweep having stopped working.
  */
  it("while the day that really was open is finalized at its own backstop", async () => {
    const row = await tx().attendanceSession.findUniqueOrThrow({
      where: { id: openId },
      select: { endedAt: true, endsAt: true },
    });
    expect(row.endedAt).not.toBeNull();
    expect(row.endedAt!.getTime()).toBe(row.endsAt!.getTime());

    const absences = await tx().attendanceRecord.count({
      where: { sessionId: openId, status: "ABSENT", source: "FINALIZED" },
    });
    expect(absences).toBeGreaterThan(0);
  });
});

/** `n` school days before today, as a school day string. */
function daysAgo(n: number): string {
  return schoolDayOf(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

/**
 * What a session's window may claim.
 *
 * The two constraints that keep "prepared" one phase rather than a set of half-states. Asserted at
 * the database rather than only through the procedures, because both failures are silent: a start
 * with no backstop would accept check-ins forever, and an ended row with no start would read as
 * pending to every screen while its ABSENT rows sat in the export.
 */
describe("what a session's window may claim", () => {
  const tx = withRollback();
  let world: World;

  beforeAll(async () => {
    world = await makeWorld(tx());
  });

  it("the database refuses a start with no closing time", async () => {
    const halfWindow = await refusal(() =>
      tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: dateColumnFor("2099-12-28"),
          startedAt: new Date(),
          endsAt: null,
          lateAfterMinutes: 5,
          codeSecret: "c".repeat(64),
        },
      }),
    );
    expect(halfWindow).not.toBe("accepted");
  });

  it("and a closing time with no start", async () => {
    const halfWindow = await refusal(() =>
      tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: dateColumnFor("2099-12-27"),
          startedAt: null,
          endsAt: new Date(),
          lateAfterMinutes: 5,
          codeSecret: "d".repeat(64),
        },
      }),
    );
    expect(halfWindow).not.toBe("accepted");
  });

  it("and a session ended without ever having started", async () => {
    const endedWithoutStart = await refusal(() =>
      tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: dateColumnFor("2099-12-26"),
          startedAt: null,
          endsAt: null,
          endedAt: new Date(),
          lateAfterMinutes: 5,
          codeSecret: "e".repeat(64),
        },
      }),
    );
    expect(endedWithoutStart).not.toBe("accepted");
  });
});

/**
 * A program that declares when it meets, and the days that declaration makes.
 *
 * **These run against whatever day the suite runs on**, because the procedures take no clock and
 * the whole point of a schedule is that it is read against the real day. The dates are therefore
 * derived from today rather than written down: a fixed September would pass in September and
 * quietly start creating nothing the following January.
 *
 * Every weekday is a meeting day in these groups. Which days fall where is `schedule.test.ts`'s
 * question, answered there against fixed dates; what these ask is what the procedure writes.
 */
describe("a program that declares when it meets", () => {
  const tx = withRollback(180_000);
  const today = schoolDayOf(new Date());

  /** Every weekday, so a count is a count of days rather than of which weekday today happens to be. */
  const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

  function daysFromToday(count: number): string {
    const at = new Date(`${today}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  function scheduleFor(programId: string, lastDay: number, startsAt = "09:30") {
    return {
      programId,
      startsOn: today,
      endsOn: daysFromToday(lastDay),
      weekdays: EVERY_DAY,
      startsAt,
    };
  }

  describe("saving it the first time", () => {
    let world: World;
    let saved: { make: string[]; remove: string[]; blocked: string[] };

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      saved = await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 6),
      );
    });

    it("makes one session for every meeting day from today", () => {
      expect(saved.make).toHaveLength(7);
      expect(saved.remove).toEqual([]);
    });

    it("and that is how many sessions the program has", async () => {
      const count = await tx().attendanceSession.count({ where: { programId: world.programId } });
      expect(count).toBe(7);
    });

    // Each day's 9:30, not one instant repeated. Across a daylight-saving change two days' 9:30
    // differ by an hour, which a single instant could not express.
    it("each carries its own day's start time", async () => {
      const sessions = await tx().attendanceSession.findMany({
        where: { programId: world.programId },
        orderBy: { date: "asc" },
      });

      for (const session of sessions) {
        const day = schoolDayFromColumn(session.date);
        expect(session.startedAt?.toISOString()).toBe(
          instantAtSchoolClock(day, "09:30").toISOString(),
        );
      }
    });

    it("and its backstop eight hours after that", async () => {
      const sessions = await tx().attendanceSession.findMany({
        where: { programId: world.programId },
        orderBy: { date: "asc" },
      });

      for (const session of sessions) {
        const day = schoolDayFromColumn(session.date);
        expect(session.endsAt?.toISOString()).toBe(
          defaultEndsAt(instantAtSchoolClock(day, "09:30")).toISOString(),
        );
      }
    });

    // The column means who opened check-in. The schedule is not a person.
    it("and nobody as the person who started it", async () => {
      const started = await tx().attendanceSession.findMany({
        where: { programId: world.programId },
        select: { startedById: true, endedAt: true },
      });

      expect(started.every((session) => session.startedById === null)).toBe(true);
      expect(started.every((session) => session.endedAt === null)).toBe(true);
    });

    it("writes one audit event for the whole save", async () => {
      const events = await tx().auditEvent.count({
        where: { action: "PROGRAM_ATTENDANCE_SCHEDULE_SET", programId: world.programId },
      });
      expect(events).toBe(1);
    });

    // The common case, and the one that must cost nothing.
    it("saving the same schedule again changes nothing", async () => {
      const again = await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 6),
      );

      expect(again.make).toEqual([]);
      expect(again.remove).toEqual([]);
      expect(
        await tx().attendanceSession.count({ where: { programId: world.programId } }),
      ).toBe(7);
    });
  });

  describe("changing it", () => {
    let world: World;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 3),
      );
    });

    it("moving the last day out makes only the new stretch", async () => {
      const longer = await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 6),
      );

      expect(longer.make).toEqual([daysFromToday(4), daysFromToday(5), daysFromToday(6)]);
      expect(longer.remove).toEqual([]);
    });

    it("moving it back in removes the days now outside it", async () => {
      const shorter = await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 2),
      );

      expect(shorter.remove).toEqual([
        daysFromToday(3),
        daysFromToday(4),
        daysFromToday(5),
        daysFromToday(6),
      ]);
      expect(
        await tx().attendanceSession.count({ where: { programId: world.programId } }),
      ).toBe(3);
    });

    /*
      Today is made but never removed. Its session may already hold check-ins measured against the
      clock it has, and a removal would destroy them.
    */
    it("but never removes today", async () => {
      const cleared = await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
        programId: world.programId,
        startsOn: null,
        endsOn: null,
        weekdays: [],
        startsAt: null,
      });

      expect(cleared.remove).not.toContain(today);
      expect(
        await tx().attendanceSession.count({
          where: { programId: world.programId, date: dateColumnFor(today) },
        }),
      ).toBe(1);
    });

    it("and clearing it leaves the program with no schedule", async () => {
      const program = await tx().program.findUniqueOrThrow({ where: { id: world.programId } });

      expect(program.attendanceStartsOn).toBeNull();
      expect(program.attendanceEndsOn).toBeNull();
      expect(program.attendanceStartsAt).toBeNull();
      expect(program.attendanceWeekdays).toEqual([]);
    });
  });

  describe("moving the start time partway through the year", () => {
    let world: World;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const caller = createCaller(tx(), world.instructorId);
      await caller.programs.setAttendanceSchedule(scheduleFor(world.programId, 3, "09:30"));
      await caller.programs.setAttendanceSchedule(scheduleFor(world.programId, 3, "10:00"));
    });

    it("makes and removes nothing, because the same days still meet", async () => {
      expect(
        await tx().attendanceSession.count({ where: { programId: world.programId } }),
      ).toBe(4);
    });

    // Today keeps the clock it ran under. Fellows may already have checked in against it, and the
    // rule that a recorded morning is never silently restated is why lateAfterMinutes is copied.
    it("leaves today's clock alone", async () => {
      const session = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(today) },
      });

      expect(session.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(today, "09:30").toISOString(),
      );
    });

    it("and moves every day after it", async () => {
      const sessions = await tx().attendanceSession.findMany({
        where: { programId: world.programId, date: { gt: dateColumnFor(today) } },
        orderBy: { date: "asc" },
      });

      expect(sessions).toHaveLength(3);
      for (const session of sessions) {
        const day = schoolDayFromColumn(session.date);
        expect(session.startedAt?.toISOString()).toBe(
          instantAtSchoolClock(day, "10:00").toISOString(),
        );
      }
    });

    // The codes are already printed and handed to the front desk. A code depends only on the
    // session's secret and its id, neither of which a clock change touches.
    it("without changing a single code", async () => {
      const session = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(2)) },
      });
      const before = codeFor(session);

      await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 3, "11:00"),
      );

      const after = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(2)) },
      });
      expect(codeFor(after)).toBe(before);
    });
  });

  /*
    The claim the whole diff exists to make good. A holiday an instructor deleted is a meeting day
    under both the old schedule and the new, so a later save has no opinion about it.
  */
  describe("a holiday somebody removed", () => {
    let world: World;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const caller = createCaller(tx(), world.instructorId);
      await caller.programs.setAttendanceSchedule(scheduleFor(world.programId, 6));

      const holiday = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(3)) },
      });
      await caller.attendance.deleteSession({ sessionId: holiday.id });
    });

    it("is not brought back by saving the schedule again", async () => {
      const again = await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
        scheduleFor(world.programId, 6, "10:00"),
      );

      expect(again.make).toEqual([]);
      expect(
        await tx().attendanceSession.count({
          where: { programId: world.programId, date: dateColumnFor(daysFromToday(3)) },
        }),
      ).toBe(0);
    });

    it("and the days either side of it are untouched", async () => {
      expect(
        await tx().attendanceSession.count({ where: { programId: world.programId } }),
      ).toBe(6);
    });
  });

  describe("a day somebody has already checked into", () => {
    let world: World;
    let shorter: { make: string[]; remove: string[]; blocked: string[] };

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const caller = createCaller(tx(), world.instructorId);
      await caller.programs.setAttendanceSchedule(scheduleFor(world.programId, 3));

      const ahead = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(2)) },
      });
      await tx().attendanceRecord.create({
        data: {
          sessionId: ahead.id,
          programId: world.programId,
          enrollmentId: world.students[0]!.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date(),
        },
      });

      shorter = await caller.programs.setAttendanceSchedule(scheduleFor(world.programId, 1));
    });

    it("is kept rather than destroyed", () => {
      expect(shorter.blocked).toEqual([daysFromToday(2)]);
    });

    it("and the days beside it still go", () => {
      expect(shorter.remove).toEqual([daysFromToday(3)]);
    });

    it("so the record a fellow made survives", async () => {
      const records = await tx().attendanceRecord.count({
        where: { programId: world.programId, source: "SELF_CHECK_IN" },
      });
      expect(records).toBe(1);
    });
  });

  describe("the preview above the button", () => {
    let world: World;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
    });

    it("counts what saving would do", async () => {
      const preview = await createCaller(
        tx(),
        world.instructorId,
      ).programs.attendanceSchedulePreview(scheduleFor(world.programId, 6));

      expect(preview.make).toHaveLength(7);
    });

    it("and writes nothing", async () => {
      expect(
        await tx().attendanceSession.count({ where: { programId: world.programId } }),
      ).toBe(0);
    });
  });

  describe("what it refuses", () => {
    let world: World;
    let outsiderId: string;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    });

    it("an instructor who does not instruct this program", async () => {
      const code = await refusal(() =>
        createCaller(tx(), outsiderId).programs.setAttendanceSchedule(
          scheduleFor(world.programId, 6),
        ),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a fellow on the roster", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.students[0]!.studentId).programs.setAttendanceSchedule(
          scheduleFor(world.programId, 6),
        ),
      );
      expect(code).toBe("FORBIDDEN");
    });

    // A mistyped year would otherwise build a list of a hundred thousand days.
    it("a range longer than two years", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).programs.setAttendanceSchedule(
          scheduleFor(world.programId, 900),
        ),
      );
      expect(code).not.toBe("accepted");
    });

    it("a last day before the first", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
          programId: world.programId,
          startsOn: daysFromToday(6),
          endsOn: today,
          weekdays: EVERY_DAY,
          startsAt: "09:30",
        }),
      );
      expect(code).not.toBe("accepted");
    });

    // Half a schedule is not a state this design has a name for: days to make and no clock.
    it("a schedule with no start time", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
          programId: world.programId,
          startsOn: today,
          endsOn: daysFromToday(6),
          weekdays: EVERY_DAY,
          startsAt: null,
        }),
      );
      expect(code).not.toBe("accepted");
    });

    it("a schedule with no weekdays", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
          programId: world.programId,
          startsOn: today,
          endsOn: daysFromToday(6),
          weekdays: [],
          startsAt: "09:30",
        }),
      );
      expect(code).not.toBe("accepted");
    });

    it("a start time that is not a clock time", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
          programId: world.programId,
          startsOn: today,
          endsOn: daysFromToday(6),
          weekdays: EVERY_DAY,
          startsAt: "9:30",
        }),
      );
      expect(code).not.toBe("accepted");
    });

    /*
      The database refuses half a schedule too, through `_schedule_is_whole`. It is not asserted
      here: a statement Postgres rejects aborts the whole transaction this group runs in, so the
      check would pass and then break every test after it. The constraint is defence against a
      future write path rather than against this procedure, which the refusals above cover.
    */
  });

  describe("the lateness rule, once days are already made", () => {
    let world: World;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const caller = createCaller(tx(), world.instructorId);
      await caller.programs.setAttendanceSchedule(scheduleFor(world.programId, 3));
      await caller.programs.setAttendanceLateAfter({ programId: world.programId, minutes: 20 });
    });

    /*
      Under a schedule the sessions for the rest of the term already exist, each holding a copy of
      this number. A change that only reached days made after it would never reach any of them.
    */
    it("reaches every day that has not begun", async () => {
      const ahead = await tx().attendanceSession.findMany({
        where: { programId: world.programId, date: { gt: dateColumnFor(today) } },
        select: { lateAfterMinutes: true },
      });

      expect(ahead).toHaveLength(3);
      expect(ahead.every((session) => session.lateAfterMinutes === 20)).toBe(true);
    });

    // Today ran under the old number and keeps it, which is the whole reason the column is copied.
    it("and leaves today under the rule it started with", async () => {
      const session = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(today) },
        select: { lateAfterMinutes: true },
      });

      expect(session.lateAfterMinutes).toBe(5);
    });
  });
});

/**
 * Making one day of a scheduled program by hand.
 *
 * The schedule makes the term's days in one act; these are the two ways a single day still gets
 * made afterwards — putting back a holiday that turned out not to be one, and an instructor
 * pressing Start on a program that has a schedule anyway.
 */
describe("making one day of a scheduled program", () => {
  const tx = withRollback(180_000);
  const today = schoolDayOf(new Date());

  function daysFromToday(count: number): string {
    const at = new Date(`${today}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  async function scheduledWorld() {
    const world = await makeWorld(tx(), { students: 2 });
    await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
      programId: world.programId,
      startsOn: today,
      endsOn: daysFromToday(6),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsAt: "09:30",
    });
    return world;
  }

  describe("putting back a day that was removed", () => {
    let world: World;
    let remade: { prepared: boolean; state: string; day: string };

    beforeAll(async () => {
      world = await scheduledWorld();
      const caller = createCaller(tx(), world.instructorId);

      const session = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(2)) },
      });
      await caller.attendance.deleteSession({ sessionId: session.id });

      remade = await caller.attendance.prepare({
        programId: world.programId,
        day: daysFromToday(2),
      });
    });

    it("makes it", () => {
      expect(remade.prepared).toBe(true);
      expect(remade.day).toBe(daysFromToday(2));
    });

    // Not pending. A program with a schedule has a clock to give every day it makes.
    it("with a clock rather than as a bare code", () => {
      expect(remade.state).toBe("scheduled");
    });

    it("and that clock is the schedule's, on that day", async () => {
      const row = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(2)) },
      });

      expect(row.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(daysFromToday(2), "09:30").toISOString(),
      );
    });
  });

  describe("what prepare refuses", () => {
    let scheduled: World;
    let plain: World;

    beforeAll(async () => {
      scheduled = await scheduledWorld();
      plain = await makeWorld(tx(), { students: 2 });
    });

    // A code made for a morning that has been and gone is useless; `start` writes those up.
    it("a day that has already happened", async () => {
      const code = await refusal(() =>
        createCaller(tx(), scheduled.instructorId).attendance.prepare({
          programId: scheduled.programId,
          day: daysFromToday(-1),
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    // Without a schedule there is no start time to give a day ahead, so the row could not be made.
    it("a day ahead, when the program has no schedule", async () => {
      const code = await refusal(() =>
        createCaller(tx(), plain.instructorId).attendance.prepare({
          programId: plain.programId,
          day: daysFromToday(2),
        }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("but still makes today's bare code for that program", async () => {
      const pending = await createCaller(tx(), plain.instructorId).attendance.prepare({
        programId: plain.programId,
      });
      expect(pending.state).toBe("pending");
    });
  });

  /*
    Pressing Start at 9:40 on a program whose class starts at 9:30 must not restart the clock:
    everybody who arrived at 9:35 would become on time and everybody at 9:31 would stop being late.
  */
  describe("pressing Start on a program that has a schedule", () => {
    let world: World;

    beforeAll(async () => {
      world = await scheduledWorld();
      const caller = createCaller(tx(), world.instructorId);

      const session = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(today) },
      });
      await caller.attendance.deleteSession({ sessionId: session.id });
      await caller.attendance.start({ programId: world.programId });
    });

    it("writes the scheduled time rather than this moment", async () => {
      const row = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(today) },
      });

      expect(row.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(today, "09:30").toISOString(),
      );
    });
  });
});

/**
 * Checking into a day that opens itself.
 *
 * Two things are asked here that the rest of the suite cannot ask. **Arriving before class is on
 * time**, which is the whole feature and was impossible while a session began when somebody
 * pressed a button. And **check-in is what closes the previous day's books**, which it has to be:
 * a scheduled program presses neither prepare nor start, and the grid is a pure read, so without
 * this nothing would ever write the absences a lapsed day leaves implicit.
 *
 * The clocks are moved by editing `startedAt`, which is exactly what an instructor correcting a
 * day does, so every row here is one the application could have produced.
 */
describe("checking into a day that opens itself", () => {
  const tx = withRollback(180_000);
  const today = schoolDayOf(new Date());

  function dayFromToday(count: number): string {
    const at = new Date(`${today}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  /** Move a session's start, and its backstop with it. */
  async function moveStartTo(sessionId: string, startedAt: Date) {
    await tx().attendanceSession.update({
      where: { id: sessionId },
      data: { startedAt, endsAt: defaultEndsAt(startedAt) },
    });
  }

  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000);

  describe("arriving before class", () => {
    let world: World;
    let checked: { status: string; checkedInAt: Date | null };

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const session = await createCaller(tx(), world.instructorId).attendance.start({
        programId: world.programId,
      });
      // Class is ninety minutes away, so the window has been open for half an hour.
      await moveStartTo(session.id, inMinutes(90));

      const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: session.id } });
      checked = await createCaller(tx(), world.students[0]!.studentId).attendance.checkIn({
        programId: world.programId,
        code: codeFor(row),
      });
    });

    it("is accepted", () => {
      expect(checked.checkedInAt).not.toBeNull();
    });

    // The rule already existed for instructors correcting a start time. It is the normal case now.
    it("and counts as present, not early and not late", () => {
      expect(checked.status).toBe("PRESENT");
    });
  });

  describe("arriving before the window opens", () => {
    let world: World;
    let sessionId: string;
    let code: string;
    let refused: string;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const session = await createCaller(tx(), world.instructorId).attendance.start({
        programId: world.programId,
      });
      sessionId = session.id;
      // Class is three hours away. The window opens two hours before it.
      await moveStartTo(sessionId, inMinutes(180));

      const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });
      code = codeFor(row);
      refused = await refusal(() =>
        createCaller(tx(), world.students[0]!.studentId).attendance.checkIn({
          programId: world.programId,
          code,
        }),
      );
    });

    it("is refused", () => {
      expect(refused).toBe("PRECONDITION_FAILED");
    });

    it("and records nothing", async () => {
      expect(await tx().attendanceRecord.count({ where: { sessionId } })).toBe(0);
    });

    /*
      A room typing the right code off a printed sheet forty minutes early are not guessing.
      Counting them against the twenty-per-session ceiling would lock out exactly the people who
      were paying attention.
    */
    it("and is not counted as a wrong code", async () => {
      const failures = await tx().auditEvent.count({
        where: { action: "ATTENDANCE_CHECK_IN_FAILED", programId: world.programId },
      });
      expect(failures).toBe(0);
    });

    /*
      The wording is the point, and it is why `scheduled` is a state of its own rather than a reuse
      of the closed branch. "Check-in closed on its own, ask your instructor to mark you in" is
      what a fellow forty minutes early used to be told: false, and it sends them to interrupt
      somebody over a problem that solves itself in forty minutes.
    */
    it("and is told when to come back rather than to find an instructor", async () => {
      const message = await refusalMessage(() =>
        createCaller(tx(), world.students[1]!.studentId).attendance.checkIn({
          programId: world.programId,
          code,
        }),
      );

      expect(message).toMatch(/opens at/i);
      expect(message).not.toMatch(/closed/i);
      expect(message).not.toMatch(/mark you in/i);
    });
  });

  describe("the first check-in of the morning", () => {
    let world: World;
    let staleId: string;

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const caller = createCaller(tx(), world.instructorId);

      const stale = await caller.attendance.start({
        programId: world.programId,
        day: dayFromToday(-1),
      });
      staleId = stale.id;

      const todaySession = await caller.attendance.start({ programId: world.programId });

      /*
        `start` sweeps as well, so undo what it did. What is being asked here is whether *check-in*
        closes the books, which is the only write a scheduled program performs on a normal morning.
      */
      await tx().attendanceSession.update({ where: { id: staleId }, data: { endedAt: null } });
      await tx().attendanceRecord.deleteMany({ where: { sessionId: staleId } });

      const row = await tx().attendanceSession.findUniqueOrThrow({
        where: { id: todaySession.id },
      });
      await createCaller(tx(), world.students[0]!.studentId).attendance.checkIn({
        programId: world.programId,
        code: codeFor(row),
      });
    });

    it("ends yesterday", async () => {
      const closed = await tx().attendanceSession.findUniqueOrThrow({ where: { id: staleId } });
      expect(closed.endedAt).not.toBeNull();
    });

    it("and writes an absence for everybody who missed it", async () => {
      const absences = await tx().attendanceRecord.count({
        where: { sessionId: staleId, status: "ABSENT", source: "FINALIZED" },
      });
      expect(absences).toBe(world.students.length);
    });

    it("and the next fellow through writes nothing more", async () => {
      const before = await tx().attendanceRecord.count();

      const row = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(today) },
      });
      await createCaller(tx(), world.students[1]!.studentId).attendance.checkIn({
        programId: world.programId,
        code: codeFor(row),
      });

      // Exactly one row: the second fellow's own. The sweep found nothing left to do.
      expect(await tx().attendanceRecord.count()).toBe(before + 1);
    });
  });
});

/**
 * What happened, and what is coming: two questions, two procedures.
 *
 * A scheduled program has a session row for every meeting day to June. `history` is what the term
 * grid, the drift list and the export are built from, and every one of them is about days that
 * have happened — so it stops at today rather than stretching a hundred and ninety empty columns
 * into next summer. `upcoming` answers the other half, per day rather than per fellow, for the two
 * screens that show no fellow at all.
 */
describe("the days ahead", () => {
  const tx = withRollback(180_000);
  const today = schoolDayOf(new Date());

  function daysFromToday(count: number): string {
    const at = new Date(`${today}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  async function scheduledWorld(lastDay = 6) {
    const world = await makeWorld(tx(), { students: 2 });
    await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
      programId: world.programId,
      startsOn: today,
      endsOn: daysFromToday(lastDay),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsAt: "09:30",
    });

    /*
      Today's class is three hours away, whatever hour of the day the suite runs at. The schedule
      writes today's row with a half past nine start and a backstop eight hours later, so a run
      after half past five in the afternoon would find today's session lapsed — and a lapsed day
      counts against every fellow who did not check into it, which is the arithmetic these checks
      are about. Moving a session's clock is what an instructor correcting a day does, so the row
      is one the application could have produced.
    */
    const startedAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await tx().attendanceSession.updateMany({
      where: { programId: world.programId, date: dateColumnFor(today) },
      data: { startedAt, endsAt: defaultEndsAt(startedAt) },
    });

    return world;
  }

  describe("reading them", () => {
    let world: World;

    beforeAll(async () => {
      world = await scheduledWorld();
    });

    it("history carries nothing ahead of today", async () => {
      const term = await createCaller(tx(), world.instructorId).attendance.history({
        programId: world.programId,
      });

      expect(term.sessions).toHaveLength(1);
      expect(term.sessions[0]!.day).toBe(today);
    });

    // The failure this guards: a term of days ahead counted as missed would put every fellow at
    // one seventh of their real rate the moment the schedule was saved.
    it("and every fellow's rate is unmoved by the days ahead", async () => {
      const term = await createCaller(tx(), world.instructorId).attendance.history({
        programId: world.programId,
      });

      expect(term.active.every((row) => row.eligible === 0)).toBe(true);
      expect(term.active.every((row) => row.rate === null)).toBe(true);
    });

    it("upcoming carries today and everything after it", async () => {
      const ahead = await createCaller(tx(), world.instructorId).attendance.upcoming({
        programId: world.programId,
      });

      expect(ahead.days).toHaveLength(7);
      expect(ahead.days[0]!.day).toBe(today);
      expect(ahead.days[6]!.day).toBe(daysFromToday(6));
    });

    it("with the program's name, so the printable sheet needs nothing else", async () => {
      const ahead = await createCaller(tx(), world.instructorId).attendance.upcoming({
        programId: world.programId,
      });

      expect(ahead.program.name).not.toBe("");
      expect(ahead.program.term).not.toBe("");
    });

    // Derived here rather than read back, so the sheet at the front desk and the fellow's phone
    // cannot disagree about what today's four digits are.
    it("and the code each day will actually accept", async () => {
      const ahead = await createCaller(tx(), world.instructorId).attendance.upcoming({
        programId: world.programId,
      });

      const row = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(3)) },
      });
      expect(ahead.days[3]!.code).toBe(codeFor(row));
    });

    it("and when that code starts working", async () => {
      const ahead = await createCaller(tx(), world.instructorId).attendance.upcoming({
        programId: world.programId,
      });

      expect(ahead.days[3]!.state).toBe("scheduled");
      expect(ahead.days[3]!.opensAt?.toISOString()).toBe(
        new Date(
          instantAtSchoolClock(daysFromToday(3), "09:30").getTime() - 120 * 60 * 1000,
        ).toISOString(),
      );
    });

    it("never the secret the code came from", async () => {
      const ahead = await createCaller(tx(), world.instructorId).attendance.upcoming({
        programId: world.programId,
      });
      expect(containsKey(ahead, "codeSecret")).toBe(false);
    });
  });

  describe("who may read them", () => {
    let world: World;
    let outsiderId: string;

    beforeAll(async () => {
      world = await scheduledWorld();
      outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    });

    it("not a fellow on the roster", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.students[0]!.studentId).attendance.upcoming({
          programId: world.programId,
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("and not an instructor of another program", async () => {
      const code = await refusal(() =>
        createCaller(tx(), outsiderId).attendance.upcoming({ programId: world.programId }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("removing a stretch of them", () => {
    let world: World;
    let removed: { removed: string[]; kept: string[] };

    beforeAll(async () => {
      world = await scheduledWorld();
      removed = await createCaller(tx(), world.instructorId).attendance.removeDays({
        programId: world.programId,
        from: daysFromToday(2),
        to: daysFromToday(4),
      });
    });

    it("takes every day between the two", () => {
      expect(removed.removed).toEqual([daysFromToday(2), daysFromToday(3), daysFromToday(4)]);
      expect(removed.kept).toEqual([]);
    });

    it("and leaves the rest standing", async () => {
      expect(
        await tx().attendanceSession.count({ where: { programId: world.programId } }),
      ).toBe(4);
    });

    it("writing one audit event that names them", async () => {
      const events = await tx().auditEvent.findMany({
        where: { action: "ATTENDANCE_SESSIONS_REMOVED", programId: world.programId },
      });

      expect(events).toHaveLength(1);
      expect((events[0]!.detail as { removed: string[] }).removed).toEqual([
        daysFromToday(2),
        daysFromToday(3),
        daysFromToday(4),
      ]);
    });
  });

  describe("what removing a stretch will not do", () => {
    let world: World;

    beforeAll(async () => {
      world = await scheduledWorld();
      const ahead = await tx().attendanceSession.findFirstOrThrow({
        where: { programId: world.programId, date: dateColumnFor(daysFromToday(3)) },
      });
      await tx().attendanceRecord.create({
        data: {
          sessionId: ahead.id,
          programId: world.programId,
          enrollmentId: world.students[0]!.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date(),
        },
      });
    });

    it("destroy a day somebody checked into, and it says which", async () => {
      const removed = await createCaller(tx(), world.instructorId).attendance.removeDays({
        programId: world.programId,
        from: daysFromToday(2),
        to: daysFromToday(4),
      });

      expect(removed.removed).toEqual([daysFromToday(2), daysFromToday(4)]);
      expect(removed.kept).toEqual([daysFromToday(3)]);
    });

    // A day behind today is the record the whole feature exists to keep.
    it("touch a day that has already happened", async () => {
      await createCaller(tx(), world.instructorId).attendance.start({
        programId: world.programId,
        day: daysFromToday(-2),
      });

      const removed = await createCaller(tx(), world.instructorId).attendance.removeDays({
        programId: world.programId,
        from: daysFromToday(-5),
        to: daysFromToday(-1),
      });

      expect(removed.removed).toEqual([]);
      expect(
        await tx().attendanceSession.count({
          where: { programId: world.programId, date: dateColumnFor(daysFromToday(-2)) },
        }),
      ).toBe(1);
    });

    it("or accept a stretch that runs backwards", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).attendance.removeDays({
          programId: world.programId,
          from: daysFromToday(4),
          to: daysFromToday(2),
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("or let a fellow call it", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.students[0]!.studentId).attendance.removeDays({
          programId: world.programId,
          from: daysFromToday(5),
          to: daysFromToday(6),
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });
});

/**
 * What an instructor may do to a day before its check-in opens.
 *
 * The two answers differ, and the difference is the point. **Ending is refused**, because ending
 * writes an ABSENT row for every active fellow and none of them could have checked in yet.
 * **Setting a status is allowed**, because unlike a prepared session a scheduled day is never
 * deleted by the sweep, so a record written on one is safe.
 */
describe("acting on a day that has not opened", () => {
  const tx = withRollback(180_000);

  let world: World;
  let sessionId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const session = await createCaller(tx(), world.instructorId).attendance.start({
      programId: world.programId,
    });
    sessionId = session.id;

    // Class is three hours away, so the window has not opened.
    const startedAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await tx().attendanceSession.update({
      where: { id: sessionId },
      data: { startedAt, endsAt: defaultEndsAt(startedAt) },
    });
  });

  it("ending it is refused", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).attendance.endSession({ sessionId }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });

  // The cost of getting this wrong is a day of absences in a report, against a roster that had
  // done nothing but turn up on time.
  it("and marks nobody absent", async () => {
    expect(await tx().attendanceRecord.count({ where: { sessionId } })).toBe(0);
  });

  it("and it points at removing the day instead", async () => {
    const message = await refusalMessage(() =>
      createCaller(tx(), world.instructorId).attendance.endSession({ sessionId }),
    );
    expect(message).toMatch(/remove the day/i);
  });

  // Excusing somebody for a day next week is a real thing an instructor wants to do.
  it("but a status can still be set on it", async () => {
    const set = await createCaller(tx(), world.instructorId).attendance.setStatus({
      sessionId,
      enrollmentId: world.students[0]!.id,
      status: "EXCUSED",
      note: "Hospital appointment",
    });

    expect(set.status).toBe("EXCUSED");
  });
});

/**
 * The code of a day that has not opened yet.
 *
 * **A scheduled day holds a code from the moment its row exists**, derived from the row's own
 * secret, and every screen that puts a code in front of a room has to be able to read it before
 * check-in opens — that is what the whole prepared phase was invented for, and a scheduled day is
 * the same case arriving by a different route. What the state decides is whether typing the code
 * would be *accepted*, which is `checkIn`'s question and not `sessionCode`'s.
 */
describe("reading the code of a day still to come", () => {
  const tx = withRollback(180_000);
  const today = schoolDayOf(new Date());

  let world: World;
  let sessionId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const session = await createCaller(tx(), world.instructorId).attendance.start({
      programId: world.programId,
    });
    sessionId = session.id;

    // Class is three hours away, so the window has not opened and the state is `scheduled`.
    const startedAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await tx().attendanceSession.update({
      where: { id: sessionId },
      data: { startedAt, endsAt: defaultEndsAt(startedAt) },
    });
  });

  /*
    The failure this guards against: the day screen's code card and the projector are both told to
    render for a scheduled day, so when this returned null they drew four dashes. A projector
    showing dashes while the room fills is the exact thing the code is on screen to prevent.
  */
  it("the instructor's screens are given the digits", async () => {
    const view = await createCaller(tx(), world.instructorId).attendance.sessionCode({ sessionId });

    expect(view.session.state).toBe("scheduled");
    expect(view.code).not.toBeNull();
  });

  it("and they are the digits that day will accept", async () => {
    const view = await createCaller(tx(), world.instructorId).attendance.sessionCode({ sessionId });
    const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });

    expect(view.code).toBe(codeFor(row));
  });

  it("without the secret they came from", async () => {
    const view = await createCaller(tx(), world.instructorId).attendance.sessionCode({ sessionId });
    expect(containsKey(view, "codeSecret")).toBe(false);
  });

  // Holding the code has never been enough. The window is what admits anybody.
  it("and holding them is still not enough to check in yet", async () => {
    const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });
    const code = await refusal(() =>
      createCaller(tx(), world.students[0]!.studentId).attendance.checkIn({
        programId: world.programId,
        code: codeFor(row),
      }),
    );

    expect(code).toBe("PRECONDITION_FAILED");
  });

  it("and a fellow cannot read them at all", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.students[0]!.studentId).attendance.sessionCode({ sessionId }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  /*
    The button the calendar and the day screen offer on a blank square. It is refused in the past,
    which is why neither screen offers it there — a day that has been and gone is written up with
    `start`, not given a code nobody can use.
  */
  it("a day already behind cannot be made this way", async () => {
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).attendance.prepare({
        programId: world.programId,
        day: yesterday.toISOString().slice(0, 10),
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });
});

/**
 * Correcting the clock of one day, without touching the schedule behind it.
 *
 * **The schedule says when the program meets; this says what happened on Tuesday.** Those are two
 * different statements and conflating them costs the same thing every time: rewriting the schedule
 * to move one morning moves every morning after it, and a term of recorded days is not a thing an
 * instructor should have to risk in order to say that yesterday's class started at eleven.
 *
 * Three fields, because a day has three facts an instructor can be wrong about — when it started,
 * when its code stopped working, and how long counts as on time — and correcting one of them
 * without the others is the common case. `startedAt` and `lateAfterMinutes` together decide who was
 * late, so moving either recomputes every self check-in; `endsAt` decides only whether the code
 * still works, so moving it recomputes nothing and the checks below say so in both directions.
 */
describe("correcting a day's clock", () => {
  const tx = withRollback(180_000);
  const today = schoolDayOf(new Date());

  function daysFromToday(count: number): string {
    const at = new Date(`${today}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + count);
    return at.toISOString().slice(0, 10);
  }

  /** A program that meets every day this week at half past nine. */
  async function scheduledWorld(): Promise<World> {
    const world = await makeWorld(tx(), { students: 2 });
    await createCaller(tx(), world.instructorId).programs.setAttendanceSchedule({
      programId: world.programId,
      startsOn: today,
      endsOn: daysFromToday(6),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsAt: "09:30",
    });
    return world;
  }

  const sessionOn = async (programId: string, day: string) =>
    tx().attendanceSession.findFirstOrThrow({
      where: { programId, date: dateColumnFor(day) },
    });

  /**
   * A day the schedule has made and nobody has reached yet.
   *
   * The case this was built for: the schedule says half past nine, tomorrow's class starts at half
   * past ten, and the instructor knows that today. Moving the program's start time instead would
   * move every remaining day of the term.
   */
  describe("a day still to come", () => {
    let world: World;
    let tomorrow: string;

    beforeAll(async () => {
      world = await scheduledWorld();
      tomorrow = daysFromToday(1);

      await createCaller(tx(), world.instructorId).attendance.updateSession({
        sessionId: (await sessionOn(world.programId, tomorrow)).id,
        startedAt: instantAtSchoolClock(tomorrow, "10:30"),
        endsAt: instantAtSchoolClock(tomorrow, "16:00"),
      });
    });

    it("starts when the instructor said rather than when the schedule did", async () => {
      const row = await sessionOn(world.programId, tomorrow);
      expect(row.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(tomorrow, "10:30").toISOString(),
      );
    });

    it("and its code stops working when they said", async () => {
      const row = await sessionOn(world.programId, tomorrow);
      expect(row.endsAt?.toISOString()).toBe(instantAtSchoolClock(tomorrow, "16:00").toISOString());
    });

    // The whole reason this is a day's correction rather than a schedule edit.
    it("while every other day of the term keeps the schedule's clock", async () => {
      const row = await sessionOn(world.programId, daysFromToday(2));
      expect(row.startedAt?.toISOString()).toBe(
        instantAtSchoolClock(daysFromToday(2), "09:30").toISOString(),
      );
    });

    it("and the audit event says what the closing time was before", async () => {
      const event = await tx().auditEvent.findFirstOrThrow({
        where: { action: "ATTENDANCE_SESSION_UPDATED", programId: world.programId },
        orderBy: { occurredAt: "desc" },
        select: { detail: true },
      });

      const detail = event.detail as { endsAt: [string, string] | null };
      expect(detail.endsAt?.[0]).toBe(
        defaultEndsAt(instantAtSchoolClock(tomorrow, "09:30")).toISOString(),
      );
    });
  });

  /**
   * A morning that lapsed before anybody took it.
   *
   * A schedule saved in the evening makes today with a nine thirty start and a backstop eight hours
   * later, so the day exists and its code never worked. Writing it up is the same correction the
   * group above makes, pointed at a day that has already been.
   */
  describe("a day that lapsed before anybody used it", () => {
    let world: World;
    let sessionId: string;

    beforeAll(async () => {
      world = await scheduledWorld();
      const session = await sessionOn(world.programId, today);
      sessionId = session.id;

      // The state a schedule saved in the evening leaves behind: started this morning, closed by
      // its own backstop, nobody through the door.
      await tx().attendanceSession.update({
        where: { id: sessionId },
        data: {
          startedAt: new Date(Date.now() - (DEFAULT_SESSION_MINUTES + 60) * 60 * 1000),
          endsAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });

      // Two minutes ago, which is inside the default five-minute threshold: a fellow arriving now
      // is on time against the clock the instructor has just written, not against the one the
      // schedule gave the morning.
      await createCaller(tx(), world.instructorId).attendance.updateSession({
        sessionId,
        startedAt: new Date(Date.now() - 2 * 60 * 1000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    });

    it("takes check-ins again once its window covers now", async () => {
      const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });
      const checked = await createCaller(
        tx(),
        world.students[0]!.studentId,
      ).attendance.checkIn({ programId: world.programId, code: codeFor(row) });

      expect(checked.status).toBe("PRESENT");
    });
  });

  describe("what it will not accept", () => {
    let world: World;
    let sessionId: string;

    beforeAll(async () => {
      world = await scheduledWorld();
      sessionId = (await sessionOn(world.programId, daysFromToday(1))).id;
    });

    it("a closing time before the day starts", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).attendance.updateSession({
          sessionId,
          endsAt: instantAtSchoolClock(daysFromToday(1), "08:00"),
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("or a closing time at the very moment it starts", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).attendance.updateSession({
          sessionId,
          startedAt: instantAtSchoolClock(daysFromToday(1), "09:30"),
          endsAt: instantAtSchoolClock(daysFromToday(1), "09:30"),
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("and a fellow may not move anybody's clock", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.students[0]!.studentId).attendance.updateSession({
          sessionId,
          endsAt: instantAtSchoolClock(daysFromToday(1), "16:00"),
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("neither of which left the day changed", async () => {
      const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(row.endsAt?.toISOString()).toBe(
        defaultEndsAt(instantAtSchoolClock(daysFromToday(1), "09:30")).toISOString(),
      );
    });
  });

  /**
   * Which of the three fields touch a record that already exists.
   *
   * Lateness is measured from the start against the threshold, so those two recompute every self
   * check-in. The backstop is not in that arithmetic at all, and a day whose closing time moves
   * must not quietly restate who was on time.
   */
  describe("what moving the backstop does to the rows", () => {
    let world: World;
    let sessionId: string;
    let moved: { recomputed: number };

    beforeAll(async () => {
      world = await makeWorld(tx(), { students: 2 });
      const session = await createCaller(tx(), world.instructorId).attendance.start({
        programId: world.programId,
      });
      sessionId = session.id;

      const row = await tx().attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });
      await createCaller(tx(), world.students[0]!.studentId).attendance.checkIn({
        programId: world.programId,
        code: codeFor(row),
      });

      moved = await createCaller(tx(), world.instructorId).attendance.updateSession({
        sessionId,
        endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });
    });

    it("recomputes nothing", () => {
      expect(moved.recomputed).toBe(0);
    });

    it("and the fellow who was on time still is", async () => {
      const record = await tx().attendanceRecord.findFirstOrThrow({
        where: { sessionId, enrollmentId: world.students[0]!.id },
        select: { status: true },
      });
      expect(record.status).toBe("PRESENT");
    });
  });
});
