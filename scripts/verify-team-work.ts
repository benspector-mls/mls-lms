/**
 * Work handed in by a team: who may hand it in, which row holds it, and who is told.
 *
 * Run with `npm run verify:team-work`.
 *
 * `verify:team-sets` covers making the teams. This covers what happens when one of them hands
 * something in, which is the half where a mistake is expensive: the whole design is that **one row
 * holds the work and every member keeps a row of their own**, so the failures worth checking are a
 * mirror carrying something it should not, a member left one round behind, and a team appearing in
 * the grading pile once per member instead of once.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, with an
 * `EXTERNAL_URL` assignment created inside it. That kind is chosen because it needs no GitHub, no
 * sandbox and no model, and because it exercises the same `claimTeamWork` / `recordHandIn` /
 * `ensureTeamRows` path a repository assignment does — the difference between them is where the
 * work is, which is exactly the part that never reaches a mirror.
 *
 * Two groups run in their own transactions, because a refusal that comes from a constraint aborts
 * the transaction it happens in.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  /*
    Three distinct students, and the reason is the same as `verify:team-sets`: two members cannot
    tell "the fan-out reached everybody" from "the fan-out reached the first mirror". Three also
    leaves somebody to place on the team afterwards, which is the check that a member who joins
    late gets a row carrying what the team already did.
  */
  const candidates = await db.course.findMany({
    where: { archivedAt: null, instructors: { some: {} }, courseUnits: { some: {} } },
    select: {
      id: true,
      instructors: { take: 1, select: { userId: true } },
      courseUnits: { take: 1, select: { id: true } },
      enrollments: {
        orderBy: { createdAt: "asc" },
        take: 3,
        select: { id: true, studentId: true },
      },
    },
  });

  const course = candidates.find(
    (row) =>
      row.enrollments.length === 3 &&
      new Set(row.enrollments.map((enrollment) => enrollment.studentId)).size === 3,
  );

  if (!course) {
    return skip("no seeded course with an instructor, a unit, and three distinct students");
  }

  const courseId = course.id;
  const unitId = course.courseUnits[0]!.id;
  const instructor = course.instructors[0]!;
  const [alice, bob, cara] = course.enrollments as [
    (typeof course.enrollments)[number],
    (typeof course.enrollments)[number],
    (typeof course.enrollments)[number],
  ];
  const createCaller = createCallerFactory(appRouter);

  /** A course, a team set of one team, and an assignment handed in through it. */
  async function fixture(
    tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
    members: { id: string }[],
  ) {
    await tx.enrollment.updateMany({
      where: { id: { in: [alice.id, bob.id, cara.id] } },
      data: { status: "ACTIVE" },
    });

    const set = await tx.teamSet.create({
      data: {
        courseId,
        name: "Verify Work Teams",
        teams: { create: [{ name: "Team 1", position: 0 }] },
      },
      select: { id: true, teams: { select: { id: true } } },
    });
    const team = set.teams[0]!;

    await tx.teamMembership.createMany({
      data: members.map((member) => ({
        teamId: team.id,
        teamSetId: set.id,
        courseId,
        enrollmentId: member.id,
      })),
    });

    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Team Deliverable",
        kind: "EXTERNAL_URL",
        pointValue: 10,
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        dueAt: new Date("2026-09-10T23:59:00Z"),
        teamSetId: set.id,
      },
      select: { id: true },
    });

    return { setId: set.id, teamId: team.id, assignmentId: assignment.id };
  }

  /** Every row for one assignment, in a shape the checks can compare. */
  async function rowsFor(
    tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
    assignmentId: string,
  ) {
    return tx.submission.findMany({
      where: { assignmentId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        studentId: true,
        status: true,
        submittedAt: true,
        isLate: true,
        teamSubmissionId: true,
        submittedUrl: true,
        handedInById: true,
        finalScore: true,
      },
    });
  }

  // --- one hand-in, and what every member's row then says -------------------
  await inOwnTransaction(db, async (tx) => {
    const { assignmentId, teamId, setId } = await fixture(tx, [alice, bob]);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    const asBob = createCaller({ db: tx, user: { id: bob.studentId } } as never);
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

    await asAlice.submissions.submitWork({
      assignmentId,
      submittedUrl: "https://example.com/alice",
    });

    const afterFirst = await rowsFor(tx, assignmentId);
    check("one hand-in gives every member of the team a row", afterFirst.length, 2);
    check(
      "exactly one of them holds the work",
      afterFirst.filter((row) => row.teamSubmissionId === null).length,
      1,
    );

    const work = afterFirst.find((row) => row.teamSubmissionId === null)!;
    const mirror = afterFirst.find((row) => row.teamSubmissionId !== null)!;

    check("the mirror points at the row holding the work", mirror.teamSubmissionId, work.id);
    check(
      "the link is on the row holding the work and nowhere else",
      [work.submittedUrl, mirror.submittedUrl],
      ["https://example.com/alice", null],
    );
    check(
      "every member reads as having handed in, at the same moment",
      afterFirst.map((row) => [row.status, row.submittedAt?.toISOString(), row.isLate]),
      afterFirst.map(() => ["SUBMITTED", work.submittedAt?.toISOString(), false]),
    );
    check(
      "and every member's row names who handed it in",
      new Set(afterFirst.map((row) => row.handedInById)).size === 1 &&
        afterFirst[0]!.handedInById === alice.studentId,
      true,
    );

    /*
      The second member hands in. This is the check the whole "the row does not move" decision
      rests on: the work stays where it was, who handed it in moves, and when the team first
      handed in does not.
    */
    await asBob.submissions.submitWork({ assignmentId, submittedUrl: "https://example.com/bob" });

    const afterSecond = await rowsFor(tx, assignmentId);
    check(
      "a second member handing in writes onto the same row",
      afterSecond.filter((row) => row.teamSubmissionId === null).map((row) => row.id),
      [work.id],
    );
    check(
      "their link replaces what was there",
      afterSecond.find((row) => row.id === work.id)!.submittedUrl,
      "https://example.com/bob",
    );
    check(
      "who handed it in moves to them, on every member's row",
      new Set(afterSecond.map((row) => row.handedInById)),
      new Set([bob.studentId]),
    );
    check(
      "and when the team first handed in does not move",
      afterSecond.map((row) => row.submittedAt?.toISOString()),
      afterSecond.map(() => work.submittedAt?.toISOString()),
    );

    // --- the grading pile counts a team once ------------------------------
    const triage = await asInstructor.submissions.triage({ courseId });
    const forThis = triage.submissions.filter((row) => row.assignment.id === assignmentId);
    check("a team is one item in the grading pile, not one per member", forThis.length, 1);
    check("and the item is the row holding the work", forThis[0]?.id, work.id);

    const queue = await asInstructor.submissions.listForAssignment({ assignmentId });
    check("the queue lists the team once", queue.submissions.length, 1);
    check(
      "and sets every mirror aside, saying why",
      queue.asideSubmissions.map((row) => row.asideReason),
      ["team_mirror"],
    );
    checkThat(
      "the two lists together are every row, which is what makes them exhaustive",
      queue.submissions.length + queue.asideSubmissions.length === afterSecond.length,
      `${queue.submissions.length} + ${queue.asideSubmissions.length} of ${afterSecond.length}`,
    );
    check(
      "a mirror is waiting on nobody",
      queue.asideSubmissions.map((row) => row.bucket),
      [null],
    );

    // --- a member placed on the team after it handed in --------------------
    await tx.teamMembership.create({
      data: { teamId, teamSetId: setId, courseId, enrollmentId: cara.id },
    });
    await asBob.submissions.submitWork({ assignmentId, submittedUrl: "https://example.com/again" });

    const afterLate = await rowsFor(tx, assignmentId);
    const late = afterLate.find((row) => row.studentId === cara.studentId);
    check("a member placed on the team afterwards gets a row", late !== undefined, true);
    check(
      "and it carries what the team had already done rather than saying nothing happened",
      [late?.status, late?.submittedAt?.toISOString(), late?.teamSubmissionId === work.id],
      ["SUBMITTED", work.submittedAt?.toISOString(), true],
    );

    // --- a grade reaches everybody, and only through the work's own row ----
    //
    // Written directly rather than through approval, which is the next phase's. What is checked
    // here is that a mirror is where a grade can *arrive*, so releasing one has somewhere to go.
    await tx.submission.updateMany({
      where: { OR: [{ id: work.id }, { teamSubmissionId: work.id }] },
      data: { status: "GRADED", finalScore: 8, finalScorePossible: 10, isComplete: true },
    });

    const graded = await asInstructor.submissions.triage({ courseId });
    check(
      "a graded team is out of the pile entirely",
      graded.submissions.filter((row) => row.assignment.id === assignmentId).length,
      0,
    );

    // --- any member may declare a resubmission ----------------------------
    const mirrorRow = afterLate.find((row) => row.studentId === cara.studentId)!;
    await createCaller({
      db: tx,
      user: { id: cara.studentId },
    } as never).submissions.declareResubmission({ submissionId: mirrorRow.id });

    const declared = await rowsFor(tx, assignmentId);
    check(
      "declaring it from a mirror moves the whole team",
      new Set(declared.map((row) => row.status)),
      new Set(["RESUBMITTED"]),
    );
    check(
      "and the team is back in the pile exactly once",
      (await asInstructor.submissions.triage({ courseId })).submissions.filter(
        (row) => row.assignment.id === assignmentId,
      ).length,
      1,
    );
  });

  // --- who may hand in -----------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    const { assignmentId } = await fixture(tx, [alice, bob]);
    const asCara = createCaller({ db: tx, user: { id: cara.studentId } } as never);

    check(
      "a fellow on no team of the set cannot hand in",
      await refusal(() =>
        asCara.submissions.submitWork({ assignmentId, submittedUrl: "https://example.com/c" }),
      ),
      "PRECONDITION_FAILED",
    );
  });

  // --- work an instructor is reading is not work a member may replace ------
  await inOwnTransaction(db, async (tx) => {
    const { assignmentId } = await fixture(tx, [alice, bob]);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    const asBob = createCaller({ db: tx, user: { id: bob.studentId } } as never);

    await asAlice.submissions.submitWork({ assignmentId, submittedUrl: "https://example.com/a" });

    const work = await tx.submission.findFirstOrThrow({
      where: { assignmentId, teamSubmissionId: null },
      select: { id: true },
    });

    // A draft open on the team's work. The lock has to find it from a *different* member's
    // hand-in, which is the case that never fired before drafts were looked up on the team's row.
    await tx.gradingDraft.create({
      data: { submissionId: work.id, status: "READY", headSha: null },
    });

    check(
      "no member may replace the work while a draft on it is open",
      await refusal(() =>
        asBob.submissions.submitWork({ assignmentId, submittedUrl: "https://example.com/b" }),
      ),
      "CONFLICT",
    );
  });

  // --- the rollback really rolled back -------------------------------------
  check(
    "no team sets survived",
    await db.teamSet.count({ where: { name: "Verify Work Teams" } }),
    0,
  );
  check(
    "and no assignments did either",
    await db.assignment.count({ where: { title: "Verify Team Deliverable" } }),
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
