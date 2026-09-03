/**
 * The conversation about a piece of work: who may read it, who may write in it, and which row it
 * hangs off.
 *
 * Run with `npm run test:integration`.
 *
 * The design is that **one thread hangs off the row holding the work**, so a team shares one
 * conversation, and that **a fellow may write before they have handed anything in**, so posting is
 * what brings a submission row into being. The failures worth checking are therefore a member
 * writing into a thread nobody else can see, a fellow's first comment leaving a row that reads as
 * started work, an unread count that is one person's answer given to another, and a question that
 * never reaches the instructor's screen.
 *
 * Driven through the tRPC callers inside transactions that are rolled back. `SELF_DIRECTED`
 * assignments are used because they need no GitHub, no sandbox, and no model, and because a kind
 * with no Accept is exactly the case where no submission row exists to begin with.
 *
 * Every group holds a transaction of its own. That is required of the mirror group, whose check
 * provokes a trigger and so aborts the transaction it happens in, and it is what keeps the other
 * groups independent of the order they run in.
 *
 * Carries the 72 assertions of `verify:comments`, **none of which had ever run on a freshly seeded
 * database**. The script asked the seed for a course with an instructor, a unit and two distinct
 * fellows; a seeded database has one fellow, so the script skipped every group it had and reported
 * nothing at all. Two fellows are what these checks need — a team's second member is what makes
 * "the thread reached the team" a different fact from "the thread reached whoever wrote in it", and
 * one reader's receipt clearing while the other's stands cannot be seen with a single reader — so
 * the fixture makes two, and makes the instructor and the published course with them.
 *
 * One check is added to the 72. The script asked the cohort picker for the selection Alice is *not*
 * in and asserted it was empty, which is also what a broken filter returning nothing at all would
 * answer. So a second fellow, in no cohort, asks a question of the same assignment: the "unassigned"
 * selection now has to carry his question and leave out hers, which fails for a filter that returns
 * everything and for one that returns nothing.
 */
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAssignment, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

type Caller = ReturnType<typeof createCaller>;
/** One thread as a reader is owed it, which is what both `thread` and `post` hand back. */
type Thread = Awaited<ReturnType<Caller["submissionComments"]["thread"]>>;
type Triage = Awaited<ReturnType<Caller["submissions"]["triage"]>>;
type Queue = Awaited<ReturnType<Caller["submissions"]["listForAssignment"]>>;

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

/**
 * The text of a refusal rather than its code.
 *
 * `refusal` above returns the code, which is the right thing for a `TRPCError` — there the code is
 * the contract and the wording is not. A trigger is the other way round: everything one raises
 * arrives under a single opaque Prisma code, so the code says only that something in the database
 * objected and the message is the only thing saying which rule did.
 */
async function refusalText(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return (err as Error).message;
  }
}

/** An assignment a fellow works alone, of a kind that has no Accept. */
async function soloAssignment(
  tx: Tx,
  world: World,
  options: { title?: string; published?: boolean } = {},
): Promise<string> {
  const assignment = await makeAssignment(tx, {
    courseId: world.courseId,
    courseUnitId: world.unitId,
    title: options.title ?? "Integration Comments Solo",
    published: options.published,
  });
  return assignment.id;
}

/** An assignment handed in by a team, and the team that hands it in. */
async function teamAssignment(tx: Tx, world: World, members: { id: string }[]): Promise<string> {
  const set = await tx.teamSet.create({
    data: {
      courseId: world.courseId,
      programId: world.programId,
      name: "Integration Comments Teams",
      teams: { create: [{ name: "Team Talk", position: 0 }] },
    },
    select: { id: true, teams: { select: { id: true } } },
  });
  const team = set.teams[0]!;

  await tx.teamMembership.createMany({
    data: members.map((member) => ({
      teamId: team.id,
      teamSetId: set.id,
      programId: world.programId,
      enrollmentId: member.id,
    })),
  });

  const assignment = await makeAssignment(tx, {
    courseId: world.courseId,
    courseUnitId: world.unitId,
    title: "Integration Comments Team",
    teamSetId: set.id,
  });
  return assignment.id;
}

/*
  ---- A fellow asks before there is anything to ask about ---------------------
*/
describe("a fellow asks before there is anything to ask about", () => {
  const tx = withRollback();
  const question = "Do I hand this in as a .py file?";

  let world: World;
  let before: Thread;
  let after: Thread;
  let row: { id: string; status: string; submittedAt: Date | null };

  beforeAll(async () => {
    world = await makeWorld(tx());
    const assignmentId = await soloAssignment(tx(), world);
    const asAlice = createCaller(tx(), world.student.studentId);

    before = await asAlice.submissionComments.thread({ assignmentId });
    after = await asAlice.submissionComments.post({ assignmentId, body: question });
    row = await tx().submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.student.studentId },
      select: { id: true, status: true, submittedAt: true },
    });
  });

  it("a thread on work with no row reads as empty", () => {
    expect(before.comments).toHaveLength(0);
  });

  it("and names no submission", () => {
    expect(before.submissionId).toBeNull();
  });

  it("posting the first comment returns it", () => {
    expect(after.comments).toHaveLength(1);
  });

  it("with the body that was written", () => {
    expect(after.comments[0]!.body).toBe(question);
  });

  it("attributed to the fellow's side of the conversation", () => {
    expect(after.comments[0]!.author.isInstructor).toBe(false);
  });

  it("which the author may withdraw", () => {
    expect(after.comments[0]!.isMine).toBe(true);
  });

  it("and it names no round, because there is no feedback yet", () => {
    expect(after.comments[0]!.round).toBeNull();
  });

  it("the row it created reads as not started", () => {
    expect(row.status).toBe("NOT_STARTED");
  });

  it("and as never handed in", () => {
    expect(row.submittedAt).toBeNull();
  });

  it("the thread now names that row", () => {
    expect(after.submissionId).toBe(row.id);
  });

  // Their own question is not news to them, which is the state they just left.
  it("the author has nothing unread", () => {
    expect(after.unreadCount).toBe(0);
  });

  it("and an instructor is owed an answer", () => {
    expect(after.awaitsReply).toBe(true);
  });
});

/*
  ---- A team shares one conversation, whichever member speaks first -----------

  Two fellows is all this needs. `verify:team-work` asks for three because it puts somebody on a
  team after the fact; nothing here does. What the team checks are that a member who does not hold
  the row reads the same thread, and that one reader's receipt is their own — both answered by two
  fellows and an instructor, because the instructor writes, so both members have something unread
  that neither of them wrote, and one of them reading it must leave the other's count alone.
*/
describe("a team shares one conversation, whichever member speaks first", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;
  /** The row holding the team's work, as opposed to the members' mirrors of it. */
  let workId: string;
  let rows: { id: string; teamSubmissionId: string | null }[];
  let hangsOff: string[];
  let forBob: Thread;
  let authorsThread: Thread;
  let bobAfterReply: Thread;

  const asAlice = () => createCaller(tx(), world.students[0]!.studentId);
  const asBob = () => createCaller(tx(), world.students[1]!.studentId);
  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    assignmentId = await teamAssignment(tx(), world, world.students);

    await asAlice().submissionComments.post({
      assignmentId,
      body: "Should the API live in its own file?",
    });

    rows = await tx().submission.findMany({
      where: { assignmentId },
      select: { id: true, teamSubmissionId: true },
    });
    workId = rows.find((row) => row.teamSubmissionId === null)!.id;

    /*
      Scoped to this assignment. Unscoped, this reads every comment in the database — real ones
      written through the interface included, which are committed and which a rolled-back
      transaction does not hide. That matters whenever this suite is pointed at the development
      Supabase project rather than at the disposable local database.
    */
    const comments = await tx().submissionComment.findMany({
      where: { submission: { assignmentId } },
      select: { submissionId: true },
    });
    hangsOff = comments.map((comment) => comment.submissionId);

    forBob = await asBob().submissionComments.thread({ assignmentId });
    authorsThread = await asAlice().submissionComments.thread({ assignmentId });
  });

  it("one comment gives every member of the team a row", () => {
    expect(rows).toHaveLength(2);
  });

  it("exactly one of them holds the work", () => {
    expect(rows.filter((row) => row.teamSubmissionId === null)).toHaveLength(1);
  });

  it("the comment hangs off the row holding the work", () => {
    expect(hangsOff).toEqual([workId]);
  });

  it("a teammate who does not hold the row reads the same thread", () => {
    expect(forBob.comments).toHaveLength(1);
  });

  it("and it resolves to the row holding the work", () => {
    expect(forBob.submissionId).toBe(workId);
  });

  it("the author has nothing unread on it", () => {
    expect(authorsThread.unreadCount).toBe(0);
  });

  it("while their teammate has", () => {
    expect(forBob.unreadCount).toBe(1);
  });

  /*
    The instructor answers, which gives *both* members something unread that neither of them wrote.
    That is what makes the checks below a real test of the receipt being per reader: with only the
    fellows writing, whoever wrote the message could never have it unread anyway.
  */
  describe("the instructor answers", () => {
    let aliceAfterReply: Thread;

    beforeAll(async () => {
      await asInstructor().submissionComments.post({
        assignmentId,
        studentId: world.students[0]!.studentId,
        body: "Either is fine — try one file first.",
      });

      aliceAfterReply = await asAlice().submissionComments.thread({ assignmentId });
      bobAfterReply = await asBob().submissionComments.thread({ assignmentId });
    });

    it("an instructor's reply reaches the member who holds the row", () => {
      expect(aliceAfterReply.unreadCount).toBe(1);
    });

    it("and the member who does not", () => {
      expect(bobAfterReply.unreadCount).toBe(2);
    });
  });

  describe("one member reads it", () => {
    beforeAll(async () => {
      await asBob().submissionComments.markRead({
        submissionId: bobAfterReply.submissionId!,
        upTo: bobAfterReply.comments[bobAfterReply.comments.length - 1]!.id,
      });
    });

    it("reading it clears the reader's own count", async () => {
      const bob = await asBob().submissionComments.thread({ assignmentId });
      expect(bob.unreadCount).toBe(0);
    });

    it("and leaves their teammate's alone", async () => {
      const alice = await asAlice().submissionComments.thread({ assignmentId });
      expect(alice.unreadCount).toBe(1);
    });
  });

  // Whichever member writes next, it lands on the one thread.
  describe("the other member writes", () => {
    beforeAll(async () => {
      await asBob().submissionComments.post({ assignmentId, body: "I put it in server.js" });
    });

    it("a second member writing lands on the same row", async () => {
      const all = await tx().submissionComment.findMany({
        where: { submission: { assignmentId } },
        select: { submissionId: true },
      });
      expect(new Set(all.map((comment) => comment.submissionId)).size).toBe(1);
    });
  });
});

/*
  ---- Writing straight at a mirror is refused by the database -----------------

  A transaction of its own, and the only check in it, because the refusal comes from a trigger: the
  statement fails, Postgres aborts the transaction, and anything after it would report `25P02:
  current transaction is aborted` rather than whatever it was actually asking.
*/
describe("writing straight at a mirror", () => {
  const tx = withRollback();

  let world: World;
  let mirrorId: string;
  let aliceId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    aliceId = world.students[0]!.studentId;
    const assignmentId = await teamAssignment(tx(), world, world.students);

    await createCaller(tx(), aliceId).submissionComments.post({ assignmentId, body: "first" });

    const mirror = await tx().submission.findFirstOrThrow({
      where: { assignmentId, teamSubmissionId: { not: null } },
      select: { id: true },
    });
    mirrorId = mirror.id;
  });

  it("a comment on a team mirror is refused, by the trigger and in those words", async () => {
    const message = await refusalText(() =>
      tx().submissionComment.create({
        data: {
          submissionId: mirrorId,
          authorId: aliceId,
          authorRole: "STUDENT",
          body: "straight at the mirror",
        },
      }),
    );
    expect(message).toContain("cannot hang off a team mirror");
  });
});

/*
  ---- Who may read and write --------------------------------------------------
*/
describe("who may read and write", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;
  let teacherView: Thread;
  let replied: Thread;

  const asAlice = () => createCaller(tx(), world.students[0]!.studentId);
  const asBob = () => createCaller(tx(), world.students[1]!.studentId);
  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    assignmentId = await soloAssignment(tx(), world);

    await asAlice().submissionComments.post({ assignmentId, body: "Is a dict fine here?" });

    teacherView = await asInstructor().submissionComments.thread({
      assignmentId,
      studentId: world.students[0]!.studentId,
    });
    replied = await asInstructor().submissionComments.post({
      assignmentId,
      studentId: world.students[0]!.studentId,
      body: "A dict is fine.",
    });
  });

  it("an instructor of the program reads the thread", () => {
    expect(teacherView.comments).toHaveLength(1);
  });

  it("and may not withdraw somebody else's comment", () => {
    expect(teacherView.comments[0]!.isMine).toBe(false);
  });

  it("their reply is recorded as staff", () => {
    expect(replied.comments[1]!.author.isInstructor).toBe(true);
  });

  it("and the thread stops waiting on them", () => {
    expect(replied.awaitsReply).toBe(false);
  });

  // One fellow may not read another's conversation. The input has a `studentId`, so this is the
  // check that naming somebody else does not work.
  it("one fellow naming another is refused", async () => {
    const code = await refusal(() =>
      asBob().submissionComments.thread({
        assignmentId,
        studentId: world.students[0]!.studentId,
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("an instructor naming somebody who is not on the roster is refused", async () => {
    const code = await refusal(() =>
      asInstructor().submissionComments.thread({
        assignmentId,
        studentId: world.instructorId,
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});

/*
  ---- An undistributed assignment, and an unpublished course ------------------
*/
describe("work that was never handed out", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    // Never handed out, which is what makes authoring safe.
    assignmentId = await soloAssignment(tx(), world, {
      title: "Integration Comments Undistributed",
      published: false,
    });
  });

  it("a fellow cannot open a thread on work that was never handed out", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.student.studentId).submissionComments.thread({ assignmentId }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});

describe("a course that has not been published", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;

  beforeAll(async () => {
    // The course is unpublished from the start rather than published and then withdrawn, because
    // what the check is about is the course-level half of `distributedToStudent`.
    world = await makeWorld(tx(), { published: false });
    assignmentId = await soloAssignment(tx(), world);
  });

  it("nor on a course that has not been published", async () => {
    const code = await refusal(() =>
      createCaller(tx(), world.student.studentId).submissionComments.thread({ assignmentId }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});

/*
  ---- Withdrawing -------------------------------------------------------------
*/
describe("withdrawing a comment", () => {
  const tx = withRollback();

  let world: World;
  let commentId: string;
  let after: Thread;
  let stored: { body: string | null; deletedAt: Date | null };

  const asAlice = () => createCaller(tx(), world.students[0]!.studentId);
  const asBob = () => createCaller(tx(), world.students[1]!.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const assignmentId = await soloAssignment(tx(), world);

    const posted = await asAlice().submissionComments.post({ assignmentId, body: "never mind" });
    commentId = posted.comments[0]!.id;
  });

  it("a fellow cannot withdraw somebody else's comment", async () => {
    const code = await refusal(() => asBob().submissionComments.remove({ commentId }));
    expect(code).toBe("FORBIDDEN");
  });

  describe("the author withdrawing their own", () => {
    beforeAll(async () => {
      after = await asAlice().submissionComments.remove({ commentId });
      stored = await tx().submissionComment.findUniqueOrThrow({
        where: { id: commentId },
        select: { body: true, deletedAt: true },
      });
    });

    it("withdrawing keeps the message in its place", () => {
      expect(after.comments).toHaveLength(1);
    });

    it("with nothing readable in it", () => {
      expect(after.comments[0]!.body).toBeNull();
    });

    it("and a thread of one tombstone waits on nobody", () => {
      expect(after.awaitsReply).toBe(false);
    });

    it("the text stays in the column for an instructor to find", () => {
      expect(stored.body).toBe("never mind");
    });

    it("and the row is marked withdrawn", () => {
      expect(stored.deletedAt).not.toBeNull();
    });
  });
});

/*
  ---- Naming a round of feedback ----------------------------------------------
*/
describe("naming a round of feedback", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;
  let releasedId: string;

  const asAlice = () => createCaller(tx(), world.students[0]!.studentId);
  const asBob = () => createCaller(tx(), world.students[1]!.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    assignmentId = await soloAssignment(tx(), world);

    await asAlice().submissionComments.post({ assignmentId, body: "starting" });
    const submission = await tx().submission.findFirstOrThrow({
      where: { assignmentId, studentId: world.students[0]!.studentId },
      select: { id: true },
    });

    const unapproved = await tx().gradingDraft.create({
      data: { submissionId: submission.id, status: "READY" },
      select: { id: true },
    });
    releasedId = unapproved.id;
  });

  it("a comment cannot name a round that was never released", async () => {
    const code = await refusal(() =>
      asAlice().submissionComments.post({
        assignmentId,
        body: "about a round nobody was sent",
        gradingDraftId: releasedId,
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  describe("once the round is released", () => {
    let anchored: Thread["comments"][number] | undefined;

    beforeAll(async () => {
      await tx().gradingDraft.update({
        where: { id: releasedId },
        data: { status: "APPROVED", approvedAt: new Date("2026-09-05T10:00:00Z") },
      });

      const answered = await asAlice().submissionComments.post({
        assignmentId,
        body: "Why did the SQL section lose two points?",
        gradingDraftId: releasedId,
      });
      anchored = answered.comments.find((comment) => comment.round !== null);
    });

    it("a comment may name a released round", () => {
      expect(anchored?.round?.id).toBe(releasedId);
    });

    it("and the round is numbered as the feedback tab numbers it", () => {
      expect(anchored?.round?.number).toBe(1);
    });

    // A round of somebody else's work is refused, which the composite foreign key also forbids.
    it("nor a round belonging to another submission", async () => {
      const otherAssignmentId = await soloAssignment(tx(), world, {
        title: "Integration Comments Solo Two",
      });
      await asBob().submissionComments.post({ assignmentId: otherAssignmentId, body: "mine" });

      const code = await refusal(() =>
        asBob().submissionComments.post({
          assignmentId: otherAssignmentId,
          body: "about your round",
          gradingDraftId: releasedId,
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });
});

/*
  ---- The instructor's questions list -----------------------------------------
*/
describe("the instructor's questions list", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;
  /** The row Alice's thread hangs off, which the resolve checks name directly. */
  let submissionId: string;
  let listed: Triage;

  const aliceId = () => world.students[0]!.studentId;
  const bobId = () => world.students[1]!.studentId;
  const asAlice = () => createCaller(tx(), aliceId());
  const asBob = () => createCaller(tx(), bobId());
  const asInstructor = () => createCaller(tx(), world.instructorId);

  /** The rows of a triage answer that are about this group's assignment. */
  const waiting = (answer: Triage) =>
    answer.awaitingReply.filter((row) => row.assignment.id === assignmentId);

  const triage = async (cohort: string) =>
    waiting(await asInstructor().submissions.triage({ courseId: world.courseId, cohort }));

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    assignmentId = await soloAssignment(tx(), world);

    await asAlice().submissionComments.post({
      assignmentId,
      body: "## Stuck\n\nThe `JOIN` returns nothing. Any ideas?",
    });

    listed = await asInstructor().submissions.triage({ courseId: world.courseId, cohort: "all" });
  });

  it("a question reaches the instructor's screen", () => {
    expect(waiting(listed)).toHaveLength(1);
  });

  it("naming who asked", () => {
    expect(waiting(listed)[0]!.student.id).toBe(aliceId());
  });

  it("and how many are waiting", () => {
    expect(waiting(listed)[0]!.waitingCount).toBe(1);
  });

  it("with the markdown flattened for a one-line row", () => {
    expect(waiting(listed)[0]!.excerpt).toBe("Stuck The JOIN returns nothing. Any ideas?");
  });

  describe("asking a second time", () => {
    let twice: Triage;

    beforeAll(async () => {
      await asAlice().submissionComments.post({ assignmentId, body: "still stuck" });
      twice = await asInstructor().submissions.triage({ courseId: world.courseId, cohort: "all" });
    });

    it("a follow-up is counted rather than listed twice", () => {
      expect(waiting(twice)).toHaveLength(1);
    });

    it("and says how many have piled up", () => {
      expect(waiting(twice)[0]!.waitingCount).toBe(2);
    });
  });

  describe("answering it", () => {
    beforeAll(async () => {
      await asInstructor().submissionComments.post({
        assignmentId,
        studentId: aliceId(),
        body: "Check your GROUP BY.",
      });
    });

    it("answering takes it off the list", async () => {
      expect(await triage("all")).toHaveLength(0);
    });
  });

  /*
    Settled without a reply, which is the other way off the list — for a question handled in person,
    or one the fellow worked out while waiting.
  */
  describe("settling one without a reply", () => {
    let waitingAgain: Triage;
    let commentsBefore: number;
    let resolved: Thread;

    beforeAll(async () => {
      await asAlice().submissionComments.post({ assignmentId, body: "actually, one more thing" });
      waitingAgain = await asInstructor().submissions.triage({
        courseId: world.courseId,
        cohort: "all",
      });

      const threadNow = await asInstructor().submissionComments.thread({
        assignmentId,
        studentId: aliceId(),
      });
      submissionId = threadNow.submissionId!;
      commentsBefore = threadNow.comments.length;

      resolved = await asInstructor().submissionComments.resolve({ submissionId, resolved: true });
    });

    it("a new question puts the thread back on the list", () => {
      expect(waiting(waitingAgain)).toHaveLength(1);
    });

    it("resolving records when it was settled", () => {
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it("and the thread stops waiting without a reply", () => {
      expect(resolved.awaitsReply).toBe(false);
    });

    it("which takes it off the instructor's list", async () => {
      expect(await triage("all")).toHaveLength(0);
    });

    it("and adds no message to the conversation", () => {
      expect(resolved.comments).toHaveLength(commentsBefore);
    });
  });

  // Compared against the newest question rather than checked for null, so asking again waits.
  describe("asking again after it was settled", () => {
    beforeAll(async () => {
      await asAlice().submissionComments.post({ assignmentId, body: "sorry, still stuck" });
    });

    it("a question asked after it was settled waits again", async () => {
      expect(await triage("all")).toHaveLength(1);
    });

    // A fellow may not settle their own question.
    it("a fellow cannot resolve their own thread", async () => {
      const code = await refusal(() =>
        asAlice().submissionComments.resolve({ submissionId, resolved: true }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    The cohort picker narrows it, like every other figure on that screen. Alice is put in a cohort
    of her own and asks again; selecting the other cohort must not show her question.

    Bob asks one too, from outside every cohort. Without his, the selection that excludes Alice is
    empty — and a filter that returned nothing at all, for any selection, would pass that check just
    as well as a working one. With his, the "unassigned" selection has to carry the right question
    rather than merely fail to carry the wrong one.
  */
  describe("the cohort picker", () => {
    let cohortId: string;

    beforeAll(async () => {
      await asAlice().submissionComments.post({ assignmentId, body: "one more thing" });

      const cohort = await tx().cohort.create({
        data: { programId: world.programId, name: "Integration Comments Cohort" },
        select: { id: true },
      });
      cohortId = cohort.id;
      await tx().enrollment.update({
        where: { id: world.students[0]!.id },
        data: { cohortId },
      });

      await asBob().submissionComments.post({ assignmentId, body: "and I am stuck as well" });
    });

    it("the question is in the cohort its asker is in", async () => {
      const rows = await triage(cohortId);
      expect(rows.map((row) => row.student.id)).toEqual([aliceId()]);
    });

    it("and not in a selection that excludes them", async () => {
      const rows = await triage("unassigned");
      expect(rows.map((row) => row.student.id)).not.toContain(aliceId());
    });

    it("while the question from a fellow in no cohort is in that selection", async () => {
      const rows = await triage("unassigned");
      expect(rows.map((row) => row.student.id)).toEqual([bobId()]);
    });
  });
});

/*
  ---- The assignment's own queue carries the record ---------------------------
*/
describe("the assignment's own queue carries the record", () => {
  const tx = withRollback();

  let world: World;
  let assignmentId: string;
  let before: Queue;

  const aliceId = () => world.students[0]!.studentId;
  const asAlice = () => createCaller(tx(), aliceId());
  const asInstructor = () => createCaller(tx(), world.instructorId);

  const queue = async () =>
    asInstructor().submissions.listForAssignment({ assignmentId, cohort: "all" });

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    assignmentId = await soloAssignment(tx(), world);
    before = await queue();
  });

  it("nobody is in the queue before anything happens", () => {
    expect(before.submissions.filter((row) => row.student.id === aliceId())).toHaveLength(0);
  });

  describe("after a question", () => {
    let after: Queue;
    let alicesRow: Queue["submissions"][number] | undefined;

    beforeAll(async () => {
      await asAlice().submissionComments.post({ assignmentId, body: "Where do I start?" });
      after = await queue();
      alicesRow = after.submissions.find((row) => row.student.id === aliceId());
    });

    it("a question puts the fellow in the assignment's queue", () => {
      expect(alicesRow).toBeDefined();
    });

    it("with nothing to grade", () => {
      expect(alicesRow?.bucket).toBeNull();
    });

    it("and the row says there is a conversation", () => {
      expect(alicesRow?.commentCount).toBe(1);
    });

    it("which is waiting on a reply", () => {
      expect(alicesRow?.commentsAwaitReply).toBe(true);
    });

    // A fellow who has neither submitted nor said anything stays out of it.
    it("somebody who has done nothing at all is still absent", () => {
      const bobId = world.students[1]!.studentId;
      expect(after.submissions.filter((row) => row.student.id === bobId)).toHaveLength(0);
    });
  });

  describe("after it is answered", () => {
    let answeredRow: Queue["submissions"][number] | undefined;

    beforeAll(async () => {
      await asInstructor().submissionComments.post({
        assignmentId,
        studentId: aliceId(),
        body: "Read the README first.",
      });
      answeredRow = (await queue()).submissions.find((row) => row.student.id === aliceId());
    });

    it("the row stays after it is answered, as a record", () => {
      expect(answeredRow?.commentCount).toBe(2);
    });

    it("and stops asking to be acted on", () => {
      expect(answeredRow?.commentsAwaitReply).toBe(false);
    });
  });
});

/*
  ---- A team member's own record reads their team's conversation --------------
*/
describe("a team member's own record", () => {
  const tx = withRollback();

  let world: World;
  let bobsRow: { commentCount: number; commentsAwaitReply: boolean } | undefined;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const assignmentId = await teamAssignment(tx(), world, world.students);

    await createCaller(tx(), world.students[0]!.studentId).submissionComments.post({
      assignmentId,
      body: "Who writes the API?",
    });

    const rows = await createCaller(tx(), world.instructorId).submissions.listForStudent({
      courseId: world.courseId,
      studentId: world.students[1]!.studentId,
    });
    bobsRow = rows.rows.find((row) => row.assignment.id === assignmentId)?.submission ?? undefined;
  });

  // Bob holds a mirror; the thread is on Alice's row. Read through it, or the badge would be right
  // for whoever claimed the work and silent for everybody else on the team.
  it("a teammate's own record shows the team's conversation", () => {
    expect(bobsRow?.commentCount).toBe(1);
  });

  it("and that it is waiting", () => {
    expect(bobsRow?.commentsAwaitReply).toBe(true);
  });
});

/*
  ---- The count the course list carries ---------------------------------------
*/
describe("the count the course list carries", () => {
  const tx = withRollback();

  let unreadOnTheList: number | undefined;
  let unreadOnTheThread: number;

  beforeAll(async () => {
    const world = await makeWorld(tx());
    const assignmentId = await soloAssignment(tx(), world);
    const asAlice = createCaller(tx(), world.student.studentId);
    const asInstructor = createCaller(tx(), world.instructorId);

    await asAlice.submissionComments.post({ assignmentId, body: "a question" });
    await asInstructor.submissionComments.post({
      assignmentId,
      studentId: world.student.studentId,
      body: "an answer",
    });

    const list = await asAlice.assignments.listForCourse({ courseId: world.courseId });
    unreadOnTheList = list
      .flatMap((assignment) => (assignment.id === assignmentId ? assignment.submissions : []))
      .at(0)?.unreadCommentCount;
    unreadOnTheThread = (await asAlice.submissionComments.thread({ assignmentId })).unreadCount;
  });

  it("the list carries the unread count", () => {
    expect(unreadOnTheList).toBe(1);
  });

  it("and it agrees with the thread's own", () => {
    expect(unreadOnTheList).toBe(unreadOnTheThread);
  });
});

/*
  ---- Accepting after a comment created the row -------------------------------
*/
describe("accepting work a comment already made a row for", () => {
  const tx = withRollback();

  let status: string;

  beforeAll(async () => {
    const world = await makeWorld(tx());
    // Written out rather than taken from `makeAssignment`, which offers the three kinds that need
    // no template document. The Accept this check is about is the one that hands out a copy link.
    const assignment = await tx().assignment.create({
      data: {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        title: "Integration Comments Drive",
        kind: "GOOGLE_DRIVE",
        pointValue: 10,
        templateDriveUrl: "https://docs.google.com/document/d/abc123/edit",
        distributedAt: new Date("2026-09-01T09:00:00Z"),
        sections: [{ grading: "manual", label: "Deliverable", pointValue: 10 }],
      },
      select: { id: true },
    });

    const asAlice = createCaller(tx(), world.student.studentId);
    await asAlice.submissionComments.post({
      assignmentId: assignment.id,
      body: "Where do I find the template?",
    });
    await asAlice.assignments.accept({ assignmentId: assignment.id });

    const row = await tx().submission.findFirstOrThrow({
      where: { assignmentId: assignment.id, studentId: world.student.studentId },
      select: { status: true },
    });
    status = row.status;
  });

  // Without the promotion in `acceptDriveAssignment`, the upsert's empty `update` would leave this
  // at NOT_STARTED and the panel would go on offering the button that had just been pressed.
  it("accepting promotes a row a comment created", () => {
    expect(status).toBe("ACCEPTED");
  });
});
