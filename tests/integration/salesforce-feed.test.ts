/**
 * The Salesforce feed: every collection, walked against real rows inside a rolled-back
 * transaction.
 *
 * Run with `npm run test:integration`.
 *
 * What makes these need a database rather than a fixture is the cursor: the promise is that a
 * walk returns every record exactly once and then stops, and that promise is about what Prisma
 * writes into `updatedAt` and how Postgres orders it, neither of which a unit test can ask. Every
 * walk here uses a page size small enough to force several pages, so the cursor is exercised
 * rather than assumed.
 *
 * **Assertions are scoped to this suite's own rows.** The database may hold seeded rows and rows
 * other suites left behind, so a check never says "the collection has three records" — it says
 * "these three identifiers are present, once each, and this one is absent".
 */
import type { Cursor, Positioned } from "@/lib/integrations/salesforce/cursor";
import {
  COLLECTIONS,
  COLLECTION_NAMES,
  isCollectionName,
  type Collection,
} from "@/lib/integrations/salesforce/collections";
import {
  attendanceClassId,
  registrationKey,
  submissionKey,
} from "@/lib/integrations/salesforce/records";

import {
  enroll,
  makeAccount,
  makeAssignment,
  makeCourse,
  makeSubmission,
  makeUnit,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

/** A test-student number no seed uses; unique across the deployment, so it must not collide. */
const FAKE_TEST_STUDENT_NUMBER = 987_654;

/**
 * Walk a collection to the end at a small page size, collecting every record.
 *
 * Throws if the walk does not terminate, which is what a cursor that lands *on* its last record
 * rather than after it looks like — the same page forever.
 */
async function walkAll<R extends Positioned>(
  tx: Tx,
  collection: Collection,
  limit: number,
): Promise<R[]> {
  const out: Positioned[] = [];
  let cursor: Cursor = null;

  for (let pages = 0; pages < 10_000; pages += 1) {
    const page = await collection(tx, { cursor, limit });
    out.push(...page.records);
    if (!page.hasMore) return out as R[];
    if (page.cursor === null) throw new Error("hasMore without a cursor");
    cursor = { since: new Date(page.cursor.since), after: page.cursor.after };
  }

  throw new Error("the walk did not terminate");
}

/** The identifiers among `records` that are also in `ours`, so a check reads only this suite's rows. */
function oursAmong(records: Positioned[], ours: Set<string>): string[] {
  return records.map((record) => record.externalId).filter((id) => ours.has(id));
}

describe("the Salesforce feed", () => {
  const tx = withRollback(180_000);

  let world: World;
  /** A second program and its course, so that a check can show a record stays inside its own. */
  let otherProgramId: string;
  let otherCourseId: string;
  /** The fellow marked as a test student, who must appear nowhere. */
  let testStudent: { id: string; studentId: string };

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3, published: true });
    testStudent = world.students[2];
    await tx().profile.update({
      where: { id: testStudent.studentId },
      data: { testStudentNumber: FAKE_TEST_STUDENT_NUMBER },
    });

    const other = await makeWorld(tx(), { students: 1, published: true });
    otherProgramId = other.programId;
    otherCourseId = other.courseId;
  });

  describe("the table of collections", () => {
    it("names the nine collections and nothing else", () => {
      expect([...COLLECTION_NAMES]).toEqual([
        "programs",
        "enrollments",
        "classes",
        "registrations",
        "assignments",
        "sessions",
        "attendance",
        "submissions",
        "gcf-attempts",
      ]);
      expect(Object.keys(COLLECTIONS).sort()).toEqual([...COLLECTION_NAMES].sort());
      expect(isCollectionName("programs")).toBe(true);
      expect(isCollectionName("Programs")).toBe(false);
      expect(isCollectionName("contacts")).toBe(false);
    });
  });

  describe("programs and enrollments", () => {
    it("walks the programs, each once", async () => {
      const records = await walkAll(tx(), COLLECTIONS.programs, 1);
      const ours = new Set([world.programId, otherProgramId]);
      expect(oursAmong(records, ours).sort()).toEqual([...ours].sort());
    });

    it("walks the enrollments with the fellow's identifier and email, and leaves the test student out", async () => {
      const records = await walkAll<
        Positioned & { studentId: string; studentEmail: string | null; programId: string }
      >(tx(), COLLECTIONS.enrollments, 1);
      const ours = new Set(world.students.map((student) => student.id));
      const seen = oursAmong(records, ours);

      expect(seen.sort()).toEqual([world.students[0].id, world.students[1].id].sort());
      expect(seen).not.toContain(testStudent.id);

      const first = records.find((record) => record.externalId === world.students[0].id)!;
      expect(first.studentId).toBe(world.students[0].studentId);
      expect(first.studentEmail).toMatch(/@example\.test$/);
      expect(first.programId).toBe(world.programId);
    });
  });

  describe("classes", () => {
    let unpublishedCourseId: string;

    beforeAll(async () => {
      const unpublished = await makeCourse(tx(), { programId: world.programId, published: false });
      unpublishedCourseId = unpublished.id;
    });

    it("emits every published course and one Attendance class per program, and no unpublished course", async () => {
      const records = await walkAll<Positioned & { programId: string; name: string }>(
        tx(),
        COLLECTIONS.classes,
        1,
      );
      const ours = new Set([
        world.courseId,
        unpublishedCourseId,
        attendanceClassId(world.programId),
        attendanceClassId(otherProgramId),
      ]);
      const seen = oursAmong(records, ours);

      expect(seen.sort()).toEqual(
        [
          world.courseId,
          attendanceClassId(world.programId),
          attendanceClassId(otherProgramId),
        ].sort(),
      );
      expect(seen).not.toContain(unpublishedCourseId);

      const attendance = records.find(
        (record) => record.externalId === attendanceClassId(world.programId),
      )!;
      expect(attendance.name).toBe("Attendance");
      expect(attendance.programId).toBe(world.programId);
    });
  });

  describe("assignments", () => {
    let distributedId: string;
    let undistributedId: string;
    let assessmentId: string;

    beforeAll(async () => {
      const distributed = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        kind: "TASK",
        pointValue: 50,
      });
      distributedId = distributed.id;

      const undistributed = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        published: false,
      });
      undistributedId = undistributed.id;

      const assessmentUnit = await makeUnit(tx(), { courseId: world.courseId });
      await tx().courseUnit.update({
        where: { id: assessmentUnit.id },
        data: { category: "ASSESSMENT" },
      });
      const assessment = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: assessmentUnit.id,
        kind: "REPO",
        pointValue: 40,
      });
      assessmentId = assessment.id;
    });

    it("emits distributed assignments with type and point value, and no drafts", async () => {
      const records = await walkAll<
        Positioned & { classId: string; type: string; pointValue: number }
      >(tx(), COLLECTIONS.assignments, 1);
      const ours = new Set([distributedId, undistributedId, assessmentId]);
      const seen = oursAmong(records, ours);

      expect(seen.sort()).toEqual([distributedId, assessmentId].sort());
      expect(seen).not.toContain(undistributedId);

      const task = records.find((record) => record.externalId === distributedId)!;
      expect(task.classId).toBe(world.courseId);
      expect(task.type).toBe("assignment");
      expect(task.pointValue).toBe(1);

      const assessment = records.find((record) => record.externalId === assessmentId)!;
      expect(assessment.type).toBe("assessment");
      expect(assessment.pointValue).toBe(40);
    });
  });

  describe("sessions and attendance", () => {
    let sessionId: string;
    let presentRecordId: string;
    let testStudentRecordId: string;

    beforeAll(async () => {
      const session = await tx().attendanceSession.create({
        data: {
          programId: world.programId,
          date: new Date("2026-09-14T00:00:00Z"),
          startedAt: new Date("2026-09-14T13:00:00Z"),
          endsAt: new Date("2026-09-14T14:00:00Z"),
          lateAfterMinutes: 5,
          codeSecret: "0123456789abcdef".repeat(4),
        },
        select: { id: true },
      });
      sessionId = session.id;

      const present = await tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: world.students[0].id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date("2026-09-14T13:02:00Z"),
        },
        select: { id: true },
      });
      presentRecordId = present.id;

      const ofTestStudent = await tx().attendanceRecord.create({
        data: {
          sessionId,
          programId: world.programId,
          enrollmentId: testStudent.id,
          status: "PRESENT",
          source: "SELF_CHECK_IN",
          checkedInAt: new Date("2026-09-14T13:03:00Z"),
        },
        select: { id: true },
      });
      testStudentRecordId = ofTestStudent.id;
    });

    it("emits the session under the program's Attendance class with its day as a string", async () => {
      const records = await walkAll<Positioned & { classId: string; date: string }>(
        tx(),
        COLLECTIONS.sessions,
        1,
      );
      const session = records.find((record) => record.externalId === sessionId)!;
      expect(session.classId).toBe(attendanceClassId(world.programId));
      expect(session.date).toBe("2026-09-14");
    });

    it("emits the fellow's record and not the test student's", async () => {
      const records = await walkAll<
        Positioned & { sessionId: string; enrollmentId: string; status: string }
      >(tx(), COLLECTIONS.attendance, 1);
      const seen = oursAmong(records, new Set([presentRecordId, testStudentRecordId]));
      expect(seen).toEqual([presentRecordId]);

      const present = records.find((record) => record.externalId === presentRecordId)!;
      expect(present.sessionId).toBe(sessionId);
      expect(present.enrollmentId).toBe(world.students[0].id);
      expect(present.status).toBe("PRESENT");
    });
  });

  describe("gcf attempts", () => {
    let attemptId: string;
    let testStudentAttemptId: string;
    /** A fellow enrolled twice, to show the more recent enrollment is the one named. */
    let repeaterStudentId: string;
    let repeaterLaterEnrollmentId: string;
    let repeaterAttemptId: string;

    beforeAll(async () => {
      const attempt = await tx().gcfAttempt.create({
        data: {
          studentId: world.students[0].studentId,
          kind: "PROCTORED",
          score: 512,
          takenOn: new Date("2026-09-10T00:00:00Z"),
        },
        select: { id: true },
      });
      attemptId = attempt.id;

      const ofTestStudent = await tx().gcfAttempt.create({
        data: {
          studentId: testStudent.studentId,
          kind: "MOCK",
          score: 600,
          scorePossible: 900,
          takenOn: new Date("2026-09-10T00:00:00Z"),
        },
        select: { id: true },
      });
      testStudentAttemptId = ofTestStudent.id;

      repeaterStudentId = await makeAccount(tx());
      const earlierEnrollment = await enroll(tx(), {
        programId: otherProgramId,
        studentId: repeaterStudentId,
        status: "REMOVED",
      });
      /*
        Both enrollments are created inside one transaction, and `createdAt` defaults to the
        database's `now()` — which is the transaction's start, the same instant for both. In the
        application they are made in separate requests, months apart; here the earlier one has to
        be moved back by hand or "most recent" is a coin toss.
      */
      await tx().enrollment.update({
        where: { id: earlierEnrollment.id },
        data: { createdAt: new Date("2025-01-15T12:00:00Z") },
      });
      const laterEnrollment = await enroll(tx(), {
        programId: world.programId,
        studentId: repeaterStudentId,
      });
      repeaterLaterEnrollmentId = laterEnrollment.id;
      const repeaterAttempt = await tx().gcfAttempt.create({
        data: {
          studentId: repeaterStudentId,
          kind: "PROCTORED",
          score: 430,
          takenOn: new Date("2026-03-01T00:00:00Z"),
        },
        select: { id: true },
      });
      repeaterAttemptId = repeaterAttempt.id;
    });

    it("names the Contact and the most recent enrollment, emits the day as a string, and leaves the test student out", async () => {
      const records = await walkAll<
        Positioned & {
          contactId: string;
          enrollmentId: string | null;
          takenOn: string;
          kind: string;
        }
      >(tx(), COLLECTIONS["gcf-attempts"], 1);
      const seen = oursAmong(
        records,
        new Set([attemptId, testStudentAttemptId, repeaterAttemptId]),
      );
      expect(seen.sort()).toEqual([attemptId, repeaterAttemptId].sort());

      const attempt = records.find((record) => record.externalId === attemptId)!;
      expect(attempt.contactId).toBe(world.students[0].studentId);
      expect(attempt.enrollmentId).toBe(world.students[0].id);
      expect(attempt.takenOn).toBe("2026-09-10");
      expect(attempt.kind).toBe("PROCTORED");

      const repeater = records.find((record) => record.externalId === repeaterAttemptId)!;
      expect(repeater.enrollmentId).toBe(repeaterLaterEnrollmentId);
    });
  });

  describe("registrations", () => {
    let removedEnrollmentId: string;

    beforeAll(async () => {
      const removedStudentId = await makeAccount(tx());
      const removed = await enroll(tx(), {
        programId: world.programId,
        studentId: removedStudentId,
        status: "REMOVED",
      });
      removedEnrollmentId = removed.id;
    });

    it("pairs every published course with every enrollment in its program, removed included, test students excluded, nothing across programs", async () => {
      const records = await walkAll<
        Positioned & { classId: string; enrollmentId: string; enrollmentStatus: string }
      >(tx(), COLLECTIONS.registrations, 2);

      const expected = [
        registrationKey(world.courseId, world.students[0].id),
        registrationKey(world.courseId, world.students[1].id),
        registrationKey(world.courseId, removedEnrollmentId),
      ];
      const excluded = [
        registrationKey(world.courseId, testStudent.id),
        // The other program's course paired with this program's fellow: must not exist.
        registrationKey(otherCourseId, world.students[0].id),
      ];
      const seen = oursAmong(records, new Set([...expected, ...excluded]));

      expect(seen.sort()).toEqual(expected.sort());

      const removed = records.find(
        (record) => record.externalId === registrationKey(world.courseId, removedEnrollmentId),
      )!;
      expect(removed.enrollmentStatus).toBe("REMOVED");
      expect(removed.classId).toBe(world.courseId);
      expect(removed.enrollmentId).toBe(removedEnrollmentId);
    });
  });

  describe("the submissions grid", () => {
    let assignmentId: string;
    let removedEnrollment: { id: string; studentId: string };

    beforeAll(async () => {
      const assignment = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        kind: "REPO",
        pointValue: 40,
        dueAt: new Date("2026-02-01T05:00:00Z"),
      });
      assignmentId = assignment.id;

      // The first fellow has a released grade, handed in late; the second has never started.
      await makeSubmission(tx(), {
        assignmentId,
        studentId: world.students[0].studentId,
        submittedAt: new Date("2026-02-02T12:00:00Z"),
        graded: { score: 34, possible: 40, isComplete: true },
      });

      // A removed fellow with a real row: the row is sent, no notStarted is invented for them.
      const removedStudentId = await makeAccount(tx());
      const removed = await enroll(tx(), {
        programId: world.programId,
        studentId: removedStudentId,
        status: "REMOVED",
      });
      removedEnrollment = { id: removed.id, studentId: removedStudentId };
      await makeSubmission(tx(), {
        assignmentId,
        studentId: removedStudentId,
        status: "SUBMITTED",
      });

      // A second assignment the removed fellow never touched: no record for them at all.
      await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        kind: "TASK",
      });
    });

    it("holds one record per active fellow per assignment, real rows for removed fellows, and nothing for the test student", async () => {
      const records = await walkAll<
        Positioned & {
          status: string;
          score: number | null;
          lateness: string | null;
          registrationId: string;
        }
      >(tx(), COLLECTIONS.submissions, 2);

      const graded = submissionKey(assignmentId, world.students[0].id);
      const unstarted = submissionKey(assignmentId, world.students[1].id);
      const removedReal = submissionKey(assignmentId, removedEnrollment.id);
      const ofTestStudent = submissionKey(assignmentId, testStudent.id);

      const seen = oursAmong(records, new Set([graded, unstarted, removedReal, ofTestStudent]));
      expect(seen.sort()).toEqual([graded, unstarted, removedReal].sort());

      const gradedRecord = records.find((record) => record.externalId === graded)!;
      expect(gradedRecord.status).toBe("graded");
      expect(gradedRecord.score).toBe(34);
      expect(gradedRecord.lateness).toBe("late");
      expect(gradedRecord.registrationId).toBe(
        registrationKey(world.courseId, world.students[0].id),
      );

      const unstartedRecord = records.find((record) => record.externalId === unstarted)!;
      expect(unstartedRecord.status).toBe("notStarted");
      expect(unstartedRecord.score).toBeNull();
      expect(unstartedRecord.lateness).toBeNull();

      const removedRecord = records.find((record) => record.externalId === removedReal)!;
      expect(removedRecord.status).toBe("submitted");
    });

    it("invents no notStarted record for a removed fellow", async () => {
      const records = await walkAll(tx(), COLLECTIONS.submissions, 50);
      const forRemoved = records.filter((record) =>
        record.externalId.endsWith(`:${removedEnrollment.id}`),
      );
      // Exactly the one real row from the first assignment; nothing for the second.
      expect(forRemoved.map((record) => record.externalId)).toEqual([
        submissionKey(assignmentId, removedEnrollment.id),
      ]);
    });
  });

  describe("the walk itself", () => {
    it("returns every record of every collection exactly once at limit 1", async () => {
      for (const name of COLLECTION_NAMES) {
        const records = await walkAll(tx(), COLLECTIONS[name], 1);
        const ids = records.map((record) => record.externalId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it("returns a record again when it changes mid-walk, because its position moved past the cursor", async () => {
      // Page one at limit 1 is the earliest program; touch it so it moves to the end.
      const first = await COLLECTIONS.programs(tx(), { cursor: null, limit: 1 });
      const touched = first.records[0]!.externalId;
      await tx().program.update({
        where: { id: touched },
        data: { name: `Touched ${Date.now()}` },
      });

      // Continue from page one's cursor to the end.
      const rest: Positioned[] = [];
      let cursor: Cursor = first.hasMore
        ? { since: new Date(first.cursor!.since), after: first.cursor!.after }
        : null;
      while (cursor !== null) {
        const page = await COLLECTIONS.programs(tx(), { cursor, limit: 1 });
        rest.push(...page.records);
        cursor = page.hasMore
          ? { since: new Date(page.cursor!.since), after: page.cursor!.after }
          : null;
      }

      expect(rest.map((record) => record.externalId)).toContain(touched);
    });
  });
});
