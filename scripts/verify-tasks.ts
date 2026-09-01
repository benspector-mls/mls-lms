/**
 * Tasks: the kind with nothing to hand in, marked done by a fellow and settled by an instructor.
 *
 * Run with `npm run verify:tasks`.
 *
 * `verify:authoring` covers the shape a task is allowed to have. This covers what happens when
 * somebody presses one of the three buttons, which is the half where a mistake is expensive — a
 * task's verdict is written by two procedures rather than one, and the failures worth checking are
 * a fellow clearing a verdict their instructor set, a mark on a team task reaching only the member
 * who pressed it, and a verdict landing on the wrong kind of assignment altogether.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, with the task created
 * inside it. Nothing here touches GitHub, a sandbox, or a model, because a task involves none of
 * them — which is most of the reason the kind exists.
 *
 * Several groups run in their own transactions, because a refusal that comes from a constraint
 * aborts the transaction it happens in.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  /*
    One fellow is enough for everything except the team group, which needs two: "the mark reached
    the team" and "the mark reached the person who pressed it" are the same row when a team has one
    member on it.

    **The team group is skipped on its own rather than the whole script**, because a seed with a
    single fellow is the ordinary state of a fresh development database and skipping everything
    there would mean these procedures are never actually exercised by anybody running this.
  */
  const candidates = await db.course.findMany({
    where: { archivedAt: null, instructors: { some: {} }, courseUnits: { some: {} } },
    select: {
      id: true,
      programId: true,
      instructors: { take: 1, select: { userId: true } },
      courseUnits: { take: 1, select: { id: true } },
      program: {
        select: {
          enrollments: {
            orderBy: { createdAt: "asc" },
            take: 2,
            select: { id: true, studentId: true },
          },
        },
      },
    },
  });

  const course = candidates.find((row) => row.program.enrollments.length >= 1);

  if (!course) {
    return skip("no seeded course with an instructor, a unit, and a fellow");
  }

  const courseId = course.id;
  const programId = course.programId;
  const unitId = course.courseUnits[0]!.id;
  const instructor = course.instructors[0]!;
  const alice = course.program.enrollments[0]!;
  /** The second fellow, when the seed has one. Only the team group needs them. */
  const bob = course.program.enrollments[1] ?? null;
  const createCaller = createCallerFactory(appRouter);

  const DUE = new Date("2026-09-10T23:59:00Z");

  type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

  /** A published task, individual and self-marked unless asked otherwise. */
  async function task(tx: Tx, options: { teamSetId?: string; studentMayMarkDone?: boolean } = {}) {
    await tx.enrollment.updateMany({
      where: { id: { in: [alice.id, bob?.id].filter((id): id is string => id !== undefined) } },
      data: { status: "ACTIVE" },
    });

    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Task",
        kind: "TASK",
        // One point and no sections, which is the whole of a task's grading configuration.
        pointValue: 1,
        sections: [],
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        dueAt: DUE,
        teamSetId: options.teamSetId ?? null,
        studentMayMarkDone: options.studentMayMarkDone ?? true,
      },
      select: { id: true },
    });

    return assignment.id;
  }

  /**
   * A second fellow on the roster, made inside the transaction when the seed has only one.
   *
   * **The team group is the half of this feature that a single fellow cannot check at all** — with
   * a team of one, "the mark reached the team" and "the mark reached whoever pressed it" are the
   * same row — and a development database seeded with one student is the ordinary case. Skipping
   * there would mean the mirroring path is never exercised by anybody running this.
   *
   * The insert is into `auth.users`, which Supabase owns, and the profile appears by itself: the
   * on-signup trigger is what creates one, and it is the same path a real fellow arrives by. Raw
   * SQL because Prisma treats that table as external and never writes it. Everything here is
   * inside the caller's transaction and rolled back with it.
   *
   * Returns null if no profile appears, so a database without the trigger skips the group rather
   * than failing it — the absence of the trigger is not what this script is about.
   */
  async function temporaryFellow(tx: Tx) {
    const id = "beefbeef-0000-4000-8000-00000000beef";
    const email = "verify-tasks-temp-fellow@example.com";

    await tx.$executeRawUnsafe(
      `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, now(), now())`,
      id,
      email,
    );

    const profile = await tx.profile.findUnique({ where: { id }, select: { id: true } });
    if (!profile) return null;

    return tx.enrollment.create({
      data: { programId, studentId: profile.id, status: "ACTIVE" },
      select: { id: true, studentId: true },
    });
  }

  /** A team set of one team, holding whichever members are named. */
  async function teamOf(tx: Tx, members: { id: string }[]) {
    const set = await tx.teamSet.create({
      data: {
        courseId,
        programId,
        name: "Verify Task Teams",
        teams: { create: [{ name: "Team 1", position: 0 }] },
      },
      select: { id: true, teams: { select: { id: true } } },
    });
    const team = set.teams[0]!;

    await tx.teamMembership.createMany({
      data: members.map((member) => ({
        teamId: team.id,
        teamSetId: set.id,
        programId,
        enrollmentId: member.id,
      })),
    });

    return set.id;
  }

  /** Every row for one assignment, in a shape the checks can compare. */
  async function rowsFor(tx: Tx, assignmentId: string) {
    return tx.submission.findMany({
      where: { assignmentId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        studentId: true,
        status: true,
        isComplete: true,
        finalScore: true,
        finalScorePossible: true,
        gradedById: true,
        handedInById: true,
        feedbackReviewedAt: true,
        submittedAt: true,
        teamSubmissionId: true,
      },
    });
  }

  // --- a fellow marking their own task, and taking it back ------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      const assignmentId = await task(tx);
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);

      check(
        "before anybody presses anything there is no row at all",
        (await rowsFor(tx, assignmentId)).length,
        0,
      );

      await asAlice.submissions.markTask({ assignmentId, done: true });

      const done = await rowsFor(tx, assignmentId);
      check("marking it done creates the row", done.length, 1);
      check("and settles it, because nobody is waiting on it", done[0]!.status, "GRADED");
      check("with the point awarded", [done[0]!.finalScore, done[0]!.finalScorePossible], [1, 1]);
      check("and completion recorded", done[0]!.isComplete, true);
      check("attributed to the fellow who pressed it", done[0]!.gradedById, alice.studentId);
      /*
        The column that keeps a marked task off the fellow's "Feedback to read" list. A task
        releases no report, so it is born read — left null, `feedbackIsUnread` would offer every
        fellow a report that does not exist.
      */
      check(
        "and marked read, because there is no report to read",
        done[0]!.feedbackReviewedAt !== null,
        true,
      );

      await asAlice.submissions.markTask({ assignmentId, done: false });

      const undone = await rowsFor(tx, assignmentId);
      check("taking the mark back returns it to not started", undone[0]!.status, "NOT_STARTED");
      check("with no verdict standing", undone[0]!.isComplete, null);
      check("and no score", undone[0]!.finalScore, null);
      /*
        Cleared with the rest. A row that kept a submission time would go on reading as handed in,
        which keeps it off the fellow's own overdue list — the one place they would look to notice
        they still have to do it.
      */
      check("and nothing recorded about when it was done", undone[0]!.submittedAt, null);
    },
    { timeout: 60_000 },
  );

  // --- an instructor overruling a fellow ------------------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      const assignmentId = await task(tx);
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      await asAlice.submissions.markTask({ assignmentId, done: true });
      await asInstructor.submissions.setTaskCompletion({
        assignmentId,
        studentId: alice.studentId,
        done: false,
      });

      const sentBack = await rowsFor(tx, assignmentId);
      check("an instructor can mark a fellow's task not done", sentBack[0]!.isComplete, false);
      check("which scores nothing out of one", [sentBack[0]!.finalScore, 1], [0, 1]);
      check("recorded against the instructor", sentBack[0]!.gradedById !== alice.studentId, true);
      /*
        `handedInById` names the member who did the work. Overruling somebody is not doing their
        work, so the column keeps whoever marked it — which is what the fellow's own panel reads
        to say who marked a team's task.
      */
      check("without rewriting who marked it", sentBack[0]!.handedInById, alice.studentId);

      const audited = await tx.auditEvent.count({
        where: { action: "GRADE_APPROVED", subjectId: alice.studentId },
      });
      check("and written to the audit log", audited > 0, true);

      /*
        The rule that makes an instructor's verdict stick. A fellow may take back a mark that
        stands as done; clearing "this was not done" is overruling their instructor, and the way
        out of it is to do the task again.
      */
      check(
        "a fellow cannot clear a verdict their instructor set",
        await refusal(() => asAlice.submissions.markTask({ assignmentId, done: false })),
        "PRECONDITION_FAILED",
      );

      await asAlice.submissions.markTask({ assignmentId, done: true });
      const redone = await rowsFor(tx, assignmentId);
      check("but can do it again and mark it done", redone[0]!.isComplete, true);
    },
    { timeout: 60_000 },
  );

  // --- an instructor marking a fellow who has no row ------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      const assignmentId = await task(tx);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      /*
        The case the roster queue exists for. A task's queue lists every fellow, including the ones
        with nothing on record, so the control has to work on somebody who has no submission — which
        is why the procedure is keyed on the student rather than on a submission id.
      */
      const queue = await asInstructor.submissions.listForAssignment({
        assignmentId,
        cohort: "all",
      });
      check(
        "a task's queue lists the fellows who have no row",
        queue.notStarted.some((student) => student.id === alice.studentId),
        true,
      );

      await asInstructor.submissions.setTaskCompletion({
        assignmentId,
        studentId: alice.studentId,
        done: true,
      });

      const rows = await rowsFor(tx, assignmentId);
      check("marking one of them creates their row", rows.length, 1);
      check("done, with the point", [rows[0]!.isComplete, rows[0]!.finalScore], [true, 1]);
      check("for the fellow who was named", rows[0]!.studentId, alice.studentId);

      const after = await asInstructor.submissions.listForAssignment({
        assignmentId,
        cohort: "all",
      });
      check(
        "and moves them out of the not-started list into the queue proper",
        [
          after.notStarted.some((student) => student.id === alice.studentId),
          after.submissions.some((row) => row.student.id === alice.studentId),
        ],
        [false, true],
      );
    },
    { timeout: 60_000 },
  );

  // --- a team task ----------------------------------------------------------
  //
  // One member marks it and everybody's row says so, which is the half of the design that cannot
  // be seen with a single fellow — a team of one makes "reached the team" and "reached whoever
  // pressed it" the same row.
  await inOwnTransaction(
    db,
    async (tx) => {
      const second = bob ?? (await temporaryFellow(tx));
      if (!second) {
        return skip("team tasks — no second fellow, and none could be made");
      }

      {
        const teamSetId = await teamOf(tx, [alice, second]);
        const assignmentId = await task(tx, { teamSetId });
        const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
        const asBob = createCaller({ db: tx, user: { id: second.studentId } } as never);

        await asAlice.submissions.markTask({ assignmentId, done: true });

        const rows = await rowsFor(tx, assignmentId);
        check("one member marking it gives every member a row", rows.length, 2);
        check(
          "exactly one of them holds the work",
          rows.filter((row) => row.teamSubmissionId === null).length,
          1,
        );
        check(
          "and every member's row says it is done",
          rows.every((row) => row.isComplete === true && row.finalScore === 1),
          true,
        );
        /*
        Not one of `MIRRORED_COLUMNS`, so `syncTeamRows` neither copies it nor puts it on the rows
        it creates — `recordTaskVerdict` writes it afterwards for exactly this reason. Without that
        write, Bob's dashboard would offer him a report on a task that has none.
      */
        check(
          "including the one that keeps it off their 'feedback to read' list",
          rows.every((row) => row.feedbackReviewedAt !== null),
          true,
        );

        // Any active member acts for the team, which is the same rule handing in follows.
        await asBob.submissions.markTask({ assignmentId, done: false });
        const cleared = await rowsFor(tx, assignmentId);
        check(
          "a teammate can take the team's mark back",
          cleared.every((row) => row.status === "NOT_STARTED" && row.isComplete === null),
          true,
        );
      }
    },
    { timeout: 60_000 },
  );

  // --- a task only an instructor may mark -----------------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      const assignmentId = await task(tx, { studentMayMarkDone: false });
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      /*
        Both directions refused by one check, because a fellow who may not mark a task done may
        certainly not mark one not done. The student's panel draws no button from the same
        function, so reaching this refusal means something other than the screen asked.
      */
      check(
        "a fellow cannot mark an instructor-only task done",
        await refusal(() => asAlice.submissions.markTask({ assignmentId, done: true })),
        "FORBIDDEN",
      );
      check(
        "nor mark it not done",
        await refusal(() => asAlice.submissions.markTask({ assignmentId, done: false })),
        "FORBIDDEN",
      );
      check(
        "and no row was created by either attempt",
        (await rowsFor(tx, assignmentId)).length,
        0,
      );

      // The instructor's own control is unchanged: they set either verdict on any task.
      await asInstructor.submissions.setTaskCompletion({
        assignmentId,
        studentId: alice.studentId,
        done: true,
      });

      const marked = await rowsFor(tx, assignmentId);
      check("an instructor still marks it", [marked.length, marked[0]!.isComplete], [1, true]);

      /*
        And the fellow may not take an instructor's mark back on this kind of task, which the
        self-marked guard alone would have allowed: that one keys on `isComplete`, and a mark
        standing as done is exactly what it lets a fellow clear.
      */
      check(
        "and the fellow cannot undo it, though it stands as done",
        await refusal(() => asAlice.submissions.markTask({ assignmentId, done: false })),
        "FORBIDDEN",
      );
    },
    { timeout: 60_000 },
  );

  // --- what neither procedure will do --------------------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      const assignmentId = await task(tx);
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      const linkAssignment = await tx.assignment.create({
        data: {
          courseId,
          courseUnitId: unitId,
          title: "Verify Not A Task",
          kind: "SELF_DIRECTED",
          handInMethods: ["LINK"],
          pointValue: 10,
          distributedAt: new Date("2026-09-01T09:00:00Z"),
          sections: [{ grading: "manual", label: "Overall", pointValue: 10 }],
        },
        select: { id: true },
      });

      /*
        The check that stops a verdict landing on the wrong kind. `assertCanHandIn` refuses REPO
        and admits everything else, so without an explicit test of the kind a request naming a
        link assignment would reach the write and grade it 1/1 with nothing handed in.
      */
      check(
        "a fellow cannot mark a link assignment done",
        await refusal(() =>
          asAlice.submissions.markTask({ assignmentId: linkAssignment.id, done: true }),
        ),
        "BAD_REQUEST",
      );
      check(
        "and neither can an instructor",
        await refusal(() =>
          asInstructor.submissions.setTaskCompletion({
            assignmentId: linkAssignment.id,
            studentId: alice.studentId,
            done: true,
          }),
        ),
        "BAD_REQUEST",
      );

      // A task hands nothing out, so there is nothing to accept.
      check(
        "and a task cannot be accepted",
        await refusal(() => asAlice.assignments.accept({ assignmentId })),
        "PRECONDITION_FAILED",
      );
    },
    { timeout: 60_000 },
  );

  // --- a fellow who is not on the roster ------------------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      const assignmentId = await task(tx);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      await tx.enrollment.update({ where: { id: alice.id }, data: { status: "REMOVED" } });

      /*
        Not redundant with teaching the course. Without it an instructor could write a verdict onto
        somebody from another program by naming their id, and the row would be created to hold it.
      */
      check(
        "an instructor cannot set a verdict for somebody off the roster",
        await refusal(() =>
          asInstructor.submissions.setTaskCompletion({
            assignmentId,
            studentId: alice.studentId,
            done: true,
          }),
        ),
        "NOT_FOUND",
      );
    },
    { timeout: 60_000 },
  );

  finish();
}

void main();
