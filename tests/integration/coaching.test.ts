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

import { makeAccount, makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import type { StoredObjects } from "./storage-double";
import { withRollback, type Tx } from "./transaction";

/**
 * The bucket, as a map — see `storage-double.ts`. Files attached to goal updates travel the same
 * path a submission's do, so the same double stands in for storage here.
 */
jest.mock("../../lib/uploads/storage", () =>
  jest.requireActual<typeof import("./storage-double")>("./storage-double").storageDouble(),
);

const bucket = (jest.requireMock("../../lib/uploads/storage") as { __objects: StoredObjects })
  .__objects;

/** What a fellow's browser does between the two attachment calls: PUT the bytes at the address. */
const sendToBucket = (path: string, contentType: string, bytes: Buffer) => {
  bucket.set(path, { bytes, contentType });
};

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

  /*
    The field at the bottom of the form is an answer like the others, under its own prompt id, so
    it saves through the same call and comes back with its label copied in the same way.
  */
  it("keeps additional notes among the answers, labelled", async () => {
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId,
      temperature: null,
      answers: [{ promptId: "additional-notes", answer: "Follow up on the pairing schedule." }],
    });

    const session = await asInstructor().coaching.session({
      programId: world.programId,
      sessionId,
    });
    expect(session.answers).toContainEqual({
      promptId: "additional-notes",
      prompt: "Additional notes",
      answer: "Follow up on the pairing schedule.",
    });
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
      title: "Ask for help within half an hour of being stuck.",
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
          title: "Ask for help within half an hour of being stuck.",
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
          title: "Ask for help within half an hour of being stuck.",
          entryId: elsewhere,
          successCriteria: "",
          objectives: "",
          actionPlan: "",
          marker: null,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("a goal needs a name, and the name is the fellow's own words", async () => {
    expect(
      await refusal(() =>
        asFellow().coaching.setGoal({
          programId: world.programId,
          title: "   ",
          entryId: INDICATOR,
          successCriteria: "",
          objectives: "",
          actionPlan: "",
          marker: null,
        }),
      ),
    ).toBe("BAD_REQUEST");

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.goals.find((row) => row.id === goalId)?.title).toBe(
      "Ask for help within half an hour of being stuck.",
    );
  });

  /*
    The competency is one fact about a goal rather than its name, so a goal may have none — and
    the four copy columns then read null together, which the CHECK holds even against a script.
  */
  it("a goal may be about no competency at all, and the four copies go together", async () => {
    const bare = await asFellow().coaching.setGoal({
      programId: world.programId,
      title: "Finish the reading before class twice a week.",
      entryId: null,
      successCriteria: "",
      objectives: "",
      actionPlan: "",
      marker: null,
    });

    expect(bare).toMatchObject({
      entryId: null,
      entryKind: null,
      entryText: null,
      competencyName: null,
    });

    const attached = await asFellow().coaching.updateGoal({
      programId: world.programId,
      goalId: bare.id,
      entryId: INDICATOR,
    });
    expect(attached.competencyName).toBe("Growth Mindset");

    const cleared = await asFellow().coaching.updateGoal({
      programId: world.programId,
      goalId: bare.id,
      entryId: null,
    });
    expect(cleared).toMatchObject({ entryId: null, entryText: null, competencyName: null });

    /*
      Inside a savepoint, because this suite runs in one transaction that is rolled back at the
      end, and Postgres aborts the whole transaction on a refused statement — every test after
      this one would fail for a reason that is not theirs.
    */
    await tx().$executeRaw`SAVEPOINT half_a_competency`;
    await expect(
      tx().$executeRaw`
        INSERT INTO "goals" ("id", "program_id", "enrollment_id", "title", "entry_id",
                             "success_criteria", "objectives", "action_plan")
        VALUES (gen_random_uuid(), ${world.programId}::uuid, ${world.student.id}::uuid,
                'half a competency', 'orphan-id', '', '', '')
      `,
    ).rejects.toThrow(/goals_competency_all_or_none/);
    await tx().$executeRaw`ROLLBACK TO SAVEPOINT half_a_competency`;

    // Gone again, so the checks below go on reading one goal, as they were written to.
    await asFellow().coaching.deleteGoal({ programId: world.programId, goalId: bare.id });
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
          title: "Ask for help within half an hour of being stuck.",
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
/*
  ---- Updates: the fellow's progress notes under a goal ------------------------------------------

  The same ownership as the goal, checked from both sides; then the files, which travel the
  submission upload's path and are refused for the same reasons; then who may open one — the
  bucket is private, so the procedure that signs a link is the whole of that rule.
*/
describe("goal updates: the fellow's progress notes", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let goalId: string;
  let updateId: string;

  const asFellow = () => createCaller(tx(), world.student.studentId);
  const asOtherFellow = () => createCaller(tx(), world.students[1]!.studentId);
  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asAdmin = () => createCaller(tx(), adminId);

  /** Begin, PUT, record: one file attached the way a browser does it. */
  const attach = async (filename: string, bytes = Buffer.from("evidence")) => {
    const destination = await asFellow().coaching.beginUpdateUpload({
      programId: world.programId,
      updateId,
      filename,
      sizeBytes: bytes.byteLength,
    });
    sendToBucket(destination.path, destination.contentType, bytes);
    return asFellow().coaching.recordUpdateUpload({
      programId: world.programId,
      updateId,
      path: destination.path,
      filename,
    });
  };

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    adminId = await makeAccount(tx(), { role: "ADMIN" });
    INDICATOR = await seedCompetency(tx());

    const goal = await asFellow().coaching.setGoal({
      programId: world.programId,
      title: "Ask for help within half an hour of being stuck.",
      entryId: INDICATOR,
      successCriteria: "",
      objectives: "",
      actionPlan: "",
      marker: null,
    });
    goalId = goal.id;
  });

  it("the fellow writes one, and reads it back under the goal", async () => {
    const update = await asFellow().coaching.addUpdate({
      programId: world.programId,
      goalId,
      body: "Asked in the channel twice this week. See [the thread](https://example.test/t/1).",
    });
    updateId = update.id;

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    const goal = mine.goals.find((row) => row.id === goalId);
    expect(goal?.updates.map((row) => row.id)).toEqual([updateId]);
    expect(goal?.updates[0]?.attachments).toEqual([]);
  });

  it("rewrites the words of their own", async () => {
    const edited = await asFellow().coaching.editUpdate({
      programId: world.programId,
      updateId,
      body: "Asked three times, actually.",
    });
    expect(edited.body).toBe("Asked three times, actually.");
  });

  it("another fellow finds nothing, and an instructor may not write one", async () => {
    expect(
      await refusal(() =>
        asOtherFellow().coaching.editUpdate({ programId: world.programId, updateId, body: "no" }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await refusal(() =>
        asInstructor().coaching.addUpdate({ programId: world.programId, goalId, body: "no" }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("their instructor reads it on the record and in a session", async () => {
    const record = await asInstructor().coaching.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(record.goals.find((row) => row.id === goalId)?.updates).toHaveLength(1);

    const started = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    const session = await asInstructor().coaching.session({
      programId: world.programId,
      sessionId: started.id,
    });
    expect(session.goals.find((row) => row.id === goalId)?.updates[0]?.body).toBe(
      "Asked three times, actually.",
    );
  });

  it("attaching a file: an address, the bytes, then the row", async () => {
    const attachment = await attach("screenshot.png");

    expect(attachment.uploadFilename).toBe("screenshot.png");
    expect(attachment.uploadContentType).toBe("image/png");
    expect([...bucket.keys()].some((path) => path.startsWith(`${updateId}/`))).toBe(true);

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    const update = mine.goals.find((row) => row.id === goalId)?.updates[0];
    expect(update?.attachments.map((row) => row.uploadFilename)).toEqual(["screenshot.png"]);
    // The bucket's address never reaches the browser.
    expect(update?.attachments[0]).not.toHaveProperty("uploadPath");
  });

  it("a path outside the update's folder is refused, whatever is stored there", async () => {
    const elsewhere = `${goalId}/${"0".repeat(8)}.png`;
    sendToBucket(elsewhere, "image/png", Buffer.from("x"));

    expect(
      await refusal(() =>
        asFellow().coaching.recordUpdateUpload({
          programId: world.programId,
          updateId,
          path: elsewhere,
          filename: "x.png",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("a file that never arrived is not recorded, and a mislabelled one is refused", async () => {
    const destination = await asFellow().coaching.beginUpdateUpload({
      programId: world.programId,
      updateId,
      filename: "notes.pdf",
      sizeBytes: 10,
    });

    expect(
      await refusal(() =>
        asFellow().coaching.recordUpdateUpload({
          programId: world.programId,
          updateId,
          path: destination.path,
          filename: "notes.pdf",
        }),
      ),
    ).toBe("NOT_FOUND");

    // Stored as an image under a .pdf address: not the kind of file the extension means.
    sendToBucket(destination.path, "image/png", Buffer.from("not a pdf"));
    expect(
      await refusal(() =>
        asFellow().coaching.recordUpdateUpload({
          programId: world.programId,
          updateId,
          path: destination.path,
          filename: "notes.pdf",
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("a kind of file the bucket does not store is refused before an address is minted", async () => {
    expect(
      await refusal(() =>
        asFellow().coaching.beginUpdateUpload({
          programId: world.programId,
          updateId,
          filename: "payload.exe",
          sizeBytes: 10,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("who may open a file: the fellow, their instructors, an admin — and nobody else", async () => {
    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    const attachmentId = mine.goals.find((row) => row.id === goalId)!.updates[0]!.attachments[0]!
      .id;
    const open = (caller: ReturnType<typeof createCaller>) =>
      caller.coaching.updateAttachmentUrl({
        programId: world.programId,
        attachmentId,
        disposition: "inline",
      });

    expect((await open(asFellow())).url).toContain("memory://download/");
    expect((await open(asInstructor())).url).toContain("memory://download/");
    expect((await open(asAdmin())).url).toContain("memory://download/");
    expect(await refusal(() => open(asOtherFellow()))).toBe("NOT_FOUND");
  });

  it("an eleventh file is refused", async () => {
    for (let index = 1; index < 10; index += 1) {
      await attach(`more-${index}.png`);
    }
    expect(await refusal(() => attach("eleventh.png"))).toBe("BAD_REQUEST");
  });

  /*
    Eleven objects sit under the update: the ten recorded files, and the mislabelled PDF a test
    above PUT into the bucket and the server refused to record. That one is exactly the orphan
    `reconcile:uploads` exists for — no row names it, so nothing here removes it — and asserting
    it is still there at the end is the honest count.
  */
  it("removing a file removes its object; removing the update removes the rest", async () => {
    const under = () => [...bucket.keys()].filter((path) => path.startsWith(`${updateId}/`));
    expect(under()).toHaveLength(11);

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    const first = mine.goals.find((row) => row.id === goalId)!.updates[0]!.attachments[0]!;
    await asFellow().coaching.deleteUpdateAttachment({
      programId: world.programId,
      attachmentId: first.id,
    });
    expect(under()).toHaveLength(10);

    await asFellow().coaching.deleteUpdate({ programId: world.programId, updateId });
    expect(under()).toHaveLength(1);
    expect(under()[0]!.endsWith(".pdf")).toBe(true);
  });

  it("deleting the goal removes every object under every update of it", async () => {
    const update = await asFellow().coaching.addUpdate({
      programId: world.programId,
      goalId,
      body: "",
    });
    updateId = update.id;
    await attach("last.png");
    expect([...bucket.keys()].some((path) => path.startsWith(`${updateId}/`))).toBe(true);

    await asFellow().coaching.deleteGoal({ programId: world.programId, goalId });
    expect([...bucket.keys()].some((path) => path.startsWith(`${updateId}/`))).toBe(false);
  });

  it("a fellow who has left keeps reading, and stops writing", async () => {
    const goal = await asOtherFellow().coaching.setGoal({
      programId: world.programId,
      title: "Speak up once per stand-up.",
      entryId: null,
      successCriteria: "",
      objectives: "",
      actionPlan: "",
      marker: null,
    });
    await asOtherFellow().coaching.addUpdate({
      programId: world.programId,
      goalId: goal.id,
      body: "Did it on Tuesday.",
    });

    await tx().enrollment.update({
      where: { id: world.students[1]!.id },
      data: { status: "REMOVED" },
    });

    const mine = await asOtherFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.goals.find((row) => row.id === goal.id)?.updates).toHaveLength(1);
    expect(
      await refusal(() =>
        asOtherFellow().coaching.addUpdate({
          programId: world.programId,
          goalId: goal.id,
          body: "no",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("none of it reaches the audit log", async () => {
    const events = await tx().auditEvent.findMany({
      where: { action: { in: ["GOAL_UPDATED", "GOAL_DELETED"] } },
    });
    expect(events).toEqual([]);
  });
});

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
      title: "Ask for help within half an hour of being stuck.",
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
