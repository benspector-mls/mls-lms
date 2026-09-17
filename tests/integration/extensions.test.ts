/**
 * Extensions: a renegotiated deadline, and what the rest of the application then says.
 *
 * Agreed with one fellow on work they hand in alone, and with a whole team on work they hand in
 * together — one piece of work has one deadline, so on team work the agreement reaches every
 * member through the same fan-out that carries `isLate`.
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

import { syncTeamRows } from "@/lib/submissions/team";

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
    const granted = await asInstructor().submissions.grantExtensions({
      assignmentId,
      studentIds: [world.student.studentId],
      extendedDueAt: EXTENDED,
    });

    expect(granted.changed).toBe(1);

    const row = await tx().submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.student.studentId },
      select: { extendedDueAt: true, status: true },
    });

    expect(row.extendedDueAt?.toISOString()).toBe(EXTENDED.toISOString());
    expect(row.status).toBe("NOT_STARTED");
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
    await asInstructor().submissions.grantExtensions({
      assignmentId,
      studentIds: [world.student.studentId],
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
        asInstructor().submissions.grantExtensions({
          assignmentId: dated,
          studentIds: [world.student.studentId],
          extendedDueAt: new Date("2026-09-01T00:00:00Z"),
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("refuses the assignment's own deadline back again", async () => {
    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtensions({
          assignmentId: dated,
          studentIds: [world.student.studentId],
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
        asInstructor().submissions.grantExtensions({
          assignmentId: undated.id,
          studentIds: [world.student.studentId],
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
        asInstructor().submissions.grantExtensions({
          assignmentId: unpublished.id,
          studentIds: [world.student.studentId],
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
        asInstructor().submissions.grantExtensions({
          assignmentId: dated,
          studentIds: [elsewhere.student.studentId],
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses a fellow acting on their own work", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), world.student.studentId).submissions.grantExtensions({
          assignmentId: dated,
          studentIds: [world.student.studentId],
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  /*
    Naming teams on work each fellow hands in alone. Which list this assignment takes is decided by
    the assignment rather than by the caller, so this is a request that cannot be honoured rather
    than one to interpret generously.
  */
  it("refuses teams on work handed in alone", async () => {
    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtensions({
          assignmentId: dated,
          teamIds: [world.student.id],
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });

  // Neither list, or both, is refused by the input schema before any of the above is consulted.
  it("refuses naming both lists, or neither", async () => {
    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtensions({
          assignmentId: dated,
          studentIds: [world.student.studentId],
          teamIds: [world.student.id],
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("BAD_REQUEST");

    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtensions({
          assignmentId: dated,
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });
});

/**
 * A batch is all of it or none of it.
 *
 * The reason the mutation takes a list rather than being called in a loop from the browser: eight
 * grants where the fifth is refused would otherwise leave four fellows with a deadline, one
 * instructor with an error, and no way to tell which is which.
 */
describe("a batch that cannot be applied whole", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Batch",
      dueAt: DUE,
    });
    assignmentId = assignment.id;
  });

  it("applies nothing when one fellow named is off the roster", async () => {
    const elsewhere = await makeWorld(tx(), { students: 1 });

    expect(
      await refusal(() =>
        asInstructor().submissions.grantExtensions({
          assignmentId,
          studentIds: [
            world.students[0]!.studentId,
            elsewhere.student.studentId,
            world.students[1]!.studentId,
          ],
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("NOT_FOUND");

    // The two who *were* on the roster have nothing, which is the whole point of the transaction.
    const held = await tx().submission.findMany({
      where: { assignmentId, extendedDueAt: { not: null } },
      select: { studentId: true },
    });

    expect(held).toEqual([]);
  });

  it("gives every fellow named the same deadline when it can", async () => {
    const granted = await asInstructor().submissions.grantExtensions({
      assignmentId,
      studentIds: [world.students[0]!.studentId, world.students[2]!.studentId],
      extendedDueAt: EXTENDED,
    });

    expect(granted.changed).toBe(2);

    const held = await tx().submission.findMany({
      where: { assignmentId, extendedDueAt: { not: null } },
      select: { studentId: true },
    });

    expect(new Set(held.map((row) => row.studentId))).toEqual(
      new Set([world.students[0]!.studentId, world.students[2]!.studentId]),
    );
  });

  // Granting again over a fellow who already has one is how changing it works — last write wins,
  // which is the semantics the column already has and needs no second control.
  it("replaces an agreement a fellow already had", async () => {
    const later = new Date("2026-10-20T00:00:00Z");

    await asInstructor().submissions.grantExtensions({
      assignmentId,
      studentIds: [world.students[0]!.studentId],
      extendedDueAt: later,
    });

    const row = await tx().submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.students[0]!.studentId },
      select: { extendedDueAt: true },
    });

    expect(row.extendedDueAt?.toISOString()).toBe(later.toISOString());
  });
});

/**
 * What the assignment's own screen can say about extensions.
 *
 * The read that did not exist before this: granting was possible and surveying was not, so an
 * instructor had no way to answer "who did I give longer to on this?" short of opening fellows one
 * at a time.
 */
describe("reading the extensions on one assignment", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Survey",
      dueAt: DUE,
    });
    assignmentId = assignment.id;

    await asInstructor().submissions.grantExtensions({
      assignmentId,
      studentIds: [world.students[1]!.studentId],
      extendedDueAt: EXTENDED,
    });
  });

  /*
    The roster rather than the submissions, which is what makes this screen able to agree a
    deadline in advance: on self-directed work nobody has a row until they submit.
  */
  it("lists every active fellow, whether or not they have handed anything in", async () => {
    const data = await asInstructor().submissions.extensionsForAssignment({ assignmentId });

    expect(data.grantedTo).toBe("fellow");
    expect(data.rows).toHaveLength(3);
  });

  it("says which of them has an agreed deadline, and who agreed it", async () => {
    const data = await asInstructor().submissions.extensionsForAssignment({ assignmentId });

    const granted = data.rows.filter((row) => row.extension !== null);
    expect(granted).toHaveLength(1);
    expect(granted[0]!.id).toBe(world.students[1]!.studentId);
    expect(granted[0]!.extension!.extendedDueAt.toISOString()).toBe(EXTENDED.toISOString());
    // Who agreed it travels as a name rather than an id, which is what the sheet prints.
    expect(granted[0]!.extension!.grantedBy).not.toBeNull();
    expect(granted[0]!.extension!.grantedAt).not.toBeNull();
  });

  it("names the assignment's own deadline, which the sheet reads against", async () => {
    const data = await asInstructor().submissions.extensionsForAssignment({ assignmentId });

    expect(data.assignment.dueAt?.toISOString()).toBe(DUE.toISOString());
  });

  it("refuses a fellow reading it", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), world.student.studentId).submissions.extensionsForAssignment({
          assignmentId,
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

    await createCaller(tx(), world.instructorId).submissions.grantExtensions({
      assignmentId,
      studentIds: [world.student.studentId],
      extendedDueAt: EXTENDED,
    });
  });

  /*
    Both dates travel, and they answer different questions: `effectiveDueAt` is the deadline this
    fellow is working to and is what every screen shows them, while `dueAt` stays the assignment's
    own so that `lateness` can tell a hand-in that missed the class deadline and met an agreed one
    from a hand-in that missed nothing.
  */
  it("their dashboard shows the deadline they were given", async () => {
    const rows = await createCaller(tx(), world.student.studentId).assignments.listMine();
    const row = rows.find((entry) => entry.id === assignmentId);

    expect(row?.effectiveDueAt?.toISOString()).toBe(EXTENDED.toISOString());
    expect(row?.dueAt?.toISOString()).toBe(DUE.toISOString());
  });

  it("their course page shows the same one", async () => {
    const rows = await createCaller(tx(), world.student.studentId).assignments.listForCourse({
      courseId: world.courseId,
    });
    const row = rows.find((entry) => entry.id === assignmentId);

    expect(row?.effectiveDueAt?.toISOString()).toBe(EXTENDED.toISOString());
    expect(row?.dueAt?.toISOString()).toBe(DUE.toISOString());
  });

  // A fellow with no agreement sees the class deadline, which is the control for the two above: on
  // their own they cannot tell a working substitution from a payload that always says the 8th.
  it("a fellow with no extension still sees the class deadline", async () => {
    const rows = await createCaller(tx(), world.students[1]!.studentId).assignments.listMine();
    const row = rows.find((entry) => entry.id === assignmentId);

    expect(row?.effectiveDueAt?.toISOString()).toBe(DUE.toISOString());
  });
});

/**
 * A deadline agreed about work a team hands in once.
 *
 * **The agreement is the team's**, because the work is: one hand-in, at one moment, so a date
 * agreed about it cannot belong to one member without reading the same submission as extended for
 * them and late for everybody else. What these check is the fan-out — that the write lands on the
 * row holding the work and reaches every member's own row, which is the only thing that makes the
 * verdict one verdict.
 */
describe("a deadline agreed about team work", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;
  let teamId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });

    const set = await tx().teamSet.create({
      data: {
        courseId: world.courseId,
        programId: world.programId,
        name: "Integration Extension Teams",
        teams: { create: [{ name: "Team 1", position: 0 }] },
      },
      select: { id: true, teams: { select: { id: true } } },
    });
    teamId = set.teams[0]!.id;

    // Two of the three fellows on the team, so the third is the control: an extension agreed with
    // the team must not reach somebody who is not on it.
    await tx().teamMembership.createMany({
      data: [world.students[0]!, world.students[1]!].map((member) => ({
        teamId,
        teamSetId: set.id,
        programId: world.programId,
        enrollmentId: member.id,
      })),
    });

    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Team Work",
      dueAt: DUE,
      teamSetId: set.id,
    });
    assignmentId = assignment.id;

    await createCaller(tx(), world.instructorId).submissions.grantExtensions({
      assignmentId,
      teamIds: [teamId],
      extendedDueAt: EXTENDED,
    });
  });

  /** Every row for this assignment, by student, with what the agreement wrote on it. */
  async function rows() {
    return tx().submission.findMany({
      where: { assignmentId },
      select: {
        studentId: true,
        teamSubmissionId: true,
        extendedDueAt: true,
        extensionGrantedById: true,
        extensionGrantedAt: true,
      },
    });
  }

  /*
    The team is on the assignment before anything has happened to the work, which is the whole
    point of reading it from membership: `hasAcceptStep` is false for self-directed work, so no
    submission row exists until somebody hands something in, and until this was fixed a fellow
    could not see who they were working with for the entire time they were working.

    Placed in this suite because granting an extension is what first made the gap visible — the
    grant created the rows, and the team appeared as a side effect.
  */
  it("names the team on the assignment before anything is handed in", async () => {
    const fresh = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension Team Untouched",
      dueAt: DUE,
      teamSetId: (
        await tx().team.findUniqueOrThrow({
          where: { id: teamId },
          select: { teamSetId: true },
        })
      ).teamSetId,
    });

    const rows = await createCaller(tx(), world.students[0]!.studentId).assignments.listForCourse({
      courseId: world.courseId,
    });
    const row = rows.find((entry) => entry.id === fresh.id);

    expect(row?.submissions).toHaveLength(0);
    expect(row?.team?.name).toBe("Team 1");
    expect(row?.team?.members.length).toBe(2);
  });

  it("reaches every member of the team, not only the one named", async () => {
    const held = await rows();
    const members = [world.students[0]!.studentId, world.students[1]!.studentId];

    for (const studentId of members) {
      const row = held.find((entry) => entry.studentId === studentId);
      expect(row?.extendedDueAt?.toISOString()).toBe(EXTENDED.toISOString());
    }
  });

  // All three columns travel together, or a mirror would refuse to be written: the table's CHECK
  // holds them null together or set together.
  it("carries who agreed to it onto every member's row", async () => {
    const held = await rows();

    for (const row of held) {
      expect(row.extensionGrantedById).toBe(world.instructorId);
      expect(row.extensionGrantedAt).not.toBeNull();
    }
  });

  it("says nothing about a fellow who is not on the team", async () => {
    const held = await rows();
    const outsider = held.find((entry) => entry.studentId === world.students[2]!.studentId);

    expect(outsider).toBeUndefined();
  });

  /*
    A member added after the agreement was made. `syncTeamRows` builds their mirror from the row
    holding the work, so the extension arrives with everything else the team's row says — which is
    what stops a fellow joining a project mid-way from being the only one counted late.
  */
  it("reaches a member who joins the team afterwards", async () => {
    await tx().teamMembership.create({
      data: {
        teamId,
        teamSetId: (
          await tx().team.findUniqueOrThrow({
            where: { id: teamId },
            select: { teamSetId: true },
          })
        ).teamSetId,
        programId: world.programId,
        enrollmentId: world.students[2]!.id,
      },
    });

    const work = await tx().submission.findFirstOrThrow({
      where: { assignmentId, teamSubmissionId: null },
      select: { id: true },
    });
    await syncTeamRows(tx(), { submissionId: work.id });

    const held = await rows();
    const joined = held.find((entry) => entry.studentId === world.students[2]!.studentId);

    expect(joined?.extendedDueAt?.toISOString()).toBe(EXTENDED.toISOString());
  });

  it("taking it back clears every member's row too", async () => {
    await createCaller(tx(), world.instructorId).submissions.grantExtensions({
      assignmentId,
      teamIds: [teamId],
      extendedDueAt: null,
    });

    const held = await rows();

    for (const row of held) {
      expect(row.extendedDueAt).toBeNull();
      expect(row.extensionGrantedById).toBeNull();
      expect(row.extensionGrantedAt).toBeNull();
    }
  });

  it("refuses a fellow who is on no team of the set", async () => {
    const set = await tx().teamSet.create({
      data: {
        courseId: world.courseId,
        programId: world.programId,
        name: "Integration Extension Empty Teams",
        teams: { create: [{ name: "Team 1", position: 0 }] },
      },
      select: { id: true },
    });

    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Extension No Team",
      dueAt: DUE,
      teamSetId: set.id,
    });

    expect(
      await refusal(() =>
        createCaller(tx(), world.instructorId).submissions.grantExtensions({
          assignmentId: assignment.id,
          studentIds: [world.students[0]!.studentId],
          extendedDueAt: EXTENDED,
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
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
    }

    const asInstructor = createCaller(tx(), world.instructorId);

    // The first two were agreed an extension; the third was not, and handed in at the same moment
    // as the first.
    for (const index of [0, 1]) {
      await asInstructor.submissions.grantExtensions({
        assignmentId,
        studentIds: [world.students[index]!.studentId],
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

  /*
    The hand-in time is the record the school keeps, and the word a fellow is shown is computed from
    it against the assignment's deadline and then the agreed one. Nothing is stored saying "late",
    so nothing has to be rewritten when a deadline moves.
  */
  it("keeps the hand-in time, which is what both deadlines are compared against", async () => {
    expect((await facts(0))?.submittedAt?.toISOString()).toBe(WITHIN.toISOString());
    expect((await facts(1))?.submittedAt?.toISOString()).toBe(AFTER_BOTH.toISOString());
  });

  // The fellow who was agreed nothing: no extension travels, so every reader measures them against
  // the assignment's own deadline and calls them late.
  it("says nothing about a fellow who agreed nothing", async () => {
    const row = await facts(2);
    expect(row?.extendedDueAt).toBeNull();
    expect(row?.submittedAt?.toISOString()).toBe(WITHIN.toISOString());
  });
});
