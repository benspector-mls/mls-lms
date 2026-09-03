/**
 * Tasks: the kind with nothing to hand in, marked done by a fellow and settled by an instructor.
 *
 * Run with `npm run test:integration`.
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
 * Each group holds a transaction of its own, because a refusal that comes from a constraint aborts
 * the transaction it happens in.
 *
 * Carries the 37 assertions `verify:tasks` reported on 2 September 2026. Four of its checks
 * compared a pair of values in one call and remain one `expect` each, so the case count is lower
 * than the assertion count; nothing was dropped.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { required, withRollback, type Tx } from "./transaction";

/*
  Imported at the top rather than inside `main`, which is what the scripts have to do.

  A script loads its environment as its first statement and must therefore reach `lib/prisma`
  through a dynamic import, because a static one is hoisted above that statement and the module
  throws when `DATABASE_URL` is unset. Jest runs `setupFiles` before it loads this file at all, so
  the variables are already in place — and a static import is what gives the caller below its real
  type instead of the union every procedure name has to be asserted through.
*/
const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** The seeded course this whole file acts on, looked up once. */
let courseId: string;
let programId: string;
let unitId: string;
let instructorId: string;
let alice: { id: string; studentId: string };
/** The second fellow, when the seed has one. Only the team group needs them. */
let bob: { id: string; studentId: string } | null;

const DUE = new Date("2026-09-10T23:59:00Z");

beforeAll(async () => {
  /*
    One fellow is enough for everything except the team group, which needs two: "the mark reached
    the team" and "the mark reached the person who pressed it" are the same row when a team has one
    member on it. The team group makes its own second fellow rather than depending on the seed.
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

  const course = required(
    "a seeded course with an instructor, a unit, and a fellow",
    candidates.find((row) => row.program.enrollments.length >= 1),
  );

  courseId = course.id;
  programId = course.programId;
  unitId = course.courseUnits[0]!.id;
  instructorId = course.instructors[0]!.userId;
  alice = course.program.enrollments[0]!;
  bob = course.program.enrollments[1] ?? null;
});

/** A published task, individual and self-marked unless asked otherwise. */
async function task(
  tx: Tx,
  options: { teamSetId?: string; studentMayMarkDone?: boolean } = {},
): Promise<string> {
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
 * **The team group is the half of this feature that a single fellow cannot check at all** — with a
 * team of one, "the mark reached the team" and "the mark reached whoever pressed it" are the same
 * row — and a development database seeded with one student is the ordinary case.
 *
 * The insert is into `auth.users`, which Supabase owns, and the profile appears by itself: the
 * on-signup trigger is what creates one, and it is the same path a real fellow arrives by. Raw SQL
 * because Prisma treats that table as external and never writes it. Everything here is inside the
 * caller's transaction and rolled back with it.
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
async function teamOf(tx: Tx, members: { id: string }[]): Promise<string> {
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

/**
 * What a call refused with, as a string to compare against.
 *
 * The literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes
 * a missing guard a visible failure rather than a passing test.
 */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

describe("a fellow marking their own task, and taking it back", () => {
  const tx = withRollback();
  let assignmentId: string;

  it("before anybody presses anything there is no row at all", async () => {
    assignmentId = await task(tx());
    expect(await rowsFor(tx(), assignmentId)).toHaveLength(0);
  });

  it("marking it done creates the row", async () => {
    await createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: true });
    expect(await rowsFor(tx(), assignmentId)).toHaveLength(1);
  });

  it("and settles it, because nobody is waiting on it", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.status).toBe("GRADED");
  });

  it("with the point awarded", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect([row!.finalScore, row!.finalScorePossible]).toEqual([1, 1]);
  });

  it("and completion recorded", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.isComplete).toBe(true);
  });

  it("attributed to the fellow who pressed it", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.gradedById).toBe(alice.studentId);
  });

  /*
    The column that keeps a marked task off the fellow's "Feedback to read" list. A task releases
    no report, so it is born read — left null, `feedbackIsUnread` would offer every fellow a report
    that does not exist.
  */
  it("and marked read, because there is no report to read", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.feedbackReviewedAt).not.toBeNull();
  });

  it("taking the mark back returns it to not started", async () => {
    await createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: false });
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.status).toBe("NOT_STARTED");
  });

  it("with no verdict standing", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.isComplete).toBeNull();
  });

  it("and no score", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.finalScore).toBeNull();
  });

  /*
    Cleared with the rest. A row that kept a submission time would go on reading as handed in,
    which keeps it off the fellow's own overdue list — the one place they would look to notice they
    still have to do it.
  */
  it("and nothing recorded about when it was done", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.submittedAt).toBeNull();
  });
});

describe("an instructor overruling a fellow", () => {
  const tx = withRollback();
  let assignmentId: string;

  beforeAll(async () => {
    assignmentId = await task(tx());
    await createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: true });
    await createCaller(tx(), instructorId).submissions.setTaskCompletion({
      assignmentId,
      studentId: alice.studentId,
      done: false,
    });
  });

  it("an instructor can mark a fellow's task not done", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.isComplete).toBe(false);
  });

  it("which scores nothing out of one", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect([row!.finalScore, row!.finalScorePossible]).toEqual([0, 1]);
  });

  it("recorded against the instructor", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.gradedById).not.toBe(alice.studentId);
  });

  /*
    `handedInById` names the member who did the work. Overruling somebody is not doing their work,
    so the column keeps whoever marked it — which is what the fellow's own panel reads to say who
    marked a team's task.
  */
  it("without rewriting who marked it", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.handedInById).toBe(alice.studentId);
  });

  it("and written to the audit log", async () => {
    const audited = await tx().auditEvent.count({
      where: { action: "GRADE_APPROVED", subjectId: alice.studentId },
    });
    expect(audited).toBeGreaterThan(0);
  });

  /*
    The rule that makes an instructor's verdict stick. A fellow may take back a mark that stands as
    done; clearing "this was not done" is overruling their instructor, and the way out of it is to
    do the task again.
  */
  it("a fellow cannot clear a verdict their instructor set", async () => {
    const code = await refusal(() =>
      createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: false }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });

  it("but can do it again and mark it done", async () => {
    await createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: true });
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.isComplete).toBe(true);
  });
});

describe("an instructor marking a fellow who has no row", () => {
  const tx = withRollback();
  let assignmentId: string;

  beforeAll(async () => {
    assignmentId = await task(tx());
  });

  /*
    The case the roster queue exists for. A task's queue lists every fellow, including the ones
    with nothing on record, so the control has to work on somebody who has no submission — which is
    why the procedure is keyed on the student rather than on a submission id.
  */
  it("a task's queue lists the fellows who have no row", async () => {
    const queue = await createCaller(tx(), instructorId).submissions.listForAssignment({
      assignmentId,
      cohort: "all",
    });
    expect(queue.notStarted.some((student) => student.id === alice.studentId)).toBe(true);
  });

  it("marking one of them creates their row", async () => {
    await createCaller(tx(), instructorId).submissions.setTaskCompletion({
      assignmentId,
      studentId: alice.studentId,
      done: true,
    });
    expect(await rowsFor(tx(), assignmentId)).toHaveLength(1);
  });

  it("done, with the point", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect([row!.isComplete, row!.finalScore]).toEqual([true, 1]);
  });

  it("for the fellow who was named", async () => {
    const [row] = await rowsFor(tx(), assignmentId);
    expect(row!.studentId).toBe(alice.studentId);
  });

  it("and moves them out of the not-started list into the queue proper", async () => {
    const after = await createCaller(tx(), instructorId).submissions.listForAssignment({
      assignmentId,
      cohort: "all",
    });
    expect([
      after.notStarted.some((student) => student.id === alice.studentId),
      after.submissions.some((row) => row.student.id === alice.studentId),
    ]).toEqual([false, true]);
  });
});

/*
  One member marks it and everybody's row says so, which is the half of the design that cannot be
  seen with a single fellow — a team of one makes "reached the team" and "reached whoever pressed
  it" the same row. The second fellow is created inside the transaction when the seed has only one,
  so this group measures something on a freshly seeded database rather than skipping.
*/
describe("a team task", () => {
  const tx = withRollback();
  let assignmentId: string;
  let second: { id: string; studentId: string };

  beforeAll(async () => {
    second = required(
      "a second fellow, and none could be made — the on-signup trigger creates no profile",
      bob ?? (await temporaryFellow(tx())),
    );
    const teamSetId = await teamOf(tx(), [alice, second]);
    assignmentId = await task(tx(), { teamSetId });
    await createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: true });
  });

  it("one member marking it gives every member a row", async () => {
    expect(await rowsFor(tx(), assignmentId)).toHaveLength(2);
  });

  it("exactly one of them holds the work", async () => {
    const rows = await rowsFor(tx(), assignmentId);
    expect(rows.filter((row) => row.teamSubmissionId === null)).toHaveLength(1);
  });

  it("and every member's row says it is done", async () => {
    const rows = await rowsFor(tx(), assignmentId);
    expect(rows.every((row) => row.isComplete === true && row.finalScore === 1)).toBe(true);
  });

  /*
    Not one of `MIRRORED_COLUMNS`, so `syncTeamRows` neither copies it nor puts it on the rows it
    creates — `recordTaskVerdict` writes it afterwards for exactly this reason. Without that write,
    Bob's dashboard would offer him a report on a task that has none.
  */
  it("including the one that keeps it off their 'feedback to read' list", async () => {
    const rows = await rowsFor(tx(), assignmentId);
    expect(rows.every((row) => row.feedbackReviewedAt !== null)).toBe(true);
  });

  // Any active member acts for the team, which is the same rule handing in follows.
  it("a teammate can take the team's mark back", async () => {
    await createCaller(tx(), second.studentId).submissions.markTask({ assignmentId, done: false });
    const rows = await rowsFor(tx(), assignmentId);
    expect(rows.every((row) => row.status === "NOT_STARTED" && row.isComplete === null)).toBe(true);
  });
});

describe("a task only an instructor may mark", () => {
  const tx = withRollback();
  let assignmentId: string;

  beforeAll(async () => {
    assignmentId = await task(tx(), { studentMayMarkDone: false });
  });

  /*
    Both directions checked, because a fellow who may not mark a task done may certainly not mark
    one not done. The student's panel draws no button from the same function, so reaching this
    refusal means something other than the screen asked.
  */
  it("a fellow cannot mark an instructor-only task done", async () => {
    const code = await refusal(() =>
      createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: true }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("nor mark it not done", async () => {
    const code = await refusal(() =>
      createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: false }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("and no row was created by either attempt", async () => {
    expect(await rowsFor(tx(), assignmentId)).toHaveLength(0);
  });

  // The instructor's own control is unchanged: they set either verdict on any task.
  it("an instructor still marks it", async () => {
    await createCaller(tx(), instructorId).submissions.setTaskCompletion({
      assignmentId,
      studentId: alice.studentId,
      done: true,
    });
    const rows = await rowsFor(tx(), assignmentId);
    expect([rows.length, rows[0]!.isComplete]).toEqual([1, true]);
  });

  /*
    And the fellow may not take an instructor's mark back on this kind of task, which the
    self-marked guard alone would have allowed: that one keys on `isComplete`, and a mark standing
    as done is exactly what it lets a fellow clear.
  */
  it("and the fellow cannot undo it, though it stands as done", async () => {
    const code = await refusal(() =>
      createCaller(tx(), alice.studentId).submissions.markTask({ assignmentId, done: false }),
    );
    expect(code).toBe("FORBIDDEN");
  });
});

describe("what neither procedure will do", () => {
  const tx = withRollback();
  let assignmentId: string;
  let linkAssignmentId: string;

  beforeAll(async () => {
    assignmentId = await task(tx());
    const linkAssignment = await tx().assignment.create({
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
    linkAssignmentId = linkAssignment.id;
  });

  /*
    The check that stops a verdict landing on the wrong kind. `assertCanHandIn` refuses REPO and
    admits everything else, so without an explicit test of the kind a request naming a link
    assignment would reach the write and grade it 1/1 with nothing handed in.
  */
  it("a fellow cannot mark a link assignment done", async () => {
    const code = await refusal(() =>
      createCaller(tx(), alice.studentId).submissions.markTask({
        assignmentId: linkAssignmentId,
        done: true,
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  it("and neither can an instructor", async () => {
    const code = await refusal(() =>
      createCaller(tx(), instructorId).submissions.setTaskCompletion({
        assignmentId: linkAssignmentId,
        studentId: alice.studentId,
        done: true,
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  // A task hands nothing out, so there is nothing to accept.
  it("and a task cannot be accepted", async () => {
    const code = await refusal(() =>
      createCaller(tx(), alice.studentId).assignments.accept({ assignmentId }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });
});

describe("a fellow who is not on the roster", () => {
  const tx = withRollback();

  /*
    Not redundant with teaching the course. Without it an instructor could write a verdict onto
    somebody from another program by naming their id, and the row would be created to hold it.
  */
  it("an instructor cannot set a verdict for somebody off the roster", async () => {
    const assignmentId = await task(tx());
    await tx().enrollment.update({ where: { id: alice.id }, data: { status: "REMOVED" } });

    const code = await refusal(() =>
      createCaller(tx(), instructorId).submissions.setTaskCompletion({
        assignmentId,
        studentId: alice.studentId,
        done: true,
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });
});
