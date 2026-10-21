/**
 * Themes, the AI summary on a fellow's record: who may generate, read, correct and delete one, what each generation
 * reads, and where it stops so the next one starts after it.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * **The model call is replaced with a double**, as in checks.test.ts: what is checked here is
 * everything around it — what the double is handed, what is stored, and who may see it. The
 * double is the module's own with only `generateCoachingSummary` swapped, so the router's
 * `instanceof CoachingSummaryError` still meets the real class.
 */
import {
  CoachingSummaryError,
  generateCoachingSummary,
  type CoachingSummaryResult,
} from "@/lib/coaching/summary";
import { parseCoveredThrough } from "@/lib/coaching/summary-inputs";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

jest.mock("../../lib/coaching/summary", () => ({
  ...jest.requireActual("../../lib/coaching/summary"),
  generateCoachingSummary: jest.fn(),
}));

const generate = generateCoachingSummary as jest.MockedFunction<typeof generateCoachingSummary>;

const factory = createCallerFactory(appRouter);
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

const RESULT: CoachingSummaryResult = {
  summary: {
    themes: [
      {
        status: "new",
        title: "Tests first",
        callout: "SUMMARY TEXT: tests came before code on Closures.",
        question: "What got in the way of Closures?",
        evidence: ["Feedback on Closures, 2026-02-10: tests came before code."],
        reasoning: "Two rounds in a row.",
      },
      {
        status: "new",
        title: "Late on Fridays",
        callout: "Two Friday arrivals after 9:30.",
        question: "What happens on Fridays?",
        evidence: ["Arrivals, 2026-02-06: 9:41."],
        reasoning: "Only Fridays.",
      },
    ],
  },
  usage: {
    promptTokens: 9_000,
    completionTokens: 700,
    cachedPromptTokens: 0,
    cacheWriteTokens: 1_200,
  },
  modelId: "claude-sonnet-5",
  provider: "claude:claude-sonnet-5:none",
  promptVersion: "test",
};

/** The themes as `generate` stores them: the model's, none yet edited. */
const STORED = RESULT.summary.themes.map((theme) => ({ ...theme, edited: false }));

/** A coach's version of a theme, as the edit form sends it. */
const CORRECTED = {
  status: "changed" as const,
  title: "Tests first, mostly",
  callout: "CORRECTED CALLOUT",
  question: "What made the difference?",
  evidence: ["Coach's note, 2026-02-11: wrote tests first when pairing."],
  reasoning: "The coach's reading.",
};

beforeEach(() => {
  generate.mockReset();
  generate.mockResolvedValue(RESULT);
});

/** The input the double was handed on its most recent call. */
const lastSent = () => generate.mock.calls.at(-1)![0];

/** A completed session, written directly so its day and completion time are the test's to choose. */
async function completedSession(
  tx: Tx,
  world: World,
  options: { endedAt: Date; temperature?: number | null; answer?: string },
) {
  return tx.coachingSession.create({
    data: {
      programId: world.programId,
      enrollmentId: world.student.id,
      heldOn: options.endedAt,
      temperature: options.temperature ?? null,
      answers: options.answer
        ? [{ promptId: "additional-notes", prompt: "Anything else?", answer: options.answer }]
        : [],
      endedAt: options.endedAt,
      snapshot: {
        version: 1,
        takenAt: options.endedAt.toISOString(),
        attendance: {
          eligible: 0,
          present: 0,
          late: 0,
          excused: 0,
          absent: 0,
          unrecorded: 0,
          rate: null,
        },
        courses: [],
      },
      authorId: world.instructorId,
    },
    select: { id: true },
  });
}

/** One released round of feedback, as an approved draft on a graded submission of its own. */
async function releasedRound(tx: Tx, world: World, options: { approvedAt: Date; text: string }) {
  const assignment = await makeAssignment(tx, {
    courseId: world.courseId,
    courseUnitId: world.unitId,
    title: `Assignment ${options.text}`,
  });
  const submission = await makeSubmission(tx, {
    assignmentId: assignment.id,
    studentId: world.student.studentId,
    graded: { score: 8, possible: 10, isComplete: true },
  });
  await tx.gradingDraft.create({
    data: {
      submissionId: submission.id,
      status: "APPROVED",
      approvedAt: options.approvedAt,
      approvedById: world.instructorId,
      sections: {
        create: [
          {
            sectionType: "Overall",
            reportMarkdown: options.text,
            scoreEarned: 8,
            scorePossible: 10,
          },
        ],
      },
    },
    select: { id: true },
  });
}

describe("who may use a fellow's themes", () => {
  const tx = withRollback();
  let world: World;
  let outsider: World;
  let summaryId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    outsider = await makeWorld(tx());
    // `beforeAll` runs before the first `beforeEach`, so the double is given its answer here too.
    generate.mockResolvedValue(RESULT);
    const created = await createCaller(tx(), world.instructorId).coachingSummaries.generate({
      programId: world.programId,
      studentId: world.student.studentId,
      inputs: ["figures"],
    });
    summaryId = created.id;
  });

  it("refuses an instructor of another program every procedure", async () => {
    const outside = createCaller(tx(), outsider.instructorId);
    const calls = [
      () =>
        outside.coachingSummaries.forStudent({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      () =>
        outside.coachingSummaries.generate({
          programId: world.programId,
          studentId: world.student.studentId,
          inputs: ["figures"],
        }),
      () =>
        outside.coachingSummaries.editTheme({
          programId: world.programId,
          summaryId,
          index: 0,
          theme: CORRECTED,
        }),
      () =>
        outside.coachingSummaries.removeTheme({ programId: world.programId, summaryId, index: 0 }),
      () => outside.coachingSummaries.remove({ programId: world.programId, summaryId }),
    ];
    for (const call of calls) expect(await refusal(call)).toBe("FORBIDDEN");

    // Naming their own program does not reach a row of this one.
    expect(
      await refusal(() =>
        outside.coachingSummaries.editTheme({
          programId: outsider.programId,
          summaryId,
          index: 0,
          theme: CORRECTED,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await refusal(() =>
        outside.coachingSummaries.remove({ programId: outsider.programId, summaryId }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses the fellow every procedure, their own summary included", async () => {
    const fellow = createCaller(tx(), world.student.studentId);
    const calls = [
      () =>
        fellow.coachingSummaries.forStudent({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      () =>
        fellow.coachingSummaries.generate({
          programId: world.programId,
          studentId: world.student.studentId,
          inputs: ["figures"],
        }),
      () =>
        fellow.coachingSummaries.editTheme({
          programId: world.programId,
          summaryId,
          index: 0,
          theme: CORRECTED,
        }),
      () =>
        fellow.coachingSummaries.removeTheme({ programId: world.programId, summaryId, index: 0 }),
      () => fellow.coachingSummaries.remove({ programId: world.programId, summaryId }),
    ];
    for (const call of calls) expect(await refusal(call)).toBe("FORBIDDEN");
  });

  it("shows the fellow none of it, on their goals page or in a session's snapshot", async () => {
    await completedSession(tx(), world, { endedAt: new Date("2026-03-01T15:00:00Z") });
    const mine = await createCaller(tx(), world.student.studentId).coaching.myGoals({
      programId: world.programId,
    });
    const payload = JSON.stringify(mine);
    expect(payload).not.toContain("SUMMARY TEXT");
    expect(payload).not.toContain("Tests first");
  });
});

describe("generating a summary", () => {
  const tx = withRollback();
  let world: World;

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const generateWith = (
    inputs: ("figures" | "writing" | "sessions" | "notes" | "feedback")[],
    focus?: string,
  ) =>
    asInstructor().coachingSummaries.generate({
      programId: world.programId,
      studentId: world.student.studentId,
      inputs,
      focus,
    });

  beforeAll(async () => {
    world = await makeWorld(tx());
  });

  it("refuses when there is nothing to read and no summary yet, before anything is recorded", async () => {
    expect(await refusal(() => generateWith(["notes", "feedback", "sessions"]))).toBe(
      "PRECONDITION_FAILED",
    );
    expect(generate).not.toHaveBeenCalled();
    expect(await tx().auditEvent.count({ where: { action: "COACHING_SUMMARY_GENERATED" } })).toBe(
      0,
    );
  });

  it("stores the themes, inputs, focus, watermark and metadata, and audits no text", async () => {
    await releasedRound(tx(), world, {
      approvedAt: new Date("2026-02-10T12:00:00Z"),
      text: "FIRST ROUND",
    });
    await completedSession(tx(), world, {
      endedAt: new Date("2026-02-12T15:00:00Z"),
      temperature: 7,
      answer: "FIRST SESSION ANSWER",
    });
    await asInstructor().coaching.addNote({
      programId: world.programId,
      studentId: world.student.studentId,
      body: "FIRST NOTE",
    });

    // Chosen in an order of the caller's own; stored in the checkboxes' order.
    await generateWith(["feedback", "figures", "writing", "sessions", "notes"], "  Goals first.  ");

    const sent = lastSent();
    expect(sent.previous).toBeNull();
    expect(sent.focus).toBe("Goals first.");
    expect(sent.feedback!.rounds.map((round) => round.sections[0]!.text)).toEqual(["FIRST ROUND"]);
    expect(sent.sessions!.items[0]!.answers).toEqual([
      { prompt: "Anything else?", answer: "FIRST SESSION ANSWER" },
    ]);
    expect(sent.notes!.map((note) => note.body)).toEqual(["FIRST NOTE"]);
    expect(sent.standing!.sessions).toEqual([{ heldOn: "2026-02-12", temperature: 7 }]);

    const row = await tx().coachingSummary.findFirstOrThrow({
      where: { enrollmentId: world.student.id },
      select: {
        themes: true,
        inputs: true,
        focus: true,
        coveredThrough: true,
        modelMetadata: true,
        authorId: true,
      },
    });
    expect(row.themes).toEqual(STORED);
    expect(row.inputs).toEqual(["figures", "writing", "sessions", "notes", "feedback"]);
    expect(row.focus).toBe("Goals first.");
    expect(row.authorId).toBe(world.instructorId);
    const covered = parseCoveredThrough(row.coveredThrough);
    expect(covered.feedbackAt).toBe("2026-02-10T12:00:00.000Z");
    expect(covered.sessionsAt).toBe("2026-02-12T15:00:00.000Z");
    expect(covered.notesAt).not.toBeNull();
    expect(covered.roundsRead).toBe(1);
    expect(row.modelMetadata).toEqual({
      provider: "claude:claude-sonnet-5:none",
      modelId: "claude-sonnet-5",
      promptVersion: "test",
      usage: RESULT.usage,
      sectionsGraded: ["coaching_summary"],
    });

    const events = await tx().auditEvent.findMany({
      where: { action: "COACHING_SUMMARY_GENERATED" },
      select: { actorId: true, subjectId: true, programId: true, detail: true },
    });
    expect(events).toEqual([
      {
        actorId: world.instructorId,
        subjectId: world.student.studentId,
        programId: world.programId,
        detail: {
          inputs: ["figures", "writing", "sessions", "notes", "feedback"],
          roundsRead: 1,
          roundsSkipped: 0,
          sessionsSkipped: 0,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("SUMMARY TEXT");
  });

  it("reads the previous summary as the coach left it, then only what is new since it", async () => {
    const forStudent = () =>
      asInstructor().coachingSummaries.forStudent({
        programId: world.programId,
        studentId: world.student.studentId,
      });
    const { current } = await forStudent();

    // The coach corrects the first theme and drops the second.
    await asInstructor().coachingSummaries.editTheme({
      programId: world.programId,
      summaryId: current!.id,
      index: 0,
      theme: CORRECTED,
    });
    await asInstructor().coachingSummaries.removeTheme({
      programId: world.programId,
      summaryId: current!.id,
      index: 1,
    });

    await releasedRound(tx(), world, {
      approvedAt: new Date("2026-03-10T12:00:00Z"),
      text: "SECOND ROUND",
    });
    await completedSession(tx(), world, {
      endedAt: new Date("2026-03-12T15:00:00Z"),
      temperature: 4,
      answer: "SECOND SESSION ANSWER",
    });
    await asInstructor().coaching.addNote({
      programId: world.programId,
      studentId: world.student.studentId,
      body: "SECOND NOTE",
    });

    await generateWith(["figures", "sessions", "notes", "feedback"]);

    const sent = lastSent();
    expect(sent.previous!.themes).toEqual([{ ...CORRECTED, edited: true }]);
    expect(sent.feedback!.rounds.map((round) => round.sections[0]!.text)).toEqual(["SECOND ROUND"]);
    expect(sent.sessions!.items.flatMap((s) => s.answers.map((a) => a.answer))).toEqual([
      "SECOND SESSION ANSWER",
    ]);
    expect(sent.notes!.map((note) => note.body)).toEqual(["SECOND NOTE"]);
    // Standing is read whole, so every session's temperature is there, newest first.
    expect(sent.standing!.sessions.map((s) => s.temperature)).toEqual([4, 7]);

    // The new row is current, and the corrected one is listed among the earlier ones.
    const after = await forStudent();
    expect(after.current!.id).not.toBe(current!.id);
    expect(after.earlier.map((row) => row.themes)).toEqual([[{ ...CORRECTED, edited: true }]]);
  });

  it("reads a note again in its edited form, and keeps a watermark a generation did not choose", async () => {
    const note = await tx().instructorNote.findFirstOrThrow({
      where: { enrollmentId: world.student.id, body: "FIRST NOTE" },
      select: { id: true },
    });
    await asInstructor().coaching.updateNote({
      programId: world.programId,
      noteId: note.id,
      body: "FIRST NOTE, CORRECTED",
    });

    const before = parseCoveredThrough(
      (
        await tx().coachingSummary.findFirstOrThrow({
          where: { enrollmentId: world.student.id },
          orderBy: { createdAt: "desc" },
          select: { coveredThrough: true },
        })
      ).coveredThrough,
    );

    // Notes not chosen: the watermark stays, so the edited note is still unread afterwards.
    await generateWith(["figures"]);
    expect(lastSent().notes).toBeNull();
    const skipped = await tx().coachingSummary.findFirstOrThrow({
      where: { enrollmentId: world.student.id },
      orderBy: { createdAt: "desc" },
      select: { coveredThrough: true },
    });
    expect(parseCoveredThrough(skipped.coveredThrough).notesAt).toBe(before.notesAt);

    await generateWith(["notes"]);
    expect(lastSent().notes!.map((n) => n.body)).toEqual(["FIRST NOTE, CORRECTED"]);
  });

  it("reads the ten newest rounds and five newest sessions, and counts the rest", async () => {
    for (let day = 1; day <= 11; day += 1) {
      await releasedRound(tx(), world, {
        approvedAt: new Date(`2026-04-${String(day).padStart(2, "0")}T12:00:00Z`),
        text: `APRIL ROUND ${day}`,
      });
    }
    // A hand-graded submission, with no draft, is a round too.
    const handGraded = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Hand graded",
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: handGraded.id,
      studentId: world.student.studentId,
      graded: { score: 9, possible: 10, isComplete: true },
    });
    await tx().submission.update({
      where: { id: submission.id },
      data: { gradedAt: new Date("2026-04-20T12:00:00Z"), feedbackMarkdown: "HAND GRADED" },
      select: { id: true },
    });
    for (let day = 1; day <= 7; day += 1) {
      await completedSession(tx(), world, {
        endedAt: new Date(`2026-04-${String(day).padStart(2, "0")}T15:00:00Z`),
        answer: `APRIL SESSION ${day}`,
      });
    }

    await generateWith(["sessions", "feedback"]);

    const sent = lastSent();
    expect(sent.feedback!.rounds).toHaveLength(10);
    expect(sent.feedback!.skipped).toBe(2);
    expect(sent.feedback!.rounds.at(-1)!.sections[0]!.text).toBe("HAND GRADED");
    expect(sent.feedback!.rounds[0]!.sections[0]!.text).toBe("APRIL ROUND 3");
    expect(sent.sessions!.items).toHaveLength(5);
    expect(sent.sessions!.skipped).toBe(2);
    expect(sent.sessions!.items.map((s) => s.answers[0]!.answer)).toEqual([
      "APRIL SESSION 3",
      "APRIL SESSION 4",
      "APRIL SESSION 5",
      "APRIL SESSION 6",
      "APRIL SESSION 7",
    ]);

    const { current } = await asInstructor().coachingSummaries.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(current!.coveredThrough).toMatchObject({
      roundsRead: 10,
      roundsSkipped: 2,
      sessionsSkipped: 2,
      feedbackAt: "2026-04-20T12:00:00.000Z",
    });
  });

  it("stores nothing when the call fails, and says why", async () => {
    const before = await tx().coachingSummary.count({ where: { enrollmentId: world.student.id } });
    generate.mockRejectedValueOnce(new CoachingSummaryError("Could not reach the Claude API."));

    await expect(generateWith(["figures"])).rejects.toThrow("Could not reach the Claude API.");
    expect(await tx().coachingSummary.count({ where: { enrollmentId: world.student.id } })).toBe(
      before,
    );
  });

  it("refuses the twenty-first generation in an hour", async () => {
    const already = await tx().auditEvent.count({
      where: { action: "COACHING_SUMMARY_GENERATED", actorId: world.instructorId },
    });
    await tx().auditEvent.createMany({
      data: Array.from({ length: 20 - already }, () => ({
        action: "COACHING_SUMMARY_GENERATED" as const,
        actorId: world.instructorId,
        actorLabel: "instructor",
      })),
    });

    expect(await refusal(() => generateWith(["figures"]))).toBe("TOO_MANY_REQUESTS");
  });
});

describe("correcting and deleting a summary", () => {
  const tx = withRollback();
  let world: World;
  let olderId: string;
  let newerId: string;

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx());
    generate.mockResolvedValue(RESULT);
    const older = await asInstructor().coachingSummaries.generate({
      programId: world.programId,
      studentId: world.student.studentId,
      inputs: ["figures"],
    });
    const newer = await asInstructor().coachingSummaries.generate({
      programId: world.programId,
      studentId: world.student.studentId,
      inputs: ["figures"],
    });
    olderId = older.id;
    newerId = newer.id;
  });

  it("refuses to edit or remove a theme from anything but the current summary", async () => {
    expect(
      await refusal(() =>
        asInstructor().coachingSummaries.editTheme({
          programId: world.programId,
          summaryId: olderId,
          index: 0,
          theme: CORRECTED,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await refusal(() =>
        asInstructor().coachingSummaries.removeTheme({
          programId: world.programId,
          summaryId: olderId,
          index: 0,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("edits a theme on the current summary, marks it edited, and audits the act without its words", async () => {
    await asInstructor().coachingSummaries.editTheme({
      programId: world.programId,
      summaryId: newerId,
      index: 1,
      theme: CORRECTED,
    });
    await asInstructor().coachingSummaries.removeTheme({
      programId: world.programId,
      summaryId: newerId,
      index: 0,
    });

    const row = await tx().coachingSummary.findUniqueOrThrow({
      where: { id: newerId },
      select: { themes: true, editedAt: true },
    });
    expect(row.themes).toEqual([{ ...CORRECTED, edited: true }]);
    expect(row.editedAt).not.toBeNull();

    const events = await tx().auditEvent.findMany({
      where: { action: "COACHING_SUMMARY_EDITED" },
      orderBy: { occurredAt: "asc" },
      select: { detail: true },
    });
    expect(events.map((event) => event.detail)).toEqual([
      { summaryId: newerId, change: "theme-edited" },
      { summaryId: newerId, change: "theme-removed" },
    ]);
  });

  it("refuses a theme that is no longer there", async () => {
    expect(
      await refusal(() =>
        asInstructor().coachingSummaries.removeTheme({
          programId: world.programId,
          summaryId: newerId,
          index: 5,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("deleting the current summary makes the one before it current", async () => {
    await asInstructor().coachingSummaries.remove({
      programId: world.programId,
      summaryId: newerId,
    });

    const { current, earlier } = await asInstructor().coachingSummaries.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(current!.id).toBe(olderId);
    expect(earlier).toEqual([]);
    expect(
      await tx().auditEvent.count({
        where: { action: "COACHING_SUMMARY_DELETED", subjectId: world.student.studentId },
      }),
    ).toBe(1);

    // And the next generation reads from it.
    await asInstructor().coachingSummaries.generate({
      programId: world.programId,
      studentId: world.student.studentId,
      inputs: ["figures"],
    });
    expect(lastSent().previous!.themes).toEqual(STORED);
  });
});
