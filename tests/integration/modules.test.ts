/**
 * The modules of a course: create, rename, reorder, remove.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is most of what these procedures are: every one of them has to check that the caller teaches
 * *this* course, and a module id says nothing about which course it is in until the row is read. A
 * check that only holds when the function is called some other way is not a check on what an
 * instructor uses.
 *
 * Every row it reads it also wrote, in that same transaction, so it depends on nothing having been
 * seeded and says in the test what it assumes.
 *
 * The case worth reading is the foreign key. Removing a module that still holds assignments would
 * leave them belonging to nothing, and both the procedure and the constraint refuse it — the
 * procedure so the instructor gets a count and something to do about it, the constraint so that a
 * second caller written later cannot get it wrong.
 *
 * Carries the 41 assertions `verify:modules` reported on 2 September 2026, and one more. The extra
 * is the outsider instructor: the script looked for an INSTRUCTOR teaching no course of this
 * program, found none on a seeded database, and printed `skip` — an ordinary `console.log`, which
 * neither failed the run nor counted, so the check had quietly not run for as long as the seed has
 * had one instructor. It makes its own outsider here and therefore always runs.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  makeAccount,
  makeAssignment,
  makeCourse,
  makeProgram,
  makeUnit,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/**
 * The names this run created, for the last group to look for in the committed database.
 *
 * Collected as the groups run rather than written down a second time, so "nothing survived the
 * rollback" asks about the rows this run actually made. They carry a unique suffix because the
 * development database is shared and a fixed name could collide with a real module.
 */
const namesUsed: string[] = [];
const suffix = crypto.randomUUID().slice(0, 8);
const named = (label: string) => {
  const name = `${label} ${suffix}`;
  namesUsed.push(name);
  return name;
};

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

describe("creating, renaming, reordering and removing a course's modules", () => {
  const tx = withRollback();

  /*
    State built up across the group, in the order the checks read it. These procedures renumber a
    shared sequence, so a position captured before a placement is no longer the one to compare
    against — which is why the checks run in this order and share these values rather than each
    rebuilding a fixture.
  */
  let world: World;
  let first: { id: string; position: number };
  let second: { id: string; position: number };
  let trimmed: { id: string; name: string };
  let reversed: string[];
  let lastBefore: number;

  beforeAll(async () => {
    world = await makeWorld(tx());
    // A unit holding work, for the removal guard below to refuse.
    await makeAssignment(tx(), { courseId: world.courseId, courseUnitId: world.unitId });

    const before = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
      courseId: world.courseId,
    });
    /*
      Measured against the last position, not against the count. Those are the same number only
      while positions run 0..n-1 with no gaps, and `remove` deliberately leaves a gap rather than
      renumbering — order is what `position` decides, and a gap does not change it.
    */
    lastBefore = Math.max(-1, ...before.map((row) => row.position));

    first = await createCaller(tx(), world.instructorId).courseUnits.create({
      category: "MODULE",
      courseId: world.courseId,
      name: named("Mod 98 - One"),
    });
    second = await createCaller(tx(), world.instructorId).courseUnits.create({
      category: "MODULE",
      courseId: world.courseId,
      name: named("Mod 99 - Two"),
    });
  });

  it("a new module goes at the end", () => {
    expect(second.position).toBe(lastBefore + 2);
  });

  it("...and the one before it, before that", () => {
    expect(first.position).toBe(lastBefore + 1);
  });

  // Trimmed, because " Mod 98" and "Mod 98" are the same module to everyone but the database, and
  // a leading space is invisible in the interface it would collide in.
  it("a name is trimmed", async () => {
    const padded = named("Mod 97 - Padded");
    trimmed = await createCaller(tx(), world.instructorId).courseUnits.create({
      category: "MODULE",
      courseId: world.courseId,
      name: `   ${padded}   `,
    });
    expect(trimmed.name).toBe(padded);
  });

  it("a blank name is refused", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).courseUnits.create({
        category: "MODULE",
        courseId: world.courseId,
        name: "   ",
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  // The operation the tag-based design could not offer at all: with the name as the identity,
  // renaming meant rewriting every assignment that used it.
  describe("renaming", () => {
    let renamed: { name: string; position: number };
    let newName: string;

    beforeAll(async () => {
      newName = named("Mod 98 - Renamed");
      renamed = await createCaller(tx(), world.instructorId).courseUnits.update({
        courseUnitId: first.id,
        name: newName,
      });
    });

    it("renaming changes the name", () => {
      expect(renamed.name).toBe(newName);
    });

    it("...and not the position", () => {
      expect(renamed.position).toBe(first.position);
    });
  });

  describe("reordering", () => {
    let afterReorder: { id: string; position: number }[];

    beforeAll(async () => {
      const listed = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
      reversed = [...listed].reverse().map((row) => row.id);
      await createCaller(tx(), world.instructorId).courseUnits.reorder({
        courseId: world.courseId,
        courseUnitIds: reversed,
      });
      afterReorder = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
    });

    it("reordering rewrites every position from the list", () => {
      expect(afterReorder.map((row) => row.id)).toEqual(reversed);
    });

    it("...as a dense sequence from zero", () => {
      expect(afterReorder.map((row) => row.position)).toEqual(reversed.map((_, index) => index));
    });

    /*
      A partial list is refused. Sending only the modules that moved would leave the omitted ones
      holding stale positions — an order nobody asked for, and one that would look like the reorder
      half worked.
    */
    it("a partial order is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).courseUnits.reorder({
          courseId: world.courseId,
          courseUnitIds: [first.id],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    it("an order listing a module twice is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).courseUnits.reorder({
          courseId: world.courseId,
          courseUnitIds: [...reversed, first.id],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });

  /*
    Why `placement` exists at all: a unit belonging in the middle of a term used to be created at
    the end and then walked up the list, one write per position. These checks come after the
    reordering ones deliberately — placing a unit renumbers the sequence, so a position captured
    earlier is no longer the one to compare against.
  */
  describe("placing a new unit in the sequence", () => {
    let sequenceBefore: { id: string }[];
    let atStart: { id: string };
    let withStart: { id: string; position: number }[];
    let anchor: { id: string };
    let placedAfter: { id: string };
    let withAfter: { id: string; position: number }[];

    beforeAll(async () => {
      sequenceBefore = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
      atStart = await createCaller(tx(), world.instructorId).courseUnits.create({
        category: "PROJECT",
        courseId: world.courseId,
        name: named("Mod 96 - Placed First"),
        placement: { at: "start" },
      });
      withStart = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
    });

    it("a unit placed at the start comes first", () => {
      expect(withStart[0]!.id).toBe(atStart.id);
    });

    it("...and everything it displaced keeps its own order", () => {
      expect(withStart.slice(1).map((row) => row.id)).toEqual(sequenceBefore.map((row) => row.id));
    });

    it("...over a sequence renumbered densely from zero", () => {
      expect(withStart.map((row) => row.position)).toEqual(withStart.map((_, index) => index));
    });

    /*
      Placed after a unit, not at a number. The anchor here is the module that is now second, and a
      project going after it is the ordinary case — the sequence is shared, so what the anchor's
      category is does not enter into it.
    */
    it("a unit placed after another sits immediately after it", async () => {
      anchor = withStart[1]!;
      placedAfter = await createCaller(tx(), world.instructorId).courseUnits.create({
        category: "ASSESSMENT",
        courseId: world.courseId,
        name: named("Mod 95 - Placed After"),
        placement: { at: "after", courseUnitId: anchor.id },
      });
      withAfter = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });

      expect(withAfter.findIndex((row) => row.id === placedAfter.id)).toBe(
        withAfter.findIndex((row) => row.id === anchor.id) + 1,
      );
    });

    it("...and the sequence is still dense from zero", () => {
      expect(withAfter.map((row) => row.position)).toEqual(withAfter.map((_, index) => index));
    });

    // Placing after the unit that is already last is the end, and takes the same path as asking for
    // the end outright.
    it("placing after the last unit is the end", async () => {
      const placedLast = await createCaller(tx(), world.instructorId).courseUnits.create({
        category: "MODULE",
        courseId: world.courseId,
        name: named("Mod 94 - Placed Last"),
        placement: { at: "after", courseUnitId: withAfter.at(-1)!.id },
      });
      const withLast = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
      expect(withLast.at(-1)!.id).toBe(placedLast.id);
    });

    /*
      An anchor this course does not have is refused rather than quietly appended. A stale one is a
      unit another instructor removed while the form was open, and landing the new unit at the end
      would put it somewhere nobody chose and nobody would think to check.
    */
    it("placing after a unit that is not in this course is refused", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).courseUnits.create({
          category: "MODULE",
          courseId: world.courseId,
          name: named("Mod 93 - Nowhere"),
          placement: { at: "after", courseUnitId: "00000000-0000-4000-8000-000000000000" },
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });

  describe("removing", () => {
    it("an empty module can be removed", async () => {
      const removed = await createCaller(tx(), world.instructorId).courseUnits.remove({
        courseUnitId: trimmed.id,
      });
      expect(removed.name).toBe(trimmed.name);
    });

    /*
      The case this whole guard exists for: the unit made in `beforeAll` holds an assignment, and
      removing it would leave that assignment belonging to nothing.
    */
    it("a module holding assignments cannot be removed", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).courseUnits.remove({ courseUnitId: world.unitId }),
      );
      expect(code).toBe("CONFLICT");
    });
  });

  describe("who may do any of this", () => {
    it("a student cannot create a module", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.student.studentId).courseUnits.create({
          category: "MODULE",
          courseId: world.courseId,
          name: "Nope",
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a student cannot rename one", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.student.studentId).courseUnits.update({
          courseUnitId: second.id,
          name: "Nope",
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a student cannot reorder them", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.student.studentId).courseUnits.reorder({
          courseId: world.courseId,
          courseUnitIds: reversed,
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("a student cannot remove one", async () => {
      const code = await refusal(() =>
        createCaller(tx(), world.student.studentId).courseUnits.remove({ courseUnitId: second.id }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    // A student may *read* them, because their own course page groups assignments by module.
    it("a student can read the list", async () => {
      const listed = await createCaller(tx(), world.student.studentId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
      expect(listed.length).toBeGreaterThan(0);
    });
  });

  /*
    ---- What the list now carries, and who may see it ------------------------

    The procedure returns each module's assignments so the Modules screen can show the course's
    shape. It still admits students, which is what makes the publish filter the check worth having
    here: without it, this read would hand a cohort the assignments their instructor is still
    writing — a leak no screen would reveal, because a student's own course page is built from a
    different procedure.
  */
  describe("what the list carries", () => {
    let draftHome: { id: string };
    let earliest: { id: string };
    let middle: { id: string };
    let undated: { id: string };
    let draftAssignment: { id: string };
    let asInstructorSees: { assignments: { id: string }[]; _count: { assignments: number } };
    let asStudentSees: { assignments: { id: string }[] };

    beforeAll(async () => {
      draftHome = await createCaller(tx(), world.instructorId).courseUnits.create({
        category: "MODULE",
        courseId: world.courseId,
        name: named("Mod 93 - Ordering"),
      });

      /*
        Deliberately created out of order: the middle one first, then the earliest, then one with no
        date at all. If the ordering came from insertion or from the title, this arrangement would
        pass while measuring nothing.
      */
      middle = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: draftHome.id,
        title: "B - due later",
        dueAt: new Date("2026-10-02T00:00:00Z"),
      });
      earliest = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: draftHome.id,
        title: "C - due first",
        dueAt: new Date("2026-10-01T00:00:00Z"),
      });
      undated = await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: draftHome.id,
        title: "A - no due date",
        dueAt: null,
      });
    });

    /*
      Due date decides, and the undated one is last — not first, which is what a naive ascending
      sort gives on most databases and what would put every assignment nobody has dated yet at the
      top of the module. Alphabetically "A - no due date" comes first, so this ordering is only
      correct if the title is the tie-break rather than the key.
    */
    it("a module's assignments come back in due-date order", async () => {
      const listed = await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      });
      const orderingModule = listed.find((row) => row.id === draftHome.id)!;
      expect(orderingModule.assignments.map((row) => row.id)).toEqual([
        earliest.id,
        middle.id,
        undated.id,
      ]);
    });

    describe("the draft filter, which is why the procedure reads the membership at all", () => {
      beforeAll(async () => {
        draftAssignment = await makeAssignment(tx(), {
          courseId: world.courseId,
          courseUnitId: draftHome.id,
          title: "D - unpublished",
          dueAt: new Date("2026-09-01T00:00:00Z"),
          published: false,
        });
        asInstructorSees = (
          await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
            courseId: world.courseId,
          })
        ).find((row) => row.id === draftHome.id)!;
        asStudentSees = (
          await createCaller(tx(), world.student.studentId).courseUnits.listForCourse({
            courseId: world.courseId,
          })
        ).find((row) => row.id === draftHome.id)!;
      });

      it("an instructor sees an unpublished assignment in the module", () => {
        expect(asInstructorSees.assignments.some((row) => row.id === draftAssignment.id)).toBe(true);
      });

      it("...and a student does not", () => {
        expect(asStudentSees.assignments.some((row) => row.id === draftAssignment.id)).toBe(false);
      });

      // The other three are published, so the student's list is short by exactly the draft.
      it("...and sees everything else in it", () => {
        expect(asStudentSees.assignments).toHaveLength(asInstructorSees.assignments.length - 1);
      });

      /*
        The count is deliberately *not* the length of the list. It decides whether Remove is
        offered, and the foreign key refuses on every assignment including drafts — so a count
        narrowed to what the caller can see would offer a button the procedure then refuses.
      */
      it("the count includes drafts, because removal is refused on them too", () => {
        expect(asInstructorSees._count.assignments).toBe(4);
      });
    });

    /*
      And an empty module is in what the student's page is built from. Their course page renders a
      section per module rather than per module-that-has-work, so a student can see the shape of the
      course ahead of them — which means `courses.get` has to return every module, not only the ones
      with assignments in.
    */
    it("an empty module still reaches the student's course page", async () => {
      const emptyOne = await createCaller(tx(), world.instructorId).courseUnits.create({
        category: "MODULE",
        courseId: world.courseId,
        name: named("Mod 94 - Nothing In It"),
      });
      const asSeenByStudent = await createCaller(tx(), world.student.studentId).courses.get({
        courseId: world.courseId,
      });
      expect(asSeenByStudent.courseUnits.some((row) => row.id === emptyOne.id)).toBe(true);
    });
  });

  describe("an instructor of somewhere else", () => {
    let otherCourseId: string;

    beforeAll(async () => {
      const otherProgram = await makeProgram(tx(), { name: "Elsewhere (integration: modules)" });
      const otherCourse = await makeCourse(tx(), { programId: otherProgram.id });
      otherCourseId = otherCourse.id;
    });

    /*
      An instructor of a different course is the check the role alone cannot make. INSTRUCTOR says
      nothing about *which* programs, so without the program-level test one term's instructor could
      rename another's modules.

      **The outsider is made here rather than looked for.** The script asked the database for an
      INSTRUCTOR teaching no course of this program, found none on a seeded database, and printed a
      line saying so — which counted as neither a pass nor a failure, so this check had simply not
      been running.
    */
    it("an instructor who does not instruct the program cannot rename its modules", async () => {
      const outsiderId = await makeAccount(tx(), { role: "INSTRUCTOR" });

      const code = await refusal(() =>
        createCaller(tx(), outsiderId).courseUnits.update({
          courseUnitId: second.id,
          name: "Not yours",
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    // A module of another course is not this course's to reorder, which `reorder` catches as a list
    // that is not exactly this course's modules.
    it("another course's module cannot be ordered into this one", async () => {
      const elsewhereModule = await makeUnit(tx(), {
        courseId: otherCourseId,
        name: "Mod 1 - Elsewhere",
      });
      const code = await refusal(() =>
        createCaller(tx(), world.instructorId).courseUnits.reorder({
          courseId: world.courseId,
          courseUnitIds: [...reversed.filter((id) => id !== trimmed.id), elsewhereModule.id],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });
});

/*
  Two modules with the same name are indistinguishable in every select an instructor picks from, so
  the database refuses it and the procedure turns that into words. Each in its own transaction: a
  provoked constraint aborts the transaction it happens in, so these cannot share one with the
  checks above.
*/
describe("a duplicate name", () => {
  const tx = withRollback();

  it("a duplicate name in one course is refused", async () => {
    const world = await makeWorld(tx());
    const made = await createCaller(tx(), world.instructorId).courseUnits.create({
      category: "MODULE",
      courseId: world.courseId,
      name: named("Mod 96 - Duplicate Target"),
    });
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).courseUnits.create({
        category: "MODULE",
        courseId: world.courseId,
        name: made.name,
      }),
    );
    expect(code).toBe("CONFLICT");
  });
});

describe("renaming onto a name already taken", () => {
  const tx = withRollback();

  it("renaming onto an existing name is refused", async () => {
    const world = await makeWorld(tx());
    const existing = (
      await createCaller(tx(), world.instructorId).courseUnits.listForCourse({
        courseId: world.courseId,
      })
    )[0]!;
    const other = await createCaller(tx(), world.instructorId).courseUnits.create({
      category: "MODULE",
      courseId: world.courseId,
      name: named("Mod 95 - To Be Renamed"),
    });
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).courseUnits.update({
        courseUnitId: other.id,
        name: existing.name,
      }),
    );
    expect(code).toBe("CONFLICT");
  });
});

/*
  The foreign key refuses it too, so a caller written later cannot get this wrong by skipping the
  procedure. RESTRICT rather than CASCADE is what makes it a refusal instead of a silent deletion of
  the assignments and every graded draft under them.

  Its own transaction, and the last thing that happens in it: the delete is expected to fail, and a
  failed statement aborts the transaction it happens in.
*/
describe("the constraint under the procedure", () => {
  const tx = withRollback();

  it("the foreign key refuses removing a module with assignments", async () => {
    const world = await makeWorld(tx());
    await makeAssignment(tx(), { courseId: world.courseId, courseUnitId: world.unitId });

    let outcome: string;
    try {
      await tx().courseUnit.delete({ where: { id: world.unitId } });
      outcome = "accepted";
    } catch (err) {
      outcome = (err as Error).name;
    }

    expect(outcome).toBe("PrismaClientKnownRequestError");
  });
});

/*
  --- re-seeding does not undo a rename, or duplicate the module ---------------

  The seed used to upsert its modules **by name**, with a comment claiming that survived an
  instructor renaming one. It does the exact opposite: with nothing matching the old name, the
  upsert creates it — so a renamed module ends up beside an empty impostor at the position the seed
  wanted, holding none of the assignments. It happened twice on the development database, and a
  course copied from that one inherited both.

  Checked here rather than trusted, because the seed is run by hand and nothing else would notice.
  This mirrors the seed's module step against a fixture built to be the broken case: a module
  renamed away from the seed's name, with no impostor present yet.
*/
describe("re-seeding a course whose module was renamed", () => {
  const tx = withRollback();

  const SEED_MODULE_NAMES = [
    "Mod 0 - Command Line Interfaces, Git, and GitHub",
    "Mod 1 - JavaScript Fundamentals",
    "Mod 2 - Object-Oriented Programming",
  ];

  let scratchCourseId: string;
  let target: { id: string };
  let secondPass: Map<number, string>;
  let after: { id: string; name: string; position: number }[];
  let createdCount: number;

  /** The seed's own module step, run against the scratch course. */
  async function seedModules() {
    const byPosition = new Map<number, string>();
    for (const [position, name] of SEED_MODULE_NAMES.entries()) {
      const existing = await tx().courseUnit.findFirst({
        where: { courseId: scratchCourseId, position },
        orderBy: { name: "asc" },
        select: { id: true },
      });
      if (existing) {
        byPosition.set(position, existing.id);
        continue;
      }
      const row = await tx().courseUnit.upsert({
        where: { courseId_name: { courseId: scratchCourseId, name } },
        create: { courseId: scratchCourseId, name, position },
        update: {},
        select: { id: true },
      });
      byPosition.set(position, row.id);
    }
    return byPosition;
  }

  beforeAll(async () => {
    const scratchProgram = await makeProgram(tx(), { name: "Integration Reseed" });
    const scratch = await makeCourse(tx(), {
      programId: scratchProgram.id,
      name: "Integration Reseed",
    });
    scratchCourseId = scratch.id;

    await seedModules();
    createdCount = await tx().courseUnit.count({ where: { courseId: scratchCourseId } });

    // An instructor renames the one at position 1, exactly as `modules.rename` does.
    target = (await tx().courseUnit.findFirst({
      where: { courseId: scratchCourseId, position: 1 },
      select: { id: true },
    }))!;
    await tx().courseUnit.update({
      where: { id: target.id },
      data: { name: "Mod 1 - JS Fundamentals" },
    });

    // And the seed runs again.
    secondPass = await seedModules();

    after = await tx().courseUnit.findMany({
      where: { courseId: scratchCourseId },
      select: { id: true, name: true, position: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
  });

  it("seeding a fresh course creates its modules", () => {
    expect(createdCount).toBe(SEED_MODULE_NAMES.length);
  });

  it("re-seeding after a rename creates nothing", () => {
    expect(after).toHaveLength(SEED_MODULE_NAMES.length);
  });

  it("...and does not resurrect the old name", () => {
    expect(after.some((row) => row.name === "Mod 1 - JavaScript Fundamentals")).toBe(false);
  });

  it("...and leaves the rename standing", () => {
    expect(after.find((row) => row.position === 1)?.name).toBe("Mod 1 - JS Fundamentals");
  });

  /*
    The half that makes the fix worth anything. If position 1 resolved to a new row, the seed would
    go on working and quietly file every new assignment in the impostor.
  */
  it("...and position 1 still resolves to the renamed module, so assignments land in it", () => {
    expect(secondPass.get(1)).toBe(target.id);
  });
});

/*
  Every group above rolled its transaction back, and this is the check that says so. It reads the
  committed database, outside any transaction, after all of them have ended — which is what makes
  it safe to point this suite at a database somebody is using.
*/
describe("the rollback really rolled back", () => {
  it("no module this run created survived", async () => {
    const leftover = await db.courseUnit.count({ where: { name: { in: namesUsed } } });
    expect(leftover).toBe(0);
  });

  it("...nor the programs its fixtures made", async () => {
    const leftover = await db.program.count({
      where: { name: { in: ["Integration Reseed", "Elsewhere (integration: modules)"] } },
    });
    expect(leftover).toBe(0);
  });
});
