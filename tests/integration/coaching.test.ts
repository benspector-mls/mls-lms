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

/**
 * A competency of this suite's own, so that what these tests assert about copied wording is about
 * the copying rather than about whatever the school's seeded list happens to say today.
 *
 * Offered to `SOFTWARE_ENGINEERING`, which is what `makeWorld`'s program runs. The pitfall row
 * exists so that one test can name an entry a fellow is *not* offered without inventing a second
 * fellowship's worth of list.
 */
async function seedCompetency(db: Tx) {
  const competency = await db.competency.create({
    data: {
      name: "Growth Mindset",
      blurb: "Deriving satisfaction from growth.",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 0,
      group: { create: { name: "Durable Skills", position: 0 } },
      entries: {
        create: [
          {
            kind: "INDICATOR",
            text: "Asks for help when stuck rather than struggling in silence.",
            position: 0,
          },
        ],
      },
    },
    select: { id: true, entries: { select: { id: true } } },
  });

  return competency.entries[0]!.id;
}

/** The seeded indicator's id, set by whichever block created it inside its own transaction. */
let INDICATOR: string;

/** An entry of a competency this suite's fellows are not offered. */
async function seedOtherDiscipline(db: Tx) {
  const competency = await db.competency.create({
    data: {
      name: "Statistical Reasoning",
      blurb: "",
      disciplines: ["DATA_ANALYTICS"],
      position: 0,
      group: { create: { name: "Data Analytics", position: 1 } },
      entries: { create: [{ kind: "INDICATOR", text: "Checks a distribution.", position: 0 }] },
    },
    select: { entries: { select: { id: true } } },
  });

  return competency.entries[0]!.id;
}

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

    expect(
      await refusal(() =>
        asOutsider().coaching.deleteSession({ programId: outsider.programId, sessionId }),
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
    INDICATOR = await seedCompetency(tx());
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
          entryId: "00000000-0000-4000-8000-000000000000",
          successCriteria: "",
          objectives: "",
          actionPlan: "",
          marker: null,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  /*
    The list is application-wide, so the other fellowship's entries are real rows with real ids.
    What keeps them off this fellow's goal is the competency's `disciplines`, which is the same
    filter the picker renders from — so the refusal is what makes the payload agree with the
    screen.
  */
  it("...and an entry of the other fellowship is refused, though the id is real", async () => {
    const elsewhere = await seedOtherDiscipline(tx());

    expect(
      await refusal(() =>
        asFellow().coaching.setGoal({
          programId: world.programId,
          entryId: elsewhere,
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

/*
  ---- Discarding a session --------------------------------------------------------------------

  Pressing "Start coaching session" on the wrong fellow's record is the mistake this exists for, so
  the draft case is the one that matters. A completed session can go too, and the event says which
  it was, because deleting one takes back a snapshot the fellow has already seen.
*/
describe("discarding a coaching session", () => {
  const tx = withRollback();

  let world: World;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asFellow = () => createCaller(tx(), world.student.studentId);

  const start = async () => {
    const session = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    return session.id;
  };

  beforeAll(async () => {
    world = await makeWorld(tx());
    INDICATOR = await seedCompetency(tx());
  });

  it("a draft goes, and the log says it was never completed", async () => {
    const sessionId = await start();
    await asInstructor().coaching.deleteSession({ programId: world.programId, sessionId });

    expect(await tx().coachingSession.findUnique({ where: { id: sessionId } })).toBeNull();

    const events = await tx().auditEvent.findMany({
      where: { action: "COACHING_SESSION_DELETED", subjectId: world.student.studentId },
    });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ sessionId, wasCompleted: false });
  });

  it("a completed one goes too, and the log says so", async () => {
    const sessionId = await start();
    await asInstructor().coaching.completeSession({ programId: world.programId, sessionId });
    await asInstructor().coaching.deleteSession({ programId: world.programId, sessionId });

    const events = await tx().auditEvent.findMany({
      where: {
        action: "COACHING_SESSION_DELETED",
        subjectId: world.student.studentId,
        detail: { path: ["sessionId"], equals: sessionId },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ wasCompleted: true });

    // And the fellow stops seeing the snapshot it had shared with them.
    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.sessions.map((session) => session.id)).not.toContain(sessionId);
  });

  /*
    The claim the schema makes structurally — a goal carries no session — asserted from outside,
    because it is the whole reason discarding is safe to offer.
  */
  it("the fellow's goals are untouched by it", async () => {
    const goal = await asFellow().coaching.setGoal({
      programId: world.programId,
      entryId: INDICATOR,
      successCriteria: "",
      objectives: "",
      actionPlan: "",
      marker: null,
    });

    const sessionId = await start();
    await asInstructor().coaching.deleteSession({ programId: world.programId, sessionId });

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.goals.map((row) => row.id)).toContain(goal.id);
  });

  it("an instructor of another program cannot", async () => {
    const sessionId = await start();
    const outsider = await makeWorld(tx());

    expect(
      await refusal(() =>
        createCaller(tx(), outsider.instructorId).coaching.deleteSession({
          programId: world.programId,
          sessionId,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("a fellow cannot discard their own instructor's session", async () => {
    const sessionId = await start();

    expect(
      await refusal(() =>
        asFellow().coaching.deleteSession({ programId: world.programId, sessionId }),
      ),
    ).toBe("FORBIDDEN");
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
