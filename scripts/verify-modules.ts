/**
 * The modules of a course: create, rename, reorder, remove.
 *
 * Run with `npm run verify:modules`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because
 * authorization is most of what these procedures are: every one of them has to check that the
 * caller teaches *this* course, and a module id says nothing about which course it is in until
 * the row is read. A check that only holds when the function is called some other way is not a
 * check on what an instructor uses.
 *
 * The case worth reading is the last group. Removing a module that still holds assignments
 * would leave them belonging to nothing, and both the procedure and the foreign key refuse it —
 * the procedure so the instructor gets a count and something to do about it, the constraint so
 * that a second caller written later cannot get it wrong.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else console.log(`ok   ${label}`);
}

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
 * Runs one check in a transaction of its own, rolled back.
 *
 * **Required for anything that provokes a database constraint**, as opposed to a refusal the
 * procedure makes before touching the database. A failed statement aborts the whole Postgres
 * transaction — every later statement returns `25P02: current transaction is aborted` — so a
 * duplicate-name check cannot share one with the checks that follow it. Found by doing it
 * wrong: the first duplicate refused as expected and took every later check down with it.
 */
async function inOwnTransaction(
  db: typeof import("../lib/prisma").db,
  work: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await work(tx);
      throw new Error("ROLLBACK");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const course = await db.course.findFirst({
    where: { archivedAt: null },
    select: { id: true },
  });
  const instructor = course
    ? await db.courseInstructor.findFirst({
        where: { courseId: course.id },
        select: { userId: true },
      })
    : null;
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { courseId: course.id, status: "ACTIVE" },
        select: { studentId: true },
      })
    : null;

  if (!course || !instructor || !enrollment) {
    console.log("skip — no seeded course with an instructor and a bound student");
    return report();
  }

  const studentId = enrollment.studentId;
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

      const before = await asInstructor.modules.listForCourse({ courseId: course.id });

      // --- creating ---------------------------------------------------------
      const first = await asInstructor.modules.create({
        courseId: course.id,
        name: "Mod 98 - Verify One",
      });
      const second = await asInstructor.modules.create({
        courseId: course.id,
        name: "Mod 99 - Verify Two",
      });

      /*
        Measured against the last position, not against the count.

        Those are the same number only while positions run 0..n-1 with no gaps, and `remove`
        deliberately leaves a gap rather than renumbering — order is what `position` decides,
        and a gap does not change it. Comparing against a count passed by luck and failed as
        soon as a module was removed from the seeded course, which is a check reporting the
        wrong thing rather than a defect it found.
      */
      const lastBefore = Math.max(-1, ...before.map((row) => row.position));
      check("a new module goes at the end", second.position, lastBefore + 2);
      check("...and the one before it, before that", first.position, lastBefore + 1);

      // Trimmed, because " Mod 98" and "Mod 98" are the same module to everyone but the
      // database, and a leading space is invisible in the interface it would collide in.
      const trimmed = await asInstructor.modules.create({
        courseId: course.id,
        name: "   Mod 97 - Padded   ",
      });
      check("a name is trimmed", trimmed.name, "Mod 97 - Padded");

      check("a blank name is refused",
        await refusal(() => asInstructor.modules.create({ courseId: course.id, name: "   " })),
        "BAD_REQUEST");

      // --- renaming ---------------------------------------------------------
      //
      // The operation the tag-based design could not offer at all: with the name as the
      // identity, renaming meant rewriting every assignment that used it.
      const renamed = await asInstructor.modules.rename({
        moduleId: first.id,
        name: "Mod 98 - Renamed",
      });
      check("renaming changes the name", renamed.name, "Mod 98 - Renamed");
      check("...and not the position", renamed.position, first.position);

      // --- reordering -------------------------------------------------------
      const listed = await asInstructor.modules.listForCourse({ courseId: course.id });
      const reversed = [...listed].reverse().map((row) => row.id);
      await asInstructor.modules.reorder({ courseId: course.id, moduleIds: reversed });

      const afterReorder = await asInstructor.modules.listForCourse({ courseId: course.id });
      check("reordering rewrites every position from the list",
        afterReorder.map((row) => row.id), reversed);
      check("...as a dense sequence from zero",
        afterReorder.map((row) => row.position),
        reversed.map((_, index) => index));

      /*
        A partial list is refused. Sending only the modules that moved would leave the omitted
        ones holding stale positions — an order nobody asked for, and one that would look like
        the reorder half worked.
      */
      check("a partial order is refused",
        await refusal(() =>
          asInstructor.modules.reorder({ courseId: course.id, moduleIds: [first.id] })),
        "BAD_REQUEST");
      check("an order listing a module twice is refused",
        await refusal(() =>
          asInstructor.modules.reorder({
            courseId: course.id,
            moduleIds: [...reversed, first.id],
          })),
        "BAD_REQUEST");

      // --- removing ---------------------------------------------------------
      check("an empty module can be removed",
        (await asInstructor.modules.remove({ moduleId: trimmed.id })).name,
        "Mod 97 - Padded");

      // The case this whole guard exists for. The seeded course has assignments in a module,
      // and removing it would leave them belonging to nothing.
      const withWork = (
        await asInstructor.modules.listForCourse({ courseId: course.id })
      ).find((row) => row._count.assignments > 0);

      if (withWork) {
        check("a module holding assignments cannot be removed",
          await refusal(() => asInstructor.modules.remove({ moduleId: withWork.id })),
          "CONFLICT");

        // The database saying the same thing is checked below, in a transaction of its own.
      } else {
        console.log("skip  a module holding assignments cannot be removed — none is seeded");
      }

      // --- who may do any of this ------------------------------------------
      check("a student cannot create a module",
        await refusal(() => asStudent.modules.create({ courseId: course.id, name: "Nope" })),
        "FORBIDDEN");
      check("a student cannot rename one",
        await refusal(() => asStudent.modules.rename({ moduleId: second.id, name: "Nope" })),
        "FORBIDDEN");
      check("a student cannot reorder them",
        await refusal(() =>
          asStudent.modules.reorder({ courseId: course.id, moduleIds: reversed })),
        "FORBIDDEN");
      check("a student cannot remove one",
        await refusal(() => asStudent.modules.remove({ moduleId: second.id })),
        "FORBIDDEN");

      // A student may *read* them, because their own course page groups assignments by module.
      // There is nothing here they should not see: a module is a name and a position.
      check("a student can read the list",
        (await asStudent.modules.listForCourse({ courseId: course.id })).length > 0, true);

      /*
        And an empty module is in what the student's page is built from. Their course page
        renders a section per module rather than per module-that-has-work, so a student can see
        the shape of the course ahead of them — which means `courses.get` has to return every
        module, not only the ones with assignments in.
      */
      const emptyOne = await asInstructor.modules.create({
        courseId: course.id,
        name: "Mod 94 - Nothing In It",
      });
      const asSeenByStudent = await asStudent.courses.get({ courseId: course.id });
      check("an empty module still reaches the student's course page",
        asSeenByStudent.modules.some((row) => row.id === emptyOne.id), true);

      /*
        An instructor of a different course is the check the role alone cannot make. INSTRUCTOR
        says nothing about *which* courses, so without the course-level test one cohort's
        instructor could rename another's modules.
      */
      const otherCourse = await tx.course.create({
        data: {
          name: "Elsewhere (verify:modules)",
          cohortTerm: "Cohort Elsewhere",
          joinToken: `verify-modules-${crypto.randomUUID()}`,
        },
        select: { id: true },
      });
      const outsider = await tx.profile.findFirst({
        where: { role: "INSTRUCTOR", id: { not: instructor.userId } },
        select: { id: true },
      });

      if (outsider) {
        const asOutsider = createCaller({ db: tx, user: { id: outsider.id } } as never);
        check("an instructor who does not teach the course cannot rename its modules",
          await refusal(() =>
            asOutsider.modules.rename({ moduleId: second.id, name: "Not yours" })),
          "FORBIDDEN");
      } else {
        console.log("skip  an instructor who does not teach the course — only one is seeded");
      }

      // A module of another course is not this course's to reorder, which `reorder` catches as
      // a list that is not exactly this course's modules.
      const elsewhereModule = await tx.module.create({
        data: { courseId: otherCourse.id, name: "Mod 1 - Elsewhere", position: 0 },
        select: { id: true },
      });
      check("another course's module cannot be ordered into this one",
        await refusal(() =>
          asInstructor.modules.reorder({
            courseId: course.id,
            moduleIds: [...reversed.filter((id) => id !== trimmed.id), elsewhereModule.id],
          })),
        "BAD_REQUEST");

      throw new Error("ROLLBACK");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  /*
    Two modules with the same name are indistinguishable in every select an instructor picks
    from, so the database refuses it and the procedure turns that into words. Each in its own
    transaction, for the reason `inOwnTransaction` gives.
  */
  await inOwnTransaction(db, async (tx) => {
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
    const made = await asInstructor.modules.create({
      courseId: course.id,
      name: "Mod 96 - Duplicate Target",
    });
    check("a duplicate name in one course is refused",
      await refusal(() =>
        asInstructor.modules.create({ courseId: course.id, name: made.name })),
      "CONFLICT");
  });

  await inOwnTransaction(db, async (tx) => {
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
    const existingName = (
      await asInstructor.modules.listForCourse({ courseId: course.id })
    )[0];
    const other = await asInstructor.modules.create({
      courseId: course.id,
      name: "Mod 95 - To Be Renamed",
    });
    check("renaming onto an existing name is refused",
      await refusal(() =>
        asInstructor.modules.rename({ moduleId: other.id, name: existingName.name })),
      "CONFLICT");
  });

  /*
    The foreign key refuses it too, so a caller written later cannot get this wrong by
    skipping the procedure. RESTRICT rather than CASCADE is what makes it a refusal instead of
    a silent deletion of the assignments and every graded draft under them.

    **In a transaction of its own, and that is the point worth knowing.** Provoking a
    constraint violation aborts the whole Postgres transaction — every later statement comes
    back `25P02: current transaction is aborted` — so this cannot share one with the checks
    above. Found by doing it wrong: the delete failed as expected and then took eleven
    unrelated checks down with it.
  */
  const holdingWork = await db.module.findFirst({
    where: { courseId: course.id, assignments: { some: {} } },
    select: { id: true, name: true },
  });

  if (holdingWork) {
    try {
      await db.$transaction(async (tx) => {
        await tx.module.delete({ where: { id: holdingWork.id } });
        throw new Error("DELETED");
      });
      check("the foreign key refuses removing a module with assignments", "accepted", "refused");
    } catch (err) {
      const name = (err as Error).message === "DELETED" ? "accepted" : (err as Error).name;
      check("the foreign key refuses removing a module with assignments",
        name, "PrismaClientKnownRequestError");
    }
  }

  // --- the rollback really rolled back ---------------------------------------
  const leftover = await db.module.count({
    where: { name: { in: ["Mod 98 - Renamed", "Mod 99 - Verify Two", "Mod 97 - Padded"] } },
  });
  check("no modules survived the rollback", leftover, 0);

  return report();
}

function report() {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
