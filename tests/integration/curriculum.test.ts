/**
 * Projects and assessments as course units: created, filled, ordered, and removed.
 *
 * Run with `npm run test:integration`.
 *
 * `modules.test.ts` already covers the mechanics a unit has whatever its category — creating,
 * renaming, reordering, refusing removal while it holds work, and who is allowed to do any of it.
 * This covers the part that only exists because there are three categories:
 *
 * - the three share **one position sequence**, so a project can be reordered between two modules
 *   and `reorder` has to accept a list spanning every category;
 * - a course unit's category is **fixed at creation**, so no procedure can turn a module into an
 *   assessment underneath the assignments already in it;
 * - every assignment lands in **exactly one** gradebook tab, which is the property the tabs rest on
 *   and the one failure a tabbed gradebook can have that an untabbed one cannot;
 * - a student sees a project's **published** work and not its drafts.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is most of what these procedures are: every one has to check that the caller teaches *this*
 * course, and a unit id says nothing about which course it is in until the row is read.
 *
 * Carries the 19 assertions `verify:curriculum` reported on 2 September 2026. One of them is
 * stronger here than it was: the move between two modules ran against a fixture whose project was
 * already in the position it was moved to, so it passed whether the reorder happened or not. The
 * fixture below has two modules and puts the project after both of them, so the move is a move.
 */
import { UNIT_CATEGORIES } from "@/lib/course-units";
import { groupByUnit, workOf } from "@/lib/gradebook/categories";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeUnit, makeWorld, type World } from "./fixtures";
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

/** A self-directed deliverable in the named unit, through the authoring procedure. */
const deliverable = (courseUnitId: string, title: string) => ({
  kind: "SELF_DIRECTED" as const,
  handInMethods: ["LINK" as const],
  courseUnitId,
  title,
  completionThreshold: 0.75,
  dueAt: null,
  submissionInstructions: null,
  sections: [{ grading: "manual" as const, label: "Overall", pointValue: 10 }],
});

describe("projects and assessments alongside modules", () => {
  const tx = withRollback();

  let world: World;
  let project: { id: string; category: string; name: string };
  let assessment: { id: string; category: string; name: string };
  let published: { assignment: { id: string } };
  let draft: { assignment: { id: string } };

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asStudent = () => createCaller(tx(), world.student.studentId);
  const listUnits = () => asInstructor().courseUnits.listForCourse({ courseId: world.courseId });

  beforeAll(async () => {
    world = await makeWorld(tx());
    // A second module, so the project below starts after both and its move is a real move.
    await makeUnit(tx(), { courseId: world.courseId, name: "Mod 1 - Second" });

    project = await asInstructor().courseUnits.create({
      category: "PROJECT",
      courseId: world.courseId,
      name: "Integration Project",
      overview: "A brief, which is what the overview column is for.",
    });
    assessment = await asInstructor().courseUnits.create({
      category: "ASSESSMENT",
      courseId: world.courseId,
      name: "Integration Assessment",
    });
  });

  it("a project is created with its category", () => {
    expect(project.category).toBe("PROJECT");
  });

  it("an assessment is created with its category", () => {
    expect(assessment.category).toBe("ASSESSMENT");
  });

  /*
    Renaming leaves the category alone, which is the fact worth checking rather than the input
    schema that enforces it. An assignment's tab, a student's progress bar, and the gradebook's
    roll-up all follow from the category, so one that could change under the work already filed in
    the unit would silently move every one of them.
  */
  it("renaming a project leaves its category alone", async () => {
    const renamed = await asInstructor().courseUnits.update({
      courseUnitId: project.id,
      name: "Integration Project renamed",
      overview: "Edited.",
    });
    expect(renamed.category).toBe("PROJECT");
  });

  describe("one sequence across all three categories", () => {
    let listed: Awaited<ReturnType<typeof listUnits>>;

    beforeAll(async () => {
      listed = await listUnits();
    });

    it("listForCourse returns every category, not only modules", () => {
      expect(new Set(listed.map((unit) => unit.category)).size).toBeGreaterThanOrEqual(2);
    });

    it("the positions are one dense sequence over every category", () => {
      expect(listed.every((unit, index) => unit.position === index)).toBe(true);
    });

    /*
      A project moved between two modules. `reorder` checks set equality over every unit of the
      course, so a list scoped to one category would be refused — which is the property that makes
      the sequence genuinely shared rather than three sequences that happen to be stored in one
      column.
    */
    it("a project can be reordered between two modules", async () => {
      const moved = [
        listed[0]!,
        listed.find((unit) => unit.id === project.id)!,
        ...listed.slice(1).filter((unit) => unit.id !== project.id),
      ];
      await asInstructor().courseUnits.reorder({
        courseId: world.courseId,
        courseUnitIds: moved.map((unit) => unit.id),
      });
      const reordered = await listUnits();
      expect(reordered.find((unit) => unit.id === project.id)?.position).toBe(1);
    });

    /*
      A new unit placed after one of another category, which is the shared sequence seen from the
      creating end rather than the reordering end. An instructor adding the Mod 4 project asks for
      it after Mod 4, and nothing about the anchor's category enters into where it lands.
    */
    describe("a project placed after a module", () => {
      let placed: { id: string };
      let anchor: { id: string };
      let withPlaced: Awaited<ReturnType<typeof listUnits>>;

      beforeAll(async () => {
        const reordered = await listUnits();
        anchor = reordered.find((unit) => unit.category === "MODULE")!;
        placed = await asInstructor().courseUnits.create({
          category: "PROJECT",
          courseId: world.courseId,
          name: "Integration Placed Project",
          placement: { at: "after", courseUnitId: anchor.id },
        });
        withPlaced = await listUnits();
      });

      it("a project placed after a module lands immediately after it", () => {
        expect(withPlaced.findIndex((unit) => unit.id === placed.id)).toBe(
          withPlaced.findIndex((unit) => unit.id === anchor.id) + 1,
        );
      });

      it("...leaving one dense sequence over every category", () => {
        expect(withPlaced.every((unit, index) => unit.position === index)).toBe(true);
      });
    });

    it("a list missing one category is refused, because the sequence is shared", async () => {
      const current = await listUnits();
      const code = await refusal(() =>
        asInstructor().courseUnits.reorder({
          courseId: world.courseId,
          courseUnitIds: current
            .filter((unit) => unit.category === "MODULE")
            .map((unit) => unit.id),
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });

  describe("work inside a project", () => {
    let seenIds: Set<string>;
    let seen: Awaited<ReturnType<ReturnType<typeof asStudent>["assignments"]["listForCourse"]>>;

    beforeAll(async () => {
      published = await asInstructor().assignments.create({
        courseId: world.courseId,
        draft: deliverable(project.id, "Integration deliverable published"),
      });
      draft = await asInstructor().assignments.create({
        courseId: world.courseId,
        draft: deliverable(project.id, "Integration deliverable draft"),
      });
      await asInstructor().assignments.publish({ assignmentId: published.assignment.id });

      seen = await asStudent().assignments.listForCourse({ courseId: world.courseId });
      seenIds = new Set(seen.map((row) => row.id));
    });

    it("a student sees a project's published work", () => {
      expect(seenIds.has(published.assignment.id)).toBe(true);
    });

    it("...and not its drafts", () => {
      expect(seenIds.has(draft.assignment.id)).toBe(false);
    });

    it("the work a student sees names the project it belongs to", () => {
      const inProject = seen.filter((row) => row.courseUnit.id === project.id);
      expect(
        inProject.length > 0 && inProject.every((row) => row.courseUnit.category === "PROJECT"),
      ).toBe(true);
    });
  });

  describe("every assignment lands in exactly one tab", () => {
    let placedIds: Set<string>;
    let placedRows: { id: string }[];
    let assignmentCount: number;
    let grouped: ReturnType<typeof groupByUnit>;

    beforeAll(async () => {
      const gradebook = await asInstructor().courses.gradebook({
        courseId: world.courseId,
        cohort: "all",
      });
      grouped = groupByUnit(gradebook.assignments, gradebook.courseUnits);
      placedRows = UNIT_CATEGORIES.flatMap((category) => workOf(grouped[category]));
      placedIds = new Set(placedRows.map((row) => row.id));
      assignmentCount = gradebook.assignments.length;
    });

    /*
      Exhaustive and disjoint, checked as two separate facts. A column that is missing looks like
      work that does not exist, and a column drawn twice makes every total wrong — and the two
      failures do not look alike, so a single count would catch one and hide the other.
    */
    it("every assignment in the course appears on some tab", () => {
      expect(placedIds.size).toBe(assignmentCount);
    });

    it("...and none of them appears on two", () => {
      expect(placedRows).toHaveLength(placedIds.size);
    });

    it("a deliverable is on the Projects tab and nowhere else", () => {
      expect(
        workOf(grouped.PROJECT).some((row) => row.id === published.assignment.id) &&
          !workOf(grouped.MODULE).some((row) => row.id === published.assignment.id),
      ).toBe(true);
    });
  });

  describe("removal, while it holds work and after", () => {
    it("a project holding assignments cannot be removed", async () => {
      const code = await refusal(() =>
        asInstructor().courseUnits.remove({ courseUnitId: project.id }),
      );
      expect(code).toBe("CONFLICT");
    });

    it("an empty assessment can be removed", async () => {
      const removed = await asInstructor().courseUnits.remove({ courseUnitId: assessment.id });
      expect(removed.name).toBe(assessment.name);
    });

    it("a student cannot create a unit", async () => {
      const code = await refusal(() =>
        asStudent().courseUnits.create({
          category: "PROJECT",
          courseId: world.courseId,
          name: "Nope",
        }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });
});

/*
  The foreign key behind the procedure, in a transaction of its own, because a constraint violation
  aborts the transaction it happens in.

  Worth asking at all because the procedure's refusal is a courtesy: it exists so an instructor gets
  a count and something to do about it. The constraint is what stops a second caller written later
  from getting it wrong quietly.

  The script could only ask this of a unit that was already committed and already held work — rows
  written inside its transaction were invisible to the separate one it opened, so a unit created
  there could not be found to delete and the check would have passed without testing anything. A
  fixture built in this transaction has no such problem.
*/
describe("the constraint under the procedure", () => {
  const tx = withRollback();

  it("the database refuses it too, not only the procedure", async () => {
    const world = await makeWorld(tx());
    const unit = await makeUnit(tx(), { courseId: world.courseId, name: "Holds work" });
    await createCaller(tx(), world.instructorId).assignments.create({
      courseId: world.courseId,
      draft: deliverable(unit.id, "Integration occupant"),
    });

    let outcome = "deleted";
    try {
      await tx().courseUnit.delete({ where: { id: unit.id } });
    } catch {
      outcome = "refused";
    }

    expect(outcome).toBe("refused");
  });
});
