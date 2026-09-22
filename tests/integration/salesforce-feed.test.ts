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
import { attendanceClassId } from "@/lib/integrations/salesforce/records";

import { makeCourse, makeWorld, type World } from "./fixtures";
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
});
