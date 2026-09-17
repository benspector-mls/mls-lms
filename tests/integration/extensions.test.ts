/**
 * Extensions: a deadline agreed with one fellow, and what the rest of the application then says.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * `tests/lib/submissions/hand-in.test.ts` covers the verdict itself — on time, extended, late — over
 * every combination of the three columns, and none of that is repeated here. What a Jest case cannot
 * reach is the half this file is about: that the grant is refused to the people and the assignments
 * it should be, that granting one to a fellow who has handed in nothing creates the row rather than
 * failing, and above all that **the fellow is then shown the new deadline** — which is the promise
 * the feature makes to them and which no amount of pure-function testing can check.
 *
 * The deadline an extension is judged against is the assignment's own, recorded in `isLate` at
 * hand-in. Nothing here moves `Assignment.dueAt`, and the checks below are written to fail if
 * anything starts to.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Each group holds a
 * transaction of its own, because a refusal that comes from a constraint aborts the transaction it
 * happens in.
 */
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
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

/** The assignment's own deadline in every group below, and the dates either side of it. */
const DUE = new Date("2026-10-01T00:00:00Z");
const EXTENDED = new Date("2026-10-08T00:00:00Z");
/** After `DUE`, before `EXTENDED` — the window an extension is granted to create. */
const WITHIN = new Date("2026-10-05T00:00:00Z");
/** After both, which is the case an extension must not excuse. */
const AFTER_BOTH = new Date("2026-10-10T00:00:00Z");

describe("granting an extension", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension",
      dueAt: DUE,
    });
    assignmentId = assignment.id;
  });

  /*
    The case the feature exists for, and the one that cannot work by accident: a fellow who has
    taken nothing up has no submission row, so the grant has to create one. Without this the
    agreement could only be recorded after the fact, which is the opposite of agreeing a deadline
    in advance.

    **The fixture is self-directed deliberately**, which is the kind that makes this the only path
    rather than a convenience. `hasAcceptStep` is false for it: nothing is handed out, so there is
    no Accept, and submitting is the only way a fellow can start. Every fellow who needs a deadline
    agreed in advance on work like this is therefore a fellow with no row — where a repository
    assignment at least has one from the moment they accept.
  */
  it("creates the row for a fellow who has handed nothing in", async () => {
    const granted = await asInstructor().submissions.grantExtension({
      assignmentId,
      studentId: world.student.studentId,
      extendedDueAt: EXTENDED,
    });

    expect(granted.extendedDueAt?.toISOString()).toBe(EXTENDED.toISOString());
  });

  it("records who agreed to it and when", async () => {
    const row = await tx().submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.student.studentId },
      select: { extensionGrantedById: true, extensionGrantedAt: true },
    });

    expect(row.extensionGrantedById).toBe(world.instructorId);
    expect(row.extensionGrantedAt).not.toBeNull();
  });

  // The class deadline is what everybody else is working to, and an agreement with one fellow is
  // not an edit to the assignment. A check rather than an assumption, because the whole design
  // rests on it.
  it("leaves the assignment's own due date alone", async () => {
    const assignment = await tx().assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: { dueAt: true },
    });

    expect(assignment.dueAt?.toISOString()).toBe(DUE.toISOString());
  });

  it("says nothing about anybody else", async () => {
    const other = await tx().submission.findFirst({
      where: { assignmentId, studentId: world.students[1]!.studentId },
      select: { extendedDueAt: true },
    });

    expect(other).toBeNull();
  });

  it("taking it back clears all three columns together", async () => {
    await asInstructor().submissions.grantExtension({
      assignmentId,
      studentId: world.student.studentId,
      extendedDueAt: null,
    });

    const row = await tx().submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.student.studentId },
      select: { extendedDueAt: true, extensionGrantedById: true, extensionGrantedAt: true },
    });

    expect(row).toEqual({
      extendedDueAt: null,
      extensionGrantedById: null,
      extensionGrantedAt: null,
    });
  });
});

describe("what an extension is refused for", () => {
  const tx = withRollback();

  let world: World;
  let dated: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 1 });
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Refusals",
      dueAt: DUE,
    });
    dated = assignment.id;
  });

  /*
    Earlier than the assignment's own deadline. It would be consulted by neither reader the way
    anybody intends — `lateness` only asks about it for work already past the original, so an
    earlier date always reads late, and `isMissing` would draw a red ring before the rest of the
    cohort's deadline had passed. A new deadline that makes somebody late sooner is not an extension.
  */
  it("refuses a date earlier than the assignment's own", async () => {
    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtension({
          assignmentId: dated,
          studentId: world.student.studentId,
          extendedDueAt: new Date("2026-09-01T00:00:00Z"),
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("refuses the assignment's own deadline back again", async () => {
    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtension({
          assignmentId: dated,
          studentId: world.student.studentId,
          extendedDueAt: DUE,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  // Work with no deadline can never be late, so there is nothing to extend and nothing the fellow
  // would be shown.
  it("refuses work that has no deadline at all", async () => {
    const undated = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Undated",
      dueAt: null,
    });

    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtension({
          assignmentId: undated.id,
          studentId: world.student.studentId,
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });

  /*
    A draft is a deadline nobody has been given. `isMissing` already refuses to call a fellow late
    for work that was never handed out, so an agreement about one would mean nothing until the day
    it was published — and the strip an instructor would reach this from is not drawn for a draft,
    so accepting it here would be the two disagreeing.
  */
  it("refuses work that has not been published", async () => {
    const unpublished = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Draft",
      dueAt: DUE,
      published: false,
    });

    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtension({
          assignmentId: unpublished.id,
          studentId: world.student.studentId,
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });

  /*
    Somebody from another program. Without the roster check the upsert would helpfully create a
    submission row to hold the agreement, which is a row for a fellow who is not in this course.
  */
  it("refuses a fellow who is not on this course's roster", async () => {
    const elsewhere = await makeWorld(tx(), { students: 1 });

    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtension({
          assignmentId: dated,
          studentId: elsewhere.student.studentId,
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses a fellow acting on their own work", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), world.student.studentId).submissions.grantExtension({
          assignmentId: dated,
          studentId: world.student.studentId,
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});

/**
 * What the fellow is shown once a deadline has been agreed with them.
 *
 * The promise the feature makes to them, and the half no unit test can reach: the substitution
 * happens in the procedures, and a fellow who was told they had until the 8th has to see the 8th.
 */
describe("what the fellow sees", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Visible",
      dueAt: DUE,
    });
    assignmentId = assignment.id;

    await createCaller(tx(), world.instructorId).submissions.grantExtension({
      assignmentId,
      studentId: world.student.studentId,
      extendedDueAt: EXTENDED,
    });
  });

  it("their dashboard shows the deadline they were given", async () => {
    const rows = await createCaller(tx(), world.student.studentId).assignments.listMine();
    const row = rows.find((entry) => entry.id === assignmentId);

    expect(row?.dueAt?.toISOString()).toBe(EXTENDED.toISOString());
  });

  it("their course page shows the same one", async () => {
    const rows = await createCaller(tx(), world.student.studentId).assignments.listForCourse({
      courseId: world.courseId,
    });
    const row = rows.find((entry) => entry.id === assignmentId);

    expect(row?.dueAt?.toISOString()).toBe(EXTENDED.toISOString());
  });

  // A fellow with no agreement sees the class deadline, which is the control for the two above: on
  // their own they cannot tell a working substitution from a payload that always says the 8th.
  it("a fellow with no extension still sees the class deadline", async () => {
    const rows = await createCaller(tx(), world.students[1]!.studentId).assignments.listMine();
    const row = rows.find((entry) => entry.id === assignmentId);

    expect(row?.dueAt?.toISOString()).toBe(DUE.toISOString());
  });
});

/**
 * The verdict, end to end, on rows that were actually handed in.
 *
 * `lateness` is unit-tested over every combination; what these add is that the columns the
 * procedures write are the ones it reads — a fixture handed in on a given date, with an agreement
 * or without, coming back through an instructor-facing read as the word the school cares about.
 */
describe("the verdict on work that arrived", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Verdicts",
      dueAt: DUE,
    });
    assignmentId = assignment.id;

    /*
      Three fellows, one row each, all of them late against the assignment's own deadline. What
      separates them is only what was agreed and when they handed in — which is exactly the
      distinction the feature is for.
    */
    for (const [index, submittedAt] of [WITHIN, AFTER_BOTH, WITHIN].entries()) {
      await makeSubmission(tx(), {
        assignmentId,
        studentId: world.students[index]!.studentId,
        status: "SUBMITTED",
        submittedAt,
      });
      await tx().submission.updateMany({
        where: { assignmentId, studentId: world.students[index]!.studentId },
        data: { isLate: true },
      });
    }

    const asInstructor = createCaller(tx(), world.instructorId);

    // The first two were agreed an extension; the third was not, and handed in at the same moment
    // as the first.
    for (const index of [0, 1]) {
      await asInstructor.submissions.grantExtension({
        assignmentId,
        studentId: world.students[index]!.studentId,
        extendedDueAt: EXTENDED,
      });
    }
  });

  /** The three columns `lateness` reads, for one fellow, as an instructor's screen receives them. */
  async function facts(index: number) {
    const rows = await createCaller(tx(), world.instructorId).submissions.listForStudent({
      courseId: world.courseId,
      studentId: world.students[index]!.studentId,
    });

    const row = rows.rows.find((entry) => entry.assignment.id === assignmentId);
    return row?.submission ?? null;
  }

  it("carries the agreed deadline through to the instructor's screen", async () => {
    const row = await facts(0);
    expect(row?.extendedDueAt?.toISOString()).toBe(EXTENDED.toISOString());
  });

  // Still late against the original, which is the record the school keeps. The word the fellow is
  // shown is derived from that plus the agreement, never by rewriting this.
  it("leaves isLate saying the original deadline was missed", async () => {
    expect((await facts(0))?.isLate).toBe(true);
    expect((await facts(1))?.isLate).toBe(true);
  });

  it("keeps the hand-in time, which is what the agreement is compared against", async () => {
    expect((await facts(0))?.submittedAt?.toISOString()).toBe(WITHIN.toISOString());
    expect((await facts(1))?.submittedAt?.toISOString()).toBe(AFTER_BOTH.toISOString());
  });

  // The fellow who was agreed nothing: no extension travels, so every reader calls them late.
  it("says nothing about a fellow who agreed nothing", async () => {
    const row = await facts(2);
    expect(row?.extendedDueAt).toBeNull();
    expect(row?.isLate).toBe(true);
  });
});
