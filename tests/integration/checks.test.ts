/**
 * Checks for understanding: a question attached to a resource, answered up to three times with a
 * wait between attempts, each attempt reviewed into a level.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. **The review is
 * replaced with a double**: the model call is what `npm run calibrate:checks` measures, and what
 * is checked here is everything around it — who may answer, when, what is stored, and what each
 * side is allowed to read back. The double is the module's own, with only `reviewCheckAnswer`
 * swapped, so the router's `instanceof CheckReviewError` still meets the real class.
 *
 * Each group holds a transaction of its own, because a refusal that comes from a constraint aborts
 * the transaction it happens in.
 */
import { CheckReviewError, reviewCheckAnswer, type CheckReview } from "@/lib/checks/review";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  enroll,
  makeAccount,
  makeCheck,
  makeCheckAttempt,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

jest.mock("../../lib/checks/review", () => ({
  ...jest.requireActual("../../lib/checks/review"),
  reviewCheckAnswer: jest.fn(),
}));

const review = reviewCheckAnswer as jest.MockedFunction<typeof reviewCheckAnswer>;

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

const RELATIONAL: CheckReview = {
  level: "RELATIONAL",
  explanation: "You connected the facts. That is what the question asked for.",
  usage: { promptTokens: 800, completionTokens: 90, cachedPromptTokens: 400, cacheWriteTokens: 0 },
  modelId: "claude-haiku-4-5",
  provider: "claude:claude-haiku-4-5:none",
  promptVersion: "test",
};

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

beforeEach(() => {
  review.mockReset();
  review.mockResolvedValue(RELATIONAL);
});

describe("a fellow answering a check", () => {
  const tx = withRollback();
  let world: World;
  let checkId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    ({ checkId } = await makeCheck(tx(), { unitId: world.unitId }));
  });

  it("records the first attempt with the review's level, and no exemplar yet", async () => {
    const fellow = createCaller(tx(), world.student.studentId);

    const progress = await fellow.checks.answer({
      checkId,
      answer: "It returns 2, because the closure keeps `count`.",
      wantsHelp: true,
    });

    expect(progress.attempts).toHaveLength(1);
    expect(progress.attempts[0]).toMatchObject({
      attempt: 1,
      level: "RELATIONAL",
      explanation: RELATIONAL.explanation,
      reviewError: null,
      wantsHelp: true,
    });
    expect(progress.exemplar).toBeNull();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "It returns 2, because the closure keeps `count`." }),
    );
  });

  it("stores the usage where the cost script reads it", async () => {
    const row = await tx().checkAttempt.findFirstOrThrow({
      where: { checkId, studentId: world.student.studentId },
      select: { modelMetadata: true },
    });

    expect(row.modelMetadata).toMatchObject({
      provider: "claude:claude-haiku-4-5:none",
      usage: RELATIONAL.usage,
    });
  });

  it("refuses a second attempt before the wait is over", async () => {
    const fellow = createCaller(tx(), world.student.studentId);

    expect(
      await refusal(() => fellow.checks.answer({ checkId, answer: "Again", wantsHelp: false })),
    ).toBe("BAD_REQUEST");
  });

  it("reads back only the caller's own attempts, without the model's metadata", async () => {
    const mine = await createCaller(tx(), world.student.studentId).checks.myAttempts({
      courseId: world.courseId,
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.attempts[0]).not.toHaveProperty("modelMetadata");
    expect(mine[0]!.exemplar).toBeNull();

    const theirs = await createCaller(tx(), world.students[1]!.studentId).checks.myAttempts({
      courseId: world.courseId,
    });
    expect(theirs).toEqual([]);
  });

  it("never sends the objective or either example on the course page's resource list", async () => {
    const resources = await createCaller(tx(), world.student.studentId).resources.listForCourse({
      courseId: world.courseId,
    });
    const withCheck = resources.find((resource) => resource.check?.id === checkId);

    expect(withCheck?.check).toEqual({
      id: checkId,
      question: expect.any(String),
      retryWaitHours: 168,
    });
  });
});

describe("the wait between attempts, and the third", () => {
  const tx = withRollback();
  let world: World;
  let checkId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    ({ checkId } = await makeCheck(tx(), { unitId: world.unitId, retryWaitHours: 168 }));
  });

  it("opens the second attempt once the wait has passed", async () => {
    const fellow = world.students[1]!.studentId;
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: fellow,
      attempt: 1,
      submittedAt: hoursAgo(169),
    });

    const progress = await createCaller(tx(), fellow).checks.answer({
      checkId,
      answer: "Second try",
      wantsHelp: false,
    });

    expect(progress.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(progress.exemplar).toBeNull();
  });

  it("releases the exemplar with the third attempt, and refuses a fourth", async () => {
    const fellow = world.student.studentId;
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: fellow,
      attempt: 1,
      submittedAt: hoursAgo(400),
    });
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: fellow,
      attempt: 2,
      submittedAt: hoursAgo(200),
    });

    const caller = createCaller(tx(), fellow);
    const progress = await caller.checks.answer({ checkId, answer: "Third try", wantsHelp: false });

    expect(progress.attempts).toHaveLength(3);
    expect(progress.exemplar).toContain("keeps a reference");

    const read = await caller.checks.myAttempts({ courseId: world.courseId });
    expect(read[0]!.exemplar).toContain("keeps a reference");

    expect(
      await refusal(() => caller.checks.answer({ checkId, answer: "Fourth", wantsHelp: false })),
    ).toBe("BAD_REQUEST");
  });
});

describe("who may answer", () => {
  const tx = withRollback();
  let world: World;
  let other: World;
  let checkId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    other = await makeWorld(tx());
    ({ checkId } = await makeCheck(tx(), { unitId: world.unitId }));
  });

  it("refuses a fellow removed from the program", async () => {
    const removed = await makeAccount(tx());
    await enroll(tx(), { programId: world.programId, studentId: removed, status: "REMOVED" });

    expect(
      await refusal(() =>
        createCaller(tx(), removed).checks.answer({ checkId, answer: "Hi", wantsHelp: false }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("refuses a fellow of another program", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), other.student.studentId).checks.answer({
          checkId,
          answer: "Hi",
          wantsHelp: false,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("refuses the course's own instructor", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), world.instructorId).checks.answer({
          checkId,
          answer: "Hi",
          wantsHelp: false,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("calls the review for none of them", () => {
    expect(review).not.toHaveBeenCalled();
  });
});

describe("a review that does not run", () => {
  const tx = withRollback();
  let world: World;
  let checkId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    ({ checkId } = await makeCheck(tx(), { unitId: world.unitId }));
  });

  it("keeps the fellow's answer and records why, and running it again repairs it", async () => {
    review.mockRejectedValueOnce(new CheckReviewError("Could not reach the Claude API."));

    const progress = await createCaller(tx(), world.student.studentId).checks.answer({
      checkId,
      answer: "An answer that landed",
      wantsHelp: false,
    });
    const attempt = progress.attempts[0]!;

    expect(attempt).toMatchObject({
      answer: "An answer that landed",
      level: null,
      reviewError: "Could not reach the Claude API.",
    });

    const repaired = await createCaller(tx(), world.instructorId).checks.reviewAgain({
      attemptId: attempt.id,
    });
    expect(repaired).toMatchObject({ level: "RELATIONAL", reviewError: null });
  });

  it("records an unexpected failure the same way rather than failing the fellow's request", async () => {
    const second = await makeWorld(tx());
    const { checkId: otherCheck } = await makeCheck(tx(), { unitId: second.unitId });
    review.mockRejectedValueOnce(new Error("something nobody anticipated"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const progress = await createCaller(tx(), second.student.studentId).checks.answer({
      checkId: otherCheck,
      answer: "Still saved",
      wantsHelp: false,
    });

    expect(progress.attempts[0]).toMatchObject({ level: null, reviewError: expect.any(String) });
    spy.mockRestore();
  });
});

describe("an instructor reading and correcting attempts", () => {
  const tx = withRollback();
  let world: World;
  let other: World;
  let checkId: string;
  let attemptId: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 4 });
    other = await makeWorld(tx());
    ({ checkId } = await makeCheck(tx(), { unitId: world.unitId }));

    const first = await makeCheckAttempt(tx(), {
      checkId,
      studentId: world.student.studentId,
      attempt: 1,
      submittedAt: hoursAgo(400),
      level: "UNISTRUCTURAL",
    });
    attemptId = first.id;
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: world.student.studentId,
      attempt: 2,
      submittedAt: hoursAgo(200),
      level: "MULTISTRUCTURAL",
    });
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: world.students[1]!.studentId,
      attempt: 1,
      submittedAt: hoursAgo(10),
    });
  });

  it("counts fellows who have answered, not attempts", async () => {
    const summary = await createCaller(tx(), world.instructorId).checks.forCourse({
      courseId: world.courseId,
    });

    expect(summary.activeStudents).toBe(4);
    expect(summary.checks).toEqual([
      expect.objectContaining({ checkId, answered: 2, exemplar: expect.any(String) }),
    ]);
  });

  it("leaves test students and removed fellows out of both numbers", async () => {
    // The third fellow becomes a test student and answers; a removed fellow answers too.
    await tx().profile.update({
      where: { id: world.students[2]!.studentId },
      data: { testStudentNumber: 900_000 + Math.floor(Math.random() * 99_999) },
    });
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: world.students[2]!.studentId,
      attempt: 1,
      submittedAt: hoursAgo(5),
    });
    const removed = await makeAccount(tx());
    await enroll(tx(), { programId: world.programId, studentId: removed, status: "REMOVED" });
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: removed,
      attempt: 1,
      submittedAt: hoursAgo(5),
    });

    const summary = await createCaller(tx(), world.instructorId).checks.forCourse({
      courseId: world.courseId,
    });

    // Four active fellows, one now a test student; of the three answers counted before, the test
    // student's and the removed fellow's are not among them.
    expect(summary.activeStudents).toBe(3);
    expect(summary.checks[0]!.answered).toBe(2);
  });

  it("keeps the course's check details from a fellow and from another program's instructor", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), world.student.studentId).checks.forCourse({ courseId: world.courseId }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() => createCaller(tx(), other.instructorId).checks.attemptsFor({ checkId })),
    ).toBe("FORBIDDEN");
  });

  it("lists every active fellow, test students included, and an empty history for one who has not answered", async () => {
    const data = await createCaller(tx(), world.instructorId).checks.attemptsFor({ checkId });

    expect(data.rows).toHaveLength(4);
    const histories = new Map(data.rows.map((row) => [row.student.id, row.attempts.length]));
    expect(histories.get(world.student.studentId)).toBe(2);
    expect(histories.get(world.students[1]!.studentId)).toBe(1);
    expect(histories.get(world.students[2]!.studentId)).toBe(1);
    expect(histories.get(world.students[3]!.studentId)).toBe(0);
  });

  it("sets a level on one attempt and leaves the other alone, then clears it", async () => {
    const instructor = createCaller(tx(), world.instructorId);
    const fellow = createCaller(tx(), world.student.studentId);

    await instructor.checks.setLevel({ attemptId, level: "RELATIONAL" });
    const after = (await fellow.checks.myAttempts({ courseId: world.courseId }))[0]!.attempts;
    expect(after.map((a) => a.instructorLevel)).toEqual(["RELATIONAL", null]);

    await instructor.checks.setLevel({ attemptId, level: null });
    const cleared = (await fellow.checks.myAttempts({ courseId: world.courseId }))[0]!.attempts;
    expect(cleared.map((a) => a.instructorLevel)).toEqual([null, null]);
  });

  it("refuses a correction from another program's instructor", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), other.instructorId).checks.setLevel({ attemptId, level: "BLOCKED" }),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("writing a check with its resource", () => {
  const tx = withRollback();
  let world: World;

  const spec = {
    objective: "Explain what a closure keeps.",
    question: "What does `counter()` return the second time?",
    factsExample: "It returns 2.",
    exemplar: "It returns 2, because the inner function keeps a reference to `count`.",
    retryWait: { days: 7, hours: 0 },
  };

  beforeAll(async () => {
    world = await makeWorld(tx());
  });

  it("creates, edits, keeps, and removes a check through the resource's own saves", async () => {
    const instructor = createCaller(tx(), world.instructorId);
    const link = {
      kind: "LINK" as const,
      title: "MDN: Closures",
      url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures",
      description: null,
    };

    const created = await instructor.resources.create({
      courseUnitId: world.unitId,
      spec: link,
      check: spec,
    });
    expect(created.check).toMatchObject({ question: spec.question, retryWaitHours: 168 });
    const checkId = created.check!.id;

    await makeCheckAttempt(tx(), {
      checkId,
      studentId: world.student.studentId,
      attempt: 1,
      submittedAt: hoursAgo(1),
    });

    // Editing the check keeps its id, and with it the attempt already made.
    const edited = await instructor.resources.update({
      resourceId: created.id,
      spec: link,
      check: { ...spec, retryWait: { days: 1, hours: 6 } },
    });
    expect(edited.check).toMatchObject({ id: checkId, retryWaitHours: 30 });
    expect(await tx().checkAttempt.count({ where: { checkId } })).toBe(1);

    // A save that does not mention checks — an older page — leaves the check alone.
    const untouched = await instructor.resources.update({ resourceId: created.id, spec: link });
    expect(untouched.check?.id).toBe(checkId);

    // Null removes it, and every attempt with it.
    const removed = await instructor.resources.update({
      resourceId: created.id,
      spec: link,
      check: null,
    });
    expect(removed.check).toBeNull();
    expect(await tx().checkAttempt.count({ where: { checkId } })).toBe(0);
  });

  it("removes the check and its attempts with the resource", async () => {
    const { resourceId, checkId } = await makeCheck(tx(), { unitId: world.unitId });
    await makeCheckAttempt(tx(), {
      checkId,
      studentId: world.student.studentId,
      attempt: 1,
      submittedAt: hoursAgo(1),
    });

    await createCaller(tx(), world.instructorId).resources.remove({ resourceId });

    expect(await tx().checkForUnderstanding.count({ where: { id: checkId } })).toBe(0);
    expect(await tx().checkAttempt.count({ where: { checkId } })).toBe(0);
  });
});

describe("the Understanding reading, on the record and in a coaching session", () => {
  const tx = withRollback();
  let world: World;

  beforeAll(async () => {
    world = await makeWorld(tx());
    // One check answered and left Blocked without asking for help; one not answered at all.
    const answered = await makeCheck(tx(), { unitId: world.unitId });
    await makeCheck(tx(), { unitId: world.unitId });
    await makeCheckAttempt(tx(), {
      checkId: answered.checkId,
      studentId: world.student.studentId,
      attempt: 1,
      submittedAt: hoursAgo(3),
      level: "BLOCKED",
    });
  });

  it("reads answered, blocked, and asked for help per course on the record", async () => {
    const record = await createCaller(tx(), world.instructorId).programs.student({
      programId: world.programId,
      studentId: world.student.studentId,
    });

    expect(record.courses.find((course) => course.id === world.courseId)!.checks).toEqual({
      checks: 2,
      answered: 1,
      blocked: 1,
      blockedAskedHelp: 0,
      otherAskedHelp: 0,
    });
  });

  it("shows the coaching form the same Trends as the record, and keeps them out of the snapshot", async () => {
    const instructor = createCaller(tx(), world.instructorId);
    const started = await instructor.coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    const [session, record] = await Promise.all([
      instructor.coaching.session({ programId: world.programId, sessionId: started.id }),
      instructor.programs.student({
        programId: world.programId,
        studentId: world.student.studentId,
      }),
    ]);

    expect(session.trends.recentAttendance).toEqual(record.recentAttendance);
    expect(session.trends.arrivals).toEqual(record.arrivals);
    expect(
      session.trends.courses.map((course) => [course.id, course.recent, course.checks]),
    ).toEqual(record.courses.map((course) => [course.id, course.recent, course.checks]));
    // What the fellow will see carries none of it.
    expect(JSON.stringify(session.figures)).not.toContain("blocked");
  });
});
