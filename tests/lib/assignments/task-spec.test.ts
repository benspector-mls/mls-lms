import {
  assignmentPointValue,
  assignmentSpecSchema,
  handInMethodsFor,
  hasAcceptStep,
  IMPLEMENTED_KINDS,
  parseAssignmentSpec,
  requiresRepository,
  TASK_POINT_VALUE,
} from "@/lib/assignments/spec";

/**
 * What a task is, as the schema enforces it.
 *
 * The kind exists to say that some coursework has nothing to hand in, and almost every case here
 * is about something a task may *not* carry. That matters more than usual because the fields are
 * all optional-looking: an assignment that quietly kept a gradable section would validate, save,
 * and then offer an instructor a report to write against work that does not exist.
 */

const UNIT = "22222222-2222-4222-8222-222222222222";

const task = (over: Record<string, unknown> = {}) => ({
  kind: "TASK" as const,
  title: "Set up your laptop",
  courseUnitId: UNIT,
  sections: [],
  ...over,
});

describe("a task's shape", () => {
  it("is a kind this application can distribute, collect, and grade", () => {
    expect(IMPLEMENTED_KINDS.has("TASK")).toBe(true);
  });

  it("accepts a task with nothing but a title, a unit, and no sections", () => {
    const parsed = assignmentSpecSchema.safeParse(task());
    expect(parsed.success).toBe(true);
  });

  it("accepts a due date, instructions, and a team set", () => {
    // The four fields a task shares with every other kind. A team task is the case that makes
    // `teamSetId` worth having here: one member marks it for everybody.
    const parsed = assignmentSpecSchema.safeParse(
      task({
        dueAt: new Date("2026-03-10T23:59:00Z"),
        submissionInstructions: "Install Node, then mark this done.",
        teamSetId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("refuses a gradable section", () => {
    /*
      The important refusal. A task with a section would validate everywhere else, sit in the
      gradebook looking ordinary, and then offer `startManual` a set of boxes to score — for work
      nobody handed in and nobody can read.
    */
    const parsed = assignmentSpecSchema.safeParse(
      task({ sections: [{ grading: "manual", label: "Overall", pointValue: 10 }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a way of handing it in", () => {
    // The whole point of the kind is that there is not one.
    expect(assignmentSpecSchema.safeParse(task({ handInMethods: ["LINK"] })).success).toBe(false);
    expect(assignmentSpecSchema.safeParse(task({ acceptedFileTypes: ["pdf"] })).success).toBe(
      false,
    );
  });

  it("refuses a template to hand out", () => {
    expect(
      assignmentSpecSchema.safeParse(
        task({ templateDriveUrl: "https://docs.google.com/document/d/abc/edit" }),
      ).success,
    ).toBe(false);
    expect(
      assignmentSpecSchema.safeParse(task({ templateRepo: "marcylab/swe-1-4-loops" })).success,
    ).toBe(false);
  });
});

describe("what a task is worth", () => {
  it("is one point, derived rather than typed", () => {
    /*
      Not a field, so there is no input an author can give that makes two tasks weigh differently.
      A task records whether it was done; a point value would be a second axis on a kind with one.
    */
    expect(assignmentPointValue({ kind: "TASK", sections: [] })).toBe(TASK_POINT_VALUE);
    expect(parseAssignmentSpec(task()).pointValue).toBe(1);
  });

  it("leaves every other kind summing its sections", () => {
    expect(
      assignmentPointValue({
        kind: "SELF_DIRECTED",
        sections: [{ pointValue: 4 }, { pointValue: 6 }],
      }),
    ).toBe(10);
  });
});

describe("how a task is distributed and collected", () => {
  it("hands nothing out, so there is no Accept", () => {
    expect(hasAcceptStep("TASK")).toBe(false);
  });

  it("collects nothing, so no hand-in form is drawn for it", () => {
    expect(handInMethodsFor({ kind: "TASK", handInMethods: [] })).toEqual([]);
  });

  it("ignores the column even if a row somehow carries one", () => {
    // The column is not where the answer lives — the kind is. A stored `["LINK"]` on a task must
    // not put a URL box on a fellow's screen for work there is no way to hand in.
    expect(handInMethodsFor({ kind: "TASK", handInMethods: ["LINK"] })).toEqual([]);
  });

  it("has no repository", () => {
    expect(requiresRepository("TASK")).toBe(false);
  });
});
