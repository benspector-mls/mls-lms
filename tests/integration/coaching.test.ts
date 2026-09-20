/**
 * Coaching records: who may write about a fellow, who owns the goals, and what each side reads.
 *
 * The access checks follow gcf.test.ts's model: every group builds an outsider — a second program
 * with its own instructor — so a missing guard or a missing where-clause has something real to
 * leak. The one-computation check at the end is the feature's central promise: the figures a
 * completed session freezes are the figures the student record shows, because both are
 * `courseFiguresFor` called twice.
 */
import { parseSnapshot } from "@/lib/coaching";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
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

const INDICATOR = "growth-mindset/asks-for-help";

describe("who may write about a fellow", () => {
  const tx = withRollback();

  let world: World;
  let outsider: World;
  let noteId: string;
  let sessionId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asOutsider = () => createCaller(tx(), outsider.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx());
    outsider = await makeWorld(tx());

    const note = await asInstructor().coaching.addNote({
      programId: world.programId,
      studentId: world.student.studentId,
      body: "Confidential observation.",
    });
    noteId = note.id;

    const session = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    sessionId = session.id;
  });

  it("an instructor of another program is refused outright", async () => {
    const calls = [
      () =>
        asOutsider().coaching.forStudent({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      () =>
        asOutsider().coaching.startSession({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      () =>
        asOutsider().coaching.addNote({
          programId: world.programId,
          studentId: world.student.studentId,
          body: "x",
        }),
      () => asOutsider().coaching.session({ programId: world.programId, sessionId }),
    ];

    for (const call of calls) {
      expect(await refusal(call)).toBe("FORBIDDEN");
    }
  });

  /*
    The where-clause check: the outsider names their own program — which they do instruct — but a
    row belonging to this one. The guard passes; the row must not be found.
  */
  it("a stolen id under the right role finds nothing", async () => {
    expect(
      await refusal(() =>
        asOutsider().coaching.updateNote({
          programId: outsider.programId,
          noteId,
          body: "rewritten",
        }),
      ),
    ).toBe("NOT_FOUND");

    expect(
      await refusal(() =>
        asOutsider().coaching.session({ programId: outsider.programId, sessionId }),
      ),
    ).toBe("NOT_FOUND");

    expect(
      await refusal(() =>
        asOutsider().coaching.completeSession({ programId: outsider.programId, sessionId }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("a fellow cannot reach the instructor surface at all", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), world.student.studentId).coaching.forStudent({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("a coaching session, drafted and completed", () => {
  const tx = withRollback();

  let world: World;
  let sessionId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asFellow = () => createCaller(tx(), world.student.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });

    // Real figures for the snapshot: one released assignment handed in late and graded complete,
    // one past due and never handed in.
    const graded = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      dueAt: new Date("2026-01-10T00:00:00Z"),
    });
    await makeSubmission(tx(), {
      assignmentId: graded.id,
      studentId: world.student.studentId,
      submittedAt: new Date("2026-01-20T10:00:00Z"),
      graded: { score: 9, possible: 10, isComplete: true },
    });
    await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      dueAt: new Date("2026-01-10T00:00:00Z"),
    });

    const session = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    sessionId = session.id;
  });

  it("saving copies the prompt text from the template, not from the client", async () => {
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId,
      temperature: 7,
      answers: [{ promptId: "on-your-mind", answer: "Interview prep." }],
    });

    const stored = await tx().coachingSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { temperature: true, answers: true },
    });

    expect(stored.temperature).toBe(7);
    expect(stored.answers).toEqual([
      {
        promptId: "on-your-mind",
        prompt: "What has been on your mind lately?",
        answer: "Interview prep.",
      },
    ]);
  });

  it("refuses an answer to a prompt the template does not have", async () => {
    expect(
      await refusal(() =>
        asInstructor().coaching.saveSession({
          programId: world.programId,
          sessionId,
          temperature: null,
          answers: [{ promptId: "no-such-prompt", answer: "x" }],
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("a draft session is invisible to the fellow", async () => {
    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.sessions).toEqual([]);
  });

  it("completing writes the snapshot and records the act", async () => {
    await asInstructor().coaching.completeSession({ programId: world.programId, sessionId });

    const stored = await tx().coachingSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { endedAt: true, snapshot: true },
    });

    expect(stored.endedAt).not.toBeNull();
    expect(parseSnapshot(stored.snapshot)).not.toBeNull();

    const events = await tx().auditEvent.findMany({
      where: { action: "COACHING_SESSION_COMPLETED", subjectId: world.student.studentId },
    });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ snapshotVersion: 1 });
  });

  it("a completed session refuses another completion and any further writing", async () => {
    expect(
      await refusal(() =>
        asInstructor().coaching.completeSession({ programId: world.programId, sessionId }),
      ),
    ).toBe("BAD_REQUEST");

    expect(
      await refusal(() =>
        asInstructor().coaching.saveSession({
          programId: world.programId,
          sessionId,
          temperature: 3,
          answers: [],
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("the fellow reads dated snapshots, and nothing staff-only", async () => {
    const mine = await asFellow().coaching.myGoals({ programId: world.programId });

    expect(mine.sessions).toHaveLength(1);
    expect(Object.keys(mine.sessions[0]).sort()).toEqual(["endedAt", "id", "snapshot"]);
    expect(mine).not.toHaveProperty("notes");
    expect(JSON.stringify(mine)).not.toContain("temperature");
  });

  /*
    The feature's central promise: the snapshot is the record screen's own figures frozen, because
    both are courseFiguresFor. If these two ever disagree, the shared seam has been bypassed.
  */
  it("the snapshot's figures equal the student record's", async () => {
    const snapshot = parseSnapshot(
      (
        await tx().coachingSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { snapshot: true },
        })
      ).snapshot,
    );

    const record = await asInstructor().programs.student({
      programId: world.programId,
      studentId: world.student.studentId,
    });

    const recordRow = record.courses.find((course) => course.id === world.courseId)!;
    const snapshotRow = snapshot!.courses.find((course) => course.courseId === world.courseId)!;

    expect(snapshotRow).toMatchObject({
      completedAssignments: recordRow.completedAssignments,
      missing: recordRow.missing,
      late: recordRow.late,
      verdict: recordRow.verdict,
    });
  });
});

/*
  ---- Goals, which are the fellow's ---------------------------------------------------------------

  The ownership the rest of coaching is not: a fellow writes, edits, assesses and deletes their own
  goals, with no session behind them and nothing to wait for. An instructor reads them and writes
  nothing. Every check here is one half of that sentence.
*/
describe("goals belong to the fellow", () => {
  const tx = withRollback();

  let world: World;
  let outsider: World;
  let goalId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asFellow = () => createCaller(tx(), world.student.studentId);
  const asOtherFellow = () => createCaller(tx(), world.students[1]!.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    outsider = await makeWorld(tx());
  });

  it("a fellow sets one for themselves, with no session behind it", async () => {
    const goal = await asFellow().coaching.setGoal({
      programId: world.programId,
      entryId: INDICATOR,
      successCriteria: "Asks in the help channel within thirty minutes of being stuck.",
      objectives: "Post one question per week.",
      actionPlan: "Review the questions asked at the next session.",
      marker: "DEVELOPING",
    });
    goalId = goal.id;

    expect(goal).toMatchObject({
      entryId: INDICATOR,
      entryKind: "INDICATOR",
      entryText: "Asks for help when stuck rather than struggling in silence.",
      competencyName: "Growth Mindset",
      marker: "DEVELOPING",
    });
  });

  it("...and the wording is copied server-side, from the list rather than the client", async () => {
    expect(
      await refusal(() =>
        asFellow().coaching.setGoal({
          programId: world.programId,
          entryId: "growth-mindset/no-such-entry",
          successCriteria: "",
          objectives: "",
          actionPlan: "",
          marker: null,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("...and their instructor sees it at once, with nothing to release", async () => {
    const seen = await asInstructor().coaching.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });

    expect(seen.goals.map((goal) => goal.id)).toEqual([goalId]);
    expect(seen.goals[0]).toMatchObject({ marker: "DEVELOPING" });
  });

  it("a fellow rewrites their own goal and moves their own marker", async () => {
    await asFellow().coaching.updateGoal({
      programId: world.programId,
      goalId,
      successCriteria: "Asks the same day, every time.",
      marker: "PROFICIENT",
    });

    const stored = await tx().goal.findUniqueOrThrow({
      where: { id: goalId },
      select: { successCriteria: true, marker: true },
    });
    expect(stored).toEqual({
      successCriteria: "Asks the same day, every time.",
      marker: "PROFICIENT",
    });
  });

  /*
    Nothing on a goal is an instructor's to write — they say what they think in the session. The
    fellow-facing procedures are the only ones there are, and they refuse anybody who is not the
    fellow.
  */
  it("an instructor cannot write one, change one, or delete one", async () => {
    expect(
      await refusal(() =>
        asInstructor().coaching.setGoal({
          programId: world.programId,
          entryId: INDICATOR,
          successCriteria: "",
          objectives: "",
          actionPlan: "",
          marker: null,
        }),
      ),
    ).toBe("FORBIDDEN");

    expect(
      await refusal(() =>
        asInstructor().coaching.updateGoal({
          programId: world.programId,
          goalId,
          marker: "FOUNDATIONAL",
        }),
      ),
    ).toBe("FORBIDDEN");

    expect(
      await refusal(() =>
        asInstructor().coaching.deleteGoal({ programId: world.programId, goalId }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("another fellow of the program cannot touch it, or see it", async () => {
    expect(
      await refusal(() =>
        asOtherFellow().coaching.updateGoal({
          programId: world.programId,
          goalId,
          marker: "EXCEEDS",
        }),
      ),
    ).toBe("NOT_FOUND");

    const theirs = await asOtherFellow().coaching.myGoals({ programId: world.programId });
    expect(theirs.goals).toEqual([]);
  });

  it("a fellow of another program is refused the program outright", async () => {
    expect(
      await refusal(() =>
        createCaller(tx(), outsider.student.studentId).coaching.myGoals({
          programId: world.programId,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  /*
    Setting, moving and deleting your own goal is your record rather than an act somebody is held
    to. The log stays for what instructors write, and says nothing about this.
  */
  it("none of it reaches the audit log", async () => {
    const events = await tx().auditEvent.findMany({
      where: {
        subjectId: world.student.studentId,
        action: { in: ["GOAL_UPDATED", "GOAL_DELETED"] },
      },
    });
    expect(events).toEqual([]);
  });

  it("a removed fellow keeps reading their goals, and stops writing them", async () => {
    await tx().enrollment.update({
      where: { id: world.student.id },
      data: { status: "REMOVED" },
    });

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.goals).toHaveLength(1);

    expect(
      await refusal(() =>
        asFellow().coaching.updateGoal({ programId: world.programId, goalId, marker: "EXCEEDS" }),
      ),
    ).toBe("FORBIDDEN");

    await tx().enrollment.update({
      where: { id: world.student.id },
      data: { status: "ACTIVE" },
    });
  });

  it("a fellow deletes their own", async () => {
    await asFellow().coaching.deleteGoal({ programId: world.programId, goalId });

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.goals).toEqual([]);
  });
});

describe("instructor notes", () => {
  const tx = withRollback();

  let world: World;
  let noteId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  const BODY = "Spoke about housing; following up with the success team.";

  beforeAll(async () => {
    world = await makeWorld(tx());
  });

  it("create, edit, and delete each leave a record — never the words", async () => {
    const note = await asInstructor().coaching.addNote({
      programId: world.programId,
      studentId: world.student.studentId,
      body: BODY,
    });
    noteId = note.id;

    await asInstructor().coaching.updateNote({
      programId: world.programId,
      noteId,
      body: `${BODY} Housing resolved.`,
    });

    await asInstructor().coaching.deleteNote({ programId: world.programId, noteId });

    const events = await tx().auditEvent.findMany({
      where: {
        subjectId: world.student.studentId,
        action: { in: ["COACHING_NOTE_CREATED", "COACHING_NOTE_UPDATED", "COACHING_NOTE_DELETED"] },
      },
      orderBy: { occurredAt: "asc" },
    });

    expect(events.map((event) => event.action)).toEqual([
      "COACHING_NOTE_CREATED",
      "COACHING_NOTE_UPDATED",
      "COACHING_NOTE_DELETED",
    ]);
    for (const event of events) {
      expect(JSON.stringify(event.detail ?? {})).not.toContain("housing");
      expect(JSON.stringify(event.detail ?? {})).not.toContain("Housing");
    }
  });
});
