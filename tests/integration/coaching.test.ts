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
import { schoolDayOf } from "@/lib/school-time";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  FIXTURE_LAYOUT,
  makeAccount,
  makeAssignment,
  makeCoachingTemplate,
  makeSubmission,
  makeWorld,
  type World,
} from "./fixtures";
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

/**
 * A session started from a form of the suite's own, made inside the block's transaction, so no
 * session here depends on the seeded default form.
 */
async function startSession(db: Tx, caller: ReturnType<typeof createCaller>, world: World) {
  const template = await makeCoachingTemplate(db);
  return caller.coaching.startSession({
    programId: world.programId,
    studentId: world.student.studentId,
    templateId: template.id,
  });
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

    const session = await startSession(tx(), asInstructor(), world);
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
  let adminId: string;
  let template: { id: string };
  let sessionId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asAdmin = () => createCaller(tx(), adminId);
  const asFellow = () => createCaller(tx(), world.student.studentId);

  /*
    The answers the session carries through the block. Every save sends the whole set, as the
    autosave does, so a later save that moved only the date sends them again rather than clearing
    them.
  */
  const ANSWERS = [
    { promptId: "preparation", answer: "Ask about Mod 2" },
    { promptId: "win", answer: "Shipped the API." },
    { promptId: "energy", answer: 3 },
    { promptId: "focus", answer: "Mod 2" },
    { promptId: "supports", answer: ["Pairing", "Office hours"] },
  ];

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

    adminId = await makeAccount(tx(), { role: "ADMIN" });
    template = await makeCoachingTemplate(tx(), { name: "The suite's form" });
    const session = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
      templateId: template.id,
    });
    sessionId = session.id;
  });

  /*
    The promise every admin edit rests on: a session copies the form it starts with, so the form
    may be reworded, reordered or deleted afterwards and the session keeps asking what it asked.
  */
  it("copies the chosen form onto the session, and a later edit to the form changes nothing", async () => {
    const started = await asInstructor().coaching.session({
      programId: world.programId,
      sessionId,
    });
    expect(started.layout).toEqual(FIXTURE_LAYOUT);

    const loaded = await asAdmin().coachingTemplates.get({ id: template.id });
    await asAdmin().coachingTemplates.save({
      id: template.id,
      name: "Reworded",
      updatedAt: loaded.updatedAt,
      layout: {
        version: 1,
        sections: [{ id: "only", title: "Only", items: [] }],
      },
    });

    const after = await asInstructor().coaching.session({ programId: world.programId, sessionId });
    expect(after.layout).toEqual(FIXTURE_LAYOUT);

    // The form's name is copied too, and keeps the name of the day the session started.
    const record = await asInstructor().coaching.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(record.sessions.find((row) => row.id === sessionId)?.templateName).toBe(
      "The suite's form",
    );
  });

  it("stores an answer of each kind under its question's wording from the form", async () => {
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId,
      temperature: 7,
      answers: ANSWERS,
    });

    const stored = await tx().coachingSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { temperature: true, answers: true },
    });

    expect(stored.temperature).toBe(7);
    expect(stored.answers).toEqual([
      { promptId: "preparation", prompt: "Pre-session notes", answer: "Ask about Mod 2" },
      { promptId: "win", prompt: "One win this week", answer: "Shipped the API." },
      { promptId: "energy", prompt: "Energy", answer: 3 },
      { promptId: "focus", prompt: "Focus area", answer: "Mod 2" },
      { promptId: "supports", prompt: "Supports", answer: ["Pairing", "Office hours"] },
    ]);
  });

  it("refuses a question not on this session's form, a panel, and a value its question does not take", async () => {
    const attempt = (promptId: string, answer: string | number | boolean | string[]) =>
      refusal(() =>
        asInstructor().coaching.saveSession({
          programId: world.programId,
          sessionId,
          temperature: null,
          answers: [{ promptId, answer }],
        }),
      );

    expect(await attempt("no-such-prompt", "x")).toBe("BAD_REQUEST");
    expect(await attempt("goals-panel", "x")).toBe("BAD_REQUEST");
    expect(await attempt("energy", "3")).toBe("BAD_REQUEST");
    expect(await attempt("energy", 9)).toBe("BAD_REQUEST");
    expect(await attempt("focus", "Mod 3")).toBe("BAD_REQUEST");
    expect(await attempt("supports", ["Tutoring"])).toBe("BAD_REQUEST");

    // Nothing above was stored: the answers are as the previous test left them.
    const session = await asInstructor().coaching.session({
      programId: world.programId,
      sessionId,
    });
    expect(session.answers.map((answer) => answer.promptId)).toEqual([
      "preparation",
      "win",
      "energy",
      "focus",
      "supports",
    ]);
  });

  /*
    An old tab during a deploy names no form. It gets the default; and when several forms exist
    and none is the default there is no honest choice, so it is refused rather than guessed.
  */
  it("starts from the default form when none is named, and refuses when no form is the default", async () => {
    const other = await makeCoachingTemplate(tx(), {
      name: "The other form",
      layout: { version: 1, sections: [{ id: "other", title: "Other", items: [] }] },
    });
    await asAdmin().coachingTemplates.setDefault({ id: other.id });

    const started = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    const session = await asInstructor().coaching.session({
      programId: world.programId,
      sessionId: started.id,
    });
    expect(session.layout?.sections.map((section) => section.id)).toEqual(["other"]);

    await tx().coachingTemplate.updateMany({ data: { isDefault: false } });
    expect(
      await refusal(() =>
        asInstructor().coaching.startSession({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      ),
    ).toBe("BAD_REQUEST");

    expect(
      await refusal(() =>
        asInstructor().coaching.startSession({
          programId: world.programId,
          studentId: world.student.studentId,
          templateId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("is dated today until the instructor moves it, and the lists on both sides follow", async () => {
    const draft = await asInstructor().coaching.session({ programId: world.programId, sessionId });
    expect(draft.heldOn).toBe(schoolDayOf(new Date()));

    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId,
      temperature: 7,
      answers: ANSWERS,
      heldOn: "2031-03-14",
    });

    const moved = await asInstructor().coaching.session({ programId: world.programId, sessionId });
    expect(moved.heldOn).toBe("2031-03-14");

    const record = await asInstructor().coaching.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(record.sessions.find((row) => row.id === sessionId)?.heldOn).toBe("2031-03-14");

    expect(
      await refusal(() =>
        asInstructor().coaching.saveSession({
          programId: world.programId,
          sessionId,
          temperature: null,
          answers: [],
          heldOn: "2031-02-30",
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
    expect(Object.keys(mine.sessions[0]).sort()).toEqual([
      "endedAt",
      "heldOn",
      "id",
      "shared",
      "snapshot",
    ]);
    expect(mine).not.toHaveProperty("notes");
    expect(JSON.stringify(mine)).not.toContain("temperature");

    /*
      The shared questions and the coach's answers, in the form's order — and none of the
      staff-only ones, whose text must not appear anywhere in the payload.
    */
    expect(mine.sessions[0].shared.map(({ item, answer }) => [item.id, answer])).toEqual([
      ["win", "Shipped the API."],
      ["focus", "Mod 2"],
    ]);
    expect(JSON.stringify(mine)).not.toContain("Ask about Mod 2");
    expect(JSON.stringify(mine)).not.toContain("Pre-session notes");
    expect(JSON.stringify(mine)).not.toContain("Office hours");
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

  /*
    A goal set while the competency list lived in code holds a slug where a uuid now goes, and a
    goal whose entry an admin deleted holds an id naming no row. Neither stops the fellow rewording
    their own goal: what is not sent is not checked, and the stored id is left exactly as it was.
  */
  it("rewording a goal leaves an old or orphaned competency id untouched", async () => {
    await tx().goal.update({
      where: { id: goalId },
      data: { entryId: "growth-mindset/asks-for-help" },
    });

    const reworded = await asFellow().coaching.updateGoal({
      programId: world.programId,
      goalId,
      title: "Ask for help before the end of the hour.",
    });

    expect(reworded.title).toBe("Ask for help before the end of the hour.");
    expect(reworded.entryId).toBe("growth-mindset/asks-for-help");
    expect(reworded.entryText).toBe("Asks for help when stuck rather than struggling in silence.");

    await tx().goal.update({
      where: { id: goalId },
      data: { entryId: INDICATOR, title: "Ask for help within half an hour of being stuck." },
    });
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

    const started = await startSession(tx(), asInstructor(), world);
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
    const session = await startSession(tx(), asInstructor(), world);
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

/*
  ---- Preparing for a session -------------------------------------------------------------------

  The coach's own notes before the conversation are an answer like any other: stored under the
  `preparation` prompt id with the label copied in, staff-only by the same construction as the
  check-in.
*/
describe("preparing for a session", () => {
  const tx = withRollback();

  let world: World;
  let sessionId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asFellow = () => createCaller(tx(), world.student.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx());
    sessionId = (await startSession(tx(), asInstructor(), world)).id;
  });

  it("is stored among the answers with its label copied in, and reaches no fellow", async () => {
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId,
      temperature: null,
      answers: [{ promptId: "preparation", answer: "Late three mornings; ask about the commute." }],
    });

    const stored = await asInstructor().coaching.session({ programId: world.programId, sessionId });
    expect(stored.answers).toEqual([
      {
        promptId: "preparation",
        prompt: "Pre-session notes",
        answer: "Late three mornings; ask about the commute.",
      },
    ]);

    await asInstructor().coaching.completeSession({ programId: world.programId, sessionId });

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.sessions).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain("commute");
  });
});

/*
  ---- Topics, which are the fellow's ------------------------------------------------------------

  What a fellow wants to raise next time: theirs to add, rewrite and remove, with the goal's
  ownership exactly. An instructor reads them on the record and on a draft session, and nothing
  about a session changes them.
*/
describe("discussion topics, which are the fellow's", () => {
  const tx = withRollback();

  let world: World;
  let topicId: string;

  const asFellow = () => createCaller(tx(), world.student.studentId);
  const asOtherFellow = () => createCaller(tx(), world.students[1]!.studentId);
  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
  });

  it("the fellow adds one, and reads it back with the date it was added", async () => {
    const topic = await asFellow().coaching.addTopic({
      programId: world.programId,
      body: "How do I ask for a code review without feeling like a nuisance?",
    });
    topicId = topic.id;

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.topics.map((row) => row.id)).toEqual([topicId]);
    expect(mine.topics[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("a topic needs words", async () => {
    expect(
      await refusal(() =>
        asFellow().coaching.addTopic({ programId: world.programId, body: "   " }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("the instructor reads it on the record and on a draft, and not on a completed session", async () => {
    const record = await asInstructor().coaching.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(record.topics.map((row) => row.id)).toEqual([topicId]);

    const { id: sessionId } = await startSession(tx(), asInstructor(), world);
    const draft = await asInstructor().coaching.session({ programId: world.programId, sessionId });
    expect(draft.topics.map((row) => row.id)).toEqual([topicId]);

    await asInstructor().coaching.completeSession({ programId: world.programId, sessionId });
    const done = await asInstructor().coaching.session({ programId: world.programId, sessionId });
    expect(done.topics).toEqual([]);

    // Completing a session changes nothing about the list: the fellow removes a topic themselves.
    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.topics).toHaveLength(1);
  });

  it("another fellow finds nothing, and an instructor may not write one", async () => {
    expect(
      await refusal(() =>
        asOtherFellow().coaching.editTopic({ programId: world.programId, topicId, body: "no" }),
      ),
    ).toBe("NOT_FOUND");

    const theirs = await asOtherFellow().coaching.myGoals({ programId: world.programId });
    expect(theirs.topics).toEqual([]);

    expect(
      await refusal(() =>
        asInstructor().coaching.addTopic({ programId: world.programId, body: "Be on time." }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("the fellow rewrites and removes their own", async () => {
    const edited = await asFellow().coaching.editTopic({
      programId: world.programId,
      topicId,
      body: "How do I ask for a code review?",
    });
    expect(edited.body).toBe("How do I ask for a code review?");

    await asFellow().coaching.deleteTopic({ programId: world.programId, topicId });

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.topics).toEqual([]);
  });

  it("the database holds the cap too", async () => {
    await tx().$executeRaw`SAVEPOINT a_long_topic`;
    await expect(
      tx().$executeRaw`
        INSERT INTO coaching_topics (id, program_id, enrollment_id, body)
        VALUES (gen_random_uuid(), ${world.programId}::uuid, ${world.student.id}::uuid,
                ${"x".repeat(2001)})
      `,
    ).rejects.toThrow(/coaching_topics_body_length/);
    await tx().$executeRaw`ROLLBACK TO SAVEPOINT a_long_topic`;
  });
});

/*
  ---- The conversation under a goal ------------------------------------------------------------

  The one thing both sides write. The side is recorded from the guard's own answer, the words
  reach the other side at once, withdrawing is the author's alone, and none of it is audited.
*/
describe("the conversation under a goal", () => {
  const tx = withRollback();

  let world: World;
  let outsider: World;
  let adminId: string;
  let goalId: string;
  let instructorCommentId: string;

  const asFellow = () => createCaller(tx(), world.student.studentId);
  const asOtherFellow = () => createCaller(tx(), world.students[1]!.studentId);
  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asOutsider = () => createCaller(tx(), outsider.instructorId);
  const asAdmin = () => createCaller(tx(), adminId);

  const goalOf = <G extends { id: string }>(payload: { goals: G[] }) =>
    payload.goals.find((row) => row.id === goalId)!;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    outsider = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });

    const goal = await asFellow().coaching.setGoal({
      programId: world.programId,
      title: "Ask for help sooner.",
      entryId: null,
      successCriteria: "",
      objectives: "",
      actionPlan: "",
      marker: null,
    });
    goalId = goal.id;
  });

  it("an instructor writes under the goal, and the fellow reads it as a coach's", async () => {
    const posted = await asInstructor().coaching.postGoalComment({
      programId: world.programId,
      goalId,
      body: "Can you add a timeframe?",
    });
    instructorCommentId = posted.id;

    const goal = goalOf(await asFellow().coaching.myGoals({ programId: world.programId }));
    expect(goal.comments).toHaveLength(1);
    expect(goal.comments[0]).toMatchObject({
      id: instructorCommentId,
      authorRole: "INSTRUCTOR",
      body: "Can you add a timeframe?",
      withdrawn: false,
      mine: false,
    });
    expect(goal.comments[0]?.author).not.toBeNull();
    expect(goal.comments[0]).not.toHaveProperty("authorId");
  });

  it("the fellow replies, and the instructor reads it as the fellow's", async () => {
    await asFellow().coaching.postGoalComment({
      programId: world.programId,
      goalId,
      body: "By the end of the module.",
    });

    const goal = goalOf(
      await asInstructor().coaching.forStudent({
        programId: world.programId,
        studentId: world.student.studentId,
      }),
    );
    expect(goal.comments.map((row) => [row.authorRole, row.mine])).toEqual([
      ["INSTRUCTOR", true],
      ["STUDENT", false],
    ]);
  });

  it("an admin writes as staff", async () => {
    const posted = await asAdmin().coaching.postGoalComment({
      programId: world.programId,
      goalId,
      body: "Agreed.",
    });
    const stored = await tx().goalComment.findUniqueOrThrow({
      where: { id: posted.id },
      select: { authorRole: true },
    });
    expect(stored.authorRole).toBe("INSTRUCTOR");
  });

  it("an instructor of another program is refused; a fellow naming somebody else's goal finds nothing", async () => {
    expect(
      await refusal(() =>
        asOutsider().coaching.postGoalComment({ programId: world.programId, goalId, body: "x" }),
      ),
    ).toBe("FORBIDDEN");

    expect(
      await refusal(() =>
        asOtherFellow().coaching.postGoalComment({ programId: world.programId, goalId, body: "x" }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("a comment needs words", async () => {
    expect(
      await refusal(() =>
        asInstructor().coaching.postGoalComment({ programId: world.programId, goalId, body: " " }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("a removed fellow keeps reading the conversation, and stops writing in it", async () => {
    await tx().enrollment.update({
      where: { id: world.student.id },
      data: { status: "REMOVED" },
    });

    const goal = goalOf(await asFellow().coaching.myGoals({ programId: world.programId }));
    expect(goal.comments).toHaveLength(3);

    expect(
      await refusal(() =>
        asFellow().coaching.postGoalComment({
          programId: world.programId,
          goalId,
          body: "Still here.",
        }),
      ),
    ).toBe("FORBIDDEN");

    await tx().enrollment.update({
      where: { id: world.student.id },
      data: { status: "ACTIVE" },
    });
  });

  it("only the author withdraws, and a withdrawn comment keeps its place and loses its words", async () => {
    for (const caller of [asAdmin, asFellow]) {
      expect(
        await refusal(() =>
          caller().coaching.withdrawGoalComment({
            programId: world.programId,
            commentId: instructorCommentId,
          }),
        ),
      ).toBe("NOT_FOUND");
    }

    await asInstructor().coaching.withdrawGoalComment({
      programId: world.programId,
      commentId: instructorCommentId,
    });

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    const goal = goalOf(mine);
    expect(goal.comments).toHaveLength(3);
    expect(goal.comments[0]).toMatchObject({ id: instructorCommentId, withdrawn: true, body: "" });
    expect(JSON.stringify(mine)).not.toContain("timeframe");

    // Withdrawn is withdrawn: a second press finds nothing to withdraw.
    expect(
      await refusal(() =>
        asInstructor().coaching.withdrawGoalComment({
          programId: world.programId,
          commentId: instructorCommentId,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("none of it reaches the audit log", async () => {
    const events = await tx().auditEvent.findMany({
      where: {
        subjectId: world.student.studentId,
        action: {
          in: [
            "COACHING_NOTE_CREATED",
            "COACHING_NOTE_UPDATED",
            "COACHING_NOTE_DELETED",
            "COACHING_SESSION_COMPLETED",
            "COACHING_SESSION_DELETED",
            "GOAL_UPDATED",
            "GOAL_DELETED",
          ],
        },
      },
    });
    expect(events).toEqual([]);
  });

  it("deleting the goal takes the conversation with it", async () => {
    await asFellow().coaching.deleteGoal({ programId: world.programId, goalId });
    expect(await tx().goalComment.count({ where: { goalId } })).toBe(0);
  });

  it("the database holds the cap too", async () => {
    const goal = await asFellow().coaching.setGoal({
      programId: world.programId,
      title: "Another.",
      entryId: null,
      successCriteria: "",
      objectives: "",
      actionPlan: "",
      marker: null,
    });

    await tx().$executeRaw`SAVEPOINT a_long_comment`;
    await expect(
      tx().$executeRaw`
        INSERT INTO goal_comments (id, goal_id, author_id, author_role, body)
        VALUES (gen_random_uuid(), ${goal.id}::uuid, ${world.instructorId}::uuid,
                'INSTRUCTOR'::"GoalCommentAuthor", ${"x".repeat(5001)})
      `,
    ).rejects.toThrow(/goal_comments_body_length/);
    await tx().$executeRaw`ROLLBACK TO SAVEPOINT a_long_comment`;
  });
});

/*
  ---- What the fellow has not yet read ---------------------------------------------------------

  The receipt on a goal, and the count the sidebar draws from it: instructor comments newer than
  the receipt, never the fellow's own, never a withdrawn one, and the receipt moves forwards only.
*/
describe("what the fellow has not yet read under their goals", () => {
  const tx = withRollback();

  let world: World;
  let goalId: string;
  let first: string;
  let second: string;

  const asFellow = () => createCaller(tx(), world.student.studentId);
  const asInstructor = () => createCaller(tx(), world.instructorId);

  const post = async (caller: typeof asFellow, body: string) =>
    (await caller().coaching.postGoalComment({ programId: world.programId, goalId, body })).id;

  beforeAll(async () => {
    world = await makeWorld(tx());

    goalId = (
      await asFellow().coaching.setGoal({
        programId: world.programId,
        title: "Ask for help sooner.",
        entryId: null,
        successCriteria: "",
        objectives: "",
        actionPlan: "",
        marker: null,
      })
    ).id;

    first = await post(asInstructor, "One.");
    await post(asFellow, "Mine.");
    second = await post(asInstructor, "Two.");
  });

  it("counts every instructor comment until the fellow opens the goal, and never their own", async () => {
    expect(await asFellow().coaching.unreadGoalComments()).toEqual([
      { programId: world.programId, count: 2 },
    ]);
    expect(await asInstructor().coaching.unreadGoalComments()).toEqual([]);
  });

  it("reading as far as the newest clears the count, and the receipt only moves forwards", async () => {
    const marked = await asFellow().coaching.markGoalCommentsRead({
      programId: world.programId,
      goalId,
      upTo: second,
    });
    expect(await asFellow().coaching.unreadGoalComments()).toEqual([]);

    await asFellow().coaching.markGoalCommentsRead({
      programId: world.programId,
      goalId,
      upTo: first,
    });
    expect(await asFellow().coaching.unreadGoalComments()).toEqual([]);

    const mine = await asFellow().coaching.myGoals({ programId: world.programId });
    expect(mine.goals[0]?.commentsReadAt).toEqual(marked.readAt);
  });

  it("a newer comment counts again, and a withdrawn one does not", async () => {
    const third = await post(asInstructor, "Three.");
    expect(await asFellow().coaching.unreadGoalComments()).toEqual([
      { programId: world.programId, count: 1 },
    ]);

    await asInstructor().coaching.withdrawGoalComment({
      programId: world.programId,
      commentId: third,
    });
    expect(await asFellow().coaching.unreadGoalComments()).toEqual([]);
  });

  it("only the owner marks, and only with a comment on that goal", async () => {
    expect(
      await refusal(() =>
        asInstructor().coaching.markGoalCommentsRead({
          programId: world.programId,
          goalId,
          upTo: first,
        }),
      ),
    ).toBe("NOT_FOUND");

    expect(
      await refusal(() =>
        asFellow().coaching.markGoalCommentsRead({
          programId: world.programId,
          goalId,
          upTo: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("NOT_FOUND");
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

describe("the Coaching tab: every fellow's latest session and current goals", () => {
  const tx = withRollback();

  let world: World;
  let outsider: World;
  let olderGoalId: string;
  let newerGoalId: string;
  let freeGoalId: string;
  let midTerm: { id: string };

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asOutsider = () => createCaller(tx(), outsider.instructorId);
  const asFellow = () => createCaller(tx(), world.student.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    outsider = await makeWorld(tx());
    INDICATOR = await seedCompetency(tx());

    // An older completed session through a second form, which the tab reads only when asked to.
    midTerm = await makeCoachingTemplate(tx(), { name: "Mid-term" });
    const earlier = await asInstructor().coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
      templateId: midTerm.id,
    });
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId: earlier.id,
      temperature: 8,
      answers: [{ promptId: "challenging", answer: "Pointers." }],
    });
    await asInstructor().coaching.completeSession({
      programId: world.programId,
      sessionId: earlier.id,
    });

    // A completed session, then a draft opened afterwards with a different temperature.
    const completed = await startSession(tx(), asInstructor(), world);
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId: completed.id,
      temperature: 4,
      answers: [
        { promptId: "preparation", answer: "Ask about the project deadline." },
        { promptId: "challenging", answer: "Recursion." },
      ],
    });
    await asInstructor().coaching.completeSession({
      programId: world.programId,
      sessionId: completed.id,
    });

    const draft = await startSession(tx(), asInstructor(), world);
    await asInstructor().coaching.saveSession({
      programId: world.programId,
      sessionId: draft.id,
      temperature: 9,
      answers: [],
    });

    const goal = (title: string, entryId: string | null) =>
      asFellow().coaching.setGoal({
        programId: world.programId,
        title,
        entryId,
        successCriteria: "",
        objectives: "",
        actionPlan: "",
        marker: null,
      });
    olderGoalId = (await goal("Ask sooner.", INDICATOR)).id;
    newerGoalId = (await goal("Ask in the channel.", INDICATOR)).id;
    freeGoalId = (await goal("Sleep before ten.", null)).id;

    /*
      Times written by hand, because every row in this suite is written inside one transaction and
      the database's clock does not move within one.
    */
    await tx().goal.update({
      where: { id: olderGoalId },
      data: { createdAt: new Date("2026-09-01T12:00:00Z") },
    });
    await tx().goal.update({
      where: { id: newerGoalId },
      data: { createdAt: new Date("2026-09-10T12:00:00Z") },
    });
    const note = await asFellow().coaching.addUpdate({
      programId: world.programId,
      goalId: olderGoalId,
      body: "Asked twice this week.",
    });
    await tx().goalUpdate.update({
      where: { id: note.id },
      data: { createdAt: new Date("2026-09-20T12:00:00Z") },
    });
  });

  const overview = () =>
    asInstructor().coaching.overview({ programId: world.programId, cohort: "all" });

  it("reads the temperature from the latest completed session, never a draft", async () => {
    const data = await overview();
    const fellow = data.fellows.find((row) => row.student.id === world.student.studentId)!;

    expect(fellow.session).toMatchObject({ temperature: 4, daysSince: 0 });
  });

  /*
    The form marks two questions for the tab; both come back, headed, the unanswered one empty,
    and nothing else the session holds — the preparation answer stays on the session.
  */
  it("returns the answers the form marks for the tab, headed, and nothing else the session holds", async () => {
    const data = await overview();
    const fellow = data.fellows.find((row) => row.student.id === world.student.studentId)!;

    expect(fellow.session!.answers).toEqual([
      {
        id: "challenging",
        heading: "Challenging",
        prompt: "What has been challenging?",
        answer: "Recursion.",
      },
      { id: "focus", heading: "Focus", prompt: "Focus area", answer: "" },
    ]);
    expect(JSON.stringify(fellow)).not.toContain("project deadline");
  });

  /*
    Two forms were used. Without a choice the tab reads the newest session's form; asked for the
    other, it reads each fellow's latest session through that one, answers and all.
  */
  it("offers every form the sessions used, newest first, and reads one form at a time", async () => {
    const data = await overview();
    expect(data.forms.map((form) => form.name)).toEqual([
      expect.stringMatching(/^Form /),
      "Mid-term",
    ]);
    expect(data.form).toBe(data.forms[0]!.id);

    const chosen = await asInstructor().coaching.overview({
      programId: world.programId,
      cohort: "all",
      form: midTerm.id,
    });
    expect(chosen.form).toBe(midTerm.id);
    const fellow = chosen.fellows.find((row) => row.student.id === world.student.studentId)!;
    expect(fellow.session).toMatchObject({ temperature: 8 });
    expect(fellow.session!.answers.find((answer) => answer.id === "challenging")?.answer).toBe(
      "Pointers.",
    );
  });

  it("a fellow with no completed session is listed, with no session", async () => {
    const data = await overview();
    const other = data.fellows.find((row) => row.student.id === world.students[1]!.studentId)!;

    expect(other.session).toBeNull();
    expect(other.goals).toEqual([]);
  });

  it("a goal is last active when its newest progress note was posted", async () => {
    const data = await overview();
    const fellow = data.fellows.find((row) => row.student.id === world.student.studentId)!;
    const older = fellow.goals.find((goal) => goal.id === olderGoalId)!;
    const newer = fellow.goals.find((goal) => goal.id === newerGoalId)!;

    expect(new Date(older.activeAt).getTime()).toBe(Date.parse("2026-09-20T12:00:00Z"));
    expect(new Date(newer.activeAt).getTime()).toBe(Date.parse("2026-09-10T12:00:00Z"));
    expect(fellow.goals.some((goal) => goal.id === freeGoalId && goal.entryId === null)).toBe(true);
  });

  it("returns the competency groups this program's fellows are offered", async () => {
    const data = await overview();

    expect(data.groups.map((group) => group.name)).toContain("Durable Skills");
  });

  it("refuses an instructor of another program, and a fellow", async () => {
    expect(
      await refusal(() =>
        asOutsider().coaching.overview({ programId: world.programId, cohort: "all" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() =>
        asFellow().coaching.overview({ programId: world.programId, cohort: "all" }),
      ),
    ).toBe("FORBIDDEN");
  });
});
