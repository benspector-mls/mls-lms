import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEVELOPMENT_MARKERS,
  MARKER_META,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  answerFor,
  coachingLayoutSchema,
  formatAnswer,
  isBlankAnswer,
  overviewAnswersOf,
  parseLayout,
  parseSnapshot,
  questionsOf,
  sessionAnswersSchema,
  sharedAnswersOf,
  SNAPSHOT_VERSION,
  temperatureTone,
  type CoachingLayout,
  type CoachingSnapshot,
  type LayoutQuestion,
} from "@/lib/coaching";

/**
 * The layout, the answers and the snapshot are all things a database row holds for years, so what
 * these tests protect is renderability over time: a layout written today still validates, an
 * answer of every kind is still checked the same way, a stored answers array stays parseable, and
 * a snapshot written today is still readable when the type has grown.
 */

/** One of every kind, with the two switches set differently across the questions. */
const layout: CoachingLayout = {
  version: 1,
  sections: [
    {
      id: "check-in",
      title: "Check-in",
      caption: "How the week went.",
      items: [
        { id: "temperature", kind: "TEMPERATURE", prompt: "Temperature check" },
        {
          id: "mood",
          kind: "LONG_TEXT",
          prompt: "How are things?",
          shared: false,
          overview: true,
          heading: "Mood",
        },
        { id: "win", kind: "SHORT_TEXT", prompt: "One win", shared: true, overview: false },
        {
          id: "energy",
          kind: "SCALE",
          prompt: "Energy",
          shared: false,
          overview: false,
          min: 1,
          max: 5,
          lowLabel: "Low",
          highLabel: "High",
        },
        {
          id: "focus",
          kind: "SINGLE_CHOICE",
          prompt: "Focus area",
          shared: true,
          overview: true,
          heading: "Focus",
          options: ["Mod 1", "Mod 2"],
        },
        {
          id: "supports",
          kind: "MULTIPLE_CHOICE",
          prompt: "Supports",
          shared: false,
          overview: false,
          options: ["Pairing", "Office hours"],
        },
        {
          id: "ready",
          kind: "YES_NO",
          prompt: "Ready for the GCF?",
          shared: false,
          overview: false,
        },
        { id: "goals-panel", kind: "GOALS", heading: "Goals" },
      ],
    },
  ],
};

const question = (id: string): LayoutQuestion =>
  questionsOf(layout).find((item) => item.id === id)!;

describe("coachingLayoutSchema", () => {
  it("accepts one of every kind", () => {
    expect(coachingLayoutSchema.safeParse(layout).success).toBe(true);
  });

  const withItems = (items: unknown[]) => ({
    version: 1,
    sections: [{ id: "section", title: "S", items }],
  });

  /* The ids are what a stored answer is found by, so a collision would show one answer under two questions. */
  it("refuses an id used twice, across sections as within one", () => {
    expect(
      coachingLayoutSchema.safeParse({
        version: 1,
        sections: [
          { id: "a", title: "A", items: [] },
          { id: "a", title: "B", items: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      coachingLayoutSchema.safeParse(
        withItems([
          { id: "x", kind: "SHORT_TEXT", prompt: "One", shared: false, overview: false },
          { id: "x", kind: "LONG_TEXT", prompt: "Two", shared: false, overview: false },
        ]),
      ).success,
    ).toBe(false);
  });

  it("refuses a second temperature check", () => {
    expect(
      coachingLayoutSchema.safeParse(
        withItems([
          { id: "t1", kind: "TEMPERATURE", prompt: "Temperature" },
          { id: "t2", kind: "TEMPERATURE", prompt: "Again" },
        ]),
      ).success,
    ).toBe(false);
  });

  /* A panel records nothing, so there is nothing to share; the key is refused rather than ignored. */
  it("refuses a panel marked shared", () => {
    expect(
      coachingLayoutSchema.safeParse(
        withItems([{ id: "g", kind: "GOALS", heading: "Goals", shared: true }]),
      ).success,
    ).toBe(false);
  });

  it("refuses a question on the Fellows Coaching tab with no column heading", () => {
    expect(
      coachingLayoutSchema.safeParse(
        withItems([{ id: "q", kind: "SHORT_TEXT", prompt: "Q", shared: false, overview: true }]),
      ).success,
    ).toBe(false);
  });

  it("refuses a choice question with no options, and one whose options repeat", () => {
    const choice = (options: string[]) =>
      withItems([
        { id: "c", kind: "SINGLE_CHOICE", prompt: "C", shared: false, overview: false, options },
      ]);
    expect(coachingLayoutSchema.safeParse(choice([])).success).toBe(false);
    expect(coachingLayoutSchema.safeParse(choice(["a", "a"])).success).toBe(false);
    expect(coachingLayoutSchema.safeParse(choice(["a", "b"])).success).toBe(true);
  });

  it("refuses a scale whose low end is not below its high end, or that spans too far", () => {
    const scale = (min: number, max: number) =>
      withItems([
        {
          id: "s",
          kind: "SCALE",
          prompt: "S",
          shared: false,
          overview: false,
          min,
          max,
          lowLabel: "",
          highLabel: "",
        },
      ]);
    expect(coachingLayoutSchema.safeParse(scale(5, 5)).success).toBe(false);
    expect(coachingLayoutSchema.safeParse(scale(5, 1)).success).toBe(false);
    expect(coachingLayoutSchema.safeParse(scale(0, 21)).success).toBe(false);
    expect(coachingLayoutSchema.safeParse(scale(0, 20)).success).toBe(true);
  });

  it("refuses a form with no section", () => {
    expect(coachingLayoutSchema.safeParse({ version: 1, sections: [] }).success).toBe(false);
  });

  /*
    Null rather than a throw, because the caller is a screen rendering a row somebody else wrote:
    a layout this code cannot read is said so, never a crash on the coach's form.
  */
  it("parseLayout answers null for anything it cannot read", () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout({ version: 2, sections: [] })).toBeNull();
    expect(parseLayout("[]")).toBeNull();
    expect(parseLayout(layout)).toEqual(layout);
  });
});

describe("the converted form in the migration", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20261028120000_coaching_forms_are_templates/migration.sql",
    ),
    "utf8",
  );
  // The JSON holds no single quote, so each literal is the text between two of them.
  const literals = [...sql.matchAll(/'(\{"version": 1[^']*\})'/g)].map((match) =>
    JSON.parse(match[1]!),
  );

  it("is written twice, as the column default and as the seeded template, and the two are the same", () => {
    expect(literals).toHaveLength(2);
    expect(literals[0]).toEqual(literals[1]);
  });

  it("is a layout this code reads", () => {
    expect(parseLayout(literals[0])).not.toBeNull();
  });

  /* The ids every stored answer was saved under, which the converted form must keep asking by. */
  it("keeps the ids the fixed form stored its answers under", () => {
    const ids = questionsOf(parseLayout(literals[0])!).map((item) => item.id);
    expect(ids).toEqual([
      "preparation",
      "on-your-mind",
      "excited",
      "challenging",
      "progress",
      "support",
      "additional-notes",
      "goal-progress",
      "goal-evidence",
      "goal-adjustment",
    ]);
  });

  it("marks the five check-in questions for the Fellows Coaching tab, each with a heading, and shares nothing", () => {
    const converted = parseLayout(literals[0])!;
    const questions = questionsOf(converted);
    expect(
      questions.filter((item) => item.overview).map((item) => [item.id, item.heading]),
    ).toEqual([
      ["on-your-mind", "On their mind"],
      ["excited", "Excited about"],
      ["challenging", "Challenging"],
      ["progress", "Progress"],
      ["support", "Support wanted"],
    ]);
    expect(questions.some((item) => item.shared)).toBe(false);
    expect(
      converted.sections
        .flatMap((section) => section.items)
        .some((item) => item.kind === "TEMPERATURE"),
    ).toBe(true);
  });

  it("names its sections as the fixed form's outline did", () => {
    expect(parseLayout(literals[0])!.sections.map((section) => section.id)).toEqual([
      "before",
      "check-in",
      "goals",
    ]);
  });
});

describe("answerFor", () => {
  it("takes text for the two text kinds and refuses anything else", () => {
    expect(answerFor(question("mood"), "Fine.")).toEqual({ ok: true, answer: "Fine." });
    expect(answerFor(question("win"), "")).toEqual({ ok: true, answer: "" });
    expect(answerFor(question("mood"), 7).ok).toBe(false);
  });

  it("takes a whole number within a scale's bounds", () => {
    expect(answerFor(question("energy"), 3)).toEqual({ ok: true, answer: 3 });
    expect(answerFor(question("energy"), 0).ok).toBe(false);
    expect(answerFor(question("energy"), 6).ok).toBe(false);
    expect(answerFor(question("energy"), 2.5).ok).toBe(false);
    expect(answerFor(question("energy"), "3").ok).toBe(false);
  });

  it("takes one of a single choice's options and nothing outside them", () => {
    expect(answerFor(question("focus"), "Mod 2")).toEqual({ ok: true, answer: "Mod 2" });
    expect(answerFor(question("focus"), "Mod 3").ok).toBe(false);
    expect(answerFor(question("focus"), ["Mod 1"]).ok).toBe(false);
  });

  it("takes any of a multiple choice's options, once each", () => {
    expect(answerFor(question("supports"), ["Pairing", "Office hours"])).toEqual({
      ok: true,
      answer: ["Pairing", "Office hours"],
    });
    expect(answerFor(question("supports"), [])).toEqual({ ok: true, answer: [] });
    expect(answerFor(question("supports"), ["Pairing", "Pairing"]).ok).toBe(false);
    expect(answerFor(question("supports"), ["Tutoring"]).ok).toBe(false);
    expect(answerFor(question("supports"), "Pairing").ok).toBe(false);
  });

  it("takes yes or no as a boolean", () => {
    expect(answerFor(question("ready"), true)).toEqual({ ok: true, answer: true });
    expect(answerFor(question("ready"), "yes").ok).toBe(false);
  });

  it("names the question in a refusal, so the toast says which field", () => {
    const refused = answerFor(question("energy"), 9);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("Energy");
  });
});

describe("formatAnswer and isBlankAnswer", () => {
  it("prints every kind of answer as text", () => {
    expect(formatAnswer("words")).toBe("words");
    expect(formatAnswer(4)).toBe("4");
    expect(formatAnswer(true)).toBe("Yes");
    expect(formatAnswer(false)).toBe("No");
    expect(formatAnswer(["Pairing", "Office hours"])).toBe("Pairing, Office hours");
  });

  it("calls empty text and an empty list blank, and a number or a boolean never", () => {
    expect(isBlankAnswer("  ")).toBe(true);
    expect(isBlankAnswer([])).toBe(true);
    expect(isBlankAnswer("x")).toBe(false);
    expect(isBlankAnswer(0)).toBe(false);
    expect(isBlankAnswer(false)).toBe(false);
  });
});

describe("sharedAnswersOf and overviewAnswersOf", () => {
  const answers = [
    { promptId: "mood", prompt: "How are things?", answer: "Busy." },
    { promptId: "focus", prompt: "Focus area", answer: "Mod 2" },
    { promptId: "energy", prompt: "Energy", answer: 4 },
    { promptId: "no-such-question", prompt: "Gone", answer: "orphan" },
  ];

  it("hands the fellow the shared questions only, in the form's order, null where unanswered", () => {
    expect(sharedAnswersOf(layout, answers).map(({ item, answer }) => [item.id, answer])).toEqual([
      ["win", null],
      ["focus", "Mod 2"],
    ]);
  });

  it("gives the Fellows Coaching tab the marked questions, headed, with answers as text", () => {
    expect(overviewAnswersOf(layout, answers)).toEqual([
      { id: "mood", heading: "Mood", prompt: "How are things?", answer: "Busy." },
      { id: "focus", heading: "Focus", prompt: "Focus area", answer: "Mod 2" },
    ]);
  });

  it("never returns a panel, the temperature, or an answer whose question is not on the form", () => {
    const ids = [
      ...sharedAnswersOf(layout, answers).map(({ item }) => item.id),
      ...overviewAnswersOf(layout, answers).map((entry) => entry.id),
    ];
    expect(ids).not.toContain("goals-panel");
    expect(ids).not.toContain("temperature");
    expect(ids).not.toContain("no-such-question");
  });
});

describe("sessionAnswersSchema", () => {
  const stored = [
    { promptId: "mood", prompt: "How are things?", answer: "Interview prep." },
    { promptId: "energy", prompt: "Energy", answer: 4 },
    { promptId: "ready", prompt: "Ready for the GCF?", answer: false },
    { promptId: "supports", prompt: "Supports", answer: ["Pairing"] },
  ];

  it("round-trips an answer of every kind", () => {
    expect(sessionAnswersSchema.parse(stored)).toEqual(stored);
  });

  it("accepts an empty answer, because an unanswered prompt is ordinary", () => {
    expect(sessionAnswersSchema.safeParse([{ ...stored[0], answer: "" }]).success).toBe(true);
  });

  /*
    Strict, because this shape is written into a Json column: a key that passes through silently
    today is a key some reader depends on tomorrow without anything having decided it.
  */
  it("refuses extra keys and missing ones", () => {
    expect(sessionAnswersSchema.safeParse([{ ...stored[0], mood: "fine" }]).success).toBe(false);
    expect(sessionAnswersSchema.safeParse([{ promptId: "mood", answer: "x" }]).success).toBe(false);
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

describe("temperatureTone", () => {
  it("draws 1 to 3 red, 4 to 6 amber, and 7 to 10 green", () => {
    const tones = Array.from({ length: TEMPERATURE_MAX - TEMPERATURE_MIN + 1 }, (_, index) =>
      temperatureTone(TEMPERATURE_MIN + index),
    );

    expect(tones).toEqual([
      "danger",
      "danger",
      "danger",
      "pending",
      "pending",
      "pending",
      "success",
      "success",
      "success",
      "success",
    ]);
  });
});
