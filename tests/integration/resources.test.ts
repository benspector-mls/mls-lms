/**
 * Readings, notes, and videos through the procedures that write them.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * The pure half of `verify:resources` — which URLs are videos, what a valid spec is, and what
 * columns one becomes — is `tests/lib/resources/video.test.ts` and
 * `tests/lib/resources/spec.test.ts`, where it needs no database and runs on every save. What is
 * left is the half a database is required for, and it is mostly authorization: a resource id says
 * nothing about which course it belongs to until the row is read, and the whole point of a
 * module-scoped write is that one cohort's instructor cannot file a reading in another's.
 *
 * The other half is order. A module's readings are a sequence an instructor chose, recorded in
 * `position` and decided on the server, so the student page, the Modules screen, and the Resources
 * screen cannot each pick their own.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Every row it reads it
 * also wrote, in that same transaction, so it depends on nothing having been seeded.
 *
 * Carries the 32 assertions `verify:resources` made against the database. Four of them had never
 * run: the script looked for a module of another course and for an instructor teaching no course of
 * this one, found neither on a seeded database, and printed a line saying so — an ordinary
 * `console.log`, which counted as neither a pass nor a failure. Both fixtures are built here, so
 * those four checks always run. One of the four is also stronger than the script could make it: the
 * second course is one this same instructor teaches, so the refusal to file a resource into its
 * module is demonstrably about the course the module belongs to rather than about what the
 * instructor is allowed to touch.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  addInstructor,
  makeAccount,
  makeCourse,
  makeProgram,
  makeUnit,
  makeWorld,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/**
 * What a call refused with, as a string to compare against.
 *
 * The literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes a
 * missing guard a visible failure rather than a passing test.
 */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/**
 * The titles this run gives its resources, for the last group to look for in the committed database.
 *
 * A unique suffix because the development Supabase project is shared, and a fixed title could
 * collide with a reading somebody actually filed.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const zebra = `Integration Zebra ${suffix}`;
const apple = `Integration Apple ${suffix}`;
const mango = `Integration Mango ${suffix}`;
const cascadeUnitName = `Integration Cascade Unit ${suffix}`;
const cascadeResourceTitle = `Integration Cascade ${suffix}`;
const titlesUsed = [zebra, `${zebra} renamed`, apple, mango, cascadeResourceTitle];

describe("a module's readings, notes, and videos", () => {
  const tx = withRollback();

  let world: Awaited<ReturnType<typeof makeWorld>>;
  /** The module the three resources are created in. */
  let firstModule: { id: string };
  /** A second module of the same course, so moving one between modules is a real move. */
  let secondModule: { id: string };
  /** A module of a second course that this same instructor also teaches. */
  let elsewhereModule: { id: string };
  /** An instructor of a different program entirely. */
  let outsiderId: string;

  let link: { id: string; kind: string; description: string | null };
  let note: { id: string; body: string | null };
  let video: { id: string; videoProvider: string | null };

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), world.student.studentId);
  const listed = () => asInstructor().resources.listForCourse({ courseId: world.courseId });

  beforeAll(async () => {
    world = await makeWorld(tx());
    firstModule = { id: world.unitId };
    secondModule = await makeUnit(tx(), { courseId: world.courseId, name: "Mod 1 - Second" });

    /*
      A second course of the same program, taught by the same instructor. The script could only ask
      the database for a module of some other course and skipped when it found none; building one
      the instructor teaches makes the refusal below unambiguous, because authorization cannot be
      the reason for it.
    */
    const otherCourse = await makeCourse(tx(), { programId: world.programId });
    /*
      The course row only. `addInstructor` writes both rows and is the right helper when somebody
      joins a program, but this instructor is already an instructor of this program — `makeWorld`
      made that row — and `ProgramInstructor` is unique on the pair.
    */
    await tx().courseInstructor.create({
      data: {
        courseId: otherCourse.id,
        programId: world.programId,
        userId: world.instructorId,
      },
    });
    elsewhereModule = await makeUnit(tx(), { courseId: otherCourse.id, name: "Mod 1 - Elsewhere" });

    // An instructor of another program, which is the question the INSTRUCTOR role alone cannot ask.
    const otherProgram = await makeProgram(tx(), { name: "Elsewhere (integration: resources)" });
    outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });
    await addInstructor(tx(), { programId: otherProgram.id, userId: outsiderId });
  });

  describe("adding one of each kind", () => {
    beforeAll(async () => {
      /*
        Created as Zebra, Apple, Mango deliberately, and in that order. They come back in it below,
        so the alphabet demonstrably is not what decides the sequence.
      */
      link = await asInstructor().resources.create({
        courseUnitId: firstModule.id,
        spec: {
          kind: "LINK",
          title: zebra,
          url: "https://developer.mozilla.org/",
          description: "  Read the first two sections.  ",
        },
      });
      note = await asInstructor().resources.create({
        courseUnitId: firstModule.id,
        spec: { kind: "TEXT", title: apple, body: "## Hello\n\nSome prose." },
      });
      video = await asInstructor().resources.create({
        courseUnitId: firstModule.id,
        spec: { kind: "VIDEO", title: mango, url: "https://youtu.be/dQw4w9WgXcQ" },
      });
    });

    it("a link is created", () => {
      expect(link.kind).toBe("LINK");
    });

    it("...with its description trimmed", () => {
      expect(link.description).toBe("Read the first two sections.");
    });

    it("a note is created with its markdown", () => {
      expect(note.body?.startsWith("## Hello")).toBe(true);
    });

    it("a video stores its provider", () => {
      expect(video.videoProvider).toBe("YOUTUBE");
    });

    /*
      The refusal happens in the procedure and not only in the form. Both are wanted — the form so
      an instructor is told as they type, the procedure because the form is not what actually
      decides what gets stored.
    */
    it("an unrecognised video link is refused by the procedure, not only the form", async () => {
      const code = await refusal(() =>
        asInstructor().resources.create({
          courseUnitId: firstModule.id,
          spec: { kind: "VIDEO", title: "Nope", url: "https://www.loom.com/share/a" },
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });

  /*
    The order an instructor put them in, decided on the server so that three screens cannot each
    pick their own.
  */
  describe("the order they come back in", () => {
    let rows: Awaited<ReturnType<typeof listed>>;

    beforeAll(async () => {
      rows = await listed();
    });

    it("resources come back in creation order, not alphabetically", () => {
      expect(rows.map((row) => row.title)).toEqual([zebra, apple, mango]);
    });

    it("...and all three are there", () => {
      expect(rows).toHaveLength(3);
    });

    // Each was added at the end of the module, so each sits after the one before it.
    it("...each added at the end, so their positions ascend", () => {
      const positions = rows.map((row) => row.position);
      expect(
        positions.every((position, index) => index === 0 || position > positions[index - 1]!),
      ).toBe(true);
    });
  });

  describe("reordering", () => {
    /** The three ids in the reverse of the order they were created in. */
    let reversed: string[];
    let afterReorder: Awaited<ReturnType<typeof listed>>;

    beforeAll(async () => {
      const inModule = (await listed()).filter((row) => row.courseUnitId === firstModule.id);
      reversed = [...inModule].reverse().map((row) => row.id);
      await asInstructor().resources.reorder({
        courseUnitId: firstModule.id,
        resourceIds: reversed,
      });
      afterReorder = (await listed()).filter((row) => row.courseUnitId === firstModule.id);
    });

    it("reordering rewrites every position from the list", () => {
      expect(afterReorder.map((row) => row.id)).toEqual(reversed);
    });

    it("...as a dense sequence from zero", () => {
      expect(afterReorder.map((row) => row.position)).toEqual(reversed.map((_, index) => index));
    });

    /*
      A partial list is refused. Sending only the resources that moved would leave the omitted ones
      holding stale positions — an order nobody asked for, and one that would look on the screen
      afterwards like the move half worked.
    */
    it("a partial order is refused", async () => {
      const code = await refusal(() =>
        asInstructor().resources.reorder({
          courseUnitId: firstModule.id,
          resourceIds: [reversed[0]!],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("an order listing a resource twice is refused", async () => {
      const code = await refusal(() =>
        asInstructor().resources.reorder({
          courseUnitId: firstModule.id,
          resourceIds: [...reversed, reversed[0]!],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("a student cannot reorder a module's resources", async () => {
      const code = await refusal(() =>
        asStudent().resources.reorder({ courseUnitId: firstModule.id, resourceIds: reversed }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    A student reads exactly the same rows. There is no draft state on a resource, so unlike
    `assignments.listForCourse` this procedure has no publish filter — worth checking rather than
    assuming, because the neighbouring procedure does the opposite and a reader could reasonably
    expect either.
  */
  it("a student sees the same resources an instructor does", async () => {
    const seenByStudent = await asStudent().resources.listForCourse({ courseId: world.courseId });
    expect(seenByStudent).toHaveLength((await listed()).length);
  });

  describe("editing", () => {
    /*
      The check that makes changing a kind safe. A note turned into a link keeps its title and loses
      its body — a row carrying both would be two things at once, and the next reader to trust
      either column renders something nobody wrote.
    */
    it("changing a kind clears the old kind's columns", async () => {
      const retyped = await asInstructor().resources.update({
        resourceId: note.id,
        spec: { kind: "LINK", title: apple, url: "https://a.example", description: null },
      });
      expect([retyped.kind, retyped.body]).toEqual(["LINK", null]);
    });

    describe("moving to another module of the same course", () => {
      /**
       * Where the destination module's sequence ended before the move, worked out here rather than
       * read back from the procedure that is under test.
       */
      let endOfDestination: number;
      let moved: { courseUnitId: string; position: number };

      beforeAll(async () => {
        endOfDestination = (await listed())
          .filter((row) => row.courseUnitId === secondModule.id)
          .reduce((highest, row) => Math.max(highest, row.position), -1);

        moved = await asInstructor().resources.update({
          resourceId: link.id,
          courseUnitId: secondModule.id,
          spec: { kind: "LINK", title: zebra, url: "https://a.example", description: null },
        });
      });

      it("a resource can be moved to another module of the same course", () => {
        expect(moved.courseUnitId).toBe(secondModule.id);
      });

      /*
        At the end of the module it moved to, rather than keeping the position it held in the module
        it left — which would drop it into the middle of a sequence it has never been part of,
        between two resources an instructor deliberately put next to each other.
      */
      it("...landing at the end of that module", () => {
        expect(moved.position).toBe(endOfDestination + 1);
      });

      // And a plain edit leaves the position alone, or fixing a typo would move the row.
      it("an edit that changes no module leaves the position alone", async () => {
        const renamed = await asInstructor().resources.update({
          resourceId: link.id,
          courseUnitId: secondModule.id,
          spec: {
            kind: "LINK",
            title: `${zebra} renamed`,
            url: "https://a.example",
            description: null,
          },
        });
        expect(renamed.position).toBe(moved.position);
      });
    });

    /*
      A module from another course is refused. Filed there, a resource is invisible on the course it
      belongs to and appears on one it does not, and nothing on either screen would explain it. The
      foreign key would accept it happily, which is why this is checked.

      The destination is a module of a course this same instructor teaches, so the refusal is about
      the course the module belongs to and cannot be a permission check firing early.
    */
    it("a module from another course is refused", async () => {
      const code = await refusal(() =>
        asInstructor().resources.update({
          resourceId: link.id,
          courseUnitId: elsewhereModule.id,
          spec: { kind: "LINK", title: zebra, url: "https://a.example", description: null },
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });

  /*
    The Modules screen and the student's course page both read resources through
    `courseUnits.listForCourse`, so its own list has to carry them and in the same order.
  */
  describe("where they appear", () => {
    let holding: { resources: { id: string }[] } | undefined;

    beforeAll(async () => {
      const modules = await asInstructor().courseUnits.listForCourse({ courseId: world.courseId });
      holding = modules.find((row) => row.id === firstModule.id);
    });

    it("the module list carries its resources", () => {
      expect((holding?.resources.length ?? 0) > 0).toBe(true);
    });

    /*
      The same order, checked against the other procedure rather than against a rule. The order is a
      column rather than something either procedure derives, so the only thing worth asserting is
      that the two agree — which is the property that actually matters, and the one a second
      `orderBy` drifting would break.
    */
    it("...in the same order the resources procedure gives", async () => {
      const fromResources = (await listed())
        .filter((row) => row.courseUnitId === firstModule.id)
        .map((row) => row.id);
      expect(holding!.resources.map((row) => row.id)).toEqual(fromResources);
    });
  });

  describe("who may do any of this", () => {
    it("a student cannot add a resource", async () => {
      const code = await refusal(() =>
        asStudent().resources.create({
          courseUnitId: firstModule.id,
          spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a student cannot edit one", async () => {
      const code = await refusal(() =>
        asStudent().resources.update({
          resourceId: video.id,
          spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a student cannot remove one", async () => {
      const code = await refusal(() => asStudent().resources.remove({ resourceId: video.id }));
      expect(code).toBe("FORBIDDEN");
    });

    /*
      The check the INSTRUCTOR role alone cannot make, asked as the question it is about rather than
      by a proxy for it. The role says nothing about *which* programs, so without this one term's
      instructor could file readings in another term's modules.

      The outsider is built here rather than looked for. The script asked the database for an
      INSTRUCTOR teaching no course of this course's program, found none on a seeded database, and
      printed a line saying so — so these three checks had simply not been running.
    */
    it("an instructor who does not teach the course cannot add a resource to it", async () => {
      const code = await refusal(() =>
        createCaller(tx(), outsiderId).resources.create({
          courseUnitId: firstModule.id,
          spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("...nor edit one", async () => {
      const code = await refusal(() =>
        createCaller(tx(), outsiderId).resources.update({
          resourceId: video.id,
          spec: { kind: "LINK", title: "Nope", url: "https://a.example", description: null },
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("...nor remove one", async () => {
      const code = await refusal(() =>
        createCaller(tx(), outsiderId).resources.remove({ resourceId: video.id }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("removing", () => {
    it("a resource can be removed", async () => {
      const removed = await asInstructor().resources.remove({ resourceId: video.id });
      expect(removed.title).toBe(mango);
    });

    it("...and is gone from the list", async () => {
      expect((await listed()).some((row) => row.id === video.id)).toBe(false);
    });
  });
});

/*
  What the database does on its own, in a transaction of its own because it writes and deletes rows
  rather than driving a procedure.

  A resource cascades with its module, which is the opposite of what an assignment gets and right
  for the opposite reason: `courseUnits.remove` refuses while assignments reference the module,
  because those carry submissions and grades. A resource carries a title and a link, so refusing to
  remove an otherwise-empty module because somebody left a reading in it would be a guard against
  nothing.
*/
describe("a resource and the module it belongs to", () => {
  const tx = withRollback();

  it("a resource is deleted with its module", async () => {
    const world = await makeWorld(tx());
    const scratch = await makeUnit(tx(), { courseId: world.courseId, name: cascadeUnitName });
    await tx().resource.create({
      data: {
        courseUnitId: scratch.id,
        kind: "LINK",
        title: cascadeResourceTitle,
        url: "https://a.example",
        position: 0,
      },
    });

    await tx().courseUnit.delete({ where: { id: scratch.id } });
    expect(await tx().resource.count({ where: { courseUnitId: scratch.id } })).toBe(0);
  });
});

/*
  Both groups above rolled their transactions back, and this is the check that says so. It reads the
  committed database, outside any transaction, after both have ended — which is what makes it safe
  to point this suite at a database somebody is using.
*/
describe("the rollback really rolled back", () => {
  it("no resource this run created survived", async () => {
    expect(await db.resource.count({ where: { title: { in: titlesUsed } } })).toBe(0);
  });

  it("...nor the module the cascade check made", async () => {
    expect(await db.courseUnit.count({ where: { name: cascadeUnitName } })).toBe(0);
  });
});
