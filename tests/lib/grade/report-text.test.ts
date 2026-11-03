import {
  composeRound,
  readReportRows,
  reportTitle,
  rowTotals,
  type ReportSection,
} from "@/lib/grade/report-text";

/**
 * The comment a student reads, built from the round's summary and its sections.
 *
 * The score an instructor types on a section is the only number they change, so every other
 * number in the posted comment — the title's total and percentage, a heading's subtotal — has to
 * come from the sections here, and has to come out the same in the browser's preview and on the
 * server.
 */

function section(overrides: Partial<ReportSection> = {}): ReportSection {
  return {
    label: "Question 1: calculate_area",
    heading: null,
    type: "coding_algorithm",
    scoreEarned: 3,
    scorePossible: 3,
    feedbackMarkdown: "",
    ...overrides,
  };
}

describe("composeRound", () => {
  it("writes the title with the total, the summary, a rule, and one heading per section", () => {
    const text = composeRound({
      summaryMarkdown: "Solid work.",
      sections: [
        section(),
        section({
          label: "Question 2: is_even",
          scoreEarned: 1,
          feedbackMarkdown: "- Accuracy: `3` is reported as even.",
        }),
      ],
    });
    expect(text).toBe(
      [
        "# Coding Fluency Score Report: 4/6 = 67%",
        "",
        "Solid work.",
        "",
        "---",
        "",
        "## Question 1: calculate_area: 3/3",
        "",
        "## Question 2: is_even: 1/3",
        "",
        "- Accuracy: `3` is reported as even.",
      ].join("\n"),
    );
  });

  it("titles a round by the one type its sections share, and a mixed or hand-graded round plainly", () => {
    expect(reportTitle([section({ type: "short_response" })])).toBe("Short Response Score Report");
    expect(reportTitle([section({ type: "short_response" }), section({ type: "coding_algorithm" })])).toBe(
      "Score Report",
    );
    expect(reportTitle([section({ type: "manual" })])).toBe("Score Report");
  });

  it("lists sections under their heading with the heading's subtotal, as sub-headings", () => {
    const text = composeRound({
      summaryMarkdown: "",
      sections: [
        section({ heading: "From Scratch" }),
        section({ label: "Question 2: is_even", heading: "From Scratch", scoreEarned: 2 }),
        section({ label: "Question 3: greet", heading: "Modify", scoreEarned: 0, feedbackMarkdown: "- Note: not attempted" }),
      ],
    });
    expect(text).toBe(
      [
        "# Coding Fluency Score Report: 5/9 = 56%",
        "",
        "## From Scratch: 5/6",
        "",
        "### Question 1: calculate_area: 3/3",
        "",
        "### Question 2: is_even: 2/3",
        "",
        "## Modify: 0/3",
        "",
        "### Question 3: greet: 0/3",
        "",
        "- Note: not attempted",
      ].join("\n"),
    );
  });

  it("lists checklist sections as boxes under their heading, with feedback nested beneath", () => {
    const text = composeRound({
      summaryMarkdown: "",
      sections: [
        section({
          label: "The page loads",
          heading: "Section 1: Setup",
          type: "coding_frontend",
          scoreEarned: 1,
          scorePossible: 1,
        }),
        section({
          label: "fetchData returns the body",
          heading: "Section 1: Setup",
          type: "coding_frontend",
          scoreEarned: 0.5,
          scorePossible: 1,
          feedbackMarkdown: "- Half Credit: the body is parsed\n  but never returned.",
        }),
      ],
    });
    expect(text).toBe(
      [
        "# Frontend Coding Report: 1.5/2 = 75%",
        "",
        "## Section 1: Setup: 1.5/2",
        "",
        "- [x] The page loads",
        "- [ ] fetchData returns the body",
        "  - Half Credit: the body is parsed",
        "    but never returned.",
      ].join("\n"),
    );
  });

  it("treats a blank heading as none", () => {
    const text = composeRound({ summaryMarkdown: "", sections: [section({ heading: "  " })] });
    expect(text).toContain("## Question 1: calculate_area: 3/3");
  });

  it("adds half points without floating-point noise", () => {
    expect(
      rowTotals([
        { scoreEarned: 0.1, scorePossible: 1 },
        { scoreEarned: 0.2, scorePossible: 1 },
      ]),
    ).toEqual({ earned: 0.3, possible: 2 });
  });

  it("marks an emptied score box rather than counting it as zero", () => {
    const text = composeRound({
      summaryMarkdown: "",
      sections: [section({ scoreEarned: null })],
    });
    expect(text).toMatch(/^# Coding Fluency Score Report: \?\/3\n/);
    expect(text).toContain("## Question 1: calculate_area: ?/3");
  });
});

describe("readReportRows", () => {
  it("reads a row stored before rows carried feedback, taking its note as the reasoning", () => {
    expect(
      readReportRows([
        { label: "Q1", criterion: "technical", scoreEarned: 2, scorePossible: 3, note: "short" },
      ]),
    ).toEqual([
      {
        label: "Q1",
        group: null,
        criterion: "technical",
        scoreEarned: 2,
        scorePossible: 3,
        feedbackMarkdown: "",
        modelReasoning: "short",
      },
    ]);
  });

  it("drops what is not a row", () => {
    expect(readReportRows([null, 3, { criterion: "x" }])).toEqual([]);
    expect(readReportRows("rows")).toEqual([]);
  });
});
