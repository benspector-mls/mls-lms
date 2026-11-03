import { planRound } from "@/scripts/convert-rounds";

/**
 * How a round written before sections were scored units becomes one: each row a section
 * carrying its declared key, the summary and the flags moved to the round, a hand-written
 * section keyed in place, and anything that cannot be matched listed rather than guessed.
 */

const rubricId = "6f1d2c2e-1111-4c4c-8a8a-aaaaaaaaaaaa";

const declaration = [
  {
    grading: "ai",
    key: "q1",
    label: "Question 1: for loops",
    type: "short_response",
    pointValue: 3,
    rubricId,
  },
  {
    grading: "ai",
    key: "q2",
    label: "Question 2: while loops",
    type: "short_response",
    pointValue: 3,
    rubricId,
  },
  {
    grading: "ai",
    key: "w",
    label: "Writing Quality",
    type: "short_response_writing",
    pointValue: 3,
    rubricId,
  },
];

const blank = {
  reportMarkdown: null,
  scoreEarned: null,
  scorePossible: null,
  editedRubricItems: null,
  editedSummaryMarkdown: null,
  flags: [] as string[],
  instructorNotes: [] as string[],
  confidence: null,
  submissionProcessNote: null,
  editedReportMarkdown: null,
  editedScoreEarned: null,
  editedAt: null,
  editedById: null,
};

const rows = [
  {
    label: "Question 1: for loops",
    group: null,
    criterion: "technical",
    scoreEarned: 3,
    scorePossible: 3,
    feedbackMarkdown: "- Praise: clear.",
    modelReasoning: "Complete.",
  },
  {
    label: "Question 2: while loops",
    group: null,
    criterion: "technical",
    scoreEarned: 1,
    scorePossible: 3,
    feedbackMarkdown: "- Accuracy: off.",
    modelReasoning: null,
  },
  {
    label: "Writing Quality Score (Entire Assignment)",
    group: null,
    criterion: "writing_quality",
    scoreEarned: 2,
    scorePossible: 3,
    feedbackMarkdown: "- Proofreading Note: typos.",
    modelReasoning: null,
  },
];

describe("planRound", () => {
  it("turns a model-graded section's rows into keyed sections and moves the summary to the round", () => {
    const edited = new Date("2026-10-01T00:00:00Z");
    const plan = planRound(
      {
        summaryMarkdown: null,
        sections: [
          {
            ...blank,
            id: "s1",
            sectionType: "short_response",
            rubricItems: rows,
            editedRubricItems: [
              { ...rows[0]!, scoreEarned: 2, feedbackMarkdown: "- Accuracy: one slip." },
              rows[1]!,
              rows[2]!,
            ],
            summaryMarkdown: "Good work.",
            editedSummaryMarkdown: "Good work overall.",
            flags: ["MECHANICAL", "TEST_EVIDENCE"],
            instructorNotes: ["No key for Q2."],
            confidence: "HIGH",
            submissionProcessNote: "Pushed to main.",
            editedAt: edited,
            editedById: "p1",
          },
        ],
      },
      declaration,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan).toMatchObject({
      summaryMarkdown: "Good work.",
      editedSummaryMarkdown: "Good work overall.",
      flags: ["MECHANICAL", "TEST_EVIDENCE"],
      instructorNotes: ["No key for Q2."],
      confidence: "HIGH",
      submissionProcessNote: "Pushed to main.",
      keep: [],
    });
    expect(plan.replace).toHaveLength(1);
    expect(plan.replace[0]!.sectionId).toBe("s1");
    expect(plan.replace[0]!.sections).toEqual([
      {
        sectionKey: "w",
        label: "Writing Quality",
        heading: null,
        skillId: null,
        sectionType: "short_response_writing",
        reportMarkdown: "- Proofreading Note: typos.",
        scoreEarned: 2,
        scorePossible: 3,
        modelReasoning: null,
        editedReportMarkdown: null,
        editedScoreEarned: null,
        editedAt: null,
        editedById: null,
      },
      {
        sectionKey: "q1",
        label: "Question 1: for loops",
        heading: null,
        skillId: null,
        sectionType: "short_response",
        reportMarkdown: "- Praise: clear.",
        scoreEarned: 3,
        scorePossible: 3,
        modelReasoning: "Complete.",
        editedReportMarkdown: "- Accuracy: one slip.",
        editedScoreEarned: 2,
        editedAt: edited,
        editedById: "p1",
      },
      {
        sectionKey: "q2",
        label: "Question 2: while loops",
        heading: null,
        skillId: null,
        sectionType: "short_response",
        reportMarkdown: "- Accuracy: off.",
        scoreEarned: 1,
        scorePossible: 3,
        modelReasoning: null,
        editedReportMarkdown: null,
        editedScoreEarned: null,
        editedAt: null,
        editedById: null,
      },
    ]);
  });

  it("matches rows by position when the labels differ but the counts agree", () => {
    const plan = planRound(
      {
        summaryMarkdown: null,
        sections: [
          {
            ...blank,
            id: "s1",
            sectionType: "short_response",
            rubricItems: [{ ...rows[0]!, label: "Q1" }, { ...rows[1]!, label: "Q2" }, rows[2]!],
            summaryMarkdown: "",
          },
        ],
      },
      declaration,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.replace[0]!.sections.map((s) => s.sectionKey)).toEqual(["w", "q1", "q2"]);
  });

  it("keys a hand-written section in place by the declared unit it stored the label of", () => {
    const plan = planRound(
      {
        summaryMarkdown: null,
        sections: [
          {
            ...blank,
            id: "s1",
            sectionType: "Reflection",
            rubricItems: [],
            reportMarkdown: "Fine.",
            scoreEarned: 8,
            scorePossible: 10,
            summaryMarkdown: null,
          },
        ],
      },
      [{ grading: "manual", key: "r", label: "Reflection", pointValue: 10 }],
    );
    expect(plan).toMatchObject({
      ok: true,
      summaryMarkdown: "",
      replace: [],
      keep: [
        {
          sectionId: "s1",
          sectionKey: "r",
          label: "Reflection",
          heading: null,
          skillId: null,
          sectionType: "manual",
          reportMarkdown: "Fine.",
          editedReportMarkdown: null,
        },
      ],
    });
  });

  it("refuses a hand-written short response whose one score would have to be divided", () => {
    const plan = planRound(
      {
        summaryMarkdown: null,
        sections: [
          {
            ...blank,
            id: "s1",
            sectionType: "short_response",
            rubricItems: [],
            reportMarkdown: "Fine.",
            scoreEarned: 5,
            scorePossible: 6,
            summaryMarkdown: null,
          },
        ],
      },
      declaration,
    );
    expect(plan.ok).toBe(false);
  });

  it("refuses rows that match the declaration neither by label nor by count", () => {
    const plan = planRound(
      {
        summaryMarkdown: null,
        sections: [
          {
            ...blank,
            id: "s1",
            sectionType: "short_response",
            rubricItems: [{ ...rows[0]!, label: "Q1" }, rows[2]!],
            summaryMarkdown: "",
          },
        ],
      },
      declaration,
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("labels do not match");
  });
});

describe("a hand-written report that opened with its score", () => {
  it("loses the title line, since the composed heading now carries the score", () => {
    const plan = planRound(
      {
        summaryMarkdown: null,
        sections: [
          {
            ...blank,
            id: "s1",
            sectionType: "Reflection",
            rubricItems: [],
            reportMarkdown: "# Reflection Score Report: 8/10 = 80%\n\nFine.",
            editedReportMarkdown:
              "## Reflection Score: 9/10\nBetter.\n\n## Writing Score: 3/3\n- Clear.",
            scoreEarned: 8,
            scorePossible: 10,
            summaryMarkdown: null,
          },
        ],
      },
      [{ grading: "manual", key: "r", label: "Reflection", pointValue: 10 }],
    );
    expect(plan).toMatchObject({
      ok: true,
      keep: [
        {
          sectionId: "s1",
          reportMarkdown: "Fine.",
          // The title goes; a sub-heading the instructor wrote stays, scores and all.
          editedReportMarkdown: "Better.\n\n## Writing Score: 3/3\n- Clear.",
        },
      ],
    });
  });
});
