/**
 * The Tutor: a conversation about a course's lessons or about one of its assignments, kept under
 * the asker, read on the fellow's record.
 *
 * Run with `npm run test:integration`.
 *
 * Claude is replaced with a function that records what it was asked and answers a fixed sentence,
 * so each case names what the Tutor was told and what was stored, and the rows, the scope checks,
 * the limit and the retrieval run against the real database.
 */
import { askTutor, TutorError } from "@/lib/tutor/ask";
import { ASK_LIMIT } from "@/lib/tutor/limits";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import {
  addInstructor,
  makeAccount,
  makeAssignment,
  makeProgram,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

jest.mock("../../lib/tutor/ask", () => ({
  ...jest.requireActual("../../lib/tutor/ask"),
  askTutor: jest.fn(),
}));

const ask = askTutor as jest.MockedFunction<typeof askTutor>;

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string, viewingReadOnly = false) =>
  factory({
    db: tx,
    user: { id: userId },
    viewingAs: viewingReadOnly
      ? { readOnly: true, student: { displayName: "Viewed" }, viewer: { displayName: "Viewer" } }
      : undefined,
  } as never);

type Asked = ReturnType<ReturnType<typeof createCaller>["tutor"]["ask"]>;

/**
 * Reads an answer's stream to its end, as the browser does, and returns the two stored turns.
 * Nothing in `tutor.ask` runs until its stream is read, refusals included.
 */
async function drain(asked: Asked) {
  for await (const chunk of await asked) {
    if (chunk.type === "done") return { turns: chunk.turns };
  }
  throw new Error("The stream ended without the stored turns.");
}

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/** Claude answers this, whatever it is asked. */
const ANSWER = {
  content: "Maria, see 1.6 Loops › For Loops.",
  usage: { promptTokens: 100, completionTokens: 20, cachedPromptTokens: 80, cacheWriteTokens: 0 },
  modelId: "claude-sonnet-5-5",
  provider: "claude:claude-sonnet-5-5:none",
  promptVersion: "test",
};

/** A curriculum of two lessons with the sections search reads, written directly. */
async function makeCurriculum(tx: Tx, name: string) {
  const curriculum = await tx.curriculum.create({
    data: { name, repo: `The-Marcy-Lab-School/${name.toLowerCase()}` },
  });
  const lesson = (position: number, slug: string, title: string, body: string) => ({
    curriculumId: curriculum.id,
    slug,
    path: `${slug}.md`,
    title,
    moduleSlug: "mod-1",
    moduleTitle: "1. Python Fundamentals",
    position,
    body,
    blobSha: "blob",
    commitSha: "c0ffee",
    syncedAt: new Date(),
  });
  await tx.lesson.create({ data: lesson(0, "mod-1", "1. Python Fundamentals", "# 1. Python") });
  await tx.lesson.create({
    data: {
      ...lesson(1, "mod-1/6-loops", "1.6 Loops", "# 1.6 Loops\n\nA loop repeats a block."),
      sections: {
        create: [
          {
            position: 0,
            heading: "For Loops",
            anchor: "for-loops",
            text: "A for loop runs its block once for each item in a list.",
            code: "for item in items:\n    print(item)",
          },
          {
            position: 1,
            heading: "Dictionaries",
            anchor: "dictionaries",
            text: "A dictionary maps keys to values.",
            code: 'task["done"] = True',
          },
        ],
      },
    },
  });
  return curriculum;
}

describe("asking the Tutor", () => {
  const tx = withRollback();
  let world: World;
  let courseName: string;
  let assignmentId: string;
  let unpublishedId: string;
  let outsider: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2, published: true });
    const software = await makeCurriculum(tx(), "Software");
    const course = await tx().course.update({
      where: { id: world.courseId },
      data: { curriculumId: software.id },
      select: { name: true },
    });
    courseName = course.name;
    await tx().profile.update({
      where: { id: world.student.studentId },
      data: { displayName: "Maria Lopez" },
    });

    assignmentId = (
      await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        title: "Task Manager",
      })
    ).id;
    unpublishedId = (
      await makeAssignment(tx(), {
        courseId: world.courseId,
        courseUnitId: world.unitId,
        published: false,
      })
    ).id;

    outsider = await makeAccount(tx(), { role: "INSTRUCTOR" });
    const otherProgram = await makeProgram(tx());
    await addInstructor(tx(), { programId: otherProgram.id, userId: outsider });
  });

  beforeEach(() => {
    ask.mockReset();
    ask.mockResolvedValue(ANSWER);
  });

  it("tells Claude the course, the outline and the matching sections, hides the fellow's name, and stores both turns with it back", async () => {
    const caller = createCaller(tx(), world.student.studentId);
    const result = await drain(
      caller.tutor.ask({
        courseId: world.courseId,
        scope: {},
        message: "Hi, I'm Maria Lopez. How do I go through each item in a list?",
      }),
    );

    expect(ask).toHaveBeenCalledTimes(1);
    const input = ask.mock.calls[0][0];
    expect(input.scope).toBe("course");
    expect(input.material).toContain(`"${courseName}"`);
    expect(input.outline).toBe("- 1. Python Fundamentals\n  - 1.6 Loops");
    // "item" and "list" match the loops section; nothing in the question names dictionaries.
    expect(input.sections).toContain("### 1. Python Fundamentals › 1.6 Loops › For Loops");
    expect(input.sections).not.toContain("Dictionaries");
    expect(input.history).toEqual([]);
    expect(input.question).toBe("Hi, I'm the fellow. How do I go through each item in a list?");

    expect(result.turns.map((turn) => [turn.role, turn.content])).toEqual([
      ["USER", "Hi, I'm Maria Lopez. How do I go through each item in a list?"],
      ["TUTOR", "Maria, see 1.6 Loops › For Loops."],
    ]);
    expect(result.turns[1].sources).toEqual([
      { slug: "mod-1/6-loops", anchor: "for-loops", heading: "For Loops", title: "1.6 Loops" },
    ]);

    const stored = await tx().tutorMessage.findMany({
      where: { profileId: world.student.studentId },
      orderBy: { createdAt: "asc" },
    });
    expect(stored.map((row) => row.role)).toEqual(["USER", "TUTOR"]);
    expect(stored[1].modelMetadata).toEqual({
      provider: ANSWER.provider,
      modelId: ANSWER.modelId,
      promptVersion: "test",
      usage: ANSWER.usage,
      sectionsGraded: ["tutor"],
    });
  });

  it("streams the answer's text as Claude writes it, before the stored turns", async () => {
    ask.mockImplementation(async (_input, onText) => {
      onText?.("Maria, see ");
      onText?.("1.6 Loops › For Loops.");
      return ANSWER;
    });
    // Asked by the instructor, whose conversation no other case counts.
    const caller = createCaller(tx(), world.instructorId);
    const chunks = [];
    for await (const chunk of await caller.tutor.ask({
      courseId: world.courseId,
      scope: {},
      message: "Which lesson covers loops?",
    })) {
      chunks.push(chunk);
    }
    expect(chunks.map((chunk) => chunk.type)).toEqual(["text", "done"]);
    expect(chunks[0].text).toBe("Maria, see 1.6 Loops › For Loops.");
    expect(chunks[1].turns?.map((turn) => turn.role)).toEqual(["USER", "TUTOR"]);
  });

  it("shows Claude the conversation so far, and the history to the asker alone", async () => {
    const caller = createCaller(tx(), world.student.studentId);
    await drain(
      caller.tutor.ask({ courseId: world.courseId, scope: {}, message: "And a while loop?" }),
    );

    const input = ask.mock.calls[0][0];
    expect(input.history.map((turn) => turn.role)).toEqual(["USER", "TUTOR"]);
    expect(input.history[0].content).toBe(
      "Hi, I'm the fellow. How do I go through each item in a list?",
    );

    const history = await caller.tutor.history({ courseId: world.courseId, scope: {} });
    expect(history.turns.map((turn) => turn.role)).toEqual(["USER", "TUTOR", "USER", "TUTOR"]);

    const other = createCaller(tx(), world.students[1].studentId);
    const theirs = await other.tutor.history({ courseId: world.courseId, scope: {} });
    expect(theirs.turns).toEqual([]);
  });

  it("keeps an assignment's conversation apart, with the assignment as the material", async () => {
    const caller = createCaller(tx(), world.student.studentId);
    await drain(
      caller.tutor.ask({
        courseId: world.courseId,
        scope: { assignmentId },
        message: "What is this assignment asking for?",
      }),
    );

    const input = ask.mock.calls[0][0];
    expect(input.scope).toBe("assignment");
    expect(input.material).toContain("# Task Manager");
    expect(input.history).toEqual([]);

    const history = await caller.tutor.history({
      courseId: world.courseId,
      scope: { assignmentId },
    });
    expect(history.turns).toHaveLength(2);
  });

  it("carries the previous answer's sections to a question that matches nothing, and finds the loops for a code word", async () => {
    const caller = createCaller(tx(), world.student.studentId);
    // "what are these" matches no section; the loops come from the answer before it.
    const result = await drain(
      caller.tutor.ask({
        courseId: world.courseId,
        scope: {},
        message: "what are these",
      }),
    );
    expect(ask.mock.calls[0][0].sections).toContain(
      "### 1. Python Fundamentals › 1.6 Loops › For Loops",
    );
    expect(result.turns[1].sources).toEqual([
      { slug: "mod-1/6-loops", anchor: "for-loops", heading: "For Loops", title: "1.6 Loops" },
    ]);

    // A conversation whose last answer had no sections carries nothing.
    const other = createCaller(tx(), world.students[1].studentId);
    await drain(
      other.tutor.ask({ courseId: world.courseId, scope: {}, message: "what are these" }),
    );
    expect(ask.mock.calls[1][0].sections).toBe("");
    ask.mockClear();

    // `for` is dropped by English rules and found in the section's code instead.
    const loops = await drain(
      caller.tutor.ask({
        courseId: world.courseId,
        scope: {},
        message: "what is for",
      }),
    );
    expect(loops.turns[1].sources).toEqual([
      { slug: "mod-1/6-loops", anchor: "for-loops", heading: "For Loops", title: "1.6 Loops" },
    ]);
  });

  it("refuses an assignment a fellow has not been given, and an outsider", async () => {
    const fellow = createCaller(tx(), world.student.studentId);
    expect(
      await refusal(() =>
        drain(
          fellow.tutor.ask({
            courseId: world.courseId,
            scope: { assignmentId: unpublishedId },
            message: "Hello?",
          }),
        ),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await refusal(() =>
        drain(
          createCaller(tx(), outsider).tutor.ask({
            courseId: world.courseId,
            scope: {},
            message: "Hello?",
          }),
        ),
      ),
    ).toBe("FORBIDDEN");
    expect(ask).not.toHaveBeenCalled();
  });

  it("refuses to ask under a read-only view, and still shows the fellow's conversation", async () => {
    const viewing = createCaller(tx(), world.student.studentId, true);
    expect(
      await refusal(() =>
        drain(viewing.tutor.ask({ courseId: world.courseId, scope: {}, message: "Hello?" })),
      ),
    ).toBe("FORBIDDEN");
    const history = await viewing.tutor.history({ courseId: world.courseId, scope: {} });
    expect(history.turns.length).toBeGreaterThan(0);
  });

  it("writes nothing when Claude does not answer", async () => {
    ask.mockRejectedValue(new TutorError("Could not reach the Claude API."));
    const before = await tx().tutorMessage.count({ where: { profileId: world.student.studentId } });
    expect(
      await refusal(() =>
        drain(
          createCaller(tx(), world.student.studentId).tutor.ask({
            courseId: world.courseId,
            scope: {},
            message: "Hello?",
          }),
        ),
      ),
    ).toBe("INTERNAL_SERVER_ERROR");
    expect(await tx().tutorMessage.count({ where: { profileId: world.student.studentId } })).toBe(
      before,
    );
  });

  it("lets a fellow taken off the roster read their conversation and ask nothing more", async () => {
    const removed = world.students[1];
    await tx().enrollment.update({ where: { id: removed.id }, data: { status: "REMOVED" } });
    const caller = createCaller(tx(), removed.studentId);
    expect(
      await refusal(() =>
        drain(caller.tutor.ask({ courseId: world.courseId, scope: {}, message: "Still here?" })),
      ),
    ).toBe("FORBIDDEN");
    expect(await refusal(() => caller.tutor.history({ courseId: world.courseId, scope: {} }))).toBe(
      "accepted",
    );
    await tx().enrollment.update({ where: { id: removed.id }, data: { status: "ACTIVE" } });
  });

  it("refuses past the hourly limit", async () => {
    const fellow = world.students[1].studentId;
    await tx().tutorMessage.createMany({
      data: Array.from({ length: ASK_LIMIT.max }, () => ({
        profileId: fellow,
        courseId: world.courseId,
        role: "USER" as const,
        content: "Again?",
      })),
    });
    expect(
      await refusal(() =>
        drain(
          createCaller(tx(), fellow).tutor.ask({
            courseId: world.courseId,
            scope: {},
            message: "Once more.",
          }),
        ),
      ),
    ).toBe("TOO_MANY_REQUESTS");
    expect(ask).not.toHaveBeenCalled();
  });

  it("lists a fellow's conversations on their record, newest first, and never an instructor's own", async () => {
    await drain(
      createCaller(tx(), world.instructorId).tutor.ask({
        courseId: world.courseId,
        scope: {},
        message: "What does this tell fellows?",
      }),
    );

    const transcripts = await createCaller(tx(), world.instructorId).tutor.transcripts({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(transcripts.map((conversation) => [conversation.kind, conversation.title])).toEqual([
      ["course", courseName],
      ["assignment", "Task Manager"],
    ]);
    expect(transcripts[0].turns).toHaveLength(8);
    expect(transcripts[1].turns[0].content).toBe("What is this assignment asking for?");
    for (const conversation of transcripts) {
      for (const turn of conversation.turns) {
        expect(turn.content).not.toBe("What does this tell fellows?");
      }
    }

    expect(
      await refusal(() =>
        createCaller(tx(), outsider).tutor.transcripts({
          programId: world.programId,
          studentId: world.student.studentId,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() =>
        createCaller(tx(), world.instructorId).tutor.transcripts({
          programId: world.programId,
          studentId: outsider,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});
