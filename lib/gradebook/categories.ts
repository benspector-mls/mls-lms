/**
 * How a course's work divides into modules, projects, and assessments, and how a student stands
 * in each — at the assignment, the unit, and the course.
 *
 * **Browser-safe and pure**, like `lib/gradebook/summary.ts` beside it, and taking the same
 * payload the grid is already drawn from. That is what keeps a tab's total from disagreeing with
 * the cells beneath it: a figure computed from a second read of the database can describe a
 * different cohort than the table it sits in, and a reader holding one screen has no way to
 * notice.
 *
 * ## Completion is one rule at three levels
 *
 * An **assignment** is complete when `isComplete` is true — written once by `approveDraft`, in
 * the same transaction as the status, and never recomputed here from a score. A **unit** is
 * complete when every one of its assignments is. A **course** is complete when every one of its
 * units is.
 *
 * The same sentence at every level: one thing to explain to a student, one function to test, and
 * no level at which "complete" quietly means something else.
 *
 * Two rules keep the roll-up from lying, and both are load-bearing:
 *
 * **An empty unit has no verdict and does not block the course.** Zero of zero complete is not
 * an achievement, so it must not count as complete — and it must not count as incomplete either,
 * or an instructor creating next term's unit would make the course uncompletable for everybody.
 * It is skipped entirely.
 *
 * **The verdict counts published assignments only.** This is the one place it departs from the
 * *fraction* beside it, and deliberately: a verdict is a claim about the student, and a student
 * cannot complete work that has not been handed out. Counting drafts would mean an instructor
 * writing next week's assignment silently un-completes the unit for everyone who had finished
 * it. The fraction keeps its own rule — see `completionByStudent` in `summary.ts` — because it
 * answers "how far through the course is this", where a draft is real work still to come.
 */

import { compareByPosition, sortByDueDate, type CourseUnitCategory } from "../course-units";
import type { Completion } from "./summary";

/** The parts of a cell these read. Structural, so a test can build a cohort in a few lines. */
export type WorkCell = {
  assignmentId: string;
  studentId: string;
  isComplete: boolean | null;
};

/** The parts of an assignment these read: enough to place it, order it, and know if it counts. */
export type CategorizedAssignment = {
  id: string;
  title: string;
  dueAt: Date | string | null;
  courseUnitId: string;
  /** Null means a draft. A student cannot complete what has not been handed out. */
  distributedAt: Date | string | null;
};

/** The parts of a unit these read. */
export type CategorizedUnit = {
  id: string;
  name: string;
  position: number;
  category: CourseUnitCategory;
};

/** A unit with its assignments attached, in the order every screen shows them. */
export type UnitWithWork<A extends CategorizedAssignment> = {
  unit: CategorizedUnit;
  /** Sorted by due date, undated last, ties broken by title. */
  work: A[];
};

export type GroupedCourse<A extends CategorizedAssignment> = Record<
  CourseUnitCategory,
  UnitWithWork<A>[]
>;

/**
 * A course's units split into the three lists the tabs draw, each carrying its own assignments.
 *
 * **The three are exhaustive and disjoint**, which is the property the tabs rest on: every
 * assignment passed in appears under exactly one unit, on exactly one tab. A column that is
 * missing looks like work that does not exist, which is the one failure a tabbed gradebook can
 * have that an untabbed one cannot.
 *
 * Units keep course order — one sequence across all three categories — so a project reads in the
 * place the instructor put it rather than at the end of its own list.
 *
 * A unit with no assignments is kept rather than dropped. An instructor who has just created one
 * should see it where they put it; dropping it would make the act of creating it look like it
 * had failed.
 *
 * An assignment whose `courseUnitId` names a unit the caller did not fetch is dropped, and that
 * is the one case where dropping is right: it belongs to a unit this screen is not showing, so
 * there is nowhere on this screen it could honestly go. Every real caller passes the whole
 * course, so the case does not arise there.
 */
export function groupByUnit<A extends CategorizedAssignment>(
  assignments: readonly A[],
  units: readonly CategorizedUnit[],
): GroupedCourse<A> {
  const workByUnit = new Map<string, A[]>();
  for (const unit of units) workByUnit.set(unit.id, []);

  for (const assignment of assignments) {
    workByUnit.get(assignment.courseUnitId)?.push(assignment);
  }

  const grouped: GroupedCourse<A> = { MODULE: [], PROJECT: [], ASSESSMENT: [] };

  for (const unit of [...units].sort(compareByPosition)) {
    grouped[unit.category].push({ unit, work: sortByDueDate(workByUnit.get(unit.id) ?? []) });
  }

  return grouped;
}

/** Every unit of the course in one list, in course order, whatever their category. */
export function allUnits<A extends CategorizedAssignment>(
  grouped: GroupedCourse<A>,
): UnitWithWork<A>[] {
  return [...grouped.MODULE, ...grouped.PROJECT, ...grouped.ASSESSMENT].sort((a, b) =>
    compareByPosition(a.unit, b.unit),
  );
}

/** Every assignment under these units, flattened. */
export function workOf<A extends CategorizedAssignment>(units: readonly UnitWithWork<A>[]): A[] {
  return units.flatMap((entry) => entry.work);
}

/**
 * Where a student stands on a whole unit, in three states.
 *
 * **"Not finished" is not "incomplete"**, and keeping them apart is the point. A project shown as
 * incomplete while two of its deliverables are still with an instructor would be telling a
 * student they had failed something nobody has marked.
 */
export type UnitVerdict = "complete" | "incomplete" | "pending";

/** The published assignments of a unit — the only ones a verdict may be built from. */
export function published<A extends CategorizedAssignment>(work: readonly A[]): A[] {
  return work.filter((item) => item.distributedAt != null);
}

/**
 * Every student's verdict on one unit, keyed by student.
 *
 * A student missing from the returned map is `"pending"`, which is what a student who has
 * started nothing should read as. They are omitted rather than defaulted so the map is built
 * from the cells alone and needs no roster passed in — the same shape the functions in
 * `summary.ts` have.
 *
 * `isComplete` is nullable, so the tests are `=== true` and `=== false` rather than truthiness:
 * null is "no verdict yet", which is neither passing nor failing and must not be counted as
 * either.
 *
 * A unit with no published assignments returns an empty map, which every caller reads as "no
 * verdict" — see `unitHasVerdict` below, and the file header for why.
 */
export function verdictsByStudent<A extends CategorizedAssignment>(
  cells: readonly WorkCell[],
  work: readonly A[],
): Map<string, UnitVerdict> {
  const verdicts = new Map<string, UnitVerdict>();
  const counted = published(work);
  if (counted.length === 0) return verdicts;

  const ids = new Set(counted.map((item) => item.id));

  /*
    Per student, how many of this unit's assignments carry each verdict. Counted in one pass over
    every cell rather than by filtering the array once per student, for the reason
    `completionByAssignment` gives — a cohort of twenty-five against a course's cells is a scan
    nobody should do twenty-five times.

    Two counters and not a set, because "has a failed assignment" decides nothing on its own: the
    answer turns on whether the completed and failed ones together account for *every* published
    assignment. `submissions` is unique on (assignment, student), so each contributes at most one
    to at most one counter.
  */
  const completed = new Map<string, number>();
  const failed = new Map<string, number>();

  for (const cell of cells) {
    if (!ids.has(cell.assignmentId)) continue;
    if (cell.isComplete === true) {
      completed.set(cell.studentId, (completed.get(cell.studentId) ?? 0) + 1);
    } else if (cell.isComplete === false) {
      failed.set(cell.studentId, (failed.get(cell.studentId) ?? 0) + 1);
    }
  }

  for (const studentId of new Set([...completed.keys(), ...failed.keys()])) {
    const complete = completed.get(studentId) ?? 0;
    const incomplete = failed.get(studentId) ?? 0;

    if (complete === counted.length) verdicts.set(studentId, "complete");
    /*
      Every assignment has a verdict and at least one fell short. The sum is what makes this
      right: a student with one failed deliverable and one still with an instructor is *pending*,
      not incomplete, because the unmarked one can still change the answer — and calling it
      incomplete now would be a verdict nobody has reached.
    */
    else if (complete + incomplete === counted.length) verdicts.set(studentId, "incomplete");
    else verdicts.set(studentId, "pending");
  }

  return verdicts;
}

/**
 * Whether this unit is capable of having a verdict at all.
 *
 * A unit with nothing published is skipped by the course roll-up rather than counted either way.
 * Named as its own function because three callers ask it and a course that treated an empty unit
 * as incomplete would be uncompletable the moment an instructor drafted next term's work.
 */
export function unitHasVerdict<A extends CategorizedAssignment>(entry: UnitWithWork<A>): boolean {
  return published(entry.work).length > 0;
}

/**
 * Every student's verdict on the whole course.
 *
 * Complete when every unit that has a verdict is complete, and there is at least one such unit.
 * Units with nothing published are skipped, so a course of eight modules and one empty one is
 * completable; a course with nothing published at all has no verdict for anybody.
 *
 * The students considered are those the caller names, because unlike a unit verdict this one has
 * to be able to say "complete" about a student who appears in no cell of some unit — and a map
 * built from cells alone cannot distinguish that student from one who is not in the cohort.
 */
export function courseVerdictByStudent<A extends CategorizedAssignment>(
  cells: readonly WorkCell[],
  units: readonly UnitWithWork<A>[],
  studentIds: readonly string[],
): Map<string, UnitVerdict> {
  const counted = units.filter(unitHasVerdict);
  const result = new Map<string, UnitVerdict>();

  if (counted.length === 0) {
    for (const studentId of studentIds) result.set(studentId, "pending");
    return result;
  }

  const perUnit = counted.map((entry) => verdictsByStudent(cells, entry.work));

  for (const studentId of studentIds) {
    const verdicts = perUnit.map((map) => map.get(studentId) ?? "pending");

    if (verdicts.every((verdict) => verdict === "complete")) result.set(studentId, "complete");
    // Every unit has settled and at least one fell short. A student still mid-way through any
    // unit is pending, for the same reason a half-marked project is.
    else if (verdicts.every((verdict) => verdict !== "pending"))
      result.set(studentId, "incomplete");
    else result.set(studentId, "pending");
  }

  return result;
}

/**
 * Per student: how many of these units they have completed.
 *
 * The denominator is every unit that has a verdict, which is what makes the figure honest when a
 * course holds an empty unit: "2 of 3 projects" should not become "2 of 4" because somebody
 * created a fourth and has not filled it.
 */
export function unitCompletionByStudent<A extends CategorizedAssignment>(
  cells: readonly WorkCell[],
  units: readonly UnitWithWork<A>[],
): Map<string, Completion> {
  const counted = units.filter(unitHasVerdict);
  const counts = new Map<string, number>();

  for (const entry of counted) {
    for (const [studentId, verdict] of verdictsByStudent(cells, entry.work)) {
      if (verdict !== "complete") continue;
      counts.set(studentId, (counts.get(studentId) ?? 0) + 1);
    }
  }

  return new Map(
    [...counts].map(([studentId, complete]) => [studentId, { complete, possible: counted.length }]),
  );
}

/**
 * The cells belonging to a given set of assignments.
 *
 * What narrows a whole course's cells to one tab's. Without it a tab would count every completed
 * assignment in the course in its numerator against a denominator of its own columns only, and
 * read as more complete than the cohort is.
 */
export function cellsFor<C extends WorkCell>(
  cells: readonly C[],
  assignments: readonly { id: string }[],
): C[] {
  const ids = new Set(assignments.map((assignment) => assignment.id));
  return cells.filter((cell) => ids.has(cell.assignmentId));
}
