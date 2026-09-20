import {
  CHECK_IN_PROMPTS,
  DEVELOPMENT_MARKERS,
  MARKER_META,
  SNAPSHOT_VERSION,
  parseSnapshot,
  sessionAnswersSchema,
  type CoachingSnapshot,
} from "@/lib/coaching";

/**
 * The coaching template and the snapshot are both things a database row holds for years, so what
 * these tests protect is renderability over time: a prompt id stays resolvable, a stored answers
 * array stays parseable, and a snapshot written today is still readable when the type has grown.
 */

describe("the check-in prompts", () => {
  it("keeps prompt ids unique", () => {
    const ids = CHECK_IN_PROMPTS.map((prompt) => prompt.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("phrases every prompt as a question to the fellow", () => {
    for (const prompt of CHECK_IN_PROMPTS) {
      expect(prompt.prompt.endsWith("?")).toBe(true);
    }
  });
});

describe("sessionAnswersSchema", () => {
  const stored = [
    {
      promptId: "on-your-mind",
      prompt: "What has been on your mind lately?",
      answer: "Interview prep.",
    },
  ];

  it("round-trips the stored shape", () => {
    expect(sessionAnswersSchema.parse(stored)).toEqual(stored);
  });

  it("accepts an empty answer, because an unanswered prompt is ordinary", () => {
    expect(
      sessionAnswersSchema.safeParse([{ ...stored[0], answer: "" }]).success,
    ).toBe(true);
  });

  /*
    Strict, because this shape is written into a Json column: a key that passes through silently
    today is a key some reader depends on tomorrow without anything having decided it.
  */
  it("refuses extra keys and missing ones", () => {
    expect(sessionAnswersSchema.safeParse([{ ...stored[0], mood: "fine" }]).success).toBe(false);
    expect(
      sessionAnswersSchema.safeParse([{ promptId: "on-your-mind", answer: "x" }]).success,
    ).toBe(false);
  });
});

describe("parseSnapshot", () => {
  const snapshot: CoachingSnapshot = {
    version: SNAPSHOT_VERSION,
    takenAt: "2026-09-19T14:00:00.000Z",
    attendance: {
      eligible: 40,
      present: 34,
      late: 3,
      excused: 1,
      absent: 1,
      unrecorded: 1,
      rate: 0.925,
    },
    courses: [
      {
        courseId: "c1",
        name: "Prework",
        completedAssignments: { complete: 14, possible: 20 },
        missing: 2,
        late: 1,
        verdict: "pending",
      },
    ],
  };

  it("accepts a version-1 snapshot", () => {
    expect(parseSnapshot(snapshot)).toEqual(snapshot);
  });

  /*
    Null rather than a throw, because the caller is a screen rendering a row somebody else wrote:
    a snapshot this code cannot read is shown as absent, never as a crash on the fellow's page.
  */
  it("answers null for anything it cannot read", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ version: 99, courses: [] })).toBeNull();
    expect(parseSnapshot("[]")).toBeNull();
  });
});

describe("the development markers", () => {
  it("covers all four, in ascending order, each with a label and an explanation", () => {
    expect(DEVELOPMENT_MARKERS).toEqual(["FOUNDATIONAL", "DEVELOPING", "PROFICIENT", "EXCEEDS"]);
    for (const marker of DEVELOPMENT_MARKERS) {
      expect(MARKER_META[marker].label.length).toBeGreaterThan(0);
      expect(MARKER_META[marker].description.length).toBeGreaterThan(0);
    }
  });
});
