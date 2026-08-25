/**
 * Team sets: making them, filling them, and what the database refuses on its own.
 *
 * Run with `npm run verify:team-sets`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, for the reason
 * `verify:groups` gives — authorization is half of what these procedures are, and a team id says
 * nothing about whose course it belongs to until the row is read.
 *
 * **The half that needs a live database rather than Jest is the writes.** Three of the new tables'
 * foreign keys are composite, which means Prisma owns whole sets of columns and refuses a write
 * that sets one of them by hand. TypeScript does not catch it: excess-property checking does not
 * reach the elements of an array built by a callback, so a nested create naming a column it does
 * not own compiles and then fails at runtime. That is a defect only this kind of script can see,
 * and it is the reason this exists rather than waiting for the phase that reads a team set.
 *
 * The strongest checks are the last group. Everything above them asks whether the procedures do
 * what they say; those ask whether the mistakes they prevent are possible at all — a fellow on two
 * teams of one set, a team holding another matriculation's fellow, two rows claiming to hold one team's
 * work, and a mirror pointing at a mirror. Each runs in its own transaction, because a constraint
 * violation aborts the transaction it happens in.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/** Refused somehow, where the code is Postgres's rather than one of Prisma's named few. */
async function refuses(work: () => Promise<unknown>): Promise<boolean> {
  return (await refusal(work)) !== "accepted";
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  /*
    A course with an instructor and **three** distinct students, chosen by that property rather
    than by being the first one found.

    Three rather than two. Placement is a partition, and the case that matters most is moving
    somebody from one team to another — which with two people and two teams passes whether the
    move happened or a stale row survived. Three also makes "distribute evenly" uneven, which is
    the arithmetic worth checking.
  */
  const candidates = await db.course.findMany({
    where: { archivedAt: null, instructors: { some: {} } },
    select: {
      id: true,
      programId: true,
      instructors: { take: 1, select: { userId: true } },
      assignments: { take: 1, select: { id: true } },
      /*
        The fellows are the matriculation's, reached through it. A team set divides them for one
        course's projects, so both scopes are named here — and a membership's keys share
        `programId`, which is what makes a cross-matriculation row unrepresentable.

        Any status. They are made active inside the throwaway transaction below, so a roster whose
        third fellow has been removed in the running application is still usable.
      */
      program: {
        select: {
          enrollments: {
            orderBy: { createdAt: "asc" },
            take: 3,
            select: { id: true, studentId: true },
          },
        },
      },
    },
  });

  const course = candidates.find(
    (row) =>
      row.program.enrollments.length === 3 &&
      new Set(row.program.enrollments.map((enrollment) => enrollment.studentId)).size === 3,
  );

  if (!course) return skip("no seeded course with an instructor and three distinct fellows");

  /* Read out once, because a hoisted function declaration below does not keep the narrowing. */
  const courseId = course.id;
  const programId = course.programId;

  /* Another matriculation's fellow, for the checks about naming somebody from outside. */
  const outsider = await db.enrollment.findFirst({
    where: { programId: { not: course.programId } },
    select: { id: true, programId: true, studentId: true },
  });

  const instructor = course.instructors[0]!;
  const [alice, bob, cara] = course.program.enrollments as [
    (typeof course.program.enrollments)[number],
    (typeof course.program.enrollments)[number],
    (typeof course.program.enrollments)[number],
  ];
  const createCaller = createCallerFactory(appRouter);

  // --- the procedures ------------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
    const asStudent = createCaller({ db: tx, user: { id: alice.studentId } } as never);

    await tx.enrollment.updateMany({
      where: { id: { in: [alice.id, bob.id, cara.id] } },
      data: { status: "ACTIVE" },
    });

    const created = await asInstructor.teamSets.create({
      courseId: course.id,
      name: "Verify Set A",
      teamCount: 2,
    });
    check("creating a set makes the teams it was asked for", created._count.teams, 2);

    const listed = await asInstructor.teamSets.listForCourse({ courseId: course.id });
    const set = listed.sets.find((row) => row.name === "Verify Set A")!;
    check(
      "the teams are named and ordered from one",
      set.teams.map((team) => [team.name, team.position]),
      [
        ["Team 1", 0],
        ["Team 2", 1],
      ],
    );
    check("a new set holds nobody", set.placedCount, 0);
    check("and nothing is handed in through it", set.assignmentCount, 0);
    checkThat(
      "every active fellow reads as unplaced",
      set.unplacedCount === listed.activeCount,
      `${set.unplacedCount} unplaced of ${listed.activeCount} active`,
    );

    const [teamOne, teamTwo] = set.teams;

    await asInstructor.teamSets.setPlacements({
      teamSetId: set.id,
      placements: [
        { enrollmentId: alice.id, teamId: teamOne.id },
        { enrollmentId: bob.id, teamId: teamTwo.id },
        { enrollmentId: cara.id, teamId: null },
      ],
    });

    const placed = (await asInstructor.teamSets.listForCourse({ courseId: course.id })).sets.find(
      (row) => row.id === set.id,
    )!;
    check(
      "placements land on the teams they name",
      placed.teams.map((team) => team.members.length),
      [1, 1],
    );
    check("and are counted", placed.placedCount, 2);

    /*
      The move. A set is a partition, so moving somebody is a delete and an insert against one
      unique key — and doing them in the wrong order collides with the row being replaced. This is
      the check that fails if `setPlacements` ever inserts before it deletes.
    */
    await asInstructor.teamSets.setPlacements({
      teamSetId: set.id,
      placements: [{ enrollmentId: alice.id, teamId: teamTwo.id }],
    });
    const moved = (await asInstructor.teamSets.listForCourse({ courseId: course.id })).sets.find(
      (row) => row.id === set.id,
    )!;
    check(
      "moving somebody between teams leaves them on exactly one",
      moved.teams.map((team) => team.members.length),
      [0, 2],
    );

    // A null team is how somebody is taken off without a second mutation.
    await asInstructor.teamSets.setPlacements({
      teamSetId: set.id,
      placements: [{ enrollmentId: alice.id, teamId: null }],
    });
    const unplaced = (await asInstructor.teamSets.listForCourse({ courseId: course.id })).sets.find(
      (row) => row.id === set.id,
    )!;
    check("a null team leaves them on none", unplaced.placedCount, 1);

    const third = await asInstructor.teamSets.addTeam({ teamSetId: set.id });
    check(
      "a team added later is named from its position",
      [third.name, third.position],
      ["Team 3", 2],
    );

    const renamedTeam = await asInstructor.teamSets.renameTeam({
      teamId: third.id,
      name: "The Otters",
    });
    check("a team can be renamed", renamedTeam.name, "The Otters");

    const removedTeam = await asInstructor.teamSets.removeTeam({ teamId: third.id });
    check("an empty team can be removed", removedTeam.memberCount, 0);

    const renamedSet = await asInstructor.teamSets.rename({
      teamSetId: set.id,
      name: "Verify Set B",
    });
    check("a set can be renamed", renamedSet.name, "Verify Set B");

    // --- refusals through the procedures ----------------------------------
    check(
      "a student cannot make a team set",
      await refusal(() =>
        asStudent.teamSets.create({ courseId: course.id, name: "Verify Nope", teamCount: 2 }),
      ),
      "FORBIDDEN",
    );
    check(
      "a student cannot read who is on which team",
      await refusal(() => asStudent.teamSets.listForCourse({ courseId: course.id })),
      "FORBIDDEN",
    );
    if (outsider) {
      check(
        "a set cannot hold another matriculation's fellow",
        await refusal(() =>
          asInstructor.teamSets.setPlacements({
            teamSetId: set.id,
            placements: [{ enrollmentId: outsider.id, teamId: teamOne.id }],
          }),
        ),
        "BAD_REQUEST",
      );
    } else {
      skip("no enrollment outside the fixture course, so the outsider checks did not run");
    }

    const otherSet = await asInstructor.teamSets.create({
      courseId: course.id,
      name: "Verify Set C",
      teamCount: 1,
    });
    const otherTeam = (
      await asInstructor.teamSets.listForCourse({ courseId: course.id })
    ).sets.find((row) => row.id === otherSet.id)!.teams[0];

    check(
      "a placement cannot name a team from another set",
      await refusal(() =>
        asInstructor.teamSets.setPlacements({
          teamSetId: set.id,
          placements: [{ enrollmentId: cara.id, teamId: otherTeam.id }],
        }),
      ),
      "BAD_REQUEST",
    );

    /*
      Removing a set that work is handed in through. The assignment is pointed at the set here
      rather than through the authoring form, which does not offer it yet — what is being checked
      is the refusal, not how an assignment comes to name a set.
    */
    if (course.assignments.length > 0) {
      await tx.assignment.update({
        where: { id: course.assignments[0]!.id },
        data: { teamSetId: otherSet.id },
      });
      check(
        "a set an assignment is handed in through cannot be removed",
        await refusal(() => asInstructor.teamSets.remove({ teamSetId: otherSet.id })),
        "CONFLICT",
      );
      await tx.assignment.update({
        where: { id: course.assignments[0]!.id },
        data: { teamSetId: null },
      });
    } else {
      skip("the fixture course has no assignment, so the in-use refusal did not run");
    }

    const removedSet = await asInstructor.teamSets.remove({ teamSetId: set.id });
    check("a set no assignment uses can be removed", removedSet.teamCount, 2);
  });

  /*
    A duplicate name, in its own transaction. The refusal comes from a unique constraint rather
    than from a check in the procedure, so it aborts whatever transaction it happens in — which is
    why it cannot sit with the checks above, and why every group below gets one of its own.
  */
  await inOwnTransaction(db, async (tx) => {
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
    await asInstructor.teamSets.create({
      courseId: course.id,
      name: "Verify Duplicate",
      teamCount: 1,
    });
    check(
      "two sets in one course cannot share a name",
      await refusal(() =>
        asInstructor.teamSets.create({
          courseId: course.id,
          name: "Verify Duplicate",
          teamCount: 1,
        }),
      ),
      "CONFLICT",
    );
  });

  // --- what the database refuses on its own --------------------------------
  //
  // Each in its own transaction: a constraint violation aborts the one it happens in, so a second
  // check after a refusal would fail for the wrong reason.

  await inOwnTransaction(db, async (tx) => {
    const set = await tx.teamSet.create({
      data: {
        courseId: course.id,
        programId,
        name: "Verify Partition",
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

    await tx.teamMembership.createMany({
      data: [
        {
          teamId: set.teams[0]!.id,
          teamSetId: set.id,
          programId,
          enrollmentId: alice.id,
        },
      ],
    });

    check(
      "a set is a partition: one fellow cannot be on two of its teams",
      await refusal(() =>
        tx.teamMembership.createMany({
          data: [
            {
              teamId: set.teams[1]!.id,
              teamSetId: set.id,
              programId,
              enrollmentId: alice.id,
            },
          ],
        }),
      ),
      "P2002",
    );
  });

  if (outsider) {
    await inOwnTransaction(db, async (tx) => {
      const set = await tx.teamSet.create({
        data: {
          courseId: course.id,
          programId,
          name: "Verify Outsider",
          teams: { create: [{ name: "Team 1", position: 0 }] },
        },
        select: { id: true, teams: { select: { id: true } } },
      });

      /*
        The three composite keys, tested from the direction that would slip past a procedure: the
        membership names the outsider's own matriculation, which is the only value that satisfies the
        enrollment key — and is then refused by the one that holds the set to *this* matriculation.
        There is no program id that satisfies all three.

        **`programId` is the shared column, and this is the pair that proves it.** The keys are
        `(teamId, teamSetId) → teams`, `(teamSetId, programId) → team_sets`, and
        `(enrollmentId, programId) → enrollments`; the second and third share the column, so naming
        another matriculation's fellow is unrepresentable rather than merely refused by the procedure
        that writes it.
      */
      checkThat(
        "a team cannot hold another matriculation's fellow, whichever program the row claims",
        await refuses(() =>
          tx.teamMembership.createMany({
            data: [
              {
                teamId: set.teams[0]!.id,
                teamSetId: set.id,
                programId: outsider.programId,
                enrollmentId: outsider.id,
              },
            ],
          }),
        ),
      );
      checkThat(
        "and cannot borrow this matriculation's id to name them either",
        await refuses(() =>
          tx.teamMembership.createMany({
            data: [
              {
                teamId: set.teams[0]!.id,
                teamSetId: set.id,
                programId,
                enrollmentId: outsider.id,
              },
            ],
          }),
        ),
      );
    });
  }

  // --- the submission side of the same idea --------------------------------
  //
  // One transaction per check, and each rebuilds the fixture. Every refusal here is a constraint
  // or a trigger rather than a line of TypeScript, so it aborts the transaction it happens in —
  // sharing one would mean the second check onwards failed because the first one worked.
  if (course.assignments.length === 0) {
    skip("the fixture course has no assignment, so the submission constraints did not run");
  } else {
    const assignmentId = course.assignments[0]!.id;

    /**
     * A set of one team, an assignment handed in through it, and that team's row holding the work.
     *
     * The assignment is pointed at the set here rather than through the authoring form, which
     * does not offer it yet: what these check is the shape of the constraint, not how an
     * assignment comes to name a set. `withMirror` adds one member's copy, for the checks about
     * what a mirror may point at.
     */
    async function inFixture(
      withMirror: boolean,
      body: (
        tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
        fixture: { setId: string; teamId: string; teamRowId: string; mirrorId: string | null },
      ) => Promise<void>,
    ) {
      await inOwnTransaction(db, async (tx) => {
        const set = await tx.teamSet.create({
          data: {
            courseId,
            programId,
            name: "Verify Submissions",
            teams: { create: [{ name: "Team 1", position: 0 }] },
          },
          select: { id: true, teams: { select: { id: true } } },
        });
        const teamId = set.teams[0]!.id;
        await tx.assignment.update({ where: { id: assignmentId }, data: { teamSetId: set.id } });

        // Whatever these three already had for this assignment, out of the way. Rolled back.
        await tx.submission.deleteMany({
          where: {
            assignmentId,
            studentId: { in: [alice.studentId, bob.studentId, cara.studentId] },
          },
        });

        await tx.submission.createMany({
          data: [{ assignmentId, studentId: alice.studentId, teamId, teamSetId: set.id }],
        });
        const teamRow = await tx.submission.findFirstOrThrow({
          where: { assignmentId, studentId: alice.studentId },
          select: { id: true },
        });

        let mirrorId: string | null = null;
        if (withMirror) {
          await tx.submission.createMany({
            data: [
              {
                assignmentId,
                studentId: bob.studentId,
                teamId,
                teamSetId: set.id,
                teamSubmissionId: teamRow.id,
              },
            ],
          });
          const mirror = await tx.submission.findFirstOrThrow({
            where: { assignmentId, studentId: bob.studentId },
            select: { id: true },
          });
          mirrorId = mirror.id;
        }

        await body(tx, { setId: set.id, teamId, teamRowId: teamRow.id, mirrorId });
      });
    }

    await inFixture(false, async (tx, fx) => {
      checkThat(
        "exactly one row per team holds the work",
        await refuses(() =>
          tx.submission.createMany({
            data: [
              { assignmentId, studentId: bob.studentId, teamId: fx.teamId, teamSetId: fx.setId },
            ],
          }),
        ),
      );
    });

    await inFixture(false, async (tx, fx) => {
      checkThat(
        "a team and its set are written together or not at all",
        await refuses(() =>
          tx.submission.createMany({
            data: [{ assignmentId, studentId: bob.studentId, teamId: fx.teamId }],
          }),
        ),
      );
    });

    await inFixture(false, async (tx, fx) => {
      checkThat(
        "a mirror has a team",
        await refuses(() =>
          tx.submission.createMany({
            data: [{ assignmentId, studentId: bob.studentId, teamSubmissionId: fx.teamRowId }],
          }),
        ),
      );
    });

    await inFixture(true, async (tx, fx) => {
      checkThat(
        "a mirror does not point at another mirror",
        await refuses(() =>
          tx.submission.createMany({
            data: [
              {
                assignmentId,
                studentId: cara.studentId,
                teamId: fx.teamId,
                teamSetId: fx.setId,
                teamSubmissionId: fx.mirrorId!,
              },
            ],
          }),
        ),
      );
    });

    await inFixture(true, async (tx, fx) => {
      checkThat(
        "the row holding the work cannot become a mirror of one of its own",
        await refuses(() =>
          tx.submission.update({
            where: { id: fx.teamRowId },
            data: { teamSubmissionId: fx.mirrorId! },
          }),
        ),
      );
    });

    await inFixture(true, async (tx, fx) => {
      checkThat(
        "a row is not a mirror of itself",
        await refuses(() =>
          tx.submission.update({
            where: { id: fx.mirrorId! },
            data: { teamSubmissionId: fx.mirrorId! },
          }),
        ),
      );
    });

    await inFixture(true, async (tx, fx) => {
      const mirror = await tx.submission.findFirstOrThrow({
        where: { id: fx.mirrorId! },
        select: { teamSubmissionId: true, repoFullName: true, prNumber: true },
      });
      check(
        "a mirror carries nothing about where the work is",
        [mirror.teamSubmissionId === fx.teamRowId, mirror.repoFullName, mirror.prNumber],
        [true, null, null],
      );
    });
  }

  // --- the rollback really rolled back -------------------------------------
  check(
    "no team sets survived the rollback",
    await db.teamSet.count({ where: { name: { startsWith: "Verify " } } }),
    0,
  );
  check(
    "and no assignment was left pointing at one",
    await db.assignment.count({ where: { courseId: course.id, teamSetId: { not: null } } }),
    0,
  );

  return finish();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
