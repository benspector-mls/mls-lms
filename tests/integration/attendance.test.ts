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
import { DEFAULT_SESSION_MINUTES } from "@/lib/attendance/window";
import {
  dateColumnFor,
  formatClockMinutes,
  minutesAfterMidnight,
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
      originalStartedAt = row.startedAt;
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
      expect(await tx().attendanceRecord.count({ where: { sessionId, source: "INSTRUCTOR" } })).toBe(
        instructorBefore,
      );
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
      Awaited<ReturnType<ReturnType<typeof asInstructor>["attendance"]["history"]>>["arrivals"][string]
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
