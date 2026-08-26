/**
 * The conversation about a piece of work: who may read it, who may write in it, and which row it
 * hangs off.
 *
 * Run with `npm run verify:comments`.
 *
 * The design is that **one thread hangs off the row holding the work**, so a team shares one
 * conversation, and that **a fellow may write before they have handed anything in**, so posting is
 * what brings a submission row into being. The failures worth checking are therefore a member
 * writing into a thread nobody else can see, a fellow's first comment leaving a row that reads as
 * started work, an unread count that is one person's answer given to another, and a question that
 * never reaches the instructor's screen.
 *
 * Driven through the tRPC callers inside transactions that are rolled back. `SELF_DIRECTED`
 * assignments are used because they need no GitHub, no sandbox, and no model, and
 * because a kind with no Accept is exactly the case where no submission row exists to begin with.
 *
 * Several groups run in their own transactions, because a refusal that comes from a constraint or
 * a trigger aborts the transaction it happens in.
 */
import { createChecker, inOwnTransaction, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/**
 * The text of a refusal rather than its code.
 *
 * `refusal` in the harness returns the code, which is the right thing for a `TRPCError` — there
 * the code is the contract and the wording is not. A trigger is the other way round: everything
 * one raises arrives under a single opaque Prisma code, so the code says only that something in
 * the database objected and the message is the only thing saying which rule did.
 */
async function refusalText(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return (err as Error).message;
  }
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  /*
    Two distinct fellows, which is all this needs.

    `verify:team-work` asks for three because it puts somebody on a team after the fact. Nothing
    here does: what the team checks below are that a member who does not hold the row reads the
    same thread, and that one reader's receipt is their own. Both are answered by two fellows and
    an instructor — the instructor writes, so both members have something unread that neither of
    them wrote, and one of them reading it must leave the other's count alone. Asking for a third
    fellow skipped this whole script on a program with two.
  */
  const candidates = await db.course.findMany({
    where: { archivedAt: null, instructors: { some: {} }, courseUnits: { some: {} } },
    select: {
      id: true,
      programId: true,
      publishedAt: true,
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

  const course = candidates.find(
    (row) =>
      row.program.enrollments.length === 2 &&
      new Set(row.program.enrollments.map((enrollment) => enrollment.studentId)).size === 2,
  );

  if (!course) {
    return skip("no seeded course with an instructor, a unit, and two distinct fellows");
  }

  const courseId = course.id;
  const programId = course.programId;
  // Captured here rather than read inside `ready`, which is a closure and does not keep the
  // narrowing the guard above established.
  const publishedAt = course.publishedAt ?? new Date("2026-08-01T09:00:00Z");
  const unitId = course.courseUnits[0]!.id;
  const instructor = course.instructors[0]!;
  const [alice, bob] = course.program.enrollments as [
    (typeof course.program.enrollments)[number],
    (typeof course.program.enrollments)[number],
  ];
  const createCaller = createCallerFactory(appRouter);

  type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

  /** Whatever the fixtures below need to be true of the course itself. */
  async function ready(tx: Tx) {
    await tx.enrollment.updateMany({
      where: { id: { in: [alice.id, bob.id] } },
      data: { status: "ACTIVE" },
    });
    // `distributedToStudent` requires a published course, and the seed may leave one unpublished.
    await tx.course.update({
      where: { id: courseId },
      data: { publishedAt },
    });
  }

  /** An assignment a fellow works alone, of a kind that has no Accept. */
  async function soloAssignment(tx: Tx) {
    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Comments Solo",
        kind: "SELF_DIRECTED",
        handInMethods: ["FILE"],
        pointValue: 10,
        acceptedFileTypes: [".py"],
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        sections: [{ grading: "manual", label: "Deliverable", pointValue: 10 }],
      },
      select: { id: true },
    });
    return assignment.id;
  }

  /** An assignment handed in by a team, and the team that hands it in. */
  async function teamAssignment(tx: Tx, members: { id: string }[]) {
    const set = await tx.teamSet.create({
      data: {
        courseId,
        programId,
        name: "Verify Comments Teams",
        teams: { create: [{ name: "Team Talk", position: 0 }] },
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

    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Comments Team",
        kind: "SELF_DIRECTED",
        handInMethods: ["LINK"],
        pointValue: 10,
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        teamSetId: set.id,
        sections: [{ grading: "manual", label: "Deliverable", pointValue: 10 }],
      },
      select: { id: true },
    });

    return { assignmentId: assignment.id, teamId: team.id, setId: set.id };
  }

  // --- a fellow asks before there is anything to ask about -------------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignmentId = await soloAssignment(tx);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);

    const before = await asAlice.submissionComments.thread({ assignmentId });
    check("a thread on work with no row reads as empty", before.comments.length, 0);
    check("and names no submission", before.submissionId, null);

    const after = await asAlice.submissionComments.post({
      assignmentId,
      body: "Do I hand this in as a .py file?",
    });

    check("posting the first comment returns it", after.comments.length, 1);
    check(
      "with the body that was written",
      after.comments[0]!.body,
      "Do I hand this in as a .py file?",
    );
    check(
      "attributed to the fellow's side of the conversation",
      after.comments[0]!.author.isInstructor,
      false,
    );
    check("which the author may withdraw", after.comments[0]!.isMine, true);
    check(
      "and it names no round, because there is no feedback yet",
      after.comments[0]!.round,
      null,
    );

    const row = await tx.submission.findFirstOrThrow({
      where: { assignmentId, studentId: alice.studentId },
      select: { id: true, status: true, submittedAt: true, teamId: true },
    });
    check("the row it created reads as not started", row.status, "NOT_STARTED");
    check("and as never handed in", row.submittedAt, null);
    check("the thread now names that row", after.submissionId, row.id);

    // Their own question is not news to them, which is the state they just left.
    check("the author has nothing unread", after.unreadCount, 0);
    check("and an instructor is owed an answer", after.awaitsReply, true);
  });

  // --- a team shares one conversation, whichever member speaks first ---------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const { assignmentId } = await teamAssignment(tx, [alice, bob]);

    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    const asBob = createCaller({ db: tx, user: { id: bob.studentId } } as never);
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

    await asAlice.submissionComments.post({
      assignmentId,
      body: "Should the API live in its own file?",
    });

    const rows = await tx.submission.findMany({
      where: { assignmentId },
      select: { id: true, studentId: true, teamSubmissionId: true, status: true },
    });

    check("one comment gives every member of the team a row", rows.length, 2);
    check(
      "exactly one of them holds the work",
      rows.filter((row) => row.teamSubmissionId === null).length,
      1,
    );

    const work = rows.find((row) => row.teamSubmissionId === null)!;
    /*
      Scoped to this assignment. Unscoped, this reads every comment in the database — real ones
      written through the interface included, which are committed and which a rolled-back
      transaction does not hide.
    */
    const comments = await tx.submissionComment.findMany({
      where: { submission: { assignmentId } },
      select: { submissionId: true },
    });
    check(
      "the comment hangs off the row holding the work",
      comments.map((c) => c.submissionId),
      [work.id],
    );

    const forBob = await asBob.submissionComments.thread({ assignmentId });
    check("a teammate who does not hold the row reads the same thread", forBob.comments.length, 1);
    check("and it resolves to the row holding the work", forBob.submissionId, work.id);
    check(
      "the author has nothing unread on it",
      (await asAlice.submissionComments.thread({ assignmentId })).unreadCount,
      0,
    );
    check("while their teammate has", forBob.unreadCount, 1);

    /*
      The instructor answers, which gives *both* members something unread that neither of them
      wrote. That is what makes the next three checks a real test of the receipt being per reader:
      with only the fellows writing, whoever wrote the message could never have it unread anyway.
    */
    await asInstructor.submissionComments.post({
      assignmentId,
      studentId: alice.studentId,
      body: "Either is fine — try one file first.",
    });

    const aliceAfterReply = await asAlice.submissionComments.thread({ assignmentId });
    const bobAfterReply = await asBob.submissionComments.thread({ assignmentId });
    check(
      "an instructor's reply reaches the member who holds the row",
      aliceAfterReply.unreadCount,
      1,
    );
    check("and the member who does not", bobAfterReply.unreadCount, 2);

    await asBob.submissionComments.markRead({
      submissionId: bobAfterReply.submissionId!,
      upTo: bobAfterReply.comments[bobAfterReply.comments.length - 1]!.id,
    });

    check(
      "reading it clears the reader's own count",
      (await asBob.submissionComments.thread({ assignmentId })).unreadCount,
      0,
    );
    check(
      "and leaves their teammate's alone",
      (await asAlice.submissionComments.thread({ assignmentId })).unreadCount,
      1,
    );

    // Whichever member writes next, it lands on the one thread.
    await asBob.submissionComments.post({ assignmentId, body: "I put it in server.js" });
    const all = await tx.submissionComment.findMany({
      where: { submission: { assignmentId } },
      select: { submissionId: true },
    });
    check(
      "a second member writing lands on the same row",
      new Set(all.map((c) => c.submissionId)).size,
      1,
    );
  });

  // --- writing straight at a mirror is refused by the database ---------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const { assignmentId } = await teamAssignment(tx, [alice, bob]);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    await asAlice.submissionComments.post({ assignmentId, body: "first" });

    const mirror = await tx.submission.findFirstOrThrow({
      where: { assignmentId, teamSubmissionId: { not: null } },
      select: { id: true },
    });

    const message = await refusalText(() =>
      tx.submissionComment.create({
        data: {
          submissionId: mirror.id,
          authorId: alice.studentId,
          authorRole: "STUDENT",
          body: "straight at the mirror",
        },
      }),
    );
    checkThat(
      "a comment on a team mirror is refused, by the trigger and in those words",
      message.includes("cannot hang off a team mirror"),
      `got: ${message}`,
    );
  });

  // --- who may read and write ------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignmentId = await soloAssignment(tx);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    const asBob = createCaller({ db: tx, user: { id: bob.studentId } } as never);
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

    await asAlice.submissionComments.post({ assignmentId, body: "Is a dict fine here?" });

    const teacherView = await asInstructor.submissionComments.thread({
      assignmentId,
      studentId: alice.studentId,
    });
    check("an instructor of the program reads the thread", teacherView.comments.length, 1);
    check("and may not withdraw somebody else's comment", teacherView.comments[0]!.isMine, false);

    const replied = await asInstructor.submissionComments.post({
      assignmentId,
      studentId: alice.studentId,
      body: "A dict is fine.",
    });
    check("their reply is recorded as staff", replied.comments[1]!.author.isInstructor, true);
    check("and the thread stops waiting on them", replied.awaitsReply, false);

    // One fellow may not read another's conversation. The input has a `studentId`, so this is
    // the check that naming somebody else does not work.
    const nosy = await refusal(() =>
      asBob.submissionComments.thread({ assignmentId, studentId: alice.studentId }),
    );
    check("one fellow naming another is refused", nosy, "FORBIDDEN");

    const unenrolled = await refusal(() =>
      asInstructor.submissionComments.thread({
        assignmentId,
        studentId: instructor.userId,
      }),
    );
    check(
      "an instructor naming somebody who is not on the roster is refused",
      unenrolled,
      "NOT_FOUND",
    );
  });

  // --- an undistributed assignment, and an unpublished course ----------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Comments Undistributed",
        kind: "SELF_DIRECTED",
        handInMethods: ["FILE"],
        pointValue: 10,
        acceptedFileTypes: [".py"],
        // Never handed out, which is what makes authoring safe.
        distributedAt: null,
        sections: [{ grading: "manual", label: "Deliverable", pointValue: 10 }],
      },
      select: { id: true },
    });
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);

    const hidden = await refusal(() =>
      asAlice.submissionComments.thread({ assignmentId: assignment.id }),
    );
    check("a fellow cannot open a thread on work that was never handed out", hidden, "NOT_FOUND");
  });

  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignmentId = await soloAssignment(tx);
    await tx.course.update({ where: { id: courseId }, data: { publishedAt: null } });
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);

    const unpublished = await refusal(() => asAlice.submissionComments.thread({ assignmentId }));
    check("nor on a course that has not been published", unpublished, "NOT_FOUND");
  });

  // --- withdrawing -----------------------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignmentId = await soloAssignment(tx);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    const asBob = createCaller({ db: tx, user: { id: bob.studentId } } as never);

    const posted = await asAlice.submissionComments.post({ assignmentId, body: "never mind" });
    const commentId = posted.comments[0]!.id;

    const notYours = await refusal(() => asBob.submissionComments.remove({ commentId }));
    check("a fellow cannot withdraw somebody else's comment", notYours, "FORBIDDEN");

    const after = await asAlice.submissionComments.remove({ commentId });
    check("withdrawing keeps the message in its place", after.comments.length, 1);
    check("with nothing readable in it", after.comments[0]!.body, null);
    check("and a thread of one tombstone waits on nobody", after.awaitsReply, false);

    const stored = await tx.submissionComment.findUniqueOrThrow({
      where: { id: commentId },
      select: { body: true, deletedAt: true },
    });
    check("the text stays in the column for an instructor to find", stored.body, "never mind");
    checkThat("and the row is marked withdrawn", stored.deletedAt !== null, "deletedAt was null");
  });

  // --- naming a round of feedback -------------------------------------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignmentId = await soloAssignment(tx);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);

    await asAlice.submissionComments.post({ assignmentId, body: "starting" });
    const submission = await tx.submission.findFirstOrThrow({
      where: { assignmentId, studentId: alice.studentId },
      select: { id: true },
    });

    const unapproved = await tx.gradingDraft.create({
      data: { submissionId: submission.id, status: "READY" },
      select: { id: true },
    });

    const notReleased = await refusal(() =>
      asAlice.submissionComments.post({
        assignmentId,
        body: "about a round nobody was sent",
        gradingDraftId: unapproved.id,
      }),
    );
    check("a comment cannot name a round that was never released", notReleased, "BAD_REQUEST");

    const released = await tx.gradingDraft.update({
      where: { id: unapproved.id },
      data: { status: "APPROVED", approvedAt: new Date("2026-09-05T10:00:00Z") },
      select: { id: true },
    });

    const answered = await asAlice.submissionComments.post({
      assignmentId,
      body: "Why did the SQL section lose two points?",
      gradingDraftId: released.id,
    });
    const anchored = answered.comments.find((comment) => comment.round !== null);
    check("a comment may name a released round", anchored?.round?.id, released.id);
    check("and the round is numbered as the feedback tab numbers it", anchored?.round?.number, 1);

    // A round of somebody else's work is refused, which the composite foreign key also forbids.
    const otherAssignmentId = await soloAssignment2(tx);
    const asBob = createCaller({ db: tx, user: { id: bob.studentId } } as never);
    await asBob.submissionComments.post({ assignmentId: otherAssignmentId, body: "mine" });

    const wrongSubmission = await refusal(() =>
      asBob.submissionComments.post({
        assignmentId: otherAssignmentId,
        body: "about your round",
        gradingDraftId: released.id,
      }),
    );
    check("nor a round belonging to another submission", wrongSubmission, "BAD_REQUEST");
  });

  /** A second solo assignment, for the checks that need two. */
  async function soloAssignment2(tx: Tx) {
    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Comments Solo Two",
        kind: "SELF_DIRECTED",
        handInMethods: ["FILE"],
        pointValue: 10,
        acceptedFileTypes: [".py"],
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        sections: [{ grading: "manual", label: "Deliverable", pointValue: 10 }],
      },
      select: { id: true },
    });
    return assignment.id;
  }

  // --- the instructor's questions list --------------------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      await ready(tx);
      const assignmentId = await soloAssignment(tx);
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      await asAlice.submissionComments.post({
        assignmentId,
        body: "## Stuck\n\nThe `JOIN` returns nothing. Any ideas?",
      });

      const listed = await asInstructor.submissions.triage({ courseId, cohort: "all" });
      const mine = listed.awaitingReply.filter((row) => row.assignment.id === assignmentId);
      check("a question reaches the instructor's screen", mine.length, 1);
      check("naming who asked", mine[0]!.student.id, alice.studentId);
      check("and how many are waiting", mine[0]!.waitingCount, 1);
      check(
        "with the markdown flattened for a one-line row",
        mine[0]!.excerpt,
        "Stuck The JOIN returns nothing. Any ideas?",
      );

      await asAlice.submissionComments.post({ assignmentId, body: "still stuck" });
      const twice = await asInstructor.submissions.triage({ courseId, cohort: "all" });
      check(
        "a follow-up is counted rather than listed twice",
        twice.awaitingReply.filter((row) => row.assignment.id === assignmentId).length,
        1,
      );
      check(
        "and says how many have piled up",
        twice.awaitingReply.find((row) => row.assignment.id === assignmentId)!.waitingCount,
        2,
      );

      await asInstructor.submissionComments.post({
        assignmentId,
        studentId: alice.studentId,
        body: "Check your GROUP BY.",
      });

      const answered = await asInstructor.submissions.triage({ courseId, cohort: "all" });
      check(
        "answering takes it off the list",
        answered.awaitingReply.filter((row) => row.assignment.id === assignmentId).length,
        0,
      );

      /*
      Settled without a reply, which is the other way off the list — for a question handled in
      person, or one the fellow worked out while waiting.
    */
      await asAlice.submissionComments.post({ assignmentId, body: "actually, one more thing" });
      const waitingAgain = await asInstructor.submissions.triage({ courseId, cohort: "all" });
      check(
        "a new question puts the thread back on the list",
        waitingAgain.awaitingReply.filter((row) => row.assignment.id === assignmentId).length,
        1,
      );

      const threadNow = await asInstructor.submissionComments.thread({
        assignmentId,
        studentId: alice.studentId,
      });
      const resolved = await asInstructor.submissionComments.resolve({
        submissionId: threadNow.submissionId!,
        resolved: true,
      });
      check("resolving records when it was settled", resolved.resolvedAt !== null, true);
      check("and the thread stops waiting without a reply", resolved.awaitsReply, false);
      check(
        "which takes it off the instructor's list",
        (await asInstructor.submissions.triage({ courseId, cohort: "all" })).awaitingReply.filter(
          (row) => row.assignment.id === assignmentId,
        ).length,
        0,
      );
      check(
        "and adds no message to the conversation",
        resolved.comments.length,
        threadNow.comments.length,
      );

      // Compared against the newest question rather than checked for null, so asking again waits.
      await asAlice.submissionComments.post({ assignmentId, body: "sorry, still stuck" });
      check(
        "a question asked after it was settled waits again",
        (await asInstructor.submissions.triage({ courseId, cohort: "all" })).awaitingReply.filter(
          (row) => row.assignment.id === assignmentId,
        ).length,
        1,
      );

      // A fellow may not settle their own question.
      check(
        "a fellow cannot resolve their own thread",
        await refusal(() =>
          asAlice.submissionComments.resolve({
            submissionId: threadNow.submissionId!,
            resolved: true,
          }),
        ),
        "FORBIDDEN",
      );

      /*
      The cohort picker narrows it, like every other figure on that screen. Alice is put in a
      cohort of her own and a question asked again; selecting the other cohort must not show it.
    */
      await asAlice.submissionComments.post({ assignmentId, body: "one more thing" });
      const cohort = await tx.cohort.create({
        data: { programId, name: "Verify Comments Cohort" },
        select: { id: true },
      });
      await tx.enrollment.update({ where: { id: alice.id }, data: { cohortId: cohort.id } });

      const inCohort = await asInstructor.submissions.triage({ courseId, cohort: cohort.id });
      const unassigned = await asInstructor.submissions.triage({ courseId, cohort: "unassigned" });
      check(
        "the question is in the cohort its asker is in",
        inCohort.awaitingReply.filter((row) => row.assignment.id === assignmentId).length,
        1,
      );
      check(
        "and not in a selection that excludes them",
        unassigned.awaitingReply.filter((row) => row.assignment.id === assignmentId).length,
        0,
      );
      // This group drives the whole triage procedure six times over. Prisma's five-second default
      // expires part way through and reports as a failure of whatever statement was in flight.
    },
    { timeout: 60_000 },
  );

  // --- the assignment's own queue carries the record ------------------------
  await inOwnTransaction(
    db,
    async (tx) => {
      await ready(tx);
      const assignmentId = await soloAssignment(tx);
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      const before = await asInstructor.submissions.listForAssignment({
        assignmentId,
        cohort: "all",
      });
      check(
        "nobody is in the queue before anything happens",
        before.submissions.filter((row) => row.student.id === alice.studentId).length,
        0,
      );

      await asAlice.submissionComments.post({ assignmentId, body: "Where do I start?" });

      const after = await asInstructor.submissions.listForAssignment({
        assignmentId,
        cohort: "all",
      });
      const alicesRow = after.submissions.find((row) => row.student.id === alice.studentId);
      check("a question puts the fellow in the assignment's queue", alicesRow !== undefined, true);
      check("with nothing to grade", alicesRow?.bucket, null);
      check("and the row says there is a conversation", alicesRow?.commentCount, 1);
      check("which is waiting on a reply", alicesRow?.commentsAwaitReply, true);

      // A fellow who has neither submitted nor said anything stays out of it.
      check(
        "somebody who has done nothing at all is still absent",
        after.submissions.filter((row) => row.student.id === bob.studentId).length,
        0,
      );

      await asInstructor.submissionComments.post({
        assignmentId,
        studentId: alice.studentId,
        body: "Read the README first.",
      });

      const answered = await asInstructor.submissions.listForAssignment({
        assignmentId,
        cohort: "all",
      });
      const answeredRow = answered.submissions.find((row) => row.student.id === alice.studentId);
      check("the row stays after it is answered, as a record", answeredRow?.commentCount, 2);
      check("and stops asking to be acted on", answeredRow?.commentsAwaitReply, false);
    },
    { timeout: 30_000 },
  );

  // --- a team member's own record reads their team's conversation -----------
  await inOwnTransaction(
    db,
    async (tx) => {
      await ready(tx);
      const { assignmentId } = await teamAssignment(tx, [alice, bob]);
      const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
      const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

      await asAlice.submissionComments.post({ assignmentId, body: "Who writes the API?" });

      const rows = await asInstructor.submissions.listForStudent({
        courseId,
        studentId: bob.studentId,
      });
      const bobsRow = rows.rows.find((row) => row.assignment.id === assignmentId)?.submission;

      // Bob holds a mirror; the thread is on Alice's row. Read through it, or the badge would be
      // right for whoever claimed the work and silent for everybody else on the team.
      check("a teammate's own record shows the team's conversation", bobsRow?.commentCount, 1);
      check("and that it is waiting", bobsRow?.commentsAwaitReply, true);
    },
    { timeout: 30_000 },
  );

  // --- the count the course list carries ------------------------------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignmentId = await soloAssignment(tx);
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);
    const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);

    await asAlice.submissionComments.post({ assignmentId, body: "a question" });
    await asInstructor.submissionComments.post({
      assignmentId,
      studentId: alice.studentId,
      body: "an answer",
    });

    const list = await asAlice.assignments.listForCourse({ courseId });
    const row = list
      .flatMap((assignment) => (assignment.id === assignmentId ? assignment.submissions : []))
      .at(0);
    const thread = await asAlice.submissionComments.thread({ assignmentId });

    check("the list carries the unread count", row?.unreadCommentCount, 1);
    check("and it agrees with the thread's own", row?.unreadCommentCount, thread.unreadCount);
  });

  // --- accepting after a comment created the row ----------------------------
  await inOwnTransaction(db, async (tx) => {
    await ready(tx);
    const assignment = await tx.assignment.create({
      data: {
        courseId,
        courseUnitId: unitId,
        title: "Verify Comments Drive",
        kind: "GOOGLE_DRIVE",
        pointValue: 10,
        templateDriveUrl: "https://docs.google.com/document/d/abc123/edit",
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        sections: [{ grading: "manual", label: "Deliverable", pointValue: 10 }],
      },
      select: { id: true },
    });
    const asAlice = createCaller({ db: tx, user: { id: alice.studentId } } as never);

    await asAlice.submissionComments.post({
      assignmentId: assignment.id,
      body: "Where do I find the template?",
    });
    await asAlice.assignments.accept({ assignmentId: assignment.id });

    const row = await tx.submission.findFirstOrThrow({
      where: { assignmentId: assignment.id, studentId: alice.studentId },
      select: { status: true },
    });
    // Without the promotion in `acceptDriveAssignment`, the upsert's empty `update` would leave
    // this at NOT_STARTED and the panel would go on offering the button that had just been pressed.
    check("accepting promotes a row a comment created", row.status, "ACCEPTED");
  });

  finish();
}

void main();
