/**
 * GCF results: importing them, recording one by hand, and who may read whose.
 *
 * Run with `npm run test:integration`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is most of what these procedures are — and here it is a *different shape* from every other
 * router, which is why these are not a few more unit tests.
 *
 * An attempt carries no course. Every other table in this application can be gated by reading the
 * row and asking which cohort it belongs to; a GCF result belongs to a person, so the checks have
 * to be built out of the enrollment instead. Three of them, and each is exercised below:
 *
 * - reading a cohort's results gates on the course and then narrows to its enrollments, so an
 *   instructor cannot see a fellow they do not teach;
 * - `mine` takes no student id, so pointing it at somebody else is not refused — it is
 *   inexpressible;
 * - writing checks the *student* is in the course as well as that the caller teaches it, because a
 *   bare `studentId` would otherwise reach any profile in the deployment.
 *
 * The other property worth proving against a real database is idempotency. An attempt is a fellow,
 * a kind, and a day, so importing the same export twice must leave the same rows — and a score
 * typed in by hand must be *filled in* by a later import rather than doubled.
 *
 * Carries the 26 assertions `verify:gcf` reported on 2 September 2026, and two of them mean more
 * here. "No attempt belonging to somebody outside it" ran against a course whose attempts list was
 * usually empty, which passes whether the narrowing is there or not; the fixture below gives an
 * outsider an attempt, so there is something for a missing `where` clause to leak.
 */
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

/*
  Days nothing else uses, far enough in the past to be plainly synthetic. An attempt is keyed on a
  fellow, a kind and a day, so the day is what these checks vary.
*/
const DAY = "2019-03-04";
const OTHER_DAY = "2019-03-05";
const TYPED_DAY = "2019-03-06";

describe("recording, importing and reading GCF results", () => {
  const tx = withRollback();

  let world: World;
  let outsiderId: string;
  let studentId: string;
  let stamp: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), studentId);

  /** One row of a parsed export, shaped as the browser sends it. */
  const row = (over: Record<string, unknown> = {}) => ({
    externalId: `integration-${stamp}`,
    email: `integration-${stamp}@example.com`,
    fullName: "Integration Person",
    kind: "PROCTORED" as const,
    score: 512,
    scorePossible: null,
    takenOn: DAY,
    assessmentName: "General Coding Assessment",
    integrityFlagged: false,
    resultUrl: null,
    ...over,
  });

  beforeAll(async () => {
    stamp = crypto.randomUUID().slice(0, 8);
    world = await makeWorld(tx());
    studentId = world.student.studentId;

    /*
      Somebody outside this program, holding an attempt of their own. Two checks rest on them: that
      the course's tab does not leak an attempt belonging to somebody it does not teach, and that a
      fellow's own list excludes it. Both pass vacuously against a database where no such attempt
      exists, which is what the script was measuring.
    */
    outsiderId = await makeAccount(tx());
    await tx().gcfAttempt.create({
      data: {
        studentId: outsiderId,
        kind: "PROCTORED",
        score: 599,
        takenOn: new Date("2019-03-09T00:00:00Z"),
      },
    });
  });

  describe("reading", () => {
    let before: Awaited<ReturnType<ReturnType<typeof asInstructor>["gcf"]["forCourse"]>>;

    beforeAll(async () => {
      before = await asInstructor().gcf.forCourse({ courseId: world.courseId, cohort: "all" });
    });

    it("the course's tab lists the roster's active fellows", () => {
      expect(before.activeStudents.some((s) => s.id === studentId)).toBe(true);
    });

    /*
      The narrowing that has to be explicit here. The attempts table carries no course, so without
      it this query would return every GCF result in the deployment — including the outsider's,
      which is why one exists.
    */
    it("and no attempt belonging to somebody outside it", () => {
      const enrolled = new Set(
        [...before.activeStudents, ...before.removedStudents].map((s) => s.id),
      );
      expect(before.attempts.every((a) => enrolled.has(a.studentId))).toBe(true);
    });
  });

  describe("recording one by hand", () => {
    let recorded: { id: string; score: number | null; takenOn: Date };
    let mockId: string;

    beforeAll(async () => {
      recorded = await asInstructor().gcf.record({
        courseId: world.courseId,
        studentId,
        kind: "PROCTORED",
        score: 400,
        scorePossible: null,
        takenOn: DAY,
        integrityFlagged: false,
        note: "Typed in by the integration suite.",
      });
    });

    it("an attempt can be recorded by hand", () => {
      expect(recorded.score).toBe(400);
    });

    it("...on the day it was sat", () => {
      expect(recorded.takenOn.toISOString().slice(0, 10)).toBe(DAY);
    });

    /*
      The same fellow, kind, and day is one attempt. Recording it again corrects the score rather
      than creating a second record of one morning — which is what makes typing a score in safe
      rather than something to undo when the export arrives.
    */
    describe("the same attempt again", () => {
      let again: { id: string; score: number | null };

      beforeAll(async () => {
        again = await asInstructor().gcf.record({
          courseId: world.courseId,
          studentId,
          kind: "PROCTORED",
          score: 415,
          scorePossible: null,
          takenOn: DAY,
          integrityFlagged: false,
          note: null,
        });
      });

      it("recording the same attempt again corrects it", () => {
        expect(again.id).toBe(recorded.id);
      });

      it("...to the new score", () => {
        expect(again.score).toBe(415);
      });
    });

    // A different kind on the same day is a different attempt, not the same one edited.
    it("a mock on the same day is its own attempt", async () => {
      const mock = await asInstructor().gcf.record({
        courseId: world.courseId,
        studentId,
        kind: "MOCK",
        score: 900,
        scorePossible: 1200,
        takenOn: DAY,
        integrityFlagged: false,
        note: null,
      });
      mockId = mock.id;
      expect(mock.id).not.toBe(recorded.id);
    });

    describe("the note, which is what a fellow reads", () => {
      let noted: { integrityFlagged: boolean; note: string | null };

      beforeAll(async () => {
        noted = await asInstructor().gcf.update({
          attemptId: mockId,
          integrityFlagged: true,
          note: "Flagged for review; nothing came of it.",
        });
      });

      it("a flag and its explanation can be written", () => {
        expect(noted.integrityFlagged).toBe(true);
      });

      it("...and the note is what the fellow will read", () => {
        expect(noted.note?.startsWith("Flagged")).toBe(true);
      });
    });
  });

  describe("importing", () => {
    let rows: ReturnType<typeof row>[];

    beforeAll(() => {
      rows = [row({ takenOn: OTHER_DAY, score: 480 })];
    });

    describe("the first upload, from an address nobody knows", () => {
      let preview: Awaited<ReturnType<ReturnType<typeof asInstructor>["gcf"]["previewImport"]>>;
      let first: Awaited<ReturnType<ReturnType<typeof asInstructor>["gcf"]["commitImport"]>>;

      beforeAll(async () => {
        preview = await asInstructor().gcf.previewImport({ courseId: world.courseId, rows });
        first = await asInstructor().gcf.commitImport({
          courseId: world.courseId,
          rows,
          assignments: [{ email: rows[0]!.email, studentId }],
        });
      });

      it("an unknown address matches nobody and is offered for assignment", () => {
        expect(preview.unmatched).toBe(1);
      });

      it("...and the cohort is returned to choose from", () => {
        expect(preview.students.length).toBeGreaterThan(0);
      });

      it("committing writes the attempt", () => {
        expect(first.written).toBe(1);
      });

      it("...and remembers the address", () => {
        expect(first.remembered).toBe(1);
      });
    });

    /*
      The address is remembered, so the second upload resolves it without being asked. This is the
      whole of the matching mechanism: no setup before the first import, and the mapping fills
      itself in as it is used.
    */
    describe("the second upload of the same file", () => {
      let second: Awaited<ReturnType<ReturnType<typeof asInstructor>["gcf"]["previewImport"]>>;

      beforeAll(async () => {
        second = await asInstructor().gcf.previewImport({ courseId: world.courseId, rows });
      });

      it("a remembered address matches on the next upload", () => {
        expect(second.matched).toBe(1);
      });

      it("...and is reported as an update rather than a new row", () => {
        expect(second.updates).toBe(1);
      });

      it("importing the same file twice adds nothing", async () => {
        const before = await tx().gcfAttempt.count({ where: { studentId } });
        await asInstructor().gcf.commitImport({
          courseId: world.courseId,
          rows,
          assignments: [],
        });
        const after = await tx().gcfAttempt.count({ where: { studentId } });
        expect(after).toBe(before);
      });
    });

    /*
      The case the day-based key exists for: an export covering an attempt somebody already typed in
      fills that row rather than landing beside it.
    */
    describe("an export covering a score somebody typed in", () => {
      let typedId: string;
      let merged: { score: number | null; note: string | null } | null;

      beforeAll(async () => {
        const typed = await asInstructor().gcf.record({
          courseId: world.courseId,
          studentId,
          kind: "PROCTORED",
          score: 300,
          scorePossible: null,
          takenOn: TYPED_DAY,
          integrityFlagged: false,
          note: "Entered before the export arrived.",
        });
        typedId = typed.id;

        await asInstructor().gcf.commitImport({
          courseId: world.courseId,
          rows: [row({ takenOn: TYPED_DAY, score: 521, externalId: `later-${stamp}` })],
          assignments: [],
        });

        merged = await tx().gcfAttempt.findUnique({
          where: { id: typedId },
          select: { score: true, note: true },
        });
      });

      it("an import corrects a score typed in beforehand", () => {
        expect(merged?.score).toBe(521);
      });

      it("...rather than adding a second record of that day", () => {
        expect(merged).not.toBeNull();
      });

      /*
        And leaves the instructor's own words alone. The score came from CodeSignal; the note did
        not, and a re-import must not wipe what somebody wrote to explain a flag.
      */
      it("...and keeps the note a person wrote", () => {
        expect(merged?.note).toBe("Entered before the export arrived.");
      });
    });
  });

  describe("who may do any of it", () => {
    it("a fellow cannot read the course's results", async () => {
      const code = await refusal(() =>
        asStudent().gcf.forCourse({ courseId: world.courseId, cohort: "all" }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a student cannot record an attempt", async () => {
      const code = await refusal(() =>
        asStudent().gcf.record({
          courseId: world.courseId,
          studentId,
          kind: "PROCTORED",
          score: 600,
          scorePossible: null,
          takenOn: DAY,
          integrityFlagged: false,
          note: null,
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    /*
      The check `courseProcedure` cannot make. It gates on the course, which stops somebody writing
      into a course they do not teach — but `studentId` is a separate argument naming any profile in
      the deployment, and teaching a course says nothing about that person.
    */
    it("an instructor cannot record against somebody not in the cohort", async () => {
      const code = await refusal(() =>
        asInstructor().gcf.record({
          courseId: world.courseId,
          studentId: outsiderId,
          kind: "PROCTORED",
          score: 600,
          scorePossible: null,
          takenOn: DAY,
          integrityFlagged: false,
          note: null,
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("...nor assign an imported row to them", async () => {
      const code = await refusal(() =>
        asInstructor().gcf.commitImport({
          courseId: world.courseId,
          rows: [row({ takenOn: OTHER_DAY, score: 480 })],
          assignments: [{ email: `integration-${stamp}@example.com`, studentId: outsiderId }],
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("a fellow's own record", () => {
    it("a fellow reads their own attempts", async () => {
      const mine = await asStudent().gcf.mine();
      expect(mine.length > 0 && mine.every((a) => a.studentId === studentId)).toBe(true);
    });

    /*
      The outsider's attempt is what makes this a claim with something to exclude. Without one in
      the database, a `mine` that returned everything would pass by accident — which is the failure
      a scoping check most needs to avoid.
    */
    it("...and not the ones that exist beside them", async () => {
      const mine = await asStudent().gcf.mine();
      const everyAttempt = await tx().gcfAttempt.count();
      expect(mine.length).toBeLessThan(everyAttempt);
    });
  });
});

/*
  The unique constraint behind the upserts, in a transaction of its own — a constraint violation
  aborts the transaction it happens in.

  Worth asking separately because every "this updates rather than duplicates" result above rests on
  it. If the index were dropped, each of those checks would still pass through Prisma's upsert while
  the database quietly allowed a second row.
*/
describe("the constraint behind the upserts", () => {
  const tx = withRollback();

  it("the database refuses a second record of one attempt", async () => {
    const studentId = await makeAccount(tx());
    const takenOn = new Date("2019-03-10T00:00:00Z");
    await tx().gcfAttempt.create({ data: { studentId, kind: "PROCTORED", score: 500, takenOn } });

    let outcome = "inserted";
    try {
      await tx().gcfAttempt.create({ data: { studentId, kind: "PROCTORED", score: 1, takenOn } });
    } catch {
      outcome = "refused";
    }

    expect(outcome).toBe("refused");
  });
});
