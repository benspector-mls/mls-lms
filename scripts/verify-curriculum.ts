/**
 * Projects and assessments as course units: created, filled, ordered, and removed.
 *
 * Run with `npm run verify:curriculum`.
 *
 * `verify:modules` already covers the mechanics a unit has whatever its category — creating,
 * renaming, reordering, refusing removal while it holds work, and who is allowed to do any of
 * it. This script covers the part that only exists because there are three categories:
 *
 * - the three share **one position sequence**, so a project can be reordered between two modules
 *   and `reorder` has to accept a list spanning every category;
 * - a course unit's category is **fixed at creation**, so no procedure can turn a module into an
 *   assessment underneath the assignments already in it;
 * - every assignment lands in **exactly one** gradebook tab, which is the property the tabs rest
 *   on and the one failure a tabbed gradebook can have that an untabbed one cannot;
 * - a student sees a project's **published** work and not its drafts.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because
 * authorization is most of what these procedures are: every one has to check that the caller
 * teaches *this* course, and a unit id says nothing about which course it is in until the row is
 * read. A check that only holds when the function is called some other way is not a check on what
 * an instructor uses.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { groupByUnit, workOf } = await import("../lib/gradebook/categories");
  const { UNIT_CATEGORIES } = await import("../lib/course-units");

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
  /*
    Any status. This needs somebody to *be*, not somebody enrolled: every check below that acts as
    a student is a read, and a read admits a removed student by design.
  */
  const enrollment = course
    ? await db.enrollment.findFirst({
        where: { program: { courses: { some: { id: course.id } } } },
        orderBy: { createdAt: "asc" },
        select: { studentId: true },
      })
    : null;

  if (!course || !instructor || !enrollment) {
    return skip("no seeded course with an instructor and a bound student");
  }

  const studentId = enrollment.studentId;
  const createCaller = createCallerFactory(appRouter);
  const stamp = Date.now();

  try {
    await db.$transaction(async (tx) => {
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
      const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

      // --- a project and an assessment are units like any other -------------

      const project = await asInstructor.courseUnits.create({
        category: "PROJECT",
        courseId: course.id,
        name: `Verify Project ${stamp}`,
        overview: "A brief, which is what the overview column is for.",
      });
      const assessment = await asInstructor.courseUnits.create({
        category: "ASSESSMENT",
        courseId: course.id,
        name: `Verify Assessment ${stamp}`,
      });

      check("a project is created with its category", project.category, "PROJECT");
      check("an assessment is created with its category", assessment.category, "ASSESSMENT");
      /*
        Renaming leaves the category alone, which is the fact worth checking rather than the
        input schema that enforces it. An assignment's tab, a student's progress bar, and the
        gradebook's roll-up all follow from the category, so one that could change under the work
        already filed in the unit would silently move every one of them.
      */
      const renamed = await asInstructor.courseUnits.update({
        courseUnitId: project.id,
        name: `Verify Project ${stamp} renamed`,
        overview: "Edited.",
      });
      check("renaming a project leaves its category alone", renamed.category, "PROJECT");

      // --- one sequence across all three categories -------------------------

      const listed = await asInstructor.courseUnits.listForCourse({ courseId: course.id });

      check(
        "listForCourse returns every category, not only modules",
        new Set(listed.map((unit) => unit.category)).size >= 2,
        true,
      );

      const positions = listed.map((unit) => unit.position);
      check(
        "the positions are one dense sequence over every category",
        positions.every((position, index) => position === index),
        true,
      );

      /*
        A project moved between two modules. `reorder` checks set equality over every unit of the
        course, so a list scoped to one category would be refused — which is the property that
        makes the sequence genuinely shared rather than three sequences that happen to be stored
        in one column.
      */
      const moved = [
        listed[0]!,
        listed.find((unit) => unit.id === project.id)!,
        ...listed.slice(1).filter((unit) => unit.id !== project.id),
      ];

      await asInstructor.courseUnits.reorder({
        courseId: course.id,
        courseUnitIds: moved.map((unit) => unit.id),
      });

      const reordered = await asInstructor.courseUnits.listForCourse({ courseId: course.id });

      check(
        "a project can be reordered between two modules",
        reordered.find((unit) => unit.id === project.id)?.position,
        1,
      );

      /*
        A new unit placed after one of another category, which is the shared sequence seen from the
        creating end rather than the reordering end. An instructor adding the Mod 4 project asks for
        it after Mod 4, and nothing about the anchor's category enters into where it lands.
      */
      const modAnchor = reordered.find((unit) => unit.category === "MODULE")!;
      const placedAfterModule = await asInstructor.courseUnits.create({
        category: "PROJECT",
        courseId: course.id,
        name: `Verify Placed Project ${stamp}`,
        placement: { at: "after", courseUnitId: modAnchor.id },
      });

      const withPlaced = await asInstructor.courseUnits.listForCourse({ courseId: course.id });
      check(
        "a project placed after a module lands immediately after it",
        withPlaced.findIndex((unit) => unit.id === placedAfterModule.id),
        withPlaced.findIndex((unit) => unit.id === modAnchor.id) + 1,
      );
      check(
        "...leaving one dense sequence over every category",
        withPlaced.every((unit, index) => unit.position === index),
        true,
      );

      check(
        "a list missing one category is refused, because the sequence is shared",
        await refusal(() =>
          asInstructor.courseUnits.reorder({
            courseId: course.id,
            courseUnitIds: listed
              .filter((unit) => unit.category === "MODULE")
              .map((unit) => unit.id),
          }),
        ),
        "BAD_REQUEST",
      );

      // --- work inside a project --------------------------------------------

      const published = await asInstructor.assignments.create({
        courseId: course.id,
        draft: {
          kind: "SELF_DIRECTED",
          handInMethods: ["LINK"],
          courseUnitId: project.id,
          title: `Verify deliverable published ${stamp}`,
          completionThreshold: 0.75,
          dueAt: null,
          submissionInstructions: null,
          sections: [{ grading: "manual", label: "Overall", pointValue: 10 }],
        },
      });
      const draft = await asInstructor.assignments.create({
        courseId: course.id,
        draft: {
          kind: "SELF_DIRECTED",
          handInMethods: ["LINK"],
          courseUnitId: project.id,
          title: `Verify deliverable draft ${stamp}`,
          completionThreshold: 0.75,
          dueAt: null,
          submissionInstructions: null,
          sections: [{ grading: "manual", label: "Overall", pointValue: 10 }],
        },
      });

      await asInstructor.assignments.publish({ assignmentId: published.assignment.id });

      const seen = await asStudent.assignments.listForCourse({ courseId: course.id });
      const seenIds = new Set(seen.map((row) => row.id));

      check(
        "a student sees a project's published work",
        seenIds.has(published.assignment.id),
        true,
      );
      check("...and not its drafts", seenIds.has(draft.assignment.id), false);

      const inProject = seen.filter((row) => row.courseUnit.id === project.id);
      check(
        "the work a student sees names the project it belongs to",
        inProject.length > 0 && inProject.every((row) => row.courseUnit.category === "PROJECT"),
        true,
      );

      // --- every assignment lands in exactly one tab -------------------------

      const gradebook = await asInstructor.courses.gradebook({
        courseId: course.id,
        cohort: "all",
      });

      const grouped = groupByUnit(gradebook.assignments, gradebook.courseUnits);
      const placed = UNIT_CATEGORIES.flatMap((category) => workOf(grouped[category]));
      const placedIds = new Set(placed.map((row) => row.id));

      /*
        Exhaustive and disjoint, checked as two separate facts. A column that is missing looks
        like work that does not exist, and a column drawn twice makes every total wrong — and the
        two failures do not look alike, so a single count would catch one and hide the other.
      */
      check(
        "every assignment in the course appears on some tab",
        placedIds.size,
        gradebook.assignments.length,
      );
      check("...and none of them appears on two", placed.length, placedIds.size);

      check(
        "a deliverable is on the Projects tab and nowhere else",
        workOf(grouped.PROJECT).some((row) => row.id === published.assignment.id) &&
          !workOf(grouped.MODULE).some((row) => row.id === published.assignment.id),
        true,
      );

      // --- removal, while it holds work and after ---------------------------

      check(
        "a project holding assignments cannot be removed",
        await refusal(() => asInstructor.courseUnits.remove({ courseUnitId: project.id })),
        "CONFLICT",
      );

      const emptyRemoval = await asInstructor.courseUnits.remove({ courseUnitId: assessment.id });
      check("an empty assessment can be removed", emptyRemoval.name, assessment.name);

      check(
        "a student cannot create a unit",
        await refusal(() =>
          asStudent.courseUnits.create({
            category: "PROJECT",
            courseId: course.id,
            name: `Nope ${stamp}`,
          }),
        ),
        "FORBIDDEN",
      );

      // Nothing above is meant to survive. Everything this wrote is rolled back with it.
      throw new Error("rollback");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "rollback") throw error;
  }

  /*
    The foreign key behind the procedure, in a transaction of its own.

    Outside the block above for two reasons. A constraint violation aborts the transaction it
    happens in, so asking this inside the outer one would take every check after it down with it —
    and rows written in that transaction are not visible to a second one, so a unit created there
    could not be found to delete and the check would pass without testing anything.

    So it names a unit that was already committed and already holds work. Worth asking at all
    because the procedure's refusal is a courtesy: it exists so an instructor gets a count and
    something to do about it. The constraint is what stops a second caller written later from
    getting it wrong quietly.
  */
  const occupied = await db.courseUnit.findFirst({
    where: { courseId: course.id, assignments: { some: {} } },
    select: { id: true },
  });

  if (!occupied) {
    skip("no committed course unit holding assignments, so the constraint is untested");
  } else {
    let constraint = "deleted";

    await inOwnTransaction(db, async (isolated) => {
      try {
        await isolated.courseUnit.delete({ where: { id: occupied.id } });
      } catch {
        constraint = "refused";
      }
    });

    check("the database refuses it too, not only the procedure", constraint, "refused");
  }

  finish();
}

void main();
