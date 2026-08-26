import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auditActor } from "@/lib/audit/record";
import { recordEvent } from "@/lib/audit/record";
import { assertWithinRate, type RateLimit } from "@/lib/audit/rate-limit";
import { arrivalAverages, type Arrival } from "@/lib/attendance/arrival";
import { codeFor, codeMatches, newSessionSecret, type CodeSession } from "@/lib/attendance/code";
import { weekColumns, weekRange } from "@/lib/attendance/calendar";
import { gridCounts, gridRows, type GridEnrollment, type GridRecord } from "@/lib/attendance/grid";
import { summarize, type SummaryFellow, type SummaryRecord } from "@/lib/attendance/summary";
import {
  defaultEndsAt,
  extendedEndsAt,
  isAcceptingCheckIns,
  sessionStateOf,
  statusForCheckIn,
  type WindowSession,
} from "@/lib/attendance/window";
import {
  assertActiveInProgram,
  assertProgramMember,
  enrollmentsIn,
} from "@/lib/courses/membership";
import { teachableAttendanceSession } from "@/lib/courses/scope";
import { displayNameOf } from "@/lib/people";
import { inTransaction, type Tx } from "@/lib/prisma";
import {
  dateColumnFor,
  schoolDayFromColumn,
  schoolDayOf,
  schoolDaySchema,
  type SchoolDay,
} from "@/lib/school-time";
import { createTRPCRouter, programProcedure, instructorProcedure, profileProcedure } from "../init";
import { personSelect, personNameSelect } from "../selects";

/**
 * Who was here, and who said so.
 *
 * **Both halves in one file**, the way `enrollments.ts` holds the instructor's roster beside the
 * student's join. The fellow's side and the instructor's side have to agree about exactly one
 * thing — whether check-in is open — and two routers is how that comes to be answered twice.
 *
 * **Every time rule is a comparison and nothing is scheduled.** A session closes on its
 * ninety-minute backstop the way a due date passes: nothing runs, the answer changes. The rows
 * recording who was absent are written by whoever next comes through — the instructor pressing
 * end, or `start` sweeping yesterday. That is why `finalize` below is called from three places
 * and is idempotent in all of them.
 *
 * **What is guarded, and by what.** Instructor procedures whose input names a course use
 * `programProcedure`; the ones naming a session use `teachableAttendanceSession`, which loads and
 * authorizes in one query. The fellow's use `assertActiveStudent`, except reading their own
 * history, which uses `assertCourseMember` so a removed fellow keeps their record for the same
 * reason they keep their feedback.
 */

/**
 * How many wrong codes one person may try in ten minutes.
 *
 * Ten is far above an honest morning — a mistype, a retry, a digit misheard across a room, another
 * retry — and it exists to stop a script rather than a fellow. Counted out of `audit_events` for
 * the reason `lib/audit/rate-limit.ts` gives, over the index that is already there.
 */
const CHECK_IN_ATTEMPT_LIMIT: RateLimit = { max: 10, windowMinutes: 10 };

/**
 * How many wrong codes one person may try within one session, however long it runs.
 *
 * **This is the ceiling four digits makes necessary, and it is the only thing bounding a guess.**
 * Ten thousand codes with one live code means one guess in ten thousand lands, and the ten-minute
 * limit alone would allow ninety attempts across a ninety-minute session — close to one percent,
 * which is small but not nothing when what it buys is a paid day. Twenty caps the whole session at
 * two in a thousand, and it costs one more count over rows the other limit already reads.
 *
 * Worth being exact about, because it is the claim a fixed code is most likely to be doubted on:
 * rotation never contributed to this. It bounded how long a code could be *passed on*, not how many
 * times one could be *tried*, and by accepting the previous code as well it doubled the live surface
 * that this ceiling is measured against.
 */
const CHECK_IN_SESSION_ATTEMPTS = 20;

/** The columns every read of a session needs, minus the one nothing may return. */
const sessionSelect = {
  id: true,
  programId: true,
  date: true,
  startedAt: true,
  endsAt: true,
  endedAt: true,
  lateAfterMinutes: true,
  note: true,
  startedBy: { select: personNameSelect },
} as const;

/** Everything above plus the secret. Only the two procedures that derive a code select this. */
const sessionWithSecretSelect = { ...sessionSelect, codeSecret: true } as const;

type SessionRow = {
  id: string;
  programId: string;
  date: Date;
  startedAt: Date;
  endsAt: Date;
  endedAt: Date | null;
  lateAfterMinutes: number;
  note: string | null;
  startedBy: {
    displayName: string | null;
    email: string | null;
    githubUsername: string | null;
  } | null;
};

/**
 * A session as it crosses the wire.
 *
 * **`date` becomes a string here and nowhere else.** Prisma hands a `@db.Date` back as a `Date` at
 * UTC midnight, which a browser in Brooklyn renders as the previous day — so the conversion
 * happens once, at the boundary, and no payload carries the dangerous shape. See
 * `lib/school-time.ts`.
 */
function publicSession(session: SessionRow, now: Date) {
  return {
    id: session.id,
    day: schoolDayFromColumn(session.date),
    startedAt: session.startedAt,
    endsAt: session.endsAt,
    endedAt: session.endedAt,
    lateAfterMinutes: session.lateAfterMinutes,
    note: session.note,
    startedByName: session.startedBy ? displayNameOf(session.startedBy, "an instructor") : null,
    state: sessionStateOf(session, now),
  };
}

/**
 * Write the absences a session left implicit, and record that it happened.
 *
 * Called when an instructor ends a session, and again by `start` for any older session of the same
 * program that nobody ended. **Idempotent through `@@unique([sessionId, enrollmentId])`** —
 * `skipDuplicates` lets the constraint decide who already had a row, so running it twice writes
 * nothing the second time and a fellow who checked in is never overwritten.
 *
 * Only active enrollments. A fellow removed before this morning is not absent from it; they are
 * not expected at it, which is a different fact and not one to write down.
 */
async function finalize(tx: Tx, session: { id: string; programId: string }, endedAt: Date) {
  const enrollments = await tx.enrollment.findMany({
    where: { programId: session.programId, status: "ACTIVE" },
    select: { id: true },
  });

  const written = await tx.attendanceRecord.createMany({
    data: enrollments.map((enrollment) => ({
      sessionId: session.id,
      programId: session.programId,
      enrollmentId: enrollment.id,
      status: "ABSENT" as const,
      source: "FINALIZED" as const,
    })),
    skipDuplicates: true,
  });

  await tx.attendanceSession.update({
    where: { id: session.id },
    data: { endedAt },
    select: { id: true },
  });

  return written.count;
}

/** The refusal a fellow meets when check-in is not open, worded by which of the two it is. */
function refuseClosed(session: WindowSession, courseName: string, now: Date): never {
  const state = sessionStateOf(session, now);

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      state === "ended"
        ? `Check-in for ${courseName} has closed. Ask your instructor to mark you in.`
        : `Check-in for ${courseName} closed on its own. Ask your instructor to mark you in.`,
  });
}

export const attendanceRouter = createTRPCRouter({
  // =====================================================================================
  // The instructor's side.
  // =====================================================================================

  /**
   * Open check-in for today, or hand back the one that is already open.
   *
   * **Idempotent by catching the constraint rather than by looking first.** Two instructors
   * pressing the button in the same second both find nothing and both insert; one loses on
   * `@@unique([courseId, date])`. Checking first would narrow that window rather than close it,
   * and the loser would get a second session with a different code — which is the failure mode
   * that matters, because the room would then be reading one code while the server accepted
   * another. `started: false` is the same shape `enrollments.join` returns for the same reason.
   *
   * It also sweeps: any older session of this course that nobody ended is ended and finalized in
   * this transaction. Tomorrow's attendance closes yesterday's books, so nobody has to remember —
   * and the ninety-minute backstop means the code was already dead long before this ran.
   */
  start: programProcedure
    .input(
      z.object({
        /** Defaults to today. Given only when writing up a session after the fact. */
        day: schoolDaySchema.optional(),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const today = schoolDayOf(now);
      const day = input.day ?? today;

      if (day > today) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attendance can only be taken for today or a day that has already happened.",
        });
      }

      const program = await ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: { id: true, name: true, archivedAt: true, attendanceLateAfterMinutes: true },
      });

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} has finished, so attendance cannot be taken in it.`,
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        const stale = await tx.attendanceSession.findMany({
          where: { programId: program.id, endedAt: null, date: { lt: dateColumnFor(day) } },
          select: { id: true, programId: true, date: true },
        });

        const swept: SchoolDay[] = [];
        for (const session of stale) {
          // Ended at its own backstop rather than at this moment: that is when it actually
          // stopped accepting anybody, and dating it now would put an evening timestamp on a
          // morning nobody attended after 10:30.
          const row = await tx.attendanceSession.findUniqueOrThrow({
            where: { id: session.id },
            select: { endsAt: true },
          });
          await finalize(tx, session, row.endsAt);
          swept.push(schoolDayFromColumn(session.date));
        }

        /*
          `createMany` with `skipDuplicates` rather than `create` in a try/catch, and the
          difference is not stylistic. Catching P2002 does not work here: in Postgres a failed
          statement aborts the whole transaction, so every command after the violation — including
          the read that was meant to recover from it — fails with 25P02. `skipDuplicates` compiles
          to `ON CONFLICT DO NOTHING`, which never raises, so the race is still settled by the
          unique index and the transaction survives it.

          The returned count is what says who won: one row inserted means this call created the
          session, zero means somebody else already had.
        */
        const inserted = await tx.attendanceSession.createMany({
          data: [
            {
              programId: program.id,
              date: dateColumnFor(day),
              startedAt: now,
              endsAt: defaultEndsAt(now),
              lateAfterMinutes: program.attendanceLateAfterMinutes,
              codeSecret: newSessionSecret(),
              startedById: ctx.profile.id,
              note: input.note ?? null,
            },
          ],
          skipDuplicates: true,
        });

        const started = inserted.count === 1;

        const session: SessionRow = await tx.attendanceSession.findUniqueOrThrow({
          where: { programId_date: { programId: program.id, date: dateColumnFor(day) } },
          select: sessionSelect,
        });

        if (started) {
          await recordEvent(tx, {
            action: "ATTENDANCE_SESSION_STARTED",
            actor: auditActor(ctx),
            subject: { id: session.id, label: day },
            program: { id: program.id, label: program.name },
            detail: {
              day,
              startedAt: now.toISOString(),
              endsAt: session.endsAt.toISOString(),
              lateAfterMinutes: session.lateAfterMinutes,
              sweptOpenSessions: swept,
            },
          });
        }

        return { ...publicSession(session, now), started, swept };
      });
    }),

  /**
   * This session's code, for the instructor to give out.
   *
   * The only procedure besides `checkIn` that reads `codeSecret`, and the only one that returns
   * anything derived from it. Instructor-only through the loader — a student reaching this would
   * make every other guard in the file pointless.
   *
   * **Read by two screens and for two different purposes.** The projector window puts it in front of
   * a room; the attendance screen puts it beside a Copy button, which is what an instructor sharing
   * a single application window into Zoom actually needs — the code has to be *distributable*, and
   * only sometimes needs to be *displayed*.
   *
   * Null while the session is closed rather than absent from the payload, so both callers can say
   * "check-in is closed" from the same shape.
   */
  sessionCode: instructorProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        ...sessionWithSecretSelect,
        program: { select: { id: true, name: true } },
      });

      const open = sessionStateOf(session, now) === "open";

      const [checkedIn, expected] = await Promise.all([
        ctx.db.attendanceRecord.count({
          where: { sessionId: session.id, source: "SELF_CHECK_IN" },
        }),
        ctx.db.enrollment.count({ where: { programId: session.programId, status: "ACTIVE" } }),
      ]);

      return {
        session: publicSession(session, now),
        courseName: session.program.name,
        code: open ? codeFor(session as CodeSession) : null,
        checkedIn,
        expected,
      };
    }),

  /**
   * One session's roster, with what each fellow did attached.
   *
   * **Every fellow, whether or not they have a record**, which is why the roster comes from
   * `enrollmentsIn` and never from the records — see `lib/attendance/grid.ts`. Passing `day` reads
   * a past session; passing nothing reads today, and returns a null session when nobody started
   * one, which is what the screen turns into the Start button.
   *
   * **No cohort filter, deliberately.** `resolveCohort` falls back to an instructor's *remembered*
   * grading filter, so somebody who narrowed the gradebook last Tuesday would open the morning board
   * to "11 of 15" — a count that is wrong about the room while looking entirely correct. Attendance
   * is taken for everybody in the room, so it reads everybody.
   */
  grid: programProcedure
    .input(z.object({ day: schoolDaySchema.optional() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const day = input.day ?? schoolDayOf(now);

      const [program, session, enrollments] = await Promise.all([
        ctx.db.program.findUniqueOrThrow({
          where: { id: input.programId },
          select: { id: true, name: true, archivedAt: true, attendanceLateAfterMinutes: true },
        }),
        ctx.db.attendanceSession.findUnique({
          where: { programId_date: { programId: input.programId, date: dateColumnFor(day) } },
          select: sessionSelect,
        }),
        ctx.db.enrollment.findMany({
          where: { ...enrollmentsIn(input.programId), status: "ACTIVE" },
          select: { id: true, student: { select: personSelect } },
        }),
      ]);

      const records = session
        ? await ctx.db.attendanceRecord.findMany({
            where: { sessionId: session.id },
            select: {
              enrollmentId: true,
              status: true,
              source: true,
              checkedInAt: true,
              note: true,
              recordedBy: { select: personNameSelect },
            },
          })
        : [];

      const roster: GridEnrollment[] = enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        student: enrollment.student,
      }));

      const attached: GridRecord[] = records.map((record) => ({
        enrollmentId: record.enrollmentId,
        status: record.status,
        source: record.source,
        checkedInAt: record.checkedInAt,
        note: record.note,
        recordedByName: record.recordedBy
          ? displayNameOf(record.recordedBy, "an instructor")
          : null,
      }));

      const rows = gridRows(roster, attached, session, now);

      return {
        program: { id: program.id, name: program.name, archived: program.archivedAt !== null },
        day,
        isToday: day === schoolDayOf(now),
        session: session ? publicSession(session, now) : null,
        rows,
        counts: gridCounts(rows),
      };
    }),

  /**
   * Set or change one fellow's status by hand.
   *
   * The composite foreign key on `(enrollmentId, courseId)` is what makes naming another cohort's
   * enrollment impossible rather than merely refused; the check below exists to say so in words
   * before the database says it in an error code.
   *
   * `checkedInAt` is deliberately left alone. An instructor calling a 9:07 arrival PRESENT should
   * leave a row saying both when they arrived and what was decided about it — that pair is what
   * makes `updateSession`'s recomputation possible later.
   */
  setStatus: instructorProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        enrollmentId: z.string().uuid(),
        status: z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        id: true,
        programId: true,
        date: true,
        program: { select: { name: true } },
      });

      const enrollment = await ctx.db.enrollment.findFirst({
        where: { id: input.enrollmentId, programId: session.programId },
        select: { id: true, student: { select: { id: true, ...personNameSelect } } },
      });

      if (!enrollment) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That fellow is not on this program's roster.",
        });
      }

      const day = schoolDayFromColumn(session.date);

      return inTransaction(ctx.db, async (tx) => {
        const before = await tx.attendanceRecord.findUnique({
          where: {
            sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id },
          },
          select: { status: true, source: true, checkedInAt: true },
        });

        const record = await tx.attendanceRecord.upsert({
          where: {
            sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id },
          },
          create: {
            sessionId: session.id,
            programId: session.programId,
            enrollmentId: enrollment.id,
            status: input.status,
            source: "INSTRUCTOR",
            recordedById: ctx.profile.id,
            note: input.note ?? null,
          },
          update: {
            status: input.status,
            source: "INSTRUCTOR",
            recordedById: ctx.profile.id,
            note: input.note ?? null,
          },
          select: { id: true, status: true, source: true, checkedInAt: true, note: true },
        });

        await recordEvent(tx, {
          action: "ATTENDANCE_STATUS_SET",
          actor: auditActor(ctx),
          subject: {
            id: enrollment.student.id,
            label: displayNameOf(enrollment.student, "a student"),
          },
          program: { id: session.programId, label: session.program.name },
          detail: {
            day,
            from: before?.status ?? null,
            to: input.status,
            hadSelfCheckIn: before?.source === "SELF_CHECK_IN",
            checkedInAt: before?.checkedInAt?.toISOString() ?? null,
            note: input.note ?? null,
          },
        });

        return record;
      });
    }),

  /**
   * Correct a session's start time, its lateness threshold, or its note.
   *
   * **Self check-ins are recomputed; instructor decisions are not.** An instructor who pressed
   * start five minutes early has a cohort wrongly marked late, and moving `startedAt` should fix
   * all of them at once. But a status a person set is a decision made about a person, and quietly
   * reverting it because a threshold moved is the worst outcome available here — so those rows are
   * left exactly as they are, and the count of what changed comes back so the screen can say.
   */
  updateSession: instructorProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        startedAt: z.coerce.date().optional(),
        lateAfterMinutes: z.number().int().min(0).max(1440).optional(),
        note: z.string().trim().max(200).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        ...sessionSelect,
        program: { select: { name: true } },
      });

      const startedAt = input.startedAt ?? session.startedAt;
      const lateAfterMinutes = input.lateAfterMinutes ?? session.lateAfterMinutes;

      if (startedAt.getTime() >= session.endsAt.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Check-in cannot start after it ends. Extend the session first.",
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        const updated = await tx.attendanceSession.update({
          where: { id: session.id },
          data: {
            startedAt,
            lateAfterMinutes,
            note: input.note === undefined ? undefined : input.note,
          },
          select: sessionSelect,
        });

        const selfRecorded = await tx.attendanceRecord.findMany({
          where: { sessionId: session.id, source: "SELF_CHECK_IN" },
          select: { id: true, status: true, checkedInAt: true },
        });

        let recomputed = 0;
        for (const record of selfRecorded) {
          // The CHECK constraint guarantees a self check-in has a time; the guard is for the
          // type, not for the data.
          if (!record.checkedInAt) continue;

          const status = statusForCheckIn(updated, record.checkedInAt);
          if (status === record.status) continue;

          await tx.attendanceRecord.update({
            where: { id: record.id },
            data: { status },
            select: { id: true },
          });
          recomputed += 1;
        }

        await recordEvent(tx, {
          action: "ATTENDANCE_SESSION_UPDATED",
          actor: auditActor(ctx),
          subject: { id: session.id, label: schoolDayFromColumn(session.date) },
          program: { id: session.programId, label: session.program.name },
          detail: {
            day: schoolDayFromColumn(session.date),
            startedAt:
              input.startedAt && input.startedAt.getTime() !== session.startedAt.getTime()
                ? [session.startedAt.toISOString(), startedAt.toISOString()]
                : null,
            lateAfterMinutes:
              lateAfterMinutes !== session.lateAfterMinutes
                ? [session.lateAfterMinutes, lateAfterMinutes]
                : null,
            recomputed,
          },
        });

        return { session: publicSession(updated, new Date()), recomputed };
      });
    }),

  /**
   * Buy another half hour before the backstop.
   *
   * Refused on a session a person ended, which is `reopen`'s job and means something different —
   * one says class is running long, the other says it was closed too soon.
   */
  extend: instructorProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        ...sessionSelect,
        program: { select: { name: true } },
      });

      if (session.endedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This session was ended. Reopen it instead, which puts it back into check-in.",
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        const updated = await tx.attendanceSession.update({
          where: { id: session.id },
          data: { endsAt: extendedEndsAt(session, now) },
          select: sessionSelect,
        });

        await recordEvent(tx, {
          action: "ATTENDANCE_SESSION_UPDATED",
          actor: auditActor(ctx),
          subject: { id: session.id, label: schoolDayFromColumn(session.date) },
          program: { id: session.programId, label: session.program.name },
          detail: {
            day: schoolDayFromColumn(session.date),
            extended: true,
            endsAt: [session.endsAt.toISOString(), updated.endsAt.toISOString()],
          },
        });

        return publicSession(updated, now);
      });
    }),

  /**
   * End check-in and write down who was not here.
   *
   * One act rather than a close and a separate finalize, because a second step is a step somebody
   * forgets and this one is what turns an absence into a record. Idempotent: ending an ended
   * session returns it, having written nothing.
   */
  endSession: instructorProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        ...sessionSelect,
        program: { select: { name: true } },
      });

      if (session.endedAt !== null) {
        return { session: publicSession(session, now), absent: 0, alreadyEnded: true };
      }

      return inTransaction(ctx.db, async (tx) => {
        const absent = await finalize(tx, session, now);

        const updated = await tx.attendanceSession.findUniqueOrThrow({
          where: { id: session.id },
          select: sessionSelect,
        });

        const counts = await tx.attendanceRecord.groupBy({
          by: ["status"],
          where: { sessionId: session.id },
          _count: { _all: true },
        });

        await recordEvent(tx, {
          action: "ATTENDANCE_SESSION_ENDED",
          actor: auditActor(ctx),
          subject: { id: session.id, label: schoolDayFromColumn(session.date) },
          program: { id: session.programId, label: session.program.name },
          detail: {
            day: schoolDayFromColumn(session.date),
            markedAbsent: absent,
            byStatus: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
          },
        });

        return { session: publicSession(updated, now), absent, alreadyEnded: false };
      });
    }),

  /**
   * Put an ended session back into check-in.
   *
   * **Deletes the finalized absences and nothing else.** Every self check-in and every instructor
   * decision survives, which is what makes reopening safe — and safe is what decides whether a
   * feature gets used or worked around.
   *
   * It also has to move the backstop forward, or reopening would hand back a session that is
   * already past its ninety minutes and refuses the first code typed at it.
   */
  reopen: instructorProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        minutes: z.number().int().min(1).max(240).default(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        ...sessionSelect,
        program: { select: { name: true, archivedAt: true } },
      });

      if (session.program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${session.program.name} has finished, so its attendance cannot be reopened.`,
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        const removed = await tx.attendanceRecord.deleteMany({
          where: { sessionId: session.id, source: "FINALIZED" },
        });

        const updated = await tx.attendanceSession.update({
          where: { id: session.id },
          data: {
            endedAt: null,
            endsAt: new Date(now.getTime() + input.minutes * 60 * 1000),
          },
          select: sessionSelect,
        });

        await recordEvent(tx, {
          action: "ATTENDANCE_SESSION_REOPENED",
          actor: auditActor(ctx),
          subject: { id: session.id, label: schoolDayFromColumn(session.date) },
          program: { id: session.programId, label: session.program.name },
          detail: {
            day: schoolDayFromColumn(session.date),
            absencesRemoved: removed.count,
            endsAt: updated.endsAt.toISOString(),
          },
        });

        return { session: publicSession(updated, now), absencesRemoved: removed.count };
      });
    }),

  /**
   * Replace the code, for when one reaches a group chat.
   *
   * **The whole remedy for a leak, now that the code does not rotate on a clock.** A new secret, so
   * the old code stops working at once and the instructor gives out the new one the same way they
   * gave out the first. That is a deliberate response to something an instructor noticed, which is
   * the shape a remedy should have — churning the code every thirty seconds whether or not anything
   * was wrong is what cost the shared screen.
   *
   * A fellow who was mid-typing when this ran is refused, and the refusal names the possibility
   * that the code was replaced, because the old secret is gone and the server cannot tell that
   * fellow apart from somebody guessing.
   */
  rotateCode: instructorProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        ...sessionSelect,
        program: { select: { name: true } },
      });

      if (!isAcceptingCheckIns(session, now)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Check-in is not open, so there is no code to replace.",
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        await tx.attendanceSession.update({
          where: { id: session.id },
          data: { codeSecret: newSessionSecret() },
          select: { id: true },
        });

        await recordEvent(tx, {
          action: "ATTENDANCE_CODE_ROTATED",
          actor: auditActor(ctx),
          subject: { id: session.id, label: schoolDayFromColumn(session.date) },
          program: { id: session.programId, label: session.program.name },
          // Never the code and never the secret. The log is readable by anyone who can read the
          // table, and a code written into it outlives the session it belonged to.
          detail: { day: schoolDayFromColumn(session.date) },
        });

        return { rotated: true };
      });
    }),

  /**
   * Remove a session started by mistake.
   *
   * Not optional. A session started on the wrong date marks the whole cohort absent for a day they
   * were never expected, and once that is written it is a wrong number in a report nobody thinks
   * to question. Refused once anybody has checked themselves in, because deleting then would
   * destroy a record a fellow created — `reopen` and per-fellow corrections are the tools for that.
   */
  deleteSession: instructorProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await teachableAttendanceSession(ctx, input.sessionId, {
        id: true,
        programId: true,
        date: true,
        program: { select: { name: true } },
      });

      const selfRecorded = await ctx.db.attendanceRecord.count({
        where: { sessionId: session.id, source: "SELF_CHECK_IN" },
      });

      if (selfRecorded > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${selfRecorded} ${selfRecorded === 1 ? "student has" : "students have"} already ` +
            `checked in on this day, so deleting it would erase what they recorded. Correct the ` +
            `individual entries instead.`,
        });
      }

      const day = schoolDayFromColumn(session.date);

      return inTransaction(ctx.db, async (tx) => {
        await tx.attendanceSession.delete({ where: { id: session.id }, select: { id: true } });

        await recordEvent(tx, {
          action: "ATTENDANCE_SESSION_DELETED",
          actor: auditActor(ctx),
          subject: { id: session.id, label: day },
          program: { id: session.programId, label: session.program.name },
          detail: { day },
        });

        return { id: session.id, day };
      });
    }),

  /**
   * Every session of a course, with every fellow's record against it.
   *
   * The one read behind the term grid, the drift list, and the export — all three from one
   * payload, so the file somebody downloads cannot describe a different cohort from the screen
   * they downloaded it on. Same reasoning as `lib/gradebook/csv.ts`.
   */
  history: programProcedure.query(async ({ ctx, input }) => {
    const now = new Date();

    const [program, sessions, enrollments] = await Promise.all([
      ctx.db.program.findUniqueOrThrow({
        where: { id: input.programId },
        select: { id: true, name: true, term: true, archivedAt: true },
      }),
      ctx.db.attendanceSession.findMany({
        where: { programId: input.programId },
        orderBy: { date: "asc" },
        select: sessionSelect,
      }),
      ctx.db.enrollment.findMany({
        where: enrollmentsIn(input.programId),
        select: { id: true, status: true, createdAt: true, student: { select: personSelect } },
      }),
    ]);

    const records = await ctx.db.attendanceRecord.findMany({
      where: { programId: input.programId },
      select: {
        enrollmentId: true,
        sessionId: true,
        status: true,
        source: true,
        checkedInAt: true,
        note: true,
      },
    });

    const summarySessions = sessions.map((session) => ({
      id: session.id,
      day: schoolDayFromColumn(session.date),
      open: sessionStateOf(session, now) === "open",
    }));

    const toFellow = (enrollment: (typeof enrollments)[number]): SummaryFellow => ({
      enrollmentId: enrollment.id,
      studentId: enrollment.student.id,
      displayName: enrollment.student.displayName,
      email: enrollment.student.email,
      githubUsername: enrollment.student.githubUsername,
      testStudentNumber: enrollment.student.testStudentNumber,
      // The first school day they could have attended. Without this, somebody who joined in March
      // reads as absent for all of February — a real number, in a real report, wrong against them.
      enrolledFrom: schoolDayOf(enrollment.createdAt),
    });

    const summaryRecords: SummaryRecord[] = records.map((record) => ({
      enrollmentId: record.enrollmentId,
      sessionId: record.sessionId,
      status: record.status,
    }));

    /*
      When each fellow actually arrives, which is what taking attendance once a day gave up and this
      gives back — see `lib/attendance/arrival.ts`.

      Only records carrying a `checkedInAt` count, and the weekday comes from the session's day rather
      than from the arrival instant. Both rules live in that module; this supplies the pairs.
    */
    const dayBySession = new Map(summarySessions.map((session) => [session.id, session.day]));
    const arrivalsByEnrollment = new Map<string, Arrival[]>();
    for (const record of records) {
      if (!record.checkedInAt) continue;
      const day = dayBySession.get(record.sessionId);
      if (!day) continue;
      const bucket = arrivalsByEnrollment.get(record.enrollmentId);
      const arrival = { day, checkedInAt: record.checkedInAt };
      if (bucket) bucket.push(arrival);
      else arrivalsByEnrollment.set(record.enrollmentId, [arrival]);
    }

    const arrivals = Object.fromEntries(
      enrollments.map((enrollment) => [
        enrollment.id,
        arrivalAverages(arrivalsByEnrollment.get(enrollment.id) ?? []),
      ]),
    );

    const active = enrollments.filter((enrollment) => enrollment.status === "ACTIVE");
    const removed = enrollments.filter((enrollment) => enrollment.status !== "ACTIVE");

    return {
      program: {
        id: program.id,
        name: program.name,
        term: program.term,
        archived: program.archivedAt !== null,
      },
      sessions: sessions.map((session) => publicSession(session, now)),
      openSessions: summarySessions.filter((session) => session.open).map((session) => session.day),
      active: summarize(summarySessions, active.map(toFellow), summaryRecords),
      removed: summarize(summarySessions, removed.map(toFellow), summaryRecords),
      /**
       * One fellow's arrival averages, by enrollment id, for every fellow on the roster.
       *
       * Keyed by enrollment rather than returned on each summary row, because the summary shape is
       * shared with the fellow's own screen — and a field present on one caller's rows and absent on
       * the other's is the kind of near-miss that typechecks.
       */
      arrivals,
      records,
    };
  }),

  // =====================================================================================
  // The fellow's side.
  // =====================================================================================

  /**
   * Whatever a fellow can check into right now, across every program they are in.
   *
   * A list rather than one session, because somebody repeating a year is on two rosters at once and
   * both could have opened a morning. It is one session per program rather than one per course,
   * which is the change attendance moving up made: a fellow taking three courses that all meet on a
   * Tuesday types one code.
   *
   * **Returns nothing at all when no session is open**, rather than an entry saying so. The card
   * renders on absence of data, so an empty list is silence on a Saturday instead of a false
   * alarm every weekend.
   */
  today: profileProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const day = schoolDayOf(now);

    const enrollments = await ctx.db.enrollment.findMany({
      where: { studentId: ctx.profile.id, status: "ACTIVE", program: { archivedAt: null } },
      select: {
        id: true,
        program: { select: { id: true, name: true } },
      },
    });

    if (enrollments.length === 0) return [];

    const sessions = await ctx.db.attendanceSession.findMany({
      where: {
        programId: { in: enrollments.map((enrollment) => enrollment.program.id) },
        date: dateColumnFor(day),
      },
      select: sessionSelect,
    });

    const mine = await ctx.db.attendanceRecord.findMany({
      where: {
        sessionId: { in: sessions.map((session) => session.id) },
        enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) },
      },
      select: {
        sessionId: true,
        status: true,
        source: true,
        checkedInAt: true,
        recordedBy: { select: personNameSelect },
      },
    });

    return sessions.map((session) => {
      const enrollment = enrollments.find((row) => row.program.id === session.programId)!;
      const record = mine.find((row) => row.sessionId === session.id) ?? null;

      return {
        programId: session.programId,
        programName: enrollment.program.name,
        session: publicSession(session, now),
        record: record
          ? {
              status: record.status,
              source: record.source,
              checkedInAt: record.checkedInAt,
              recordedByName: record.recordedBy
                ? displayNameOf(record.recordedBy, "an instructor")
                : null,
            }
          : null,
      };
    });
  }),

  /**
   * Mark yourself present, with the code on the screen.
   *
   * **The order of the checks is the design.** Already-checked-in comes before the attempt
   * ceiling, so a fellow who is present can never be rate-limited out of confirming it; and it
   * comes before the code check, so an instructor's EXCUSED is never overwritten by somebody
   * typing a code they overheard. Then the ceilings, then the code — because a wrong code is the
   * only branch that writes a failure event, and the ceilings exist to bound exactly that.
   *
   * **A wrong code and an expired one get different sentences.** The server can tell them apart,
   * and they send the reader to different places: one back to the screen, the other to wondering
   * whether they are in the right course at all.
   */
  checkIn: profileProcedure
    .input(z.object({ programId: z.string().uuid(), code: z.string().regex(/^\d{4}$/) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const day = schoolDayOf(now);

      await assertActiveInProgram(ctx, input.programId);

      const [program, enrollment] = await Promise.all([
        ctx.db.program.findUniqueOrThrow({
          where: { id: input.programId },
          select: { id: true, name: true },
        }),
        ctx.db.enrollment.findUniqueOrThrow({
          where: { programId_studentId: { programId: input.programId, studentId: ctx.profile.id } },
          select: { id: true },
        }),
      ]);

      const session = await ctx.db.attendanceSession.findUnique({
        where: { programId_date: { programId: input.programId, date: dateColumnFor(day) } },
        select: sessionWithSecretSelect,
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            `Check-in has not been opened for ${program.name} today. Your instructor starts it ` +
            `at the beginning of class.`,
        });
      }

      const existing = await ctx.db.attendanceRecord.findUnique({
        where: {
          sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id },
        },
        select: { status: true, source: true, checkedInAt: true },
      });

      /*
        Returned rather than refused. They asked to be marked in and they are — whether they
        double-tapped, reopened a bookmark, or were marked by an instructor a minute ago.

        **`FINALIZED` is deliberately not included.** That row is the absence of a decision rather
        than one: it is what ending the session wrote for everybody nobody recorded. Treating it
        like the others would tell somebody who missed the morning that they are already checked
        in, which is both false and the opposite of what they need to hear. It falls through to the
        refusal below, which sends them to their instructor.
      */
      if (existing && existing.source !== "FINALIZED") {
        return {
          status: existing.status,
          checkedInAt: existing.checkedInAt,
          alreadyCheckedIn: true,
        };
      }

      if (!isAcceptingCheckIns(session, now)) refuseClosed(session, program.name, now);

      const actor = auditActor(ctx);

      await assertWithinRate(ctx.db, {
        actorId: actor.id,
        action: "ATTENDANCE_CHECK_IN_FAILED",
        limit: CHECK_IN_ATTEMPT_LIMIT,
        whatTheyDid: "try the code",
      });

      // The second ceiling, over this session rather than over ten minutes. Four digits and a
      // ninety-minute window would otherwise allow enough attempts to matter.
      const failedThisSession = await ctx.db.auditEvent.count({
        where: {
          actorId: actor.id,
          action: "ATTENDANCE_CHECK_IN_FAILED",
          occurredAt: { gte: session.startedAt },
        },
      });

      if (failedThisSession >= CHECK_IN_SESSION_ATTEMPTS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            `That is ${failedThisSession} wrong codes for this session, which is the limit. Ask ` +
            `your instructor to mark you in.`,
        });
      }

      if (!codeMatches(session as CodeSession, input.code)) {
        await inTransaction(ctx.db, (tx) =>
          recordEvent(tx, {
            action: "ATTENDANCE_CHECK_IN_FAILED",
            actor,
            subject: { id: ctx.profile.id, label: displayNameOf(ctx.profile, "a student") },
            program: { id: program.id, label: program.name },
            detail: { day, reason: "wrong-code" },
          }),
        );

        /*
          One refusal, because there is only one way to be wrong now: the session is open, so the
          code either is this session's or is not. There is no expiry to distinguish.

          The second sentence covers the case the server cannot detect. If the instructor replaced
          the code because the old one reached a group chat, the old secret is gone and a fellow
          typing the old code is indistinguishable from one guessing — so the refusal names the
          possibility rather than pretending to know.
        */
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            `That is not the code for today's ${program.name} session. If your instructor replaced ` +
            `the code, ask them for the new one.`,
        });
      }

      const status = statusForCheckIn(session, now);

      return inTransaction(ctx.db, async (tx) => {
        const record = await tx.attendanceRecord.create({
          data: {
            sessionId: session.id,
            programId: program.id,
            enrollmentId: enrollment.id,
            status,
            source: "SELF_CHECK_IN",
            checkedInAt: now,
          },
          select: { status: true, checkedInAt: true },
        });

        await recordEvent(tx, {
          action: "ATTENDANCE_CHECKED_IN",
          actor,
          subject: { id: ctx.profile.id, label: displayNameOf(ctx.profile, "a student") },
          program: { id: program.id, label: program.name },
          detail: {
            day,
            status,
            secondsAfterStart: Math.round((now.getTime() - session.startedAt.getTime()) / 1000),
          },
        });

        return { ...record, alreadyCheckedIn: false };
      });
    }),

  /**
   * A fellow's own week, across every program they are in.
   *
   * **One row per program rather than one per course**, which is the whole change attendance
   * moving up made here: a fellow taking three courses that all meet on a Tuesday had three rows of
   * squares and three codes to type, and the three said the same thing.
   *
   * The second cross-program read here after `today`, and it takes that one's scoping rather than
   * `myHistory`'s: active enrollments in programs that are still running. A fellow removed from a
   * program keeps *reading* their record, which is why `myHistory` lets them through — but they
   * have no week in it, and a row on the dashboard would be telling them to turn up.
   *
   * **The week is reported as days and the rate as a term.** A weekly percentage would be a
   * confident wrong number: a session exists only because an instructor pressed start, so a
   * morning nobody opened is indistinguishable from a morning the program did not meet, and a
   * forgotten Tuesday would read as a full week. Squares say what happened on each day and invent
   * nothing for the days with no session. The figure beside them is cumulative, where the
   * denominator is a real one.
   *
   * **`summarize` computes that figure, the same function the program's own attendance screen
   * reads.** It costs this procedure the term's sessions per program rather than the week's. That
   * is the price of the two screens being unable to disagree about a fellow's rate, and it is
   * worth paying — the progress bar learnt this the expensive way, and the note on
   * `verify-student-dashboard` records how.
   */
  myWeek: profileProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const today = schoolDayOf(now);
    const week = weekRange(today);

    const enrollments = await ctx.db.enrollment.findMany({
      where: { studentId: ctx.profile.id, status: "ACTIVE", program: { archivedAt: null } },
      select: {
        id: true,
        createdAt: true,
        program: { select: { id: true, name: true } },
      },
      orderBy: { program: { name: "asc" } },
    });

    if (enrollments.length === 0) return { week, columns: [], programs: [] };

    const programIds = enrollments.map((enrollment) => enrollment.program.id);
    const enrollmentIds = enrollments.map((enrollment) => enrollment.id);

    const [sessions, records] = await Promise.all([
      ctx.db.attendanceSession.findMany({
        where: { programId: { in: programIds } },
        orderBy: { date: "asc" },
        select: sessionSelect,
      }),
      /*
        Scoped to this fellow's own enrollments, which is the only thing stopping one fellow
        reading another's attendance — Prisma bypasses row level security, as every other
        caller-scoped read in this file says.
      */
      ctx.db.attendanceRecord.findMany({
        where: { enrollmentId: { in: enrollmentIds } },
        select: { sessionId: true, enrollmentId: true, status: true, checkedInAt: true },
      }),
    ]);

    const summarySessions = sessions.map((session) => ({
      id: session.id,
      programId: session.programId,
      day: schoolDayFromColumn(session.date),
      open: sessionStateOf(session, now) === "open",
    }));

    /*
      One column set for every term, so two rows of squares line up under one row of
      headings. A Saturday session in any of them widens all of them, which is right: the columns
      are days of the week, not days of a program.
    */
    const columns = weekColumns(
      week,
      summarySessions
        .filter((session) => session.day >= week.from && session.day <= week.to)
        .map((session) => session.day),
    );

    const byId = new Map(sessions.map((session) => [session.id, session]));

    const programs = enrollments.map((enrollment) => {
      const enrolledFrom = schoolDayOf(enrollment.createdAt);
      const mine = summarySessions.filter((session) => session.programId === enrollment.program.id);
      const myRecords = records.filter((record) => record.enrollmentId === enrollment.id);

      const [summary] = summarize(
        mine,
        [
          {
            enrollmentId: enrollment.id,
            studentId: ctx.profile.id,
            displayName: ctx.profile.displayName,
            email: ctx.profile.email,
            githubUsername: ctx.profile.githubUsername,
            testStudentNumber: ctx.profile.testStudentNumber,
            enrolledFrom,
          },
        ],
        myRecords.map((record) => ({
          enrollmentId: enrollment.id,
          sessionId: record.sessionId,
          status: record.status,
        })),
      );

      const statusBySession = new Map(myRecords.map((record) => [record.sessionId, record.status]));
      const inWeek = new Map(
        mine
          .filter((session) => columns.includes(session.day))
          .map((session) => [session.day, session]),
      );

      // The session a fellow could still check into right now, and nothing else. `today` answers
      // the same question for the check-in card; this row is a way in rather than a second answer.
      const openToday = mine.find((session) => session.day === today && session.open) ?? null;
      const openRecord = openToday ? (statusBySession.get(openToday.id) ?? null) : null;

      return {
        program: enrollment.program,
        enrolledFrom,
        summary: {
          eligible: summary.eligible,
          attended: summary.present + summary.late,
          rate: summary.rate,
        },
        days: columns.map((day) => {
          const session = inWeek.get(day);
          return {
            day,
            session: session
              ? { status: statusBySession.get(session.id) ?? null, open: session.open }
              : undefined,
          };
        }),
        open: openToday
          ? {
              session: publicSession(byId.get(openToday.id)!, now),
              checkedIn: openRecord !== null,
              status: openRecord,
            }
          : null,
      };
    });

    return { week, columns, programs };
  }),

  /**
   * A fellow's own attendance in one program.
   *
   * `assertProgramMember` rather than `assertActiveInProgram`: somebody removed from a program keeps
   * reading their own record, for the same reason they keep reading the feedback they were given.
   */
  myHistory: profileProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      await assertProgramMember(ctx, input.programId);

      const [program, enrollment] = await Promise.all([
        ctx.db.program.findUniqueOrThrow({
          where: { id: input.programId },
          select: { id: true, name: true },
        }),
        ctx.db.enrollment.findUniqueOrThrow({
          where: { programId_studentId: { programId: input.programId, studentId: ctx.profile.id } },
          select: { id: true, createdAt: true },
        }),
      ]);

      const [sessions, records] = await Promise.all([
        ctx.db.attendanceSession.findMany({
          where: { programId: input.programId },
          orderBy: { date: "desc" },
          select: sessionSelect,
        }),
        ctx.db.attendanceRecord.findMany({
          where: { enrollmentId: enrollment.id },
          select: {
            sessionId: true,
            status: true,
            source: true,
            checkedInAt: true,
            note: true,
            recordedBy: { select: personNameSelect },
          },
        }),
      ]);

      const summarySessions = sessions.map((session) => ({
        id: session.id,
        day: schoolDayFromColumn(session.date),
        open: sessionStateOf(session, now) === "open",
      }));

      const [summary] = summarize(
        summarySessions,
        [
          {
            enrollmentId: enrollment.id,
            studentId: ctx.profile.id,
            displayName: ctx.profile.displayName,
            email: ctx.profile.email,
            githubUsername: ctx.profile.githubUsername,
            testStudentNumber: ctx.profile.testStudentNumber,
            enrolledFrom: schoolDayOf(enrollment.createdAt),
          },
        ],
        records.map((record) => ({
          enrollmentId: enrollment.id,
          sessionId: record.sessionId,
          status: record.status,
        })),
      );

      const byId = new Map(records.map((record) => [record.sessionId, record]));

      /*
        Their own arrival averages, from the same function the instructor's screens read — so a fellow
        and their instructor cannot be shown different answers about when they turn up.
      */
      const dayById = new Map(summarySessions.map((session) => [session.id, session.day]));
      const arrivals = arrivalAverages(
        records.flatMap((record) => {
          if (!record.checkedInAt) return [];
          const day = dayById.get(record.sessionId);
          return day ? [{ day, checkedInAt: record.checkedInAt }] : [];
        }),
      );

      return {
        program,
        enrolledFrom: schoolDayOf(enrollment.createdAt),
        summary,
        /** When they actually arrive, overall and by weekday. See `lib/attendance/arrival.ts`. */
        arrivals,
        days: sessions.map((session) => {
          const record = byId.get(session.id) ?? null;
          return {
            ...publicSession(session, now),
            status: record?.status ?? null,
            source: record?.source ?? null,
            checkedInAt: record?.checkedInAt ?? null,
            note: record?.note ?? null,
            recordedByName: record?.recordedBy
              ? displayNameOf(record.recordedBy, "an instructor")
              : null,
          };
        }),
      };
    }),
});
