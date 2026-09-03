/**
 * Team sets: making them, filling them, and what the database refuses on its own.
 *
 * Run with `npm run test:integration`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is half of what these procedures are and a team id says nothing about whose course it belongs to
 * until the row is read.
 *
 * **The half that needs a database rather than a unit test is the writes.** Three of these tables'
 * foreign keys are composite, which means Prisma owns whole sets of columns and refuses a write
 * that sets one of them by hand. TypeScript does not catch it: excess-property checking does not
 * reach the elements of an array built by a callback, so a nested create naming a column it does
 * not own compiles and then fails at runtime. That is a defect only a real write can find, and it
 * is why these checks existed before anything read a team set.
 *
 * The strongest group is the last. Everything above asks whether the procedures do what they say;
 * those ask whether the mistakes they prevent are possible at all — a fellow on two teams of one
 * set, a team holding another program's fellow, two rows claiming to hold one team's work, and a
 * mirror pointing at a mirror. Each runs in its own transaction, because a constraint violation
 * aborts the transaction it happens in.
 *
 * Carries the 32 assertions `verify:team-sets` recorded, **none of which had run in weeks**. The
 * script needed a seeded course with an instructor and three distinct fellows; a seeded database
 * has one fellow, so it reported a skip and exited non-zero every time. Three fellows are what the
 * checks actually require — placement is a partition, and moving somebody between teams passes with
 * two people whether the move happened or a stale row survived — so the fixture makes three.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { enroll, makeAccount, makeAssignment, makeProgram, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** Unique to this run, so the last group can ask whether anything it made survived. */
const suffix = crypto.randomUUID().slice(0, 8);
const setName = (label: string) => `${label} ${suffix}`;
const programNames: string[] = [];

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

/** Refused somehow, where the code is Postgres's rather than one of Prisma's named few. */
async function refuses(work: () => Promise<unknown>): Promise<boolean> {
  return (await refusal(work)) !== "accepted";
}

/**
 * A program, a course, an instructor, three fellows, and one piece of work.
 *
 * Three rather than two, and the reason is the move: placement is a partition, so moving somebody
 * from one team to another is a delete and an insert against one unique key, and with two people
 * and two teams that passes whether the move happened or a stale row survived. Three also makes
 * "distribute evenly" uneven, which is the arithmetic worth checking.
 */
async function fixture(tx: Tx) {
  const world = await makeWorld(tx, { students: 3 });
  programNames.push(setName("Integration Program"));
  const assignment = await makeAssignment(tx, {
    courseId: world.courseId,
    courseUnitId: world.unitId,
  });
  return { world, assignmentId: assignment.id };
}

/** Somebody on another program's roster, for the checks about naming an outsider. */
async function outsiderOf(tx: Tx) {
  const program = await makeProgram(tx, { name: setName("Elsewhere") });
  const studentId = await makeAccount(tx);
  return enroll(tx, { programId: program.id, studentId });
}

describe("the procedures", () => {
  const tx = withRollback();
  let world: World;
  let assignmentId: string;
  let outsider: { id: string; programId: string };
  let setId: string;
  let teamOne: { id: string };
  let teamTwo: { id: string };
  let otherSetId: string;
  let otherTeamId: string;

  const setsOf = async () =>
    (await createCaller(tx(), world.instructorId).teamSets.listForCourse({
      courseId: world.courseId,
    })).sets;

  const thisSet = async () => (await setsOf()).find((row) => row.id === setId)!;

  beforeAll(async () => {
    const built = await fixture(tx());
    world = built.world;
    assignmentId = built.assignmentId;
    outsider = await outsiderOf(tx());
  });

  it("creating a set makes the teams it was asked for", async () => {
    const created = await createCaller(tx(), world.instructorId).teamSets.create({
      courseId: world.courseId,
      name: setName("Set A"),
      teamCount: 2,
    });
    setId = created.id;
    expect(created._count.teams).toBe(2);
  });

  it("the teams are named and ordered from one", async () => {
    const set = await thisSet();
    [teamOne, teamTwo] = set.teams;
    expect(set.teams.map((team) => [team.name, team.position])).toEqual([
      ["Team 1", 0],
      ["Team 2", 1],
    ]);
  });

  it("a new set holds nobody", async () => {
    expect((await thisSet()).placedCount).toBe(0);
  });

  it("and nothing is handed in through it", async () => {
    expect((await thisSet()).assignmentCount).toBe(0);
  });

  it("every active fellow reads as unplaced", async () => {
    const listed = await createCaller(tx(), world.instructorId).teamSets.listForCourse({
      courseId: world.courseId,
    });
    const set = listed.sets.find((row) => row.id === setId)!;
    expect(set.unplacedCount).toBe(listed.activeCount);
  });

  it("placements land on the teams they name", async () => {
    await createCaller(tx(), world.instructorId).teamSets.setPlacements({
      teamSetId: setId,
      placements: [
        { enrollmentId: world.students[0]!.id, teamId: teamOne.id },
        { enrollmentId: world.students[1]!.id, teamId: teamTwo.id },
        { enrollmentId: world.students[2]!.id, teamId: null },
      ],
    });
    expect((await thisSet()).teams.map((team) => team.members.length)).toEqual([1, 1]);
  });

  it("and are counted", async () => {
    expect((await thisSet()).placedCount).toBe(2);
  });

  /*
    The move. A set is a partition, so moving somebody is a delete and an insert against one unique
    key — and doing them in the wrong order collides with the row being replaced. This is the check
    that fails if `setPlacements` ever inserts before it deletes.
  */
  it("moving somebody between teams leaves them on exactly one", async () => {
    await createCaller(tx(), world.instructorId).teamSets.setPlacements({
      teamSetId: setId,
      placements: [{ enrollmentId: world.students[0]!.id, teamId: teamTwo.id }],
    });
    expect((await thisSet()).teams.map((team) => team.members.length)).toEqual([0, 2]);
  });

  // A null team is how somebody is taken off without a second mutation.
  it("a null team leaves them on none", async () => {
    await createCaller(tx(), world.instructorId).teamSets.setPlacements({
      teamSetId: setId,
      placements: [{ enrollmentId: world.students[0]!.id, teamId: null }],
    });
    expect((await thisSet()).placedCount).toBe(1);
  });

  it("a team added later is named from its position", async () => {
    const third = await createCaller(tx(), world.instructorId).teamSets.addTeam({
      teamSetId: setId,
    });
    expect([third.name, third.position]).toEqual(["Team 3", 2]);
  });

  it("a team can be renamed", async () => {
    const set = await thisSet();
    const third = set.teams.find((team) => team.position === 2)!;
    const renamed = await createCaller(tx(), world.instructorId).teamSets.renameTeam({
      teamId: third.id,
      name: "The Otters",
    });
    expect(renamed.name).toBe("The Otters");
  });

  it("an empty team can be removed", async () => {
    const set = await thisSet();
    const third = set.teams.find((team) => team.position === 2)!;
    const removed = await createCaller(tx(), world.instructorId).teamSets.removeTeam({
      teamId: third.id,
    });
    expect(removed.memberCount).toBe(0);
  });

  it("a set can be renamed", async () => {
    const renamed = await createCaller(tx(), world.instructorId).teamSets.rename({
      teamSetId: setId,
      name: setName("Set B"),
    });
    expect(renamed.name).toBe(setName("Set B"));
  });

  it("a student cannot make a team set", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.students[0]!.studentId).teamSets.create({
        courseId: world.courseId,
        name: setName("Nope"),
        teamCount: 2,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a student cannot read who is on which team", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.students[0]!.studentId).teamSets.listForCourse({
        courseId: world.courseId,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a set cannot hold another program's fellow", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).teamSets.setPlacements({
        teamSetId: setId,
        placements: [{ enrollmentId: outsider.id, teamId: teamOne.id }],
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  it("a placement cannot name a team from another set", async () => {
    const otherSet = await createCaller(tx(), world.instructorId).teamSets.create({
      courseId: world.courseId,
      name: setName("Set C"),
      teamCount: 1,
    });
    otherSetId = otherSet.id;
    otherTeamId = (await setsOf()).find((row) => row.id === otherSetId)!.teams[0]!.id;

    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).teamSets.setPlacements({
        teamSetId: setId,
        placements: [{ enrollmentId: world.students[2]!.id, teamId: otherTeamId }],
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  /*
    Removing a set that work is handed in through. The assignment is pointed at the set directly
    rather than through the authoring form, which does not offer it — what is being checked is the
    refusal, not how an assignment comes to name a set.
  */
  it("a set an assignment is handed in through cannot be removed", async () => {
    await tx().assignment.update({ where: { id: assignmentId }, data: { teamSetId: otherSetId } });
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).teamSets.remove({ teamSetId: otherSetId }),
    );
    await tx().assignment.update({ where: { id: assignmentId }, data: { teamSetId: null } });
    expect(code).toBe("CONFLICT");
  });

  it("a set no assignment uses can be removed", async () => {
    const removed = await createCaller(tx(), world.instructorId).teamSets.remove({
      teamSetId: setId,
    });
    expect(removed.teamCount).toBe(2);
  });
});

/*
  A duplicate name, in its own transaction. The refusal comes from a unique constraint rather than
  from a check in the procedure, so it aborts whatever transaction it happens in — which is why it
  cannot sit with the checks above, and why every group below gets one of its own.
*/
describe("a duplicate set name", () => {
  const tx = withRollback();

  it("two sets in one course cannot share a name", async () => {
    const { world } = await fixture(tx());
    await createCaller(tx(), world.instructorId).teamSets.create({
      courseId: world.courseId,
      name: setName("Duplicate"),
      teamCount: 1,
    });
    const code = await refusal(() =>
      createCaller(tx(), world.instructorId).teamSets.create({
        courseId: world.courseId,
        name: setName("Duplicate"),
        teamCount: 1,
      }),
    );
    expect(code).toBe("CONFLICT");
  });
});

describe("a set is a partition", () => {
  const tx = withRollback();

  it("one fellow cannot be on two of its teams", async () => {
    const { world } = await fixture(tx());
    const set = await tx().teamSet.create({
      data: {
        courseId: world.courseId,
        programId: world.programId,
        name: setName("Partition"),
        // `teamSetId` is deliberately absent from each team: the relation is composite, so Prisma
        // fills both columns from the parent and refuses a write that names either.
        teams: {
          create: [
            { name: "Team 1", position: 0 },
            { name: "Team 2", position: 1 },
          ],
        },
      },
      select: { id: true, teams: { select: { id: true }, orderBy: { position: "asc" } } },
    });

    await tx().teamMembership.createMany({
      data: [
        {
          teamId: set.teams[0]!.id,
          teamSetId: set.id,
          programId: world.programId,
          enrollmentId: world.students[0]!.id,
        },
      ],
    });

    const code = await refusal(() =>
      tx().teamMembership.createMany({
        data: [
          {
            teamId: set.teams[1]!.id,
            teamSetId: set.id,
            programId: world.programId,
            enrollmentId: world.students[0]!.id,
          },
        ],
      }),
    );
    expect(code).toBe("P2002");
  });
});

/*
  The three composite keys, tested from the direction that would slip past a procedure. The keys are
  `(teamId, teamSetId) → teams`, `(teamSetId, programId) → team_sets`, and
  `(enrollmentId, programId) → enrollments`; the second and third share `programId`, so naming
  another term's fellow is unrepresentable rather than merely refused by the procedure that writes
  it. There is no program id that satisfies all three, and the pair below is what says so.
*/
describe("a team holding somebody from another program", () => {
  const tx = withRollback();
  let world: World;
  let outsider: { id: string; programId: string };
  let teamId: string;
  let teamSetId: string;

  beforeAll(async () => {
    world = (await fixture(tx())).world;
    outsider = await outsiderOf(tx());
    const set = await tx().teamSet.create({
      data: {
        courseId: world.courseId,
        programId: world.programId,
        name: setName("Outsider"),
        teams: { create: [{ name: "Team 1", position: 0 }] },
      },
      select: { id: true, teams: { select: { id: true } } },
    });
    teamSetId = set.id;
    teamId = set.teams[0]!.id;
  });

  it("a team cannot hold another program's fellow, whichever program the row claims", async () => {
    const refused = await refuses(() =>
      tx().teamMembership.createMany({
        data: [{ teamId, teamSetId, programId: outsider.programId, enrollmentId: outsider.id }],
      }),
    );
    expect(refused).toBe(true);
  });

  it("and cannot borrow this program's id to name them either", async () => {
    const refused = await refuses(() =>
      tx().teamMembership.createMany({
        data: [{ teamId, teamSetId, programId: world.programId, enrollmentId: outsider.id }],
      }),
    );
    expect(refused).toBe(true);
  });
});

/*
  ---- The submission side of the same idea -----------------------------------

  One transaction per check, and each rebuilds the fixture. Every refusal here is a constraint or a
  trigger rather than a line of TypeScript, so it aborts the transaction it happens in — sharing one
  would mean the second check onwards failed because the first one worked.
*/
describe("what a team's submissions may look like", () => {
  /**
   * A set of one team, an assignment handed in through it, and that team's row holding the work.
   *
   * `withMirror` adds one member's copy, for the checks about what a mirror may point at.
   */
  async function inFixture(
    tx: Tx,
    withMirror: boolean,
  ): Promise<{
    world: World;
    assignmentId: string;
    setId: string;
    teamId: string;
    teamRowId: string;
    mirrorId: string | null;
  }> {
    const { world, assignmentId } = await fixture(tx);

    const set = await tx.teamSet.create({
      data: {
        courseId: world.courseId,
        programId: world.programId,
        name: setName("Submissions"),
        teams: { create: [{ name: "Team 1", position: 0 }] },
      },
      select: { id: true, teams: { select: { id: true } } },
    });
    const teamId = set.teams[0]!.id;
    await tx.assignment.update({ where: { id: assignmentId }, data: { teamSetId: set.id } });

    await tx.submission.createMany({
      data: [
        {
          assignmentId,
          studentId: world.students[0]!.studentId,
          teamId,
          teamSetId: set.id,
        },
      ],
    });
    const teamRow = await tx.submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.students[0]!.studentId },
      select: { id: true },
    });

    let mirrorId: string | null = null;
    if (withMirror) {
      await tx.submission.createMany({
        data: [
          {
            assignmentId,
            studentId: world.students[1]!.studentId,
            teamId,
            teamSetId: set.id,
            teamSubmissionId: teamRow.id,
          },
        ],
      });
      const mirror = await tx.submission.findFirstOrThrow({
        where: { assignmentId, studentId: world.students[1]!.studentId },
        select: { id: true },
      });
      mirrorId = mirror.id;
    }

    return { world, assignmentId, setId: set.id, teamId, teamRowId: teamRow.id, mirrorId };
  }

  describe("two rows claiming one team's work", () => {
    const tx = withRollback();

    it("exactly one row per team holds the work", async () => {
      const fx = await inFixture(tx(), false);
      const refused = await refuses(() =>
        tx().submission.createMany({
          data: [
            {
              assignmentId: fx.assignmentId,
              studentId: fx.world.students[1]!.studentId,
              teamId: fx.teamId,
              teamSetId: fx.setId,
            },
          ],
        }),
      );
      expect(refused).toBe(true);
    });
  });

  describe("a team without its set", () => {
    const tx = withRollback();

    it("a team and its set are written together or not at all", async () => {
      const fx = await inFixture(tx(), false);
      const refused = await refuses(() =>
        tx().submission.createMany({
          data: [
            {
              assignmentId: fx.assignmentId,
              studentId: fx.world.students[1]!.studentId,
              teamId: fx.teamId,
            },
          ],
        }),
      );
      expect(refused).toBe(true);
    });
  });

  describe("a mirror without a team", () => {
    const tx = withRollback();

    it("a mirror has a team", async () => {
      const fx = await inFixture(tx(), false);
      const refused = await refuses(() =>
        tx().submission.createMany({
          data: [
            {
              assignmentId: fx.assignmentId,
              studentId: fx.world.students[1]!.studentId,
              teamSubmissionId: fx.teamRowId,
            },
          ],
        }),
      );
      expect(refused).toBe(true);
    });
  });

  describe("a mirror of a mirror", () => {
    const tx = withRollback();

    it("a mirror does not point at another mirror", async () => {
      const fx = await inFixture(tx(), true);
      const refused = await refuses(() =>
        tx().submission.createMany({
          data: [
            {
              assignmentId: fx.assignmentId,
              studentId: fx.world.students[2]!.studentId,
              teamId: fx.teamId,
              teamSetId: fx.setId,
              teamSubmissionId: fx.mirrorId!,
            },
          ],
        }),
      );
      expect(refused).toBe(true);
    });
  });

  describe("the row holding the work, pointed at its own copy", () => {
    const tx = withRollback();

    it("the row holding the work cannot become a mirror of one of its own", async () => {
      const fx = await inFixture(tx(), true);
      const refused = await refuses(() =>
        tx().submission.update({
          where: { id: fx.teamRowId },
          data: { teamSubmissionId: fx.mirrorId! },
        }),
      );
      expect(refused).toBe(true);
    });
  });

  describe("a row pointed at itself", () => {
    const tx = withRollback();

    it("a row is not a mirror of itself", async () => {
      const fx = await inFixture(tx(), true);
      const refused = await refuses(() =>
        tx().submission.update({
          where: { id: fx.mirrorId! },
          data: { teamSubmissionId: fx.mirrorId! },
        }),
      );
      expect(refused).toBe(true);
    });
  });

  describe("what a mirror carries", () => {
    const tx = withRollback();

    it("a mirror carries nothing about where the work is", async () => {
      const fx = await inFixture(tx(), true);
      const mirror = await tx().submission.findFirstOrThrow({
        where: { id: fx.mirrorId! },
        select: { teamSubmissionId: true, repoFullName: true, prNumber: true },
      });
      expect([mirror.teamSubmissionId === fx.teamRowId, mirror.repoFullName, mirror.prNumber]).toEqual(
        [true, null, null],
      );
    });
  });
});

/*
  Every group above rolled its transaction back, and this is the check that says so. It reads the
  committed database, outside any transaction, after all of them have ended.
*/
describe("the rollback really rolled back", () => {
  it("no team set this run made survived", async () => {
    const leftover = await db.teamSet.count({ where: { name: { endsWith: suffix } } });
    expect(leftover).toBe(0);
  });

  it("and neither did the programs its fixtures created", async () => {
    const leftover = await db.program.count({ where: { name: { endsWith: suffix } } });
    expect(leftover).toBe(0);
  });
});
