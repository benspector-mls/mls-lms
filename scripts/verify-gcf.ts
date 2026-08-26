/**
 * GCF results: importing them, recording one by hand, and who may read whose.
 *
 * Run with `npm run verify:gcf`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is most of what these procedures are — and here it is a *different shape* from every other
 * router, which is the reason this script exists rather than a few more unit tests.
 *
 * An attempt carries no course. Every other table in this application can be gated by reading the
 * row and asking which cohort it belongs to; a GCF result belongs to a person, so the checks have
 * to be built out of the enrollment instead. Three of them, and each is exercised below:
 *
 * - reading a cohort's results gates on the course and then narrows to its enrollments, so an
 *   instructor cannot see a fellow they do not teach;
 * - `mine` takes no student id, so pointing it at somebody else is not refused — it is
 *   inexpressible;
 * - writing checks the *student* is in the course as well as that the caller teaches it, because
 *   a bare `studentId` would otherwise reach any profile in the deployment.
 *
 * The other property worth proving against a real database is idempotency. An attempt is a
 * fellow, a kind, and a day, so importing the same export twice must leave the same rows — and a
 * score typed in by hand must be *filled in* by a later import rather than doubled.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const course = await db.course.findFirst({
    // A course whose program has somebody on its roster. Enrollment belongs to the program
    // now, so the condition reaches up through it rather than sitting on the course.
    where: { archivedAt: null, program: { enrollments: { some: { status: "ACTIVE" } } } },
    select: { id: true, programId: true },
  });
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id },
        select: { userId: true },
      })
    : null;
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { programId: course.programId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { studentId: true, student: { select: { email: true } } },
      })
    : null;

  if (!course || !instructor || !enrollment) {
    return skip("no seeded course with an instructor and an active fellow on its roster");
  }

  const studentId = enrollment.studentId;
  const createCaller = createCallerFactory(appRouter);
  const stamp = Date.now();

  /*
    A day nothing else uses, so this script cannot collide with the seed's attempts or with a real
    attempt. Far enough in the past to be plainly synthetic.
  */
  const DAY = "2019-03-04";
  const OTHER_DAY = "2019-03-05";

  /** One row of a parsed export, shaped as the browser sends it. */
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    externalId: `verify-${stamp}`,
    email: `verify-${stamp}@example.com`,
    fullName: "Verify Person",
    kind: "PROCTORED" as const,
    score: 512,
    scorePossible: null,
    takenOn: DAY,
    assessmentName: "General Coding Assessment",
    integrityFlagged: false,
    resultUrl: null,
    ...over,
  });

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

      // --- reading -----------------------------------------------------------

      const before = await asInstructor.gcf.forCourse({ courseId: course.id, cohort: "all" });
      check(
        "the course's tab lists the roster's active fellows",
        before.activeStudents.some((s) => s.id === studentId),
        true,
      );

      /*
        The narrowing that has to be explicit here. The attempts table carries no course, so
        without it this query would return every GCF result in the deployment.
      */
      const enrolledIds = new Set(
        [...before.activeStudents, ...before.removedStudents].map((s) => s.id),
      );
      check(
        "and no attempt belonging to somebody outside it",
        before.attempts.every((a) => enrolledIds.has(a.studentId)),
        true,
      );

      // --- recording one by hand ---------------------------------------------

      const recorded = await asInstructor.gcf.record({
        courseId: course.id,
        studentId,
        kind: "PROCTORED",
        score: 400,
        scorePossible: null,
        takenOn: DAY,
        integrityFlagged: false,
        note: "Typed in by verify:gcf.",
      });
      check("an attempt can be recorded by hand", recorded.score, 400);
      check("...on the day it was sat", recorded.takenOn.toISOString().slice(0, 10), DAY);

      /*
        The same fellow, kind, and day is one attempt. Recording it again corrects the score
        rather than creating a second record of one morning — which is what makes typing a score
        in safe rather than something to undo when the export arrives.
      */
      const again = await asInstructor.gcf.record({
        courseId: course.id,
        studentId,
        kind: "PROCTORED",
        score: 415,
        scorePossible: null,
        takenOn: DAY,
        integrityFlagged: false,
        note: null,
      });
      check("recording the same attempt again corrects it", again.id, recorded.id);
      check("...to the new score", again.score, 415);

      // A different kind on the same day is a different attempt, not the same one edited.
      const mock = await asInstructor.gcf.record({
        courseId: course.id,
        studentId,
        kind: "MOCK",
        score: 900,
        scorePossible: 1200,
        takenOn: DAY,
        integrityFlagged: false,
        note: null,
      });
      check("a mock on the same day is its own attempt", mock.id !== recorded.id, true);

      // --- the note, which is what a fellow reads --------------------------

      const noted = await asInstructor.gcf.update({
        attemptId: mock.id,
        integrityFlagged: true,
        note: "Flagged for review; nothing came of it.",
      });
      check("a flag and its explanation can be written", noted.integrityFlagged, true);
      check(
        "...and the note is what the fellow will read",
        noted.note?.startsWith("Flagged"),
        true,
      );

      // --- importing ---------------------------------------------------------

      const rows = [row({ takenOn: OTHER_DAY, score: 480 })];

      const preview = await asInstructor.gcf.previewImport({ courseId: course.id, rows });
      check(
        "an unknown address matches nobody and is offered for assignment",
        preview.unmatched,
        1,
      );
      check("...and the cohort is returned to choose from", preview.students.length > 0, true);

      const first = await asInstructor.gcf.commitImport({
        courseId: course.id,
        rows,
        assignments: [{ email: rows[0]!.email, studentId }],
      });
      check("committing writes the attempt", first.written, 1);
      check("...and remembers the address", first.remembered, 1);

      /*
        The address is remembered, so the second upload resolves it without being asked. This is
        the whole of the matching mechanism: no setup before the first import, and the mapping
        fills itself in as it is used.
      */
      const second = await asInstructor.gcf.previewImport({ courseId: course.id, rows });
      check("a remembered address matches on the next upload", second.matched, 1);
      check("...and is reported as an update rather than a new row", second.updates, 1);

      const beforeRepeat = await tx.gcfAttempt.count({ where: { studentId } });
      await asInstructor.gcf.commitImport({ courseId: course.id, rows, assignments: [] });
      const afterRepeat = await tx.gcfAttempt.count({ where: { studentId } });
      check("importing the same file twice adds nothing", afterRepeat, beforeRepeat);

      /*
        And the case the day-based key exists for: an export covering an attempt somebody already
        typed in fills that row rather than attempt beside it.
      */
      const typed = await asInstructor.gcf.record({
        courseId: course.id,
        studentId,
        kind: "PROCTORED",
        score: 300,
        scorePossible: null,
        takenOn: "2019-03-06",
        integrityFlagged: false,
        note: "Entered before the export arrived.",
      });
      await asInstructor.gcf.commitImport({
        courseId: course.id,
        rows: [row({ takenOn: "2019-03-06", score: 521, externalId: `later-${stamp}` })],
        assignments: [],
      });
      const merged = await tx.gcfAttempt.findUnique({ where: { id: typed.id } });
      check("an import corrects a score typed in beforehand", merged?.score, 521);
      check("...rather than adding a second record of that day", merged !== null, true);
      /*
        And leaves the instructor's own words alone. The score came from CodeSignal; the note did
        not, and a re-import must not wipe what somebody wrote to explain a flag.
      */
      check(
        "...and keeps the note a person wrote",
        merged?.note,
        "Entered before the export arrived.",
      );

      // --- who may do any of it ----------------------------------------------

      check(
        "a fellow cannot read the course's results",
        await refusal(() => asStudent.gcf.forCourse({ courseId: course.id, cohort: "all" })),
        "FORBIDDEN",
      );

      check(
        "a student cannot record an attempt",
        await refusal(() =>
          asStudent.gcf.record({
            courseId: course.id,
            studentId,
            kind: "PROCTORED",
            score: 600,
            scorePossible: null,
            takenOn: DAY,
            integrityFlagged: false,
            note: null,
          }),
        ),
        "FORBIDDEN",
      );

      /*
        The check `courseProcedure` cannot make. It gates on the course, which stops somebody
        writing into a course they do not teach — but `studentId` is a separate argument naming any
        profile in the deployment, and teaching a course says nothing about that person.
      */
      const outsider = await tx.profile.findFirst({
        where: { id: { not: studentId }, enrollments: { none: { programId: course.programId } } },
        select: { id: true },
      });

      if (outsider) {
        check(
          "an instructor cannot record against somebody not in the cohort",
          await refusal(() =>
            asInstructor.gcf.record({
              courseId: course.id,
              studentId: outsider.id,
              kind: "PROCTORED",
              score: 600,
              scorePossible: null,
              takenOn: DAY,
              integrityFlagged: false,
              note: null,
            }),
          ),
          "FORBIDDEN",
        );

        check(
          "...nor assign an imported row to them",
          await refusal(() =>
            asInstructor.gcf.commitImport({
              courseId: course.id,
              rows,
              assignments: [{ email: rows[0]!.email, studentId: outsider.id }],
            }),
          ),
          "FORBIDDEN",
        );
      } else {
        skip("no profile outside this cohort, so the cross-cohort write is untested");
      }

      // --- a fellow's own record ---------------------------------------------

      /*
        Somebody else's attempt, so "reads their own" is a claim with something to exclude. Without
        one in the database, a `mine` that returned everything would pass the check below by
        accident — which is the failure mode a scoping test most needs to avoid.
      */
      const other = await tx.profile.findFirst({
        where: { id: { not: studentId } },
        select: { id: true },
      });

      if (other) {
        await tx.gcfAttempt.create({
          data: {
            studentId: other.id,
            kind: "PROCTORED",
            score: 599,
            takenOn: new Date("2019-03-09T00:00:00Z"),
          },
        });
      }

      const mine = await asStudent.gcf.mine();
      const everyAttempt = await tx.gcfAttempt.count();

      check(
        "a fellow reads their own attempts",
        mine.length > 0 && mine.every((a) => a.studentId === studentId),
        true,
      );
      check(
        "...and not the ones that exist beside them",
        other ? mine.length < everyAttempt : "no second profile to hide",
        other ? true : "no second profile to hide",
      );

      // Nothing above is meant to survive. Everything this wrote is rolled back with it.
      throw new Error("rollback");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "rollback") throw error;
  }

  /*
    The unique constraint behind the upserts, in a transaction of its own — a constraint violation
    aborts the transaction it happens in, so asking this inside the block above would take every
    check after it down with it.

    Worth asking separately because every "this updates rather than duplicates" result above rests
    on it. If the index were dropped, each of those checks would still pass through Prisma's
    upsert while the database quietly allowed a second row.
  */
  const existing = await db.gcfAttempt.findFirst({
    select: { studentId: true, kind: true, takenOn: true },
  });

  if (!existing) {
    skip("no committed attempt, so the uniqueness constraint is untested");
  } else {
    let constraint = "inserted";

    await inOwnTransaction(db, async (isolated) => {
      try {
        await isolated.gcfAttempt.create({
          data: {
            studentId: existing.studentId,
            kind: existing.kind,
            takenOn: existing.takenOn,
            score: 1,
          },
        });
      } catch {
        constraint = "refused";
      }
    });

    check("the database refuses a second record of one attempt", constraint, "refused");
  }

  finish();
}

void main();
