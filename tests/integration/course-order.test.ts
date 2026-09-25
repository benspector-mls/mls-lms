/**
 * The order the courses of one program appear in, and who may change it.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, for the reason
 * `modules.test.ts` gives: the gate is most of what this procedure is. A course's order is a
 * program fact, so the gate is ownership rather than teaching — an instructor of the program may
 * author in every course of it and still not decide which order the year is read in.
 *
 * The check worth reading is the one about `updated_at`. `writeOrder` sets it from Postgres for
 * every other sequence it writes, and `courses` is the one table in it that the Salesforce feed
 * reads — twice, as a Class and as the position of every Registration hanging off it. Postgres
 * writes `now()` at microsecond precision where the feed's cursor round-trips at milliseconds, so a
 * reorder that touched the column would put those records at the top of every page of the feed
 * forever. Nothing about a position reaches Salesforce, so the column is left alone, and the check
 * below is what says so.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { addInstructor, makeAccount, makeProgram } from "./fixtures";
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

describe("the order the courses of a program appear in", () => {
  const tx = withRollback();

  let programId: string;
  let ownerId: string;
  /** An instructor of the same program who does not own it. */
  let coTeacherId: string;
  /** A course of a different program, for the list that names one it must not. */
  let foreignCourseId: string;

  /** The three courses, in the order they were created. */
  let created: string[];
  let reversed: string[];

  /** Every course of the program, in position order, straight from the rows. */
  const rows = async () =>
    tx().course.findMany({
      where: { programId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, updatedAt: true },
    });

  beforeAll(async () => {
    const program = await makeProgram(tx());
    programId = program.id;

    ownerId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    await addInstructor(tx(), { programId, userId: ownerId, isPrimary: true });

    coTeacherId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    await addInstructor(tx(), { programId, userId: coTeacherId });

    const owner = createCaller(tx(), ownerId);
    created = [];
    for (const name of ["Integration First", "Integration Second", "Integration Third"]) {
      const made = await owner.courses.create({ programId, name });
      created.push(made.course.id);
    }
    reversed = [...created].reverse();

    /*
      A second program the same person instructs, so the refusal below is about the course being
      another program's rather than about the caller not reaching it at all.
    */
    const other = await makeProgram(tx());
    await addInstructor(tx(), { programId: other.id, userId: ownerId, isPrimary: true });
    const foreign = await createCaller(tx(), ownerId).courses.create({
      programId: other.id,
      name: "Integration Elsewhere",
    });
    foreignCourseId = foreign.course.id;
  });

  describe("before anybody reorders anything", () => {
    it("a course is created at the end of the program's sequence", async () => {
      expect((await rows()).map((row) => row.id)).toEqual(created);
    });

    it("...as a dense sequence from zero", async () => {
      expect((await rows()).map((row) => row.position)).toEqual([0, 1, 2]);
    });
  });

  describe("the owner reorders them", () => {
    /** What every course's `updated_at` was set to before the reorder, to the microsecond. */
    const frozen = new Date("2020-01-01T00:00:00.000Z");
    let after: { id: string; position: number; updatedAt: Date }[];

    beforeAll(async () => {
      /*
        Written in raw SQL rather than through Prisma, because `updatedAt` carries `@updatedAt` and
        the point of the check is what the database column holds rather than what Prisma would do
        with a value handed to it.
      */
      await tx().$executeRaw`
        UPDATE "courses" SET updated_at = ${frozen} WHERE program_id = ${programId}::uuid
      `;

      await createCaller(tx(), ownerId).courses.reorder({ programId, courseIds: reversed });
      after = await rows();
    });

    it("the program's courses come back in the order they were given", () => {
      expect(after.map((row) => row.id)).toEqual(reversed);
    });

    it("...as a dense sequence from zero", () => {
      expect(after.map((row) => row.position)).toEqual([0, 1, 2]);
    });

    /*
      The check this file exists for. See the header: `courses` is the one table in `writeOrder`'s
      sequences that the Salesforce feed reads, and a position is not something the feed carries.
    */
    it("and no course's updated_at is touched", () => {
      expect(after.map((row) => row.updatedAt.toISOString())).toEqual([
        frozen.toISOString(),
        frozen.toISOString(),
        frozen.toISOString(),
      ]);
    });

    it("the program settings screen reads the new order", async () => {
      const settings = await createCaller(tx(), ownerId).programs.settings({ programId });
      expect(settings.program.courses.map((course) => course.id)).toEqual(reversed);
    });

    it("...and so does the course list the sidebar is built from", async () => {
      const mine = await createCaller(tx(), ownerId).courses.listMine();
      const ofThisProgram = mine
        .filter((course) => course.program.id === programId)
        .map((course) => course.id);
      expect(ofThisProgram).toEqual(reversed);
    });
  });

  describe("what the procedure refuses", () => {
    it("an instructor who does not own the program is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), coTeacherId).courses.reorder({ programId, courseIds: created }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("...and the order is left as the owner set it", async () => {
      expect((await rows()).map((row) => row.id)).toEqual(reversed);
    });

    it("a partial order is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), ownerId).courses.reorder({ programId, courseIds: [reversed[0]!] }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("an order naming a course twice is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), ownerId).courses.reorder({
          programId,
          courseIds: [...reversed, reversed[0]!],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("an order naming another program's course is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), ownerId).courses.reorder({
          programId,
          courseIds: [...reversed, foreignCourseId],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("...and that course keeps the position its own program gave it", async () => {
      const foreign = await tx().course.findUniqueOrThrow({
        where: { id: foreignCourseId },
        select: { position: true },
      });
      expect(foreign.position).toBe(0);
    });
  });

  /*
    Nothing above committed. The suite writes through a transaction that is rolled back, so the
    courses it made are not in the database once the run is over — the same last word every other
    integration suite has.
  */
  it("nothing this file created survived the rollback", async () => {
    const left = await db.course.count({ where: { programId } });
    expect(left).toBe(0);
  });
});
